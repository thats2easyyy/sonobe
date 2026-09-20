/**
 * Layer resolution and SceneFrame emission: resolve props per layer (literals, links, defaults),
 * replicate layers bound to loops, render component instances, run layout, and build scene nodes
 * with local and world transforms plus the layer-info snapshots patches read on the next frame.
 */

import type { Color, Id, LayerRef, Value } from "@sonobe/core";
import { computeLayout, type LayoutNode } from "../layout/computeLayout.ts";
import { compose, multiply } from "../math/matrix.ts";
import { finiteOr, toVec2 } from "../math/vec.ts";
import type { LayerInfoSnapshot, Loop, SceneFrame, SceneNode, TextMeasurer } from "../types.ts";
import type { Binding, CLayer, InstancePath, Scope } from "./graph.ts";
import { isLoop, MAX_LOOP_LENGTH } from "./loop.ts";
import { coerceValue } from "./values.ts";

export interface SceneEnv {
  root: Scope;
  rootPath: InstancePath;
  frame: number;
  time: number;
  size: [number, number];
  background: Color;
  measurer: TextMeasurer;
  /** `wholeLoop`: the prop takes the whole loop, so a layer that drew 0 copies reads as an empty loop, not one reference. */
  read(binding: Binding, path: InstancePath, wholeLoop?: boolean): Value | Loop | undefined;
  instancePaths(scope: Scope, host: InstancePath): { paths: readonly InstancePath[]; replicated: boolean };
  issue(code: string, message: string, layerId: Id): void;
  /**
   * A layer bound to loops made 0 copies. `emptyProp` is the index in `layer.bound` of the first prop
   * holding an empty loop (-1: its component instance has 0 copies); `others` is the longest
   * non-empty loop it erased (0 when there was none).
   */
  emptyCopies?(layer: CLayer, path: InstancePath, emptyProp: number, others: number): void;
  /** Create a layer reference scoped to a scene-key prefix ("" at the root, "card#2/" inside an instance). */
  layerRef?(layerId: Id, instance: number | undefined, prefix: string): LayerRef;
  /**
   * A pulse-typed prop bound on one copy (a Text Field's Set Text), with its value this frame.
   * `pulseSource`: a pulse output drives it, so true means it fired; otherwise it fires when it turns on.
   */
  pulseProp?(key: string, prop: string, value: Value, pulseSource: boolean): void;
}

export interface SceneBuild {
  scene: SceneFrame;
  /** Every scene node by key. */
  nodes: Map<string, SceneNode>;
  /** Layer geometry by scene key (read by patches on the next frame). */
  info: Map<string, LayerInfoSnapshot>;
  /** Copy counts of replicated layers (and their descendants) by prefixed layer id: "card", "card#2/badge". */
  counts: Map<string, number>;
}

interface Pending extends LayoutNode {
  key: string;
  type: string;
  layer: CLayer;
  props: Record<string, Value>;
  children: Pending[];
}

const ROOT_KEY = " root";

/**
 * A scene node's props with the inherited layer defaults copied in as own properties, for JSON,
 * structured clone, or Object.keys. Reading a prop by key needs no copy.
 */
export function plainProps(props: Readonly<Record<string, Value>>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const key in props) out[key] = props[key]!;
  return out;
}

/** A copy of a frame whose nodes have plain props (see plainProps), ready to serialize. */
export function plainSceneFrame(frame: SceneFrame): SceneFrame {
  const plain = (node: SceneNode): SceneNode => ({ ...node, props: plainProps(node.props), children: node.children.map(plain) });
  return { ...frame, roots: frame.roots.map(plain) };
}

/** Split a scene key ("card#2/title#1") into its prefix ("card#2/") and loop instance (1). */
export function splitSceneKey(key: string): { prefix: string; instance: number | undefined } {
  const slash = key.lastIndexOf("/");
  const last = key.slice(slash + 1);
  const hash = last.lastIndexOf("#");
  const instance = hash >= 0 ? Number(last.slice(hash + 1)) : undefined;
  return { prefix: slash >= 0 ? key.slice(0, slash + 1) : "", instance: instance !== undefined && Number.isInteger(instance) ? instance : undefined };
}

