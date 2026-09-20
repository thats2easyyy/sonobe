/** Document tools: list_documents, open_document, create_document, get_document_info, save_document. */

import { deviceScreenSize, getDevicePreset, listComponentIds, type Id } from "@sonobe/core";
import { z } from "zod";
import { componentCounts } from "../graph.ts";
import { plural } from "../format.ts";
import type { SonobeHost } from "../host.ts";
import { success } from "../results.ts";
import { ADDITIVE, DESTRUCTIVE, READ_ONLY, UI_ONLY, type ToolContext } from "../server.ts";
import { DocIdSchema, DocumentInfoOutputSchema } from "../schemas.ts";
import { TEMPLATES } from "../templates.ts";
import { knobSetSummary } from "./knobs.ts";

/**
 * Opening and creating can wait on the person (the app asks about unsaved changes first). These
 * steps send a heartbeat meanwhile, and outlast the app's own 120 s limit so its error comes first.
 * They finish even when cancelled: an open or a save can't be taken back.
 */
const DOCUMENT_STEP = { deadlineMs: 130_000, finishOnCancel: true };
/** Saving never asks the person anything, so it gets the app's 60 s limit plus a margin. */
const SAVE_STEP = { deadlineMs: 70_000, finishOnCancel: true };

/** "5 min ago", "3 h ago", "2 days ago". */
function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

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
    ...(!snap.path && host.kind === "app"
      ? [
          `Not saved to a project yet${snap.draft ? " · kept as a draft, so it survives a crash or quit" : ""} · save_document({ path: "~/Documents/<Name>.sonobe" }) saves it as a project`,
        ]
      : []),
    `Device: ${preset.name} ${w}×${h}${doc.project.device.orientation === "landscape" ? " landscape" : ""} · ${doc.project.fps ?? 60} fps`,
    `Components: ${components.map((c) => `${c.id} "${c.name}" (${c.kind}; ${plural(c.layers, "layer")}, ${plural(c.patches, "patch", "patches")}, ${plural(c.connections, "connection")})`).join("; ")}`,
    ...(doc.knobs ? [`Knobs: ${knobSetSummary(doc.knobs)} (get_knobs for values)`] : []),
    `Diagnostics: ${plural(totals.errors, "error")}, ${plural(totals.warnings, "warning")}, ${totals.info} info${totals.errors + totals.warnings ? " (get_diagnostics for details)" : ""}`,
    `Host: ${host.kind === "app" ? "Sonobe app" : "headless"}${host.capabilities.screenshots ? "" : " · no screenshots"}${host.capabilities.selection ? "" : " · no selection"}${host.kind === "headless" ? (host.capabilities.autosave ? " · changes save automatically" : " · call save_document to write to disk") : ""}${host.capabilities.sfSymbols ? " · imports draw SF Symbols" : " · imports show SF Symbols as placeholders"}`,
  ];
  if (presence.length)
    // Name each session, so an agent can tell another session's badge from its own.
    lines.push(`Working: ${presence.map((p) => `${p.author.name}${p.client?.folder ? ` (${p.client.label} in ${p.client.folder})` : ""} — ${p.intent}`).join("; ")}`);
  if (sims.length)
    lines.push(
      `Simulations: ${sims.map((s) => `${s.simId} (frame ${s.frame}${s.overrides?.length ? `, ${plural(s.overrides.length, "sim_override")}` : ""})`).join(", ")}`,
    );
  return {
    text: lines.join("\n"),
    data: {
      docId: snap.docId,
      name: doc.project.name,
      ...(snap.path ? { path: snap.path } : {}),
      revision: snap.revision,
      dirty: snap.dirty,
      ...(snap.draft ? { draft: snap.draft } : {}),
      device: {
        preset: preset.id,
        size: [w, h],
        orientation: doc.project.device.orientation ?? "portrait",
      },
      fps: doc.project.fps ?? 60,
      root: doc.project.root,
      components,
      ...(doc.knobs
        ? {
            knobs: {
              count: doc.knobs.knobs.length,
              active: doc.knobs.active,
              presets: doc.knobs.presets.map((p) => ({ id: p.id, name: p.name, locked: !!p.locked })),
            },
          }
        : {}),
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
        'Documents open in this Sonobe host, with docId, name, path, revision and whether they have unsaved changes. The active one (*) is used when a tool omits docId. The app also lists recovered drafts: unsaved work from an earlier session (a crash, a quit, a killed process) that open_document({ ref: "draft:<id>" }) brings back.',
      input: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const docs = await host.listDocuments();
      const drafts = host.listDrafts ? await host.listDrafts() : [];
      const draftLines = drafts.length
        ? [
            'Recovered drafts (not open; bring one back with open_document({ ref: "draft:<id>" })):',
            ...drafts.map(
              (d) =>
                `  draft:${d.id} "${d.name}" · ${d.path ? `unsaved changes to ${d.path}` : "never saved"} · ${ago(d.updatedAt)} · ${plural(d.counts.layers, "layer")}, ${plural(d.counts.patches, "patch", "patches")}${d.torn ? " · its last changes may be missing" : ""}`,
            ),
          ]
        : [];
      if (!docs.length)
        return success(
          [
            "No documents are open. Open a project folder with open_document, or make one with create_document.",
            ...draftLines,
          ].join("\n"),
          { documents: [], ...(drafts.length ? { drafts } : {}) },
        );
      const lines = docs.map(
        (d) =>
          `${d.active ? "*" : " "} ${d.docId} "${d.name}" · revision ${d.revision}${d.dirty ? " · unsaved" : ""}${d.path ? ` · ${d.path}` : ""}`,
      );
      return success([...lines, ...draftLines].join("\n"), {
        documents: docs,
        ...(drafts.length ? { drafts } : {}),
      });
    },
  );

  tc.tool(
    "open_document",
    {
      title: "Open document",
      description:
        "Open a document by docId or project folder path and make it the active document, or bring back a recovered draft (draft:<id> from list_documents). Returns the same summary as get_document_info.",
      input: z.object({
        ref: z
          .string()
          .describe(
            'docId of an open document, a path to a .sonobe project folder, or "draft:<id>" for a recovered draft (the app).',
          ),
        reload: z
          .boolean()
          .optional()
          .describe(
            "Headless: read the project folder again even though it's already open, dropping this session's unsaved changes and undo history (after save_document reports disk_changed and the person wants the version on disk). The Sonobe app reloads outside changes on its own.",
          ),
      }),
      output: DocumentInfoOutputSchema,
      annotations: UI_ONLY,
    },
    async ({ ref, reload }, _ctx, work) => {
      const draft = ref.startsWith("draft:");
      const opened = await work.step(draft ? "Recovering the draft" : "Opening the project", (control) => host.openDocument(ref, { ...(reload ? { reload: true } : {}), ...control }), DOCUMENT_STEP);
      const info = await documentInfo(host, opened.docId);
      const done = reload
        ? "Reloaded from disk."
        : draft
          ? "Recovered the draft. Its undo history starts fresh, and it stays unsaved until save_document."
          : "Opened.";
      return success(`${done}\n${info.text}`, info.data);
    },
  );

  tc.tool(
    "create_document",
    {
      title: "Create document",
      description: `Create a new project folder from a template and open it. The folder must be new or empty and not inside another project; ".sonobe" is added when the name has none. Templates: ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}.`,
      input: z.object({
        path: z
          .string()
          .optional()
          .describe(
            'Folder for the new project, e.g. "~/Documents/Photo Zoom.sonobe". The app needs an absolute or ~ path and defaults to ~/Documents/<name>.sonobe; headless mode requires it and starts relative paths at its working folder.',
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
    async (args, _ctx, work) => {
      const created = await work.step("Creating the project", (control) => host.createDocument({ ...args }, control), DOCUMENT_STEP);
      if (args.open === false && host.kind === "app") {
        // The app opens documents in windows, so one that isn't open has nothing to describe yet.
        const ref = created.path ?? created.docId;
        return success(
          `Created ${created.path ?? `"${created.name}"`}. It isn't open; call open_document({ ref: ${JSON.stringify(ref)} }) to work on it.`,
          {
            docId: created.docId,
            name: created.name,
            ...(created.path ? { path: created.path } : {}),
            revision: created.revision,
            dirty: false,
            open: false,
            components: [],
            diagnostics: { errors: 0, warnings: 0, info: 0 },
          },
        );
      }
      const info = await documentInfo(host, created.docId);
      return success(`Created.\n${info.text}`, info.data);
    },
  );

  tc.tool(
    "get_document_info",
    {
      title: "Get document info",
      description:
        "Name, revision, device size, components with counts, diagnostics totals, what this host can do (screenshots, autosave, SF Symbols in imports), who's working and open simulations. Call first.",
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
        'Write the document to its project folder in canonical form (only changed files are written; component and script files the document no longer has are removed). It never asks the person anything. With path, it saves into that new or empty folder instead (Save As) and keeps working there. A document that was never saved goes to ~/Documents/<Name>.sonobe when no path is given, and fails with path_needed while it\'s still "Untitled". Tell the person where it went. Fails with disk_changed when the project changed outside this session since it was opened or last saved: ask the person, then reload (open_document with reload: true) or save again with force: true.',
      input: z.object({
        docId: DocIdSchema.optional(),
        path: z
          .string()
          .optional()
          .describe(
            'New project folder, e.g. "~/Documents/Checkout Flow.sonobe". It must not exist yet (or be empty) and can\'t be inside another project. The app needs an absolute or ~ path.',
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "Write over changes made outside this session (on disk, or not yet reviewed in the app). Those changes are lost, so only pass it after the person agrees.",
          ),
      }),
      annotations: DESTRUCTIVE,
    },
    async ({ docId, force, path }, _ctx, work) => {
      const r = await work.step("Saving", (control) => host.saveDocument(docId, { ...(force ? { force: true } : {}), ...(path !== undefined ? { path } : {}), ...control }), SAVE_STEP);
      const written = r.written.length
        ? `wrote ${r.written.join(", ")}`
        : "nothing changed on disk";
      return success(
        `Saved ${r.docId} at revision ${r.revision}${r.path ? ` to ${r.path}` : ""}: ${written}${r.removed.length ? `; removed ${r.removed.join(", ")}` : ""}${r.overwritten?.length ? `; replaced outside changes to ${r.overwritten.join(", ")}` : ""}.`,
        { ...r },
      );
    },
  );
}
