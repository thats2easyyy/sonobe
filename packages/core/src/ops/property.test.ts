/** Property test: random op sequences; every successful op's inverse restores a deep-equal document, strictly and leniently, and so does redo. */

import { describe, expect, it } from "vitest";
import { hasKnobRange, KNOB_TYPES } from "../knobs.ts";
import { allLayers, resolveNodePorts, resolveLayerProps } from "../registry.ts";
import { parseDocumentFiles, serializeDocument } from "../serialize.ts";
import { emptyDoc, mockRegistry, mustApply, SAMPLE_OPS } from "../testing/fixtures.ts";
import type { InputValue, InterfacePortInput, KnobType, Literal, NewKnob, NewLayer, NewPatch, Op, SonobeDocument, ValueType } from "../types.ts";
import { applyOps, OP_KINDS } from "./apply.ts";
import { listInputs, targetAddress } from "./references.ts";

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOp(doc: SonobeDocument, rand: () => number): Op | undefined {
  const pick = <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(rand() * xs.length)] : undefined);
  const int = (n: number) => Math.floor(rand() * n);
  const chance = (p: number) => rand() < p;
  const componentIds = Object.keys(doc.components);
  const cid = chance(0.6) ? doc.project.root : pick(componentIds)!;
  const c = doc.components[cid]!;
  const layers = allLayers(c.layers);
  const groups = layers.filter((l) => l.type === "group");
  const patchIds = Object.keys(c.patches);
  const ofKind = (kind: string) => componentIds.filter((id) => doc.components[id]!.kind === kind);
  const set = doc.knobs;
  const knobs = set?.knobs ?? [];
  const knobLinks = knobs.map((k) => `$knob.${k.id}`);
  const knobValue = (type: KnobType): Literal => {
    switch (type) {
      case "number":
        return Math.round(rand() * 1000) / 7;
      case "boolean":
        return chance(0.5);
      case "color":
        return pick(["#FF00FFFF", "#12345678"])!;
      case "enum":
        return pick(["a", "b"])!;
      case "point":
        return [int(10), int(10)];
      case "text":
        return pick(["", "Hi"])!;
    }
  };

  const literalFor = (type: ValueType): InputValue | undefined => {
    switch (type) {
      case "number":
        return Math.round(rand() * 1000) / 7;
      case "boolean":
        return chance(0.5);
      case "text":
        return pick(["", "Hello", "Ünïcødé ✨"])!;
      case "color":
        return pick(["#FF00FFFF", "#12345678"])!;
      case "point":
      case "size":
      case "anchor":
        return [int(10), int(10)];
      case "point3d":
        return [1, 2, 3];
      case "point4d":
        return [1, 2, 3, 4];
      case "index":
        return int(4);
      case "layer": {
        const l = pick(layers);
        return l ? { layer: l.id } : undefined;
      }
      default:
        return undefined;
    }
  };

  switch (pick(OP_KINDS)!) {
    case "addLayer": {
      const lcs = ofKind("layerComponent");
      if (chance(0.15) && lcs.length) return { op: "addLayer", component: cid, layer: { type: "componentInstance", component: pick(lcs)! } };
      const type = pick(["rectangle", "group", "text", "oval", "image"])!;
      const props: Record<string, InputValue> = {};
      if (chance(0.5)) props.position = [int(300), int(600)];
      if (chance(0.3) && type !== "text") props.color = pick(["#FF0000FF", "white", "#123"])!;
      if (chance(0.2)) props.opacity = Math.round(rand() * 100) / 100;
      if (chance(0.2) && layers.length) props.scale = { link: `@${pick(layers)!.id}.opacity` };
      if (type === "image" && chance(0.5) && Object.keys(doc.assets).length) props.image = { asset: pick(Object.keys(doc.assets))! };
      const layer: NewLayer = { type, props };
      if (chance(0.5)) layer.name = pick(["Card", "Title", "Row", "Hero Image"])!;
      if (type === "group" && chance(0.4)) layer.children = [{ type: "rectangle", name: "Child" }, { type: "text", props: { text: "Hi" } }];
      return { op: "addLayer", component: cid, parent: groups.length && chance(0.5) ? pick(groups)!.id : null, index: chance(0.5) ? undefined : int(4), layer };
    }
    case "updateLayer": {
      const l = pick(layers);
      if (!l) return undefined;
      const props: Record<string, InputValue | null> = {};
      if (chance(0.5)) props.opacity = chance(0.3) ? null : Math.round(rand() * 100) / 100;
      if (chance(0.3)) props.rotation = int(360);
      const op: Op = { op: "updateLayer", component: cid, id: l.id, props };
      if (chance(0.3)) op.name = pick(["Renamed", "Card"])!;
      if (chance(0.3)) op.locked = chance(0.5);
      if (chance(0.3)) op.collapsed = chance(0.5);
      return op;
    }
    case "moveLayer": {
      const l = pick(layers);
      if (!l) return undefined;
      return { op: "moveLayer", component: cid, id: l.id, parent: pick([null, undefined, ...groups.map((g) => g.id)]), index: int(5) };
    }
    case "removeLayer": {
      const l = pick(layers);
      return l ? { op: "removeLayer", component: cid, id: l.id } : undefined;
    }
    case "addPatch": {
      const pcs = ofKind("patchComponent");
      if (chance(0.1) && pcs.length) return { op: "addPatch", component: cid, patch: { type: "component", component: pick(pcs)!, name: "Instance" } };
      const type = pick(["interaction", "switch", "popAnimation", "transition", "add", "javascript", "counter", "delay1", "logger"])!;
      const patch: NewPatch = { type };
      if (chance(0.4)) patch.name = pick(["Tap", "Spring", "Anything Goes"])!;
      if (type === "transition") {
        patch.typeParam = pick(["number", "point", "color"])!;
        const lit = literalFor(patch.typeParam as ValueType);
        if (lit !== undefined) patch.inputs = { start: lit };
      }
      if (type === "add") patch.inputCount = 2 + int(4);
      if (type === "interaction" && layers.length) patch.inputs = { layer: { layer: pick(layers)!.id } };
      if (type === "popAnimation") patch.inputs = { bounciness: int(20) };
      if (type === "javascript") patch.settings = { ports: { inputs: [["count", "number"]], outputs: [["label", "text"]] } };
      if (chance(0.5)) patch.ui = { x: int(800), y: int(400) };
      return { op: "addPatch", component: cid, patch };
    }
    case "updatePatch": {
      const id = pick(patchIds);
      if (!id) return undefined;
      const node = c.patches[id]!;
      const op: Op = { op: "updatePatch", component: cid, id };
      if (chance(0.3)) op.name = pick(["Spring", ""])!;
      if (chance(0.3)) op.muted = chance(0.5);
      if (node.type === "transition" && chance(0.5)) op.typeParam = pick(["number", "point", "color"])!;
      if (node.type === "add" && chance(0.5)) op.inputCount = 2 + int(5);
      if (chance(0.2)) op.settings = chance(0.5) ? { a: int(3) } : { a: null };
      if (chance(0.2)) op.ui = { x: int(500), collapsed: chance(0.5), color: pick(["", "blue"])! };
      return op;
    }
    case "replacePatch": {
      const id = pick(patchIds);
      if (!id) return undefined;
      const type = pick(["switch", "popAnimation", "transition", "add", "counter", "delay1", "logger"].filter((t) => t !== c.patches[id]!.type))!;
      const op: Op = { op: "replacePatch", component: cid, id, patch: { type } };
      if (type === "transition" && chance(0.5)) op.patch.typeParam = pick(["number", "point", "color"])!;
      if (type === "add" && chance(0.5)) op.patch.inputCount = 2 + int(4);
      if (chance(0.2)) op.patch.name = pick(["Spring", ""])!;
      // Carry a value or cable onto a port with another key, like the editor's Replace With.
      const from = pick(Object.keys(c.patches[id]!.inputs));
      if (from && type === "popAnimation" && chance(0.5)) op.inputMap = { [from]: "number" };
      return op;
    }
    case "removePatch": {
      const id = pick(patchIds);
      return id ? { op: "removePatch", component: cid, id } : undefined;
    }
    case "setInput": {
      if (chance(0.5) && patchIds.length) {
        const id = pick(patchIds)!;
        const port = pick(resolveNodePorts(doc, c.patches[id]!, mockRegistry)?.inputs ?? []);
        if (!port) return undefined;
        if (knobLinks.length && chance(0.3)) return { op: "setInput", component: cid, target: `${id}.${port.key}`, value: { link: pick(knobLinks)! } };
        return { op: "setInput", component: cid, target: `${id}.${port.key}`, value: chance(0.2) ? null : (literalFor(port.type) ?? null) };
      }
      const l = pick(layers);
      if (!l) return undefined;
      const prop = pick((resolveLayerProps(doc, cid, l, mockRegistry) ?? []).filter((p) => ["opacity", "position", "color", "enabled", "text", "label", "cornerRadius"].includes(p.key)));
      if (!prop) return undefined;
      return { op: "setInput", component: cid, target: `@${l.id}.${prop.key}`, value: chance(0.2) ? null : (literalFor(prop.type) ?? null) };
    }
    case "connect": {
      const sources: string[] = [...layers.map((l) => `@${l.id}.opacity`), ...Object.keys(c.interface.inputs).map((k) => `$in.${k}`), ...knobLinks];
      for (const id of patchIds) for (const p of resolveNodePorts(doc, c.patches[id]!, mockRegistry)?.outputs ?? []) sources.push(`${id}.${p.key}`);
      const targets: string[] = [...layers.flatMap((l) => [`@${l.id}.opacity`, `@${l.id}.enabled`, `@${l.id}.position`]), ...Object.keys(c.interface.outputs).map((k) => `$out.${k}`)];
      for (const id of patchIds) for (const p of resolveNodePorts(doc, c.patches[id]!, mockRegistry)?.inputs ?? []) targets.push(`${id}.${p.key}`);
      const from = pick(sources);
      const to = pick(targets);
      return from && to ? { op: "connect", component: cid, from, to } : undefined;
    }
    case "disconnect": {
      const linked = listInputs(c).filter((e) => typeof e.value === "object" && e.value !== null && "link" in e.value);
      const e = pick(linked);
      return e ? { op: "disconnect", component: cid, to: targetAddress(e.target) } : undefined;
    }
    case "rename": {
      const id = pick([...layers.map((l) => l.id), ...patchIds]);
      return id ? { op: "rename", component: cid, id, name: pick(["Renamed", "", "Card"])! } : undefined;
    }
    case "addComment":
      return { op: "addComment", component: cid, comment: { text: pick(["Note", "Why this spring?"])!, rect: [int(100), int(100), 200, 80] } };
    case "updateComment": {
      const note = pick(c.comments);
      return note ? { op: "updateComment", component: cid, id: note.id, text: "Edited", color: pick(["", "yellow"])!, rect: [1, 2, 3, 4] } : undefined;
    }
    case "removeComment": {
      const note = pick(c.comments);
      return note ? { op: "removeComment", component: cid, id: note.id } : undefined;
    }
    case "addComponent":
      return { op: "addComponent", component: { name: pick(["Chip", "Logic", "Screen"])!, kind: pick(["layerComponent", "patchComponent", "prototype"] as const)! } };
    case "removeComponent": {
      const id = pick(componentIds.filter((x) => x !== doc.project.root));
      return id ? { op: "removeComponent", id } : undefined;
    }
    case "createComponent": {
      if (chance(0.5) && layers.length) {
        const parent = pick([null, ...groups]);
        const siblings = parent === null ? c.layers : (parent?.children ?? []);
        const chosen = siblings.filter(() => chance(0.5)).map((l) => l.id);
        if (!chosen.length) return undefined;
        return { op: "createComponent", component: cid, name: pick(["Button", "Card Row"])!, layerIds: chosen, patchIds: patchIds.filter(() => chance(0.3)) };
      }
      const chosen = patchIds.filter(() => chance(0.4));
      return chosen.length ? { op: "createComponent", component: cid, name: pick(["Logic", "Spring Group"])!, patchIds: chosen } : undefined;
    }
    case "updateInterface": {
      if (chance(0.25)) {
        // Replace one side with a random subset of its ports (outputs sometimes without their link), plus maybe a new input.
        const side = chance(0.5) ? "inputs" : "outputs";
        const ports: Record<string, InterfacePortInput> = {};
        for (const [key, port] of Object.entries(c.interface[side])) {
          if (!chance(0.6)) continue;
          const { link: _link, ...unlinked } = port;
          ports[key] = chance(0.5) ? port : unlinked;
        }
        const fresh = pick(["label", "value", "enabled"].filter((k) => !Object.hasOwn(c.interface.inputs, k)));
        if (side === "inputs" && fresh && chance(0.5)) ports[fresh] = { key: fresh, name: fresh, type: "number" };
        return { op: "updateInterface", component: cid, replace: true, [side]: ports };
      }
      if (chance(0.5)) {
        const existing = Object.keys(c.interface.inputs);
        if (existing.length && chance(0.4)) return { op: "updateInterface", component: cid, inputs: { [pick(existing)!]: null } };
        const type = pick(["number", "text", "boolean", "color"] as const)!;
        const key = pick(["label", "value", "enabled"])!;
        const port = { key, name: key, type, ...(chance(0.5) ? { default: literalFor(type)! } : {}) };
        return { op: "updateInterface", component: cid, inputs: { [key]: port } };
      }
      const existing = Object.keys(c.interface.outputs);
      if (existing.length && chance(0.4)) return { op: "updateInterface", component: cid, outputs: { [pick(existing)!]: null } };
      const id = pick(patchIds);
      const out = id ? pick(resolveNodePorts(doc, c.patches[id]!, mockRegistry)?.outputs ?? []) : undefined;
      if (!id || !out) return undefined;
      return { op: "updateInterface", component: cid, outputs: { [out.key]: { key: out.key, name: out.name, type: out.type, link: `${id}.${out.key}` } } };
    }
    case "updateComponent":
      return {
        op: "updateComponent",
        id: pick(componentIds)!,
        name: chance(0.5) ? "Renamed" : undefined,
        notes: pick([undefined, "", "Some notes"]),
        size: chance(0.3) ? [int(500) + 1, int(500) + 1] : undefined,
        meta: pick([undefined, undefined, null, {}, { patchEditor: { nodes: { a: [int(100), int(100)] } } }, { zoom: 2, patchEditor: null }]),
      };
    case "setNodePositions": {
      const keys = [...layers.map((l) => `@${l.id}`), "$in", "$out"];
      const positions: Record<string, [number, number] | null> = {};
      for (let i = 0; i <= int(3); i++) positions[pick(keys)!] = chance(0.25) ? null : [int(900) - 100, int(600)];
      if (chance(0.1) && patchIds.length) positions[pick(patchIds)!] = [0, 0];
      return { op: "setNodePositions", component: cid, positions };
    }
    case "setScript":
      return { op: "setScript", file: pick(["a.js", "b.js"])!, source: chance(0.3) ? null : "export default () => {}\n" };
    case "addAsset":
      return { op: "addAsset", asset: { id: pick(["photo", "clip", "tone"])!, kind: "image", name: "Asset", file: `${int(9)}.png`, width: 10, height: 10 } };
    case "removeAsset": {
      const id = pick(Object.keys(doc.assets));
      return id ? { op: "removeAsset", id } : undefined;
    }
    case "setProject":
      return { op: "setProject", changes: pick([{ name: "Renamed Project" }, { background: "#000" }, { fps: 120 as const }, { fps: null as unknown as 60 }, { generator: null as unknown as string }, { generator: "g" }, { device: { preset: "iphone-se", orientation: "landscape" as const } }])! };
    case "addKnob": {
      const type = pick(KNOB_TYPES)!;
      const knob: NewKnob = { name: `${pick(["Commit Distance", "Grab Tilt", "Tint", "Offset", "Label", "Mode"])!}${chance(0.3) ? ` ${int(3)}` : ""}`, type };
      if (type === "enum") knob.options = ENUM_OPTIONS;
      if (chance(0.7)) knob.value = knobValue(type);
      if (chance(0.2) && set) knob.values = { [pick(set.presets)!.id]: knobValue(type) };
      if (hasKnobRange(type) && chance(0.4)) Object.assign(knob, { min: -10, max: 200, step: 1, unit: "pt" });
      if (chance(0.3)) knob.group = pick(["Throw", "Tilt"])!;
      return { op: "addKnob", knob, index: chance(0.5) ? undefined : int(3) };
    }
    case "updateKnob": {
      const k = pick(knobs);
      if (!k) return undefined;
      const op: Op = { op: "updateKnob", id: k.id };
      if (chance(0.3)) op.name = pick(["Renamed Knob", "Tint", k.name])!;
      if (chance(0.3)) op.group = pick([null, "Throw", ""]);
      if (chance(0.2)) op.description = pick([null, "How far the card travels"]);
      if (chance(0.3)) op.type = pick(KNOB_TYPES)!;
      if ((op.type ?? k.type) === "enum" && (op.type === "enum" || chance(0.3))) op.options = pick([ENUM_OPTIONS, [...ENUM_OPTIONS, { key: "c", name: "C" }]])!;
      if (hasKnobRange(op.type ?? k.type) && chance(0.3)) Object.assign(op, { min: pick([null, 0]), max: pick([null, 500]), step: pick([null, 0.5]) });
      if (chance(0.2)) op.index = int(3);
      return op;
    }
    case "removeKnob": {
      const k = pick(knobs);
      return k ? { op: "removeKnob", id: k.id } : undefined;
    }
    case "setKnobValue": {
      const k = pick(knobs);
      if (!k || !set) return undefined;
      return { op: "setKnobValue", id: k.id, value: knobValue(k.type), ...(chance(0.5) ? { preset: pick(set.presets)!.id } : {}) };
    }
    case "addKnobPreset":
      return { op: "addKnobPreset", preset: { name: pick(["Proposal", "Shipped app", "Wild"])!, ...(chance(0.2) ? { locked: true } : {}) }, ...(set && chance(0.4) ? { copyFrom: pick(set.presets)!.id } : {}), ...(chance(0.3) ? { index: int(3) } : {}) };
    case "updateKnobPreset": {
      const p = set ? pick(set.presets) : undefined;
      if (!p) return undefined;
      const op: Op = { op: "updateKnobPreset", id: p.id };
      if (chance(0.4)) op.name = pick(["Renamed Preset", "Proposal", p.name])!;
      if (chance(0.5)) op.locked = chance(0.5);
      if (chance(0.3)) op.index = int(3);
      return op;
    }
    case "removeKnobPreset": {
      const p = set ? pick(set.presets) : undefined;
      return p ? { op: "removeKnobPreset", id: p.id } : undefined;
    }
    case "applyKnobPreset": {
      const p = set ? pick(set.presets) : undefined;
      return p ? { op: "applyKnobPreset", id: p.id } : undefined;
    }
  }
  return undefined;
}

