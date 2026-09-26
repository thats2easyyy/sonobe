/** What a screen reader says for a cable: the patches and ports it joins, and what it carries. */

import { VALUE_TYPE_LABELS } from "../../../ui/PortGlyph.tsx";
import type { CableEdge } from "@sonobe/core/graph";
import { portKey, type GraphModel } from "./types.ts";

/** Node titles by flow node id, for cables to name their ends. */
export function nodeTitles(model: GraphModel): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  for (const node of model.nodes) if (node.data.kind !== "comment") titles.set(node.id, node.data.title);
  return titles;
}

/** "Tap Photo Tap to Zoomed Flip, pulse" */
export function cableLabel(model: GraphModel, titles: ReadonlyMap<string, string>, edge: CableEdge): string {
  const { from, to, sourceType, invalid } = edge.data;
  const end = (nodeId: string, side: "out" | "in", address: string) => [titles.get(nodeId), model.ports.get(portKey(side, address))?.name].filter(Boolean).join(" ");
  return `${end(edge.source, "out", from)} to ${end(edge.target, "in", to)}, ${VALUE_TYPE_LABELS[sourceType].toLowerCase()}${invalid ? ", can't connect" : ""}`;
}
