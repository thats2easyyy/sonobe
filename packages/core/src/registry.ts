/**
 * Registry: patch and layer type declarations, plus resolution of the concrete ports
 * of a patch node (variants, variadic expansion, dynamic ports, component instances)
 * and the props of a layer. Also layer-tree helpers.
 */

import { LAYER_TYPES } from "./layerTypes.ts";
import type {
  Component,
  EnumOption,
  Id,
  InputCountRange,
  InterfacePort,
  LayerNode,
  LayerTypeSpec,
  PatchNode,
  PatchSpec,
  PortSpec,
  PropCategory,
  PropSpec,
  Registry,
  SonobeDocument,
  ValueType,
} from "./types.ts";
import { decodeInput, isDecodedLoop, isLoopLiteral, isValueType, zeroLiteral } from "./values.ts";

export const COMPONENT_PATCH_TYPE = "component";
export const COMPONENT_INSTANCE_LAYER_TYPE = "componentInstance";

/**
 * A port with its concrete value type ("variant" resolved). For spec ports `default` stays
 * document-encoded (see PortSpec.default and resolveNodePorts); published interface ports carry
 * decoded values.
 */
export interface ResolvedPort extends PortSpec {
  type: ValueType;
  /** 1-based position for ports expanded from a variadic spec (option0 is 1 when startIndex is 0). */
  variadicIndex?: number;
  /** True for ports that come from a component's published interface. */
  fromInterface?: boolean;
}

/** A layer prop with its concrete value type. */
export interface ResolvedProp extends PropSpec {
  type: ValueType;
  fromInterface?: boolean;
}

export interface ResolvedPorts {
  spec: PatchSpec;
  /** Effective variant (the node's typeParam, or the first variant). */
  typeParam: ValueType | undefined;
  /** Allowed typeParam values for this node: variants declared by dynamicPorts, else the spec's. */
  variants?: ValueType[];
  /** Effective count (clamped to the spec's variadic range or inputCountRange). */
  inputCount: number | undefined;
  inputs: ResolvedPort[];
  outputs: ResolvedPort[];
  /** Set when the spec's dynamicPorts threw; static ports are used instead. */
  dynamicPortsError?: string;
}

/** Built-in spec for type "component" patches (instances of patch components). */
export const COMPONENT_PATCH_SPEC: PatchSpec = {
  type: COMPONENT_PATCH_TYPE,
  name: "Component",
  category: "components",
  summary: "An instance of a patch component. Its ports are the component's published inputs and outputs.",
  inputs: [],
  outputs: [],
  dynamicPorts: (node, doc) => componentInterfacePorts(doc, node.component),
};

/** Build a registry from patch specs (or engine definitions) and layer types. */
export function createRegistry(patchSpecs: Iterable<PatchSpec> = [], layerTypes: Iterable<LayerTypeSpec> = LAYER_TYPES): Registry {
  const patches = new Map<string, PatchSpec>();
  for (const spec of patchSpecs) {
    if (patches.has(spec.type)) throw new Error(`Patch type "${spec.type}" is declared twice.`);
    patches.set(spec.type, spec);
  }
  if (!patches.has(COMPONENT_PATCH_TYPE)) patches.set(COMPONENT_PATCH_TYPE, COMPONENT_PATCH_SPEC);
  const layers = new Map<string, LayerTypeSpec>();
  for (const spec of layerTypes) {
    if (layers.has(spec.type)) throw new Error(`Layer type "${spec.type}" is declared twice.`);
    layers.set(spec.type, spec);
  }
  return { patches, layers };
}

export function getPatchSpec(registry: Registry, type: string): PatchSpec | undefined {
  return registry.patches.get(type) ?? (type === COMPONENT_PATCH_TYPE ? COMPONENT_PATCH_SPEC : undefined);
}

export function getLayerTypeSpec(registry: Registry, type: string): LayerTypeSpec | undefined {
  return registry.layers.get(type);
}

/**
 * The effective variant for a node: its typeParam when allowed, else the first variant.
 * `variants` (declared by the node's dynamicPorts) replaces the spec's variants when non-empty.
 */
export function resolveTypeParam(spec: PatchSpec, typeParam: string | undefined, variants?: readonly ValueType[]): ValueType | undefined {
  const allowed = variants?.length ? variants : spec.variants;
  if (!allowed?.length) return undefined;
  return typeParam !== undefined && (allowed as readonly string[]).includes(typeParam) ? (typeParam as ValueType) : allowed[0];
}

