/**
 * Read helpers over a component: counts, who consumes what, the layer tree, patch lines, item
 * details and find. Output is compact text plus plain data. Browser-safe.
 */

import {
  allLayers,
  decodeInput,
  defaultForPort,
  didYouMean,
  didYouMeanText,
  findLayer,
  formatOutlineValue,
  getPatchSpec,
  isDecodedLoop,
  isLayerInput,
  isLinkInput,
  layerNodeId,
  layersWithGraphNodes,
  listComponentIds,
  listInputs,
  readNodePositions,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  walkLayers,
  type CommentNode,
  type Component,
  type Id,
  type InputValue,
  type LayerNode,
  type PatchNode,
  type Registry,
  type SonobeDocument,
} from "@sonobe/core";
import { HostError } from "./host.ts";

/** A component by id (default root), or a teaching error. */
export function requireComponent(doc: SonobeDocument, componentId: Id | undefined): Component {
  const id = componentId ?? doc.project.root;
  const c = doc.components[id];
  if (c) return c;
  const ids = listComponentIds(doc);
  throw new HostError(
    "unknown_component",
    `There's no component "${id}".${didYouMeanText(didYouMean(id, ids))}`,
    { hint: `Components: ${ids.join(", ")}.` },
  );
}

export interface ComponentCounts {
  layers: number;
  patches: number;
  connections: number;
  comments: number;
}

export function componentCounts(c: Component): ComponentCounts {
  return {
    layers: allLayers(c.layers).length,
    patches: Object.keys(c.patches).length,
    connections: listInputs(c).filter((e) => isLinkInput(e.value)).length,
    comments: c.comments.length,
  };
}

/** source address → target addresses that link from it. */
export function consumersOf(c: Component): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of listInputs(c)) {
    if (!isLinkInput(entry.value)) continue;
    const target =
      entry.target.kind === "patch"
        ? `${entry.target.id}.${entry.target.key}`
        : entry.target.kind === "layer"
          ? `@${entry.target.id}.${entry.target.key}`
          : `$out.${entry.target.key}`;
    out.set(entry.value.link, [...(out.get(entry.value.link) ?? []), target]);
  }
  for (const list of out.values()) list.sort();
  return out;
}

export type ItemKind = "layer" | "patch" | "comment";

export interface LocatedItem {
  component: Component;
  kind: ItemKind;
  layer?: LayerNode;
  patch?: PatchNode;
  comment?: CommentNode;
}

/** Find an item by id in `componentId` (or anywhere when omitted, root first). */
export function locateItem(doc: SonobeDocument, id: Id, componentId?: Id): LocatedItem | undefined {
  const ids = componentId !== undefined ? [componentId] : listComponentIds(doc);
  for (const cid of ids) {
    const c = doc.components[cid];
    if (!c) continue;
    const loc = findLayer(c.layers, id);
    if (loc) return { component: c, kind: "layer", layer: loc.layer };
    if (c.patches[id]) return { component: c, kind: "patch", patch: c.patches[id] };
    const comment = c.comments.find((x) => x.id === id);
    if (comment) return { component: c, kind: "comment", comment };
  }
  return undefined;
}

function isDefaultValue(value: InputValue, port: Parameters<typeof defaultForPort>[0]): boolean {
  if (isLinkInput(value)) return false;
  const decoded = decodeInput(value, port.type === "variant" ? "any" : port.type);
  if (isDecodedLoop(decoded)) return false;
  return JSON.stringify(decoded) === JSON.stringify(defaultForPort(port));
}

function layerSummaryTokens(
  doc: SonobeDocument,
  c: Component,
  layer: LayerNode,
  registry: Registry,
  detail: "summary" | "full",
): string[] {
  const props = resolveLayerProps(doc, c.id, layer, registry);
  const tokens: string[] = [];
  const v = layer.props;
  if (typeof v.text === "string" && (layer.type === "text" || layer.type === "textField"))
    tokens.push(JSON.stringify(v.text.length > 40 ? `${v.text.slice(0, 39)}…` : v.text));
  if (Array.isArray(v.position)) tokens.push(`@${v.position.join(",")}`);
  if (Array.isArray(v.size)) tokens.push(v.size.join("x"));
  for (const [key, value] of Object.entries(v)) {
    if (key === "text" || key === "position" || key === "size") {
      if (isLinkInput(value)) tokens.push(`${key}←${value.link}`);
      continue;
    }
    if (isLinkInput(value)) tokens.push(`${key}←${value.link}`);
    else if (detail === "full") {
      const port = props?.find((p) => p.key === key);
      if (!port || !isDefaultValue(value, port))
        tokens.push(`${key}=${formatOutlineValue(value, port?.type)}`);
    }
  }
  if (layer.component) tokens.push(`component=${layer.component}`);
  if (layer.locked) tokens.push("locked");
  return tokens;
}

