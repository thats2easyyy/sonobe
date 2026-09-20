/**
 * Graph compiler: turns a document into scopes, nodes, bindings and layers. Component instances
 * (patch components and layer component instances) are inlined recursively, variables compile to
 * implicit edges, and nodes are ordered topologically. Inside a strongly connected component the
 * edges that close a cycle become back-edges: their consumer evaluates first and reads the
 * driver's previous-frame value. Back-edges are chosen by the same rule as core's feedback-loop
 * diagnostics: edges into Delay One Frame first, then visually backwards edges (source ui.x ≥
 * target ui.x), then target id order.
 */

import {
  COMPONENT_INSTANCE_LAYER_TYPE,
  COMPONENT_PATCH_TYPE,
  describePatch,
  getPatchSpec,
  interfacePortToPort,
  isLayerInput,
  isLinkInput,
  loopShapes,
  parseAddress,
  resolveLayerProps,
  resolveNodePorts,
  wouldCreateComponentCycle,
  type Component,
  type ComponentKind,
  type Id,
  type InputValue,
  type LayerNode,
  type LoopShapes,
  type PatchNode,
  type PatchSpec,
  type ResolvedPort,
  type SonobeDocument,
  type Value,
  type ValueType,
} from "@sonobe/core";
import type { EngineRegistry, Loop, PatchDefinition, RuntimeIssue } from "../types.ts";
import { DELAY1_TYPE, VARIABLE_BROADCASTER_TYPE, VARIABLE_RECEIVER_TYPE, withBuiltinSpecs } from "./builtins.ts";
import { bypassMap, type InputSlot, type OutputSlot } from "./evaluate.ts";
import type { Binding, Broadcaster, CLayer, CNode, CNodeKind, Scope, ScopeInput } from "./graph.ts";
import { makeLoop } from "./loop.ts";
import { decodeStored, normalizeDefault, portDefault, valuesEqual, zeroValue } from "./values.ts";

/** Component instances nest at most this deep. */
export const MAX_COMPONENT_DEPTH = 32;

export interface CompiledGraph {
  doc: SonobeDocument;
  registry: EngineRegistry;
  root: Scope | null;
  /** Evaluation order. */
  order: CNode[];
  scopes: Scope[];
  issues: RuntimeIssue[];
  /** Some patches read last frame's value through a back-edge (a cycle's evaluation order read patch positions). */
  cyclic: boolean;
  /** Resolve an address ("patch.port", "@layer.key", "$in.key") in a scope (default: the root) to a binding and its target type. */
  resolveLink(address: string, scope?: Scope): { binding: Binding; type: ValueType } | null;
}

/** True when the spec declares port `key` on `side` as "variant" (static ports and variadic expansions). */
export function declaredVariant(spec: PatchSpec, key: string, side: "inputs" | "outputs"): boolean {
  const own = spec[side].find((p) => p.key === key);
  if (own) return own.type === "variant";
  const v = spec.variadic;
  if (v && key.startsWith(v.key) && /^\d+$/.test(key.slice(v.key.length))) return v.type === "variant";
  return false;
}

/**
 * PatchContext.inputCount: core's clamped variadic count; else node.inputCount clamped to the spec's
 * `inputCountRange` (else its defaultCount); else node.inputCount ?? 0.
 */
