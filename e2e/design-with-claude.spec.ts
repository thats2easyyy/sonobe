/**
 * Design with Claude on the canvas, against a fake Assistant (e2e/fakeAssistant.ts). The dev server
 * sets Vite's DEV, so getAssistantHost() returns the fake, and window.sonobeHost stays unset: the rest
 * of the editor, including the page's import, runs as the browser editor does. An MCP client's
 * preview_design drafts reach the canvas through the test hook's previewDesign, which takes the
 * design.preview RPC's path.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fakeAssistantSent, fakeHandoffs, installFakeAssistant, releaseFakeGate } from "./fakeAssistant.ts";
import { collectConsoleProblems, hook, openEditor, sawHologram, screenshot, watchForHologram } from "./helpers.ts";

const profileHtml = readFileSync(fileURLToPath(new URL("../packages/import/fixtures/profile.html", import.meta.url)), "utf8");

/** The box's field; its label follows the target ("Describe a screen for Claude", "Describe a change to “Card”"). */
const designField = (page: Page): Locator => page.getByRole("textbox", { name: /^Describe a (screen for Claude|change to “.+”)$/ });

/** The Design with Claude box: the nearest element around its field that also holds the footer's Open chat. */
const designBox = (page: Page): Locator => designField(page).locator("xpath=ancestor::*[.//button[normalize-space(.)='Open chat' or @aria-label='Open chat']][1]");

/** A line of the box's status (role="status"). */
const statusLine = (box: Locator, text: string | RegExp): Locator => box.getByRole("status").filter({ hasText: text });

const preview = (page: Page): Locator => page.locator("iframe[title='Design preview']");

/** The pill saying who is writing the draft: in the artboard's label row, or on the preview's frame. */
const draftPill = (page: Page): Locator => page.locator("[data-design-pill]");

/** Nothing covers the pill: it's inside the canvas, below its ruler and above the box. (Hit testing can't tell: the pill, the ruler and the label take no pointer events.) */
async function expectUncovered(pill: Locator): Promise<void> {
  await expect(pill).toBeInViewport();
  const rects = await pill.evaluate((el) => {
    const edges = (r: DOMRect | undefined) => (r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null);
    return { pill: edges(el.getBoundingClientRect())!, canvas: edges(document.querySelector(".sb-cv")?.getBoundingClientRect())!, ruler: edges(document.querySelector('.sb-cv__ruler[data-axis="x"]')?.getBoundingClientRect()), box: edges(document.querySelector(".sb-design-box")?.getBoundingClientRect()) };
  });
  expect(rects.pill.top).toBeGreaterThanOrEqual(rects.ruler?.bottom ?? rects.canvas.top);
  expect(rects.pill.bottom).toBeLessThanOrEqual(rects.box?.top ?? rects.canvas.bottom);
  expect(rects.pill.left).toBeGreaterThanOrEqual(rects.canvas.left);
  expect(rects.pill.right).toBeLessThanOrEqual(rects.canvas.right);
}

/** The canvas's zoom, as its header shows it (percent). */
const canvasZoom = async (page: Page): Promise<number> => parseFloat((await page.locator(".sb-cv__zoom").textContent()) ?? "");

/** The canvas's share of the split over the patch editor. */
const canvasSplit = (page: Page) => hook(page, (s) => s.layout().split);

/** Open the box from the sparkle in the canvas header. */
async function openBox(page: Page): Promise<void> {
  await page.locator(".sb-cv__design").click();
  await expect(designField(page)).toBeFocused();
}

/** Top-level layers of the root component, by name. */
const screens = (page: Page) => hook(page, (s) => s.doc().components[s.doc().project.root]!.layers.map((l) => ({ id: l.id, name: l.name })));

/** The id of the first layer with this name anywhere in the root component. */
const layerIdNamed = (page: Page, name: string) =>
  hook(
    page,
    (s, wanted) => {
      type L = { id: string; name: string; children?: L[] };
      const find = (layers: L[]): string | undefined => {
        for (const l of layers) {
          if (l.name === wanted) return l.id;
          const inner = find(l.children ?? []);
          if (inner) return inner;
        }
        return undefined;
      };
      return find(s.doc().components[s.doc().project.root]!.layers as L[]) ?? null;
    },
    name,
  );

