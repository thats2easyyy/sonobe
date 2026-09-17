/**
 * Cables whose port handles React Flow has registered. A node measures its handles when it mounts
 * or resizes. A cable that arrives in the same render as its port (a layer target row added by a
 * connect), or a port row that changes without resizing the node, would ask React Flow for a
 * handle it hasn't measured, and React Flow logs error #008 and drops the cable. The editor holds
 * those cables back, asks React Flow to re-measure the nodes, and draws the cables once the handles
 * exist.
 */

export interface HandleBoundsLike {
  id?: string | null;
}

/** The part of a React Flow internal node this check reads. */
export interface InternalNodeLike {
  internals: { handleBounds?: { source?: readonly HandleBoundsLike[] | null; target?: readonly HandleBoundsLike[] | null } | null };
}

export interface HandleLookup {
  get(id: string): InternalNodeLike | undefined;
}

export interface EdgeLike {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface HandleCheck<E extends EdgeLike> {
  /** Cables that are safe to hand to React Flow (the input array when nothing is held back). */
  edges: readonly E[];
  /** Ids of cables held back. */
  missing: string[];
  /** Nodes whose handles need measuring again. */
  nodes: string[];
}

const hasHandle = (list: readonly HandleBoundsLike[] | null | undefined, id: string | null | undefined) => !!list?.some((h) => (h.id ?? null) === (id ?? null));

/**
 * Split cables into those React Flow can draw and those whose handle isn't registered on a measured
 * node. Nodes React Flow hasn't measured yet are left to React Flow (it skips them quietly). Handle
 * lookup matches React Flow's loose connection mode: a target handle may be registered as a source.
 */
export function edgesWithRegisteredHandles<E extends EdgeLike>(edges: readonly E[], lookup: HandleLookup): HandleCheck<E> {
  const missing: string[] = [];
  const nodes = new Set<string>();
  for (const edge of edges) {
    const source = lookup.get(edge.source)?.internals.handleBounds;
    const target = lookup.get(edge.target)?.internals.handleBounds;
    if (!source || !target) continue;
    const sourceOk = hasHandle(source.source, edge.sourceHandle);
    const targetOk = hasHandle(target.target, edge.targetHandle) || hasHandle(target.source, edge.targetHandle);
    if (sourceOk && targetOk) continue;
    missing.push(edge.id);
    if (!sourceOk) nodes.add(edge.source);
    if (!targetOk) nodes.add(edge.target);
  }
  if (missing.length === 0) return { edges, missing, nodes: [] };
  const held = new Set(missing);
  return { edges: edges.filter((e) => !held.has(e.id)), missing, nodes: [...nodes] };
}

/** A stable key for the held-back cables and the nodes to re-measure ("" when there are none). */
export function missingHandlesKey(edges: readonly EdgeLike[], lookup: HandleLookup): string {
  const check = edgesWithRegisteredHandles(edges, lookup);
  return check.missing.length ? `${check.missing.join(",")}|${check.nodes.join(",")}` : "";
}

/** Parse a key from missingHandlesKey. */
export function parseMissingHandlesKey(key: string): { missing: string[]; nodes: string[] } {
  if (!key) return { missing: [], nodes: [] };
  const [edges = "", nodes = ""] = key.split("|");
  return { missing: edges ? edges.split(",") : [], nodes: nodes ? nodes.split(",") : [] };
}
