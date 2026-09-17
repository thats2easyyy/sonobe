/** Document tools: list_documents, open_document, create_document, get_document_info, save_document. */

import { deviceScreenSize, getDevicePreset, listComponentIds, type Id } from "@sonobe/core";
import { z } from "zod";
import { componentCounts } from "../graph.ts";
import { plural } from "../format.ts";
import type { SonobeHost } from "../host.ts";
import { success } from "../results.ts";
import { ADDITIVE, READ_ONLY, UI_ONLY, type ToolContext } from "../server.ts";
import { DocIdSchema, DocumentInfoOutputSchema } from "../schemas.ts";
import { TEMPLATES } from "../templates.ts";

/** get_document_info text and data (shared with open/create). */
export async function documentInfo(
  host: SonobeHost,
  docId: Id | undefined,
): Promise<{ text: string; data: Record<string, unknown> }> {
  const snap = await host.getDocument(docId);
  const { doc } = snap;
  const diagnostics = await host.diagnostics(snap.docId);
  const totals = { errors: 0, warnings: 0, info: 0 };
  for (const d of diagnostics.diagnostics) {
    if (d.severity === "error") totals.errors++;
    else if (d.severity === "warning") totals.warnings++;
    else totals.info++;
  }
  const preset = getDevicePreset(doc.project.device.preset);
  const [w, h] = deviceScreenSize(doc.project.device);
  const components = listComponentIds(doc).map((id) => {
    const c = doc.components[id]!;
    return {
      id,
      name: c.name,
      kind: c.kind,
      ...(c.size ? { size: c.size } : {}),
      ...componentCounts(c),
    };
  });
  const presence = await host.presence(snap.docId);
  const sims = host.sim.list(snap.docId);
  const lines = [
    `${doc.project.name} · docId ${snap.docId} · revision ${snap.revision}${snap.dirty ? " · unsaved changes" : ""}`,
    ...(snap.path ? [`Path: ${snap.path}`] : []),
    `Device: ${preset.name} ${w}×${h}${doc.project.device.orientation === "landscape" ? " landscape" : ""} · ${doc.project.fps ?? 60} fps`,
    `Components: ${components.map((c) => `${c.id} "${c.name}" (${c.kind}; ${plural(c.layers, "layer")}, ${plural(c.patches, "patch", "patches")}, ${plural(c.connections, "connection")})`).join("; ")}`,
    `Diagnostics: ${plural(totals.errors, "error")}, ${plural(totals.warnings, "warning")}, ${totals.info} info${totals.errors + totals.warnings ? " (get_diagnostics for details)" : ""}`,
    `Host: ${host.kind === "app" ? "Sonobe app" : "headless"}${host.capabilities.screenshots ? "" : " · no screenshots"}${host.capabilities.selection ? "" : " · no selection"}${host.kind === "headless" ? (host.capabilities.autosave ? " · changes save automatically" : " · call save_document to write to disk") : ""}`,
  ];
  if (presence.length)
    lines.push(`Working: ${presence.map((p) => `${p.author.name} — ${p.intent}`).join("; ")}`);
  if (sims.length)
    lines.push(`Simulations: ${sims.map((s) => `${s.simId} (frame ${s.frame})`).join(", ")}`);
  return {
    text: lines.join("\n"),
    data: {
      docId: snap.docId,
      name: doc.project.name,
      ...(snap.path ? { path: snap.path } : {}),
      revision: snap.revision,
      dirty: snap.dirty,
      device: {
        preset: preset.id,
        size: [w, h],
        orientation: doc.project.device.orientation ?? "portrait",
      },
      fps: doc.project.fps ?? 60,
      root: doc.project.root,
      components,
      diagnostics: totals,
      host: { kind: host.kind, ...host.capabilities },
      working: presence.map((p) => ({ author: p.author.name, intent: p.intent, ids: p.ids })),
      simulations: sims.map((s) => s.simId),
    },
  };
}

export function registerDocumentTools(tc: ToolContext): void {
  const { host } = tc;

  tc.tool(
    "list_documents",
    {
      title: "List documents",
      description:
        "Documents open in this Sonobe host, with docId, name, path, revision and whether they have unsaved changes. The active one (*) is used when a tool omits docId.",
      input: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const docs = await host.listDocuments();
      if (!docs.length)
        return success(
          "No documents are open. Open a project folder with open_document, or make one with create_document.",
          { documents: [] },
        );
      const lines = docs.map(
        (d) =>
          `${d.active ? "*" : " "} ${d.docId} "${d.name}" · revision ${d.revision}${d.dirty ? " · unsaved" : ""}${d.path ? ` · ${d.path}` : ""}`,
      );
      return success(lines.join("\n"), { documents: docs });
    },
  );

  tc.tool(
    "open_document",
    {
      title: "Open document",
      description:
        "Open a document by docId or project folder path and make it the active document. Returns the same summary as get_document_info.",
      input: z.object({
        ref: z
          .string()
          .describe("docId of an open document, or a path to a .sonobe project folder."),
      }),
      output: DocumentInfoOutputSchema,
      annotations: UI_ONLY,
    },
    async ({ ref }) => {
      const opened = await host.openDocument(ref);
      const info = await documentInfo(host, opened.docId);
      return success(`Opened.\n${info.text}`, info.data);
    },
  );

  tc.tool(
    "create_document",
    {
      title: "Create document",
      description: `Create a new project folder from a template and open it. Templates: ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}.`,
      input: z.object({
        path: z
          .string()
          .optional()
          .describe(
            'Folder for the new project, e.g. "./Photo Zoom.sonobe" (required in headless mode).',
          ),
        name: z.string().optional().describe("Project name (default: the folder name)."),
        template: z
          .enum(TEMPLATES.map((t) => t.id) as [string, ...string[]])
          .optional()
          .describe("Default blank."),
        device: z
          .string()
          .optional()
          .describe(
            "Device preset id, e.g. iphone-17-pro (default), iphone-se, android-large, ipad-pro-11, desktop.",
          ),
        open: z.boolean().optional().describe("Make it the active document (default true)."),
      }),
      output: DocumentInfoOutputSchema,
      annotations: ADDITIVE,
    },
    async (args) => {
      const created = await host.createDocument({ ...args });
      const info = await documentInfo(host, created.docId);
      return success(`Created.\n${info.text}`, info.data);
    },
  );

  tc.tool(
    "get_document_info",
    {
      title: "Get document info",
      description:
        "Name, revision, device size, components with counts, diagnostics totals, what this host can do (screenshots, autosave), who's working and open simulations. Call first.",
      input: z.object({ docId: DocIdSchema.optional() }),
      output: DocumentInfoOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ docId }) => {
      const info = await documentInfo(host, docId);
      return success(info.text, info.data);
    },
  );

  tc.tool(
    "save_document",
    {
      title: "Save document",
      description:
        "Write the document to its project folder in canonical form (only changed files are written).",
      input: z.object({ docId: DocIdSchema.optional() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ docId }) => {
      const r = await host.saveDocument(docId);
      const written = r.written.length
        ? `wrote ${r.written.join(", ")}`
        : "nothing changed on disk";
      return success(
        `Saved ${r.docId} at revision ${r.revision}${r.path ? ` to ${r.path}` : ""}: ${written}${r.removed.length ? `; removed ${r.removed.join(", ")}` : ""}.`,
        { ...r },
      );
    },
  );
}
