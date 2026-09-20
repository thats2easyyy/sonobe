/**
 * explain: a deterministic, plain-language description of a component's graph at three audience
 * levels. Flows are traced from inputs (gestures, timers) through state and animation to the layer
 * properties they drive. Beginners get everyday words and layer names; designers get patch names
 * and key values; engineers get ids, ports and evaluation notes. Browser-safe.
 */

import {
  decodeInput,
  defaultForPort,
  findLayer,
  formatKnobValue,
  formatOutlineValue,
  getDiagnostics,
  getKnob,
  getPatchSpec,
  knobLiteral,
  isDecodedLoop,
  isLayerInput,
  isLinkInput,
  parseAddress,
  resolveLayerProps,
  resolveNodePorts,
  walkLayers,
  type Component,
  type Id,
  type InputValue,
  type PatchNode,
  type Registry,
  type ResolvedPort,
  type SonobeDocument,
} from "@sonobe/core";
import { joinList, plural } from "./format.ts";
import { requireComponent } from "./graph.ts";

export type Audience = "beginner" | "designer" | "engineer";

export interface ExplainOptions {
  registry: Registry;
  component?: Id;
  /** Limit to the flows that touch these layers or patches. */
  ids?: Id[];
  audience?: Audience;
}

interface Ctx {
  doc: SonobeDocument;
  c: Component;
  registry: Registry;
  audience: Audience;
}

interface Sink {
  layerId: Id;
  prop: string;
  source: string;
}

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const stripDot = (s: string) => s.replace(/\.$/, "");

function patchLabel(ctx: Ctx, id: Id): string {
  const node = ctx.c.patches[id];
  if (!node) return id;
  const spec = getPatchSpec(ctx.registry, node.type);
  if (ctx.audience === "engineer")
    return `${id} (${node.type}${node.typeParam ? `<${node.typeParam}>` : ""})`;
  const specName = spec?.name ?? node.type;
  if (ctx.audience === "designer")
    return node.name && node.name !== specName ? `${node.name} (${specName})` : specName;
  return (node.name ?? specName).toLowerCase();
}

/** The short name designers see in "Name › Port" references. */
function shortLabel(ctx: Ctx, id: Id): string {
  const node = ctx.c.patches[id];
  return node?.name ?? getPatchSpec(ctx.registry, node?.type ?? "")?.name ?? id;
}

/** Everyday words for common outputs, keyed "type.port"; `L` is the patch's layer name. */
const BEGINNER_SOURCES: Record<string, (L: string | undefined) => string> = {
  "interaction.tap": (L) => (L ? `tapping ${L}` : "tapping the screen"),
  "interaction.down": (L) => (L ? `pressing ${L}` : "pressing the screen"),
  "interaction.position": () => "where the finger is",
  "longPress.longPress": (L) => (L ? `holding ${L}` : "holding the screen"),
  "longPress.tap": (L) => (L ? `a quick tap on ${L}` : "a quick tap"),
  "swipe.swiped": (L) => (L ? `swiping ${L}` : "a swipe"),
  "hover.hovering": (L) => (L ? `hovering over ${L}` : "hovering"),
  "keyboard.down": () => "holding the key",
  "whenPrototypeStarts.started": () => "the prototype starting",
  "switch.on": () => "the switch",
  "counter.count": () => "the count",
  "optionSwitch.option": () => "the chosen option",
  "popAnimation.output": () => "that animation",
  "springAnimation.output": () => "that animation",
  "classicAnimation.output": () => "that animation",
  "transition.output": () => "that value",
  "progress.progress": () => "that progress",
  "drag.position": (L) => (L ? `where ${L} is dragged` : "the drag position"),
  "scroll.position": () => "the scroll position",
  "wait.done": () => "the timer finishing",
  "wait.finished": () => "the timer finishing",
};

function layerLabel(ctx: Ctx, id: Id): string {
  if (ctx.audience === "engineer") return `@${id}`;
  const loc = findLayer(ctx.c.layers, id);
  return loc ? loc.layer.name : id;
}

function propLabel(ctx: Ctx, layerId: Id, key: string): string {
  if (ctx.audience === "engineer") return key;
  const loc = findLayer(ctx.c.layers, layerId);
  const props = loc ? resolveLayerProps(ctx.doc, ctx.c.id, loc.layer, ctx.registry) : undefined;
  const name = props?.find((p) => p.key === key)?.name ?? key;
  return ctx.audience === "beginner" ? name.toLowerCase() : name;
}