export interface LayerTreeOptions {
  parent?: Id;
  depth?: number;
  detail?: "ids" | "summary" | "full";
}

/** Indented layer tree lines, with child-count hints past `depth`. */
export function layerTreeLines(
  doc: SonobeDocument,
  c: Component,
  registry: Registry,
  options: LayerTreeOptions = {},
): string[] {
  const depth = Math.max(1, Math.min(options.depth ?? 3, 10));
  const detail = options.detail ?? "summary";
  let roots: readonly LayerNode[] = c.layers;
  if (options.parent !== undefined) {
    const loc = findLayer(c.layers, options.parent);
    if (!loc)
      throw new HostError(
        "not_found",
        `There's no layer "${options.parent}" in ${c.id}.${didYouMeanText(
          didYouMean(
            options.parent,
            allLayers(c.layers).map((l) => l.id),
          ),
        )}`,
      );
    roots = loc.layer.children ?? [];
  }
  const lines: string[] = [];
  const visit = (layers: readonly LayerNode[], level: number) => {
    for (const layer of layers) {
      const indent = "  ".repeat(level);
      const kids = layer.children?.length ?? 0;
      if (detail === "ids")
        lines.push(
          `${indent}${layer.id} (${layer.type})${kids && level + 1 >= depth ? ` +${kids} children` : ""}`,
        );
      else {
        const tokens = layerSummaryTokens(
          doc,
          c,
          layer,
          registry,
          detail === "full" ? "full" : "summary",
        );
        lines.push(
          `${indent}${layer.id} ${layer.type} ${JSON.stringify(layer.name)}${tokens.length ? ` ${tokens.join(" ")}` : ""}${kids && level + 1 >= depth ? ` · ${kids} children (pass parent: "${layer.id}")` : ""}`,
        );
      }
      if (kids && level + 1 < depth) visit(layer.children!, level + 1);
    }
  };
  visit(roots, 0);
  return lines;
}

export interface PatchListOptions {
  type?: string;
  category?: string;
  detail?: "ids" | "summary" | "full";
}

/** Patches that match a filter, sorted by editor position. */
export function listPatches(
  c: Component,
  registry: Registry,
  options: PatchListOptions = {},
): [Id, PatchNode][] {
  return Object.entries(c.patches)
    .filter(
      ([, node]) =>
        (!options.type || node.type === options.type) &&
        (!options.category || getPatchSpec(registry, node.type)?.category === options.category),
    )
    .sort(([a, na], [b, nb]) => na.ui.x - nb.ui.x || na.ui.y - nb.ui.y || a.localeCompare(b));
}

function patchHead(id: Id, node: PatchNode): string {
  let head = `${id} ${node.type}`;
  if (node.component) head += `:${node.component}`;
  if (node.typeParam) head += `<${node.typeParam}>`;
  if (node.inputCount !== undefined) head += `×${node.inputCount}`;
  if (node.name) head += ` ${JSON.stringify(node.name)}`;
  if (node.muted) head += " muted";
  return head;
}

/** One patch as a line (summary) or a block with every port (full). */
export function patchText(
  doc: SonobeDocument,
  c: Component,
  registry: Registry,
  id: Id,
  node: PatchNode,
  detail: "ids" | "summary" | "full",
  consumers: Map<string, string[]>,
): string {
  if (detail === "ids") return `${id} (${node.type})`;
  const ports = resolveNodePorts(doc, node, registry);
  if (detail === "summary") {
    const tokens = Object.entries(node.inputs).map(([key, value]) =>
      isLinkInput(value)
        ? `${key}←${value.link}`
        : `${key}=${formatOutlineValue(value, ports?.inputs.find((p) => p.key === key)?.type)}`,
    );
    const outs = (ports?.outputs ?? []).flatMap((p) =>
      (consumers.get(`${id}.${p.key}`) ?? []).map((t) => `${p.key}→${t}`),
    );
    return `${patchHead(id, node)}${tokens.length ? ` ${tokens.join(" ")}` : ""}${outs.length ? ` · ${outs.join(" ")}` : ""}`;
  }
  const lines = [`patch ${patchHead(id, node)} · ui ${node.ui.x},${node.ui.y}`];
  if (!ports) {
    lines.push(`  (unknown patch type "${node.type}")`);
    return lines.join("\n");
  }
  lines.push(`  ${ports.spec.summary}`);
  lines.push("  inputs:");
  for (const p of ports.inputs) {
    const stored = node.inputs[p.key];
    const value =
      stored === undefined
        ? `${formatOutlineValue(defaultOrNull(p), p.type)} (default)`
        : isLinkInput(stored)
          ? `←${stored.link}`
          : formatOutlineValue(stored, p.type);
    lines.push(`    ${p.key}: ${p.type} = ${value}`);
  }
  for (const key of Object.keys(node.inputs).filter((k) => !ports.inputs.some((p) => p.key === k)))
    lines.push(
      `    ${key}: (not a port of ${node.type}) = ${formatOutlineValue(node.inputs[key]!)}`,
    );
  lines.push("  outputs:");
  for (const p of ports.outputs) {
    const to = consumers.get(`${id}.${p.key}`) ?? [];
    lines.push(`    ${p.key}: ${p.type}${to.length ? ` → ${to.join(", ")}` : " (unused)"}`);
  }
  if (node.settings && Object.keys(node.settings).length)
    lines.push(`  settings: ${JSON.stringify(node.settings)}`);
  return lines.join("\n");
}

