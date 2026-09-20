/** The compiled evaluation graph: scopes (component instances), bindings, nodes and layers. */

import type { Component, Id, LayerNode, LayerTypeSpec, PatchNode, ResolvedPort, ResolvedProp, Value, ValueType } from "@sonobe/core";
import type { Loop } from "../types.ts";
import type { NodeRecord, NodeSpec } from "./evaluate.ts";

/** Where a port or prop gets its value each frame. `type` is the source type used for coercion. */
export type Binding =
  /** A literal or default, decoded to the target type at compile time. */
  | { kind: "const"; type: ValueType; pulse: false; value: Value | Loop }
  /** A patch output in the same scope. */
  | { kind: "output"; type: ValueType; pulse: boolean; node: CNode; slot: number }
  /** "$in.key" inside a component instance. */
  | { kind: "input"; type: ValueType; pulse: boolean; scope: Scope; input: ScopeInput }
  /** A published output of a component instance, read from the host. */
  | { kind: "instanceOutput"; type: ValueType; pulse: boolean; scope: Scope; key: string; inner: Binding | null; zero: Value }
  /** A variable receiver's source: a broadcaster's value binding at an ancestor depth (null = zero). */
  | { kind: "variable"; type: ValueType; pulse: false; depth: number; source: Binding | null; zero: Value }
  /** A `{ "layer": id }` literal; replicated layers read as loops of instance references. */
  | { kind: "layerRef"; type: "layer"; pulse: false; layerId: Id; cache: Map<string, { frame: number; value: Value | Loop }> }
  /** A read-only layer output (host-reported or derived from the previous frame). */
  | { kind: "layerOutput"; type: ValueType; pulse: boolean; layerId: Id; layerType: string; key: string; default: Value }
  /** "@layer.repeat" read as a source: how many copies the layer drew last frame (ARCHITECTURE §4). */
  | { kind: "layerCount"; type: "number"; pulse: false; layer: CLayer };

export interface ScopeInput {
  key: string;
  port: ResolvedPort;
  /** Host-side driver, compiled in the parent scope. */
  binding: Binding;
  /** loopBehavior "loop" (replicate the instance) vs "pass". */
  loop: boolean;
  /** A loop input whose driver evaluates after the instance's copies node (a back-edge: it reads last frame's value). */
  feedback: boolean;
  default: Value | Loop;
}

export interface Broadcaster {
  id: Id;
  name: string;
  scope: "local" | "global";
  type: ValueType;
  muted: boolean;
  node: PatchNode;
  binding: Binding | null;
}

/** A static component scope: the root prototype or one inlined instance. */
export interface Scope {
  /** Static path: "main", "main/card". */
  key: string;
  depth: number;
  parent: Scope | null;
  component: Component;
  kind: "root" | "patchInstance" | "layerInstance";
  instanceId: Id | null;
  /** This instance or an ancestor instance is muted: inner patches don't evaluate. */
  muted: boolean;
  /** This instance itself is muted: published outputs bypass. */
  selfMuted: boolean;
  /** Computes the instance paths (copies) per host path. Null for the root. */
  copies: CNode | null;
  inputs: ScopeInput[];
  inputIndex: Map<string, ScopeInput>;
  /** Extra loop sources that replicate a layer instance (its bound common props). */
  replicators: Binding[];
  /** The instance layer's Repeat when set: it alone decides the copy count (ARCHITECTURE §4). */
  repeat: Binding | null;
  nodes: Map<Id, CNode>;
  instances: Map<Id, Scope>;
  broadcasters: Broadcaster[];
  layers: CLayer[];
  layerIndex: Map<Id, CLayer>;
  outputBindings: Map<string, Binding | null>;
  /** Active instance paths this frame (non-root scopes). */
  active: InstancePath[];
  /** Unreplicated path per host path, used before the copies node has run. */
  defaultPaths: Map<string, InstancePath>;
}

/** A dynamic instance path: one evaluation context of a scope. */
export interface InstancePath {
  /** "main", "main/card#2", "main/card#2/badge". */
  key: string;
  /** Record key: like `key`, but copy 0 shares state with the unreplicated instance ("main/card"). */
  stateKey: string;
  parent: InstancePath | null;
  scope: Scope;
  /** Copy index when the instance is replicated by a loop. */
  copy: number | undefined;
  /** SceneNode key prefix for this path's layers ("" at the root, "card#2/" inside an instance). */
  layerPrefix: string;
}

export type CNodeKind = "patch" | "delay1" | "receiver" | "copies" | "inert";

export interface CNode extends NodeSpec {
  kind: CNodeKind;
  type: string;
  /** Stable identity across recompiles: `${scope.key}:${id}`. */
  identity: string;
  scope: Scope;
  compileIndex: number;
  order: number;
  bindings: Binding[];
  deps: CNode[];
  /**
   * Per input slot: the driver evaluates later in the frame (reads the previous frame). On a copies
   * node: per loop input of `copiesOf`, then per replicator, then its Repeat when set.
   */
  feedback: boolean[];
  records: Map<string, NodeRecord>;
  copiesOf: Scope | null;
}

export interface CProp {
  key: string;
  type: ValueType;
  wholeLoop: boolean;
  binding: Binding;
  /** The document fixes the length of the loop this prop gets (core loopShapes), so diagnostics check it. */
  lengthFixed: boolean;
}

export interface CLayer {
  id: Id;
  type: string;
  node: LayerNode;
  scope: Scope;
  spec: LayerTypeSpec;
  /** Every prop default (published inputs included for component instances). */
  defaults: Record<string, Value>;
  bound: CProp[];
  props: Map<string, ResolvedProp>;
  outputs: ResolvedPort[];
  children: CLayer[];
  /** The layer it sits in, in the same component (null at the top). */
  parent: CLayer | null;
  /** The component scope a componentInstance layer renders. */
  instance: Scope | null;
  /** The document fixes how many copies this layer makes (core loopShapes), so diagnostics check its loop lengths. */
  countFixed: boolean;
  propBindings: Map<string, Binding | null>;
}
