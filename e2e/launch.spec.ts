import { expect, test } from "@playwright/test";
import { installFakeLaunch, launchSeen } from "./fakeLaunch.ts";
import { blurFields, collectConsoleProblems, hook, modKey, openEditor, waitForPrototype, WELCOME_SEEN_KEY } from "./helpers.ts";

test.describe("a window opened for a prototype", () => {
  test("starts on it: its name is the only one the toolbar shows, and the welcome screen never appears", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    await hook(page, (s) => s.apply([{ op: "setProject", changes: { name: "Checkout Flow" } }], "Rename"));
    expect(await hook(page, (s) => s.session.document.getState().saveTo("browser:Checkout Flow").then((result) => result.ok))).toBe(true);

    // A first launch, made by opening the prototype: nobody has seen the welcome screen yet.
    await page.evaluate((key) => localStorage.removeItem(key), WELCOME_SEEN_KEY);
    await installFakeLaunch(page, { open: { kind: "project", path: "browser:Checkout Flow" } });
    await page.reload();
    await waitForPrototype(page);
    expect(await hook(page, (s) => ({ name: s.doc().project.name, path: s.session.document.getState().projectPath, dirty: s.session.document.getState().dirty }))).toEqual({ name: "Checkout Flow", path: "browser:Checkout Flow", dirty: false });
    await expect(page.locator("#sb-layers").getByText("Event Card", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".sb-pe .react-flow__node").first()).toBeVisible();
    // Long enough for a welcome screen that was only late (it loads on demand) to have shown.
    await page.waitForTimeout(600);
    const seen = await launchSeen(page);
    expect(seen.titles).toEqual(["Checkout Flow"]);
    expect(seen.welcome).toBe(false);
    // It still counts as unseen, so the next plain launch shows it.
    expect(await page.evaluate((key) => localStorage.getItem(key), WELCOME_SEEN_KEY)).toBeNull();
    expect(problems).toEqual([]);
  });

  test("renders nothing until the app has said what to open", async ({ page }) => {
    await openEditor(page);
    await hook(page, (s) => s.apply([{ op: "setProject", changes: { name: "Slow Share" } }], "Rename"));
    expect(await hook(page, (s) => s.session.document.getState().saveTo("browser:Slow Share").then((result) => result.ok))).toBe(true);
    await installFakeLaunch(page, { open: { kind: "project", path: "browser:Slow Share" } }, { delayMs: 300 });
    await page.reload();
    await waitForPrototype(page);
    const seen = await launchSeen(page);
    expect(seen.answeredAt).not.toBeNull();
    expect(seen.renderedAt!).toBeGreaterThan(seen.answeredAt!);
    expect(seen.titles).toEqual(["Slow Share"]);
  });

  test("says what it couldn't open over the demo, and still offers recovered work", async ({ page }) => {
    // The unsaved-changes warning on reload: go ahead, the draft has the work.
    page.on("dialog", (dialog) => void dialog.accept());
    await openEditor(page);
    const mod = await modKey(page);
    await blurFields(page);
    await page.keyboard.press(`${mod}+n`);
    const start = page.getByRole("dialog", { name: "Start something new" });
    await start.getByRole("button", { name: "Create" }).click();
    await expect(start).toBeHidden();
    await hook(page, (s) => s.session.document.getState().apply([{ op: "addLayer", layer: { id: "hero", type: "rectangle", name: "Hero Card" } }], { label: "Add Hero Card" }));
    await expect.poll(() => hook(page, (s) => s.session.drafts?.current()?.id ?? null)).not.toBeNull();

    // What the app sends for a folder that's gone, and for one whose files it then can't read.
    await installFakeLaunch(page, { open: { kind: "project", path: "browser:Moved Away" }, problems: [{ path: "/Volumes/Work/Old Flow.sonobe", reason: "missing" }] });
    await page.reload();
    await waitForPrototype(page);
    expect((await launchSeen(page)).titles).toEqual(["Photo Zoom"]);
    const unreadable = page.locator(".sb-toast", { hasText: "Couldn't open “Moved Away”" });
    await expect(unreadable).toBeVisible();
    await expect(page.locator(".sb-toast", { hasText: "“Old Flow” isn't there right now" })).toContainText("It may have moved or been deleted, or be on a drive or share that isn't connected.");

    // The draft a crash left is still offered: the launch put the demo in, and nothing has touched it since.
    const welcome = page.getByRole("dialog", { name: "Welcome to Sonobe" });
    await expect(welcome.getByRole("region", { name: "Recovered" }).getByRole("listitem").filter({ hasText: "Untitled" })).toBeVisible();
    await welcome.getByRole("button", { name: "Close", exact: true }).click();
    await expect(welcome).toBeHidden();

    // The notices stay until they're dismissed, and the editor underneath works.
    await page.waitForTimeout(1200);
    await expect(unreadable).toBeVisible();
    await page.locator("#sb-layers").getByText("Event Card", { exact: true }).first().click();
    await expect.poll(() => hook(page, (s) => s.selection().layers.length)).toBe(1);
    expect(await hook(page, (s) => s.session.document.getState().dirty)).toBe(false);
  });

  test("opens again after a restart for an update with no welcome screen and no Recovered offer", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    await openEditor(page);
    await hook(page, (s) => s.apply([{ op: "setProject", changes: { name: "Checkout Flow" } }], "Rename"));
    expect(await hook(page, (s) => s.session.document.getState().saveTo("browser:Checkout Flow").then((result) => result.ok))).toBe(true);
    await hook(page, (s) => s.session.document.getState().apply([{ op: "addLayer", layer: { id: "badge", type: "oval", name: "Unsaved Badge" } }], { label: "Add Unsaved Badge" }));
    const draft = await expect
      .poll(() => hook(page, (s) => s.session.drafts?.current()?.id ?? null))
      .not.toBeNull()
      .then(() => hook(page, (s) => s.session.drafts!.current()!.id));

    // Nobody has seen the welcome screen, so a plain launch would show it. This window doesn't.
    await page.evaluate((key) => localStorage.removeItem(key), WELCOME_SEEN_KEY);
    await installFakeLaunch(page, { reopening: true, open: { kind: "draft", id: draft, project: "browser:Checkout Flow" } });
    await page.reload();
    await waitForPrototype(page);
    expect(await hook(page, (s) => ({ path: s.session.document.getState().projectPath, dirty: s.session.document.getState().dirty, draft: s.session.drafts?.current()?.id ?? null }))).toEqual({ path: "browser:Checkout Flow", dirty: true, draft });
    await expect(page.locator("#sb-layers").getByText("Unsaved Badge", { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(600);
    const seen = await launchSeen(page);
    expect(seen.titles).toEqual(["Checkout Flow"]);
    expect(seen.welcome).toBe(false);
  });
});

test("the browser editor, with no app to ask, starts on the demo as before", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await openEditor(page);
  expect(await page.evaluate(() => window.__sonobeFakeLaunch)).toBeUndefined();
  await expect(page.getByRole("button", { name: /Photo Zoom/ })).toBeVisible();
  expect(await hook(page, (s) => ({ path: s.session.document.getState().projectPath, changed: s.session.document.getState().lastChange !== null }))).toEqual({ path: null, changed: false });
  expect(problems).toEqual([]);
});