/** The inputCount range of a spec: its VariadicSpec's range, else `inputCountRange`; undefined for fixed ports. */
export function getInputCountRange(spec: PatchSpec): InputCountRange | undefined {
  const range = spec.variadic ?? spec.inputCountRange;
  return range ? { min: range.min, max: range.max, defaultCount: range.defaultCount } : undefined;
}

/** The effective input count for a node, clamped to the spec's variadic range or inputCountRange. */
export function resolveInputCount(spec: PatchSpec, inputCount: number | undefined): number | undefined {
  const range = getInputCountRange(spec);
  if (!range) return undefined;
  const n = inputCount === undefined || !Number.isFinite(inputCount) ? range.defaultCount : Math.round(inputCount);
  return Math.min(range.max, Math.max(range.min, n));
}

interface DynamicPorts {
  inputs: readonly PortSpec[];
  outputs: readonly PortSpec[];
  variants: ValueType[] | undefined;
  error?: string;
}

/** Run a spec's dynamicPorts defensively: a throw becomes `error`, malformed results become empty lists. */
function runDynamicPorts(spec: PatchSpec, node: PatchNode, doc: SonobeDocument): DynamicPorts | undefined {
  if (!spec.dynamicPorts) return undefined;
  try {
    const dyn = spec.dynamicPorts(node, doc);
    const variants = Array.isArray(dyn?.variants) ? dyn.variants.filter(isValueType) : [];
    return {
      inputs: Array.isArray(dyn?.inputs) ? dyn.inputs : [],
      outputs: Array.isArray(dyn?.outputs) ? dyn.outputs : [],
      variants: variants.length ? variants : undefined,
    };
  } catch (err) {
    return { inputs: [], outputs: [], variants: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}

function effectiveVariants(spec: PatchSpec, dynamic: readonly ValueType[] | undefined): ValueType[] | undefined {
  const variants = dynamic?.length ? dynamic : spec.variants;
  return variants?.length ? [...variants] : undefined;
}

/** Allowed typeParam values for a node: the variants its dynamicPorts declare, else the spec's. Undefined without variants. */
export function resolveNodeVariants(doc: SonobeDocument, node: PatchNode, registry: Registry): ValueType[] | undefined {
  const spec = getPatchSpec(registry, node.type);
  if (!spec) return undefined;
  return effectiveVariants(spec, runDynamicPorts(spec, node, doc)?.variants);
}

const PROP_CATEGORIES: ReadonlySet<string> = new Set(["basics", "layout", "content", "text", "fill", "stroke", "shadow", "transform", "filters", "interaction"]);

const sortedPorts = (ports: Record<string, InterfacePort> | undefined) =>
  Object.values(ports ?? {}).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** Convert a published interface port into a resolved port declaration. */
export function interfacePortToPort(port: InterfacePort, direction: "input" | "output"): ResolvedPort {
  const resolved: ResolvedPort = {
    key: port.key,
    name: port.name || port.key,
    type: port.type,
    description: direction === "input" ? `Published input "${port.name || port.key}".` : `Published output "${port.name || port.key}".`,
    fromInterface: true,
  };
  if (port.default !== undefined) {
    const def = decodeInput(port.default, port.type);
    if (def !== undefined) resolved.default = isDecodedLoop(def) ? def.items : def;
  }
  if (port.enumOptions?.length) resolved.enumOptions = port.enumOptions.map((key): EnumOption => ({ key, name: key }));
  return resolved;
}

/** Ports of a component's published interface (sorted by key). Empty when the component doesn't exist. */
export function componentInterfacePorts(doc: SonobeDocument, componentId: Id | undefined): { inputs: ResolvedPort[]; outputs: ResolvedPort[] } {
  const target = componentId === undefined ? undefined : doc.components[componentId];
  if (!target) return { inputs: [], outputs: [] };
  return {
    inputs: sortedPorts(target.interface?.inputs).map((p) => interfacePortToPort(p, "input")),
    outputs: sortedPorts(target.interface?.outputs).map((p) => interfacePortToPort(p, "output")),
  };
}

function mergePorts(base: ResolvedPort[], extra: readonly PortSpec[], resolveType: (t: PortSpec["type"]) => ValueType): ResolvedPort[] {
  const out = [...base];
  for (const p of extra) {
    const resolved: ResolvedPort = { ...p, type: resolveType(p.type) };
    const at = out.findIndex((q) => q.key === p.key);
    if (at >= 0) out[at] = resolved;
    else out.push(resolved);
  }
  return out;
}

/**
 * Resolve the concrete ports of a patch node (which need not be in the document yet).
 *
 * - "variant" ports take the effective typeParam; dynamicPorts may declare the allowed variants.
 * - Defaults stay document-encoded literals (see PortSpec.default). For the effective variant, a
 *   `variantDefaults` entry wins (by port key, then by variadic base key). Otherwise a variant port
 *   keeps its declared default for the first variant and gets the type's zero value (zeroLiteral)
 *   for other variants. Loop literals ({ loop: [...] }) are never converted.
 * - Variadic ports expand from `startIndex` (default 1) on the side named by `direction`
 *   (default inputs), after that side's static ports.
 * - Dynamic ports merge last, unchanged, and replace static ports with the same key.
 */
export function resolveNodePorts(doc: SonobeDocument, node: PatchNode, registry: Registry): ResolvedPorts | undefined {
  const spec = getPatchSpec(registry, node.type);
  if (!spec) return undefined;
  const dynamic = runDynamicPorts(spec, node, doc);
  const variants = effectiveVariants(spec, dynamic?.variants);
  const typeParam = resolveTypeParam(spec, node.typeParam, dynamic?.variants);
  const resolveType = (t: PortSpec["type"]): ValueType => (t === "variant" ? (typeParam ?? "any") : t);
  const overrides = typeParam ? spec.variantDefaults?.[typeParam] : undefined;
  const resolvePort = (p: PortSpec, variadicKey?: string): ResolvedPort => {
    const type = resolveType(p.type);
    const port: ResolvedPort = { ...p, type };
    if (p.type !== "variant" || typeParam === undefined) return port;
    if (overrides && Object.hasOwn(overrides, p.key)) port.default = overrides[p.key];
    else if (overrides && variadicKey !== undefined && Object.hasOwn(overrides, variadicKey)) port.default = overrides[variadicKey];
    else if (p.default !== undefined && typeParam !== variants?.[0] && !isLoopLiteral(p.default)) {
      const zero = zeroLiteral(type, p.enumOptions);
      if (zero === undefined) delete port.default;
      else port.default = zero;
    }
    return port;
  };
  let inputs = spec.inputs.map((p) => resolvePort(p));
  let outputs = spec.outputs.map((p) => resolvePort(p));
  const inputCount = resolveInputCount(spec, node.inputCount);
  const v = spec.variadic;
  if (v && inputCount !== undefined) {
    const start = v.startIndex ?? 1;
    const side = v.direction === "outputs" ? outputs : inputs;
    for (let i = 0; i < inputCount; i++) {
      const n = start + i;
      const declared: PortSpec = { key: `${v.key}${n}`, name: `${v.name} ${n}`, type: v.type, description: v.description };
      if (v.default !== undefined) declared.default = v.default;
      const port = resolvePort(declared, v.key);
      port.variadicIndex = i + 1;
      side.push(port);
    }
  }
  if (dynamic && dynamic.error === undefined) {
    inputs = mergePorts(inputs, dynamic.inputs, resolveType);
    outputs = mergePorts(outputs, dynamic.outputs, resolveType);
  }
  const result: ResolvedPorts = { spec, typeParam, inputCount, inputs, outputs };
  if (variants) result.variants = variants;
  if (dynamic?.error !== undefined) result.dynamicPortsError = dynamic.error;
  return result;
}

/** Resolve the ports of patch `patchId` in component `componentId`; undefined if the patch or its type is unknown. */
export function resolvePatchPorts(doc: SonobeDocument, componentId: Id, patchId: Id, registry: Registry): ResolvedPorts | undefined {
  const node = doc.components[componentId]?.patches[patchId];
  return node ? resolveNodePorts(doc, node, registry) : undefined;
}

/**
 * Resolve the props a layer accepts: its type's props, plus published inputs for a
 * componentInstance. Undefined when the layer type is unknown.
 */
export function resolveLayerProps(doc: SonobeDocument, _componentId: Id, layer: Pick<LayerNode, "type" | "component">, registry: Registry): ResolvedProp[] | undefined {
  const spec = registry.layers.get(layer.type);
  if (!spec) return undefined;
  const props: ResolvedProp[] = spec.props.map((p) => ({ ...p, type: p.type === "variant" ? "any" : p.type }));
  if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component) {
    const target = doc.components[layer.component];
    for (const port of sortedPorts(target?.interface?.inputs)) {
      if (props.some((p) => p.key === port.key)) continue;
      const category = (port.category && PROP_CATEGORIES.has(port.category) ? port.category : "content") as PropCategory;
      props.push({ ...interfacePortToPort(port, "input"), category });
    }
  }
  return props;
}

/** Read-only outputs of a layer: its type's outputs, plus published outputs for a componentInstance. */
export function resolveLayerOutputs(doc: SonobeDocument, _componentId: Id, layer: Pick<LayerNode, "type" | "component">, registry: Registry): ResolvedPort[] {
  const spec = registry.layers.get(layer.type);
  const outputs: ResolvedPort[] = (spec?.outputs ?? []).map((p) => ({ ...p, type: p.type === "variant" ? "any" : p.type }));
  if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component) {
    for (const port of componentInterfacePorts(doc, layer.component).outputs) {
      if (!outputs.some((p) => p.key === port.key)) outputs.push(port);
    }
  }
  return outputs;
}