export function effectiveInputCount(spec: PatchSpec, node: PatchNode, resolved: number | undefined): number {
  if (resolved !== undefined) return resolved;
  const raw = node.inputCount;
  const range = (spec as unknown as { inputCountRange?: unknown }).inputCountRange as { min?: unknown; max?: unknown; defaultCount?: unknown } | undefined;
  if (range && typeof range === "object" && typeof range.min === "number" && typeof range.max === "number") {
    const fallback = typeof range.defaultCount === "number" ? range.defaultCount : range.min;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
    return Math.min(range.max, Math.max(range.min, Math.round(raw)));
  }
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

interface Label {
  patchId?: Id;
  layerId?: Id;
  text: string;
}

const constBinding = (value: Value | Loop, type: ValueType): Binding => ({ kind: "const", type, pulse: false, value });

const sortedKeys = (record: Record<string, unknown>) => Object.keys(record).sort();

export function compileDocument(doc: SonobeDocument, engineRegistry: EngineRegistry): CompiledGraph {
  const registry = withBuiltinSpecs(engineRegistry);
  const issues: RuntimeIssue[] = [];
  const nodes: CNode[] = [];
  const scopes: Scope[] = [];
  const inertInstances = new WeakMap<Scope, Set<Id>>();
  const layerInstances: { host: Scope; layer: CLayer }[] = [];
  const patchInstances: { host: Scope; child: Scope; node: PatchNode }[] = [];
  const pendingProps = new Set<string>();
  const broadcasterBindings = new Map<Broadcaster, Binding>();
  const nodePorts = new Map<CNode, ResolvedPort[]>();

  const issue = (code: string, severity: RuntimeIssue["severity"], message: string, label?: Pick<Label, "patchId" | "layerId">) => {
    const item: RuntimeIssue = { code, severity, message };
    if (label?.patchId !== undefined) item.patchId = label.patchId;
    if (label?.layerId !== undefined) item.layerId = label.layerId;
    issues.push(item);
  };

  const rootComponent = doc.components[doc.project.root];
  if (!rootComponent) {
    issue("missing_root", "error", `The project's root component "${doc.project.root}" doesn't exist, so there's nothing to run.`);
    return { doc, registry, root: null, order: [], scopes, issues, cyclic: false, resolveLink: () => null };
  }

  // ---- scopes and shells -----------------------------------------------------

  function newScope(parent: Scope | null, component: Component, kind: Scope["kind"], instanceId: Id | null, selfMuted: boolean): Scope {
    const scope: Scope = {
      key: parent ? `${parent.key}/${instanceId}` : component.id,
      depth: parent ? parent.depth + 1 : 0,
      parent,
      component,
      kind,
      instanceId,
      muted: selfMuted || (parent?.muted ?? false),
      selfMuted,
      copies: null,
      inputs: [],
      inputIndex: new Map(),
      replicators: [],
      repeat: null,
      nodes: new Map(),
      instances: new Map(),
      broadcasters: [],
      layers: [],
      layerIndex: new Map(),
      outputBindings: new Map(),
      active: [],
      defaultPaths: new Map(),
    };
    scopes.push(scope);
    return scope;
  }

  function markInert(host: Scope, id: Id) {
    let set = inertInstances.get(host);
    if (!set) inertInstances.set(host, (set = new Set()));
    set.add(id);
  }

  function instanceScope(host: Scope, instanceId: Id, componentId: Id | undefined, expected: ComponentKind, selfMuted: boolean, label: Label): Scope | null {
    const what = expected === "patchComponent" ? "Component patch" : "Component layer";
    if (componentId === undefined) {
      issue("missing_component", "error", `${what} "${instanceId}" in ${host.component.id} doesn't say which component it shows.`, label);
      return null;
    }
    const target = doc.components[componentId];
    if (!target) {
      issue("component_not_found", "error", `${what} "${instanceId}" shows component "${componentId}", which doesn't exist.`, label);
      return null;
    }
    if (target.kind !== expected) {
      issue("wrong_component_kind", "error", `${what} "${instanceId}" shows "${componentId}", which is a ${target.kind}, not a ${expected}.`, label);
      return null;
    }
    let ancestorUses = false;
    for (let s: Scope | null = host; s; s = s.parent) if (s.component.id === target.id) ancestorUses = true;
    if (ancestorUses || host.depth >= MAX_COMPONENT_DEPTH || wouldCreateComponentCycle(doc, host.component.id, target.id)) {
      issue("component_cycle", "error", `"${componentId}" ends up containing itself through "${instanceId}", so that instance doesn't run.`, label);
      return null;
    }
    const child = newScope(host, target, expected === "patchComponent" ? "patchInstance" : "layerInstance", instanceId, selfMuted);
    child.copies = createCopiesNode(host, child);
    for (const key of sortedKeys(target.interface.inputs)) {
      const iport = target.interface.inputs[key]!;
      const port = interfacePortToPort(iport, "input");
      const def = iport.default !== undefined && !isLinkInput(iport.default) ? decodeStored(iport.default, iport.type) : zeroValue(iport.type, port.enumOptions);
      const input: ScopeInput = { key, port, binding: constBinding(def, iport.type), loop: (iport.loopBehavior ?? "loop") === "loop", feedback: false, default: def };
      child.inputs.push(input);
      child.inputIndex.set(key, input);
    }
    buildShells(child);
    return child;
  }

  function baseNode(scope: Scope, id: Id, node: PatchNode, kind: CNodeKind, type: string): CNode {
    const cnode: CNode = {
      id,
      node,
      def: null,
      inputs: [],
      outputs: [],
      inputIndex: new Map(),
      outputIndex: new Map(),
      wholeLoop: false,
      muted: false,
      mutedBehavior: "bypass",
      bypass: [],
      typeParam: undefined,
      inputCount: 0,
      kind,
      type,
      identity: `${scope.key}:${id}`,
      scope,
      compileIndex: nodes.length,
      order: 0,
      bindings: [],
      deps: [],
      feedback: [],
      records: new Map(),
      copiesOf: null,
    };
    nodes.push(cnode);
    return cnode;
  }

  function createCopiesNode(host: Scope, child: Scope): CNode {
    const synthetic: PatchNode = { type: "$copies", inputs: {}, ui: { x: 0, y: 0 } };
    const cnode = baseNode(host, `$copies_${child.instanceId}`, synthetic, "copies", "$copies");
    cnode.identity = `${child.key}:$copies`;
    cnode.copiesOf = child;
    return cnode;
  }

  function buildShells(scope: Scope): void {
    const c = scope.component;
    for (const id of sortedKeys(c.patches)) {
      const pnode = c.patches[id]!;
      const label: Label = { patchId: id, text: describePatch(pnode, getPatchSpec(registry, pnode.type)) };
      if (pnode.type === COMPONENT_PATCH_TYPE) {
        const child = instanceScope(scope, id, pnode.component, "patchComponent", pnode.muted === true, label);
        if (child) {
          scope.instances.set(id, child);
          patchInstances.push({ host: scope, child, node: pnode });
        } else markInert(scope, id);
        continue;
      }
      const ports = resolveNodePorts(doc, pnode, registry);
      if (!ports) {
        issue("unknown_patch_type", "error", `${pnode.name ? `The patch "${pnode.name}"` : "A patch"} in ${c.name} has an unknown type "${pnode.type}", so it doesn't run.`, label);
        baseNode(scope, id, pnode, "inert", pnode.type);
        scope.nodes.set(id, nodes[nodes.length - 1]!);
        continue;
      }
      if (ports.dynamicPortsError !== undefined) {
        issue("dynamic_ports_failed", "warning", `${label.text} couldn't work out its ports: ${ports.dynamicPortsError}`, label);
      }
      if (pnode.type === VARIABLE_BROADCASTER_TYPE) {
        const settings = pnode.settings ?? {};
        scope.broadcasters.push({
          id,
          name: typeof settings.name === "string" ? settings.name.trim() : "",
          scope: settings.scope === "global" ? "global" : "local",
          type: ports.inputs.find((p) => p.key === "value")?.type ?? "number",
          muted: pnode.muted === true || scope.muted,
          node: pnode,
          binding: null,
        });
        continue;
      }
      let kind: CNodeKind;
      let def: PatchDefinition | null = null;
      if (pnode.type === DELAY1_TYPE) kind = "delay1";
      else if (pnode.type === VARIABLE_RECEIVER_TYPE) kind = "receiver";
      else {
        def = registry.definitions.get(pnode.type) ?? null;
        if (!def || typeof def.evaluate !== "function") {
          issue("unimplemented_patch", "warning", `${label.text} isn't implemented in this runtime, so its outputs hold their defaults.`, label);
          def = null;
          kind = "inert";
        } else kind = "patch";
      }
      const cnode = baseNode(scope, id, pnode, kind, pnode.type);
      cnode.def = def;
      cnode.typeParam = ports.typeParam;
      cnode.inputCount = effectiveInputCount(ports.spec, pnode, ports.inputCount);
      cnode.muted = pnode.muted === true || scope.muted;
      const variantDefaults = ports.typeParam ? ports.spec.variantDefaults?.[ports.typeParam] : undefined;
      cnode.outputs = ports.outputs.map((p): OutputSlot => {
        const wholeLoop = p.wholeLoop === true && kind === "patch";
        const zero = wholeLoop ? makeLoop([]) : zeroValue(p.type, p.enumOptions);
        const declared = normalizeDefault(p.default, p.type);
        return { key: p.key, type: p.type, variant: declaredVariant(ports.spec, p.key, "outputs"), wholeLoop, pulse: p.type === "pulse", initial: p.type === "pulse" ? false : (declared ?? zero), zero };
      });
      if (kind === "receiver") {
        const type = cnode.outputs[0]?.type ?? "number";
        const zero = zeroValue(type);
        cnode.inputs = [{ key: "$source", type, variant: true, wholeLoop: false, pulseSource: false, connected: true, default: zero, zero }];
        cnode.mutedBehavior = "zero";
      } else {
        const inputPorts = ports.inputs;
        nodePorts.set(cnode, inputPorts);
        cnode.inputs = inputPorts.map((p): InputSlot => {
          const raw = variantDefaults?.[p.key] ?? p.default;
          const wholeLoop = p.wholeLoop === true && kind === "patch";
          const fallback = wholeLoop && raw === undefined ? makeLoop([]) : portDefault(p);
          const value = normalizeDefault(raw, p.type) ?? fallback;
          return { key: p.key, type: p.type, variant: declaredVariant(ports.spec, p.key, "inputs"), wholeLoop, pulseSource: false, connected: false, default: value, zero: zeroValue(p.type, p.enumOptions) };
        });
        cnode.mutedBehavior = def?.mutedBehavior ?? "bypass";
      }
      cnode.inputs.forEach((s, i) => cnode.inputIndex.set(s.key, i));
      cnode.outputs.forEach((s, i) => cnode.outputIndex.set(s.key, i));
      cnode.bindings = cnode.inputs.map((s) => constBinding(s.default, s.type));
      cnode.feedback = cnode.inputs.map(() => false);
      cnode.wholeLoop = cnode.inputs.some((s) => s.wholeLoop) || cnode.outputs.some((s) => s.wholeLoop);
      cnode.bypass = bypassMap(cnode.inputs, cnode.outputs);
      if (kind === "delay1") cnode.def = delay1Definition(cnode, ports.spec);
      scope.nodes.set(id, cnode);
    }
    scope.layers = buildLayers(scope, c.layers);
  }

  function buildLayers(scope: Scope, layers: readonly LayerNode[]): CLayer[] {
    const out: CLayer[] = [];
    for (const node of layers) {
      const spec = registry.layers.get(node.type);
      const label: Label = { layerId: node.id, text: `Layer "${node.name || node.id}"` };
      if (!spec) {
        issue("unknown_layer_type", "error", `${label.text} in ${scope.component.name} has an unknown type "${node.type}", so it isn't drawn.`, label);
        continue;
      }
      const props = resolveLayerProps(doc, scope.component.id, node, registry) ?? [];
      const defaults: Record<string, Value> = {};
      // A prop declared with a null default (cornerRadii, gradient, image...) stays null while unset.
      for (const p of props) defaults[p.key] = p.default === null ? null : (normalizeDefault(p.default, p.type) ?? portDefault(p));
      const layer: CLayer = {
        id: node.id,
        type: node.type,
        node,
        scope,
        spec,
        defaults,
        bound: [],
        props: new Map(props.map((p) => [p.key, p])),
        outputs: (spec.outputs ?? []).map((p) => ({ ...p, type: p.type === "variant" ? "any" : p.type })),
        children: [],
        instance: null,
        countFixed: false,
        propBindings: new Map(),
      };
      scope.layerIndex.set(node.id, layer);
      if (node.type === COMPONENT_INSTANCE_LAYER_TYPE) {
        layer.instance = instanceScope(scope, node.id, node.component, "layerComponent", false, label);
        if (layer.instance) {
          const size = layer.instance.component.size;
          if (size && node.props.size === undefined) defaults.size = [size[0], size[1]];
          for (const input of layer.instance.inputs) defaults[input.key] = input.default;
          layerInstances.push({ host: scope, layer });
        }
      }
      if (node.children?.length) layer.children = buildLayers(scope, node.children);
      out.push(layer);
    }
    return out;
  }

  // ---- bindings ---------------------------------------------------------------

  function compileStored(scope: Scope, stored: InputValue | undefined, type: ValueType, fallback: Value | Loop, label: Label): { binding: Binding; connected: boolean } {
    if (stored === undefined) return { binding: constBinding(fallback, type), connected: false };
    if (isLinkInput(stored)) {
      const binding = compileLink(scope, stored.link, label);
      return binding ? { binding, connected: true } : { binding: constBinding(fallback, type), connected: false };
    }
    if (isLayerInput(stored)) return { binding: { kind: "layerRef", type: "layer", pulse: false, layerId: stored.layer, cache: new Map() }, connected: false };
    return { binding: constBinding(decodeStored(stored, type), type), connected: false };
  }

  function compileLink(scope: Scope, address: string, label: Label): Binding | null {
    const a = parseAddress(address);
    if (!a || a.index !== undefined) {
      issue("invalid_link", "warning", `${label.text} reads "${address}", which isn't a valid address.`, label);
      return null;
    }
    const where = scope.component.id;
    switch (a.kind) {
      case "patch": {
        const child = scope.instances.get(a.id);
        if (child) return instanceOutputBinding(child, a.key, label);
        if (inertInstances.get(scope)?.has(a.id)) return null;
        const node = scope.nodes.get(a.id);
        if (!node) {
          issue("dangling_link", "warning", `${label.text} reads "${address}", but there's no patch "${a.id}" in ${where}.`, label);
          return null;
        }
        const slot = node.outputIndex.get(a.key);
        if (slot === undefined) {
          if (node.kind !== "inert" || node.outputs.length) issue("dangling_link", "warning", `${label.text} reads "${address}", but "${a.id}" has no output "${a.key}".`, label);
          return null;
        }
        const o = node.outputs[slot]!;
        return { kind: "output", type: o.type, pulse: o.pulse, node, slot };
      }
      case "componentInput": {
        const input = scope.inputIndex.get(a.key);
        if (!input) {
          issue("dangling_link", "warning", `${label.text} reads "${address}", but ${where} has no published input "${a.key}".`, label);
          return null;
        }
        return { kind: "input", type: input.port.type, pulse: false, scope, input };
      }
      case "layer": {
        const layer = scope.layerIndex.get(a.id);
        if (!layer) {
          issue("dangling_link", "warning", `${label.text} reads "${address}", but there's no layer "${a.id}" in ${where}.`, label);
          return null;
        }
        if (layer.instance?.component.interface.outputs[a.key]) return instanceOutputBinding(layer.instance, a.key, label);
        const out = layer.outputs.find((o) => o.key === a.key);
        if (out) {
          return { kind: "layerOutput", type: out.type, pulse: out.type === "pulse", layerId: layer.id, layerType: layer.type, key: a.key, default: normalizeDefault(out.default, out.type) ?? zeroValue(out.type) };
        }
        if (layer.props.has(a.key)) return propBinding(layer, a.key);
        issue("dangling_link", "warning", `${label.text} reads "${address}", but layer "${a.id}" has no output or property "${a.key}".`, label);
        return null;
      }
      default:
        issue("invalid_link", "warning", `${label.text} reads "${address}", which can't be read from.`, label);
        return null;
    }
  }

  function propBinding(layer: CLayer, key: string): Binding {
    const cached = layer.propBindings.get(key);
    if (cached) return cached;
    const prop = layer.props.get(key)!;
    const fallback = layer.defaults[key] as Value | Loop;
    const pendingKey = `${layer.scope.key}:${layer.id}.${key}`;
    if (pendingProps.has(pendingKey)) {
      issue("layer_link_cycle", "warning", `@${layer.id}.${key} ends up reading itself through layer property links, so it uses its default.`, { layerId: layer.id });
      return constBinding(fallback, prop.type);
    }
    pendingProps.add(pendingKey);
    const stored = layer.node.props[key];
    const { binding } =
      stored === null && prop.default === null
        ? { binding: constBinding(null, prop.type) }
        : compileStored(layer.scope, stored, prop.type, fallback, { layerId: layer.id, text: `@${layer.id}.${key}` });
    pendingProps.delete(pendingKey);
    layer.propBindings.set(key, binding);
    return binding;
  }

  function instanceOutputBinding(child: Scope, key: string, label: Label): Binding | null {
    if (child.outputBindings.has(key)) return child.outputBindings.get(key) ?? null;
    const port = child.component.interface.outputs[key];
    if (!port) {
      issue("dangling_link", "warning", `${label.text} reads "${key}" from "${child.instanceId}", but ${child.component.id} has no published output "${key}".`, label);
      return null;
    }
    child.outputBindings.set(key, null);
    const inner = port.link !== undefined ? compileLink(child, port.link, { text: `${child.component.id} published output "${key}"` }) : null;
    const enumOptions = port.enumOptions?.map((k) => ({ key: k, name: k }));
    const binding: Binding = { kind: "instanceOutput", type: port.type, pulse: port.type === "pulse", scope: child, key, inner, zero: zeroValue(port.type, enumOptions) };
    child.outputBindings.set(key, binding);
    return binding;
  }

  function bindInstanceInputs(host: Scope, child: Scope, stored: Record<string, InputValue>, label: Label): void {
    for (const input of child.inputs) {
      let { binding } = compileStored(host, stored[input.key], input.port.type, input.default, label);
      if (binding.kind === "instanceOutput" && binding.scope === child) {
        issue("self_edge", "error", `"${child.instanceId}.${binding.key}" is wired straight into its own input "${input.key}". Put a patch in between (Delay One Frame for feedback).`, label);
        binding = constBinding(input.default, input.port.type);
      }
      input.binding = binding;
    }
  }

  function broadcasterBinding(level: Scope, b: Broadcaster): Binding {
    const cached = broadcasterBindings.get(b);
    if (cached) return cached;
    const ports = resolveNodePorts(doc, b.node, registry);
    const port = ports?.inputs.find((p) => p.key === "value");
    const type = port?.type ?? b.type;
    const fallback = port ? (normalizeDefault(port.default, type) ?? portDefault(port)) : zeroValue(type);
    const { binding } = compileStored(level, b.node.inputs.value, type, fallback, { patchId: b.id, text: describePatch(b.node, getPatchSpec(registry, b.node.type)) });
    broadcasterBindings.set(b, binding);
    return binding;
  }

  function bindReceiver(scope: Scope, cnode: CNode): void {
    const settings = cnode.node.settings ?? {};
    const name = typeof settings.name === "string" ? settings.name.trim() : "";
    const vscope = settings.scope === "global" ? "global" : "local";
    const type = cnode.inputs[0]!.type;
    const zero = cnode.inputs[0]!.zero;
    let found: { level: Scope; b: Broadcaster } | null = null;
    let mismatch = false;
    let level: Scope | null = scope;
    while (name && level && !found) {
      const candidates = level.broadcasters.filter((b) => b.name === name && b.scope === vscope);
      const match = candidates.filter((b) => b.type === type).sort((x, y) => (x.id < y.id ? -1 : 1))[0];
      if (match) found = { level, b: match };
      else if (candidates.length) mismatch = true;
      level = vscope === "global" ? level.parent : null;
    }
    const label = { patchId: cnode.id };
    if (!found) {
      const specName = getPatchSpec(registry, cnode.node.type)?.name ?? "Variable Receiver";
      const who = cnode.node.name ? `${specName} "${cnode.node.name}"` : specName;
      if (!name) issue("unresolved_variable", "warning", `${who} has no variable chosen, so it outputs a zero value.`, label);
      else if (mismatch) issue("variable_type_mismatch", "warning", `${who} wants a ${type} variable named "${name}", but the broadcaster with that name has another type.`, label);
      else issue("unresolved_variable", "warning", `${who} can't find a ${vscope} variable named "${name}".`, label);
      cnode.bindings[0] = constBinding(zero, type);
      return;
    }
    cnode.bindings[0] = { kind: "variable", type, pulse: false, depth: found.level.depth, source: found.b.muted ? null : broadcasterBinding(found.level, found.b), zero };
  }

  function bindNode(scope: Scope, cnode: CNode): void {
    if (cnode.kind === "receiver") return bindReceiver(scope, cnode);
    const ports = nodePorts.get(cnode);
    if (!ports) return;
    const label: Label = { patchId: cnode.id, text: describePatch(cnode.node, getPatchSpec(registry, cnode.node.type)) };
    ports.forEach((port, i) => {
      const slot = cnode.inputs[i]!;
      let { binding, connected } = compileStored(scope, cnode.node.inputs[port.key], slot.type, slot.default, label);
      if (binding.kind === "output" && binding.node === cnode) {
        issue("self_edge", "error", `${label.text}: ${port.name} is wired to its own output "${cnode.outputs[binding.slot]!.key}". Put another patch in between (Delay One Frame for feedback).`, label);
        binding = constBinding(slot.default, slot.type);
        connected = false;
      }
      cnode.bindings[i] = binding;
      slot.connected = connected;
    });
  }

  function bindAllInputs(scope: Scope): void {
    for (const { host, child, node } of patchInstances) if (host === scope) bindInstanceInputs(host, child, node.inputs, { patchId: child.instanceId!, text: `Component patch "${node.name || child.component.name}"` });
    for (const { host, layer } of layerInstances) {
      if (host !== scope || !layer.instance) continue;
      const child = layer.instance;
      bindInstanceInputs(host, child, layer.node.props, { layerId: layer.id, text: `Component layer "${layer.node.name || layer.id}"` });
      for (const key of Object.keys(layer.node.props)) {
        const prop = layer.props.get(key);
        if (key === "repeat" && prop && !child.inputIndex.has(key)) {
          child.repeat = propBinding(layer, key);
          continue;
        }
        if (!prop || child.inputIndex.has(key) || prop.wholeLoop) continue;
        const binding = propBinding(layer, key);
        if (binding.kind !== "const" || binding.value !== null) child.replicators.push(binding);
      }
    }
    for (const child of scope.instances.values()) bindAllInputs(child);
    for (const { host, layer } of layerInstances) if (host === scope && layer.instance) bindAllInputs(layer.instance);
  }

  // What the document says about loop lengths, per component: the runtime leaves the loop length
  // mismatches diagnostics can see to diagnostics.
  const shapes = new Map<Id, LoopShapes>();
  const shapesOf = (component: Component) => {
    let known = shapes.get(component.id);
    if (!known) shapes.set(component.id, (known = loopShapes(doc, component.id, registry)));
    return known;
  };

  function bindLayers(layers: readonly CLayer[]): void {
    for (const layer of layers) {
      const known = shapesOf(layer.scope.component);
      layer.countFixed = typeof known.count(layer.id) === "number";
      for (const key of Object.keys(layer.node.props)) {
        const prop = layer.props.get(key);
        if (!prop) continue;
        const lengthFixed = typeof known.ofValue(layer.node.props[key], layer.id)?.length === "number";
        layer.bound.push({ key, type: prop.type, wholeLoop: prop.wholeLoop === true, binding: propBinding(layer, key), lengthFixed });
      }
      bindLayers(layer.children);
    }
  }

  const root = newScope(null, rootComponent, "root", null, false);
  buildShells(root);
  bindAllInputs(root);
  for (const scope of scopes) {
    for (const cnode of scope.nodes.values()) bindNode(scope, cnode);
    bindLayers(scope.layers);
  }
  breakPassThroughCycles(scopes, issue);

  // ---- pulses, dependencies, order --------------------------------------------

  // A binding is a pulse source only when a real pulse output drives it. Published inputs and
  // outputs typed "pulse" pass what drives them through, so a held boolean behind a component
  // boundary still fires on its rising edge instead of every frame (ARCHITECTURE §4).
  const pulseMemo = new Map<Binding, boolean>();
  const pulseOf = (b: Binding): boolean => {
    if (b.kind !== "input" && b.kind !== "instanceOutput") return b.pulse;
    const cached = pulseMemo.get(b);
    if (cached !== undefined) return cached;
    pulseMemo.set(b, false); // cycle guard
    const result = b.kind === "input" ? b.input.port.type === "pulse" && pulseOf(b.input.binding) : b.type === "pulse" && b.inner !== null && pulseOf(b.inner);
    pulseMemo.set(b, result);
    b.pulse = result;
    return result;
  };
  for (const cnode of nodes) {
    cnode.bindings.forEach((b, i) => {
      cnode.inputs[i]!.pulseSource = pulseOf(b);
    });
  }
  // Published outputs read only by layers or by getValue still get their pulse flag settled.
  for (const scope of scopes) for (const b of scope.outputBindings.values()) if (b) pulseOf(b);

  for (const cnode of nodes) {
    const deps: CNode[] = [];
    for (const b of cnode.bindings) bindingDeps(b, deps);
    if (cnode.copiesOf) {
      for (const input of cnode.copiesOf.inputs) if (input.loop) bindingDeps(input.binding, deps);
      for (const r of cnode.copiesOf.replicators) bindingDeps(r, deps);
      bindingDeps(cnode.copiesOf.repeat, deps);
    }
    if (cnode.scope.copies) deps.push(cnode.scope.copies);
    cnode.deps = [...new Set(deps)];
  }
  const order = orderNodes(nodes);
  for (const cnode of order) {
    const later = (b: Binding): boolean => {
      const deps: CNode[] = [];
      bindingDeps(b, deps);
      return deps.some((d) => d !== cnode && d.order >= cnode.order);
    };
    if (cnode.kind === "copies") {
      // Per loop input of the instance, then per replicator, then Repeat: the copy count reads last frame's value there.
      const child = cnode.copiesOf!;
      for (const input of child.inputs) input.feedback = input.loop && later(input.binding);
      cnode.feedback = [...child.inputs.map((input) => input.feedback), ...child.replicators.map(later), ...(child.repeat ? [later(child.repeat)] : [])];
      continue;
    }
    cnode.bindings.forEach((b, i) => {
      cnode.feedback[i] = later(b);
    });
  }
  const links = new Map<Scope, Map<string, { binding: Binding; type: ValueType } | null>>();
  const resolveLink = (address: string, scope: Scope = root): { binding: Binding; type: ValueType } | null => {
    let cache = links.get(scope);
    if (!cache) links.set(scope, (cache = new Map()));
    if (cache.has(address)) return cache.get(address)!;
    const saved = issues.length;
    const binding = compileLink(scope, address, { text: address });
    issues.length = saved;
    let result: { binding: Binding; type: ValueType } | null = null;
    if (binding) {
      let type = binding.type;
      const a = parseAddress(address);
      const layer = a?.kind === "layer" ? scope.layerIndex.get(a.id) : undefined;
      if (a && layer && !layer.outputs.some((o) => o.key === a.key) && !layer.instance?.component.interface.outputs[a.key]) {
        type = layer.props.get(a.key)?.type ?? type;
      }
      result = { binding, type };
    }
    cache.set(address, result);
    return result;
  };
  const cyclic = order.some((node) => node.feedback.some(Boolean));
  return { doc, registry, root, order, scopes, issues, cyclic, resolveLink };
}

// ---------------------------------------------------------------------------
// Literal-only updates
// ---------------------------------------------------------------------------

const COMPONENT_CONTENT = new Set(["layers", "patches", "comments", "meta"]);
const PATCH_CONTENT = new Set(["inputs", "ui"]);
const LAYER_CONTENT = new Set(["props", "children", "locked", "collapsed", "name"]);

/** Same own keys, and the same values (by identity) outside `skip`. */
function sameFields(a: object, b: object, skip: ReadonlySet<string>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of ka) if (!Object.hasOwn(rb, k) || (!skip.has(k) && !Object.is(ra[k], rb[k]))) return false;
  return true;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A stored value that compiles to a constant binding (or the port default): not a link or a layer reference. */
const isConstant = (v: InputValue | undefined) => v === undefined || (!isLinkInput(v) && !isLayerInput(v));

/** Keys whose stored values changed, when every change is constant to constant; null otherwise. With `sameKeySet`, adding or removing a key is a structural change too. */
function changedConstants(next: Record<string, InputValue>, prev: Record<string, InputValue>, sameKeySet: boolean): string[] | null {
  const out: string[] = [];
  const nextKeys = Object.keys(next);
  if (sameKeySet && nextKeys.length !== Object.keys(prev).length) return null;
  for (const key of nextKeys) {
    const before = Object.hasOwn(prev, key) ? prev[key] : undefined;
    if (Object.is(before, next[key])) continue;
    if ((sameKeySet && !Object.hasOwn(prev, key)) || !isConstant(next[key]) || !isConstant(before)) return null;
    out.push(key);
  }
  for (const key of Object.keys(prev)) {
    if (Object.hasOwn(next, key)) continue;
    if (sameKeySet || !isConstant(prev[key])) return null;
    out.push(key);
  }
  return out;
}

/**
 * Update a compiled graph in place for a document that differs from the one it was compiled from
 * only in literal values: patch input literals, layer property literals, and patch positions (which
 * only matter when patches form a cycle). Constant bindings are rewritten where they are, so every
 * reader of a layer property sees the new value, and patch state is untouched. Returns false, with
 * the graph unchanged, for anything else (links, new or removed items, types, names, settings,
 * component instances, variables, patches with dynamic ports): compile the document instead.
 */
export function updateLiterals(graph: CompiledGraph, next: SonobeDocument): boolean {
  const prev = graph.doc;
  if (next === prev) return true;
  if (next.project !== prev.project || next.scripts !== prev.scripts || next.assets !== prev.assets) return false;
  const ids = Object.keys(next.components);
  if (!sameKeys(ids, Object.keys(prev.components))) return false;
  const registry = graph.registry;
  const swaps = new Map<Component, Component>();
  const nodes: { from: Component; id: Id; node: PatchNode; keys: readonly string[] }[] = [];
  const layers: { from: Component; node: LayerNode; keys: readonly string[] }[] = [];

  for (const id of ids) {
    const a = next.components[id]!;
    const b = prev.components[id]!;
    if (a === b) continue;
    if (!sameFields(a, b, COMPONENT_CONTENT) || a.comments.length !== b.comments.length) return false;
    swaps.set(b, a);
    if (a.patches !== b.patches) {
      const keys = Object.keys(a.patches);
      if (!sameKeys(keys, Object.keys(b.patches))) return false;
      for (const pid of keys) {
        const na = a.patches[pid]!;
        const nb = b.patches[pid]!;
        if (na === nb) continue;
        if (!sameFields(na, nb, PATCH_CONTENT)) return false;
        if (na.ui !== nb.ui && (na.ui?.x !== nb.ui?.x || na.ui?.y !== nb.ui?.y) && graph.cyclic) return false;
        const changed = changedConstants(na.inputs, nb.inputs, false);
        if (!changed) return false;
        if (changed.length && (na.type === COMPONENT_PATCH_TYPE || na.type === VARIABLE_BROADCASTER_TYPE || getPatchSpec(registry, na.type)?.dynamicPorts)) return false;
        nodes.push({ from: b, id: pid, node: na, keys: changed });
      }
    }
    if (a.layers !== b.layers) {
      const walk = (next: readonly LayerNode[], before: readonly LayerNode[]): boolean => {
        if (next.length !== before.length) return false;
        for (let k = 0; k < next.length; k++) {
          const la = next[k]!;
          const lb = before[k]!;
          if (la === lb) continue;
          if (!sameFields(la, lb, LAYER_CONTENT) || la.type === COMPONENT_INSTANCE_LAYER_TYPE) return false;
          // Names only reach compile issues, which unknown layer types raise.
          if (la.name !== lb.name && !registry.layers.has(la.type)) return false;
          const changed = changedConstants(la.props, lb.props, true);
          if (!changed) return false;
          layers.push({ from: b, node: la, keys: changed });
          if (!walk(la.children ?? [], lb.children ?? [])) return false;
        }
        return true;
      };
      if (!walk(a.layers, b.layers)) return false;
    }
  }

  // Resolve every write first, so a surprise leaves the graph as it was.
  const writes: { binding: Extract<Binding, { kind: "const" }>; value: Value | Loop }[] = [];
  const nodeSwaps: { cnode: CNode; node: PatchNode }[] = [];
  const layerSwaps: { layer: CLayer; node: LayerNode }[] = [];
  const scopesOf = (component: Component) => graph.scopes.filter((s) => s.component === component);
  for (const edit of nodes) {
    for (const scope of scopesOf(edit.from)) {
      // Component patches and broadcasters aren't compiled nodes; only their positions can differ here.
      const cnode = scope.nodes.get(edit.id);
      if (!cnode) continue;
      nodeSwaps.push({ cnode, node: edit.node });
      if (cnode.kind === "receiver" || cnode.kind === "inert") continue;
      for (const key of edit.keys) {
        const i = cnode.inputIndex.get(key);
        if (i === undefined) continue;
        const binding = cnode.bindings[i]!;
        if (binding.kind !== "const") return false;
        const slot = cnode.inputs[i]!;
        const stored = edit.node.inputs[key];
        writes.push({ binding, value: stored === undefined ? slot.default : decodeStored(stored, slot.type) });
      }
    }
  }
  for (const edit of layers) {
    for (const scope of scopesOf(edit.from)) {
      const layer = scope.layerIndex.get(edit.node.id);
      if (!layer) continue;
      if (layer.node.id !== edit.node.id || layer.instance) return false;
      layerSwaps.push({ layer, node: edit.node });
      for (const key of edit.keys) {
        const prop = layer.props.get(key);
        if (!prop) continue;
        const binding = layer.propBindings.get(key);
        if (!binding || binding.kind !== "const") return false;
        const stored = edit.node.props[key]!;
        writes.push({ binding, value: stored === null && prop.default === null ? null : decodeStored(stored, prop.type) });
      }
    }
  }

  for (const { binding, value } of writes) binding.value = value;
  for (const { cnode, node } of nodeSwaps) {
    cnode.node = node;
    if (cnode.context) cnode.context.node = node;
  }
  for (const { layer, node } of layerSwaps) layer.node = node;
  for (const scope of graph.scopes) {
    const swapped = swaps.get(scope.component);
    if (swapped) scope.component = swapped;
  }
  graph.doc = next;
  return true;
}

function bindingDeps(b: Binding | null, out: CNode[]): void {
  if (!b) return;
  switch (b.kind) {
    case "output":
      out.push(b.node);
      return;
    case "input":
      bindingDeps(b.input.binding, out);
      return;
    case "instanceOutput":
      if (b.scope.copies) out.push(b.scope.copies);
      bindingDeps(b.inner, out);
      return;
    case "variable":
      bindingDeps(b.source, out);
      return;
    default:
      return;
  }
}

/** A published input that reaches itself only through pass-through bindings has no patch to delay it: break it. */
function breakPassThroughCycles(scopes: readonly Scope[], issue: (code: string, severity: RuntimeIssue["severity"], message: string) => void): void {
  const state = new Map<ScopeInput, 1 | 2>();
  const visitBinding = (b: Binding | null): void => {
    if (!b) return;
    if (b.kind === "input") visitInput(b.input);
    else if (b.kind === "instanceOutput") visitBinding(b.inner);
  };
  const visitInput = (input: ScopeInput): void => {
    const s = state.get(input);
    if (s === 2) return;
    if (s === 1) {
      issue("zero_latency_cycle", "error", `Published input "${input.key}" feeds itself through component outputs with no patch in between, so it uses its default.`);
      input.binding = constBinding(input.default, input.port.type);
      return;
    }
    state.set(input, 1);
    visitBinding(input.binding);
    state.set(input, 2);
  };
  for (const scope of scopes) for (const input of scope.inputs) visitInput(input);
}

function delay1Definition(cnode: CNode, spec: PatchSpec): PatchDefinition<{ seeded: boolean; held: Value }> {
  return {
    ...spec,
    state: () => ({ seeded: false, held: undefined }),
    evaluate(ctx) {
      if (cnode.feedback[0]) {
        // The driver evaluates later this frame, so the read is already last frame's value.
        ctx.output("output", ctx.input("value"));
        return;
      }
      const v = ctx.input<Value>("value");
      const state = ctx.state;
      if (!state.seeded) {
        state.seeded = true;
        state.held = cnode.inputs[0]!.pulseSource && ctx.pulsed("value") ? false : v;
      }
      ctx.output("output", state.held);
      if (!valuesEqual(state.held, v)) ctx.requestNextFrame();
      state.held = v;
    },
  };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

class MinHeap {
  private items: number[] = [];
  private readonly key: (x: number) => number;
  constructor(key: (x: number) => number) {
    this.key = key;
  }
  get size(): number {
    return this.items.length;
  }
  push(x: number): void {
    const a = this.items;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key(a[p]!) <= this.key(a[i]!)) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.key(a[l]!) < this.key(a[m]!)) m = l;
        if (r < a.length && this.key(a[r]!) < this.key(a[m]!)) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Tarjan's strongly connected components (iterative). Returns the component id per node. */
function stronglyConnected(n: number, succ: readonly number[][]): { compOf: Int32Array; count: number } {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const compOf = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const calls: number[] = [];
  const edge: number[] = [];
  let next = 0;
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    index[s] = low[s] = next++;
    stack.push(s);
    onStack[s] = 1;
    calls.push(s);
    edge.push(0);
    while (calls.length) {
      const top = calls.length - 1;
      const v = calls[top]!;
      const targets = succ[v]!;
      if (edge[top]! < targets.length) {
        const w = targets[edge[top]!++]!;
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          calls.push(w);
          edge.push(0);
        } else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
        continue;
      }
      calls.pop();
      edge.pop();
      if (calls.length) {
        const u = calls[calls.length - 1]!;
        low[u] = Math.min(low[u]!, low[v]!);
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          compOf[w] = count;
        } while (w !== v);
        count++;
      }
    }
  }
  return { compOf, count };
}

