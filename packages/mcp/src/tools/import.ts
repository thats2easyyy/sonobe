/**
 * import_design: bring a real design onto the canvas. Renders the person's running app (a URL), HTML
 * Claude wrote from their code, or a ready-made capture (a browser extension, a Figma plugin), then
 * adds it as one screen of real layers in one undo step, with Scroll patches for content that scrolls.
 * A dry run plans it and changes nothing. Every successful result carries an ImportResultMeta in its
 * _meta, which a result with a screenshot keeps when it leaves out structuredContent.
 *
 * preview_design draws the page on the person's canvas while Claude writes it (a draft per session,
 * designPreviews.ts), and import_design's preview source imports that draft.
 */

import { artboardSize, deviceScreenSize, findLayer, getOutline, type Id } from "@sonobe/core";
import { CAPTURE_TIMEOUT_MS, CaptureFormatError, globalFetcher, ImportPlanError, parseCapture, planImport, resolveCaptureFiles, type ImportPlan, type ImportSummary } from "@sonobe/import";
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { draftBytes, draftKb, MAX_DRAFT_CHARS, NO_DRAFT_FIELDS, sessionKey, showsDesignPreviews, withDraft, type DesignDraft, type DesignDraftFields } from "../designPreviews.ts";
import { plural, roundForDisplay } from "../format.ts";
import { requireComponent } from "../graph.ts";
import { HostError, type CapturedDesign, type DocumentSnapshot } from "../host.ts";
import type { ToolWork } from "../progress.ts";
import { failure, success } from "../results.ts";
import { ADDITIVE, UI_ONLY, type ToolContext } from "../server.ts";
import { ComponentIdSchema, DocIdSchema, ExpectedRevisionSchema, LabelSchema } from "../schemas.ts";
import { writeResult } from "./write.ts";

/** The `_meta` key of import_design's result: an ImportResultMeta. */
export const IMPORT_META_KEY = "dev.sonobe/import";
/** On every successful import_design result (also when a screenshot drops structuredContent). */
export interface ImportResultMeta {
  docId: string;
  /** The component the screen goes into (a preview import's is the draft's unless the call names one). */
  component: string;
  dryRun: boolean;
  /** The new screen's layer id; null for a dry run. */
  screenId: string | null;
  screenName: string;
  txnId: string | null;
  /** The layer `replace` named, or null. */
  replaced: string | null;
  /** Top-most layers of the replaced one that weren't found again, at most 20. */
  dropped: { id: string; name: string }[];
  droppedCount: number;
  lostConnections: number;
  kept: number | null;
}

/** Most outline lines the result shows for the imported screen. */
const OUTLINE_LINES = 70;
/** Most dropped layers ImportResultMeta lists (droppedCount counts them all). */
const MAX_META_DROPPED = 20;

/**
 * The tool's own limit on a capture: a safety net and a heartbeat longer than the host's deadline
 * (CAPTURE_TIMEOUT_MS plus waitMs), so the host's error, which names the stage, comes first.
 */
const CAPTURE_STEP_MS = CAPTURE_TIMEOUT_MS + 60_000;
/** Downloading a capture's images (the capture source), and storing image files. */
const IMAGES_STEP_MS = 75_000;
const STORE_STEP_MS = 60_000;

