/** Shared state and helpers for op handlers. */

import { didYouMean, didYouMeanText } from "../suggest.ts";
import { fileNameKey, getOwn, ID_PATTERN, isValidId, slugify, uniqueId } from "../ids.ts";
import { liveItemIds, type SeenIds } from "../idLedger.ts";
import { allLayerIds, findLayer, type LayerLocation } from "../registry.ts";
import type { ApplyOptions, ApplyResult, Component, Id, Op, OpKind, PatchNode, Registry, SonobeDocument, SonobeError } from "../types.ts";
import { makeError, type Check, type ValidateOptions } from "../validate.ts";
import { isLayerInput, isLinkInput } from "../values.ts";

export type OpOf<K extends OpKind> = Extract<Op, { op: K }>;

export interface ApplyOpsOptions extends ApplyOptions {
  /**
   * Skip registry checks (unknown types/ports, type mismatches, literal shapes).
   * Use when applying inverse ops for undo/redo so documents that already carried
   * diagnostics restore exactly.
   */
  lenient?: boolean;
  /** Ids that must never be assigned to new items (e.g. soft-deleted items in the trash). */
  reservedIds?: Iterable<Id>;
  /**
   * The ids the host session has seen (an IdLedger, ARCHITECTURE §3.2). An id seen in a component
   * that isn't live there when the batch starts is retired: a derived id skips it (OpResult.retired
   * says so) and an explicit id fails with id_retired. A batch may still remove an item and add a new
   * one under its id. Component ids retire the same way, ignoring case. Not checked when lenient.
   */
  seenIds?: SeenIds;
}

export interface ApplyOpsResult extends ApplyResult {
  /** The successfully applied ops with refs resolved and generated ids filled in (safe to re-apply for redo). */
  applied: Op[];
  /** dryRun only: the document the batch would produce. */
  preview?: SonobeDocument;
}

/** Thrown by handlers to abort the current op with a human-first error. */
export class OpFailure extends Error {
  readonly error: SonobeError;

  constructor(error: SonobeError) {
    super(error.message);
    this.name = "OpFailure";
    this.error = error;
  }
}

/**
 * Thrown when an op names a "$ref" that another op in the same batch defines but hasn't run yet.
 * applyOps catches it and runs the op again once that item exists, so refs resolve in any order.
 */
export class PendingRef extends Error {
  /** The ref name without "$". */
  readonly ref: string;

  constructor(ref: string) {
    super(`Waiting for "$${ref}".`);
    this.name = "PendingRef";
    this.ref = ref;
  }
}

export function fail(code: string, message: string, extra: Partial<Omit<SonobeError, "code" | "message">> = {}): never {
  throw new OpFailure(makeError(code, message, extra));
}

export function unwrap<T>(check: Check<T>): T {
  if (!check.ok) throw new OpFailure(check.error);
  return check.value;
}

export interface AffectedSets {
  components: Set<Id>;
  layers: Set<Id>;
  patches: Set<Id>;
}

export const newAffected = (): AffectedSets => ({ components: new Set(), layers: new Set(), patches: new Set() });

export interface OpContext {
  doc: SonobeDocument;
  readonly registry: Registry;
  readonly lenient: boolean;
  readonly validate: ValidateOptions;
  readonly defaultComponent: Id | undefined;
  /** Ref name (without "$") → id, from ops in the batch that already ran. */
  readonly refs: Map<string, Id>;
  /** Refs defined by the op being applied; merged into `refs` when it succeeds. */
  pendingRefs: Map<string, { given: string; id: Id }>;
  /** Every ref some op in the batch defines (name without "$") → the index of that op. */
  readonly batchRefs: Map<string, number>;
  readonly reserved: ReadonlySet<Id>;
  /** True when `id` was seen in `component` this session but isn't live there at the batch start. */
  readonly retiredItem: (component: Id, id: Id) => boolean;
  /** True when a component id (ignoring case) was seen this session but isn't live at the batch start. */
  readonly retiredComponent: (id: Id) => boolean;
  /** Item ids live in `component` at the batch start. */
  readonly startIds: (component: Id) => ReadonlySet<Id>;
  /** Derived ids the current op gave a suffix, and why (see OpResult.retired and OpResult.suffixed). */
  renamed: RenamedIds;
  affected: AffectedSets;
}

export interface RenamedIds {
  /** New id → the retired id it would have had. */
  retired: Record<Id, Id>;
  /** New id → the id an item created earlier in the batch took. */
  suffixed: Record<Id, Id>;
}

export const newRenamed = (): RenamedIds => ({ retired: {}, suffixed: {} });

export interface OpOutcome {
  inverse: Op[];
  /** The op as applied, followed by any ops it caused (receivers following a renamed broadcaster). */
  applied: Op | Op[];
  ids: Id[];
}

/** An outcome's applied ops as a list. */
export const appliedOps = (outcome: Pick<OpOutcome, "applied">): Op[] => (Array.isArray(outcome.applied) ? outcome.applied : [outcome.applied]);