/** Requests the page or any of its frames makes to example.com (the probes below expect none). */
function exampleRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname.endsWith("example.com")) urls.push(request.url());
  });
  return urls;
}

/** The CSP reports the fetch probe causes on purpose. */
const withoutProbes = (problems: string[]) => problems.filter((p) => !p.includes("https://example.com/x"));

/** A checkout page in the parts Claude Code sends with preview_design: the head and header, then the order, then the pay bar. */
const CHECKOUT_PARTS = [
  [
    "<!doctype html><html><head><style>",
    ":root{--ink:#111118;--muted:#6B6B78;--line:#ECECF1}",
    "body{margin:0;font-family:system-ui,sans-serif;color:var(--ink);background:#fff}",
    "header{padding:64px 20px 12px}h1{margin:0;font-size:34px}header p{margin:4px 0 0;color:var(--muted);font-size:15px}",
    ".item{display:flex;align-items:center;gap:12px;margin:0 20px;padding:14px 0;border-bottom:1px solid var(--line)}",
    ".thumb{width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,#F9A8D4,#8B5CF6)}",
    ".item b{display:block;font-size:17px}.item span{color:var(--muted);font-size:15px}.price{margin-left:auto;font-weight:600}",
    ".pay{position:fixed;left:20px;right:20px;bottom:34px;padding:16px;border-radius:14px;background:var(--ink);color:#fff;text-align:center;font-size:17px;font-weight:600}",
    '</style></head><body><header data-name="Header"><h1 data-name="Title">Checkout</h1><p data-name="Subtitle">2 tickets · Sunset Picnic</p></header>',
  ].join(""),
  [
    '<div class="item" data-name="Ticket"><div class="thumb"></div><div><b data-name="Ticket Name">General admission</b><span>Sat, June 14</span></div><div class="price">$36</div></div>',
    '<div class="item" data-name="Promo"><div><b data-name="Promo Title">Promo code</b><span>SUMMER10 saves $3.60</span></div><div class="price">−$3.60</div></div>',
  ].join(""),
  '<div class="pay" data-name="Pay Button">Pay $32.40 with Apple Pay</div></body></html>',
];

