/**
 * Simulation-only overrides (sim_override): value-level changes one simulation runs on top of the
 * person's document. Each override is a short list of ordinary ops; the op engine validates them and
 * applyOps applies them to the session's private copy, so they never reach the person's document,
 * viewer, undo history or disk. Overrides change a layer or patch itself, so they apply to every loop
 * copy and every instance of a component. Browser-safe.
 */

import {
  applyOps,
  checkKnobLiteral,
  didYouMean,
  didYouMeanText,
  findKnob,
  findKnobPreset,
  findLayer,
  formatKnobValue,
  getKnobPreset,
  isLinkInput,
  knobLiteral,
  OP_KINDS,
  parseAddress,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  walkLayers,
  type Id,
  type Op,
  type Registry,
  type SonobeDocument,
  type SonobeError,
} from "@sonobe/core";
import { formatValue } from "./format.ts";
import { HostError, type SimOverride, type SimOverrideRequest } from "./host.ts";
import { resolveInstancePath, splitInstanceAddress } from "./instances.ts";

/** The ops sim_override takes, as its errors name them. */
export const OVERRIDE_OPS =
  "setInput, connect, disconnect, updateLayer { props }, updatePatch { muted }, setKnobValue, applyKnobPreset";
const VALUE_OPS = [
  "setInput",
  "connect",
  "disconnect",
  "updateLayer",
  "updatePatch",
  "setKnobValue",
  "applyKnobPreset",
] as const;

/** Most overrides one simulation holds. */
export const MAX_OVERRIDES = 50;

/** An override and the ops that make it. */
export interface OverrideEntry extends SimOverride {
  /** A later override with the same key replaces this one ("main|@card.opacity", "main|mute:pop"). */
  key: string;
  /** What sim_get_values says next to an overridden value ("overridden in this simulation, was 1"). */
  note: string;
  /** A number or boolean pinned by set or setInput, and what it was. */
  pinned?: { value: number | boolean; was: string };
  ops: Op[];
  /**
   * Apply the ops leniently, for a knob value in a locked preset: the lock guards the person's
   * document, not a simulation. The value was checked when the override was made.
   */
  lenient?: boolean;
}

export type NewOverride = Omit<OverrideEntry, "id">;

export interface AppliedOverrides {
  doc: SonobeDocument;
  /** The entries that applied, in order. */
  kept: OverrideEntry[];
  /** Entries the document no longer accepts, with the op engine's error. */
  failed: { entry: OverrideEntry; error: SonobeError }[];
}

/**
 * Apply overrides in order (knob preset switches first) on top of `doc` through the op engine.
 * Entries that fail (the person deleted the layer, a port went away) are left out and returned in
 * `failed`.
 */
export function applyOverrides(
  doc: SonobeDocument,
  entries: readonly OverrideEntry[],
  registry: Registry,
): AppliedOverrides {
  const failed: AppliedOverrides["failed"] = [];
  // A preset switch applies first, so a knob value override without a preset tunes the preset the
  // simulation ends up running.
  const presetFirst = [
    ...entries.filter(isPresetSwitch),
    ...entries.filter((e) => !isPresetSwitch(e)),
  ];
  for (const entry of presetFirst) {
    const r = applyOps(doc, entry.ops, {
      registry,
      defaultComponent: entry.component,
      ...(entry.lenient ? { lenient: true } : {}),
    });
    if (r.ok) doc = r.doc;
    else
      failed.push({
        entry,
        error: r.errors[0] ?? { code: "override_failed", message: "It no longer applies." },
      });
  }
  const kept = entries.filter((e) => !failed.some((f) => f.entry === e));
  return { doc, kept, failed };
}

/** Whether an override switches the knob preset the simulation runs (applyKnobPreset). */
export const isPresetSwitch = (entry: OverrideEntry) =>
  entry.ops.length === 1 && entry.ops[0]!.op === "applyKnobPreset";

const COPY = /#\d+/;
const COPIES = /#\d+/g;

/** Overrides change a layer or patch itself, so "#n" (one loop copy) can't be overridden. */
function refuseCopy(target: string): void {
  if (!COPY.test(target)) return;
  throw new HostError(
    "override_per_copy",
    `Overrides change the layer or patch itself, so they apply to every loop copy and every component instance; "${target}" can't pick one copy.`,
    {
      hint: `Drop the "#n" ("${target.replace(COPIES, "")}") to change every copy. To see one copy on its own, take get_screenshot of it with isolate: true; to get it out of the way, move it with sim_dispatch, or override the value that drives it.`,
    },
  );
}