/**
 * Deterministic evaluation order: components of the condensation DAG in topological order
 * (ties by compile order); inside a cycle, back-edges are chosen by `orderCycle`'s rule and the
 * rest is ordered topologically.
 */
function orderNodes(nodes: CNode[]): CNode[] {
  const n = nodes.length;
  const succ: number[][] = nodes.map(() => []);
  for (const node of nodes) for (const d of node.deps) if (d !== node) succ[d.compileIndex]!.push(node.compileIndex);
  const { compOf, count } = stronglyConnected(n, succ);
  const members: number[][] = Array.from({ length: count }, () => []);
  for (let v = 0; v < n; v++) members[compOf[v]!]!.push(v);
  const compSucc: Set<number>[] = Array.from({ length: count }, () => new Set());
  const indegree = new Int32Array(count);
  for (let v = 0; v < n; v++) {
    for (const w of succ[v]!) {
      const a = compOf[v]!;
      const b = compOf[w]!;
      if (a !== b && !compSucc[a]!.has(b)) {
        compSucc[a]!.add(b);
        indegree[b]!++;
      }
    }
  }
  const ready = new MinHeap((c) => members[c]![0]!);
  for (let c = 0; c < count; c++) if (indegree[c] === 0) ready.push(c);
  const order: CNode[] = [];
  while (ready.size) {
    const c = ready.pop();
    const group = members[c]!;
    if (group.length === 1) order.push(nodes[group[0]!]!);
    else for (const v of orderCycle(nodes, group, succ, compOf, c)) order.push(nodes[v]!);
    for (const d of compSucc[c]!) if (--indegree[d]! === 0) ready.push(d);
  }
  order.forEach((node, i) => (node.order = i));
  return order;
}