function defaultOrNull(p: Parameters<typeof defaultForPort>[0]): InputValue {
  const d = defaultForPort(p);
  if (d === null || typeof d === "number" || typeof d === "boolean" || typeof d === "string")
    return d;
  if (Array.isArray(d) && d.every((n) => typeof n === "number")) return d as number[];
  if (d && typeof d === "object" && "r" in (d as object)) {
    const c = d as { r: number; g: number; b: number; a: number };
    const hex = (n: number) =>
      Math.round(Math.max(0, Math.min(1, n)) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase();
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}${hex(c.a)}`;
  }
  return { json: d };
}

/** A detailed block for one item, as get_items shows it. */
export function itemDetails(
  doc: SonobeDocument,
  registry: Registry,
  located: LocatedItem,
  consumers: Map<string, string[]>,
): { text: string; data: Record<string, unknown> } {
  const c = located.component;
  if (located.kind === "patch") {
    const id = Object.entries(c.patches).find(([, n]) => n === located.patch)![0];
    return {
      text: patchText(doc, c, registry, id, located.patch!, "full", consumers),
      data: { id, kind: "patch", component: c.id, node: located.patch },
    };
  }
  if (located.kind === "comment") {
    const cm = located.comment!;
    return {
      text: `comment ${cm.id} ${JSON.stringify(cm.text)} rect=${cm.rect.join(",")}${cm.color ? ` color=${cm.color}` : ""}`,
      data: { id: cm.id, kind: "comment", component: c.id, comment: cm },
    };
  }
  const layer = located.layer!;
  const loc = findLayer(c.layers, layer.id)!;
  const lines = [
    `layer ${layer.id} ${layer.type}${layer.component ? `:${layer.component}` : ""} ${JSON.stringify(layer.name)} in ${c.id} · parent ${loc.parent?.id ?? "(root)"} · index ${loc.index}${layer.children?.length ? ` · children: ${layer.children.map((k) => k.id).join(", ")}` : ""}`,
  ];
  const props = resolveLayerProps(doc, c.id, layer, registry) ?? [];
  const set = Object.entries(layer.props);
  lines.push(
    `  props set: ${set.length ? set.map(([k, v]) => (isLinkInput(v) ? `${k}←${v.link}` : `${k}=${formatOutlineValue(v, props.find((p) => p.key === k)?.type)}`)).join(" ") : "(none; all defaults)"}`,
  );
  const outputs = resolveLayerOutputs(doc, c.id, layer, registry);
  if (outputs.length)
    lines.push(`  outputs: ${outputs.map((p) => `${p.key}:${p.type}`).join(", ")}`);
  const readers = [...props, ...outputs].flatMap((p) =>
    (consumers.get(`@${layer.id}.${p.key}`) ?? []).map((t) => `${p.key}→${t}`),
  );
  if (readers.length) lines.push(`  read by: ${readers.join(" ")}`);
  const listeners = Object.entries(c.patches)
    .filter(([, n]) => Object.values(n.inputs).some((v) => isLayerInput(v) && v.layer === layer.id))
    .map(([pid, n]) => `${pid} (${n.type})`);
  if (listeners.length) lines.push(`  referenced by: ${listeners.join(", ")}`);
  // Layers a cable drives or reads have a node in the patch graph: saved where someone put it, or placed automatically.
  let graphNode: { position: [number, number] | null } | undefined;
  if (layersWithGraphNodes(c).has(layer.id)) {
    const saved = readNodePositions(c)[layerNodeId(layer.id)];
    graphNode = { position: saved ? [saved.x, saved.y] : null };
    lines.push(
      saved
        ? `  graph node: ${saved.x},${saved.y} (saved; move it with setNodePositions)`
        : "  graph node: placed automatically next to its drivers (not saved)",
    );
  }
  return {
    text: lines.join("\n"),
    data: {
      id: layer.id,
      kind: "layer",
      component: c.id,
      layer: { ...layer, children: layer.children?.map((k) => k.id) },
      ...(graphNode ? { graphNode } : {}),
    },
  };
}

export interface FindQuery {
  text?: string;
  patchType?: string;
  layerType?: string;
  prop?: string;
  connectedTo?: string;
  unconnected?: boolean;
  component?: Id;
}

export interface FindMatch {
  id: Id;
  kind: ItemKind;
  component: Id;
  type?: string;
  name?: string;
  matched: string[];
}

/** Items matching every given criterion. */
export function findItems(doc: SonobeDocument, registry: Registry, query: FindQuery): FindMatch[] {
  const out: FindMatch[] = [];
  const text = query.text?.toLowerCase();
  const componentIds =
    query.component !== undefined
      ? [requireComponent(doc, query.component).id]
      : listComponentIds(doc);
  for (const cid of componentIds) {
    const c = doc.components[cid]!;
    const consumers = consumersOf(c);
    const connected = new Map<Id, Set<Id>>();
    for (const entry of listInputs(c)) {
      if (!isLinkInput(entry.value) || entry.target.kind === "componentOutput") continue;
      const source = entry.value.link.replace(/^@/, "").split(".")[0]!;
      const target = entry.target.id;
      for (const [a, b] of [
        [source, target],
        [target, source],
      ] as const) {
        if (!connected.has(a)) connected.set(a, new Set());
        connected.get(a)!.add(b);
      }
    }
    const connectedTo = query.connectedTo?.replace(/^@/, "").split(".")[0];
    const check = (
      id: Id,
      kind: ItemKind,
      type: string | undefined,
      name: string | undefined,
      haystack: string[],
      extra: { props?: Record<string, InputValue>; node?: PatchNode },
    ): void => {
      const matched: string[] = [];
      if (text !== undefined) {
        const hit = [id, name ?? "", ...haystack].find((h) => h.toLowerCase().includes(text));
        if (hit === undefined) return;
        matched.push(`text "${hit.length > 40 ? `${hit.slice(0, 39)}…` : hit}"`);
      }
      if (query.patchType !== undefined) {
        if (
          kind !== "patch" ||
          (type !== query.patchType &&
            getPatchSpec(registry, type ?? "")?.name.toLowerCase() !==
              query.patchType.toLowerCase())
        )
          return;
        matched.push(`type ${type}`);
      }
      if (query.layerType !== undefined) {
        if (kind !== "layer" || type !== query.layerType) return;
        matched.push(`type ${type}`);
      }
      if (query.prop !== undefined) {
        const v = extra.props?.[query.prop] ?? extra.node?.inputs[query.prop];
        if (v === undefined) return;
        matched.push(`${query.prop}${isLinkInput(v) ? `←${v.link}` : `=${formatOutlineValue(v)}`}`);
      }
      if (connectedTo !== undefined) {
        if (!connected.get(id)?.has(connectedTo)) return;
        matched.push(`connected to ${connectedTo}`);
      }
      if (query.unconnected) {
        if (kind !== "patch") return;
        const ports = resolveNodePorts(doc, extra.node!, registry);
        const used = (ports?.outputs ?? []).some((p) => consumers.has(`${id}.${p.key}`));
        if (used || !ports?.outputs.length) return;
        matched.push("outputs unused");
      }
      const match: FindMatch = { id, kind, component: c.id, matched };
      if (type !== undefined) match.type = type;
      if (name !== undefined) match.name = name;
      out.push(match);
    };
    walkLayers(c.layers, (layer) => {
      check(
        layer.id,
        "layer",
        layer.type,
        layer.name,
        typeof layer.props.text === "string" ? [layer.props.text] : [],
        { props: layer.props },
      );
    });
    for (const [id, node] of Object.entries(c.patches))
      check(id, "patch", node.type, node.name, [getPatchSpec(registry, node.type)?.name ?? ""], {
        node,
      });
    for (const comment of c.comments)
      check(comment.id, "comment", undefined, undefined, [comment.text], {});
  }
  return out;
}