// The sources come last: models write keys in schema order, so the small fields arrive before a
// long html, and a preview of the page as it streams knows its name and place.
const ImportDesignInput = z.object({
  docId: DocIdSchema.optional(),
  component: ComponentIdSchema.optional(),
  name: z.string().max(80).optional().describe('Screen layer name (default: the page title). "Home", "Checkout".'),
  replace: z.string().nullable().optional().describe("Id of an earlier imported screen to replace, keeping the ids and wiring of layers found again. null imports a new screen, also over a preview draft's replace."),
  parent: z.string().optional().describe("Container layer for the screen (default: the component root)."),
  position: z.tuple([z.number(), z.number()]).optional().describe("Screen position in its parent (default [0, 0]). Leave it out for a new screen."),
  index: z.number().int().optional().describe("Insert position among siblings (default: front)."),
  width: z.number().int().min(100).max(4000).optional().describe("Viewport width in points (default: the device width)."),
  height: z.number().int().min(100).max(8000).optional().describe("Viewport height in points (default: the device height)."),
  selector: z.string().max(500).optional().describe('Import only the first element matching this CSS selector ("#pricing-card").'),
  waitFor: z.string().max(500).optional().describe("Wait until an element matches this selector (data that loads late)."),
  waitMs: z.number().int().min(0).max(20_000).optional().describe("Extra milliseconds to wait after the page settles."),
  fullPage: z.boolean().optional().describe("Import the whole page height (default true); false imports only what fits the viewport."),
  colorScheme: z.enum(["light", "dark"]).optional().describe('The page\'s prefers-color-scheme: "dark" imports its dark mode, "light" its light mode.'),
  scrolling: z.boolean().optional().describe("Add Scroll patches so long pages and scroll containers scroll (default true)."),
  screenshot: z.boolean().optional().describe("Also return an image of the page as the browser drew it, to compare with get_screenshot."),
  dryRun: z.boolean().optional().describe("Plan the import and report what it would add, keep and remove (with replace) without changing anything."),
  label: LabelSchema.optional(),
  expectedRevision: ExpectedRevisionSchema.optional(),
  preview: z.boolean().optional().describe("Import the page you drew with preview_design (this session's draft), with its name, replace, width and height unless you pass others."),
  url: z.string().url().max(8000).optional().describe("An http(s) page to render."),
  capture: z.unknown().optional().describe('A design capture ({ "format": "sonobe.design-capture", ... }).'),
  html: z.string().max(MAX_DRAFT_CHARS).optional().describe("A complete HTML page to render."),
});
type ImportDesignArgs = z.infer<typeof ImportDesignInput>;

/**
 * The imported screen's lines from a component outline. When the screen has more layers than `max`,
 * the deepest levels go first, so the result still shows the screen's structure (sections, fixed bars).
 */
export function screenOutline(outline: string, screenId: Id, max = OUTLINE_LINES): string[] {
  const lines = outline.split("\n");
  const start = lines.findIndex((l) => l.trimStart().startsWith(`layer ${screenId} `));
  if (start < 0) return [];
  const depthOf = (line: string) => line.length - line.trimStart().length;
  const base = depthOf(lines[start]!);
  const subtree = [lines[start]!];
  for (let i = start + 1; i < lines.length && depthOf(lines[i]!) > base && lines[i]!.trimStart().startsWith("layer "); i++) subtree.push(lines[i]!);
  let limit = Math.max(...subtree.map(depthOf));
  while (limit > base && subtree.filter((l) => depthOf(l) <= limit).length > max) limit -= 2;
  const shown = subtree.filter((l) => depthOf(l) <= limit).slice(0, max);
  const out = shown.map((l) => l.slice(base));
  const hidden = subtree.length - shown.length;
  if (hidden > 0) out.push(`  … and ${plural(hidden, "deeper layer")} (get_outline shows everything)`);
  return out;
}

/** A screen's place in its component. */
type Frame = readonly [x: number, y: number, width: number, height: number];

/**
 * The note for a screen whose frame lies entirely outside the device screen: the canvas and viewer draw
 * only the screen, so nobody would see it. null when any part of it (its corner, when it has no size) is on
 * the screen. Only the prototype's own component clips so; a layer component's instances draw what's
 * outside its bounds, so callers pass no note there.
 */
export function offScreenNote(name: string | null, [x, y, width, height]: Frame, [screenWidth, screenHeight]: readonly [number, number]): string | null {
  if (x < screenWidth && y < screenHeight && x + Math.max(width, 1) > 0 && y + Math.max(height, 1) > 0) return null;
  return `${name ? `“${name}”` : "The draft"} is at ${roundForDisplay(x)}, ${roundForDisplay(y)}, outside the ${screenWidth} × ${screenHeight} screen, so the canvas and viewer won't show it. Put new screens at [0, 0].`;
}

