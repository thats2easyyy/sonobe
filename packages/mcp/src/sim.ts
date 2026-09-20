/**
 * Simulation sessions for sim_* tools: deterministic engine runtimes keyed by simId, high-level
 * gestures synthesized into InputEvents, hit reports that explain missed taps, stepping until
 * idle or a condition, and traces with summaries. Never mutates documents. Browser-safe.
 *
 * Inputs resolve their targets and compute hit reports when they fire, against the frame the
 * engine hit-tests them on, so a tap on a layer that appears partway through a batch is reported
 * truthfully. Traces that don't advance the session run on a clone replayed from the session's
 * own input log, so they get the same per-input reports.
 *
 * A session can carry sim_override overrides: value ops applied to its own copy of the document
 * (overrides.ts), re-applied on every new revision. The document itself never changes.
 */

import {
  checkKnobLiteral,
  didYouMean,
  didYouMeanText,
  findKnob,
  findLayer,
  getKnob,
  getKnobPreset,
  getPatchSpec,
  knobLiteral,
  parseAddress,
  resolveKnobOverride,
  withKnobOverride,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  walkLayers,
  isLayerInput,
  isLinkInput,
  type Component,
  type Id,
  type KnobOverride,
  type Literal,
  type SonobeDocument,
} from "@sonobe/core";
import {
  createRuntime,
  summarizeSeries,
  type EngineRegistry,
  type InputEvent,
  type SceneFrame,
  type SceneNode,
  type SonobeRuntime,
  type TraceSummary,
} from "@sonobe/engine";
import { toJsonValue } from "./format.ts";
import {
  HostError,
  type SimChange,
  type SimDispatchedEvent,
  type SimEvent,
  type SimHit,
  type SimHost,
  type SimIssue,
  type SimKnobOverride,
  type SimOverride,
  type SimState,
  type SimStepResult,
  type SimTarget,
  type SimTraceResult,
  type SimValuesResult,
} from "./host.ts";
import { instancePathTo, resolveInstancePath, splitInstanceAddress } from "./instances.ts";
import {
  applyOverrides,
  MAX_OVERRIDES,
  overrideEntries,
  overrideKeys,
  overrideNote,
  type OverrideEntry,
} from "./overrides.ts";

export interface SimulationManagerOptions {
  registry: EngineRegistry;
  /** Current document and revision (throws HostError when unknown). */
  getDocument(docId: Id | undefined): { docId: Id; doc: SonobeDocument; revision: number };
  /** Maximum open sessions; the oldest is dropped past it (default 8). */
  maxSessions?: number;
}

type RuntimeOptions = Parameters<typeof createRuntime>[1];

/** What happened to a session since sim_reset, replayed to clone it for traces on a copy. */
type LogEntry =
  | { kind: "steps"; count: number }
  | { kind: "input"; events: InputEvent[] }
  | { kind: "update"; doc: SonobeDocument }
  | { kind: "refresh" };

interface Session {
  simId: string;
  docId: Id;
  revision: number;
  seed: number;
  fps: 60 | 120;
  runtime: SonobeRuntime;
  runtimeOptions: RuntimeOptions;
  /** The document the runtime was created with (replay start). */
  baseDoc: SonobeDocument;
  log: LogEntry[];
  loggedSteps: number;
  /** Past the replay budget; traces on a copy fall back to the engine's own trace. */
  logTruncated: boolean;
  /** The document was hot-swapped and no result has said so yet. */
  pendingUpdate: boolean;
  reportedIssues: Set<string>;
  lastUsed: number;
  /** sim_override changes, applied in order on top of the person's document. */
  overrides: OverrideEntry[];
  /** sim_reset preset and knobs: the knob values this session runs, under the overrides. */
  knobs: KnobOverride | undefined;
  /** Overrides the person's newer document no longer accepts, not yet reported. */
  dropped: { target: string; reason: string }[];
  /** Override ids handed out ("ov_3" is the third). */
  overrideCount: number;
}

/** A scheduled input that resolves its target and reports hits when it fires. */
interface PlannedInput {
  atMs: number;
  order: number;
  /** Events to dispatch on `rt` now; `framesStepped` counts frames already run in this call. */
  fire(rt: SonobeRuntime, framesStepped: number): InputEvent[];
}

type TargetSpec =
  | { kind: "point"; point: [number, number] }
  | {
      kind: "layer";
      text: string;
      /** Scene-key instance segments ("card#2"), root first. */
      path: string[];
      layerId: Id;
      instance?: number;
    };

const DEFAULT_MAX_MS = 10_000;
const MAX_FRAMES_PER_CALL = 120 * 60;
const MAX_REPLAY_STEPS = 20_000;
const TAP_HOLD_MS = 50;
const LONG_PRESS_MS = 600;
const DRAG_MS = 300;

const ADDRESS_HINT =
  'Read patch ports as "patchId.port" and layer properties as "@layerId.prop"; append "#2" for one loop copy, e.g. "@row.position#2". Inside a component instance, put the instance path first: "card/tap_badge.down" or "@card#2/badge.scale". Read a knob as "$knob.<id>".';

/** Center of a scene node in prototype coordinates. */
function nodeCenter(node: SceneNode): [number, number] {
  const m = node.worldTransform;
  const x = node.width / 2;
  const y = node.height / 2;
  return [m[0]! * x + m[4]! * y + m[12]!, m[1]! * x + m[5]! * y + m[13]!];
}

function* walkScene(nodes: readonly SceneNode[]): Generator<SceneNode> {
  for (const node of nodes) {
    yield node;
    yield* walkScene(node.children);
  }
}

/** Instance segments of a scene key ("card#2/badge#1" → ["card#2"]) and its own part. */
function splitKey(key: string): { prefix: string[]; own: string } {
  const parts = key.split("/");
  const own = parts.pop()!;
  return { prefix: parts, own };
}

function prefixMatches(actual: readonly string[], wanted: readonly string[]): boolean {
  if (actual.length !== wanted.length) return false;
  return actual.every(
    (segment, i) =>
      segment === wanted[i] || (!wanted[i]!.includes("#") && segment === `${wanted[i]}#0`),
  );
}

function findSceneNode(
  runtime: SonobeRuntime,
  path: readonly string[],
  layerId: Id,
  instance: number | undefined,
): SceneNode | undefined {
  const scene = runtime.scene();
  let first: SceneNode | undefined;
  for (const node of walkScene(scene.roots)) {
    if (node.layerId !== layerId) continue;
    const { prefix, own } = splitKey(node.key);
    if (!prefixMatches(prefix, path)) continue;
    if (instance !== undefined) {
      if (own === `${layerId}#${instance}`) return node;
      continue;
    }
    if (own === layerId || own === `${layerId}#0`) return node;
    first ??= node;
  }
  return first;
}