/** Where a target lives: `component`, or the component an instance path runs. */
function scope(
  doc: SonobeDocument,
  target: string,
  component: Id | undefined,
): { component: Id; address: string; every?: Id } {
  refuseCopy(target);
  const split = splitInstanceAddress(target);
  if (!split.path) return { component: component ?? doc.project.root, address: target.trim() };
  const resolved = resolveInstancePath(doc, split.path, component);
  if (!resolved.ok)
    throw new HostError(
      resolved.code,
      resolved.message,
      resolved.hint ? { hint: resolved.hint } : {},
    );
  return {
    component: resolved.component.id,
    address: split.at + split.tail,
    every: resolved.component.id,
  };
}

/** The dedupe keys an address could match (for clear and sim_get_values notes); copies don't matter. */
export function overrideKeys(doc: SonobeDocument, address: string): string[] {
  const text = address.trim().replace(COPIES, "");
  const split = splitInstanceAddress(text);
  const resolved = resolveInstancePath(doc, split.path);
  if (!resolved.ok) return [];
  const c = resolved.component.id;
  const own = split.at + split.tail;
  const keys = [`${c}|${own}`];
  const parsed = parseAddress(own);
  if (parsed?.kind === "patch") keys.push(`${c}|mute:${parsed.id}`);
  // A knob value set in one preset (setKnobValue with preset) shows while that preset runs.
  if (parsed?.kind === "knob" && doc.knobs) keys.push(`${c}|${own}|${doc.knobs.active}`);
  if (!parsed && /^[A-Za-z_][A-Za-z0-9_]*$/.test(own)) keys.push(`${c}|mute:${own}`);
  return keys;
}

/** "was 1", "was linked to card_scale.output", "was the default 1", read from the person's document. */
function was(doc: SonobeDocument, component: Id, address: string, registry: Registry): string {
  const c = doc.components[component];
  const a = parseAddress(address);
  if (!c || !a) return "was the default";
  let current: unknown;
  let fallback: unknown;
  if (a.kind === "patch") {
    const node = c.patches[a.id];
    current = node?.inputs[a.key];
    if (node)
      fallback = resolveNodePorts(doc, node, registry)?.inputs.find(
        (p) => p.key === a.key,
      )?.default;
  } else if (a.kind === "layer") {
    const layer = findLayer(c.layers, a.id)?.layer;
    current = layer?.props[a.key];
    if (layer)
      fallback = resolveLayerProps(doc, c.id, layer, registry)?.find(
        (p) => p.key === a.key,
      )?.default;
  }
  if (isLinkInput(current)) return `was linked to ${current.link}`;
  if (current !== undefined) return `was ${formatValue(current)}`;
  return fallback === undefined || fallback === null
    ? "was the default"
    : `was the default ${formatValue(fallback)}`;
}

/** Refuse outputs up front: they're computed every frame, so pinning one means pinning what it drives. */
function refuseOutput(
  doc: SonobeDocument,
  component: Id,
  address: string,
  registry: Registry,
): void {
  const c = doc.components[component];
  const a = parseAddress(address);
  if (!c || !a) return;
  let inputs: string[] = [];
  if (a.kind === "patch") {
    const node = c.patches[a.id];
    const ports = node ? resolveNodePorts(doc, node, registry) : undefined;
    if (!ports || ports.inputs.some((p) => p.key === a.key)) return;
    if (!ports.outputs.some((p) => p.key === a.key)) return;
    inputs = ports.inputs.map((p) => `${a.id}.${p.key}`);
  } else if (a.kind === "layer") {
    const layer = findLayer(c.layers, a.id)?.layer;
    if (!layer || resolveLayerProps(doc, c.id, layer, registry)?.some((p) => p.key === a.key))
      return;
    if (!resolveLayerOutputs(doc, c.id, layer, registry).some((p) => p.key === a.key)) return;
  } else return;
  const link = a.kind === "layer" ? `@${a.id}.${a.key}` : `${a.id}.${a.key}`;
  const driven: string[] = [];
  for (const [id, node] of Object.entries(c.patches))
    for (const [key, value] of Object.entries(node.inputs))
      if (isLinkInput(value) && value.link === link) driven.push(`${id}.${key}`);
  walkLayers(c.layers, (layer) => {
    for (const [key, value] of Object.entries(layer.props))
      if (isLinkInput(value) && value.link === link) driven.push(`@${layer.id}.${key}`);
  });
  throw new HostError(
    "override_output",
    `"${address}" is an output: it's computed every frame from its inputs, so an override can't pin it.`,
    {
      hint: driven.length
        ? `Override what it drives instead: ${driven.join(", ")}.`
        : inputs.length
          ? `Override one of its inputs instead: ${inputs.join(", ")}.`
          : "Override the inputs or properties it feeds instead.",
    },
  );
}