export function findPort<P extends { key: string }>(ports: readonly P[] | undefined, key: string): P | undefined {
  return ports?.find((p) => p.key === key);
}

// ---------------------------------------------------------------------------
// Layer tree helpers
// ---------------------------------------------------------------------------

export interface LayerLocation {
  layer: LayerNode;
  /** Parent layer, or null at the component root. */
  parent: LayerNode | null;
  /** Index among siblings (back → front). */
  index: number;
  siblings: readonly LayerNode[];
  depth: number;
  /** Ancestor ids from the root down to (and including) this layer. */
  path: readonly Id[];
}

/** Locate a layer anywhere in a tree. */
export function findLayer(layers: readonly LayerNode[], id: Id): LayerLocation | undefined {
  const visit = (siblings: readonly LayerNode[], parent: LayerNode | null, path: Id[]): LayerLocation | undefined => {
    for (let index = 0; index < siblings.length; index++) {
      const layer = siblings[index]!;
      const here = [...path, layer.id];
      if (layer.id === id) return { layer, parent, index, siblings, depth: path.length, path: here };
      if (layer.children?.length) {
        const found = visit(layer.children, layer, here);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(layers, null, []);
}

export interface WalkInfo {
  parent: LayerNode | null;
  index: number;
  depth: number;
}

/**
 * Depth-first, back → front walk. Return "skip" to not descend into a layer's
 * children, or "stop" to end the walk.
 */
export function walkLayers(layers: readonly LayerNode[], visit: (layer: LayerNode, info: WalkInfo) => void | "skip" | "stop"): void {
  const go = (siblings: readonly LayerNode[], parent: LayerNode | null, depth: number): boolean => {
    for (let index = 0; index < siblings.length; index++) {
      const layer = siblings[index]!;
      const r = visit(layer, { parent, index, depth });
      if (r === "stop") return false;
      if (r !== "skip" && layer.children?.length && !go(layer.children, layer, depth + 1)) return false;
    }
    return true;
  };
  go(layers, null, 0);
}

/** Every layer node in walk order. */
export function allLayers(layers: readonly LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  walkLayers(layers, (l) => {
    out.push(l);
  });
  return out;
}

/** Every layer id in walk order. */
export function allLayerIds(layers: readonly LayerNode[]): Id[] {
  return allLayers(layers).map((l) => l.id);
}

/** Ids from the root to the layer (inclusive); undefined if absent. */
export function layerPath(layers: readonly LayerNode[], id: Id): Id[] | undefined {
  const loc = findLayer(layers, id);
  return loc ? [...loc.path] : undefined;
}

/** True when `id` is inside the subtree of `ancestorId` (not counting itself). */
export function isDescendantLayer(layers: readonly LayerNode[], ancestorId: Id, id: Id): boolean {
  const loc = findLayer(layers, id);
  return !!loc && loc.path.slice(0, -1).includes(ancestorId);
}

/** Every item id in a component: layers, patches, and comments. */
export function componentItemIds(component: Component): Set<Id> {
  const ids = new Set<Id>(allLayerIds(component.layers));
  for (const id of Object.keys(component.patches)) ids.add(id);
  for (const c of component.comments) ids.add(c.id);
  return ids;
}