/** Resolve every layer, lay the tree out, and emit the SceneFrame. */
export function buildScene(env: SceneEnv): SceneBuild {
  const counts = new Map<string, number>();
  const nodes = new Map<string, SceneNode>();
  const info = new Map<string, LayerInfoSnapshot>();
  const makeRef = env.layerRef ?? ((layerId: Id, instance: number | undefined): LayerRef => (instance === undefined ? { layerId } : { layerId, instance }));

  const resolve = (layers: readonly CLayer[], path: InstancePath, prefix: string, inherited: { index: number; count: number } | null, out: Pending[]): void => {
    for (const layer of layers) {
      const bound = layer.bound;
      const values = new Array<Value | Loop>(bound.length);
      let looping = false;
      let empty = false;
      let max = 0;
      for (let j = 0; j < bound.length; j++) {
        const p = bound[j]!;
        const b = p.binding;
        let v = b.kind === "const" ? b.value : env.read(b, path, p.wholeLoop);
        if (v === undefined) v = layer.defaults[p.key];
        else if (b.kind !== "const" && b.type !== p.type) {
          // A linked null into a prop whose default is null (cornerRadii, image...) means "unset", not a zero value.
          v = v === null && layer.defaults[p.key] === null ? null : coerceValue(v, b.type, p.type);
        }
        values[j] = v;
        if (!inherited && !p.wholeLoop && isLoop(v)) {
          looping = true;
          if (v.items.length === 0) empty = true;
          else if (v.items.length > max) max = v.items.length;
        }
      }
      const inst = layer.instance ? env.instancePaths(layer.instance, path) : null;
      if (!inherited && inst?.replicated) {
        looping = true;
        if (inst.paths.length === 0) empty = true;
        else if (inst.paths.length > max) max = inst.paths.length;
      }
      let count = 1;
      if (looping) {
        count = empty ? 0 : max;
        if (count === 0 && env.emptyCopies) {
          let emptyProp = -1;
          for (let j = 0; j < bound.length && emptyProp < 0; j++) {
            const v = values[j];
            if (!bound[j]!.wholeLoop && isLoop(v) && v.items.length === 0) emptyProp = j;
          }
          env.emptyCopies(layer, path, emptyProp, max);
        }
        if (count > MAX_LOOP_LENGTH) {
          env.issue("loop_limit", `Layer "${layer.id}" is bound to a loop of ${count} items; layers replicate at most ${MAX_LOOP_LENGTH} times.`, layer.id);
          count = MAX_LOOP_LENGTH;
        }
      }
      const baseKey = prefix + layer.id;
      if (looping) counts.set(baseKey, count);
      else if (inherited) counts.set(baseKey, inherited.count);
      for (let n = 0; n < count; n++) {
        const index = looping ? n : (inherited?.index ?? 0);
        const key = looping || inherited ? `${baseKey}#${index}` : baseKey;
        // Defaults come through the prototype and bound values are own properties, so a layer replicated
        // thousands of times doesn't copy every default per copy per frame. Enumerate with for...in, or
        // plainProps before JSON or structured clone.
        const props = Object.create(layer.defaults) as Record<string, Value>;
        for (let j = 0; j < bound.length; j++) {
          const p = bound[j]!;
          const v = values[j];
          if (p.wholeLoop) props[p.key] = isLoop(v) ? [...v.items] : v;
          else if (isLoop(v)) props[p.key] = v.items.length ? v.items[index % v.items.length] : layer.defaults[p.key];
          else props[p.key] = v;
          if (p.type === "pulse" && env.pulseProp) env.pulseProp(key, p.key, props[p.key]!, p.binding.pulse);
        }
        const pending: Pending = { key, type: layer.type, layer, props, children: [] };
        if (layer.instance && inst && inst.paths.length) {
          const innerPath = inst.paths[inst.replicated ? index % inst.paths.length : 0]!;
          resolve(layer.instance.layers, innerPath, `${key}/`, null, pending.children);
        }
        if (layer.children.length) resolve(layer.children, path, prefix, looping ? { index: n, count } : inherited, pending.children);
        out.push(pending);
      }
    }
  };

  const roots: Pending[] = [];
  resolve(env.root.layers, env.rootPath, "", null, roots);
  const layout = computeLayout({ key: ROOT_KEY, type: "group", props: {}, children: roots }, env.measurer, env.size);

  const emit = (p: Pending, parentWorld: readonly number[] | null, parent: Pending | null): SceneNode => {
    const f = layout.get(p.key) ?? { x: 0, y: 0, width: 0, height: 0, contentSize: [0, 0] as [number, number] };
    const props = p.props;
    const w = f.width;
    const h = f.height;
    const scale = finiteOr(props.scale, 1);
    const sxyz = Array.isArray(props.scaleXYZ) ? (props.scaleXYZ as unknown[]) : [];
    const sx = scale * finiteOr(sxyz[0], 1);
    const sy = scale * finiteOr(sxyz[1], 1);
    const sz = scale * finiteOr(sxyz[2], 1);
    const zPosition = finiteOr(props.zPosition, 0);
    const transform = compose({
      position: [f.x, f.y],
      size: [w, h],
      pivot: toVec2(props.pivot, [0.5, 0.5]),
      scale: [sx, sy, sz],
      rotationX: finiteOr(props.rotationX, 0),
      rotationY: finiteOr(props.rotationY, 0),
      rotationZ: finiteOr(props.rotation, 0),
      zPosition,
    });
    const worldTransform = parentWorld ? multiply(parentWorld, transform) : transform;
    const node: SceneNode = {
      key: p.key,
      layerId: p.layer.id,
      type: p.layer.type,
      parentKey: parent?.key ?? null,
      x: f.x,
      y: f.y,
      width: w,
      height: h,
      transform,
      worldTransform,
      zPosition,
      opacity: finiteOr(props.opacity, 1),
      visible: props.enabled !== false,
      clip: props.clip === true,
      props,
      children: [],
    };
    nodes.set(p.key, node);
    const anchor = toVec2(props.anchor, [0, 0]);
    let parentRef: LayerRef | null = null;
    if (parent) {
      const { prefix, instance } = splitSceneKey(parent.key);
      parentRef = makeRef(parent.layer.id, instance, prefix);
    }
    info.set(p.key, {
      type: p.layer.type,
      enabled: props.enabled !== false,
      position: [f.x + anchor[0] * w, f.y + anchor[1] * h],
      size: [w, h],
      scale: [sx, sy],
      anchor,
      parent: parentRef,
      worldTransform,
      contentSize: [f.contentSize[0], f.contentSize[1]],
    });
    node.children = p.children.map((c) => emit(c, worldTransform, p));
    return node;
  };

  const scene: SceneFrame = {
    frame: env.frame,
    time: env.time,
    size: [env.size[0], env.size[1]],
    background: env.background,
    roots: roots.map((r) => emit(r, null, null)),
  };
  return { scene, nodes, info, counts };
}