export function createContext(doc: SonobeDocument, options: ApplyOpsOptions): OpContext {
  const lenient = !!options.lenient;
  return {
    doc,
    registry: options.registry,
    lenient,
    validate: { registry: options.registry, lenient },
    defaultComponent: options.defaultComponent,
    refs: new Map(),
    pendingRefs: new Map(),
    batchRefs: new Map(),
    reserved: new Set(options.reservedIds ?? []),
    ...retirement(doc, lenient ? undefined : options.seenIds),
    renamed: newRenamed(),
    affected: newAffected(),
  };
}

const NO_IDS: ReadonlySet<Id> = new Set();

/** Retired-id checks against the batch's input document, so ids freed within the batch stay usable. */
function retirement(start: SonobeDocument, seen: SeenIds | undefined): Pick<OpContext, "retiredItem" | "retiredComponent" | "startIds"> {
  const startIds = (component: Id) => {
    const c = getOwn(start.components, component);
    return c ? liveItemIds(c) : NO_IDS;
  };
  if (!seen) return { retiredItem: () => false, retiredComponent: () => false, startIds };
  let retiredKeys: Set<string> | undefined;
  return {
    retiredItem: (component, id) => !!seen.items.get(component)?.has(id) && !startIds(component).has(id),
    retiredComponent: (id) => {
      if (!retiredKeys) {
        const live = new Set(Object.keys(start.components).map(fileNameKey));
        retiredKeys = new Set([...seen.components].map(fileNameKey).filter((key) => !live.has(key)));
      }
      return retiredKeys.has(fileNameKey(id));
    },
    startIds,
  };
}

const refName = (ref: string) => (ref.startsWith("$") ? ref.slice(1) : ref);

/** Register a batch ref for an id created by the current op. */
export function defineRef(ctx: OpContext, ref: unknown, id: Id): void {
  if (ref === undefined || ref === null) return;
  if (typeof ref !== "string" || !ID_PATTERN.test(refName(ref))) {
    fail("invalid_ref", `"${String(ref)}" can't be used as a ref.`, { hint: 'Refs are short names like "card" or "tap", later written as "$card".' });
  }
  const name = refName(ref);
  if (name === "in" || name === "out") fail("invalid_ref", `"${ref}" is reserved for published ports.`, { hint: "Pick another ref name." });
  if (ctx.refs.has(name) || ctx.pendingRefs.has(name)) fail("duplicate_ref", `The ref "${ref}" is already used in this batch.`, { hint: "Each ref names one new item." });
  ctx.pendingRefs.set(name, { given: ref, id });
}

/** Every ref name the batch knows about, as "$name", sorted. */
export function knownRefs(ctx: OpContext): string[] {
  return [...new Set([...ctx.batchRefs.keys(), ...ctx.refs.keys(), ...ctx.pendingRefs.keys()])].map((k) => `$${k}`).sort();
}

/**
 * Resolve "$ref" to the id of the item some op in the batch created; other strings pass through.
 * Refs resolve in any order: naming an item a later op creates throws PendingRef, and applyOps
 * retries once that op has run.
 */
export function resolveId(ctx: OpContext, value: unknown): Id {
  if (typeof value !== "string") fail("invalid_op", `Expected an id, but got ${JSON.stringify(value) ?? String(value)}.`);
  if (!value.startsWith("$") || value === "$in" || value === "$out") return value;
  const name = value.slice(1);
  const id = ctx.pendingRefs.get(name)?.id ?? ctx.refs.get(name);
  if (id === undefined) {
    if (ctx.batchRefs.has(name)) throw new PendingRef(name);
    const known = knownRefs(ctx);
    fail("unknown_ref", `"${value}" doesn't name anything created in this batch.${didYouMeanText(didYouMean(value, known))}`, {
      hint: `${known.length ? `Refs in this batch: ${known.join(", ")}.` : 'No op in this batch gives its item a "ref" yet.'} Give the new item a "ref" (e.g. "ref": "card"), then write "$card" in any op of the same batch.`,
    });
  }
  return id;
}

const REF_ADDRESS = /^(@?)(\$[A-Za-z_][A-Za-z0-9_]*)(\.[\s\S]*)$/;

/** Resolve a "$ref" id at the start of an address ("$tap.tap", "@$card.scale"). */
export function resolveAddress(ctx: OpContext, address: unknown): string {
  if (typeof address !== "string") fail("invalid_address", `Expected an address like "patch.port", but got ${JSON.stringify(address) ?? String(address)}.`);
  const m = REF_ADDRESS.exec(address);
  if (!m || m[2] === "$in" || m[2] === "$out") return address;
  return `${m[1]}${resolveId(ctx, m[2])}${m[3]}`;
}

/** Resolve refs inside an input value (link addresses and layer references). */
export function resolveInputRefs(ctx: OpContext, value: unknown): unknown {
  if (isLinkInput(value)) return { link: resolveAddress(ctx, value.link) };
  if (isLayerInput(value)) return { layer: resolveId(ctx, value.layer) };
  return value;
}

