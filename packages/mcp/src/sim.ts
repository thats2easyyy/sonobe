/**
 * Simulation sessions for sim_* tools: deterministic engine runtimes keyed by simId, high-level
 * gestures synthesized into InputEvents, hit reports that explain missed taps, stepping until
 * idle or a condition, and traces with summaries. Never mutates documents. Browser-safe.
 */

import {
  didYouMean,
  didYouMeanText,
  findLayer,
  getPatchSpec,
  parseAddress,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  walkLayers,
  isLayerInput,
  isLinkInput,
  type Id,
  type SonobeDocument,
} from "@sonobe/core";
import {
  createRuntime,
  summarizeSeries,
  type EngineRegistry,
  type InputEvent,
  type SceneNode,
  type ScheduledInput,
  type SonobeRuntime,
  type TraceSummary,
} from "@sonobe/engine";
import { toJsonValue } from "./format.ts";
import {
  HostError,
  type SimChange,
  type SimDispatchedEvent,
  type SimDispatchResult,
  type SimEvent,
  type SimHit,
  type SimHost,
  type SimIssue,
  type SimState,
  type SimStepResult,
  type SimTarget,
  type SimTraceResult,
  type SimValuesResult,
} from "./host.ts";

export interface SimulationManagerOptions {
  registry: EngineRegistry;
  /** Current document and revision (throws HostError when unknown). */
  getDocument(docId: Id | undefined): { docId: Id; doc: SonobeDocument; revision: number };
  /** Maximum open sessions; the oldest is dropped past it (default 8). */
  maxSessions?: number;
}

interface Session {
  simId: string;
  docId: Id;
  revision: number;
  seed: number;
  fps: 60 | 120;
  runtime: SonobeRuntime;
  reportedIssues: Set<string>;
  lastUsed: number;
}

const DEFAULT_MAX_MS = 10_000;
const MAX_FRAMES_PER_CALL = 120 * 60;
const TAP_HOLD_MS = 50;
const LONG_PRESS_MS = 600;
const DRAG_MS = 300;

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

function findSceneNode(
  runtime: SonobeRuntime,
  layerId: Id,
  instance: number | undefined,
): SceneNode | undefined {
  const scene = runtime.scene();
  const want = instance === undefined ? undefined : `${layerId}#${instance}`;
  let first: SceneNode | undefined;
  for (const node of walkScene(scene.roots)) {
    if (node.layerId !== layerId) continue;
    if (want !== undefined) {
      if (node.key === want || node.key.endsWith(`/${want}`)) return node;
      continue;
    }
    if (node.key === layerId || node.key === `${layerId}#0`) return node;
    first ??= node;
  }
  return first;
}

