/**
 * import_design: bring a real design onto the canvas. Renders the person's running app (a URL), HTML
 * Claude wrote from their code, or a ready-made capture (a browser extension, a Figma plugin), then
 * adds it as one screen of real layers in one undo step, with Scroll patches for content that scrolls.
 */

import { deviceScreenSize, getOutline, type Id } from "@sonobe/core";
import { CaptureFormatError, globalFetcher, ImportPlanError, parseCapture, planImport, resolveCaptureFiles, type ImportPlan } from "@sonobe/import";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { plural } from "../format.ts";
import { requireComponent } from "../graph.ts";
import type { CapturedDesign } from "../host.ts";
import { failure } from "../results.ts";
import { ADDITIVE, type ToolContext } from "../server.ts";
import { ComponentIdSchema, DocIdSchema, ExpectedRevisionSchema, LabelSchema } from "../schemas.ts";
import { writeResult } from "./write.ts";

/** Most outline lines the result shows for the imported screen. */
const OUTLINE_LINES = 70;

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
        'For HTML: write one complete static page that reproduces the screen faithfully (real copy, colors, spacing, fonts, icons as inline SVG), size the layout for "width", and put data-name="Like Button" on elements you\'ll wire, so their layers get those names. <style> and CDN scripts such as Tailwind work.',
        'To iterate on a design, import it again with "replace" set to the earlier screen\'s id: layers found again keep their ids, and the interactions wired to them keep working.',
        'The screen lands at [0, 0] of the component (or "parent"/"position"), sized to the document\'s device unless width/height say otherwise. Pages taller than the screen get a Content layer with a Scroll patch, and so do scroll containers. Read get_guide("importing") before your first import.',
      ].join(" "),
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        url: z.string().url().max(8000).optional().describe("An http(s) page to render."),
        html: z.string().max(1_500_000).optional().describe("A complete HTML page to render."),
        capture: z.unknown().optional().describe('A design capture ({ "format": "sonobe.design-capture", ... }).'),
        name: z.string().max(80).optional().describe('Screen layer name (default: the page title). "Home", "Checkout".'),
        width: z.number().int().min(100).max(4000).optional().describe("Viewport width in points (default: the device width)."),
        height: z.number().int().min(100).max(8000).optional().describe("Viewport height in points (default: the device height)."),
        selector: z.string().max(500).optional().describe('Import only the first element matching this CSS selector ("#pricing-card").'),
        waitFor: z.string().max(500).optional().describe("Wait until an element matches this selector (data that loads late)."),
        waitMs: z.number().int().min(0).max(20_000).optional().describe("Extra milliseconds to wait after the page settles."),
        fullPage: z.boolean().optional().describe("Import the whole page height (default true); false imports only what fits the viewport."),
        colorScheme: z.enum(["light", "dark"]).optional(),
        parent: z.string().optional().describe("Container layer for the screen (default: the component root)."),
        position: z.tuple([z.number(), z.number()]).optional().describe("Screen position in its parent (default [0, 0])."),
        replace: z.string().optional().describe("Id of an earlier imported screen to replace, keeping the ids and wiring of layers found again."),
        index: z.number().int().optional().describe("Insert position among siblings (default: front)."),
        scrolling: z.boolean().optional().describe("Add Scroll patches so long pages and scroll containers scroll (default true)."),
        screenshot: z.boolean().optional().describe("Also return an image of the page as the browser drew it, to compare with get_screenshot."),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      // No outputSchema: a result with the page screenshot sends content only, so clients show the image.
      annotations: { ...ADDITIVE, openWorldHint: true },
    },
    async (args, ctx): Promise<CallToolResult> => {
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
        captured = { capture, images: await resolveCaptureFiles(capture, fetcher ? { fetch: fetcher } : {}) };
      } else {
        if (!host.captureDesign)
          return failure({
            code: "design_capture_unavailable",
            message: host.kind === "headless" ? "This headless server has no browser to render pages with." : "This Sonobe host can't render pages.",
            hint: host.kind === "headless" ? "Install Playwright's Chromium where Sonobe runs (npx playwright install chromium), or open the project in the Sonobe app, which renders pages itself." : "Update the Sonobe app.",
          });
        captured = await host.captureDesign({
          ...(args.url !== undefined ? { url: args.url } : { html: args.html! }),
          width: args.width ?? deviceWidth,
          height: args.height ?? deviceHeight,
          ...(args.selector !== undefined ? { selector: args.selector } : {}),
          ...(args.waitFor !== undefined ? { waitFor: args.waitFor } : {}),
          ...(args.waitMs !== undefined ? { waitMs: args.waitMs } : {}),
          ...(args.fullPage !== undefined ? { fullPage: args.fullPage } : {}),
          ...(args.colorScheme !== undefined ? { colorScheme: args.colorScheme } : {}),
          ...(args.screenshot ? { screenshot: true } : {}),
        });
      }

      // A capture can take a while; plan against the document as it is now, and refuse to apply over
      // edits made after that.
      const current = await host.getDocument(snap.docId);
      if (args.expectedRevision !== undefined && args.expectedRevision !== current.revision)
        return failure({ code: "revision_mismatch", message: `The document moved on to revision ${current.revision} while the page was captured (expected ${args.expectedRevision}).`, hint: "Re-read it with get_outline, then import again." });
      let plan: ImportPlan;
      try {
        plan = await planImport(captured.capture, current.doc, captured.images, {
        component: component.id,
        ...(args.replace !== undefined ? { replace: args.replace } : {}),
        ...(args.parent !== undefined ? { parent: args.parent } : {}),
        ...(args.index !== undefined ? { index: args.index } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.position !== undefined ? { position: args.position } : {}),
        ...(args.scrolling !== undefined ? { scrolling: args.scrolling } : {}),
        });
      } catch (err) {
        if (err instanceof ImportPlanError) return failure({ code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) });
        throw err;
      }
      if (plan.files.length) {
        if (!host.putAssetFiles)
          return failure({ code: "assets_unavailable", message: "This Sonobe host can't store image files, so the import can't bring images.", hint: "Open the project in the Sonobe app or a headless server over a project folder." });
        await host.putAssetFiles(plan.files, { docId: snap.docId });
      }
      const result = await host.apply(plan.ops, {
        docId: snap.docId,
        label: args.label?.trim() || `${args.replace ? "re-imported" : "imported"} ${plan.screenName}`,
        author: tc.author(ctx),
        expectedRevision: current.revision,
      });
      const screenId = result.idMap[plan.screenRef] ?? result.idMap[`$${plan.screenRef}`];
      const s = plan.summary;
      const notes: string[] = [];
      if (result.txnId && screenId) {
        notes.push(`${args.replace ? "Re-imported" : "Imported"} "${plan.screenName}" as layer ${screenId}: ${plural(s.layers, "layer")} (${plural(s.texts, "text")}, ${plural(s.images, "image")}${s.fields ? `, ${plural(s.fields, "text field")}` : ""}${s.fonts ? `, ${plural(s.fonts, "web font")}` : ""})${s.scrolls ? ` and ${plural(s.scrolls, "Scroll patch", "Scroll patches")}` : ""}.`);
        if (s.kept !== undefined) notes.push(`${plural(s.kept, "layer")} kept their ids, so interactions wired to them still work.`);
        const after = await host.getDocument(snap.docId);
        const lines = screenOutline(getOutline(after.doc, component.id, { detail: "compact", registry: host.registry }), screenId);
        if (lines.length) notes.push("Screen outline:", ...lines);
        for (const note of plan.notes) notes.push(`Note: ${note}`);
        notes.push("Next: compare get_screenshot with the source, rename layers people will talk about, then wire interactions (Interaction → Switch → Pop Animation → Transition) onto these layer ids.");
      }
      const out = writeResult(result, { notes, summarizeCreated: true, data: { ...(screenId ? { screenId } : {}), summary: s, importNotes: plan.notes } });
      if (captured.screenshot && !out.isError) {
        // Clients that read only structuredContent would hide the image, so an image result sends content alone.
        const { structuredContent: _structured, ...rest } = out;
        return { ...rest, content: [...(out.content ?? []), { type: "text", text: "The page as the browser drew it:" }, { type: "image", data: captured.screenshot.data, mimeType: captured.screenshot.mimeType }] };
      }
      return out;
    },
  );
}
