/** Read tools: get_outline, get_layers, get_patches, get_items, find, get_selection, get_diagnostics, explain. */

import {
  didYouMean,
  didYouMeanText,
  getOutline,
  layersWithGraphNodes,
  listComponentIds,
  type Diagnostic,
  type PatchCategory,
} from "@sonobe/core";
import { CATEGORY_ORDER } from "@sonobe/patches";
import { z } from "zod";
import { explain } from "../explain.ts";
import { resolveGraphGeometry, sizesNote, type GraphGeometry } from "../geometry.ts";
import { pageNote, paginate, plural, truncateLines } from "../format.ts";
import {
  consumersOf,
  findItems,
  itemDetails,
  layerTreeLines,
  listPatches,
  locateItem,
  patchText,
  requireComponent,
} from "../graph.ts";
import { resolveInstancePath, splitInstanceAddress } from "../instances.ts";
import type { LiveRuntimeDiagnostics } from "../host.ts";
import { failure, formatSuggestions, success } from "../results.ts";
import { READ_ONLY, type ToolContext } from "../server.ts";
import { diagnosticTotals } from "../session.ts";
import { ComponentIdSchema, DocIdSchema } from "../schemas.ts";

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

/** Diagnostics as teaching text. */
export function formatDiagnostic(d: Diagnostic): string[] {
  const where = [
    d.component,
    d.itemIds.length ? d.itemIds.join(",") : "",
    d.port ? `port ${d.port}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    `${d.severity} ${d.code} [${where}]: ${d.message}${d.hint ? ` ${d.hint}` : ""}`,
    ...formatSuggestions(d.suggestions, "  "),
  ];
}

/** Most runtime problems the Live viewer section lists. */
const MAX_LIVE_DIAGNOSTICS = 10;

/** The "Live viewer" section of get_diagnostics. */
export function liveViewerLines(live: LiveRuntimeDiagnostics): string[] {
  const where = `Live viewer (frame ${Math.max(0, live.frame).toLocaleString("en-US")}, ${live.playing ? "playing" : "paused"})`;
  if (!live.diagnostics.length) return [`${where}: no runtime problems.`];
  const shown = live.diagnostics.slice(0, MAX_LIVE_DIAGNOSTICS);
  return [
    `${where}: ${plural(live.diagnostics.length, "runtime problem")}:`,
    ...shown.flatMap(formatDiagnostic),
    ...(live.diagnostics.length > shown.length
      ? [`… ${live.diagnostics.length - shown.length} more.`]
      : []),
  ];
}

export function registerReadTools(tc: ToolContext): void {
  const { host } = tc;

  tc.tool(
    "get_outline",
    {
      title: "Get outline",
      description:
        'Compact text projection of a component: layers (indented by nesting, non-default props, "key←source" links) then patches in dataflow order ("patch id type<variant> input=value input←patch.port"). The cheapest way to see a whole prototype. Omit component for every component.',
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional().describe(
          "Component id (default: all components, root first).",
        ),
        detail: z
          .enum(["compact", "normal", "full"])
          .optional()
          .describe(
            "compact: structure and links; normal (default): plus values and notes; full: plus editor positions (patch ui, and node=x,y or node=auto for layer and interface nodes) and settings.",
          ),
        maxLines: z.number().int().min(10).max(2000).optional().describe("Default 300."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("First line to show (for continuing a truncated outline)."),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, component, detail, maxLines, offset }) => {
      const snap = await host.getDocument(docId);
      if (component !== undefined) requireComponent(snap.doc, component);
      const text = getOutline(snap.doc, component, {
        detail: detail ?? "normal",
        registry: host.registry,
      });
      const t = truncateLines(text, maxLines ?? 300, offset ?? 0);
      return success(`revision ${snap.revision}\n${t.text}`, {
        docId: snap.docId,
        revision: snap.revision,
        totalLines: t.totalLines,
        ...(t.nextOffset !== undefined ? { nextOffset: t.nextOffset } : {}),
      });
    },
  );

  tc.tool(
    "get_layers",
    {
      title: "Get layers",
      description:
        "The layer tree of a component (back to front, children indented) with position, size, text and linked properties. Deeper levels collapse into child counts; pass parent to expand one.",
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        parent: z.string().optional().describe("Show only this layer's children."),
        depth: z.number().int().min(1).max(10).optional().describe("Default 3."),
        detail: z
          .enum(["ids", "summary", "full"])
          .optional()
          .describe("ids; summary (default); full adds every set property."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Lines per page (default 200)."),
        cursor: z.string().optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, component, parent, depth, detail, limit, cursor }) => {
      const snap = await host.getDocument(docId);
      const c = requireComponent(snap.doc, component);
      const lines = layerTreeLines(snap.doc, c, host.registry, {
        ...(parent !== undefined ? { parent } : {}),
        depth: depth ?? 3,
        detail: detail ?? "summary",
      });
      if (!lines.length)
        return success(
          parent
            ? `"${parent}" has no children.`
            : `${c.id} has no layers yet. Add some with add_layers.`,
          { docId: snap.docId, revision: snap.revision, lines: [] },
        );
      const page = paginate(lines, cursor, limit ?? 200);
      return success(
        [`${c.id} layers · revision ${snap.revision}`, ...page.items, pageNote(page, "lines")]
          .filter(Boolean)
          .join("\n"),
        {
          docId: snap.docId,
          revision: snap.revision,
          total: page.total,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
      );
    },
  );

  tc.tool(
    "get_patches",
    {
      title: "Get patches",
      description:
        "Patches in a component with their set inputs, links in (key←source) and where outputs go (port→target). detail full lists every port with defaults. Filter by type or category.",
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        type: z.string().optional().describe("Only this patch type."),
        category: z.enum(CATEGORY_ORDER as [PatchCategory, ...PatchCategory[]]).optional(),
        detail: z.enum(["ids", "summary", "full"]).optional().describe("Default summary."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 60 (full: 15)."),
        cursor: z.string().optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, component, type, category, detail, limit, cursor }) => {
      const snap = await host.getDocument(docId);
      const c = requireComponent(snap.doc, component);
      const d = detail ?? "summary";
      const patches = listPatches(c, host.registry, {
        ...(type ? { type } : {}),
        ...(category ? { category } : {}),
      });
      if (!patches.length)
        return success(
          type || category
            ? `No ${type ?? category} patches in ${c.id}.`
            : `${c.id} has no patches yet. Add some with add_patches.`,
          { docId: snap.docId, revision: snap.revision, total: 0 },
        );
      const consumers = consumersOf(c);
      const page = paginate(patches, cursor, limit ?? (d === "full" ? 15 : 60));
      const body = page.items.map(([id, node]) =>
        patchText(snap.doc, c, host.registry, id, node, d, consumers),
      );
      return success(
        [
          `${c.id} patches · revision ${snap.revision}`,
          body.join(d === "full" ? "\n\n" : "\n"),
          pageNote(page, "patches"),
        ]
          .filter(Boolean)
          .join("\n"),
        {
          docId: snap.docId,
          revision: snap.revision,
          total: page.total,
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        },
      );
    },
  );

  tc.tool(
    "get_items",
    {
      title: "Get items",
      description:
        'Details for specific layers, patches or comments by id: every port with its current value, default or link; where outputs go; parents and children; which patches reference a layer. Patches and layer nodes show their box in the patch graph (position and width×height as the editor draws them) and the nodes whose boxes overlap it, and comments list the nodes they frame and which of them overlap: check your own placement here. Reach inside component instances with an instance path: "like_button_2/liked" or "@card#2/badge".',
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional().describe(
          "Where to look (default: every component, root first). Instance paths start here.",
        ),
        ids: z.array(z.string()).min(1).max(25),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, component, ids }) => {
      const snap = await host.getDocument(docId);
      if (component !== undefined) requireComponent(snap.doc, component);
      const blocks: string[] = [];
      const items: Record<string, unknown>[] = [];
      const missing: string[] = [];
      const consumerCache = new Map<string, Map<string, string[]>>();
      const geometries = new Map<string, Promise<GraphGeometry>>();
      const geometryOf = (componentId: string) => {
        let geometry = geometries.get(componentId);
        if (!geometry)
          geometries.set(componentId, (geometry = resolveGraphGeometry(host, snap, componentId)));
        return geometry;
      };
      const sizeNotes = new Set<string>();
      for (const id of ids) {
        const split = splitInstanceAddress(id);
        // "tap_card.tap" names a port; details cover the whole item.
        const itemId = split.tail.split(".")[0]!;
        let scopeId = component;
        if (split.path !== undefined) {
          const scope = resolveInstancePath(snap.doc, split.path, component);
          if (!scope.ok) {
            missing.push(id);
            blocks.push(`${id}: ${scope.message}${scope.hint ? ` ${scope.hint}` : ""}`);
            continue;
          }
          scopeId = scope.component.id;
        }
        const located = locateItem(snap.doc, itemId, scopeId);
        if (!located) {
          missing.push(id);
          const searched = scopeId !== undefined ? [scopeId] : listComponentIds(snap.doc);
          const all = searched.flatMap((cid) => {
            const c = snap.doc.components[cid]!;
            return [
              ...Object.keys(c.patches),
              ...c.comments.map((x) => x.id),
              ...layerTreeLines(snap.doc, c, host.registry, { depth: 10, detail: "ids" }).map(
                (l) => l.trim().split(" ")[0]!,
              ),
            ];
          });
          blocks.push(
            `${id}: not found${split.path !== undefined ? ` inside ${split.path} (component ${scopeId})` : ""}.${didYouMeanText(didYouMean(itemId, all))}`,
          );
          continue;
        }
        if (!consumerCache.has(located.component.id))
          consumerCache.set(located.component.id, consumersOf(located.component));
        // Patches, layer nodes and comments get their box and members from the graph as drawn.
        const inGraph =
          located.kind !== "layer" || layersWithGraphNodes(located.component).has(located.layer!.id);
        const geometry = inGraph ? await geometryOf(located.component.id) : undefined;
        if (geometry) sizeNotes.add(sizesNote(geometry));
        const details = itemDetails(
          snap.doc,
          host.registry,
          located,
          consumerCache.get(located.component.id)!,
          geometry,
        );
        if (split.path !== undefined) {
          blocks.push(
            `inside instance ${split.path} (component ${located.component.id}):\n${details.text}`,
          );
          items.push({ ...details.data, instancePath: split.path });
        } else {
          blocks.push(details.text);
          items.push(details.data);
        }
      }
      if (missing.length === ids.length)
        return failure({
          code: "not_found",
          message: blocks.join(" "),
          hint: "get_outline shows every id.",
        });
      return success(
        [`revision ${snap.revision}`, blocks.join("\n\n"), ...sizeNotes].join("\n"),
        { docId: snap.docId, revision: snap.revision, items, missing },
      );
    },
  );

  tc.tool(
    "find",
    {
      title: "Find items",
      description:
        "Find layers, patches and comments by text (ids, names, text content), patch type, layer type, a set property or input key, what they connect to, or unused patch outputs. Criteria combine with AND.",
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional().describe("Default: every component."),
        text: z.string().optional(),
        patchType: z.string().optional(),
        layerType: z.string().optional(),
        prop: z.string().optional().describe("Items that set this property or input key."),
        connectedTo: z
          .string()
          .optional()
          .describe("Items linked to or from this id (or address)."),
        unconnected: z.boolean().optional().describe("Patches whose outputs nothing uses."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, limit, ...query }) => {
      if (Object.values(query).every((v) => v === undefined))
        return failure({
          code: "no_criteria",
          message: "find needs at least one criterion.",
          hint: 'For example { "patchType": "interaction" } or { "text": "card" }.',
        });
      const snap = await host.getDocument(docId);
      const matches = findItems(snap.doc, host.registry, query);
      const page = paginate(matches, undefined, limit ?? 50);
      if (!matches.length)
        return success("No matches.", { docId: snap.docId, revision: snap.revision, matches: [] });
      const lines = page.items.map(
        (m) =>
          `${m.kind} ${m.id}${m.type ? ` ${m.type}` : ""}${m.name ? ` "${m.name}"` : ""} (${m.component})${m.matched.length ? ` · ${m.matched.join(", ")}` : ""}`,
      );
      return success(
        [
          `${plural(matches.length, "match", "matches")}:`,
          ...lines,
          page.nextCursor
            ? `… ${matches.length - page.items.length} more; narrow the query or raise limit.`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        { docId: snap.docId, revision: snap.revision, total: matches.length, matches: page.items },
      );
    },
  );

  tc.tool(
    "get_selection",
    {
      title: "Get selection",
      description:
        'What the person has selected in the editor (layers, patches, comments), with a one-line summary of each. Use it when they say "this" or "these".',
      input: z.object({ docId: DocIdSchema.optional() }),
      annotations: READ_ONLY,
    },
    async ({ docId }) => {
      const selection = await host.getSelection(docId);
      const snap = await host.getDocument(selection.docId);
      const c = snap.doc.components[selection.component];
      const ids = [...selection.layers, ...selection.patches, ...selection.comments];
      if (!ids.length || !c)
        return success(selection.note ?? "Nothing is selected.", { ...selection });
      const consumers = consumersOf(c);
      const lines = [`Selected in ${c.id}:`];
      for (const id of selection.patches)
        if (c.patches[id])
          lines.push(
            `patch ${patchText(snap.doc, c, host.registry, id, c.patches[id], "summary", consumers)}`,
          );
      for (const id of selection.layers) {
        const line = layerTreeLines(snap.doc, c, host.registry, {
          depth: 10,
          detail: "summary",
        }).find((l) => l.trim().startsWith(`${id} `));
        if (line) lines.push(`layer ${line.trim()}`);
      }
      for (const id of selection.comments) {
        const cm = c.comments.find((x) => x.id === id);
        if (cm) lines.push(`comment ${cm.id} ${JSON.stringify(cm.text)}`);
      }
      return success(lines.join("\n"), { ...selection });
    },
  );

  tc.tool(
    "get_diagnostics",
    {
      title: "Get diagnostics",
      description:
        "Problems and hints in the document: invalid links, type mismatches, pulses wired into states, feedback loops, loops of different lengths, layers whose copies go wrong (children repeating inside one card, a Repeat that can't work), untouchable layers, unused patches. Each comes with suggestions that include ready-to-apply ops for apply_ops. In the Sonobe app, a Live viewer section adds what the person's running prototype reports right now, such as empty_loop (a layer or component with 0 copies, and why).",
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        severity: z
          .enum(["error", "warning", "info"])
          .optional()
          .describe("Minimum severity (default info: everything)."),
        codes: z.array(z.string()).optional().describe("Only these diagnostic codes."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 30."),
        cursor: z.string().optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, component, severity, codes, limit, cursor }) => {
      const r = await host.diagnostics(docId);
      if (component !== undefined)
        requireComponent((await host.getDocument(r.docId)).doc, component);
      const min = SEVERITY_RANK[severity ?? "info"];
      const keep = (d: Diagnostic) =>
        SEVERITY_RANK[d.severity] <= min &&
        (!component || d.component === component) &&
        (!codes?.length || codes.includes(d.code));
      const bySeverity = (a: Diagnostic, b: Diagnostic) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      const list = r.diagnostics.filter(keep).sort(bySeverity);
      const totals = diagnosticTotals(list);
      // What the person's running prototype reports now (app host only); it changes without a new revision.
      const live = r.runtime
        ? { ...r.runtime, diagnostics: r.runtime.diagnostics.filter(keep).sort(bySeverity) }
        : undefined;
      const liveLines = live ? liveViewerLines(live) : [];
      const liveData = live ? { runtime: live } : {};
      if (!list.length)
        return success(
          [
            `No ${severity && severity !== "info" ? `${severity}-level ` : ""}diagnostics at revision ${r.revision}.`,
            ...liveLines,
          ].join("\n"),
          { docId: r.docId, revision: r.revision, totals, diagnostics: [], ...liveData },
        );
      const page = paginate(list, cursor, limit ?? 30);
      const lines = [
        `${plural(list.length, "diagnostic")} at revision ${r.revision} (${plural(totals.errors, "error")}, ${plural(totals.warnings, "warning")}, ${totals.info} info):`,
        ...page.items.flatMap(formatDiagnostic),
        pageNote(page, "diagnostics"),
        ...liveLines,
      ];
      return success(lines.filter(Boolean).join("\n"), {
        docId: r.docId,
        revision: r.revision,
        totals,
        total: page.total,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        diagnostics: page.items,
        ...liveData,
      });
    },
  );

  tc.tool(
    "explain",
    {
      title: "Explain",
      description:
        "A deterministic plain-language description of what a component (or the flows touching some ids) does: inputs, states, animations and the layer properties they drive, plus problems. audience beginner uses everyday words and layer names; designer uses patch names and key values; engineer uses ids, ports and evaluation notes.",
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        ids: z
          .array(z.string())
          .max(50)
          .optional()
          .describe("Only explain flows that touch these layers or patches."),
        audience: z
          .enum(["beginner", "designer", "engineer"])
          .optional()
          .describe("Default designer."),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, component, ids, audience }) => {
      const snap = await host.getDocument(docId);
      const text = explain(snap.doc, {
        registry: host.registry,
        ...(component !== undefined ? { component } : {}),
        ...(ids ? { ids } : {}),
        audience: audience ?? "designer",
      });
      return success(text, {
        docId: snap.docId,
        revision: snap.revision,
        audience: audience ?? "designer",
      });
    },
  );
}
