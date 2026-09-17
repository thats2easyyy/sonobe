/**
 * The editor's single engine registry (every catalog patch plus fallbacks for unimplemented
 * types), with cached helpers that resolve node ports, layer props, and diagnostics through core.
 */

import {
  findLayer,
  getDiagnostics,
  getLayerTypeSpec,
  getPatchSpec,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  type Diagnostic,
  type Id,
  type LayerTypeSpec,
  type PatchSpec,
  type Registry,
  type ResolvedPort,
  type ResolvedPorts,
  type ResolvedProp,
  type SonobeDocument,
} from "@sonobe/core";
import type { EngineRegistry } from "@sonobe/engine";
import { createPatchRegistry, type PatchRegistry } from "@sonobe/patches";
import { useContext, useMemo } from "react";
import { EditorContext } from "./context.ts";

let shared: PatchRegistry | undefined;

/** The shared registry, created on first use. */
export function getRegistry(): PatchRegistry {
  shared ??= createPatchRegistry();
  return shared;
}

/** Replace the shared registry (plugins, tests). Pass undefined to rebuild the default on next use. */
export function setRegistry(registry: PatchRegistry | undefined): void {
  shared = registry;
}

const diagnosticsCache = new WeakMap<Registry, WeakMap<SonobeDocument, Diagnostic[]>>();

/** getDiagnostics, memoized per document object (documents are immutable). */
export function diagnosticsFor(doc: SonobeDocument, registry: Registry = getRegistry()): Diagnostic[] {
  let byDoc = diagnosticsCache.get(registry);
  if (!byDoc) diagnosticsCache.set(registry, (byDoc = new WeakMap()));
  let list = byDoc.get(doc);
  if (!list) byDoc.set(doc, (list = getDiagnostics(doc, registry)));
  return list;
}

/** Ports of a patch in a component; undefined when the patch or its type is unknown. */
export function resolvePatchPortsIn(doc: SonobeDocument, componentId: Id, patchId: Id, registry: Registry = getRegistry()): ResolvedPorts | undefined {
  const node = doc.components[componentId]?.patches[patchId];
  return node ? resolveNodePorts(doc, node, registry) : undefined;
}

/** Props a layer accepts (type props plus published inputs for component instances). */
export function resolveLayerPropsIn(doc: SonobeDocument, componentId: Id, layerId: Id, registry: Registry = getRegistry()): ResolvedProp[] | undefined {
  const component = doc.components[componentId];
  const layer = component ? findLayer(component.layers, layerId)?.layer : undefined;
  return layer ? resolveLayerProps(doc, componentId, layer, registry) : undefined;
}

/** Read-only outputs of a layer (type outputs plus published outputs for component instances). */
export function resolveLayerOutputsIn(doc: SonobeDocument, componentId: Id, layerId: Id, registry: Registry = getRegistry()): ResolvedPort[] {
  const component = doc.components[componentId];
  const layer = component ? findLayer(component.layers, layerId)?.layer : undefined;
  return layer ? resolveLayerOutputs(doc, componentId, layer, registry) : [];
}

/** Every pulse output address in a component ("patch.port" and "@layer.key"). */
export function pulseOutputAddresses(doc: SonobeDocument, componentId: Id = doc.project.root, registry: Registry = getRegistry()): string[] {
  const component = doc.components[componentId];
  if (!component) return [];
  const out: string[] = [];
  for (const [id, node] of Object.entries(component.patches)) {
    for (const port of resolveNodePorts(doc, node, registry)?.outputs ?? []) if (port.type === "pulse") out.push(`${id}.${port.key}`);
  }
  const visit = (layers: SonobeDocument["components"][string]["layers"]) => {
    for (const layer of layers) {
      for (const port of resolveLayerOutputs(doc, componentId, layer, registry)) if (port.type === "pulse") out.push(`@${layer.id}.${port.key}`);
      if (layer.children?.length) visit(layer.children);
    }
  };
  visit(component.layers);
  return out;
}

/** True when a patch type has a real evaluator (false for fallbacks and unknown types). */
export function isPatchImplemented(registry: EngineRegistry, type: string): boolean {
  const maybe = registry as Partial<PatchRegistry>;
  return typeof maybe.isImplemented === "function" ? maybe.isImplemented(type) : registry.definitions.has(type);
}

/** The registry from the nearest EditorProvider, or the shared one. */
export function useRegistry(): PatchRegistry {
  return useContext(EditorContext)?.registry ?? getRegistry();
}

export function usePatchSpec(type: string | undefined): PatchSpec | undefined {
  const registry = useRegistry();
  return type === undefined ? undefined : getPatchSpec(registry, type);
}

export function useLayerTypeSpec(type: string | undefined): LayerTypeSpec | undefined {
  const registry = useRegistry();
  return type === undefined ? undefined : getLayerTypeSpec(registry, type);
}

/** Resolved ports of a patch; recomputed when the node or the component set changes. */
export function useNodePorts(doc: SonobeDocument, componentId: Id, patchId: Id): ResolvedPorts | undefined {
  const registry = useRegistry();
  const node = doc.components[componentId]?.patches[patchId];
  const components = doc.components;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (node ? resolveNodePorts(doc, node, registry) : undefined), [node, components, registry]);
}

/** Resolved props of a layer; recomputed when the component set changes. */
export function useLayerProps(doc: SonobeDocument, componentId: Id, layerId: Id): ResolvedProp[] | undefined {
  const registry = useRegistry();
  const components = doc.components;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolveLayerPropsIn(doc, componentId, layerId, registry), [components, componentId, layerId, registry]);
}

/** Diagnostics for a document (memoized per document). */
export function useDiagnostics(doc: SonobeDocument): Diagnostic[] {
  const registry = useRegistry();
  return useMemo(() => diagnosticsFor(doc, registry), [doc, registry]);
}