/** The component an op targets (explicit, default, or the root). */
export function getTargetComponent(ctx: OpContext, id: unknown): Component {
  const raw = id ?? ctx.defaultComponent ?? ctx.doc.project.root;
  const componentId = resolveId(ctx, raw);
  const component = getOwn(ctx.doc.components, componentId);
  if (!component) {
    const ids = Object.keys(ctx.doc.components);
    fail("not_found", `There's no component "${componentId}".${didYouMeanText(didYouMean(componentId, ids))}`, { hint: `Components: ${ids.join(", ")}.` });
  }
  return component;
}

export function withComponent(doc: SonobeDocument, component: Component): SonobeDocument {
  return { ...doc, components: { ...doc.components, [component.id]: component } };
}

/** Replace a component in the context document and mark it affected. */
export function commitComponent(ctx: OpContext, component: Component): void {
  ctx.doc = withComponent(ctx.doc, component);
  ctx.affected.components.add(component.id);
}

/** A validated explicit id, or a unique id derived from a name or type. */
export function newItemId(ctx: OpContext, component: Component, options: { explicit?: unknown; name?: unknown; fallback: string; taken: ReadonlySet<Id> }): Id {
  const retired = (id: string) => ctx.retiredItem(component.id, id);
  const isTaken = (id: string) => options.taken.has(id) || ctx.reserved.has(id) || retired(id);
  if (options.explicit !== undefined && options.explicit !== null) {
    const explicit = options.explicit;
    if (!isValidId(explicit)) {
      fail("invalid_id", `"${String(explicit)}" isn't a valid id.`, { hint: `Ids use letters, digits and underscores and don't start with a digit, like "${slugify(String(explicit), options.fallback)}".` });
    }
    if (options.taken.has(explicit)) {
      fail("id_taken", `The id "${explicit}" is already used in ${component.id}.`, { hint: `Leave "id" out to get a free one, like "${uniqueId(explicit, isTaken)}". To replace that item, remove it earlier in the same batch.` });
    }
    if (ctx.reserved.has(explicit)) fail("id_taken", `The id "${explicit}" is reserved in ${component.id}.`, { hint: `Leave "id" out to get a free one, like "${uniqueId(explicit, isTaken)}".` });
    if (retired(explicit)) {
      fail("id_retired", `"${explicit}" belonged to an item removed from ${component.id} earlier in this session. Removed ids aren't given to new items, so anything still holding the old id fails instead of reaching the new one.`, {
        hint: `To rebuild an item under its old id, remove it and add the new one in the same batch (if the removal is already applied, undo it first). Or leave "id" out to get "${uniqueId(explicit, isTaken)}".`,
      });
    }
    return explicit;
  }
  const name = typeof options.name === "string" && options.name.trim() ? options.name : undefined;
  const base = slugify(name ?? options.fallback, slugify(options.fallback));
  const id = uniqueId(base, isTaken);
  // Unnamed items of one type (switch, switch_2) are expected; names that slug alike aren't.
  if (id !== base) noteRenamed(ctx, id, base, retired(base), name !== undefined && options.taken.has(base) && !ctx.startIds(component.id).has(base));
  return id;
}

/** Record why a derived id got a suffix: its base is retired, or another item of this batch took it. */
export function noteRenamed(ctx: OpContext, id: Id, base: Id, retired: boolean, takenInBatch: boolean): void {
  if (retired) ctx.renamed.retired[id] = base;
  else if (takenInBatch) ctx.renamed.suffixed[id] = base;
}

/** Validate an insertion index: undefined → end, negative counts from the end, clamped to range. */
export function resolveIndex(index: unknown, length: number): number {
  if (index === undefined || index === null) return length;
  if (typeof index !== "number" || !Number.isInteger(index)) fail("invalid_op", `"index" must be a whole number, but got ${JSON.stringify(index)}.`);
  const i = index < 0 ? length + 1 + index : index;
  return Math.max(0, Math.min(length, i));
}

export function requireLayer(component: Component, id: Id): LayerLocation {
  const loc = findLayer(component.layers, id);
  if (loc) return loc;
  const isPatch = Object.hasOwn(component.patches, id);
  const ids = allLayerIds(component.layers);
  return fail("not_found", `There's no layer "${id}" in ${component.id}.${didYouMeanText(didYouMean(id, ids))}`, {
    hint: isPatch ? `"${id}" is a patch, not a layer.` : ids.length ? `Layers here: ${ids.slice(0, 12).join(", ")}.` : "This component has no layers yet.",
  });
}

export function requirePatch(component: Component, id: Id): PatchNode {
  const node = getOwn(component.patches, id);
  if (node) return node;
  const isLayer = !!findLayer(component.layers, id);
  const ids = Object.keys(component.patches);
  return fail("not_found", `There's no patch "${id}" in ${component.id}.${didYouMeanText(didYouMean(id, ids))}`, {
    hint: isLayer ? `"${id}" is a layer, not a patch.` : ids.length ? `Patches here: ${ids.slice(0, 12).join(", ")}.` : "This component has no patches yet.",
  });
}

/** Clear marker for optional fields in inverse ops (the contract types don't allow null). */
export const CLEAR = null as unknown as undefined;

export const isClear = (v: unknown) => v === null || v === "";
