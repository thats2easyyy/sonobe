/** Build test documents through core applyOps, so every document a test runs is a valid one. */

import {
  applyOps,
  createEmptyDocument,
  isLinkInput,
  type ComponentKind,
  type Id,
  type InputValue,
  type InterfacePort,
  type NewLayer,
  type NewPatch,
  type Op,
  type PatchNode,
  type Registry,
  type SonobeDocument,
  type ValueType,
} from "@sonobe/core";
import { createMockRegistry } from "./mockDefinitions.ts";

export interface PatchInput {
  type: string;
  name?: string;
  typeParam?: string;
  inputCount?: number;
  /** Literals, `{ "layer": id }`, or links (`{ "link": "a.output" }`, `"$in.key"`, `"@layer.prop"`). */
  inputs?: Record<string, InputValue>;
  settings?: PatchNode["settings"];
  /** For type "component". */
  component?: Id;
  muted?: boolean;
}

export interface GraphInput {
  /** Layers back → front. Layers holding links need an id. */
  layers?: NewLayer[];
  patches?: Record<Id, PatchInput>;
  /** Extra connections as [from, to] addresses. */
  connections?: [from: string, to: string][];
}

export interface ComponentInput extends GraphInput {
  id: Id;
  name?: string;
  kind: Exclude<ComponentKind, "prototype">;
  size?: [number, number];
  inputs?: Record<string, Omit<InterfacePort, "key" | "name" | "link"> & { name?: string }>;
  outputs?: Record<string, { type: ValueType; name?: string; link?: string }>;
}

export interface DocInput extends GraphInput {
  name?: string;
  /** Device preset (default "custom", 390×844). */
  device?: string;
  fps?: 60 | 120;
  background?: string;
  /** Added in order before the root graph (list dependencies first). */
  components?: ComponentInput[];
  /** Extra ops applied last. */
  ops?: Op[];
}

function graphOps(component: Id | undefined, graph: GraphInput): Op[] {
  const at = component === undefined ? {} : { component };
  const add: Op[] = [];
  const links: Op[] = [];
  const strip = (layer: NewLayer): NewLayer => {
    const props: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(layer.props ?? {})) {
      if (!isLinkInput(value)) {
        props[key] = value;
        continue;
      }
      if (!layer.id) throw new Error(`buildDoc: layer "${layer.name ?? layer.type}" needs an id to hold a link on "${key}".`);
      links.push({ op: "setInput", ...at, target: `@${layer.id}.${key}`, value });
    }
    const out: NewLayer = { ...layer, props };
    if (layer.children) out.children = layer.children.map(strip);
    return out;
  };
  for (const layer of graph.layers ?? []) add.push({ op: "addLayer", ...at, layer: strip(layer) });
  for (const [id, p] of Object.entries(graph.patches ?? {})) {
    const inputs: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(p.inputs ?? {})) {
      if (isLinkInput(value)) links.push({ op: "setInput", ...at, target: `${id}.${key}`, value });
      else inputs[key] = value;
    }
    const patch: NewPatch = { id, type: p.type, inputs };
    if (p.name !== undefined) patch.name = p.name;
    if (p.typeParam !== undefined) patch.typeParam = p.typeParam;
    if (p.inputCount !== undefined) patch.inputCount = p.inputCount;
    if (p.settings !== undefined) patch.settings = p.settings;
    if (p.component !== undefined) patch.component = p.component;
    add.push({ op: "addPatch", ...at, patch });
    if (p.muted) add.push({ op: "updatePatch", ...at, id, muted: true });
  }
  for (const [from, to] of graph.connections ?? []) links.push({ op: "connect", ...at, from, to });
  return [...add, ...links];
}

function componentOps(c: ComponentInput): Op[] {
  const component: Extract<Op, { op: "addComponent" }>["component"] = { id: c.id, name: c.name ?? c.id, kind: c.kind };
  if (c.size) component.size = c.size;
  const ops: Op[] = [{ op: "addComponent", component }];
  if (c.inputs && Object.keys(c.inputs).length) {
    const inputs: Record<string, InterfacePort> = {};
    for (const [key, p] of Object.entries(c.inputs)) inputs[key] = { ...p, key, name: p.name ?? key };
    ops.push({ op: "updateInterface", component: c.id, inputs });
  }
  ops.push(...graphOps(c.id, c));
  if (c.outputs && Object.keys(c.outputs).length) {
    const outputs: Record<string, InterfacePort> = {};
    for (const [key, p] of Object.entries(c.outputs)) {
      const port: InterfacePort = { key, name: p.name ?? key, type: p.type };
      if (p.link !== undefined) port.link = p.link;
      outputs[key] = port;
    }
    ops.push({ op: "updateInterface", component: c.id, outputs });
  }
  return ops;
}

/**
 * Build a document from a compact description: components first (in order), then the root
 * graph (layers, patches, links, connections), then extra ops. Throws with core's errors when
 * any op fails, so invalid wiring never reaches a test runtime.
 */
export function buildDoc(input: DocInput = {}, registry: Registry = createMockRegistry()): SonobeDocument {
  const doc = createEmptyDocument({ name: input.name ?? "Test", device: input.device ?? "custom", fps: input.fps });
  const ops: Op[] = [];
  if (input.background !== undefined) ops.push({ op: "setProject", changes: { background: input.background } });
  for (const c of input.components ?? []) ops.push(...componentOps(c));
  ops.push(...graphOps(undefined, input));
  ops.push(...(input.ops ?? []));
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(`buildDoc failed:\n${JSON.stringify(result.errors, null, 2)}`);
  return result.doc;
}