function portsOf(ctx: Ctx, node: PatchNode) {
  return resolveNodePorts(ctx.doc, node, ctx.registry);
}

function portName(ctx: Ctx, patchId: Id, key: string, direction: "inputs" | "outputs"): string {
  const node = ctx.c.patches[patchId];
  const port = node ? portsOf(ctx, node)?.[direction].find((p) => p.key === key) : undefined;
  return port?.name ?? key;
}

/** Where a link comes from, in audience words. */
function sourceLabel(ctx: Ctx, link: string): string {
  const a = parseAddress(link);
  if (!a) return link;
  if (ctx.audience === "engineer") return link;
  if (a.kind === "patch") {
    const port = portName(ctx, a.id, a.key, "outputs");
    const node = ctx.c.patches[a.id];
    if (ctx.audience === "designer") return `${shortLabel(ctx, a.id)} › ${port}`;
    const phrase = node ? BEGINNER_SOURCES[`${node.type}.${a.key}`] : undefined;
    if (phrase && node) return phrase(layerInput(ctx, node));
    const first = node ? portsOf(ctx, node)?.outputs[0]?.key : undefined;
    return first === a.key
      ? `the ${patchLabel(ctx, a.id)}`
      : `the ${patchLabel(ctx, a.id)}'s ${port.toLowerCase()}`;
  }
  if (a.kind === "layer") return `${layerLabel(ctx, a.id)}'s ${propLabel(ctx, a.id, a.key)}`;
  if (a.kind === "componentInput")
    return ctx.audience === "beginner"
      ? `the component's "${a.key}" input`
      : `published input ${a.key}`;
  if (a.kind === "knob") return knobLabelText(ctx.doc, a.key);
  return link;
}

/** "the knob Commit Distance (95 pt in Proposal, 80 pt in Shipped app)". */
function knobLabelText(doc: SonobeDocument, id: Id): string {
  const set = doc.knobs;
  const knob = getKnob(set, id);
  if (!set || !knob) return `the knob "${id}" (missing)`;
  const values = set.presets.map(
    (p) =>
      `${formatKnobValue(knob, knobLiteral(set, knob, p.id))}${set.presets.length > 1 ? ` in ${p.name}` : ""}`,
  );
  return `the knob ${knob.name} (${values.join(", ")})`;
}

function literal(value: InputValue | undefined, port?: ResolvedPort): string | undefined {
  if (value === undefined || isLinkInput(value)) return undefined;
  if (isLayerInput(value)) return undefined;
  return formatOutlineValue(value, port?.type);
}

/** Non-default literal inputs as "bounciness 5, speed 10". */
function settingsText(ctx: Ctx, node: PatchNode, skip: readonly string[] = []): string {
  const ports = portsOf(ctx, node);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(node.inputs)) {
    if (skip.includes(key)) continue;
    // A knob-driven input is a setting too: name the knob and its values.
    if (isLinkInput(value) && parseAddress(value.link)?.kind === "knob") {
      const port = ports?.inputs.find((p) => p.key === key);
      if (ctx.audience === "engineer") parts.push(`${key} ${value.link}`);
      else
        parts.push(
          `${(port?.name ?? key).toLowerCase()} ${knobLabelText(ctx.doc, value.link.slice("$knob.".length))}`,
        );
      continue;
    }
    if (isLinkInput(value) || isLayerInput(value)) continue;
    const port = ports?.inputs.find((p) => p.key === key);
    if (port) {
      const decoded = decodeInput(value, port.type);
      if (
        !isDecodedLoop(decoded) &&
        JSON.stringify(decoded) === JSON.stringify(defaultForPort(port))
      )
        continue;
    }
    const name = ctx.audience === "engineer" ? key : (port?.name ?? key).toLowerCase();
    parts.push(`${name} ${literal(value, port)}`);
  }
  return parts.join(", ");
}

/** The value an input holds: its source, literal, or default. */
function inputText(ctx: Ctx, node: PatchNode, key: string): string {
  const value = node.inputs[key];
  if (isLinkInput(value)) return sourceLabel(ctx, value.link);
  const port = portsOf(ctx, node)?.inputs.find((p) => p.key === key);
  if (value !== undefined) return literal(value, port) ?? "?";
  return port ? formatOutlineValue(defaultToLiteral(defaultForPort(port)), port.type) : "?";
}

