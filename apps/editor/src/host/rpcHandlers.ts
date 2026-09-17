/**
 * RPC handlers the desktop MCP bridge calls to reach the live document: document info, read, apply
 * (with dry runs and optimistic concurrency), save, open; selection; viewer bounds for screenshots;
 * deterministic simulations; history; agent presence; and reveal. Errors are returned through
 * `rpc.fail(code, message, data)` because the context bridge strips Error properties.
 */

import { allLayerIds, findComponentInstances, getOutline, listComponentIds, serializeDocument, type Diagnostic, type Id, type OutlineDetail, type SonobeDocument } from "@sonobe/core";
import type { InputEvent, TraceInput } from "@sonobe/engine";
import type { Simulation } from "../runtime/simulation.ts";
import { CLAUDE_AUTHOR, normalizeAuthor } from "../state/document.ts";
import { diagnosticsFor } from "../state/registry.ts";
import { currentComponentId, itemKindOf } from "../state/selection.ts";
import type { EditorSession } from "../state/session.ts";
import type { RpcRegistrar } from "./types.ts";

export const RPC_METHODS = [
  "document.info",
  "document.get",
  "document.apply",
  "document.save",
  "document.open",
  "selection.get",
  "viewer.bounds",
  "sim.reset",
  "sim.dispatch",
  "sim.step",
  "sim.trace",
  "sim.values",
  "history.list",
  "history.undo",
  "presence.begin",
  "presence.finish",
  "reveal",
] as const;

export type RpcMethod = (typeof RPC_METHODS)[number];

export interface RpcHandlerOptions {
  /** Default: session.host.rpc. */
  rpc?: RpcRegistrar | null;
  /** Simulations kept at once (oldest are disposed). Default 8. */
  maxSimulations?: number;
  /** Longest sim.trace duration. Default 60 000 ms. */
  maxTraceMs?: number;
}

class RpcProblem extends Error {
  readonly code: string;
  readonly data: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.name = "RpcProblem";
    this.code = code;
    this.data = data;
  }
}

const invalid = (message: string, data?: unknown) => new RpcProblem("invalid_params", message, data);

type Params = Record<string, unknown>;

function asParams(params: unknown): Params {
  if (params === undefined || params === null) return {};
  if (typeof params !== "object" || Array.isArray(params)) throw invalid("Parameters must be an object.");
  return params as Params;
}

function optString(p: Params, key: string): string | undefined {
  const v = p[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw invalid(`"${key}" must be text.`);
  return v;
}

function optNumber(p: Params, key: string): number | undefined {
  const v = p[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw invalid(`"${key}" must be a number.`);
  return v;
}

function optBoolean(p: Params, key: string): boolean | undefined {
  const v = p[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw invalid(`"${key}" must be true or false.`);
  return v;
}

function stringList(p: Params, key: string, required: boolean): string[] {
  const v = p[key];
  if (v === undefined || v === null) {
    if (required) throw invalid(`"${key}" is required: a list of strings.`);
    return [];
  }
  if (!Array.isArray(v) || !v.every((item) => typeof item === "string")) throw invalid(`"${key}" must be a list of strings.`);
  return v as string[];
}

function eventList(value: unknown, key: string): InputEvent[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((e) => !!e && typeof e === "object" && typeof (e as { kind?: unknown }).kind === "string")) {
    throw invalid(`"${key}" must be a list of input events like { "kind": "pointer", "phase": "down", "pointerId": 1, "x": 200, "y": 300 }.`);
  }
  return value as InputEvent[];
}

function stepEvents(value: unknown): InputEvent[] | InputEvent[][] {
  if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) return value.map((frame, i) => eventList(frame, `events[${i}]`));
  return eventList(value, "events");
}

function traceEvents(value: unknown): TraceInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('"events" must be a list of events or { "atMs": number, "events": [...] } entries.');
  return value.map((entry, i) => {
    if (entry && typeof entry === "object" && "atMs" in entry) {
      const e = entry as { atMs?: unknown; events?: unknown };
      if (typeof e.atMs !== "number" || !Number.isFinite(e.atMs)) throw invalid(`events[${i}].atMs must be a number of milliseconds.`);
      return { atMs: e.atMs, events: eventList(e.events, `events[${i}].events`) };
    }
    return eventList([entry], `events[${i}]`)[0]!;
  });
}

