/**
 * Viewer model: device settings ↔ presets and ops, fit scaling, which scene nodes to outline for
 * highlighted layers, which layers take touches (hit target overlay), the empty-loop notice, and QR
 * code paths.
 */

import { DEVICE_PRESETS, findLayer, getDevicePreset, isLayerInput, layerDisplayName, type DevicePreset, type DeviceSettings, type Diagnostic, type Id, type Op, type SonobeDocument } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";

export type ViewerZoom = "fit" | "actual";

/** The preset for device settings, with a size override applied. */
export function presetForDevice(device: DeviceSettings): DevicePreset {
  const preset = getDevicePreset(device.preset);
  return device.size ? { ...preset, size: [device.size[0], device.size[1]] } : preset;
}

/** True when the settings name a known preset. */
export function isKnownPreset(id: string): boolean {
  return DEVICE_PRESETS.some((d) => d.id === id);
}

/** Largest scale that fits `content` inside `available` minus `padding` on each side, capped at `max`. */
export function fitScale(content: readonly [number, number], available: readonly [number, number], padding = 24, max = 1): number {
  const w = available[0] - padding * 2;
  const h = available[1] - padding * 2;
  if (content[0] <= 0 || content[1] <= 0 || w <= 0 || h <= 0) return Math.min(max, 0.25);
  return Math.max(0.05, Math.min(max, w / content[0], h / content[1]));
}

/** setProject changing the device preset. Keeps the orientation; keeps a size override only for Custom. */
export function devicePresetOps(device: DeviceSettings, presetId: string): Op[] {
  const next: DeviceSettings = { preset: presetId };
  if (device.orientation === "landscape") next.orientation = "landscape";
  if (presetId === "custom" && device.size) next.size = [device.size[0], device.size[1]];
  return [{ op: "setProject", changes: { device: next } }];
}

/** setProject flipping portrait ↔ landscape. */
export function rotateDeviceOps(device: DeviceSettings): Op[] {
  const next: DeviceSettings = { ...device };
  if (device.orientation === "landscape") delete next.orientation;
  else next.orientation = "landscape";
  return [{ op: "setProject", changes: { device: next } }];
}

/** Layers the component's patches read touches from (`{ layer }` inputs). */
export function interactiveLayerIds(doc: SonobeDocument, componentId: Id = doc.project.root): Set<Id> {
  const out = new Set<Id>();
  const component = doc.components[componentId];
  if (!component) return out;
  for (const patch of Object.values(component.patches)) {
    for (const value of Object.values(patch.inputs)) if (isLayerInput(value)) out.add(value.layer);
  }
  return out;
}

/**
 * Where a component's layers show up in the running prototype: "root" matches the root component's
 * own nodes; "instance" matches nodes inside component instances ("card/title").
 */
export type HighlightScope = "root" | "instance";

/** Scene nodes drawn for any of `ids` in a scope (every loop copy). */
export function nodesForLayers(scene: SceneFrame | null, ids: ReadonlySet<Id>, scope: HighlightScope): SceneNode[] {
  const out: SceneNode[] = [];
  if (!scene || ids.size === 0) return out;
  const visit = (nodes: readonly SceneNode[], hidden: boolean) => {
    for (const node of nodes) {
      const isHidden = hidden || !node.visible;
      if (!isHidden && ids.has(node.layerId) && node.key.includes("/") === (scope === "instance")) out.push(node);
      if (node.children.length) visit(node.children, isHidden);
    }
  };
  visit(scene.roots, false);
  return out;
}

/** Scene keys for `ids` in the root scope (for the renderer's hit target overlay). */
export function sceneKeysForLayers(scene: SceneFrame | null, ids: ReadonlySet<Id>): string[] {
  return nodesForLayers(scene, ids, "root").map((n) => n.key);
}

/** A node's box corners in prototype coordinates (top-left, top-right, bottom-right, bottom-left). */
export function nodeCorners(node: Pick<SceneNode, "worldTransform" | "width" | "height">): [number, number][] {
  const m = node.worldTransform;
  const corner = (x: number, y: number): [number, number] => {
    const w = m[3]! * x + m[7]! * y + m[15]!;
    const d = w === 0 ? 1 : w;
    return [(m[0]! * x + m[4]! * y + m[12]!) / d, (m[1]! * x + m[5]! * y + m[13]!) / d];
  };
  return [corner(0, 0), corner(node.width, 0), corner(node.width, node.height), corner(0, node.height)];
}