/** Where a plan puts its screen: null unless it's at the component's top level with a literal position and size. */
function planFrame(plan: ImportPlan): Frame | null {
  const add = plan.ops.find((op) => op.op === "addLayer" && op.layer.ref === plan.screenRef);
  if (add?.op !== "addLayer" || add.parent) return null;
  const { position, size } = add.layer.props ?? {};
  const point = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number");
  return point(position) && point(size) ? [...position, ...size] : null;
}

export function registerImportTools(tc: ToolContext): void {
  const { host } = tc;
  const now = () => (tc.options.now ?? Date.now)();

  tc.tool(
    "preview_design",
    {
      title: "Preview design",
      description: [
        "Draw the screen you're designing on the person's canvas while you write it: they watch the page take shape over the artboard, in a live preview that changes nothing in the document.",
        'Start the preview within your first few steps instead of planning the whole page first: "html" with the page\'s <head> (its theme, fonts and <style>) and its first section. Then send the rest in page order with "append", section by section. Each call should add about one visual group, so the person sees it take shape every few seconds. "html" again starts the draft over, and "clear" removes it.',
        'Pass "name" and, for a redesign, "replace" (the layer the design replaces, which the preview draws over) with the first call; fields you leave out later keep their values, and "replace": null makes it a new screen again.',
        'Leave "position" out for a new screen, which goes at [0, 0]: the canvas and viewer draw only the device screen, so a screen placed beside it can\'t be seen. Until navigation is wired, the new screen covers the one behind it in the viewer, which is expected; offer to wire it (a tap that slides it in, say).',
        'When the page is complete, import it with import_design and "preview": true, which imports this draft with its fields without sending the html again. Write the page as for import_design\'s html (get_guide("importing")).',
        "Headless servers keep the draft without showing it. A draft left alone for 15 minutes is dropped.",
      ].join(" "),
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        name: z.string().max(80).optional().describe('The screen\'s name, which import_design gives it: "Checkout".'),
        replace: z.string().nullable().optional().describe("Id of the layer the design will replace (the preview draws over it); null makes it a new screen again."),
        width: z.number().int().min(100).max(4000).optional().describe("Viewport width in points (default: the device width)."),
        height: z.number().int().min(100).max(8000).optional().describe("Viewport height in points (default: the device height)."),
        position: z.tuple([z.number(), z.number()]).optional().describe("Where the screen goes in the component (default [0, 0]). Leave it out for a new screen."),
        html: z.string().optional().describe("Starts the draft, or starts it over: the page so far."),
        append: z.string().optional().describe("Adds to the end of the current draft."),
        clear: z.boolean().optional().describe("Removes the draft and its preview without importing."),
      }),
      // Not idempotent: each append adds to the draft.
      annotations: { ...UI_ONLY, idempotentHint: false },
    },
    async (args, ctx, work) => {
      const modes = [args.html, args.append, args.clear ? true : undefined].filter((m) => m !== undefined).length;
      if (modes !== 1)
        return failure({
          code: "invalid_source",
          message: "Pass exactly one of html (start the draft), append (add to it) or clear (remove it).",
          hint: 'Start with "html": the page\'s <head> and its first section. Then "append" the next part, one visual group per call.',
        });
      const author = tc.author(ctx);
      const client = tc.client(ctx);
      const key = sessionKey(author, client);
      const shows = showsDesignPreviews(host);
      // The turn is the draft's own, found by the document's id, so the read happens before it.
      const snap = await host.getDocument(args.docId);
      return withDraft(host, now, snap.docId, key, async (drafts) => {
        // A call cancelled while it waited (Stop in the Assistant, a client that gave up) never draws, and leaves the draft as it was.
        work.throwIfCancelled();
        const current = drafts.get();
        if (args.clear) {
          if (!current) return success("There's no draft to remove, so nothing changed.", { docId: snap.docId, name: null, component: null, replace: null, bytes: 0, revision: snap.revision, draftRevision: null });
          drafts.drop(current);
          const note = await drafts.update(current, "cleared");
          const name = current.fields.name;
          return draftResult(`Removed the draft${name ? ` “${name}”` : ""}${shows ? " from the canvas" : ""}. Nothing changed.`, snap, current, 0, note);
        }
        if (args.append !== undefined && !current)
          return failure({
            code: "no_draft",
            message: "There's no draft to add to. Start it with html first.",
            hint: "Drafts are kept per document and session, and one left alone for 15 minutes is dropped. Send the page so far as html.",
          });
        const fields = mergeFields(current?.fields ?? NO_DRAFT_FIELDS, args);
        const component = requireComponent(snap.doc, fields.component ?? undefined);
        const replaced = fields.replace === null ? null : findLayer(component.layers, fields.replace)?.layer;
        if (fields.replace !== null && !replaced)
          return args.replace === undefined
            ? goneReplace(component.id, fields.replace)
            : failure({
                code: "not_found",
                message: `There's no layer "${fields.replace}" to replace in ${component.id}.`,
                hint: 'Pass the id of the screen or layer the design replaces (get_outline shows it), or "replace": null for a new screen.',
              });
        const html = args.html ?? `${current!.html}${args.append}`;
        if (html.length > MAX_DRAFT_CHARS)
          return failure({ code: "html_too_large", message: "The draft is over 1,500,000 characters. Keep the page lean: inline SVG icons instead of big data: images." });
        const draft: DesignDraft = current ?? { docId: snap.docId, key, author, fields, html, revision: 0, touchedAt: now() };
        Object.assign(draft, { author, fields, html }, client ? { client } : {});
        drafts.keep(draft);
        const note = await drafts.update(draft, "writing");
        const bytes = draftBytes(html);
        const kb = draftKb(bytes);
        const named = fields.name ? ` “${fields.name}”` : "";
        // Named on every call, so a replace kept from an earlier call is never a surprise.
        const over = replaced ? ` over “${replaced.name}”, which it replaces` : "";
        const replacing = replaced ? `, which replaces “${replaced.name}”` : "";
        // A redesign draws over the layer it replaces; a new screen at its position.
        const artboard = artboardSize(snap.doc, component.id);
        const away = replaced || component.id !== snap.doc.project.root ? null : offScreenNote(fields.name, [...(fields.position ?? [0, 0]), fields.width ?? artboard[0], fields.height ?? artboard[1]], artboard);
        const text = shows
          ? `Showing ${fields.name ? `“${fields.name}”` : "the draft"} on the canvas${over} (${kb} KB so far). Add the next part with append, then import it with import_design and "preview": true.`
          : host.kind === "headless"
            ? `Kept the draft${named}${replacing} (${kb} KB). This is headless mode with no canvas, so nobody sees it; import it with import_design and "preview": true.`
            : `Kept the draft${named}${replacing} (${kb} KB). This Sonobe host can't show it on the canvas; import it with import_design and "preview": true.`;
        return draftResult(away ? `${text}\nNote: ${away}` : text, snap, draft, bytes, note);
      });
    },
  );

  /** import_design once its source is known: the call's own, or the preview draft's html. */
  const importDesign = async (args: ImportDesignArgs, snap: DocumentSnapshot, ctx: ServerContext, work: ToolWork): Promise<CallToolResult> => {
    const component = requireComponent(snap.doc, args.component);
    const [deviceWidth, deviceHeight] = component.size ?? deviceScreenSize(snap.doc.project.device);
    // null, like leaving it out, imports a new screen.
    const replace = args.replace ?? undefined;
    let captured: CapturedDesign;
    if (args.capture !== undefined) {
      let capture;
      try {
        capture = parseCapture(args.capture);
      } catch (err) {
        if (err instanceof CaptureFormatError) return failure({ code: "invalid_capture", message: err.message, hint: err.issues.slice(1).join("; ") || undefined });
        throw err;
      }
      const fetcher = host.fetchImage ? host.fetchImage.bind(host) : typeof fetch === "function" ? globalFetcher() : undefined;
      const files = Object.keys(capture.images).length + (capture.fonts?.length ?? 0);
      let late = 0;
      const images = !files ? new Map() : await work.step(
        `Downloading the capture's images: 0 of ${files}`,
        (control) =>
          resolveCaptureFiles(capture, {
            ...(fetcher ? { fetch: fetcher } : {}),
            signal: control.signal,
            until: Date.now() + IMAGES_STEP_MS - 5_000,
            onFile: (_key, status, done, total) => {
              if (status === "timed-out") late++;
              control.progress({ message: `Downloading the capture's images: ${done} of ${total}`, progress: done, total });
            },
          }),
        { deadlineMs: IMAGES_STEP_MS },
      );
      captured = { capture, images, ...(late ? { notes: [`${plural(late, "image or font", "images or fonts")} didn't download in time and ${late === 1 ? "shows" : "show"} as a placeholder or an installed font.`] } : {}) };
    } else {
      if (!host.captureDesign)
        return failure({
          code: "design_capture_unavailable",
          message: host.kind === "headless" ? "This headless server has no browser to render pages with." : "This Sonobe host can't render pages.",
          hint: host.kind === "headless" ? "Install Playwright's Chromium where Sonobe runs (npx playwright install chromium), or open the project in the Sonobe app, which renders pages itself." : "Update the Sonobe app.",
        });
      const captureDesign = host.captureDesign.bind(host);
      const stepMs = CAPTURE_STEP_MS + (args.waitMs ?? 0);
      captured = await work.step(
        args.url !== undefined ? `Loading ${args.url}` : "Rendering the HTML",
        (control) =>
          captureDesign(
            {
              ...(args.url !== undefined ? { url: args.url } : { html: args.html! }),
              width: args.width ?? deviceWidth,
              height: args.height ?? deviceHeight,
              ...(args.selector !== undefined ? { selector: args.selector } : {}),
              ...(args.waitFor !== undefined ? { waitFor: args.waitFor } : {}),
              ...(args.waitMs !== undefined ? { waitMs: args.waitMs } : {}),
              ...(args.fullPage !== undefined ? { fullPage: args.fullPage } : {}),
              ...(args.colorScheme !== undefined ? { colorScheme: args.colorScheme } : {}),
              ...(args.screenshot ? { screenshot: true } : {}),
            },
            control,
          ),
        {
          deadlineMs: stepMs,
          onTimeout: () =>
            new HostError("capture_timeout", `The page didn't finish capturing within ${Math.round(stepMs / 1000)} seconds.`, {
              hint: "The Sonobe app may be busy. Try again; if it keeps happening, import with html, or with a selector for one part of the page.",
            }),
        },
      );
    }

    // A capture can take a while; plan against the document as it is now, and refuse to apply over
    // edits made after that.
    work.throwIfCancelled();
    work.progress("Planning the layers");
    const current = await host.getDocument(snap.docId);
    if (args.expectedRevision !== undefined && args.expectedRevision !== current.revision)
      return failure({ code: "revision_mismatch", message: `The document moved on to revision ${current.revision} while the page was captured (expected ${args.expectedRevision}).`, hint: "Re-read it with get_outline, then import again." });
    const retired = current.retired?.[component.id];
    let plan: ImportPlan;
    try {
      plan = await planImport(captured.capture, current.doc, captured.images, {
      component: component.id,
      ...(retired?.length ? { isRetired: (id: string) => retired.includes(id) } : {}),
      ...(replace !== undefined ? { replace } : {}),
      ...(args.parent !== undefined ? { parent: args.parent } : {}),
      ...(args.index !== undefined ? { index: args.index } : {}),
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.position !== undefined ? { position: args.position } : {}),
      ...(args.scrolling !== undefined ? { scrolling: args.scrolling } : {}),
      ...(args.dryRun ? { dryRun: true } : {}),
      });
    } catch (err) {
      if (err instanceof ImportPlanError) return failure({ code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) });
      throw err;
    }
    work.throwIfCancelled();
    const s = plan.summary;
    const frame = planFrame(plan);
    const away = frame && component.id === current.doc.project.root ? offScreenNote(plan.screenName, frame, artboardSize(current.doc, component.id)) : null;
    const importNotes = [...(away ? [away] : []), ...plan.notes, ...(captured.notes ?? [])];
    const meta = (screenId: string | null, txnId: string | null): ImportResultMeta => ({
      docId: snap.docId,
      component: component.id,
      dryRun: !!args.dryRun,
      screenId,
      screenName: plan.screenName,
      txnId,
      replaced: replace ?? null,
      dropped: plan.dropped.slice(0, MAX_META_DROPPED),
      droppedCount: plan.dropped.length,
      lostConnections: s.lostConnections ?? 0,
      kept: s.kept ?? null,
    });
    // Clients that read only structuredContent would hide the image, so an image result sends content alone.
    const withPageImage = (out: CallToolResult): CallToolResult => {
      if (!captured.screenshot || out.isError) return out;
      const { structuredContent: _structured, ...rest } = out;
      return { ...rest, content: [...(out.content ?? []), { type: "text", text: "The page as the browser drew it:" }, { type: "image", data: captured.screenshot.data, mimeType: captured.screenshot.mimeType }] };
    };

    if (args.dryRun) {
      let text: string;
      if (replace !== undefined) {
        const old = findLayer(current.doc.components[component.id]?.layers ?? [], replace)?.layer;
        const drops = plan.dropped.length ? ` and remove ${plan.dropped.length} that ${plan.dropped.length === 1 ? "isn't" : "aren't"} in the new design: ${listNames(plan.dropped.map((l) => l.name))}` : "";
        const lost = s.lostConnections ? `, and drop ${plural(s.lostConnections, "connection")}` : "";
        text = `Dry run: importing over “${old?.name ?? replace}” (${replace}) would keep ${s.kept ?? 0} of its layers${drops}${lost}. Nothing changed.`;
      } else text = `Dry run: importing would add “${plan.screenName}”: ${summaryLine(s)}. Nothing changed.`;
      const out = success([text, ...importNotes.map((note) => `Note: ${note}`)].join("\n"), {
        ok: true,
        changed: "none",
        docId: snap.docId,
        revision: current.revision,
        dryRun: true,
        screenName: plan.screenName,
        summary: s,
        dropped: plan.dropped.slice(0, MAX_META_DROPPED),
        importNotes,
      });
      return withPageImage({ ...out, _meta: { [IMPORT_META_KEY]: meta(null, null) } });
    }

    if (plan.files.length) {
      if (!host.putAssetFiles)
        return failure({ code: "assets_unavailable", message: "This Sonobe host can't store image files, so the import can't bring images.", hint: "Open the project in the Sonobe app or a headless server over a project folder." });
      const putAssetFiles = host.putAssetFiles.bind(host);
      await work.step(`Storing ${plural(plan.files.length, "image file")}`, (control) => putAssetFiles(plan.files, { docId: snap.docId, ...control }), { deadlineMs: STORE_STEP_MS });
    }
    // The last point where a cancel stops the import: host.apply refuses once work.signal has aborted.
    const result = await host.apply(plan.ops, {
      docId: snap.docId,
      label: args.label?.trim() || `${replace ? "re-imported" : "imported"} ${plan.screenName}`,
      author: tc.author(ctx),
      expectedRevision: current.revision,
      signal: work.signal,
    });
    const screenId = result.idMap[plan.screenRef] ?? result.idMap[`$${plan.screenRef}`];
    const notes: string[] = [];
    if (result.txnId && screenId) {
      notes.push(`${replace ? "Re-imported" : "Imported"} "${plan.screenName}" as layer ${screenId}: ${summaryLine(s)}.`);
      if (s.kept !== undefined) notes.push(`${plural(s.kept, "layer")} kept their ids, so interactions wired to them still work.`);
      const after = await host.getDocument(snap.docId);
      const lines = screenOutline(getOutline(after.doc, component.id, { detail: "compact", registry: host.registry }), screenId);
      if (lines.length) notes.push("Screen outline:", ...lines);
      for (const note of importNotes) notes.push(`Note: ${note}`);
      notes.push("Next: compare get_screenshot with the source, rename layers people will talk about, then wire interactions (Interaction → Switch → Pop Animation → Transition) onto these layer ids.");
    }
    const out = writeResult(result, { notes, summarizeCreated: true, data: { ...(screenId ? { screenId } : {}), summary: s, importNotes } });
    // The screen id and txnId also ride in _meta, which a screenshot result keeps.
    return withPageImage(out.isError ? out : { ...out, _meta: { [IMPORT_META_KEY]: meta(screenId ?? null, result.txnId ?? null) } });
  };

  tc.tool(
    "import_design",
    {
      title: "Import design",
      description: [
        "Import a real design onto the canvas as layers people can prototype with: backgrounds, borders, shadows, text, images, SVG icons and text fields, named after components, labels and roles, in one undo step.",
        'Sources (pass exactly one): "url" renders a live page, such as the person\'s app on its dev server (http://localhost:3000/settings) or a Storybook story; "html" renders a page you write, for designs that live in code Sonobe can\'t run (SwiftUI, React Native, Flutter, a component with a backend) or a new design you\'re vibe coding; "capture" imports a design capture made elsewhere; "preview": true imports the page you drew on the person\'s canvas with preview_design, without sending it again, with its name, replace and size unless you pass others.',
        'For HTML: write one complete static page that reproduces the screen faithfully (real copy, colors, spacing, fonts, icons as inline SVG, and SF Symbols as <svg data-sf-symbol="heart.fill"></svg> sized and colored by CSS font-size, font-weight and color, which Sonobe on a Mac draws as the real symbol), size the layout for "width", and put data-name="Like Button" on elements you\'ll wire, text included, so their layers get those names. <style> and CDN scripts such as Tailwind work.',
        'To iterate on a design, import it again with "replace" set to the earlier screen\'s id: layers found again keep their ids, and the interactions wired to them keep working.',
        "dryRun plans the import without changing anything; with replace it names the layers that wouldn't be found again.",
        'The screen lands at [0, 0] of the component, sized to the document\'s device unless width/height say otherwise. Leave "position" out for a new screen: the canvas and viewer draw only the device screen, so a screen placed beside it can\'t be seen. Until navigation is wired, the new screen covers the one behind it in the viewer, which is expected; offer to wire it (a tap that slides it in, say).',
        'Pages taller than the screen get a Content layer with a Scroll patch, and so do scroll containers. Read get_guide("importing") before your first import.',
        "A capture sends progress while it runs and stops after 90 seconds plus waitMs with an error naming the step; cancelling the call before the screen is added changes nothing.",
      ].join(" "),
      input: ImportDesignInput,
      // No outputSchema: a result with the page screenshot sends content only, so clients show the image.
      annotations: { ...ADDITIVE, openWorldHint: true },
    },
    async (input, ctx, work): Promise<CallToolResult> => {
      const sources = [input.url, input.html, input.capture, input.preview ? true : undefined].filter((s) => s !== undefined).length;
      if (sources !== 1)
        return failure({
          code: "invalid_source",
          message: sources === 0 ? "import_design needs a source: url, html, capture or preview." : "Pass only one of url, html, capture or preview.",
          hint: 'Use "url" when the person\'s app runs in a browser (start its dev server), "html" to import a screen you reproduce from their code, and "preview": true for the page you drew with preview_design.',
        });
      if (input.url !== undefined && !/^https?:\/\//i.test(input.url))
        return failure({ code: "invalid_url", message: `"${input.url}" isn't an http(s) address.`, hint: "Start the app's dev server and pass its address, like http://localhost:3000/profile." });

      const snap = await host.getDocument(input.docId);
      if (!input.preview) return importDesign(input, snap, ctx, work);

      // The session's preview_design draft: its html, and its fields unless the call passes its own.
      // The canvas shows it being added and takes it away once it's layers; a failed import keeps it,
      // for Claude to fix. A dry run adds nothing, so the draft stays as it is.
      const key = sessionKey(tc.author(ctx), tc.client(ctx));
      const notes: string[] = [];
      const taken = await withDraft(host, now, snap.docId, key, async (drafts) => {
        const draft = drafts.get();
        if (!draft)
          return {
            failed: failure({
              code: "no_draft",
              message: "There's no design preview to import for this session. Show one with preview_design first, or pass html.",
              hint: "Drafts are kept per document and session, and one left alone for 15 minutes is dropped.",
            }),
          };
        // The draft's replace, when the layer is gone since: say so before rendering the page.
        if (input.replace === undefined && draft.fields.replace !== null) {
          const component = requireComponent(snap.doc, input.component ?? draft.fields.component ?? undefined);
          if (!findLayer(component.layers, draft.fields.replace)) return { failed: goneReplace(component.id, draft.fields.replace) };
        }
        if (!input.dryRun) {
          const note = await drafts.update(draft, "adding");
          if (note) notes.push(note);
        }
        return { draft, revision: draft.revision };
      });
      if (taken.failed) return taken.failed;
      const { draft, revision } = taken;
      const args: ImportDesignArgs = { ...draftArgs(draft.fields), ...definedArgs(input), html: draft.html };
      if (input.dryRun) return importDesign(args, snap, ctx, work);
      let out: CallToolResult | undefined;
      try {
        out = await importDesign(args, snap, ctx, work);
      } finally {
        const imported = out !== undefined && !out.isError;
        const note = await withDraft(host, now, snap.docId, key, async (drafts) => {
          // preview_design changed the draft while it was being added: the newer draft stays as it is.
          if (drafts.get() !== draft || draft.revision !== revision) return null;
          if (!imported) return drafts.update(draft, "writing");
          drafts.drop(draft);
          return drafts.update(draft, "cleared");
        });
        if (note) notes.push(note);
      }
      return notes.length ? { ...out, content: [...(out.content ?? []), ...notes.map((note) => ({ type: "text" as const, text: `Note: ${note}` }))] } : out;
    },
  );
}

