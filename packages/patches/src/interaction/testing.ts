/**
 * Test rig for interaction patches: the patch harness with real engine pointer, keyboard, and wheel
 * trackers behind `services`, hit testing over axis-aligned layer rectangles.
 */

import type { LayerRef } from "@sonobe/core";
import { KeyboardTracker, PointerTracker, WheelTracker } from "@sonobe/engine";
import type { HitTarget, InputEvent, LayerInfoSnapshot, PatchDefinition, PointerSnapshot, RuntimeServices } from "@sonobe/engine";
import { createPatchHarness } from "../infra/index.ts";
import type { HarnessFrame, PatchHarness, PatchHarnessOptions } from "../infra/index.ts";

export interface RigLayer {
  id: string;
  /** Top-left and size in prototype coordinates. */
  rect: [x: number, y: number, width: number, height: number];
  parent?: string;
  /** Layer scale reported by layerInfo (default [1, 1]); hit testing ignores it. */
  scale?: [number, number];
  /** Loop copy index: the scene key becomes `id#instance`. */
  instance?: number;
}

export interface RigStep {
  events?: readonly InputEvent[];
  inputs?: Record<string, unknown>;
  pulses?: readonly string[];
  dt?: number;
}

export interface InteractionRig<S> {
  readonly harness: PatchHarness<S>;
  readonly pointer: PointerTracker;
  step(options?: RigStep): HarnessFrame;
  /** Step `frames` times; options apply to the first frame only. */
  run(frames: number, options?: RigStep): HarnessFrame;
  /** Step once per frame of an event script (the @sonobe/engine/testing generators). */
  script(frames: readonly (readonly InputEvent[])[]): HarnessFrame[];
  setLayers(layers: RigLayer[]): void;
}

export interface InteractionRigOptions extends PatchHarnessOptions {
  layers?: RigLayer[];
  /** Device screen size (default: the harness device). */
  screen?: [number, number];
}

const keyOf = (layer: { id?: string; layerId?: string; instance?: number }) => {
  const id = layer.id ?? layer.layerId ?? "";
  return layer.instance === undefined ? id : `${id}#${layer.instance}`;
};

/** A harness for `definition` whose pointer, keyboard, wheel, and layerInfo services follow dispatched events. */
export function createInteractionRig<S>(definition: PatchDefinition<S>, options: InteractionRigOptions = {}): InteractionRig<S> {
  let layers = options.layers ?? [];
  const pointer = new PointerTracker();
  const keyboard = new KeyboardTracker();
  const wheel = new WheelTracker();

  const find = (ref: LayerRef): RigLayer | undefined =>
    layers.find((l) => keyOf(l) === keyOf(ref)) ?? (ref.instance !== undefined ? layers.find((l) => l.id === ref.layerId && l.instance === undefined) : undefined);

  const hitTest = (x: number, y: number): HitTarget[] => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]!;
      const [lx, ly, w, h] = layer.rect;
      if (x < lx || x > lx + w || y < ly || y > ly + h) continue;
      const chain: HitTarget[] = [{ key: keyOf(layer), layerId: layer.id }];
      let parent = layer.parent;
      const seen = new Set<string>();
      while (parent !== undefined && !seen.has(parent)) {
        seen.add(parent);
        const found = find({ layerId: parent, ...(layer.instance === undefined ? {} : { instance: layer.instance }) });
        if (!found) break;
        chain.push({ key: keyOf(found), layerId: found.id });
        parent = found.parent;
      }
      return chain;
    }
    return [];
  };

  const refOf = (layer: RigLayer): LayerRef => (layer.instance === undefined ? { layerId: layer.id } : { layerId: layer.id, instance: layer.instance });

  const services: Partial<RuntimeServices> = {
    pointer: (ref): PointerSnapshot => {
      if (!ref) return pointer.snapshot(null);
      const layer = find(ref);
      if (!layer) return pointer.snapshot(" none", null, true);
      const [x, y] = layer.rect;
      return pointer.snapshot(keyOf(layer), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, 0, 1], true);
    },
    pointers: (ref) => {
      if (!ref) return pointer.pointers(null);
      const layer = find(ref);
      return layer ? pointer.pointers(keyOf(layer), true) : [];
    },
    keyboard: () => keyboard.snapshot(),
    wheel: () => wheel.snapshot(),
    layerInfo: (ref): LayerInfoSnapshot | undefined => {
      const layer = find(ref);
      if (!layer) return undefined;
      const [x, y, w, h] = layer.rect;
      const parent = layer.parent !== undefined ? find({ layerId: layer.parent, ...(layer.instance === undefined ? {} : { instance: layer.instance }) }) : undefined;
      return {
        type: "rectangle",
        enabled: true,
        position: parent ? [x - parent.rect[0], y - parent.rect[1]] : [x, y],
        size: [w, h],
        scale: layer.scale ?? [1, 1],
        anchor: [0, 0],
        parent: parent ? refOf(parent) : null,
        worldTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1],
        contentSize: [w, h],
      };
    },
    ...options.services,
  };
  const harness = createPatchHarness(definition, { ...options, services });
  if (options.screen) {
    const device = harness.services.device;
    const screen = options.screen;
    harness.services.device = () => ({ ...device(), screenSize: [screen[0], screen[1]] });
  }
  const fps = options.fps !== undefined && options.fps > 0 ? options.fps : 60;

  const step = (stepOptions: RigStep = {}): HarnessFrame => {
    const dt = stepOptions.dt ?? 1 / fps;
    const trackerDt = harness.frame === 0 ? 0 : dt;
    const events = stepOptions.events ?? [];
    pointer.update(events, hitTest, trackerDt);
    keyboard.update(events);
    wheel.update(events, trackerDt);
    const frameOptions: { inputs?: Record<string, unknown>; pulses?: readonly string[]; dt: number } = { dt };
    if (stepOptions.inputs) frameOptions.inputs = stepOptions.inputs;
    if (stepOptions.pulses) frameOptions.pulses = stepOptions.pulses;
    const frame = harness.step(frameOptions);
    pointer.endFrame();
    keyboard.endFrame();
    wheel.endFrame();
    return frame;
  };

  return {
    harness,
    pointer,
    step,
    run(frames, runOptions = {}) {
      let last = step(runOptions);
      for (let i = 1; i < frames; i++) last = step(runOptions.dt !== undefined ? { dt: runOptions.dt } : {});
      return last;
    },
    script(frames) {
      return frames.map((events) => step({ events }));
    },
    setLayers(next) {
      layers = next;
    },
  };
}
