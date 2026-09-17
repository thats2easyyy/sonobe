/**
 * Viewer model: device settings ↔ presets and ops, fit scaling, which scene nodes to outline for
 * highlighted layers, which layers take touches (hit target overlay), and QR code paths.
 */

import { DEVICE_PRESETS, getDevicePreset, isLayerInput, type DevicePreset, type DeviceSettings, type Id, type Op, type SonobeDocument } from "@sonobe/core";
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

/** SVG polygon points for a node's box in prototype coordinates. */
export function outlinePoints(node: Pick<SceneNode, "worldTransform" | "width" | "height">): string {
  const m = node.worldTransform;
  const corner = (x: number, y: number) => {
    const w = m[3]! * x + m[7]! * y + m[15]!;
    const d = w === 0 ? 1 : w;
    const px = (m[0]! * x + m[4]! * y + m[12]!) / d;
    const py = (m[1]! * x + m[5]! * y + m[13]!) / d;
    return `${Math.round(px * 100) / 100},${Math.round(py * 100) / 100}`;
  };
  return [corner(0, 0), corner(node.width, 0), corner(node.width, node.height), corner(0, node.height)].join(" ");
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
