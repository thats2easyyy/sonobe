/**
 * import_design: bring a real design onto the canvas. Renders the person's running app (a URL), HTML
 * Claude wrote from their code, or a ready-made capture (a browser extension, a Figma plugin), then
 * adds it as one screen of real layers in one undo step, with Scroll patches for content that scrolls.
 * A dry run plans it and changes nothing. Every successful result carries an ImportResultMeta in its
 * _meta, which a result with a screenshot keeps when it leaves out structuredContent.
 */

import { deviceScreenSize, findLayer, getOutline, type Id } from "@sonobe/core";
import { CAPTURE_TIMEOUT_MS, CaptureFormatError, globalFetcher, ImportPlanError, parseCapture, planImport, resolveCaptureFiles, type ImportPlan, type ImportSummary } from "@sonobe/import";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { plural } from "../format.ts";
import { requireComponent } from "../graph.ts";
import { HostError, type CapturedDesign } from "../host.ts";
import { failure, success } from "../results.ts";
import { ADDITIVE, type ToolContext } from "../server.ts";
import { ComponentIdSchema, DocIdSchema, ExpectedRevisionSchema, LabelSchema } from "../schemas.ts";
import { writeResult } from "./write.ts";

/** The `_meta` key of import_design's result: an ImportResultMeta. */
export const IMPORT_META_KEY = "dev.sonobe/import";
/** On every successful import_design result (also when a screenshot drops structuredContent). */
export interface ImportResultMeta {
  docId: string;
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

export function registerImportTools(tc: ToolContext): void {
  const { host } = tc;

  tc.tool(
    "import_design",
    {
      title: "Import design",
      description: [
        "Import a real design onto the canvas as layers people can prototype with: backgrounds, borders, shadows, text, images, SVG icons and text fields, named after components, labels and roles, in one undo step.",
        'Sources (pass exactly one): "url" renders a live page, such as the person\'s app on its dev server (http://localhost:3000/settings) or a Storybook story; "html" renders a page you write, for designs that live in code Sonobe can\'t run (SwiftUI, React Native, Flutter, a component with a backend) or a new design you\'re vibe coding; "capture" imports a design capture made elsewhere.',
        'For HTML: write one complete static page that reproduces the screen faithfully (real copy, colors, spacing, fonts, icons as inline SVG, and SF Symbols as <svg data-sf-symbol="heart.fill"></svg> sized and colored by CSS font-size, font-weight and color, which Sonobe on a Mac draws as the real symbol), size the layout for "width", and put data-name="Like Button" on elements you\'ll wire, text included, so their layers get those names. <style> and CDN scripts such as Tailwind work.',
        'To iterate on a design, import it again with "replace" set to the earlier screen\'s id: layers found again keep their ids, and the interactions wired to them keep working.',
        "dryRun plans the import without changing anything; with replace it names the layers that wouldn't be found again.",
        'The screen lands at [0, 0] of the component (or "parent"/"position"), sized to the document\'s device unless width/height say otherwise. Pages taller than the screen get a Content layer with a Scroll patch, and so do scroll containers. Read get_guide("importing") before your first import.',
        "A capture sends progress while it runs and stops after 90 seconds plus waitMs with an error naming the step; cancelling the call before the screen is added changes nothing.",
      ].join(" "),
      // The sources come last: models write keys in schema order, so the small fields arrive before a
      // long html, and a preview of the page as it streams knows its name and place.
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        name: z.string().max(80).optional().describe('Screen layer name (default: the page title). "Home", "Checkout".'),
        replace: z.string().optional().describe("Id of an earlier imported screen to replace, keeping the ids and wiring of layers found again."),
        parent: z.string().optional().describe("Container layer for the screen (default: the component root)."),
        position: z.tuple([z.number(), z.number()]).optional().describe("Screen position in its parent (default [0, 0])."),
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
        url: z.string().url().max(8000).optional().describe("An http(s) page to render."),
        capture: z.unknown().optional().describe('A design capture ({ "format": "sonobe.design-capture", ... }).'),
        html: z.string().max(1_500_000).optional().describe("A complete HTML page to render."),
      }),
      // No outputSchema: a result with the page screenshot sends content only, so clients show the image.
      annotations: { ...ADDITIVE, openWorldHint: true },
    },
    async (args, ctx, work): Promise<CallToolResult> => {
      const sources = [args.url, args.html, args.capture].filter((s) => s !== undefined).length;
      if (sources !== 1)
        return failure({
          code: "invalid_source",
          message: sources === 0 ? "import_design needs a source: url, html or capture." : "Pass only one of url, html or capture.",
          hint: 'Use "url" when the person\'s app runs in a browser (start its dev server), and "html" to import a screen you reproduce from their code.',
        });
      if (args.url !== undefined && !/^https?:\/\//i.test(args.url))
        return failure({ code: "invalid_url", message: `"${args.url}" isn't an http(s) address.`, hint: "Start the app's dev server and pass its address, like http://localhost:3000/profile." });

      const snap = await host.getDocument(args.docId);
      const component = requireComponent(snap.doc, args.component);
      const [deviceWidth, deviceHeight] = component.size ?? deviceScreenSize(snap.doc.project.device);
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
        ...(args.replace !== undefined ? { replace: args.replace } : {}),
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
      const importNotes = [...plan.notes, ...(captured.notes ?? [])];
      const meta = (screenId: string | null, txnId: string | null): ImportResultMeta => ({
        docId: snap.docId,
        dryRun: !!args.dryRun,
        screenId,
        screenName: plan.screenName,
        txnId,
        replaced: args.replace ?? null,
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
        if (args.replace !== undefined) {
          const old = findLayer(current.doc.components[component.id]?.layers ?? [], args.replace)?.layer;
          const drops = plan.dropped.length ? ` and remove ${plan.dropped.length} that ${plan.dropped.length === 1 ? "isn't" : "aren't"} in the new design: ${listNames(plan.dropped.map((l) => l.name))}` : "";
          const lost = s.lostConnections ? `, and drop ${plural(s.lostConnections, "connection")}` : "";
          text = `Dry run: importing over “${old?.name ?? args.replace}” (${args.replace}) would keep ${s.kept ?? 0} of its layers${drops}${lost}. Nothing changed.`;
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
        label: args.label?.trim() || `${args.replace ? "re-imported" : "imported"} ${plan.screenName}`,
        author: tc.author(ctx),
        expectedRevision: current.revision,
        signal: work.signal,
      });
      const screenId = result.idMap[plan.screenRef] ?? result.idMap[`$${plan.screenRef}`];
      const notes: string[] = [];
      if (result.txnId && screenId) {
        notes.push(`${args.replace ? "Re-imported" : "Imported"} "${plan.screenName}" as layer ${screenId}: ${summaryLine(s)}.`);
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
    },
  );
}

/** "12 layers (3 texts, 1 image) and 1 Scroll patch": what an import adds. */
function summaryLine(s: ImportSummary): string {
  return `${plural(s.layers, "layer")} (${plural(s.texts, "text")}, ${plural(s.images, "image")}${s.fields ? `, ${plural(s.fields, "text field")}` : ""}${s.fonts ? `, ${plural(s.fonts, "web font")}` : ""})${s.scrolls ? ` and ${plural(s.scrolls, "Scroll patch", "Scroll patches")}` : ""}`;
}

/** The first five names, then "and N more". */
function listNames(names: readonly string[]): string {
  return `${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}`;
}