test.describe("Design with Claude", () => {
  test("draws the page Claude is writing over the artboard, then adds it as layers in one undo step", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = collectConsoleProblems(page);
    const blocked = exampleRequests(page);
    await installFakeAssistant(page, { html: profileHtml, name: "Profile", hold: 25 });
    await openEditor(page);

    const ownSplit = await canvasSplit(page);
    await openBox(page);
    // The canvas takes most of the split while the box is open; the patch editor stays as a strip.
    await expect.poll(() => canvasSplit(page)).toBe(0.8);
    const box = designBox(page);
    await expect(box.getByText("New screen · 402 × 874")).toBeVisible();
    await designField(page).fill("a profile screen");
    await designField(page).press("Enter");

    // Held part-way through the html: the preview shows what Claude has written so far, where the screen will land.
    const frame = page.frameLocator("iframe[title='Design preview']");
    await expect(frame.getByText("Ava Chen", { exact: true })).toBeVisible();
    await expect(frame.getByText("Product designer")).toHaveCount(0);
    await expect(statusLine(box, "Writing “Profile”")).toBeVisible();
    await expect(draftPill(page)).toHaveText("Claude is writing “Profile”");
    await expectUncovered(draftPill(page));
    // Large enough to read as it's written.
    expect(await canvasZoom(page)).toBeGreaterThanOrEqual(45);
    const [frameBox, artboardBox] = await Promise.all([preview(page).boundingBox(), page.locator(".sb-cv__artboard").boundingBox()]);
    expect(frameBox && artboardBox).toBeTruthy();
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(frameBox![key] - artboardBox![key]), key).toBeLessThanOrEqual(2);
    const sent = await fakeAssistantSent(page);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("a profile screen");
    expect(sent[0]!.context?.component.size).toEqual([402, 874]);
    expect(sent[0]!.context?.target ?? null).toBeNull();
    await screenshot(page, "design-01-writing");

    // The preview is sandboxed: it can't read the editor or reach the network.
    const previewFrame = await (await preview(page).elementHandle())!.contentFrame();
    expect(previewFrame).not.toBeNull();
    expect(
      await previewFrame!.evaluate(() => {
        try {
          return typeof window.parent.document;
        } catch {
          return "blocked";
        }
      }),
    ).toBe("blocked");
    expect(await previewFrame!.evaluate(() => fetch("https://example.com/x").then(() => "fetched", () => "refused"))).toBe("refused");
    expect(blocked).toEqual([]);

    // Done: the preview gives way to real layers, and the new screen is selected. The preview was its
    // reveal, so the import hologram doesn't build it again, on the canvas or in the Viewer.
    await watchForHologram(page);
    await releaseFakeGate(page);
    await expect(statusLine(box, "Added “Profile”.")).toBeVisible({ timeout: 30_000 });
    await expect(preview(page)).toBeHidden();
    const added = (await screens(page)).find((l) => l.name === "Profile");
    expect(added).toBeDefined();
    expect((await hook(page, (s) => s.selection().layers)) as string[]).toEqual([added!.id]);
    await expect(box.getByText("Change “Profile”")).toBeVisible();
    // The demo's own layers (none of them a screen) are behind it, so the line says the new screen covers them, and Send to Back is offered.
    await expect(statusLine(box, "Added “Profile”.")).toContainText("It's in front of the other layers in “Main”, so it covers them in the viewer too.");
    for (const chip of ["Undo", "Send to Back", "Make it interactive", "Add knobs", "Try a darker version"]) await expect(box.getByRole("button", { name: chip, exact: true }), chip).toBeVisible();
    await expect(box.getByText("Added a profile screen.")).toBeVisible();
    expect(await sawHologram(page)).toBe(false);
    await screenshot(page, "design-02-added");

    // Undo in the box takes the whole import back.
    await box.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await screens(page)).some((l) => l.name === "Profile")).toBe(false);
    await expect(statusLine(box, "Undid “Profile”.")).toBeVisible();

    // Add it again, then pick its card: the box offers to redesign that layer, and says so to Claude.
    await hook(page, (s) => s.session.selection.getState().clear());
    await expect(box.getByText("New screen · 402 × 874")).toBeVisible();
    await designField(page).fill("a profile screen");
    await designField(page).press("Enter");
    // Wait for the screen itself, then its line.
    await expect.poll(async () => (await screens(page)).filter((l) => l.name === "Profile").length, { timeout: 30_000 }).toBe(1);
    await expect(statusLine(box, "Added “Profile”.")).toBeVisible();
    // The first import's ids are retired after its undo, so the card's id is looked up, not assumed.
    const cardId = await layerIdNamed(page, "Profile Card");
    expect(cardId).not.toBeNull();
    await hook(page, (s, id) => s.session.selection.getState().select({ layers: [id] }), cardId!);
    await expect(box.getByText("Redesign “Profile Card”")).toBeVisible();
    await designField(page).fill("make it darker");
    await designField(page).press("Enter");
    await expect.poll(async () => (await fakeAssistantSent(page)).at(-1)?.context?.target?.id).toBe(cardId);
    expect((await fakeAssistantSent(page)).at(-1)!.text).toBe("make it darker");
    await expect(statusLine(box, "Updated “Profile Card”")).toBeVisible({ timeout: 30_000 });
    // Adding it again and redesigning its card played no hologram either.
    expect(await sawHologram(page)).toBe(false);

    // A layer's Redesign with Claude… in the Layers panel picks that layer.
    await page.locator("#sb-layers").getByText("Profile", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Redesign with Claude…" }).click();
    await expect(box.getByText("Redesign “Profile”")).toBeVisible();
    const profileId = (await screens(page)).find((l) => l.name === "Profile")!.id;
    expect((await hook(page, (s) => s.selection().layers)) as string[]).toEqual([profileId]);

    // Match my code… links a folder (the fake's native dialog picks ~/code/placemark).
    await box.getByRole("button", { name: "Match my code…" }).click();
    await expect(box.getByText("Code: placemark")).toBeVisible();

    // Closing the box gives the person's split back.
    await box.getByRole("button", { name: "Close", exact: true }).click();
    await expect.poll(() => canvasSplit(page)).toBe(ownSplit);

    expect(withoutProbes(problems)).toEqual([]);
  });

  test("the preview drops Claude's scripts and never navigates", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const blocked = exampleRequests(page);
    // A refresh in the head never reaches the frame (only head styles do); the one in the body would
    // navigate the frame off the shell if the bootstrap didn't drop it.
    const refresh = '<meta http-equiv="refresh" content="0;url=https://example.com/">';
    const html = [
      "<!doctype html><html><head>",
      refresh,
      "<style>body{margin:0;font-family:system-ui}h1{margin:80px 20px 0;color:#7C3AED}</style>",
      "</head><body>",
      refresh,
      '<h1 data-name="Title">Sandboxed</h1>',
      '<script>document.body.dataset.ran="yes"</script>',
      '<p data-name="After">After the script</p>',
      "</body></html>",
    ].join("");
    // Held just before the last piece, so the preview shows everything but the closing tags.
    await installFakeAssistant(page, { html, name: "Sandboxed", hold: 39 });
    await openEditor(page);
    await openBox(page);
    await designField(page).fill("a sandboxed screen");
    await designField(page).press("Enter");

    const frame = page.frameLocator("iframe[title='Design preview']");
    await expect(frame.getByText("After the script")).toBeVisible();
    const previewFrame = await (await preview(page).elementHandle())!.contentFrame();
    expect(await previewFrame!.evaluate(() => document.body.dataset.ran ?? null)).toBeNull();
    await page.waitForTimeout(500);
    expect(previewFrame!.url()).toBe("about:srcdoc");
    // The shell keeps its own CSP meta and bootstrap; Claude's refresh and script are gone.
    expect(await previewFrame!.evaluate(() => ({ refresh: !!document.querySelector('meta[http-equiv="refresh" i]'), script: [...document.scripts].some((el) => el.textContent?.includes("dataset.ran")) }))).toEqual({ refresh: false, script: false });
    expect(blocked).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("without an API key, the box keeps the request and says what it needs", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: profileHtml, hasKey: false });
    await openEditor(page);
    await openBox(page);
    await designField(page).fill("a profile screen");
    await designField(page).press("Enter");
    await expect(page.getByText("Designing on the canvas uses your own Anthropic API key, kept in your keychain.")).toBeVisible();
    await expect(designField(page)).toHaveValue("a profile screen");
    // With a Claude plan instead of a key, Open in Claude Code comes first.
    const notice = page.locator(".sb-design-box__notice");
    await expect(notice).toContainText("With a Claude plan, open it in Claude Code instead: it draws on this canvas as it writes.");
    await expect(notice.getByRole("button")).toHaveText(["Open in Claude Code", "Add API key…", "Copy for Claude Code"]);
    await expect(preview(page)).toHaveCount(0);
    await screenshot(page, "design-03-no-key");

    // It hands the request to the person's own Claude Code, with the prompt that teaches the live preview.
    await notice.getByRole("button", { name: "Open in Claude Code" }).click();
    await expect(page.locator(".sb-toast", { hasText: "Opened Claude Code" })).toContainText("In Terminal, in “placemark”. It designs on this canvas as it writes.");
    const handoffs = await fakeHandoffs(page);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toContain("a profile screen");
    expect(handoffs[0]).toContain('preview_design (component "main") with the page\'s head and first section as html, then append one part at a time, then import_design with "preview": true.');
    expect(problems).toEqual([]);
  });

  test("draws the screen Claude Code is writing as its preview_design calls arrive", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const client = { id: "cc-1", label: "Claude Code", folder: "/Users/ava/code/placemark" };
    /** What the desktop sends over design.preview for each of Claude Code's calls (the test hook takes the same path). */
    const show = (parts: number, status: "writing" | "adding" | "cleared", draftRevision: number) =>
      hook(page, (s, update) => s.previewDesign(update), {
        docId: "photo-zoom",
        key: client.id,
        author: { kind: "agent" as const, name: "Claude" },
        client,
        name: "Checkout",
        component: null,
        replace: null,
        width: null,
        height: null,
        position: null,
        html: status === "cleared" ? null : CHECKOUT_PARTS.slice(0, parts).join(""),
        status,
        draftRevision,
      });
    const pill = draftPill(page);
    const frame = page.frameLocator("iframe[title='Design preview']");
    const ownSplit = await canvasSplit(page);

    // It said what it's doing (begin_work), then showed the page's head and header.
    await hook(page, (s, c) => void s.session.presence.getState().begin({ intent: "designing a checkout screen", author: { kind: "agent", name: "Claude" }, client: c }), client);
    expect(await show(1, "writing", 1)).toEqual({ applied: true });
    await expect(pill).toHaveText("Claude Code is writing “Checkout”");
    await expect(frame.getByText("2 tickets · Sunset Picnic")).toBeVisible();
    // With the box closed, the canvas makes room for the draft too, and shows it large enough to read.
    await expect.poll(() => canvasSplit(page)).toBe(0.8);
    await expectUncovered(pill);
    expect(await canvasZoom(page)).toBeGreaterThanOrEqual(45);
    await expect(frame.getByText("General admission")).toHaveCount(0);
    const [frameBox, artboardBox] = await Promise.all([preview(page).boundingBox(), page.locator(".sb-cv__artboard").boundingBox()]);
    expect(frameBox && artboardBox).toBeTruthy();
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(frameBox![key] - artboardBox![key]), key).toBeLessThanOrEqual(2);

    // Its next call appended the order.
    await show(2, "writing", 2);
    await expect(frame.getByText("General admission")).toBeVisible();
    await expect(frame.getByText("SUMMER10 saves $3.60")).toBeVisible();
    await expect(pill).toHaveText("Claude Code is writing “Checkout”");
    // The pill says what Claude Code is doing here, so its presence pill isn't repeated beside it.
    await expect(page.locator(".sb-cv__label")).not.toContainText("designing a checkout screen");
    await screenshot(page, "design-05-claude-code");

    // import_design with "preview": true says it's adding the whole page, then clears the draft once the layers are in.
    await show(3, "adding", 3);
    await expect(pill).toHaveText("Adding the layers…");
    await expect(frame.getByText("Pay $32.40 with Apple Pay")).toBeVisible();
    await show(0, "cleared", 4);
    await expect(preview(page)).toBeHidden();
    await expect(page.locator(".sb-cv__label-agent")).toHaveText("Claude Code: designing a checkout screen");
    // This test sends only the previews, and they never touch the document: nothing was added, so the split goes back.
    expect((await screens(page)).some((l) => l.name === "Checkout")).toBe(false);
    await expect.poll(() => canvasSplit(page)).toBe(ownSplit);
    expect(problems).toEqual([]);
  });

  test("in the browser, the box copies a prompt for Claude and points to Import Design", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await openEditor(page);
    await page.locator(".sb-cv__design").click();
    await expect(page.getByText("Claude designs on the canvas in the Sonobe desktop app, with your own API key or Claude Code. Here, copy a prompt for Claude, then paste the HTML it writes.")).toBeVisible();
    // The box may still take a description to put in the prompt.
    const field = designField(page);
    if (await field.isVisible()) await field.fill("a profile screen");
    // The notice's button (the field's own button copies the same prompt).
    const copyPrompt = page.locator(".sb-design-box__notice").getByRole("button", { name: "Copy prompt", exact: true });
    await copyPrompt.click();
    await expect(page.locator(".sb-toast", { hasText: "Prompt copied" })).toContainText("Paste it into Claude, then paste the HTML it writes into File → Import Design.");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("that I can paste into Sonobe's File → Import Design → Paste HTML");
    expect(copied).not.toMatch(/import_design|get_outline/);
    await screenshot(page, "design-04-browser");

    // The box's own Import Design… (next to Copy prompt) opens the dialog.
    await copyPrompt.locator("xpath=ancestor::*[.//button[normalize-space(.)='Import Design…']][1]").getByRole("button", { name: "Import Design…" }).click();
    await expect(page.getByRole("dialog", { name: "Import Design" })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