/** Component path from the root to `componentId`, following instances. */
function componentPathTo(doc: SonobeDocument, componentId: Id): Id[] {
  const root = doc.project.root;
  const path: Id[] = [componentId];
  const seen = new Set<Id>([componentId]);
  let current = componentId;
  while (current !== root) {
    const container = findComponentInstances(doc, current).map((ref) => ref.componentId).find((id) => !seen.has(id));
    if (!container) return current === root ? path : [root, componentId];
    path.unshift(container);
    seen.add(container);
    current = container;
  }
  return path;
}

/** Register every RPC method. Returns a function that unregisters them and disposes simulations. */
export function registerRpcHandlers(session: EditorSession, options: RpcHandlerOptions = {}): () => void {
  const rpc = options.rpc === undefined ? session.host?.rpc ?? null : options.rpc;
  if (!rpc) return () => undefined;
  const maxSims = Math.max(1, options.maxSimulations ?? 8);
  const maxTraceMs = options.maxTraceMs ?? 60_000;
  const sims = new Map<string, Simulation>();
  const doc = () => session.document.getState();

  const getSim = (p: Params): Simulation => {
    const simId = optString(p, "simId");
    if (simId === undefined) {
      if (sims.size === 1) return sims.values().next().value!;
      throw invalid(sims.size ? '"simId" is required when several simulations exist.' : "There's no simulation yet. Call sim.reset first.", { simIds: [...sims.keys()] });
    }
    const sim = sims.get(simId);
    if (!sim) throw new RpcProblem("not_found", `There's no simulation "${simId}". Call sim.reset to start one.`, { simIds: [...sims.keys()] });
    return sim;
  };

  const info = () => {
    const s = doc();
    const d = s.doc;
    return {
      name: d.project.name,
      projectPath: s.projectPath,
      revision: s.revision,
      lastSavedRevision: s.lastSavedRevision,
      dirty: s.dirty,
      root: d.project.root,
      device: d.project.device,
      fps: d.project.fps ?? 60,
      currentComponent: session.currentComponentId(),
      components: listComponentIds(d).map((id) => {
        const c = d.components[id]!;
        return { id, name: c.name, kind: c.kind, layerCount: allLayerIds(c.layers).length, patchCount: Object.keys(c.patches).length, commentCount: c.comments.length };
      }),
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      playing: session.runtime.isPlaying(),
    };
  };

  const handlers: Record<RpcMethod, (p: Params) => unknown> = {
    "document.info": () => info(),

    "document.get": (p) => {
      const s = doc();
      const component = optString(p, "component");
      const format = optString(p, "format") ?? "json";
      if (component !== undefined && !s.doc.components[component]) throw new RpcProblem("not_found", `There's no component "${component}".`, { components: Object.keys(s.doc.components) });
      switch (format) {
        case "json":
          return component === undefined ? { revision: s.revision, document: s.doc } : { revision: s.revision, component: s.doc.components[component] };
        case "outline": {
          const detail = optString(p, "detail");
          if (detail !== undefined && detail !== "compact" && detail !== "normal" && detail !== "full") throw invalid('"detail" must be "compact", "normal", or "full".');
          return { revision: s.revision, outline: getOutline(s.doc, component, { registry: session.registry, ...(detail ? { detail: detail as OutlineDetail } : {}) }) };
        }
        case "files":
          return { revision: s.revision, files: serializeDocument(s.doc) };
        default:
          throw invalid('"format" must be "json", "outline", or "files".');
      }
    },

    "document.apply": (p) => {
      if (!Array.isArray(p.ops)) throw invalid('"ops" is required: a list of ops like [{ "op": "addLayer", "layer": { "type": "rectangle" } }].');
      const dryRun = optBoolean(p, "dryRun") ?? false;
      const expectedRevision = optNumber(p, "expectedRevision");
      const atomic = optBoolean(p, "atomic");
      const component = optString(p, "component");
      const label = optString(p, "label")?.trim() || `applied ${p.ops.length} op${p.ops.length === 1 ? "" : "s"}`;
      const result = doc().apply(p.ops, {
        label,
        author: normalizeAuthor(p.author, CLAUDE_AUTHOR),
        dryRun,
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
        ...(atomic !== undefined ? { atomic } : {}),
        ...(component !== undefined ? { defaultComponent: component } : {}),
      });
      const target = dryRun ? result.preview : result.doc;
      const touched = new Set(result.affected.components);
      const diagnostics: Diagnostic[] = target && touched.size ? diagnosticsFor(target, session.registry).filter((d) => touched.has(d.component)) : [];
      return {
        result: { ok: result.ok, results: result.results, errors: result.errors, idMap: result.idMap, affected: result.affected, applied: result.applied.length },
        revision: doc().revision,
        diagnostics,
      };
    },

    "document.save": async (p) => {
      const saveAs = optBoolean(p, "saveAs") ?? false;
      const result = saveAs || !doc().projectPath ? await doc().saveAs() : await doc().save();
      if (result.cancelled) return false;
      if (!result.ok) throw new RpcProblem("save_failed", result.error ?? "The prototype couldn't be saved.", { path: result.path, code: result.errorCode });
      return { ok: true, path: result.path ?? null, revision: doc().revision };
    },

    "document.open": async (p) => {
      const path = typeof p.path === "string" ? p.path : undefined;
      if (p.path !== undefined && path === undefined) throw invalid('"path" must be a project folder path.');
      const result = await session.openProject(path);
      if (result.cancelled) return { ok: false, cancelled: true };
      if (!result.ok) throw new RpcProblem("open_failed", result.error ?? "The project couldn't be opened.", { path: result.path, code: result.errorCode });
      return { ok: true, ...info() };
    },

    "selection.get": () => {
      const s = session.selection.getState();
      return { component: currentComponentId(s), componentPath: s.componentPath, layers: s.layers, patches: s.patches, comments: s.comments, focusedPanel: s.focusedPanel, hovered: s.hovered };
    },

    "viewer.bounds": () => {
      const bounds = session.runtime.viewerBounds();
      if (!bounds) throw new RpcProblem("no_viewer", "The viewer isn't showing, so there's nothing to capture.", { hint: "Show the Viewer panel (⌘2) and try again." });
      return bounds;
    },

    "sim.reset": (p) => {
      const simId = optString(p, "simId");
      const seed = optNumber(p, "seed");
      const fps = optNumber(p, "fps");
      if (fps !== undefined && fps !== 60 && fps !== 120) throw invalid('"fps" must be 60 or 120.');
      const current = doc().doc;
      const existing = simId !== undefined ? sims.get(simId) : undefined;
      if (existing) {
        return { ...existing.reset({ document: current, ...(seed !== undefined ? { seed } : {}), ...(fps !== undefined ? { fps: fps as 60 | 120 } : {}) }), revision: doc().revision };
      }
      const sim = session.runtime.createSimulation({ document: current, ...(seed !== undefined ? { seed } : {}), ...(fps !== undefined ? { fps: fps as 60 | 120 } : {}) });
      sims.set(sim.id, sim);
      while (sims.size > maxSims) {
        const [oldest, old] = sims.entries().next().value!;
        old.dispose();
        sims.delete(oldest);
      }
      return { ...sim.snapshot(), revision: doc().revision };
    },

    "sim.dispatch": (p) => {
      const sim = getSim(p);
      return { simId: sim.id, queued: sim.dispatch(eventList(p.events, "events")) };
    },

    "sim.step": (p) => {
      const sim = getSim(p);
      const frames = optNumber(p, "frames");
      const durationMs = optNumber(p, "durationMs");
      const targets = stringList(p, "targets", false);
      const snapshot = sim.step({ ...(frames !== undefined ? { frames } : {}), ...(durationMs !== undefined ? { durationMs } : {}), events: stepEvents(p.events) });
      return targets.length ? { ...snapshot, values: sim.values(targets).values } : snapshot;
    },

    "sim.trace": (p) => {
      const sim = getSim(p);
      const targets = stringList(p, "targets", true);
      const durationMs = optNumber(p, "durationMs");
      if (durationMs === undefined || durationMs < 0) throw invalid('"durationMs" is required: how long to simulate, in milliseconds.');
      if (durationMs > maxTraceMs) throw invalid(`Traces can be at most ${maxTraceMs} ms long.`);
      return { simId: sim.id, ...sim.trace(targets, durationMs, traceEvents(p.events)) };
    },

    "sim.values": (p) => {
      const sim = getSim(p);
      return { simId: sim.id, ...sim.values(stringList(p, "targets", true)) };
    },

    "history.list": (p) => {
      const limit = optNumber(p, "limit");
      const s = doc();
      return { revision: s.revision, canUndo: s.canUndo, canRedo: s.canRedo, entries: s.historyEntries(limit), redo: s.redoEntries(limit) };
    },

    "history.undo": (p) => {
      const txnId = optString(p, "txnId");
      const author = normalizeAuthor(p.author, CLAUDE_AUTHOR);
      const result = txnId !== undefined ? doc().undoTo(txnId, author) : doc().undo(author);
      if (!result.ok) {
        if (result.errors.length === 0) throw new RpcProblem("nothing_to_undo", "There's nothing to undo.");
        throw new RpcProblem(result.errors[0]!.code, result.errors[0]!.message, { errors: result.errors, revision: result.revision });
      }
      return { ok: true, revision: result.revision, undone: result.entries.map((e) => ({ txnId: e.txnId, label: e.label, author: e.author, opCount: e.ops.length })) };
    },

    "presence.begin": (p) => {
      const intent = optString(p, "intent")?.trim();
      if (!intent) throw invalid('"intent" is required: what you are about to do, in a few words.');
      const component = optString(p, "component");
      const workId = session.presence.getState().begin({ ids: stringList(p, "ids", false), intent, author: normalizeAuthor(p.author, CLAUDE_AUTHOR), ...(component !== undefined ? { component } : {}) });
      return { workId };
    },

    "presence.finish": (p) => {
      const workId = optString(p, "workId");
      const summary = optString(p, "summary");
      if (workId === undefined) {
        session.presence.getState().finishAll(p.author ? normalizeAuthor(p.author, CLAUDE_AUTHOR) : undefined);
        return { finished: true };
      }
      const item = session.presence.getState().finish(workId, { ...(summary ? { summary } : {}), revision: doc().revision });
      return { finished: item !== undefined };
    },

    reveal: (p) => {
      const ids = stringList(p, "ids", true);
      if (ids.length === 0) throw invalid('"ids" must name at least one layer, patch, or comment.');
      const d = doc().doc;
      let componentId = optString(p, "component");
      if (componentId === undefined) {
        const candidates = [session.currentComponentId(), ...listComponentIds(d)];
        componentId = candidates.find((id) => ids.some((item) => itemKindOf(d.components[id], item) !== undefined)) ?? session.currentComponentId();
      }
      const component = d.components[componentId];
      if (!component) throw new RpcProblem("not_found", `There's no component "${componentId}".`, { components: Object.keys(d.components) });
      const layers: Id[] = [];
      const patches: Id[] = [];
      const comments: Id[] = [];
      const missing: Id[] = [];
      for (const id of ids) {
        const kind = itemKindOf(component, id);
        if (kind === "layer") layers.push(id);
        else if (kind === "patch") patches.push(id);
        else if (kind === "comment") comments.push(id);
        else missing.push(id);
      }
      const selection = session.selection.getState();
      if (currentComponentId(selection) !== componentId) selection.setComponentPath(componentPathTo(d, componentId));
      session.selection.getState().select({ layers, patches, comments });
      const revealed = [...layers, ...patches, ...comments];
      if (revealed.length) session.selection.getState().requestReveal(componentId, revealed);
      return { component: componentId, componentPath: session.selection.getState().componentPath, revealed, missing };
    },
  };

  const unregister = RPC_METHODS.map((method) =>
    rpc.handle(method, async (params) => {
      try {
        return await handlers[method](asParams(params));
      } catch (err) {
        if (err instanceof RpcProblem) return rpc.fail(err.code, err.message, err.data);
        return rpc.fail("internal_error", err instanceof Error ? err.message : String(err));
      }
    }),
  );

  return () => {
    for (const off of unregister) off();
    for (const sim of sims.values()) sim.dispose();
    sims.clear();
  };
}