/** A draft's fields after a preview_design call: the ones it passed, and the draft's own for the rest. A null replace clears it. */
function mergeFields(fields: DesignDraftFields, args: { name?: string; component?: string; replace?: string | null; width?: number; height?: number; position?: [number, number] }): DesignDraftFields {
  return {
    name: args.name ?? fields.name,
    component: args.component ?? fields.component,
    replace: args.replace === undefined ? fields.replace : args.replace,
    width: args.width ?? fields.width,
    height: args.height ?? fields.height,
    position: args.position ?? fields.position,
  };
}

/** The import_design fields a draft sets. */
function draftArgs(fields: DesignDraftFields): Partial<ImportDesignArgs> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)) as Partial<ImportDesignArgs>;
}

/** The fields a call passed (so they win over a draft's). */
function definedArgs(args: ImportDesignArgs): Partial<ImportDesignArgs> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as Partial<ImportDesignArgs>;
}

/**
 * preview_design's result: the text, a note when the canvas didn't take the update, the draft's name,
 * component and replace as its calls left them (so a client can tell what import_design { preview: true }
 * would replace), its size and update count, and the document's revision (`revision` means the
 * document's in every result, which a preview doesn't change).
 */
function draftResult(text: string, snap: DocumentSnapshot, draft: DesignDraft, bytes: number, note: string | null): CallToolResult {
  const { name, component, replace } = draft.fields;
  return success([text, ...(note ? [`Note: ${note}`] : [])].join("\n"), { docId: draft.docId, name, component, replace, bytes, revision: snap.revision, draftRevision: draft.revision });
}

/** The failure for a draft whose replace, kept from an earlier preview_design call, names a layer that's gone. */
function goneReplace(componentId: Id, replace: Id): CallToolResult {
  return failure({
    code: "not_found",
    message: `The draft replaces "${replace}", which isn't in ${componentId} now.`,
    hint: 'Pass "replace": null to make it a new screen, or the id of the layer it replaces (get_outline shows it).',
  });
}

/** "12 layers (3 texts, 1 image) and 1 Scroll patch": what an import adds. */
function summaryLine(s: ImportSummary): string {
  return `${plural(s.layers, "layer")} (${plural(s.texts, "text")}, ${plural(s.images, "image")}${s.fields ? `, ${plural(s.fields, "text field")}` : ""}${s.fonts ? `, ${plural(s.fonts, "web font")}` : ""})${s.scrolls ? ` and ${plural(s.scrolls, "Scroll patch", "Scroll patches")}` : ""}`;
}

/** The first five names, then "and N more". */
function listNames(names: readonly string[]): string {
  return `${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}`;
}
