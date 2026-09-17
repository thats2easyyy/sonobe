/**
 * Publishing ports (Origami's Publish Port): a port inside a component becomes one of the
 * component's published inputs or outputs, which show as properties wherever the component is
 * placed. Pure op builders; the patch editor and the inspector apply them as one undo step each.
 */

import {
  findLayer,
  getPatchSpec,
  isLayerInput,
  isLinkInput,
  listInputs,
  parseAddress,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  targetAddress,
  uniqueId,
  type Component,
  type Id,
  type InputValue,
  type InterfacePort,
  type Op,
  type Registry,
  type SonobeDocument,
  type ValueType,
} from "@sonobe/core";
import { patchTitle } from "./editOps.ts";

/** "in": a published input drives the port. "out": the port drives a published output. */
export type PublishSide = "in" | "out";

export interface PublishPlan {
  ops: Op[];
  /** The published port's key. */
  key: string;
  name: string;
  side: PublishSide;
}

export interface PublishError {
  error: string;
  hint?: string;
}

interface FoundPort {
  key: string;
  name: string;
  type: ValueType;
  default?: unknown;
  /** The patch or layer the port belongs to ("Like Spring"). */
  owner: string;
}

function storedInput(component: Component, address: string): InputValue | undefined {
  const a = parseAddress(address);
  if (!a || a.index !== undefined) return undefined;
  if (a.kind === "patch") return component.patches[a.id]?.inputs[a.key];
  if (a.kind === "layer") return findLayer(component.layers, a.id)?.layer.props[a.key];
  return undefined;
}

function findPort(doc: SonobeDocument, component: Component, registry: Registry, address: string, side: PublishSide): FoundPort | undefined {
  const a = parseAddress(address);
  if (!a || a.index !== undefined) return undefined;
  if (a.kind === "patch") {
    const node = component.patches[a.id];
    if (!node) return undefined;
    const ports = resolveNodePorts(doc, node, registry);
    const port = (side === "in" ? ports?.inputs : ports?.outputs)?.find((p) => p.key === a.key);
    return port ? { key: port.key, name: port.name, type: port.type, default: port.default, owner: patchTitle(node, getPatchSpec(registry, node.type)) } : undefined;
  }
  if (a.kind === "layer") {
    const layer = findLayer(component.layers, a.id)?.layer;
    if (!layer) return undefined;
    const props = resolveLayerProps(doc, component.id, layer, registry) ?? [];
    const candidates = side === "in" ? props : [...resolveLayerOutputs(doc, component.id, layer, registry), ...props];
    const port = candidates.find((p) => p.key === a.key);
    return port ? { key: port.key, name: port.name, type: port.type, default: port.default, owner: layer.name } : undefined;
  }
  return undefined;
}

/** The published port a port already reaches: an input read from "$in.key", or an output a published output links to. */
export function publishedKeyOf(component: Component, address: string, side: PublishSide): string | undefined {
  if (side === "out") return Object.values(component.interface.outputs).find((p) => p.link === address)?.key;
  const stored = storedInput(component, address);
  if (!isLinkInput(stored)) return undefined;
  const a = parseAddress(stored.link);
  return a?.kind === "componentInput" && Object.hasOwn(component.interface.inputs, a.key) ? a.key : undefined;
}

/**
 * Publish a port of a patch or layer inside a component. An input becomes a published input that
 * drives it (keeping its current value as the default); an output becomes a published output.
 */
export function publishPortPlan(doc: SonobeDocument, componentId: Id, registry: Registry, address: string, side: PublishSide): PublishPlan | PublishError {
  const component = doc.components[componentId];
  if (!component) return { error: "There's no component to publish into." };
  if (component.kind === "prototype") return { error: "Only components have published ports.", hint: "Select patches and choose Group into Component, then publish ports inside it." };
  const port = findPort(doc, component, registry, address, side);
  if (!port) return { error: "That port can't be published." };
  if (publishedKeyOf(component, address, side) !== undefined) return { error: `${port.name} is already published.` };
  const taken = side === "in" ? component.interface.inputs : component.interface.outputs;
  const key = uniqueId(port.key, new Set(Object.keys(taken)));
  const name = Object.values(taken).some((p) => p.name === port.name) ? `${port.owner} ${port.name}` : port.name;
  if (side === "out") {
    return { key, name, side, ops: [{ op: "updateInterface", component: componentId, outputs: { [key]: { key, name, type: port.type, link: address } } }] };
  }
  const stored = storedInput(component, address);
  if (isLinkInput(stored)) return { error: `${port.name} is already driven by a cable.`, hint: "Disconnect it first, then publish it." };
  const published: InterfacePort = { key, name, type: port.type };
  const literal = stored !== undefined && !isLayerInput(stored) ? stored : port.default;
  if (literal !== undefined && literal !== null && port.type !== "pulse" && port.type !== "layer") published.default = literal as InputValue;
  return {
    key,
    name,
    side,
    ops: [
      { op: "updateInterface", component: componentId, inputs: { [key]: published } },
      { op: "connect", component: componentId, from: `$in.${key}`, to: address },
    ],
  };
}

/** The same plan without the input's default (for a value core can't store as a default). */
export function withoutDefault(plan: PublishPlan): PublishPlan {
  const ops = plan.ops.map((op): Op => {
    if (op.op !== "updateInterface" || !op.inputs) return op;
    const inputs = Object.fromEntries(Object.entries(op.inputs).map(([k, p]) => [k, p ? (({ default: _default, ...rest }) => rest)(p) : p]));
    return { ...op, inputs };
  });
  return { ...plan, ops };
}

/**
 * Remove a published port. The ports a removed input drove get its default back as their own value,
 * and cables from it (inside, and into the component where it's placed) go away with it.
 */
export function unpublishOps(component: Component, key: string, side: PublishSide): Op[] {
  if (side === "out") return Object.hasOwn(component.interface.outputs, key) ? [{ op: "updateInterface", component: component.id, outputs: { [key]: null } }] : [];
  const port = component.interface.inputs[key];
  if (!port) return [];
  const restores: Op[] = [];
  for (const entry of listInputs(component)) {
    if (!isLinkInput(entry.value) || entry.value.link !== `$in.${key}` || entry.target.kind === "componentOutput") continue;
    restores.push({ op: "setInput", component: component.id, target: targetAddress(entry.target), value: port.default ?? null });
  }
  return [...restores, { op: "updateInterface", component: component.id, inputs: { [key]: null } }];
}

/** Rename a published port or change an input's default (null removes it). */
export function updatePublishedOps(component: Component, side: PublishSide, key: string, changes: { name?: string; default?: InputValue | null }): Op[] {
  const current = (side === "in" ? component.interface.inputs : component.interface.outputs)[key];
  if (!current) return [];
  const next: InterfacePort = { ...current };
  if (changes.name !== undefined) next.name = changes.name;
  if (changes.default === null) delete next.default;
  else if (changes.default !== undefined) next.default = changes.default;
  return [side === "in" ? { op: "updateInterface", component: component.id, inputs: { [key]: next } } : { op: "updateInterface", component: component.id, outputs: { [key]: next } }];
}
