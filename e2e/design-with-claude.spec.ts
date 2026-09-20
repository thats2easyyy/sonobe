/**
 * Design with Claude on the canvas, against a fake Assistant (e2e/fakeAssistant.ts). The dev server
 * sets Vite's DEV, so getAssistantHost() returns the fake, and window.sonobeHost stays unset: the rest
 * of the editor, including the page's import, runs as the browser editor does.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fakeAssistantSent, installFakeAssistant, releaseFakeGate } from "./fakeAssistant.ts";
import { collectConsoleProblems, hook, openEditor, screenshot } from "./helpers.ts";

const profileHtml = readFileSync(fileURLToPath(new URL("../packages/import/fixtures/profile.html", import.meta.url)), "utf8");

/** The box's field; its label follows the target ("Describe a screen for Claude", "Describe a change to “Card”"). */
const designField = (page: Page): Locator => page.getByRole("textbox", { name: /^Describe a (screen for Claude|change to “.+”)$/ });

/** The Design with Claude box: the nearest element around its field that also holds the footer's Open chat. */
const designBox = (page: Page): Locator => designField(page).locator("xpath=ancestor::*[.//button[normalize-space(.)='Open chat' or @aria-label='Open chat']][1]");

/** A line of the box's status (role="status"). */
const statusLine = (box: Locator, text: string | RegExp): Locator => box.getByRole("status").filter({ hasText: text });

const preview = (page: Page): Locator => page.locator("iframe[title='Design preview']");

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

test.describe("Design with Claude", () => {
  test("draws the page Claude is writing over the artboard, then adds it as layers in one undo step", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = collectConsoleProblems(page);
    const blocked = exampleRequests(page);
    await installFakeAssistant(page, { html: profileHtml, name: "Profile", hold: 25 });
    await openEditor(page);

    await openBox(page);
    const box = designBox(page);
    await expect(box.getByText("New screen · 402 × 874")).toBeVisible();
    await designField(page).fill("a profile screen");
    await designField(page).press("Enter");

    // Held part-way through the html: the preview shows what Claude has written so far, where the screen will land.
    const frame = page.frameLocator("iframe[title='Design preview']");
    await expect(frame.getByText("Ava Chen", { exact: true })).toBeVisible();
    await expect(frame.getByText("Product designer")).toHaveCount(0);
    await expect(statusLine(box, "Writing “Profile”")).toBeVisible();
    await expect(page.getByText("Claude is writing “Profile”")).toBeVisible();
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

    // Done: the preview gives way to real layers, and the new screen is selected.
    await releaseFakeGate(page);
    await expect(statusLine(box, "Added “Profile”.")).toBeVisible({ timeout: 30_000 });
    await expect(preview(page)).toBeHidden();
    const added = (await screens(page)).find((l) => l.name === "Profile");
    expect(added).toBeDefined();
    expect((await hook(page, (s) => s.selection().layers)) as string[]).toEqual([added!.id]);
    await expect(box.getByText("Change “Profile”")).toBeVisible();
    // The demo's own layers are behind it, so the line says the new screen covers them, and Send to Back is offered.
    await expect(statusLine(box, "Added “Profile”.")).toContainText(/It's in front of “.+”, so it covers it in the viewer too\./);
    for (const chip of ["Undo", "Send to Back", "Make it interactive", "Add knobs", "Try a darker version"]) await expect(box.getByRole("button", { name: chip, exact: true }), chip).toBeVisible();
    await expect(box.getByText("Added a profile screen.")).toBeVisible();
    await screenshot(page, "design-02-added");

    // Undo in the box takes the whole import back.
    await box.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await screens(page)).some((l) => l.name === "Profile")).toBe(false);

    // Add it again, then pick its card: the box offers to redesign that layer, and says so to Claude.
    await hook(page, (s) => s.session.selection.getState().clear());
    await expect(box.getByText("New screen · 402 × 874")).toBeVisible();
    await designField(page).fill("a profile screen");
    await designField(page).press("Enter");
    // The first result's line may still show, so wait for the screen itself.
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

    // A layer's Redesign with Claude… in the Layers panel picks that layer.
    await page.locator("#sb-layers").getByText("Profile", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Redesign with Claude…" }).click();
    await expect(box.getByText("Redesign “Profile”")).toBeVisible();
    const profileId = (await screens(page)).find((l) => l.name === "Profile")!.id;
    expect((await hook(page, (s) => s.selection().layers)) as string[]).toEqual([profileId]);

    // Match my code… links a folder (the fake's native dialog picks ~/code/noddit).
    await box.getByRole("button", { name: "Match my code…" }).click();
    await expect(box.getByText("Code: noddit")).toBeVisible();

    expect(withoutProbes(problems)).toEqual([]);
  });

  test("the preview drops Claude's scripts and never navigates", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const blocked = exampleRequests(page);
    const html = [
      "<!doctype html><html><head>",
      '<meta http-equiv="refresh" content="0;url=https://example.com/">',
      "<style>body{margin:0;font-family:system-ui}h1{margin:80px 20px 0;color:#7C3AED}</style>",
      '</head><body><h1 data-name="Title">Sandboxed</h1>',
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
    await expect(page.getByRole("button", { name: "Add API key…" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy for Claude Code" })).toBeVisible();
    await expect(preview(page)).toHaveCount(0);
    await screenshot(page, "design-03-no-key");
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
    const copyPrompt = page.getByRole("button", { name: "Copy prompt", exact: true });
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
