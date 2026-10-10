/**
 * Error containment (ARCHITECTURE §9): the editor is never a blank window. A render error is forced
 * through the test hook's `failRender(name)`, which makes the boundary with that name catch an error
 * the way a broken component inside it would.
 */

import { expect, test, type Page } from "@playwright/test";
import { blurFields, collectConsoleProblems, hook, modKey, openEditor, screenshot, skipWelcome, waitForPrototype } from "./helpers.ts";

test.describe("when the editor can't draw", () => {
  test("shows the recovery screen, keeps the draft, and brings it back after Reload", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.accept();
    });
    await openEditor(page);
    const mod = await modKey(page);
    await blurFields(page);
    await page.keyboard.press(`${mod}+n`);
    const start = page.getByRole("dialog", { name: "Start something new" });
    await start.getByRole("button", { name: "Create" }).click();
    await expect(start).toBeHidden();
    await hook(page, (s) => s.apply([{ op: "addLayer", layer: { id: "hero", type: "rectangle", name: "Hero Card" } }], "Add Hero Card"));
    // An edit made a moment before the failure, which the draft doesn't hold yet: the recovery screen writes it.
    await expect.poll(() => hook(page, (s) => s.session.drafts?.current()?.id ?? null)).not.toBeNull();
    // The edit, the check and the failure in one call: the keeper writes a second after an edit, so a second call could come too late.
    // The hook goes away with the editor, so this is the last call through it until the reload.
    const pending = await hook(page, (s) => {
      s.apply([{ op: "addLayer", layer: { id: "badge", type: "oval", name: "Badge" } }], "Add Badge");
      const waiting = s.session.drafts?.pending();
      s.failRender("Sonobe");
      return waiting;
    });
    expect(pending).toBe(true);
    const recovery = page.locator(".sb-recovery");
    await expect(recovery.getByRole("heading", { name: "Sonobe hit a problem" })).toBeVisible();
    await expect(recovery).toContainText("The editor couldn’t draw itself, so it stopped. Reload to start it again.");
    await expect(recovery.locator(".sb-recovery__draft")).toHaveText("Your unsaved changes to “Untitled” are kept as a draft. After you reload, or quit and reopen Sonobe, the welcome screen lists it under Recovered.");
    await expect(page.locator(".sb-app")).toHaveCount(0);
    await expect(recovery.getByRole("button", { name: "Reload Sonobe" })).toBeFocused();
    await screenshot(page, "resilience-01-recovery");

    await recovery.getByRole("button", { name: "Copy details" }).click();
    await expect(recovery.getByRole("button", { name: "Copied" })).toBeVisible();
    const details = await page.evaluate(() => navigator.clipboard.readText());
    expect(details).toContain("Error: Sonobe was asked to fail (window.__sonobe.failRender).");
    expect(details).toMatch(/\n\s+at /);
    expect(details).toMatch(/Sonobe 0\.1\.0 · browser · \w+ · Mozilla/);

    // The draft is in, so the page leaves without the browser's unsaved-changes prompt.
    await recovery.getByRole("button", { name: "Reload Sonobe" }).click();
    await waitForPrototype(page);
    expect(dialogs).toEqual([]);
    const welcome = page.getByRole("dialog", { name: "Welcome to Sonobe" });
    await expect(welcome).toBeVisible();
    const row = welcome.getByRole("region", { name: "Recovered" }).getByRole("listitem").filter({ hasText: "Untitled" });
    await expect(row).toContainText("2 layers");
    await row.getByRole("button", { name: "Open Untitled" }).click();
    await expect(welcome).toBeHidden();
    expect(await hook(page, (s) => s.doc().components[s.doc().project.root]!.layers.map((l) => l.name).sort())).toEqual(["Badge", "Hero Card"]);
  });

  test("says there was nothing unsaved when nothing was, and reports an issue with the error filled in", async ({ page, context }) => {
    await openEditor(page);
    expect(await hook(page, (s) => s.session.document.getState().dirty)).toBe(false);
    await hook(page, (s) => s.failRender("Sonobe"));
    const recovery = page.locator(".sb-recovery");
    await expect(recovery.locator(".sb-recovery__draft")).toHaveText("There were no unsaved changes.");

    await recovery.getByText("Error details").click();
    await expect(recovery.locator("pre")).toContainText("Error: Sonobe was asked to fail (window.__sonobe.failRender).");

    // The issue page itself isn't loaded: the link is what Sonobe owns.
    await context.route("https://github.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>New issue</title>" }));
    const [issue] = await Promise.all([context.waitForEvent("page"), recovery.getByRole("button", { name: "Report an Issue…" }).click()]);
    const url = decodeURIComponent(issue.url());
    expect(url).toContain("github.com/thats2easyyy/sonobe/issues/new");
    expect(url).toContain("Error: Sonobe was asked to fail (window.__sonobe.failRender).");
    expect(url).toMatch(/Sonobe 0\.1\.0 · browser/);
  });
});