const ENUM_OPTIONS = [
  { key: "a", name: "A" },
  { key: "b", name: "B" },
];

describe("inverse ops (property)", () => {
  it("restores deep-equal documents for random op sequences", () => {
    const succeeded = new Map<string, number>();
    // 59, 71, 275 and 384 once left cables or instance values that no longer fit (a port declared
    // again with another type, one input shared by targets of two types, an input named like a
    // layer property), so a later inverse failed or restored the wrong document.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 59, 71, 275, 384]) {
      const rand = mulberry32(seed);
      const start = mustApply(emptyDoc(), SAMPLE_OPS).doc;
      let doc = start;
      const batch: Op[] = [];
      for (let step = 0; step < 300; step++) {
        const op = randomOp(doc, rand);
        if (!op) continue;
        const r = applyOps(doc, [op], { registry: mockRegistry });
        if (!r.ok) {
          expect(r.errors[0]!.code).not.toBe("internal");
          expect(r.doc).toBe(doc);
          continue;
        }
        succeeded.set(op.op, (succeeded.get(op.op) ?? 0) + 1);
        const undo = applyOps(r.doc, r.inverse, { registry: mockRegistry });
        if (!undo.ok) throw new Error(`seed ${seed} step ${step}: inverse of ${JSON.stringify(op)} failed: ${JSON.stringify(undo.errors)}`);
        expect(undo.doc).toStrictEqual(doc);
        const redo = applyOps(doc, r.applied, { registry: mockRegistry });
        if (!redo.ok) throw new Error(`seed ${seed} step ${step}: redo of ${JSON.stringify(op)} failed: ${JSON.stringify(redo.errors)}`);
        expect(redo.doc).toStrictEqual(r.doc);
        // History replays undo and redo leniently, so what an op drops as a side effect must be spelled out.
        expect(applyOps(doc, r.applied, { registry: mockRegistry, lenient: true }).doc, `lenient redo of ${JSON.stringify(op)}`).toStrictEqual(r.doc);
        expect(applyOps(r.doc, r.inverse, { registry: mockRegistry, lenient: true }).doc, `lenient undo of ${JSON.stringify(op)}`).toStrictEqual(doc);
        batch.push(op);
        doc = r.doc;
      }
      const all = applyOps(start, batch, { registry: mockRegistry });
      expect(all.ok).toBe(true);
      expect(all.doc).toStrictEqual(doc);
      const undoAll = applyOps(all.doc, all.inverse, { registry: mockRegistry });
      if (!undoAll.ok) throw new Error(`seed ${seed}: batch inverse failed: ${JSON.stringify(undoAll.errors)}`);
      expect(undoAll.doc).toStrictEqual(start);
      const files = serializeDocument(doc);
      expect(serializeDocument(parseDocumentFiles(files))).toEqual(files);
    }
    for (const kind of OP_KINDS) expect(succeeded.get(kind) ?? 0, `op "${kind}" never succeeded`).toBeGreaterThan(0);
  });
});
