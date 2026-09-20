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
import type { Binding, CLayer, CProp, InstancePath, Scope } from "./graph.ts";
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
  /**
   * `root` made `count` copies, and `layer` (root or a layer inside it, which reads one item per copy)
   * got a loop of `length` items on `prop` that doesn't fit them. Only for lengths the document
   * doesn't fix (diagnostics reports the others) and that don't look deliberate.
   */
  lengthMismatch?(root: CLayer, path: InstancePath, count: number, layer: CLayer, prop: CProp, length: number): void;
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

/** A value in a sentence: text "A", true, a color. */
function describeValue(v: Value | Loop | undefined): string {
  if (typeof v === "string") return `text ${JSON.stringify(v.length > 30 ? `${v.slice(0, 30)}…` : v)}`;
  if (typeof v === "boolean") return `${v}`;
  if (typeof v === "number") return `the number ${v}`;
  if (Array.isArray(v)) return `a list of ${v.length} item${v.length === 1 ? "" : "s"}`;
  return v && typeof v === "object" ? "an object" : String(v);
}

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

/**
 * How many copies a Repeat value asks for (ARCHITECTURE §4): one per item of a loop, a number
 * rounded down (at least 0), or null when unset (Auto). Any other value asks for 1 (see isCount).
 */
export function repeatCount(v: Value | Loop | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (isLoop(v)) return v.items.length;
  if (typeof v === "number" && !Number.isNaN(v)) return Math.max(0, Math.floor(v));
  return 1;
}

/** A value Repeat can count: unset, a number, or a loop. */
export const isCount = (v: Value | Loop | undefined): boolean => v === undefined || v === null || isLoop(v) || (typeof v === "number" && !Number.isNaN(v));

/**
 * A loop of `length` items read one item per copy doesn't fit `count` copies: it wraps unevenly
 * (2 stripe colors on 6 copies wrap evenly, on purpose), or items past the last copy don't show and
 * Repeat isn't a typed number (a typed Repeat shows the first items on purpose).
 */
const misfits = (length: number, count: number, typed: boolean) => length > 1 && length !== count && (length < count ? count % length !== 0 : !typed);

/** The copy a layer inside a replicated layer belongs to, and the layer that made the copies. */
interface Inherited {
  index: number;
  count: number;
  root: CLayer;
  /** The root's Repeat is a typed number. */
  typed: boolean;
}

/** Resolve every layer, lay the tree out, and emit the SceneFrame. */
export function buildScene(env: SceneEnv): SceneBuild {
  const counts = new Map<string, number>();
  const nodes = new Map<string, SceneNode>();
  const info = new Map<string, LayerInfoSnapshot>();
  const makeRef = env.layerRef ?? ((layerId: Id, instance: number | undefined): LayerRef => (instance === undefined ? { layerId } : { layerId, instance }));

  const resolve = (layers: readonly CLayer[], path: InstancePath, prefix: string, inherited: Inherited | null, out: Pending[]): void => {
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
      // Repeat, when set, alone decides how many copies: other looped props wrap per copy, and an empty
      // one reads its default. Under a layer that already makes copies it's ignored (diagnostics say so).
      const rk = bound.findIndex((p) => p.key === "repeat");
      const repeat = rk >= 0 && !inherited ? repeatCount(values[rk]) : null;
      if (repeat !== null) {
        if (!isCount(values[rk])) env.issue("repeat_not_a_count", `Layer "${layer.node.name || layer.id}" gets ${describeValue(values[rk])} on its Repeat, which counts copies, so it makes 1 copy. Link a loop (one copy per item) or a number.`, layer.id);
        looping = true;
        empty = repeat === 0;
        max = repeat;
      }
      let count = 1;
      if (looping) {
        count = empty ? 0 : max;
        // A typed Repeat of 0, or a number, makes 0 copies on purpose; an empty loop may not have.
        if (count === 0 && env.emptyCopies && (repeat === null || isLoop(values[rk]))) {
          let emptyProp = repeat === null ? -1 : rk;
          for (let j = 0; j < bound.length && emptyProp < 0; j++) {
            const v = values[j];
            if (!bound[j]!.wholeLoop && isLoop(v) && v.items.length === 0) emptyProp = j;
          }
          env.emptyCopies(layer, path, emptyProp, repeat === null ? max : 0);
        }
        if (count > MAX_LOOP_LENGTH) {
          env.issue("loop_limit", `Layer "${layer.id}" is bound to a loop of ${count} items; layers replicate at most ${MAX_LOOP_LENGTH} times.`, layer.id);
          count = MAX_LOOP_LENGTH;
        }
      }
      const typed = repeat !== null && bound[rk]!.binding.kind === "const";
      // Loops that don't fit the copies, checked once per layer: on the copy-making layer, and on
      // layers inside it (on their first copy).
      const fitting = looping && !inherited ? { count, root: layer, typed } : inherited && inherited.index === 0 ? inherited : null;
      if (fitting && fitting.count > 0 && env.lengthMismatch) {
        for (let j = 0; j < bound.length; j++) {
          const p = bound[j]!;
          const v = values[j];
          if (p.wholeLoop || !isLoop(v) || !misfits(v.items.length, fitting.count, fitting.typed) || (fitting.root.countFixed && p.lengthFixed)) continue;
          env.lengthMismatch(fitting.root, path, fitting.count, layer, p, v.items.length);
          break;
        }
      }
      const baseKey = prefix + layer.id;
      if (looping) counts.set(baseKey, count);
      else if (inherited) counts.set(baseKey, inherited.count);
      const copies = looping ? count : (inherited?.count ?? 1);
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
          // Repeat draws as the number of copies (copying its loop into every copy would cost n² per frame).
          if (j === rk) props[p.key] = copies;
          else if (p.wholeLoop) props[p.key] = isLoop(v) ? [...v.items] : v;
          else if (isLoop(v)) props[p.key] = v.items.length ? v.items[index % v.items.length] : layer.defaults[p.key];
          else props[p.key] = v;
          if (p.type === "pulse" && env.pulseProp) env.pulseProp(key, p.key, props[p.key]!, p.binding.pulse);
        }
        const pending: Pending = { key, type: layer.type, layer, props, children: [] };
        if (layer.instance && inst && inst.paths.length) {
          const innerPath = inst.paths[inst.replicated ? index % inst.paths.length : 0]!;
          resolve(layer.instance.layers, innerPath, `${key}/`, null, pending.children);
        }
        if (layer.children.length) resolve(layer.children, path, prefix, looping ? { index: n, count, root: layer, typed } : inherited, pending.children);
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