function defaultToLiteral(v: unknown): InputValue {
  if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "string")
    return v;
  if (Array.isArray(v) && v.every((n) => typeof n === "number")) return v as number[];
  if (v && typeof v === "object" && "r" in v) {
    const c = v as { r: number; g: number; b: number; a: number };
    const hex = (n: number) =>
      Math.round(Math.max(0, Math.min(1, n)) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}${hex(c.a)}`;
  }
  return { json: v };
}

const connected = (node: PatchNode, key: string) => isLinkInput(node.inputs[key]);

function layerInput(ctx: Ctx, node: PatchNode): string | undefined {
  const v = node.inputs.layer;
  return isLayerInput(v) ? layerLabel(ctx, v.layer) : undefined;
}

/** A sentence describing what one patch does in its flow. */
function describePatch(ctx: Ctx, id: Id, node: PatchNode): string {
  const spec = getPatchSpec(ctx.registry, node.type);
  const b = ctx.audience === "beginner";
  const e = ctx.audience === "engineer";
  const label = patchLabel(ctx, id);
  const L = layerInput(ctx, node);
  const settings = settingsText(ctx, node, [
    "number",
    "progress",
    "start",
    "end",
    "value",
    "layer",
  ]);
  const withSettings = settings ? ` (${settings})` : "";
  if (e) {
    const ins = Object.entries(node.inputs).map(([k, v]) =>
      isLinkInput(v)
        ? `${k}←${v.link}`
        : isLayerInput(v)
          ? `${k}=@${v.layer}`
          : `${k}=${formatOutlineValue(v)}`,
    );
    return `${label}: ${ins.length ? ins.join(", ") : "no inputs set"}. ${spec ? stripDot(spec.summary) : "Unknown patch type"}.`;
  }
  switch (node.type) {
    case "interaction":
      return b
        ? L
          ? `It watches for touches on ${L}: a finger going down, and a tap when it lifts.`
          : "It watches for touches anywhere on the screen."
        : `${label} listens to ${L ?? "the whole screen"}: Down while pressed, a Tap pulse on release.`;
    case "longPress":
      return b
        ? `Holding ${L ?? "the screen"} still for ${inputText(ctx, node, "duration")} seconds counts as a long press.`
        : `${label} on ${L ?? "the screen"} turns Long Press on after a still hold of ${inputText(ctx, node, "duration")} s, and pulses Tap for quick taps.`;
    case "swipe":
      return b
        ? `Swiping on ${L ?? "the screen"} sends a signal.`
        : `${label} on ${L ?? "the screen"} pulses Swiped (and a pulse per direction) when a press ends in a swipe${withSettings}.`;
    case "drag":
      return b
        ? `Dragging ${L ?? "the layer"} works out where it should move.`
        : `${label} turns drags on ${L ?? "its layer"} into a Position${withSettings}.`;
    case "scroll":
      return b
        ? `Scrolling ${L ?? "the content"} works out how far it has moved.`
        : `${label} scrolls ${L ?? "its content"} with momentum and outputs Position${withSettings}.`;
    case "hover":
      return b
        ? `It notices when the mouse is over ${L ?? "a layer"}.`
        : `${label} reports Hovering while the pointer is over ${L ?? "its layer"}.`;
    case "keyboard":
      return b
        ? `It notices when the ${inputText(ctx, node, "key")} key is held.`
        : `${label} is Down while ${inputText(ctx, node, "key")} is held.`;
    case "whenPrototypeStarts":
      return b
        ? "It sends a signal the moment the prototype starts."
        : `${label} pulses once when the prototype starts (and on restart).`;
    case "switch": {
      const parts: string[] = [];
      for (const [key, verb, bverb] of [
        ["flip", "flips on", "flips it"],
        ["turnOn", "turns on with", "turns it on"],
        ["turnOff", "turns off with", "turns it off"],
      ] as const) {
        if (!connected(node, key)) continue;
        parts.push(
          b ? `${inputText(ctx, node, key)} ${bverb}` : `${verb} ${inputText(ctx, node, key)}`,
        );
      }
      if (b)
        return `A switch remembers on or off${parts.length ? `: ${joinList(parts)}` : ", but nothing changes it yet"}.`;
      return `${label} holds on/off${parts.length ? ` and ${joinList(parts)}` : " (nothing drives it yet)"}.`;
    }
    case "counter": {
      const parts: string[] = [];
      if (connected(node, "increase"))
        parts.push(
          b
            ? `goes up with ${inputText(ctx, node, "increase")}`
            : `+1 on ${inputText(ctx, node, "increase")}`,
        );
      if (connected(node, "decrease"))
        parts.push(
          b
            ? `goes down with ${inputText(ctx, node, "decrease")}`
            : `−1 on ${inputText(ctx, node, "decrease")}`,
        );
      if (connected(node, "jump"))
        parts.push(
          b
            ? `jumps to ${inputText(ctx, node, "jumpToNumber")} with ${inputText(ctx, node, "jump")}`
            : `jumps to ${inputText(ctx, node, "jumpToNumber")} on ${inputText(ctx, node, "jump")}`,
        );
      return b
        ? `A counter keeps a whole number that ${parts.length ? joinList(parts) : "nothing changes yet"}.`
        : `${label} counts${parts.length ? `: ${joinList(parts)}` : " (nothing drives it yet)"}${withSettings}.`;
    }
    case "popAnimation":
      return b
        ? `When ${inputText(ctx, node, "number")} changes, a springy animation glides to match it${withSettings}.`
        : `${label} springs toward ${inputText(ctx, node, "number")}${withSettings}.`;
    case "springAnimation":
      return b
        ? `When ${inputText(ctx, node, "number")} changes, a physical spring moves to match it.`
        : `${label} springs toward ${inputText(ctx, node, "number")}${withSettings}.`;
    case "classicAnimation":
      return b
        ? `When ${inputText(ctx, node, "number")} changes, a smooth animation eases to match it over ${inputText(ctx, node, "duration")} seconds.`
        : `${label} eases toward ${inputText(ctx, node, "number")} over ${inputText(ctx, node, "duration")} s (${inputText(ctx, node, "curve")}).`;
    case "transition":
      return b
        ? `As ${inputText(ctx, node, "progress")} goes from 0 to 1, the result goes from ${inputText(ctx, node, "start")} to ${inputText(ctx, node, "end")}.`
        : `${label} maps ${inputText(ctx, node, "progress")} (0→1) onto ${inputText(ctx, node, "start")} → ${inputText(ctx, node, "end")}.`;
    case "progress":
      return b
        ? `It turns ${inputText(ctx, node, "value")} into progress, from 0 at ${inputText(ctx, node, "start")} to 1 at ${inputText(ctx, node, "end")}.`
        : `${label} converts ${inputText(ctx, node, "value")} to progress (${inputText(ctx, node, "start")} → 0, ${inputText(ctx, node, "end")} → 1).`;
    case "reverseProgress":
      return b
        ? `It flips ${inputText(ctx, node, "progress")} so 0 becomes 1 and 1 becomes 0.`
        : `${label} outputs 1 − ${inputText(ctx, node, "progress")}.`;
    case "delay":
      return b
        ? `It waits ${inputText(ctx, node, "duration")} seconds before passing ${inputText(ctx, node, "value")} along.`
        : `${label} delays ${inputText(ctx, node, "value")} by ${inputText(ctx, node, "duration")} s${withSettings}.`;
    case "wait":
      return b
        ? `A timer starts with ${inputText(ctx, node, "start")} and finishes after ${inputText(ctx, node, "duration")} seconds.`
        : `${label} starts on ${inputText(ctx, node, "start")} and turns Done on after ${inputText(ctx, node, "duration")} s.`;
    case "optionSwitch":
      return b
        ? "It remembers which option is chosen, counting from 0, and changes when an option's signal arrives."
        : `${label} remembers the selected option (from 0), set by ${
            joinList(
              Object.keys(node.inputs)
                .filter((k) => connected(node, k))
                .map((k) => `${k}←${inputText(ctx, node, k)}`),
            ) || "nothing yet"
          }.`;
    case "optionPicker":
      return b
        ? `It picks one of several values depending on ${inputText(ctx, node, "option")}.`
        : `${label} outputs the option chosen by ${inputText(ctx, node, "option")}${withSettings}.`;
    case "loop":
      return b
        ? `It repeats things ${inputText(ctx, node, "count")} times.`
        : `${label} makes a loop of indices 0…${inputText(ctx, node, "count")}−1, so connected layers repeat.`;
    default: {
      const summary = spec ? stripDot(spec.summary) : `an unknown patch type "${node.type}"`;
      const ins = Object.keys(node.inputs)
        .filter((k) => connected(node, k))
        .map((k) => inputText(ctx, node, k));
      if (b)
        return `${label}: ${lowerFirst(summary)}${ins.length ? `, using ${joinList(ins)}` : ""}.`;
      return `${label} — ${lowerFirst(summary)}${ins.length ? `; reads ${joinList(ins)}` : ""}${withSettings}.`;
    }
  }
}

function lowerFirstCap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function sinkSentence(ctx: Ctx, sink: Sink): string {
  if (ctx.audience === "engineer") return `@${sink.layerId}.${sink.prop} ← ${sink.source}`;
  if (ctx.audience === "designer")
    return `→ ${layerLabel(ctx, sink.layerId)} › ${propLabel(ctx, sink.layerId, sink.prop)} ← ${sourceLabel(ctx, sink.source)}`;
  return `That drives ${layerLabel(ctx, sink.layerId)}'s ${propLabel(ctx, sink.layerId, sink.prop)}.`;
}