/** A node's position in each scope from its own up to the root: the node itself, then the component patch that contains it. */
function visualChain(node: CNode): { scope: Scope; key: string; x: number | undefined }[] {
  const out: { scope: Scope; key: string; x: number | undefined }[] = [];
  const patchX = (scope: Scope, id: Id) => {
    const x = scope.component.patches[id]?.ui?.x;
    return typeof x === "number" && Number.isFinite(x) ? x : undefined;
  };
  if (node.kind === "copies") {
    const child = node.copiesOf!;
    out.push({ scope: node.scope, key: child.instanceId!, x: child.kind === "patchInstance" ? patchX(node.scope, child.instanceId!) : undefined });
  } else {
    out.push({ scope: node.scope, key: node.id, x: patchX(node.scope, node.id) });
  }
  for (let s: Scope = node.scope; s.parent; s = s.parent) {
    out.push({ scope: s.parent, key: s.instanceId!, x: s.kind === "patchInstance" ? patchX(s.parent, s.instanceId!) : undefined });
  }
  return out;
}

/**
 * source ui.x ≥ target ui.x, compared in the nearest scope containing both (a patch inside a
 * component is placed where its component patch is). False when either has no position there or
 * both sit in the same component patch.
 */
function visuallyBackwards(source: CNode, target: CNode): boolean {
  const b = visualChain(target);
  for (const ea of visualChain(source)) {
    const eb = b.find((e) => e.scope === ea.scope);
    if (!eb) continue;
    return ea.key !== eb.key && ea.x !== undefined && eb.x !== undefined && ea.x >= eb.x;
  }
  return false;
}