const LAYER_TARGET =
  /^@((?:[A-Za-z_][A-Za-z0-9_]*(?:#\d+)?\/)*)([A-Za-z_][A-Za-z0-9_]*)(?:#(\d+))?$/;

function comparePasses(actual: unknown, op: string, expected: number | boolean | string): boolean {
  if (typeof expected === "number") {
    const n =
      typeof actual === "number"
        ? actual
        : typeof actual === "boolean"
          ? actual
            ? 1
            : 0
          : Array.isArray(actual) && typeof actual[0] === "number"
            ? actual[0]
            : NaN;
    if (!Number.isFinite(n)) return false;
    switch (op) {
      case ">":
        return n > expected;
      case ">=":
        return n >= expected;
      case "<":
        return n < expected;
      case "<=":
        return n <= expected;
      case "==":
        return Math.abs(n - expected) <= 1e-3;
      case "!=":
        return Math.abs(n - expected) > 1e-3;
    }
    return false;
  }
  const equal = actual === expected;
  return op === "!=" ? !equal : op === "==" ? equal : false;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(toJsonValue(a)) === JSON.stringify(toJsonValue(b));
}

const finiteMs = (ms: unknown) =>
  typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : 0;

/** How long previewScene waits for start-up animations to settle. */
const PREVIEW_SETTLE_MS = 5000;

export interface SimulationManager extends SimHost {
  /**
   * A session's current frame, for rendering simulation screenshots. Pending document edits are
   * hot-swapped first (without advancing time); the next sim_* result still reports them.
   */
  scene(simId: string): SceneFrame;
  /**
   * The frame `atMs` milliseconds after a session's current frame, stepped on a copy so the session
   * doesn't move (0: the current frame).
   */
  sceneAt(simId: string, atMs: number): SceneFrame;
  /**
   * A document's frame without a session, for screenshots: a fresh deterministic run stepped `atMs`
   * past its first frame, or (without atMs) until start-up animations settle, up to `maxMs`
   * (default 5000). `settled` is false when something was still animating.
   */
  previewScene(
    docId: Id | undefined,
    options?: { atMs?: number; maxMs?: number },
  ): { scene: SceneFrame; settled: boolean };
  /** Drop every session for a document (closed documents). */
  closeDocument(docId: Id): void;
  dispose(): void;
}

export function createSimulationManager(options: SimulationManagerOptions): SimulationManager {
  const sessions = new Map<string, Session>();
  const maxSessions = options.maxSessions ?? 8;
  let counter = 0;
  let clock = 0;

  const require = (simId: string): Session => {
    const session = sessions.get(simId);
    if (!session) {
      const open = [...sessions.keys()];
      throw new HostError(
        "unknown_sim",
        `There's no simulation "${simId}".${didYouMeanText(didYouMean(simId, open))}`,
        {
          hint: open.length
            ? `Open simulations: ${open.join(", ")}. Or start a new one with sim_reset.`
            : "Start one with sim_reset.",
        },
      );
    }
    session.lastUsed = ++clock;
    return session;
  };

  const pushLog = (session: Session, entry: LogEntry) => {
    if (!session.logTruncated) session.log.push(entry);
  };

  /** Dispatch `events` and step the session one frame, recording it for replay. */
  const advance = (session: Session, events: readonly InputEvent[]) => {
    if (events.length) session.runtime.dispatch([...events]);
    session.runtime.step();
    session.loggedSteps++;
    if (session.logTruncated) return;
    if (session.loggedSteps > MAX_REPLAY_STEPS) {
      session.logTruncated = true;
      session.log = [];
      return;
    }
    if (events.length) {
      session.log.push({ kind: "input", events: [...events] });
      return;
    }
    const last = session.log[session.log.length - 1];
    if (last?.kind === "steps") last.count++;
    else session.log.push({ kind: "steps", count: 1 });
  };

  /** A fresh runtime in the session's exact state (replays its log). */
  const replay = (session: Session): SonobeRuntime => {
    const clone = createRuntime(session.baseDoc, session.runtimeOptions);
    for (const entry of session.log) {
      switch (entry.kind) {
        case "steps":
          for (let i = 0; i < entry.count; i++) clone.step();
          break;
        case "input":
          clone.dispatch([...entry.events]);
          clone.step();
          break;
        case "update":
          clone.updateDocument(entry.doc);
          break;
        case "refresh":
          clone.refreshScene();
          break;
      }
    }
    return clone;
  };

  /**
   * The document a session simulates: the person's, running the session's knob preset and values
   * (sim_reset), with its sim_override changes on top:
   * applyOverrides(withKnobOverride(personDoc, knobs), ops). Re-derived on every person revision;
   * a preset, knob or override the new revision no longer has is dropped and reported once.
   */
  const effectiveDoc = (
    session: Pick<Session, "overrides" | "dropped" | "knobs">,
    personDoc: SonobeDocument,
  ): SonobeDocument => {
    let doc = personDoc;
    if (session.knobs) {
      session.knobs = keptKnobOverride(session.knobs, personDoc, session.dropped);
      if (session.knobs) doc = withKnobOverride(personDoc, session.knobs);
    }
    if (!session.overrides.length) return doc;
    const r = applyOverrides(doc, session.overrides, options.registry);
    session.overrides = r.kept;
    for (const f of r.failed)
      session.dropped.push({ target: f.entry.target, reason: f.error.message });
    return r.doc;
  };

  /** Hot-swap `doc` into the session and lay it out without advancing time. */
  const swap = (session: Session, doc: SonobeDocument): void => {
    session.runtime.updateDocument(doc);
    pushLog(session, { kind: "update", doc });
    if (typeof session.runtime.refreshScene === "function") {
      session.runtime.refreshScene();
      pushLog(session, { kind: "refresh" });
    } else {
      advance(session, []);
    }
  };

  /** Hot-swap the document when it changed since the session last looked, and lay it out without advancing time. */
  const refresh = (session: Session): void => {
    const current = options.getDocument(session.docId);
    if (current.revision === session.revision) return;
    swap(session, effectiveDoc(session, current.doc));
    session.revision = current.revision;
    session.pendingUpdate = true;
  };

  const newIssues = (session: Session): SimIssue[] => {
    const out: SimIssue[] = [];
    const current = new Set<string>();
    for (const issue of session.runtime.issues()) {
      const key = `${issue.code}|${issue.patchId ?? ""}|${issue.layerId ?? ""}|${issue.componentPath ?? ""}|${issue.message}`;
      current.add(key);
      if (session.reportedIssues.has(key)) continue;
      session.reportedIssues.add(key);
      const out1: SimIssue = { code: issue.code, severity: issue.severity, message: issue.message };
      if (issue.patchId !== undefined)
        out1.patchId = issue.componentPath
          ? `${issue.componentPath}/${issue.patchId}`
          : issue.patchId;
      if (issue.layerId !== undefined) out1.layerId = issue.layerId;
      if (issue.hint !== undefined) out1.hint = issue.hint;
      if (issue.suggestions?.length) out1.suggestions = issue.suggestions;
      out.push(out1);
    }
    // An issue that went away (an empty_loop warning once the layer has copies again, or cleared by
    // an edit) is reported again when it comes back.
    for (const key of session.reportedIssues)
      if (!current.has(key)) session.reportedIssues.delete(key);
    return out;
  };

  const overrideInfo = (o: OverrideEntry): SimOverride => ({
    id: o.id,
    target: o.target,
    component: o.component,
    summary: o.summary,
  });

  const baseState = (session: Session): SimState => {
    const s: SimState = {
      simId: session.simId,
      docId: session.docId,
      frame: Math.max(0, session.runtime.frame),
      timeMs: Math.round(session.runtime.time * 100000) / 100,
      fps: session.fps,
      seed: session.seed,
      issues: [],
    };
    if (session.overrides.length) s.overrides = session.overrides.map(overrideInfo);
    if (session.knobs) s.knobs = knobOverrideInfo(session.knobs, docOf(session));
    return s;
  };

  const state = (session: Session): SimState => {
    const s = baseState(session);
    s.issues = newIssues(session);
    if (session.dropped.length) {
      s.droppedOverrides = session.dropped;
      session.dropped = [];
    }
    if (session.pendingUpdate) {
      s.documentUpdated = true;
      session.pendingUpdate = false;
    }
    return s;
  };

  const docOf = (session: Session) => session.runtime.document;

  /** For "$knob.<id>" in a session that runs other knob values: what the person's document runs instead. */
  const knobNote = (session: Session, target: string): string | undefined => {
    const a = parseAddress(target);
    if (a?.kind !== "knob" || !session.knobs) return undefined;
    const person = options.getDocument(session.docId).doc.knobs;
    const knob = getKnob(person, a.key);
    if (!person || !knob) return undefined;
    const theirs = `the person's ${getKnobPreset(person, person.active)?.name ?? person.active} has ${JSON.stringify(knobLiteral(person, knob))}`;
    if (session.knobs.values && Object.hasOwn(session.knobs.values, a.key)) return `set for this simulation; ${theirs}`;
    const preset = session.knobs.preset;
    if (preset === undefined || preset === person.active) return undefined;
    return `${getKnobPreset(person, preset)?.name ?? preset} in this simulation; ${theirs}`;
  };

  /** Validate a value address, including "instancePath/patchId.port" and "@instancePath/layerId.prop". */
  const checkTarget = (session: Session, address: string): void => {
    const doc = docOf(session);
    const split = splitInstanceAddress(address);
    const parsed = parseAddress(split.at + split.tail);
    if (parsed?.kind === "knob") {
      if (split.path !== undefined)
        throw new HostError(
          "invalid_address",
          `A knob has one value everywhere, so "${address}" doesn't take an instance path.`,
          { hint: `Read "$knob.${parsed.key}".` },
        );
      const knob = findKnob(doc.knobs, parsed.key);
      if (!knob.ok || knob.value.id !== parsed.key)
        throw new HostError(
          "unknown_knob",
          knob.ok
            ? `"${parsed.key}" is the name of the knob ${knob.value.id}; read it as "$knob.${knob.value.id}".`
            : knob.error.message,
          knob.ok || !knob.error.hint ? {} : { hint: knob.error.hint },
        );
      return;
    }
    if (!parsed || (parsed.kind !== "patch" && parsed.kind !== "layer"))
      throw new HostError(
        "invalid_address",
        `"${address}" isn't a value the simulation can read.`,
        { hint: ADDRESS_HINT },
      );
    if (!doc.components[doc.project.root])
      throw new HostError("missing_root", "The document has no root component to simulate.");
    const scope = resolveInstancePath(doc, split.path);
    if (!scope.ok)
      throw new HostError(scope.code, scope.message, scope.hint ? { hint: scope.hint } : {});
    const c = scope.component;
    const prefix = split.path ? `${split.path}/` : "";
    const suffix = parsed.index === undefined ? "" : `#${parsed.index}`;
    /** At the root, an id that isn't there may live inside a component: teach the instance path. */
    const inside = (id: Id, rewrite: (path: string) => string): HostError | undefined => {
      if (split.path) return undefined;
      const other = Object.values(doc.components).find(
        (x) => x.id !== c.id && (id in x.patches || findLayer(x.layers, id)),
      );
      if (!other) return undefined;
      const path = instancePathTo(doc, other.id);
      return path
        ? new HostError(
            "inside_component",
            `"${id}" lives inside component "${other.id}". Read it through an instance: "${rewrite(path)}".`,
            { hint: "Instance paths name component instances from the root, separated by /." },
          )
        : new HostError(
            "inside_component",
            `"${id}" lives inside component "${other.id}", and no instance of it is on screen, so the simulation can't read it.`,
            { hint: "Add an instance of the component to the root, then read through it." },
          );
    };
    const where = split.path ? `component ${c.id} (instance ${split.path})` : c.id;
    if (parsed.kind === "patch") {
      const node = c.patches[parsed.id];
      if (!node) {
        throw (
          inside(parsed.id, (path) => `${path}/${parsed.id}.${parsed.key}${suffix}`) ??
          new HostError(
            "not_found",
            `There's no patch "${parsed.id}" in ${where}.${didYouMeanText(didYouMean(parsed.id, Object.keys(c.patches)))}`,
            findLayer(c.layers, parsed.id)
              ? { hint: `"${parsed.id}" is a layer; write "@${prefix}${parsed.id}.${parsed.key}".` }
              : {},
          )
        );
      }
      const ports = resolveNodePorts(doc, node, options.registry);
      const keys = ports ? [...ports.outputs, ...ports.inputs].map((p) => p.key) : [];
      if (ports && !keys.includes(parsed.key)) {
        throw new HostError(
          "unknown_port",
          `The ${getPatchSpec(options.registry, node.type)?.name ?? node.type} patch "${prefix}${parsed.id}" has no port "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, keys))}`,
          {
            hint: `Outputs: ${ports.outputs.map((p) => p.key).join(", ") || "(none)"}. Inputs: ${ports.inputs.map((p) => p.key).join(", ") || "(none)"}.`,
          },
        );
      }
      return;
    }
    const loc = findLayer(c.layers, parsed.id);
    if (!loc) {
      throw (
        inside(parsed.id, (path) => `@${path}/${parsed.id}.${parsed.key}${suffix}`) ??
        new HostError(
          "not_found",
          `There's no layer "${parsed.id}" in ${where}.${didYouMeanText(didYouMean(parsed.id, allLayerIdsOf(c.layers)))}`,
          c.patches[parsed.id]
            ? { hint: `"${parsed.id}" is a patch; write "${prefix}${parsed.id}.${parsed.key}".` }
            : {},
        )
      );
    }
    const props = resolveLayerProps(doc, c.id, loc.layer, options.registry) ?? [];
    const outputs = resolveLayerOutputs(doc, c.id, loc.layer, options.registry);
    const keys = [...props, ...outputs].map((p) => p.key);
    if (!keys.includes(parsed.key)) {
      throw new HostError(
        "unknown_prop",
        `Layer "${prefix}${parsed.id}" (${loc.layer.type}) has no property "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, keys))}`,
      );
    }
  };

  const read = (rt: SonobeRuntime, target: string): unknown => toJsonValue(rt.getValue(target));

  /** Linked layer props in the root component: what usually shows an interaction happening. */
  const defaultWatch = (session: Session): string[] => {
    const doc = docOf(session);
    const root = doc.components[doc.project.root];
    const out: string[] = [];
    if (!root) return out;
    walkLayers(root.layers, (layer) => {
      for (const [key, value] of Object.entries(layer.props))
        if (isLinkInput(value)) out.push(`@${layer.id}.${key}`);
    });
    return out.slice(0, 12);
  };

  /** Validate a tap/drag/hover/scroll target up front (before anything steps). */
  const parseTarget = (doc: SonobeDocument, target: SimTarget, label: string): TargetSpec => {
    if (Array.isArray(target)) {
      if (target.length !== 2 || !target.every((n) => typeof n === "number" && Number.isFinite(n)))
        throw new HostError("invalid_target", `${label} must be "@layerId" or [x, y].`);
      return { kind: "point", point: [target[0], target[1]] };
    }
    const text = typeof target === "string" ? target.trim() : "";
    const m = LAYER_TARGET.exec(text);
    if (!m)
      throw new HostError(
        "invalid_target",
        `${label} "${String(target)}" isn't a layer or a point.`,
        {
          hint: 'Use "@card", "@row#2" for a loop copy, "@card/badge" for a layer inside a component instance, or [x, y] in prototype points.',
        },
      );
    const pathText = m[1] ? m[1].slice(0, -1) : undefined;
    const layerId = m[2]!;
    const scope = resolveInstancePath(doc, pathText);
    if (!scope.ok)
      throw new HostError(scope.code, scope.message, scope.hint ? { hint: scope.hint } : {});
    if (!findLayer(scope.component.layers, layerId)) {
      const other = pathText
        ? undefined
        : Object.values(doc.components).find(
            (x) => x.id !== scope.component.id && findLayer(x.layers, layerId),
          );
      const path = other ? instancePathTo(doc, other.id) : undefined;
      throw new HostError(
        "not_found",
        `There's no layer "${layerId}" to touch${pathText ? ` inside ${pathText}` : ""}.${didYouMeanText(didYouMean(layerId, allLayerIdsOf(scope.component.layers)))}`,
        path
          ? {
              hint: `"${layerId}" lives inside component "${other!.id}"; target "@${path}/${layerId}".`,
            }
          : {},
      );
    }
    const spec: TargetSpec = {
      kind: "layer",
      text,
      path: scope.steps.map((s) => s.segment),
      layerId,
    };
    if (m[3] !== undefined) spec.instance = Number(m[3]);
    return spec;
  };

  /** Where a target is right now; undefined (with a warning) when its layer isn't rendered. */
  const locate = (
    rt: SonobeRuntime,
    target: TargetSpec,
    report: SimDispatchedEvent,
    atMs: number,
    framesStepped: number,
  ): [number, number] | undefined => {
    if (target.kind === "point") return target.point;
    const node = findSceneNode(rt, target.path, target.layerId, target.instance);
    if (node) return nodeCenter(node);
    const name = `Layer "${target.text.slice(1)}"`;
    const hint =
      "Its loop may have fewer copies right now, or the layer may be inside a component instance that isn't on screen. Check the copy count with sim_get_values, or tap a point instead.";
    if (framesStepped === 0)
      throw new HostError(
        "layer_not_rendered",
        `${name} isn't in the current frame, so there's nothing to touch.`,
        { hint },
      );
    report.warnings.push(
      `${name} wasn't in the frame at ${Math.round(atMs)} ms, so the ${report.kind} was skipped. ${hint}`,
    );
    return undefined;
  };

  const layerName = (rt: SonobeRuntime, key: string, id: Id): string | undefined => {
    const { prefix } = splitKey(key);
    const scope = resolveInstancePath(rt.document, prefix.length ? prefix.join("/") : undefined);
    return scope.ok ? findLayer(scope.component.layers, id)?.layer.name : undefined;
  };

  /** Interaction-category patches bound to a layer in the hit chain (or to the whole screen), with instance paths. */
  const listeners = (
    rt: SonobeRuntime,
    chain: readonly { key: string; layerId: Id }[],
  ): string[] => {
    const doc = rt.document;
    const byPrefix = new Map<string, Set<Id>>([["", new Set()]]);
    for (const node of chain) {
      const prefix = splitKey(node.key).prefix.join("/");
      const set = byPrefix.get(prefix) ?? new Set<Id>();
      set.add(node.layerId);
      byPrefix.set(prefix, set);
    }
    const out = new Set<string>();
    for (const [prefix, layerIds] of byPrefix) {
      const scope = resolveInstancePath(doc, prefix || undefined);
      if (!scope.ok) continue;
      visitListeners(scope.component, (id, bound) => {
        if (bound.length ? bound.some((b) => layerIds.has(b)) : true)
          out.add(prefix ? `${prefix}/${id}` : id);
      });
    }
    return [...out].sort();
  };

  const visitListeners = (component: Component, visit: (id: Id, bound: Id[]) => void) => {
    for (const [id, node] of Object.entries(component.patches)) {
      const spec = getPatchSpec(options.registry, node.type);
      if (spec?.category !== "interaction") continue;
      const layerPorts = spec.inputs.filter((p) => p.type === "layer");
      if (!layerPorts.length) continue;
      visit(
        id,
        layerPorts
          .map((p) => node.inputs[p.key])
          .filter(isLayerInput)
          .map((b) => b.layer),
      );
    }
  };

  const interactiveLayers = (rt: SonobeRuntime): Id[] => {
    const doc = rt.document;
    const root = doc.components[doc.project.root];
    if (!root) return [];
    const ids = new Set<Id>();
    visitListeners(root, (_id, bound) => bound.forEach((b) => ids.add(b)));
    return [...ids];
  };

  const hitReport = (
    rt: SonobeRuntime,
    point: [number, number],
    intended: TargetSpec,
  ): { hit: SimHit; warnings: string[] } => {
    const chainNodes = rt.hitTest(point[0], point[1]);
    const chain = chainNodes.map((n) => n.layerId).filter((id, i, a) => a.indexOf(id) === i);
    const warnings: string[] = [];
    const hit: SimHit = { chain, handledBy: listeners(rt, chainNodes) };
    const front = chainNodes[0];
    if (front) {
      hit.layerId = front.layerId;
      const name = layerName(rt, front.key, front.layerId);
      if (name !== undefined) hit.layerName = name;
      const { prefix, own } = splitKey(front.key);
      hit.key = own;
      if (prefix.length) hit.instancePath = prefix.join("/");
    }
    const intendedId = intended.kind === "layer" ? intended.layerId : undefined;
    const intendedText = intended.kind === "layer" ? intended.text.slice(1) : undefined;
    const at = `(${Math.round(point[0])}, ${Math.round(point[1])})`;
    if (!chain.length) {
      const candidates = interactiveLayers(rt)
        .map((id) => ({ id, node: findSceneNode(rt, [], id, undefined) }))
        .filter((c): c is { id: Id; node: SceneNode } => !!c.node)
        .map((c) => {
          const center = nodeCenter(c.node);
          return { id: c.id, center, d: Math.hypot(center[0] - point[0], center[1] - point[1]) };
        })
        .sort((a, b) => a.d - b.d);
      let warning = `Nothing at ${at} receives touches.`;
      if (intendedText)
        warning = `Layer "${intendedText}" didn't receive the touch at ${at}: it has Enabled off, opacity 0, Receives Touches off, or isn't visible there.`;
      if (candidates[0])
        warning += ` Nearest layer with a touch patch: "${candidates[0].id}" around (${Math.round(candidates[0].center[0])}, ${Math.round(candidates[0].center[1])}).`;
      warnings.push(warning);
    } else if (intendedId && !chain.includes(intendedId)) {
      warnings.push(
        `"${chain[0]}" sits in front of "${intendedText}" at ${at}, so it catches the touch (touches bubble to parents, not to layers behind). Turn off Receives Touches on "${chain[0]}", or group it with "${intendedText}".`,
      );
    }
    if (chain.length && !hit.handledBy.length)
      warnings.push(
        `No interaction patch listens to ${chain.map((id) => `"${id}"`).join(" or ")}, so the touch has no effect.`,
      );
    return { hit, warnings };
  };

  const pointer = (
    phase: "down" | "move" | "up" | "cancel" | "leave",
    p: readonly [number, number],
    pointerType: "mouse" | "touch" | "pen",
    atMs: number,
  ): InputEvent => ({
    kind: "pointer",
    phase,
    pointerId: 1,
    pointerType,
    x: p[0],
    y: p[1],
    timeStamp: atMs,
  });

  /** Validate high-level events and plan them as inputs that resolve when they fire. */
  const plan = (
    doc: SonobeDocument,
    fps: number,
    events: readonly SimEvent[],
  ): { planned: PlannedInput[]; reports: SimDispatchedEvent[]; endMs: number } => {
    const planned: PlannedInput[] = [];
    const reports: SimDispatchedEvent[] = [];
    let order = 0;
    let endMs = 0;
    const frameMs = 1000 / fps;
    const at = (atMs: number, fire: PlannedInput["fire"]) => {
      planned.push({ atMs: Math.max(0, atMs), order: order++, fire });
      endMs = Math.max(endMs, atMs);
    };
    const hitInto = (
      report: SimDispatchedEvent,
      rt: SonobeRuntime,
      point: [number, number],
      target: TargetSpec,
      keep: (warning: string) => boolean = () => true,
    ) => {
      report.point = point;
      const h = hitReport(rt, point, target);
      report.hit = h.hit;
      report.warnings.push(...h.warnings.filter(keep));
    };
    events.forEach((event, index) => {
      const start = Math.max(0, event.atMs ?? 0);
      const report: SimDispatchedEvent = { index, kind: event.kind, warnings: [] };
      reports.push(report);
      switch (event.kind) {
        case "tap":
        case "longPress": {
          const target = parseTarget(doc, event.target, `${event.kind} target`);
          const hold =
            event.kind === "tap"
              ? Math.max(frameMs, event.holdMs ?? TAP_HOLD_MS)
              : Math.max(frameMs, event.durationMs ?? LONG_PRESS_MS);
          let point: [number, number] | undefined;
          at(start, (rt, stepped) => {
            point = locate(rt, target, report, start, stepped);
            if (!point) return [];
            hitInto(report, rt, point, target);
            return [pointer("down", point, "touch", start)];
          });
          at(start + hold, () => (point ? [pointer("up", point, "touch", start + hold)] : []));
          break;
        }
        case "drag": {
          const fromTarget = parseTarget(doc, event.from, "drag from");
          const toTarget = parseTarget(doc, event.to, "drag to");
          const duration = Math.max(frameMs, event.durationMs ?? DRAG_MS);
          const steps = Math.max(1, Math.round(duration / frameMs));
          let from: [number, number] | undefined;
          let to: [number, number] | undefined;
          at(start, (rt, stepped) => {
            from = locate(rt, fromTarget, report, start, stepped);
            to = from ? locate(rt, toTarget, report, start, stepped) : undefined;
            if (!from || !to) {
              from = undefined;
              return [];
            }
            hitInto(report, rt, from, fromTarget);
            return [pointer("down", from, "touch", start)];
          });
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const ms = start + i * frameMs;
            at(ms, () =>
              from && to
                ? [
                    pointer(
                      "move",
                      [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
                      "touch",
                      ms,
                    ),
                  ]
                : [],
            );
          }
          if (event.release !== false) {
            const ms = start + steps * frameMs + frameMs;
            at(ms, () => (from && to ? [pointer("up", to, "touch", ms)] : []));
          }
          break;
        }
        case "hover": {
          const target = parseTarget(doc, event.target, "hover target");
          at(start, (rt, stepped) => {
            const point = locate(rt, target, report, start, stepped);
            if (!point) return [];
            hitInto(report, rt, point, target, (w) => !w.startsWith("No interaction patch"));
            return [pointer("move", point, "mouse", start)];
          });
          break;
        }
        case "leave":
          at(start, () => [
            {
              kind: "pointer",
              phase: "leave",
              pointerId: 1,
              pointerType: "mouse",
              x: -1,
              y: -1,
              timeStamp: start,
            },
          ]);
          break;
        case "scroll": {
          const target = parseTarget(doc, event.target, "scroll target");
          const dx = event.dx ?? 0;
          const dy = event.dy ?? 0;
          at(start, (rt, stepped) => {
            const point = locate(rt, target, report, start, stepped);
            if (!point) return [];
            hitInto(report, rt, point, target);
            // Scroll takes the wheel only while the pointer hovers its layer, like a real mouse.
            return [
              pointer("move", point, "mouse", start),
              { kind: "wheel", x: point[0], y: point[1], dx, dy },
            ];
          });
          break;
        }
        case "key": {
          const mods = {
            ...(event.shift ? { shift: true } : {}),
            ...(event.alt ? { alt: true } : {}),
            ...(event.meta ? { meta: true } : {}),
            ...(event.ctrl ? { ctrl: true } : {}),
          };
          const key = event.key;
          const phase = event.phase ?? "press";
          if (phase === "press" || phase === "down")
            at(start, () => [{ kind: "key", phase: "down", key, ...mods }]);
          if (phase === "press")
            at(start + frameMs, () => [{ kind: "key", phase: "up", key, ...mods }]);
          if (phase === "up") at(start, () => [{ kind: "key", phase: "up", key, ...mods }]);
          break;
        }
        case "text": {
          const e: InputEvent = { kind: "text", layerId: event.layer, value: event.value };
          at(start, () => [e]);
          break;
        }
        case "focus": {
          const e: InputEvent = { kind: "focus", layerId: event.layer, focused: event.focused };
          at(start, () => [e]);
          break;
        }
        case "submit": {
          const e: InputEvent = { kind: "submit", layerId: event.layer };
          at(start, () => [e]);
          break;
        }
        case "pointer": {
          const e = pointer(event.phase, [event.x, event.y], event.pointerType ?? "touch", start);
          if (event.pointerId !== undefined)
            (e as { pointerId: number }).pointerId = event.pointerId;
          report.point = [event.x, event.y];
          at(start, () => [e]);
          break;
        }
        case "orientation": {
          const e: InputEvent = { kind: "orientation", orientation: event.orientation };
          at(start, () => [e]);
          break;
        }
        case "deviceMotion": {
          const e: InputEvent = {
            kind: "deviceMotion",
            acceleration: event.acceleration,
            rotationRate: event.rotationRate,
          };
          at(start, () => [e]);
          break;
        }
        default:
          throw new HostError(
            "invalid_event",
            `Unknown event kind "${(event as { kind?: unknown }).kind}".`,
            {
              hint: "Kinds: tap, longPress, drag, hover, leave, scroll, key, text, focus, submit, pointer, orientation, deviceMotion.",
            },
          );
      }
    });
    planned.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
    return { planned, reports, endMs };
  };

  /** Fire every planned input due by `tMs`, in order. */
  const due = (
    rt: SonobeRuntime,
    planned: readonly PlannedInput[],
    cursor: { next: number },
    tMs: number,
    framesStepped: number,
  ): InputEvent[] => {
    const batch: InputEvent[] = [];
    while (cursor.next < planned.length && planned[cursor.next]!.atMs <= tMs + 1e-6)
      batch.push(...planned[cursor.next++]!.fire(rt, framesStepped));
    return batch;
  };

  const manager: SimulationManager = {
    async reset(resetOptions) {
      const existing = resetOptions.simId !== undefined ? require(resetOptions.simId) : undefined;
      const current = options.getDocument(existing?.docId ?? resetOptions.docId);
      const keep = resetOptions.keepOverrides === true;
      // A preset or knob values given here replace the session's, or with keepOverrides go over them:
      // a new preset replaces the kept one, and new values join the kept ones.
      let knobs = keep ? existing?.knobs : undefined;
      if (resetOptions.preset !== undefined || resetOptions.knobs !== undefined) {
        const resolved = resolveKnobOverride(current.doc, {
          ...(resetOptions.preset !== undefined ? { preset: resetOptions.preset } : {}),
          ...(resetOptions.knobs !== undefined ? { values: resetOptions.knobs } : {}),
        });
        if (!resolved.ok)
          throw new HostError(
            resolved.error.code,
            resolved.error.message,
            resolved.error.hint ? { hint: resolved.error.hint } : {},
          );
        knobs = knobs ? mergeKnobOverride(knobs, resolved.value) : resolved.value;
      }
      const kept = {
        overrides: keep && existing ? existing.overrides : [],
        dropped: keep && existing ? existing.dropped : [],
        knobs,
      };
      const cleared = !keep && existing ? existing.overrides : [];
      const doc = effectiveDoc(kept, current.doc);
      const seed = resetOptions.seed ?? existing?.seed ?? 1;
      const fps =
        resetOptions.fps ?? existing?.fps ?? ((current.doc.project.fps ?? 60) as 60 | 120);
      existing?.runtime.dispose();
      const runtimeOptions: RuntimeOptions = {
        registry: options.registry,
        deterministic: true,
        seed,
        fps,
        platform: {},
      };
      const runtime = createRuntime(doc, runtimeOptions);
      const simId = existing?.simId ?? `sim_${++counter}`;
      const session: Session = {
        simId,
        docId: current.docId,
        revision: current.revision,
        seed,
        fps,
        runtime,
        runtimeOptions,
        baseDoc: doc,
        log: [],
        loggedSteps: 0,
        logTruncated: false,
        pendingUpdate: false,
        reportedIssues: new Set(),
        lastUsed: ++clock,
        overrides: kept.overrides,
        dropped: kept.dropped,
        knobs: kept.knobs,
        overrideCount: existing?.overrideCount ?? 0,
      };
      advance(session, []);
      sessions.set(simId, session);
      if (sessions.size > maxSessions) {
        const oldest = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0]!;
        oldest.runtime.dispose();
        sessions.delete(oldest.simId);
      }
      const s = state(session);
      if (cleared.length) s.clearedOverrides = cleared.map(overrideInfo);
      // Against what the reset asked for: a preset or knob the person's document dropped is reported as dropped.
      const stopped = existing?.knobs ? knobsLeftOut(existing.knobs, knobs) : undefined;
      if (stopped) s.clearedKnobs = knobOverrideInfo(stopped, current.doc);
      return s;
    },

    async override(simId, request) {
      const session = require(simId);
      refresh(session);
      // The person's document as this session runs it: its knob preset and values, under the overrides.
      const personDoc = options.getDocument(session.docId).doc;
      const person = session.knobs ? withKnobOverride(personDoc, session.knobs) : personDoc;
      let next = [...session.overrides];
      const cleared: OverrideEntry[] = [];
      const clear = request.clear === "all" ? "all" : (request.clear ?? []);
      if (clear === "all") {
        cleared.push(...next);
        next = [];
      } else {
        for (const ref of clear) {
          const keys = overrideKeys(person, ref);
          const hits = next.filter((o) => o.id === ref || o.target === ref || keys.includes(o.key));
          if (!hits.length)
            throw new HostError("not_overridden", `"${ref}" has no override in ${simId}.`, {
              hint: next.length
                ? `Its overrides: ${next.map((o) => `${o.id} ${o.target}`).join(", ")}. Or clear "all".`
                : `${simId} has no overrides.`,
            });
          cleared.push(...hits);
          next = next.filter((o) => !hits.includes(o));
        }
      }
      let count = session.overrideCount;
      let applied: OverrideEntry[] = [];
      for (const entry of overrideEntries(person, request, options.registry)) {
        const previous = next.find((o) => o.key === entry.key);
        const full: OverrideEntry = { ...entry, id: previous?.id ?? `ov_${++count}` };
        next = [...next.filter((o) => o.key !== entry.key), full];
        applied = [...applied.filter((o) => o.key !== entry.key), full];
      }
      if (next.length > MAX_OVERRIDES)
        throw new HostError(
          "too_many_overrides",
          `A simulation holds up to ${MAX_OVERRIDES} overrides; this would make ${next.length}.`,
          { hint: 'Clear some first (clear: ["ov_1"], or "all").' },
        );
      // Check everything against the person's document before the session changes.
      const derived = applyOverrides(person, next, options.registry);
      const failure = derived.failed[0];
      if (failure)
        throw new HostError(
          failure.error.code,
          failure.error.message,
          failure.error.hint ? { hint: failure.error.hint } : {},
        );
      session.overrides = next;
      session.overrideCount = count;
      let s: SimState;
      if (request.restart) s = await manager.reset({ simId, keepOverrides: true });
      else {
        if (applied.length || cleared.length) swap(session, derived.doc);
        s = state(session);
      }
      const live = sessions.get(simId) ?? session;
      return {
        ...s,
        overrides: live.overrides.map(overrideInfo),
        applied: applied.map(overrideInfo),
        cleared: cleared.map(overrideInfo),
        restarted: request.restart === true,
      };
    },

    async dispatch(simId, events) {
      const session = require(simId);
      refresh(session);
      if (!events.length)
        throw new HostError("no_events", "sim_dispatch needs at least one event.", {
          hint: 'For example [{ "kind": "tap", "target": "@card" }].',
        });
      const { planned, reports } = plan(docOf(session), session.fps, events);
      const frameMs = 1000 / session.fps;
      const cursor = { next: 0 };
      let frames = 0;
      while (cursor.next < planned.length && frames < MAX_FRAMES_PER_CALL) {
        advance(session, due(session.runtime, planned, cursor, frames * frameMs, frames));
        frames++;
      }
      return { ...state(session), framesStepped: frames, events: reports };
    },

    async step(simId, stepOptions) {
      const session = require(simId);
      refresh(session);
      const frameMs = 1000 / session.fps;
      const watch = stepOptions.watch?.length ? stepOptions.watch : defaultWatch(session);
      for (const target of watch) checkTarget(session, target);
      const until = stepOptions.until;
      if (until !== undefined && until !== "idle") checkTarget(session, until.target);
      const rt = session.runtime;
      const before = new Map(watch.map((t) => [t, read(rt, t)]));
      let frames = 0;
      let settled = false;
      let timedOut = false;
      if (until === undefined) {
        const n =
          stepOptions.frames ??
          (stepOptions.ms !== undefined ? Math.round(stepOptions.ms / frameMs) : 1);
        if (!Number.isFinite(n) || n < 0)
          throw new HostError("invalid_value", "frames and ms must be positive numbers.");
        const count = Math.min(Math.floor(n), MAX_FRAMES_PER_CALL);
        for (; frames < count; frames++) advance(session, []);
        settled = !rt.needsNextFrame;
      } else {
        const maxFrames = Math.min(
          MAX_FRAMES_PER_CALL,
          Math.ceil((stepOptions.maxMs ?? DEFAULT_MAX_MS) / frameMs),
        );
        let stable = 0;
        let last = watch.map((t) => read(rt, t));
        while (frames < maxFrames) {
          advance(session, []);
          frames++;
          if (until === "idle") {
            const now = watch.map((t) => read(rt, t));
            stable =
              !rt.needsNextFrame && now.every((v, i) => sameValue(v, last[i])) ? stable + 1 : 0;
            last = now;
            if (stable >= 3) {
              settled = true;
              break;
            }
          } else if (comparePasses(rt.getValue(until.target), until.op, until.value)) {
            settled = true;
            break;
          }
        }
        timedOut = !settled;
      }
      const changed: SimChange[] = [];
      for (const target of watch) {
        const to = read(rt, target);
        const from = before.get(target);
        if (!sameValue(from, to)) changed.push({ target, from, to });
      }
      const result: SimStepResult = {
        ...state(session),
        framesStepped: frames,
        settled,
        timedOut,
        changed,
      };
      return result;
    },

    async trace(simId, traceOptions) {
      const session = require(simId);
      refresh(session);
      const targets = traceOptions.targets;
      if (!targets.length)
        throw new HostError("no_targets", "sim_trace needs at least one target.", {
          hint: 'For example ["@card.scale", "pop.output"].',
        });
      for (const target of targets) checkTarget(session, target);
      const durationMs = Math.max(0, Math.min(traceOptions.durationMs, 60_000));
      const { planned, reports } = plan(docOf(session), session.fps, traceOptions.events ?? []);
      const frameMs = 1000 / session.fps;
      const frameCount = Math.floor(durationMs / frameMs + 1e-9);
      const cursor = { next: 0 };
      /** Run the trace on `rt`, timing samples by frame count so a Restart Prototype can't make them run backwards. */
      const sample = (rt: SonobeRuntime, stepOnce: (batch: InputEvent[]) => void) => {
        const times: number[] = [];
        const raw: Record<string, unknown[]> = Object.fromEntries(
          targets.map((t) => [t, [] as unknown[]]),
        );
        for (let i = 1; i <= frameCount; i++) {
          stepOnce(due(rt, planned, cursor, i * frameMs, i - 1));
          times.push(i / session.fps);
          for (const target of targets) raw[target]!.push(rt.getValue(target));
        }
        return { times, raw };
      };
      let times: number[];
      let raw: Record<string, unknown[]>;
      let framesAfterTrace = 0;
      if (traceOptions.advance) {
        ({ times, raw } = sample(session.runtime, (batch) => advance(session, batch)));
        // Events can outlast the trace (a 900 ms drag in a 650 ms trace). The session keeps going until
        // they finish, like sim_dispatch, so it isn't left with a finger down.
        for (
          let i = frameCount + 1;
          cursor.next < planned.length && framesAfterTrace < MAX_FRAMES_PER_CALL;
          i++, framesAfterTrace++
        )
          advance(session, due(session.runtime, planned, cursor, i * frameMs, i - 1));
      } else if (!session.logTruncated) {
        const clone = replay(session);
        try {
          ({ times, raw } = sample(clone, (batch) => {
            if (batch.length) clone.dispatch(batch);
            clone.step();
          }));
        } finally {
          clone.dispose();
        }
      } else {
        // Past the replay budget there's no copy of the current state to trace. (The engine's own log
        // is shorter still, so its trace would start a restarted prototype and report wrong values.)
        throw new HostError(
          "sim_copy_unavailable",
          `Simulation "${simId}" has run too long to copy, so it can't trace without moving.`,
          { hint: "Pass advance: true to trace the simulation itself, or start again with sim_reset." },
        );
      }
      const summaries: Record<string, TraceSummary | null> = Object.fromEntries(
        targets.map((t) => [t, summarizeSeries(times, raw[t]! as never[])]),
      );
      const result: SimTraceResult = {
        ...state(session),
        events: reports,
        targets: [...targets],
        times: times.map((t) => Math.round(t * 100000) / 100),
        values: Object.fromEntries(targets.map((t) => [t, raw[t]!.map((v) => toJsonValue(v))])),
        summaries,
      };
      if (framesAfterTrace) result.framesAfterTrace = framesAfterTrace;
      return result;
    },

    async values(simId, targets) {
      const session = require(simId);
      refresh(session);
      if (!targets.length)
        throw new HostError("no_targets", "sim_get_values needs at least one target.", {
          hint: 'For example ["@card.scale", "toggle.on"].',
        });
      for (const target of targets) checkTarget(session, target);
      const values: Record<string, unknown> = {};
      const notes: Record<string, string> = {};
      for (const target of targets) {
        const seen = session.runtime.inspect(target);
        values[target] = toJsonValue(seen.value);
        const keys = session.overrides.length ? overrideKeys(docOf(session), target) : [];
        const o = session.overrides.find((x) => keys.includes(x.key));
        const overridden = o ? overrideNote(o, values[target]) : knobNote(session, target);
        // One note per target: the override clause, then the runtime's note (why the value reads
        // as nothing, or a short clause like "copy #0 of 4" that stays inline).
        const note =
          overridden && seen.note
            ? /[.!?]$/.test(seen.note)
              ? `${overridden[0]!.toUpperCase()}${overridden.slice(1)}. ${seen.note}`
              : `${overridden}; ${seen.note}`
            : (overridden ?? seen.note);
        if (note) notes[target] = note;
      }
      const out: SimValuesResult = {
        ...state(session),
        values,
        ...(Object.keys(notes).length ? { notes } : {}),
      };
      return out;
    },

    scene(simId) {
      const session = require(simId);
      refresh(session);
      return session.runtime.scene();
    },

    sceneAt(simId, atMs) {
      const session = require(simId);
      refresh(session);
      const frames = Math.max(0, Math.round((finiteMs(atMs) * session.fps) / 1000));
      if (frames === 0) return session.runtime.scene();
      if (session.logTruncated) {
        throw new HostError(
          "sim_copy_unavailable",
          `Simulation "${simId}" has run too long to copy, so it can't show a later frame without moving.`,
          { hint: "Advance it with sim_step, then take the screenshot without atMs." },
        );
      }
      const copy = replay(session);
      try {
        for (let i = 0; i < Math.min(frames, MAX_FRAMES_PER_CALL); i++) copy.step();
        return copy.scene();
      } finally {
        copy.dispose();
      }
    },

    previewScene(docId, previewOptions = {}) {
      const current = options.getDocument(docId);
      const fps = (current.doc.project.fps ?? 60) as 60 | 120;
      const runtime = createRuntime(current.doc, {
        registry: options.registry,
        deterministic: true,
        seed: 1,
        fps,
        platform: {},
      });
      try {
        runtime.step();
        let settled: boolean;
        if (previewOptions.atMs !== undefined) {
          const frames = Math.round((finiteMs(previewOptions.atMs) * fps) / 1000);
          for (let i = 0; i < Math.min(frames, MAX_FRAMES_PER_CALL); i++) runtime.step();
          settled = !runtime.needsNextFrame;
        } else {
          // Like sim_step until "idle": nothing animating for three frames in a row.
          const maxFrames = Math.min(
            MAX_FRAMES_PER_CALL,
            Math.ceil(((finiteMs(previewOptions.maxMs) || PREVIEW_SETTLE_MS) * fps) / 1000),
          );
          let stable = runtime.needsNextFrame ? 0 : 1;
          for (let i = 0; i < maxFrames && stable < 3; i++) {
            runtime.step();
            stable = runtime.needsNextFrame ? 0 : stable + 1;
          }
          settled = stable >= 3;
        }
        return { scene: runtime.scene(), settled };
      } finally {
        runtime.dispose();
      }
    },

    list(docId) {
      return [...sessions.values()]
        .filter((s) => docId === undefined || s.docId === docId)
        .map((s) => baseState(s));
    },

    closeDocument(docId) {
      for (const [id, s] of sessions) {
        if (s.docId !== docId) continue;
        s.runtime.dispose();
        sessions.delete(id);
      }
    },

    dispose() {
      for (const s of sessions.values()) s.runtime.dispose();
      sessions.clear();
    },
  };
  return manager;
}

/** A knob override as results report it, with the preset's name. */
function knobOverrideInfo(override: KnobOverride, doc: SonobeDocument): SimKnobOverride {
  const preset = override.preset;
  return {
    ...(preset !== undefined ? { preset: { id: preset, name: getKnobPreset(doc.knobs, preset)?.name ?? preset } } : {}),
    ...(override.values ? { values: { ...override.values } } : {}),
  };
}

/** `next` over `base`: its preset, if it has one, replaces base's, and its values join base's. */
function mergeKnobOverride(base: KnobOverride, next: KnobOverride): KnobOverride {
  const preset = next.preset ?? base.preset;
  const values = base.values || next.values ? { ...base.values, ...next.values } : undefined;
  return { ...(preset !== undefined ? { preset } : {}), ...(values ? { values } : {}) };
}

/**
 * What of `before` a reset stopped running: its preset when `after` runs none, and its values for
 * knobs `after` gives no value. A preset or value `after` names instead was asked for, so it's left out.
 */
function knobsLeftOut(before: KnobOverride, after: KnobOverride | undefined): KnobOverride | undefined {
  const out: KnobOverride = {};
  if (before.preset !== undefined && after?.preset === undefined) out.preset = before.preset;
  const values = Object.entries(before.values ?? {}).filter(([id]) => !Object.hasOwn(after?.values ?? {}, id));
  if (values.length) out.values = Object.fromEntries(values);
  return out.preset !== undefined || out.values ? out : undefined;
}

/**
 * A session's knob override against the person's newer document: a preset or knob it no longer has
 * (or a value its knob's new type refuses) drops out and is reported once.
 */
function keptKnobOverride(
  override: KnobOverride,
  doc: SonobeDocument,
  dropped: { target: string; reason: string }[],
): KnobOverride | undefined {
  const set = doc.knobs;
  const out: KnobOverride = {};
  if (override.preset !== undefined) {
    if (getKnobPreset(set, override.preset)) out.preset = override.preset;
    else
      dropped.push({
        target: `preset ${override.preset}`,
        reason: "the person's document no longer has that preset",
      });
  }
  const values: Record<Id, Literal> = {};
  for (const [id, value] of Object.entries(override.values ?? {})) {
    const knob = getKnob(set, id);
    if (knob && checkKnobLiteral(knob, value).ok) values[id] = value;
    else
      dropped.push({
        target: `$knob.${id}`,
        reason: knob ? `the knob holds ${knob.type} values now` : "the person's document no longer has that knob",
      });
  }
  if (Object.keys(values).length) out.values = values;
  return out.preset !== undefined || out.values ? out : undefined;
}

function allLayerIdsOf(layers: Parameters<typeof walkLayers>[0]): Id[] {
  const out: Id[] = [];
  walkLayers(layers, (l) => {
    out.push(l.id);
  });
  return out;
}
