/** Document construction and component queries (ARCHITECTURE §3.1, §3.4). */

import { DEFAULT_DEVICE, getDevicePreset } from "./devices.ts";
import { allLayers, COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE } from "./registry.ts";
import type { Component, ComponentKind, DeviceSettings, Id, SonobeDocument } from "./types.ts";

/** Current on-disk format version for project and component files. */
export const FORMAT_VERSION = 1;
export const ROOT_COMPONENT_ID = "main";
export const GENERATOR = "Sonobe 0.1.0";
/** Default artboard size for new layer components. */
export const DEFAULT_LAYER_COMPONENT_SIZE: [number, number] = [200, 100];

/** Screen size in points for device settings (override, orientation applied). */
export function deviceScreenSize(device: DeviceSettings): [number, number] {
  const [w, h] = device.size ?? getDevicePreset(device.preset).size;
  return device.orientation === "landscape" ? [Math.max(w, h), Math.min(w, h)] : [w, h];
}

export interface NewComponentOptions {
  id: Id;
  name: string;
  kind: ComponentKind;
  size?: [number, number];
  notes?: string;
}

/** A new, empty component. */
export function newComponent(options: NewComponentOptions): Component {
  const component: Component = {
    formatVersion: FORMAT_VERSION,
    id: options.id,
    name: options.name,
    kind: options.kind,
    interface: { inputs: {}, outputs: {} },
    layers: [],
    patches: {},
    comments: [],
  };
  if (options.notes) component.notes = options.notes;
  if (options.size) component.size = [options.size[0], options.size[1]];
  else if (options.kind === "layerComponent") component.size = [...DEFAULT_LAYER_COMPONENT_SIZE];
  return component;
}

export interface CreateDocumentOptions {
  name?: string;
  /** Device preset id (defaults to DEFAULT_DEVICE). */
  device?: string;
  orientation?: "portrait" | "landscape";
  fps?: 60 | 120;
  generator?: string;
}

/** A new document with a root "main" prototype sized to the device preset. */
export function createEmptyDocument(options: CreateDocumentOptions = {}): SonobeDocument {
  const device: DeviceSettings = { preset: getDevicePreset(options.device ?? DEFAULT_DEVICE).id };
  if (options.orientation === "landscape") device.orientation = "landscape";
  const project: SonobeDocument["project"] = {
    formatVersion: FORMAT_VERSION,
    name: options.name ?? "Untitled",
    generator: options.generator ?? GENERATOR,
    root: ROOT_COMPONENT_ID,
    device,
  };
  if (options.fps) project.fps = options.fps;
  const main = newComponent({ id: ROOT_COMPONENT_ID, name: "Main", kind: "prototype", size: deviceScreenSize(device) });
  return { project, components: { [ROOT_COMPONENT_ID]: main }, scripts: {}, assets: {} };
}

/** A component by id (defaults to the root component). */
export function getComponent(doc: SonobeDocument, id?: Id): Component | undefined {
  return doc.components[id ?? doc.project.root];
}

export function getRootComponent(doc: SonobeDocument): Component | undefined {
  return doc.components[doc.project.root];
}

/** Component ids: root first, then the rest sorted by id. */
export function listComponentIds(doc: SonobeDocument): Id[] {
  const ids = Object.keys(doc.components).sort();
  const root = doc.project.root;
  return ids.includes(root) ? [root, ...ids.filter((id) => id !== root)] : ids;
}

export interface InstanceRef {
  /** Component that contains the instance. */
  componentId: Id;
  kind: "layer" | "patch";
  id: Id;
}

/** Every layer instance and component patch that renders `targetId`. */
export function findComponentInstances(doc: SonobeDocument, targetId: Id): InstanceRef[] {
  const out: InstanceRef[] = [];
  for (const componentId of listComponentIds(doc)) {
    const c = doc.components[componentId]!;
    for (const l of allLayers(c.layers)) {
      if (l.type === COMPONENT_INSTANCE_LAYER_TYPE && l.component === targetId) out.push({ componentId, kind: "layer", id: l.id });
    }
    for (const [id, p] of Object.entries(c.patches)) {
      if (p.type === COMPONENT_PATCH_TYPE && p.component === targetId) out.push({ componentId, kind: "patch", id });
    }
  }
  return out;
}

/** Components that `componentId` instantiates, directly or transitively. */
export function componentDependencies(doc: SonobeDocument, componentId: Id): Set<Id> {
  const seen = new Set<Id>();
  const visit = (id: Id) => {
    const c = doc.components[id];
    if (!c) return;
    const direct: Id[] = [];
    for (const l of allLayers(c.layers)) if (l.type === COMPONENT_INSTANCE_LAYER_TYPE && l.component) direct.push(l.component);
    for (const p of Object.values(c.patches)) if (p.type === COMPONENT_PATCH_TYPE && p.component) direct.push(p.component);
    for (const d of direct) {
      if (seen.has(d)) continue;
      seen.add(d);
      visit(d);
    }
  };
  visit(componentId);
  return seen;
}

/** True when instantiating `instantiatedId` inside `hostId` would make a component contain itself. */
export function wouldCreateComponentCycle(doc: SonobeDocument, hostId: Id, instantiatedId: Id): boolean {
  return hostId === instantiatedId || componentDependencies(doc, instantiatedId).has(hostId);
}