/**
 * Order one strongly connected component. Back-edges (edges whose consumer reads last frame's
 * value) follow core's feedback rule: every edge into a Delay One Frame; then, while a cycle
 * remains, one edge per remaining cycle, preferring visually backwards edges, then the lowest
 * target id (then source id, then compile order). The rest is ordered topologically.
 */
function orderCycle(nodes: readonly CNode[], group: readonly number[], succ: readonly number[][], compOf: Int32Array, comp: number): number[] {
  const n = nodes.length;
  const edgeKey = (v: number, w: number) => v * n + w;
  const back = new Set<number>();
  for (const v of group) for (const w of succ[v]!) if (compOf[w] === comp && nodes[w]!.kind === "delay1") back.add(edgeKey(v, w));
  const kept = (v: number, w: number) => compOf[w] === comp && !back.has(edgeKey(v, w));

  const prefer = (a: readonly [number, number], b: readonly [number, number]): boolean => {
    const ta = visuallyBackwards(nodes[a[0]]!, nodes[a[1]]!) ? 0 : 1;
    const tb = visuallyBackwards(nodes[b[0]]!, nodes[b[1]]!) ? 0 : 1;
    if (ta !== tb) return ta < tb;
    const [sa, wa] = [nodes[a[0]]!, nodes[a[1]]!];
    const [sb, wb] = [nodes[b[0]]!, nodes[b[1]]!];
    if (wa.id !== wb.id) return wa.id < wb.id;
    if (sa.id !== sb.id) return sa.id < sb.id;
    if (a[1] !== b[1]) return a[1] < b[1];
    return a[0] < b[0];
  };

  const local = new Map<number, number>();
  group.forEach((v, i) => local.set(v, i));
  for (;;) {
    const localSucc = group.map((v) => succ[v]!.filter((w) => kept(v, w)).map((w) => local.get(w)!));
    const { compOf: sub, count } = stronglyConnected(group.length, localSucc);
    const parts: number[][] = Array.from({ length: count }, () => []);
    for (let i = 0; i < group.length; i++) parts[sub[i]!]!.push(group[i]!);
    let broke = false;
    for (let c = 0; c < count; c++) {
      const part = parts[c]!;
      if (part.length < 2) continue;
      let best: [number, number] | null = null;
      for (const v of part) {
        for (const w of succ[v]!) {
          if (!kept(v, w) || sub[local.get(w)!] !== c) continue;
          if (!best || prefer([v, w], best)) best = [v, w];
        }
      }
      if (best) {
        back.add(edgeKey(best[0], best[1]));
        broke = true;
      }
    }
    if (!broke) break;
  }

  const indegree = new Map<number, number>();
  for (const v of group) indegree.set(v, 0);
  for (const v of group) for (const w of succ[v]!) if (kept(v, w)) indegree.set(w, indegree.get(w)! + 1);
  const heap = new MinHeap((x) => x);
  for (const v of group) if (indegree.get(v) === 0) heap.push(v);
  const out: number[] = [];
  while (heap.size) {
    const v = heap.pop();
    out.push(v);
    for (const w of succ[v]!) {
      if (!kept(v, w)) continue;
      const d = indegree.get(w)! - 1;
      indegree.set(w, d);
      if (d === 0) heap.push(w);
    }
  }
  return out;
}