const LAYER_TARGET = /^@([A-Za-z_][A-Za-z0-9_]*)(?:#(\d+))?$/;

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

export interface SimulationManager extends SimHost {
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

  /** Hot-swap the document when it changed since the session last looked, and step one frame so layout and hit tests see the edits. */
  const refresh = (session: Session): boolean => {
    const current = options.getDocument(session.docId);
    if (current.revision === session.revision) return false;
    session.runtime.updateDocument(current.doc);
    session.runtime.step();
    session.revision = current.revision;
    return true;
  };

  const newIssues = (session: Session): SimIssue[] => {
    const out: SimIssue[] = [];
    for (const issue of session.runtime.issues()) {
      const key = `${issue.code}|${issue.patchId ?? ""}|${issue.layerId ?? ""}|${issue.message}`;
      if (session.reportedIssues.has(key)) continue;
      session.reportedIssues.add(key);
      out.push({ ...issue });
    }
    return out;
  };

  const state = (session: Session, documentUpdated: boolean): SimState => {
    const s: SimState = {
      simId: session.simId,
      docId: session.docId,
      frame: Math.max(0, session.runtime.frame),
      timeMs: Math.round(session.runtime.time * 100000) / 100,
      fps: session.fps,
      seed: session.seed,
      issues: newIssues(session),
    };
    if (documentUpdated) s.documentUpdated = true;
    return s;
  };

  const docOf = (session: Session) => session.runtime.document;

  /** Validate a value address against the root component. */
  const checkTarget = (session: Session, address: string): void => {
    const doc = docOf(session);
    const root = doc.components[doc.project.root];
    const parsed = parseAddress(address);
    if (!parsed || (parsed.kind !== "patch" && parsed.kind !== "layer")) {
      throw new HostError(
        "invalid_address",
        `"${address}" isn't a value the simulation can read.`,
        {
          hint: 'Read patch ports as "patchId.port" and layer properties as "@layerId.prop"; append "#2" for one loop copy, e.g. "@row.position#2".',
        },
      );
    }
    if (!root)
      throw new HostError("missing_root", "The document has no root component to simulate.");
    const elsewhere = (id: Id) =>
      Object.values(doc.components).find(
        (c) => c.id !== root.id && (id in c.patches || findLayer(c.layers, id)),
      );
    if (parsed.kind === "patch") {
      const node = root.patches[parsed.id];
      if (!node) {
        const other = elsewhere(parsed.id);
        throw new HostError(
          "not_found",
          other
            ? `"${parsed.id}" lives inside component "${other.id}"; the simulation reads the root component only.`
            : `There's no patch "${parsed.id}" in ${root.id}.${didYouMeanText(didYouMean(parsed.id, Object.keys(root.patches)))}`,
          {
            hint: other
              ? "Publish the value as a component output and read it from the instance."
              : findLayer(root.layers, parsed.id)
                ? `"${parsed.id}" is a layer; write "@${parsed.id}.${parsed.key}".`
                : undefined,
          },
        );
      }
      const ports = resolveNodePorts(doc, node, options.registry);
      const keys = ports ? [...ports.outputs, ...ports.inputs].map((p) => p.key) : [];
      if (ports && !keys.includes(parsed.key)) {
        throw new HostError(
          "unknown_port",
          `The ${getPatchSpec(options.registry, node.type)?.name ?? node.type} patch "${parsed.id}" has no port "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, keys))}`,
          {
            hint: `Outputs: ${ports.outputs.map((p) => p.key).join(", ") || "(none)"}. Inputs: ${ports.inputs.map((p) => p.key).join(", ") || "(none)"}.`,
          },
        );
      }
      return;
    }
    const loc = findLayer(root.layers, parsed.id);
    if (!loc) {
      const other = elsewhere(parsed.id);
      throw new HostError(
        "not_found",
        other
          ? `Layer "${parsed.id}" lives inside component "${other.id}"; the simulation reads the root component only.`
          : `There's no layer "${parsed.id}" in ${root.id}.${didYouMeanText(didYouMean(parsed.id, allLayerIdsOf(root.layers)))}`,
        {
          hint: root.patches[parsed.id]
            ? `"${parsed.id}" is a patch; write "${parsed.id}.${parsed.key}".`
            : undefined,
        },
      );
    }
    const props = resolveLayerProps(doc, root.id, loc.layer, options.registry) ?? [];
    const outputs = resolveLayerOutputs(doc, root.id, loc.layer, options.registry);
    const keys = [...props, ...outputs].map((p) => p.key);
    if (!keys.includes(parsed.key)) {
      throw new HostError(
        "unknown_prop",
        `Layer "${parsed.id}" (${loc.layer.type}) has no property "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, keys))}`,
      );
    }
  };

  const read = (session: Session, target: string): unknown =>
    toJsonValue(session.runtime.getValue(target));

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

  const resolvePoint = (
    session: Session,
    target: SimTarget,
    label: string,
  ): { point: [number, number]; layerId?: Id; instance?: number } => {
    if (Array.isArray(target)) {
      if (target.length !== 2 || !target.every((n) => typeof n === "number" && Number.isFinite(n)))
        throw new HostError("invalid_target", `${label} must be "@layerId" or [x, y].`);
      return { point: [target[0], target[1]] };
    }
    const m = LAYER_TARGET.exec(typeof target === "string" ? target.trim() : "");
    if (!m)
      throw new HostError(
        "invalid_target",
        `${label} "${String(target)}" isn't a layer or a point.`,
        { hint: 'Use "@card", "@row#2" for a loop copy, or [x, y] in prototype points.' },
      );
    const layerId = m[1]!;
    const instance = m[2] === undefined ? undefined : Number(m[2]);
    const doc = docOf(session);
    const root = doc.components[doc.project.root];
    if (!root || !findLayer(root.layers, layerId)) {
      throw new HostError(
        "not_found",
        `There's no layer "${layerId}" to touch.${didYouMeanText(didYouMean(layerId, root ? allLayerIdsOf(root.layers) : []))}`,
      );
    }
    const node = findSceneNode(session.runtime, layerId, instance);
    if (!node) {
      throw new HostError(
        "layer_not_rendered",
        `Layer "${layerId}"${instance !== undefined ? ` copy #${instance}` : ""} isn't in the current frame, so there's nothing to touch.`,
        {
          hint: "It may have Enabled off, sit inside a disabled group, or its loop may have fewer copies. Check with sim_get_values on @layer.enabled, or tap a point instead.",
        },
      );
    }
    const out: { point: [number, number]; layerId?: Id; instance?: number } = {
      point: nodeCenter(node),
      layerId,
    };
    if (instance !== undefined) out.instance = instance;
    return out;
  };

  const layerName = (session: Session, id: Id): string | undefined => {
    const doc = docOf(session);
    const root = doc.components[doc.project.root];
    return root ? findLayer(root.layers, id)?.layer.name : undefined;
  };

  /** Interaction-category patches bound to a layer in `chain` or to the whole screen. */
  const listeners = (session: Session, chain: readonly Id[]): Id[] => {
    const doc = docOf(session);
    const root = doc.components[doc.project.root];
    if (!root) return [];
    const out: Id[] = [];
    for (const [id, node] of Object.entries(root.patches)) {
      const spec = getPatchSpec(options.registry, node.type);
      if (spec?.category !== "interaction") continue;
      const layerPorts = spec.inputs.filter((p) => p.type === "layer");
      if (!layerPorts.length) continue;
      const bound = layerPorts.map((p) => node.inputs[p.key]).filter(isLayerInput);
      if (!bound.length ? true : bound.some((b) => chain.includes(b.layer))) out.push(id);
    }
    return out.sort();
  };

  const interactiveLayers = (session: Session): Id[] => {
    const doc = docOf(session);
    const root = doc.components[doc.project.root];
    if (!root) return [];
    const ids = new Set<Id>();
    for (const node of Object.values(root.patches)) {
      if (getPatchSpec(options.registry, node.type)?.category !== "interaction") continue;
      for (const value of Object.values(node.inputs)) if (isLayerInput(value)) ids.add(value.layer);
    }
    return [...ids];
  };

  const hitReport = (
    session: Session,
    point: [number, number],
    intended: Id | undefined,
  ): { hit: SimHit; warnings: string[] } => {
    const chainNodes = session.runtime.hitTest(point[0], point[1]);
    const chain = chainNodes.map((n) => n.layerId).filter((id, i, a) => a.indexOf(id) === i);
    const warnings: string[] = [];
    const hit: SimHit = { chain, handledBy: listeners(session, chain) };
    if (chain[0] !== undefined) {
      hit.layerId = chain[0];
      const name = layerName(session, chain[0]);
      if (name !== undefined) hit.layerName = name;
    }
    const at = `(${Math.round(point[0])}, ${Math.round(point[1])})`;
    if (!chain.length) {
      const candidates = interactiveLayers(session)
        .map((id) => ({ id, node: findSceneNode(session.runtime, id, undefined) }))
        .filter((c): c is { id: Id; node: SceneNode } => !!c.node)
        .map((c) => ({
          id: c.id,
          center: nodeCenter(c.node),
          d: Math.hypot(nodeCenter(c.node)[0] - point[0], nodeCenter(c.node)[1] - point[1]),
        }))
        .sort((a, b) => a.d - b.d);
      let warning = `Nothing at ${at} receives touches.`;
      if (intended)
        warning = `Layer "${intended}" didn't receive the touch at ${at}: it has opacity 0, Receives Touches off, or isn't visible there.`;
      if (candidates[0])
        warning += ` Nearest layer with a touch patch: "${candidates[0].id}" around (${Math.round(candidates[0].center[0])}, ${Math.round(candidates[0].center[1])}).`;
      warnings.push(warning);
    } else if (intended && !chain.includes(intended)) {
      warnings.push(
        `"${chain[0]}" sits in front of "${intended}" at ${at}, so it catches the touch (touches bubble to parents, not to layers behind). Turn off Receives Touches on "${chain[0]}", or group it with "${intended}".`,
      );
    }
    if (chain.length && !hit.handledBy.length)
      warnings.push(
        `No interaction patch listens to ${chain.map((id) => `"${id}"`).join(" or ")}, so the touch has no effect.`,
      );
    return { hit, warnings };
  };

  /** Compile high-level events into frame-scheduled input plus per-event reports. */
  const compile = (
    session: Session,
    events: readonly SimEvent[],
  ): {
    schedule: { atMs: number; order: number; events: InputEvent[] }[];
    reports: SimDispatchedEvent[];
    endMs: number;
  } => {
    const schedule: { atMs: number; order: number; events: InputEvent[] }[] = [];
    const reports: SimDispatchedEvent[] = [];
    let order = 0;
    let endMs = 0;
    const frameMs = 1000 / session.fps;
    const push = (atMs: number, ...evs: InputEvent[]) => {
      schedule.push({ atMs: Math.max(0, atMs), order: order++, events: evs });
      endMs = Math.max(endMs, atMs);
    };
    const pointer = (
      phase: "down" | "move" | "up" | "cancel" | "leave",
      p: [number, number],
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
    events.forEach((event, index) => {
      const at = Math.max(0, event.atMs ?? 0);
      const report: SimDispatchedEvent = { index, kind: event.kind, warnings: [] };
      switch (event.kind) {
        case "tap":
        case "longPress": {
          const r = resolvePoint(session, event.target, `${event.kind} target`);
          const hold =
            event.kind === "tap"
              ? Math.max(frameMs, event.holdMs ?? TAP_HOLD_MS)
              : Math.max(frameMs, event.durationMs ?? LONG_PRESS_MS);
          push(at, pointer("down", r.point, "touch", at));
          push(at + hold, pointer("up", r.point, "touch", at + hold));
          report.point = r.point;
          const h = hitReport(session, r.point, r.layerId);
          report.hit = h.hit;
          report.warnings.push(...h.warnings);
          break;
        }
        case "drag": {
          const from = resolvePoint(session, event.from, "drag from");
          const to = resolvePoint(session, event.to, "drag to");
          const duration = Math.max(frameMs, event.durationMs ?? DRAG_MS);
          const steps = Math.max(1, Math.round(duration / frameMs));
          push(at, pointer("down", from.point, "touch", at));
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const p: [number, number] = [
              from.point[0] + (to.point[0] - from.point[0]) * t,
              from.point[1] + (to.point[1] - from.point[1]) * t,
            ];
            push(at + i * frameMs, pointer("move", p, "touch", at + i * frameMs));
          }
          if (event.release !== false)
            push(
              at + steps * frameMs + frameMs,
              pointer("up", to.point, "touch", at + steps * frameMs + frameMs),
            );
          report.point = from.point;
          const h = hitReport(session, from.point, from.layerId);
          report.hit = h.hit;
          report.warnings.push(...h.warnings);
          break;
        }
        case "hover": {
          const r = resolvePoint(session, event.target, "hover target");
          push(at, pointer("move", r.point, "mouse", at));
          report.point = r.point;
          const h = hitReport(session, r.point, r.layerId);
          report.hit = h.hit;
          report.warnings.push(...h.warnings.filter((w) => !w.startsWith("No interaction patch")));
          break;
        }
        case "leave":
          push(at, {
            kind: "pointer",
            phase: "leave",
            pointerId: 1,
            pointerType: "mouse",
            x: -1,
            y: -1,
            timeStamp: at,
          });
          break;
        case "scroll": {
          const r = resolvePoint(session, event.target, "scroll target");
          push(at, {
            kind: "wheel",
            x: r.point[0],
            y: r.point[1],
            dx: event.dx ?? 0,
            dy: event.dy ?? 0,
          });
          report.point = r.point;
          break;
        }
        case "key": {
          const mods = {
            ...(event.shift ? { shift: true } : {}),
            ...(event.alt ? { alt: true } : {}),
            ...(event.meta ? { meta: true } : {}),
            ...(event.ctrl ? { ctrl: true } : {}),
          };
          const phase = event.phase ?? "press";
          if (phase === "press" || phase === "down")
            push(at, { kind: "key", phase: "down", key: event.key, ...mods });
          if (phase === "press")
            push(at + frameMs, { kind: "key", phase: "up", key: event.key, ...mods });
          if (phase === "up") push(at, { kind: "key", phase: "up", key: event.key, ...mods });
          break;
        }
        case "text":
          push(at, { kind: "text", layerId: event.layer, value: event.value });
          break;
        case "focus":
          push(at, { kind: "focus", layerId: event.layer, focused: event.focused });
          break;
        case "submit":
          push(at, { kind: "submit", layerId: event.layer });
          break;
        case "pointer":
          push(at, {
            kind: "pointer",
            phase: event.phase,
            pointerId: event.pointerId ?? 1,
            pointerType: event.pointerType ?? "touch",
            x: event.x,
            y: event.y,
            timeStamp: at,
          });
          report.point = [event.x, event.y];
          break;
        case "orientation":
          push(at, { kind: "orientation", orientation: event.orientation });
          break;
        case "deviceMotion":
          push(at, {
            kind: "deviceMotion",
            acceleration: event.acceleration,
            rotationRate: event.rotationRate,
          });
          break;
        default:
          throw new HostError(
            "invalid_event",
            `Unknown event kind "${(event as { kind?: unknown }).kind}".`,
            {
              hint: "Kinds: tap, longPress, drag, hover, leave, scroll, key, text, focus, submit, pointer, orientation, deviceMotion.",
            },
          );
      }
      reports.push(report);
    });
    schedule.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
    return { schedule, reports, endMs };
  };

  const manager: SimulationManager = {
    async reset(resetOptions) {
      const existing = resetOptions.simId !== undefined ? require(resetOptions.simId) : undefined;
      const current = options.getDocument(existing?.docId ?? resetOptions.docId);
      const seed = resetOptions.seed ?? existing?.seed ?? 1;
      const fps =
        resetOptions.fps ?? existing?.fps ?? ((current.doc.project.fps ?? 60) as 60 | 120);
      existing?.runtime.dispose();
      const runtime = createRuntime(current.doc, {
        registry: options.registry,
        deterministic: true,
        seed,
        fps,
        platform: {},
      });
      runtime.step();
      const simId = existing?.simId ?? `sim_${++counter}`;
      const session: Session = {
        simId,
        docId: current.docId,
        revision: current.revision,
        seed,
        fps,
        runtime,
        reportedIssues: new Set(),
        lastUsed: ++clock,
      };
      sessions.set(simId, session);
      if (sessions.size > maxSessions) {
        const oldest = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0]!;
        oldest.runtime.dispose();
        sessions.delete(oldest.simId);
      }
      return state(session, false);
    },

    async dispatch(simId, events) {
      const session = require(simId);
      const updated = refresh(session);
      if (!events.length)
        throw new HostError("no_events", "sim_dispatch needs at least one event.", {
          hint: 'For example [{ "kind": "tap", "target": "@card" }].',
        });
      const { schedule, reports } = compile(session, events);
      const frameMs = 1000 / session.fps;
      let frames = 0;
      let next = 0;
      while (next < schedule.length && frames < MAX_FRAMES_PER_CALL) {
        const tMs = frames * frameMs;
        const batch: InputEvent[] = [];
        while (next < schedule.length && schedule[next]!.atMs <= tMs + 1e-6)
          batch.push(...schedule[next++]!.events);
        if (batch.length) session.runtime.dispatch(batch);
        session.runtime.step();
        frames++;
      }
      return { ...state(session, updated), framesStepped: frames, events: reports };
    },

    async step(simId, stepOptions) {
      const session = require(simId);
      const updated = refresh(session);
      const frameMs = 1000 / session.fps;
      const watch = stepOptions.watch?.length ? stepOptions.watch : defaultWatch(session);
      for (const target of watch) checkTarget(session, target);
      const until = stepOptions.until;
      if (until !== undefined && until !== "idle") checkTarget(session, until.target);
      const before = new Map(watch.map((t) => [t, read(session, t)]));
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
        for (; frames < count; frames++) session.runtime.step();
        settled = !session.runtime.needsNextFrame;
      } else {
        const maxFrames = Math.min(
          MAX_FRAMES_PER_CALL,
          Math.ceil((stepOptions.maxMs ?? DEFAULT_MAX_MS) / frameMs),
        );
        let stable = 0;
        let last = watch.map((t) => read(session, t));
        while (frames < maxFrames) {
          session.runtime.step();
          frames++;
          if (until === "idle") {
            const now = watch.map((t) => read(session, t));
            stable =
              !session.runtime.needsNextFrame && now.every((v, i) => sameValue(v, last[i]))
                ? stable + 1
                : 0;
            last = now;
            if (stable >= 3) {
              settled = true;
              break;
            }
          } else if (comparePasses(session.runtime.getValue(until.target), until.op, until.value)) {
            settled = true;
            break;
          }
        }
        timedOut = !settled;
      }
      const changed: SimChange[] = [];
      for (const target of watch) {
        const to = read(session, target);
        const from = before.get(target);
        if (!sameValue(from, to)) changed.push({ target, from, to });
      }
      const result: SimStepResult = {
        ...state(session, updated),
        framesStepped: frames,
        settled,
        timedOut,
        changed,
      };
      return result;
    },

    async trace(simId, traceOptions) {
      const session = require(simId);
      const updated = refresh(session);
      if (!traceOptions.targets.length)
        throw new HostError("no_targets", "sim_trace needs at least one target.", {
          hint: 'For example ["@card.scale", "pop.output"].',
        });
      for (const target of traceOptions.targets) checkTarget(session, target);
      const durationMs = Math.max(0, Math.min(traceOptions.durationMs, 60_000));
      const { schedule, reports } = compile(session, traceOptions.events ?? []);
      let times: number[];
      let values: Record<string, unknown[]>;
      let summaries: Record<string, TraceSummary | null>;
      if (traceOptions.advance) {
        const frameMs = 1000 / session.fps;
        const frames = Math.floor(durationMs / frameMs + 1e-9);
        const start = session.runtime.time;
        times = [];
        values = Object.fromEntries(traceOptions.targets.map((t) => [t, [] as unknown[]]));
        const raw: Record<string, unknown[]> = Object.fromEntries(
          traceOptions.targets.map((t) => [t, [] as unknown[]]),
        );
        let next = 0;
        for (let i = 1; i <= frames; i++) {
          const tMs = i * frameMs;
          const batch: InputEvent[] = [];
          while (next < schedule.length && schedule[next]!.atMs <= tMs + 1e-6)
            batch.push(...schedule[next++]!.events);
          if (batch.length) session.runtime.dispatch(batch);
          session.runtime.step();
          times.push(session.runtime.time - start);
          for (const target of traceOptions.targets)
            raw[target]!.push(session.runtime.getValue(target));
        }
        summaries = Object.fromEntries(
          traceOptions.targets.map((t) => [t, summarizeSeries(times, raw[t]! as never[])]),
        );
        for (const target of traceOptions.targets)
          values[target] = raw[target]!.map((v) => toJsonValue(v));
      } else {
        const scheduled: ScheduledInput[] = schedule.map((s) => ({
          atMs: s.atMs,
          events: s.events,
        }));
        const r = session.runtime.trace(traceOptions.targets, durationMs, scheduled);
        times = r.times;
        summaries = r.summaries;
        values = Object.fromEntries(
          Object.entries(r.values).map(([k, list]) => [k, list.map((v) => toJsonValue(v))]),
        );
      }
      const result: SimTraceResult = {
        ...state(session, updated),
        events: reports,
        targets: [...traceOptions.targets],
        times: times.map((t) => Math.round(t * 100000) / 100),
        values,
        summaries,
      };
      return result;
    },

    async values(simId, targets) {
      const session = require(simId);
      const updated = refresh(session);
      if (!targets.length)
        throw new HostError("no_targets", "sim_get_values needs at least one target.", {
          hint: 'For example ["@card.scale", "toggle.on"].',
        });
      for (const target of targets) checkTarget(session, target);
      const out: SimValuesResult = {
        ...state(session, updated),
        values: Object.fromEntries(targets.map((t) => [t, read(session, t)])),
      };
      return out;
    },

    list(docId) {
      return [...sessions.values()]
        .filter((s) => docId === undefined || s.docId === docId)
        .map((s) => ({
          simId: s.simId,
          docId: s.docId,
          frame: Math.max(0, s.runtime.frame),
          timeMs: Math.round(s.runtime.time * 100000) / 100,
          fps: s.fps,
          seed: s.seed,
          issues: [],
        }));
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

function allLayerIdsOf(layers: Parameters<typeof walkLayers>[0]): Id[] {
  const out: Id[] = [];
  walkLayers(layers, (l) => {
    out.push(l.id);
  });
  return out;
}