/** Explain a component (or the flows touching `ids`) for an audience. */
export function explain(doc: SonobeDocument, options: ExplainOptions): string {
  const c = requireComponent(doc, options.component);
  const ctx: Ctx = { doc, c, registry: options.registry, audience: options.audience ?? "designer" };
  const patchIds = Object.keys(c.patches);
  const adjacency = new Map<Id, Set<Id>>(patchIds.map((id) => [id, new Set()]));
  const preds = new Map<Id, Set<Id>>(patchIds.map((id) => [id, new Set()]));
  for (const [id, node] of Object.entries(c.patches)) {
    for (const value of Object.values(node.inputs)) {
      if (!isLinkInput(value)) continue;
      const a = parseAddress(value.link);
      if (a?.kind === "patch" && c.patches[a.id] && a.id !== id) {
        adjacency.get(a.id)!.add(id);
        adjacency.get(id)!.add(a.id);
        preds.get(id)!.add(a.id);
      }
    }
  }
  const sinks: Sink[] = [];
  walkLayers(c.layers, (layer) => {
    for (const [key, value] of Object.entries(layer.props))
      if (isLinkInput(value)) sinks.push({ layerId: layer.id, prop: key, source: value.link });
  });
  const sinkPatch = (s: Sink) => {
    const a = parseAddress(s.source);
    return a?.kind === "patch" ? a.id : undefined;
  };

  // Weakly connected groups of patches, ordered by editor position.
  const pos = (id: Id) => c.patches[id]!.ui;
  const byPosition = (a: Id, b: Id) =>
    pos(a).y - pos(b).y || pos(a).x - pos(b).x || a.localeCompare(b);
  const seen = new Set<Id>();
  const groups: Id[][] = [];
  for (const start of [...patchIds].sort(byPosition)) {
    if (seen.has(start)) continue;
    const group: Id[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const next of adjacency.get(id)!)
        if (!seen.has(next)) (seen.add(next), stack.push(next));
    }
    groups.push(group);
  }

  const scope = options.ids?.length ? new Set(options.ids) : undefined;
  const lines: string[] = [];
  const counts = { layers: 0, patches: patchIds.length, links: 0 };
  walkLayers(c.layers, () => void counts.layers++);
  for (const node of Object.values(c.patches))
    counts.links += Object.values(node.inputs).filter(isLinkInput).length;
  counts.links += sinks.length;
  const size = c.size ? `${c.size[0]}×${c.size[1]}` : "";
  if (ctx.audience === "beginner")
    lines.push(
      `"${c.name}" has ${plural(counts.layers, "layer")} (things you see) and ${plural(counts.patches, "patch", "patches")} (the logic that makes them move).`,
    );
  else if (ctx.audience === "designer")
    lines.push(
      `${c.name} (${c.kind}${size ? `, ${size}` : ""}): ${plural(counts.layers, "layer")}, ${plural(counts.patches, "patch", "patches")}, ${plural(counts.links, "connection")}.`,
    );
  else
    lines.push(
      `component ${c.id} (${c.kind})${size ? ` ${size}` : ""} · layers ${counts.layers} · patches ${counts.patches} · links ${counts.links}`,
    );
  if (c.notes && ctx.audience !== "engineer") lines.push(`Notes: ${c.notes}`);

  const flows = groups.filter(
    (g) =>
      g.length > 1 ||
      sinks.some((s) => sinkPatch(s) === g[0]) ||
      Object.values(c.patches[g[0]!]!.inputs).some(isLinkInput),
  );
  const unused = groups.filter((g) => !flows.includes(g)).map((g) => g[0]!);
  const inScope = (group: Id[]) =>
    !scope ||
    group.some((id) => scope.has(id)) ||
    sinks.some((s) => group.includes(sinkPatch(s) ?? "") && scope.has(s.layerId)) ||
    group.some((id) =>
      Object.values(c.patches[id]!.inputs).some((v) => isLayerInput(v) && scope.has(v.layer)),
    );

  let flowNumber = 0;
  for (const group of flows) {
    if (!inScope(group)) continue;
    flowNumber++;
    // Topological order inside the group; back-edges broken by position.
    const remaining = new Set(group);
    const order: Id[] = [];
    while (remaining.size) {
      const ready = [...remaining]
        .filter((id) => [...preds.get(id)!].every((p) => !remaining.has(p)))
        .sort(byPosition);
      const next = ready[0] ?? [...remaining].sort(byPosition)[0]!;
      order.push(next);
      remaining.delete(next);
    }
    const flowSinks = sinks.filter((s) => group.includes(sinkPatch(s) ?? ""));
    const heading =
      ctx.audience === "engineer"
        ? `flow ${flowNumber}:`
        : ctx.audience === "designer"
          ? `Flow ${flowNumber}${flowSinks.length ? ` (drives ${joinList([...new Set(flowSinks.map((s) => `${layerLabel(ctx, s.layerId)} › ${propLabel(ctx, s.layerId, s.prop)}`))])})` : ""}:`
          : flowNumber === 1
            ? "Here's what happens:"
            : "Also:";
    lines.push("", heading);
    for (const id of order)
      lines.push(
        `${ctx.audience === "beginner" ? "- " : "  "}${describePatch(ctx, id, c.patches[id]!)}`,
      );
    for (const sink of flowSinks)
      lines.push(`${ctx.audience === "beginner" ? "- " : "  "}${sinkSentence(ctx, sink)}`);
    if (!flowSinks.length)
      lines.push(
        ctx.audience === "beginner"
          ? "- Nothing on screen uses the result yet."
          : "  (no layer property uses this flow's result yet)",
      );
  }
  const layerLinks = sinks.filter((s) => !sinkPatch(s));
  if (layerLinks.length && (!scope || layerLinks.some((s) => scope.has(s.layerId)))) {
    lines.push(
      "",
      ctx.audience === "beginner"
        ? "Some layers copy values from other layers:"
        : ctx.audience === "designer"
          ? "Layer-to-layer links:"
          : "layer links:",
    );
    for (const s of layerLinks)
      lines.push(`${ctx.audience === "beginner" ? "- " : "  "}${sinkSentence(ctx, s)}`);
  }
  if (!flowNumber && !layerLinks.length) {
    lines.push(
      "",
      ctx.audience === "beginner"
        ? "Nothing is connected yet, so the prototype doesn't react to anything."
        : ctx.audience === "designer"
          ? "No connected patches yet: nothing reacts to input."
          : "no connected flows",
    );
  }
  const unusedInScope = unused.filter((id) => !scope || scope.has(id));
  if (unusedInScope.length) {
    const names = unusedInScope.map((id) => patchLabel(ctx, id));
    lines.push(
      "",
      ctx.audience === "beginner"
        ? `Not connected to anything yet: ${joinList(names)}.`
        : ctx.audience === "designer"
          ? `Unconnected: ${joinList(names)}.`
          : `unconnected: ${names.join(", ")}`,
    );
  }
  const diagnostics = getDiagnostics(doc, options.registry, { components: [c.id] }).filter(
    (d) => d.severity !== "info",
  );
  if (diagnostics.length) {
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.length - errors;
    if (ctx.audience === "beginner")
      lines.push(
        "",
        `Sonobe spotted ${plural(diagnostics.length, "problem")}. The first: ${diagnostics[0]!.message}`,
      );
    else {
      lines.push(
        "",
        `${ctx.audience === "designer" ? "Problems" : "diagnostics"}: ${plural(errors, "error")}, ${plural(warnings, "warning")}.`,
      );
      for (const d of diagnostics.slice(0, 3))
        lines.push(
          `  ${d.severity} ${ctx.audience === "engineer" ? `${d.code} ` : ""}— ${d.message}`,
        );
    }
  }
  if (ctx.audience === "engineer" && flowNumber) {
    lines.push(
      "",
      "notes: patches evaluate every frame in topological order; pulses are true for one frame; back-edges read the previous frame; Switch precedence turnOff > turnOn > flip.",
    );
  }
  return lines.join("\n");
}
