/**
 * Error containment (ARCHITECTURE §9): the editor is never a blank window. A render error is forced
 * through the test hook's `failRender(name)`, which makes the boundary with that name catch an error
 * the way a broken component inside it would.
 */

import { expect, test } from "@playwright/test";
import { blurFields, collectConsoleProblems, hook, modKey, openEditor, screenshot, waitForPrototype } from "./helpers.ts";

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
    await hook(page, (s) => s.apply([{ op: "addLayer", layer: { id: "badge", type: "oval", name: "Badge" } }], "Add Badge"));
    expect(await hook(page, (s) => s.session.drafts?.pending())).toBe(true);

    // The hook goes away with the editor, so this is the last call through it until the reload.
    await hook(page, (s) => s.failRender("Sonobe"));
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
