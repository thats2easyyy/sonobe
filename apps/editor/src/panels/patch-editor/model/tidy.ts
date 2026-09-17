/**
 * Tidy Up: a left-to-right layered layout (elkjs) that keeps cables short and straight, lines ports
 * up with their rows, keeps comment frames around the patches they contain, and leaves the tidied
 * group anchored where it was.
 */

import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import elkBundleUrl from "elkjs/lib/elk.bundled.js?url";
import type { Rect } from "./geometry.ts";

export interface TidyPort {
  /** Handle id ("in:number"). */
  id: string;
  side: "in" | "out";
  /** Offset of the port's center from the node's top edge. */
  y: number;
}

export interface TidyNodeInput extends Rect {
  id: string;
  ports?: readonly TidyPort[];
}

export interface TidyEdgeInput {
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export interface TidyGroupInput extends Rect {
  id: string;
  /** Node ids framed by this group (comment). */
  children: readonly string[];
}

export interface TidyInput {
  nodes: readonly TidyNodeInput[];
  edges: readonly TidyEdgeInput[];
  groups?: readonly TidyGroupInput[];
}

export interface TidyResult {
  nodes: Map<string, { x: number; y: number }>;
  groups: Map<string, Rect>;
}

export interface TidyOptions {
  /** Gap between columns. Default 72. */
  columnGap?: number;
  /** Gap between nodes in a column. Default 28. */
  rowGap?: number;
  /** Extra ELK layout options, applied to the graph and every frame. */
  layoutOptions?: Readonly<Record<string, string>>;
}

let elkPromise: Promise<ELK> | undefined;

/**
 * ELK's GWT build needs a sloppy-mode global, so browsers load it as a classic script (bundlers that
 * wrap it as an ES module break it); Node imports it as a module.
 */
function loadElk(): Promise<ELK> {
  elkPromise ??= (async () => {
    const g = globalThis as { ELK?: new () => ELK; location?: { protocol?: string } };
    const browser = typeof document !== "undefined" && import.meta.env?.MODE !== "test" && /^(https?|file|app):$/.test(g.location?.protocol ?? "");
    if (browser) {
      if (!g.ELK) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = elkBundleUrl;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("The layout engine couldn't load."));
          document.head.appendChild(script);
        });
      }
      if (!g.ELK) throw new Error("The layout engine didn't start.");
      return new g.ELK();
    }
    const mod = (await import("elkjs/lib/elk.bundled.js")) as unknown as { default: new () => ELK };
    return new mod.default();
  })();
  elkPromise.catch(() => {
    elkPromise = undefined;
  });
  return elkPromise;
}

const GROUP_PADDING = "[top=44,left=20,bottom=20,right=20]";

/** Lay out nodes; positions are absolute and the result's top-left matches the input's. */
export async function tidyLayout(input: TidyInput, options: TidyOptions = {}): Promise<TidyResult> {
  const result: TidyResult = { nodes: new Map(), groups: new Map() };
  if (input.nodes.length === 0) return result;
  const elk = await loadElk();
  const nodeIds = new Set(input.nodes.map((n) => n.id));
  const groupOf = new Map<string, string>();
  const groups = (input.groups ?? []).map((g) => ({ ...g, children: g.children.filter((id) => nodeIds.has(id) && !groupOf.has(id)) })).filter((g) => g.children.length > 0);
  for (const g of groups) for (const id of g.children) groupOf.set(id, g.id);

  const portIds = new Set<string>();
  const toElk = (n: TidyNodeInput): ElkNode => {
    const ports = (n.ports ?? []).map((p) => {
      const id = `${n.id}::${p.id}`;
      portIds.add(id);
      return { id, x: p.side === "in" ? 0 : n.width, y: p.y, width: 0, height: 0, layoutOptions: { "elk.port.side": p.side === "in" ? "WEST" : "EAST" } };
    });
    return { id: n.id, width: n.width, height: n.height, ports, layoutOptions: { "elk.portConstraints": ports.length ? "FIXED_POS" : "FREE" } };
  };
  const layered = {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": String(options.rowGap ?? 28),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(options.columnGap ?? 72),
    "elk.spacing.edgeNode": "16",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    // Note: considerModelOrder crashes ELK once frames (compound nodes) are involved.
    ...options.layoutOptions,
  };
  const children: ElkNode[] = input.nodes.filter((n) => !groupOf.has(n.id)).map(toElk);
  for (const g of groups) {
    children.push({
      id: g.id,
      layoutOptions: { ...layered, "elk.padding": GROUP_PADDING },
      children: g.children.map((id) => toElk(input.nodes.find((n) => n.id === id)!)),
    });
  }
  const edges: ElkExtendedEdge[] = input.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target)
    .map((e, i) => {
      const sourcePort = e.sourceHandle ? `${e.source}::${e.sourceHandle}` : undefined;
      const targetPort = e.targetHandle ? `${e.target}::${e.targetHandle}` : undefined;
      return { id: `e${i}`, sources: [sourcePort && portIds.has(sourcePort) ? sourcePort : e.source], targets: [targetPort && portIds.has(targetPort) ? targetPort : e.target] };
    });

  const graph: ElkNode = {
    id: "root",
    layoutOptions: { "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.separateConnectedComponents": "true", "elk.spacing.componentComponent": "40", ...layered },
    children,
    edges,
  };
  const laid = await elk.layout(graph);

  const raw = new Map<string, Rect>();
  for (const child of laid.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    if (child.children?.length) {
      raw.set(child.id, { x, y, width: child.width ?? 0, height: child.height ?? 0 });
      for (const inner of child.children) raw.set(inner.id, { x: x + (inner.x ?? 0), y: y + (inner.y ?? 0), width: inner.width ?? 0, height: inner.height ?? 0 });
    } else {
      raw.set(child.id, { x, y, width: child.width ?? 0, height: child.height ?? 0 });
    }
  }

  const before = [...input.nodes, ...groups];
  const beforeX = Math.min(...before.map((r) => r.x));
  const beforeY = Math.min(...before.map((r) => r.y));
  const after = [...raw.values()];
  const dx = beforeX - Math.min(...after.map((r) => r.x));
  const dy = beforeY - Math.min(...after.map((r) => r.y));
  const groupIds = new Set(groups.map((g) => g.id));
  for (const [id, r] of raw) {
    const moved = { x: Math.round(r.x + dx), y: Math.round(r.y + dy) };
    if (groupIds.has(id)) result.groups.set(id, { ...moved, width: Math.round(r.width), height: Math.round(r.height) });
    else result.nodes.set(id, moved);
  }
  return result;
}
