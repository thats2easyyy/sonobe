/** Immutable layer tree updates that copy only the path to the changed node. */

import type { Id, LayerNode } from "../types.ts";

/** Replace layer `id` with `fn(layer)`; returns the same array when the id isn't found. */
export function mapLayer(layers: LayerNode[], id: Id, fn: (layer: LayerNode) => LayerNode): LayerNode[] {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (layer.id === id) {
      const out = [...layers];
      out[i] = fn(layer);
      return out;
    }
    if (layer.children?.length) {
      const children = mapLayer(layer.children, id, fn);
      if (children !== layer.children) {
        const out = [...layers];
        out[i] = { ...layer, children };
        return out;
      }
    }
  }
  return layers;
}

/** Remove layer `id` (with its subtree). A parent left with no children loses its `children` key. */
export function removeLayerNode(layers: LayerNode[], id: Id): LayerNode[] {
  const at = layers.findIndex((l) => l.id === id);
  if (at >= 0) return [...layers.slice(0, at), ...layers.slice(at + 1)];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]!;
    if (!layer.children?.length) continue;
    const children = removeLayerNode(layer.children, id);
    if (children !== layer.children) {
      const out = [...layers];
      const next: LayerNode = { ...layer, children };
      if (!children.length) delete next.children;
      out[i] = next;
      return out;
    }
  }
  return layers;
}

/** Insert `node` at `index` among the children of `parentId` (null = component root). */
export function insertLayerNode(layers: LayerNode[], parentId: Id | null, index: number, node: LayerNode): LayerNode[] {
  if (parentId === null) {
    const out = [...layers];
    out.splice(index, 0, node);
    return out;
  }
  return mapLayer(layers, parentId, (parent) => {
    const children = [...(parent.children ?? [])];
    children.splice(index, 0, node);
    return { ...parent, children };
  });
}
