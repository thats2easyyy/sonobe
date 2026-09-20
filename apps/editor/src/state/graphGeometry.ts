/**
 * Graph geometry slot: while the patch editor is mounted it answers the "graph.geometry" RPC with
 * every node of the component it shows (patches, "@layer" targets, "$in" / "$out") where it draws
 * them, in patch editor points. Sizes are what React Flow measured; nodes it hasn't rendered yet
 * (it renders only what's on screen) carry the editor's estimate and `measured: 0`. MCP tools read it
 * to tidy and place nodes by their real sizes. The RPC handlers expose the method only while a
 * provider exists, like the bounds methods (bounds.ts).
 */

import type { Id } from "@sonobe/core";

/** [id, x, y, width, height, measured]: measured is 1 when the editor measured the size, 0 for an estimate. */
export type GraphGeometryNode = [id: string, x: number, y: number, width: number, height: number, measured: 0 | 1];

export interface GraphGeometryReply {
  /** The component asked about. */
  component: Id;
  /** The component the patch editor shows; when it isn't `component`, `nodes` is empty. */
  shownComponent: Id;
  /** The document revision the nodes were drawn from. */
  revision: number;
  nodes: GraphGeometryNode[];
}

/** Answers for the component the patch editor shows (`component` defaults to it). */
export type GraphGeometryProvider = (params: { component?: Id }) => GraphGeometryReply | null | Promise<GraphGeometryReply | null>;

export interface GraphGeometrySlot {
  /** Register a provider; the newest one answers. Returns unregister. */
  register(provider: GraphGeometryProvider): () => void;
  get(): GraphGeometryProvider | undefined;
  /** Called when the slot gains its first provider or loses its last. */
  subscribe(cb: () => void): () => void;
}

export function createGraphGeometrySlot(): GraphGeometrySlot {
  const providers: GraphGeometryProvider[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of [...listeners]) cb();
  };
  return {
    register(provider) {
      providers.push(provider);
      if (providers.length === 1) notify();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const index = providers.indexOf(provider);
        if (index >= 0) providers.splice(index, 1);
        if (providers.length === 0) notify();
      };
    },
    get: () => providers.at(-1),
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