const unsupported = (index: number, op: Op, why: string) =>
  new HostError(
    "override_op_unsupported",
    `ops[${index}] (${op.op}) can't be a simulation override: ${why}`,
    {
      hint: `Overrides change values and connections only: ${OVERRIDE_OPS}. To try new layers or patches, make the change for real (one undo takes it back).`,
    },
  );

/**
 * What sim_get_values says next to an overridden value. An override hot-swaps without advancing
 * time, and a patch reads its inputs when it next evaluates, so right after the override a patch
 * input still reads the old value.
 */
export function overrideNote(entry: OverrideEntry, current: unknown): string {
  const pinned = entry.pinned;
  if (pinned && typeof current === typeof pinned.value && current !== pinned.value)
    return `overridden to ${formatValue(pinned.value)} in this simulation from the next frame, ${pinned.was}`;
  return entry.note;
}

/**
 * Turn a request's set and ops into overrides, checked against `doc` (the person's document, with
 * the knob preset and values the simulation runs). `person` is the person's own document, for the
 * preset they run. Throws a teaching HostError for per-copy targets, outputs and structural ops;
 * the op engine checks the rest when the overrides apply.
 */
export function overrideEntries(
  doc: SonobeDocument,
  request: SimOverrideRequest,
  registry: Registry,
  person: SonobeDocument = doc,
): NewOverride[] {
  const out: NewOverride[] = [];
  const pin = (
    target: string,
    value: unknown,
    component: Id | undefined,
    label: string,
  ): NewOverride => {
    if (typeof target !== "string" || !target.trim())
      throw new HostError("invalid_target", `${label} has no target.`, {
        hint: 'Name a patch input ("pop.bounciness") or a layer property ("@card.opacity").',
      });
    if (value === undefined)
      throw new HostError("invalid_value", `${label} (${target}) has no value.`, {
        hint: "Pass a literal, or null for the default.",
      });
    const s = scope(doc, target, component);
    refuseOutput(doc, s.component, s.address, registry);
    const before = was(doc, s.component, s.address, registry);
    const every = s.every ? `; applies to every instance of ${s.every}` : "";
    return {
      key: `${s.component}|${s.address}`,
      target,
      component: s.component,
      summary: `${target} = ${value === null ? "its default" : formatValue(value)} (${before}${every})`,
      note: `overridden in this simulation, ${before}`,
      ...(typeof value === "number" || typeof value === "boolean"
        ? { pinned: { value, was: before } }
        : {}),
      ops: [{ op: "setInput", component: s.component, target: s.address, value: value as never }],
    };
  };
  (request.set ?? []).forEach((item, i) =>
    out.push(pin(item.target, item.value, item.component, `set[${i}]`)),
  );
  (request.ops ?? []).forEach((op, i) => {
    const component = (op as { component?: Id }).component;
    const extra = (allowed: string[]) =>
      Object.keys(op).filter((k) => !["op", "component", ...allowed].includes(k));
    switch (op.op) {
      case "setInput":
        out.push(pin(op.target, op.value, component, `ops[${i}]`));
        break;
      case "connect": {
        refuseCopy(op.from);
        const s = scope(doc, op.to, component);
        const before = was(doc, s.component, s.address, registry);
        out.push({
          key: `${s.component}|${s.address}`,
          target: op.to,
          component: s.component,
          summary: `${op.to} ← ${op.from} (${before})`,
          note: `linked to ${op.from} in this simulation, ${before}`,
          ops: [{ op: "connect", component: s.component, from: op.from, to: s.address }],
        });
        break;
      }
      case "disconnect": {
        const s = scope(doc, op.to, component);
        const before = was(doc, s.component, s.address, registry);
        out.push({
          key: `${s.component}|${s.address}`,
          target: op.to,
          component: s.component,
          summary: `${op.to} disconnected (${before})`,
          note: `disconnected in this simulation, ${before}`,
          ops: [{ op: "disconnect", component: s.component, to: s.address }],
        });
        break;
      }
      case "updateLayer": {
        const other = extra(["id", "props"]);
        if (other.length || !op.props || !Object.keys(op.props).length)
          throw unsupported(
            i,
            op,
            other.length
              ? `only props can change inside a simulation (not ${other.join(", ")}).`
              : "it has no props to change.",
          );
        for (const [key, value] of Object.entries(op.props))
          out.push(pin(`@${op.id}.${key}`, value, component, `ops[${i}]`));
        break;
      }
      case "updatePatch": {
        const other = extra(["id", "muted"]);
        if (other.length || typeof op.muted !== "boolean")
          throw unsupported(
            i,
            op,
            other.length
              ? `only muted can change inside a simulation (not ${other.join(", ")}).`
              : "it needs muted: true or false.",
          );
        const c = component ?? doc.project.root;
        const before = doc.components[c]?.patches[op.id]?.muted ? "was muted" : "wasn't muted";
        const state = op.muted ? "muted" : "unmuted";
        out.push({
          key: `${c}|mute:${op.id}`,
          target: `${op.id} (${state})`,
          component: c,
          summary: `${op.id} ${state} (${before})`,
          note: `"${op.id}" is ${state} in this simulation`,
          ops: [{ op: "updatePatch", component: c, id: op.id, muted: op.muted }],
        });
        break;
      }
      case "setKnobValue": {
        const set = doc.knobs;
        const knob = findKnob(set, String(op.id));
        if (!knob.ok)
          throw new HostError(
            knob.error.code,
            `ops[${i}]: ${knob.error.message}`,
            knob.error.hint ? { hint: knob.error.hint } : {},
          );
        const preset = op.preset !== undefined ? findKnobPreset(set, op.preset) : undefined;
        if (preset && !preset.ok)
          throw new HostError(
            preset.error.code,
            `ops[${i}]: ${preset.error.message}`,
            preset.error.hint ? { hint: preset.error.hint } : {},
          );
        const value = checkKnobLiteral(knob.value, op.value);
        if (!value.ok)
          throw new HostError(
            value.error.code,
            `ops[${i}]: ${value.error.message}`,
            value.error.hint ? { hint: value.error.hint } : {},
          );
        const k = knob.value;
        // Without a preset it tunes whichever preset the simulation runs (sim_reset may run another).
        const presetId = preset?.ok ? preset.value.id : undefined;
        const before = formatKnobValue(k, knobLiteral(set!, k, presetId));
        const where =
          presetId !== undefined ? ` in ${preset!.ok ? preset!.value.name : presetId}` : "";
        out.push({
          key: `${doc.project.root}|$knob.${k.id}${presetId !== undefined ? `|${presetId}` : ""}`,
          target: `$knob.${k.id}`,
          component: doc.project.root,
          summary: `${k.name} = ${formatKnobValue(k, value.value)}${where} (was ${before})`,
          note: `overridden in this simulation${where}, was ${before}`,
          ops: [
            {
              op: "setKnobValue",
              id: k.id,
              value: value.value,
              ...(presetId !== undefined ? { preset: presetId } : {}),
            },
          ],
          lenient: true,
        });
        break;
      }
      case "applyKnobPreset": {
        const set = doc.knobs;
        const preset = findKnobPreset(set, String(op.id));
        if (!preset.ok)
          throw new HostError(
            preset.error.code,
            `ops[${i}]: ${preset.error.message}`,
            preset.error.hint ? { hint: preset.error.hint } : {},
          );
        const theirs = person.knobs?.active ?? set!.active;
        const was = getKnobPreset(set, theirs)?.name ?? theirs;
        out.push({
          key: `${doc.project.root}|knob-preset`,
          target: `preset ${preset.value.name}`,
          component: doc.project.root,
          summary: `runs ${preset.value.name} (the person runs ${was})`,
          note: `runs ${preset.value.name} in this simulation`,
          ops: [{ op: "applyKnobPreset", id: preset.value.id }],
        });
        break;
      }
      default:
        throw unsupported(
          i,
          op,
          (OP_KINDS as readonly string[]).includes(op.op)
            ? "it changes the document's structure, not a value."
            : `"${String(op.op)}" isn't an op kind.${didYouMeanText(didYouMean(String(op.op), [...VALUE_OPS]))}`,
        );
    }
  });
  return out;
}
