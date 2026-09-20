/**
 * The examples' patch layout: columns by dataflow depth, separate flows stacked. Positions only.
 * Kept as it was when the examples were built, so rebuilding them reproduces the committed files;
 * tidy_graph and the editor's Tidy Up use the frame-aware tidy in @sonobe/core/graph.
 */

import { isLinkInput, parseAddress, type Component, type Id, type Op } from "@sonobe/core";

export interface TidyOptions {
  /** Patches to arrange (default: all). */
  ids?: Id[];
  /** LR: sources left, consumers right. TB: sources on top. Default LR. */
  direction?: "LR" | "TB";
  spacing?: [number, number];
}

/** updatePatch ops that arrange patches into columns (LR) or rows (TB) by dataflow depth. */
export function tidyOps(c: Component, options: TidyOptions = {}): Op[] {
  const ids = (options.ids ?? Object.keys(c.patches)).filter((id) => c.patches[id]);
  if (!ids.length) return [];
  const inScope = new Set(ids);
  const [gapMain, gapCross] = options.spacing ?? [240, 120];
  const preds = new Map<Id, Id[]>(ids.map((id) => [id, []]));
  const succs = new Map<Id, Id[]>(ids.map((id) => [id, []]));
  for (const id of ids) {
    for (const value of Object.values(c.patches[id]!.inputs)) {
      if (!isLinkInput(value)) continue;
      const a = parseAddress(value.link);
      if (a?.kind !== "patch" || !inScope.has(a.id) || a.id === id) continue;
      preds.get(id)!.push(a.id);
      succs.get(a.id)!.push(id);
    }
  }
  const pos = (id: Id) => c.patches[id]!.ui;
  const byPosition = (a: Id, b: Id) =>
    pos(a).y - pos(b).y || pos(a).x - pos(b).x || a.localeCompare(b);

  // Longest-path depth; edges that close a cycle are ignored.
  const depth = new Map<Id, number>();
  const visiting = new Set<Id>();
  const visit = (id: Id): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let d = 0;
    for (const p of preds.get(id)!) if (!visiting.has(p)) d = Math.max(d, visit(p) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const id of ids) visit(id);

  // Weakly connected groups become separate bands.
  const seen = new Set<Id>();
  const groups: Id[][] = [];
  for (const start of [...ids].sort(byPosition)) {
    if (seen.has(start)) continue;
    const group: Id[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const next of [...preds.get(id)!, ...succs.get(id)!])
        if (!seen.has(next)) (seen.add(next), stack.push(next));
    }
    groups.push(group);
  }

  const originX = Math.min(...ids.map((id) => pos(id).x));
  const originY = Math.min(...ids.map((id) => pos(id).y));
  const placed = new Map<Id, { x: number; y: number }>();
  let band = 0;
  for (const group of groups) {
    const columns = new Map<number, Id[]>();
    for (const id of group)
      columns.set(depth.get(id)!, [...(columns.get(depth.get(id)!) ?? []), id]);
    const row = new Map<Id, number>();
    let bandSize = 1;
    for (const d of [...columns.keys()].sort((a, b) => a - b)) {
      const list = columns.get(d)!;
      const bary = (id: Id) => {
        const ps = preds.get(id)!.filter((p) => row.has(p));
        return ps.length
          ? ps.reduce((s, p) => s + row.get(p)!, 0) / ps.length
          : Number.POSITIVE_INFINITY;
      };
      list.sort((a, b) => bary(a) - bary(b) || byPosition(a, b));
      list.forEach((id, i) => row.set(id, i));
      bandSize = Math.max(bandSize, list.length);
    }
    for (const id of group) {
      const main = depth.get(id)! * gapMain;
      const cross = (band + row.get(id)!) * gapCross;
      placed.set(
        id,
        options.direction === "TB"
          ? { x: originX + cross * 1.6, y: originY + main * 0.6 }
          : { x: originX + main, y: originY + cross },
      );
    }
    band += bandSize + 1;
  }
  const ops: Op[] = [];
  for (const id of ids) {
    const next = placed.get(id)!;
    const x = Math.round(next.x);
    const y = Math.round(next.y);
    if (pos(id).x === x && pos(id).y === y) continue;
    ops.push({ op: "updatePatch", component: c.id, id, ui: { x, y } });
  }
  return ops;
}