test.describe("when the recovery screen can't draw either", () => {
  test("the last resort stays in the window, with both errors and a Reload that brings the editor back", async ({ page }) => {
    await openEditor(page);
    // React empties its container again after an error nothing caught: the last resort has to outlast that.
    await hook(page, (s) => {
      s.failRender("The recovery screen");
      s.failRender("Sonobe");
    });
    const screen = page.locator(".sb-recovery");
    await expect(screen).toContainText("The editor stopped and couldn't show its recovery screen.");
    await expect(screen.locator("pre")).toContainText("Error: Sonobe was asked to fail (window.__sonobe.failRender).");
    await expect(screen.locator("pre")).toContainText("Error: The recovery screen was asked to fail (window.__sonobe.failRender).");
    // Still there once React has had every chance to clear the page.
    await page.waitForTimeout(500);
    await expect(screen.getByRole("heading", { name: "Sonobe hit a problem" })).toBeVisible();
    await expect(page.locator(".sb-app")).toHaveCount(0);

    await screen.getByRole("button", { name: "Reload Sonobe" }).click();
    await waitForPrototype(page);
    await expect(page.locator(".sb-recovery")).toHaveCount(0);
    await expect(page.locator(".sb-app")).toBeVisible();
  });
});

test.describe("when the editor's code can't start", () => {
  // The dev server names the startup script with a timestamp after "?".
  const MAIN = /\/src\/main\.tsx(\?|$)/;

  test("the page says so instead of staying blank, and Reload starts the editor once it can", async ({ page }) => {
    // A startup script that throws before anything mounts.
    await page.route(MAIN, (route) => route.fulfill({ contentType: "text/javascript", body: 'throw new Error("no start");' }));
    await page.goto("/");
    const screen = page.locator('#root [role="alert"]');
    await expect(screen.getByRole("heading", { name: "Sonobe couldn’t start" })).toBeVisible();
    await expect(screen).toContainText("The editor’s code didn’t load, or stopped while starting. Reload to try again.");
    await expect(screen.locator("pre")).toContainText("Error: no start");

    // One that doesn't load at all.
    await page.unroute(MAIN);
    await page.route(MAIN, (route) => route.abort());
    await page.reload();
    await expect(screen.locator("pre")).toContainText(/Couldn't load http:\/\/localhost:\d+\/src\/main\.tsx/);

    await page.unroute(MAIN);
    await skipWelcome(page);
    await screen.getByRole("button", { name: "Reload Sonobe" }).click();
    await waitForPrototype(page);
    await expect(page.locator(".sb-app")).toBeVisible();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });
});

test.describe("when one part of the editor can't draw", () => {
  const layerRow = (page: Page, name: string) => page.locator(".sb-layerspanel .sb-tree__row", { has: page.locator(".sb-tree__label", { hasText: new RegExp(`^${name}$`) }) });
  const layerNames = (page: Page) => hook(page, (s) => s.doc().components[s.doc().project.root]!.layers.map((l) => l.name));

  test("the Inspector says so in its own place, and selecting, undo, Save and the console still work", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const mod = await modKey(page);
    const names = await layerNames(page);
    const [first, second] = [names[0]!, names[1]!];
    await layerRow(page, first).click();
    const inspector = page.locator("#sb-inspector");
    await expect(inspector.locator(".sb-insp-row").first()).toBeVisible();

    // The console row shows when it was logged: a fixed time of day, so the screenshot is the same on every run.
    await page.clock.setFixedTime(new Date(2026, 0, 1, 10, 0, 0));
    await hook(page, (s) => s.failRender("The Inspector"));
    await expect(inspector.locator(".sb-surface-problem")).toContainText("The Inspector hit a problem");
    await expect(inspector.locator(".sb-surface-problem")).toContainText("The rest of Sonobe still works.");
    await expect(inspector.locator(".sb-panel__title")).toHaveText("Inspector");
    await expect(page.locator(".sb-recovery")).toHaveCount(0);

    // The console opened on the editor's error, as it does on a prototype's first: one line, from the editor.
    const hud = page.locator("#sb-hud");
    await expect(hud.getByRole("tab", { name: /^Console/ })).toHaveAttribute("aria-selected", "true");
    await expect(hud.locator(".sb-logrow")).toHaveCount(1);
    await expect(hud.locator(".sb-logrow")).toContainText("Editor");
    await expect(hud.locator(".sb-logrow")).toContainText("The Inspector hit a problem and stopped drawing. If it keeps happening, save your work and restart Sonobe, or use Help → Report an Issue.");
    await page.waitForTimeout(250);
    await screenshot(page, "resilience-02-panel-problem");

    // The document, the selection and the commands live outside the panel that failed.
    await layerRow(page, second).click();
    expect(await hook(page, (s) => s.selection().layers.length)).toBe(1);
    await page.keyboard.press("Backspace");
    expect(await layerNames(page)).not.toContain(second);
    await page.keyboard.press(`${mod}+z`);
    expect(await layerNames(page)).toEqual(names);

    await hook(page, (s) => s.apply([{ op: "setProject", changes: { name: "Still Works" } }], "Rename"));
    await blurFields(page);
    await page.keyboard.press(`${mod}+s`);
    const saveDialog = page.getByRole("dialog", { name: "Save prototype" });
    await saveDialog.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => hook(page, (s) => s.session.document.getState().projectPath)).toBe("browser:Still Works");
    expect(await hook(page, (s) => s.session.document.getState().dirty)).toBe(false);

    // Try again while it still fails shows the problem again; once it can draw, the Inspector is back.
    await inspector.getByRole("button", { name: "Try again" }).click();
    await expect(inspector.locator(".sb-surface-problem")).toBeVisible();
    await hook(page, (s) => s.failRender("The Inspector", false));
    await inspector.getByRole("button", { name: "Try again" }).click();
    await expect(inspector.locator(".sb-surface-problem")).toHaveCount(0);
    await expect(inspector.locator(".sb-insp")).toBeVisible();
    // What the console printed is the forced error, twice, and nothing else.
    expect(problems.filter((line) => !line.includes("[sonobe] The Inspector hit a problem."))).toEqual([]);
    expect(problems).toHaveLength(2);
  });

  test("every panel, tab and drawer is contained, and a dialog that can't draw closes", async ({ page }) => {
    await openEditor(page);
    const mod = await modKey(page);
    const problem = page.locator(".sb-surface-problem");

    /** Fail one part, expect its problem in its place and nowhere else, then let it draw again. */
    const contained = async (name: string, place: string, stays?: string) => {
      await hook(page, (s, n) => s.failRender(n), name);
      await expect(page.locator(place).locator(".sb-surface-problem"), name).toContainText(`${name} hit a problem`);
      await expect(problem, name).toHaveCount(1);
      await expect(page.locator(".sb-toolbar"), name).toBeVisible();
      if (stays) await expect(page.locator(stays), name).toBeVisible();
      await hook(page, (s, n) => s.failRender(n, false), name);
      await problem.getByRole("button", { name: "Try again" }).click();
      await expect(problem, name).toHaveCount(0);
    };

    await contained("Layers", "#sb-layers", "#sb-inspector .sb-insp");
    await contained("The Viewer", "#sb-viewer", "#sb-layers .sb-tree__row >> nth=0");
    await contained("The canvas", ".sb-shell__canvas", ".sb-pe .react-flow__node >> nth=0");
    await contained("The Patches panel", ".sb-shell__patches", ".sb-cv");
    // The patch editor's own boundary is inside its panel: the header with the breadcrumbs stays.
    await contained("The patch editor", ".sb-shell__patches", ".sb-app-patches .sb-panel__header");
    await contained("The Inspector", "#sb-inspector", "#sb-layers .sb-tree__row >> nth=0");
    await contained("The Properties tab", "#sb-inspector", '#sb-inspector .sb-panel__header [role="tab"] >> nth=0');
    // The first failure opened the bottom panel on its Console tab.
    await contained("The Console tab", "#sb-hud", "#sb-hud .sb-hudx__bar");
    await contained("The bottom panel", "#sb-hud", "#sb-inspector .sb-insp");

    await hook(page, (s) => s.layout().setDrawer("learn"));
    await expect(page.locator(".sb-drawer")).toBeVisible();
    await contained("Learn", ".sb-drawer", "#sb-layers .sb-tree__row >> nth=0");
    await hook(page, (s) => s.layout().setDrawer(null));

    // The Assistant's sheet keeps its header when the chat can't be drawn.
    await blurFields(page);
    await page.keyboard.press(`${mod}+6`);
    await expect(page.locator(".sb-assistant-sheet")).toBeVisible();
    await contained("The chat", ".sb-assistant-sheet", '.sb-assistant-sheet button[aria-label="Close Assistant"]');
    await page.locator('.sb-assistant-sheet button[aria-label="Close Assistant"]').click();

    // A dialog has no place of its own: it closes with a toast, and opens again once it can draw.
    await hook(page, (s) => s.failRender("Settings"));
    await blurFields(page);
    await page.keyboard.press(`${mod}+,`);
    await expect(page.locator(".sb-toast__title", { hasText: "Settings hit a problem" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    await expect(problem).toHaveCount(0);
    await hook(page, (s) => s.failRender("Settings", false));
    await page.keyboard.press(`${mod}+,`);
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });
});

test.describe("when a part's code can't load", () => {
  test("it says so in its place, and the console gets a line as for a part that threw", async ({ page }) => {
    await page.route(/\/src\/panels\/learn\/LearnDrawer\.tsx/, (route) => route.abort());
    await openEditor(page);
    await hook(page, (s) => s.layout().setDrawer("learn"));
    const problem = page.locator(".sb-drawer .sb-surface-problem");
    await expect(problem).toContainText("Learn didn't load");
    await expect(problem).toContainText("Restart Sonobe to try again.");
    await expect(page.locator(".sb-toolbar")).toBeVisible();

    const hud = page.locator("#sb-hud");
    await expect(hud.getByRole("tab", { name: /^Console/ })).toHaveAttribute("aria-selected", "true");
    await expect(hud.locator(".sb-logrow")).toHaveCount(1);
    await expect(hud.locator(".sb-logrow")).toContainText("Something in the editor failed. If it keeps happening, save your work and restart Sonobe, or use Help → Report an Issue. (Error: Learn didn't load.");
  });
});

test.describe("a prototype's own errors", () => {
  test("stay the prototype's: a script that throws is a diagnostic on its patch, and no part of the editor fails", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const source = `export const outputs = [{ key: "value", type: "number" }];\nexport function evaluate(patch) {\n  throw new Error("too big");\n}`;
    const result = await hook(
      page,
      (s, script) =>
        s.apply(
          [
            { op: "setScript", file: "boom.js", source: script },
            { op: "addPatch", patch: { id: "boom", type: "javascript", settings: { script: "boom.js" }, ui: { x: 40, y: 600 } } },
          ],
          "Add a script that throws",
        ),
      source,
    );
    expect(result.ok).toBe(true);

    await expect.poll(() => hook(page, (s) => s.session.runtime.state.getState().diagnostics.filter((d) => d.code === "script_error").map((d) => d.message))).toEqual(["scripts/boom.js:3:3 Error: too big"]);
    // The HUD opens on the prototype's error, as before, and the editor reports none of its own.
    await expect(page.locator("#sb-hud")).not.toHaveAttribute("data-collapsed", /.*/);
    await expect(page.locator(".sb-surface-problem, .sb-recovery")).toHaveCount(0);
    expect(await hook(page, (s) => s.session.console.getState().entries.filter((entry) => entry.source === "editor"))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