/** SVG polygon points for a node's box in prototype coordinates. */
export function outlinePoints(node: Pick<SceneNode, "worldTransform" | "width" | "height">): string {
  return nodeCorners(node)
    .map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`)
    .join(" ");
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a layer shows up on screen: the union of its visible scene nodes (every loop copy), mapped
 * through the stage's client rect. `scale` is CSS pixels per prototype point. Root-component nodes
 * win; nodes inside component instances are used when the root has none. Null when it isn't drawn.
 */
export function layerScreenRect(scene: SceneFrame | null, layerId: Id, stage: ScreenRect): (ScreenRect & { scale: number }) | null {
  if (!scene || scene.size[0] <= 0 || scene.size[1] <= 0 || stage.width <= 0 || stage.height <= 0) return null;
  const ids = new Set([layerId]);
  let nodes = nodesForLayers(scene, ids, "root");
  if (nodes.length === 0) nodes = nodesForLayers(scene, ids, "instance");
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    for (const [x, y] of nodeCorners(node)) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX === Infinity) return null;
  const sx = stage.width / scene.size[0];
  const sy = stage.height / scene.size[1];
  return { x: stage.x + minX * sx, y: stage.y + minY * sy, width: (maxX - minX) * sx, height: (maxY - minY) * sy, scale: sx };
}

/** "Waiting for a phone" / "1 phone connected" / "3 phones connected". */
export function phoneClientsLabel(clients: number): string {
  if (clients <= 0) return "Waiting for a phone";
  return `${clients} ${clients === 1 ? "phone" : "phones"} connected`;
}

/** "60 fps" / "59.8 fps". */
export function formatFps(fps: number): string {
  return `${Number.isInteger(fps) ? fps : fps.toFixed(1)} fps`;
}

export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isFloatingRect(value: unknown): value is FloatingRect {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k]));
}

/** Keep a floating window at least `min` in size and inside the viewport (with `margin`). */
export function clampFloatingRect(rect: FloatingRect, viewport: readonly [number, number], min: readonly [number, number], margin = 8): FloatingRect {
  const width = Math.max(min[0], Math.min(rect.width, viewport[0] - margin * 2));
  const height = Math.max(min[1], Math.min(rect.height, viewport[1] - margin * 2));
  const x = Math.min(Math.max(margin, rect.x), Math.max(margin, viewport[0] - width - margin));
  const y = Math.min(Math.max(margin, rect.y), Math.max(margin, viewport[1] - height - margin));
  return { x, y, width, height };
}

export interface EmptyLoopNotice {
  /** "Card has no copies" (the first one; layers before components). */
  label: string;
  diagnostic: Diagnostic;
  /** Active empty_loop warnings in all. */
  count: number;
}

/**
 * The viewer's notice while the running prototype has an empty_loop warning: something bound to a
 * loop draws no copies. Prefers a layer (what's missing on screen) over the component behind it.
 */
export function emptyLoopNotice(diagnostics: readonly Diagnostic[], doc: SonobeDocument): EmptyLoopNotice | null {
  const empty = diagnostics.filter((d) => d.code === "empty_loop");
  if (!empty.length) return null;
  const layerOf = (d: Diagnostic) => {
    const component = doc.components[d.component];
    for (const id of d.itemIds) {
      const found = component ? findLayer(component.layers, id) : undefined;
      if (found) return found.layer;
    }
    return undefined;
  };
  const diagnostic = empty.find((d) => layerOf(d)) ?? empty[0]!;
  const layer = layerOf(diagnostic);
  const patch = doc.components[diagnostic.component]?.patches[diagnostic.itemIds[0] ?? ""];
  const name = layer ? layerDisplayName(layer) : patch ? (patch.name || diagnostic.itemIds[0]!) : "A loop";
  return { label: `${name} has no copies`, diagnostic, count: empty.length };
}

/** SVG path drawing the dark modules of a QR matrix (1 unit per module, `margin` quiet zone). */
export function qrPath(size: number, isDark: (row: number, col: number) => boolean, margin = 0): string {
  const parts: string[] = [];
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && isDark(row, col)) col++;
      parts.push(`M${start + margin} ${row + margin}h${col - start}v1h${start - col}z`);
    }
  }
  return parts.join("");
}
