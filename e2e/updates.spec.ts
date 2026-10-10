/**
 * Updates in the editor, against a fake of the desktop app's `sonobeHost.updates` (e2e/fakeUpdates.ts):
 * the notices for a version that's ready or available, a cancelled restart, a failure with what to do,
 * the answer to Check for Updates…, "Sonobe was updated", and the line in About and the switch in
 * Settings. No feed, no network, and nothing is installed.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { fakeOpened, fakeUpdateCalls, fakeUpdateStatus, installFakeUpdates, pushFakeUpdate } from "./fakeUpdates.ts";
import { collectConsoleProblems, openEditor, runCommand, screenshot } from "./helpers.ts";

const notice = (page: Page, title: string | RegExp): Locator => page.locator(".sb-toast").filter({ has: page.locator(".sb-toast__title", { hasText: title }) });
const BUILT_LOCALLY = "This copy of Sonobe was built locally, so it can't replace itself. Download the new version instead.";

test.describe("updates", () => {
  test("a downloaded update says it's ready, and a cancelled restart brings the notice back", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeUpdates(page, { status: { state: "downloading", version: "0.2.0", progress: 0.4 } });
    await openEditor(page);

    // An automatic download says nothing until there's something to do.
    await page.waitForTimeout(300);
    await expect(page.locator(".sb-toast")).toHaveCount(0);

    await pushFakeUpdate(page, { state: "ready", progress: null });
    const ready = notice(page, "Sonobe 0.2.0 is ready");
    await expect(ready).toBeVisible();
    await expect(ready).toContainText("opens what you had open again");
    await page.waitForTimeout(250);
    await screenshot(page, "updates-01-ready");

    // The app closes windows through the unsaved-changes prompt; the person cancels there, and the update stays ready.
    await ready.getByRole("button", { name: "Restart to Update" }).click();
    await expect.poll(() => fakeUpdateCalls(page)).toEqual(["restart"]);
    // The fake cancels a moment after it is asked, and the cancel is what brings the notice back: wait for it,
    // or the ✕ below can land on the notice that is closing and the cancel then shows it again.
    await expect.poll(async () => (await fakeUpdateStatus(page))?.restarting).toBe(false);
    await expect(ready).toHaveAttribute("data-state", "open");

    // Closed with its ✕, it stays closed: the same status again says nothing.
    await ready.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(ready).toBeHidden();
    await pushFakeUpdate(page, { progress: null });
    await page.waitForTimeout(300);
    await expect(ready).toBeHidden();

    // Check for Updates… is answered every time: with the update already ready, the answer is the notice again.
    await runCommand(page, "Check for Updates");
    await expect(ready).toBeVisible();
    await ready.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(ready).toBeHidden();
    await runCommand(page, "Check for Updates");
    await expect(ready).toBeVisible();
    expect(await fakeUpdateCalls(page)).toEqual(["restart", "check", "check"]);
    expect(problems).toEqual([]);
  });

  test("a copy that can't install says a version is available, and Download opens its release page", async ({ page }) => {
    await installFakeUpdates(page, { status: { mode: "notify", reason: BUILT_LOCALLY } });
    await openEditor(page);
    await pushFakeUpdate(page, { state: "checking" });
    await pushFakeUpdate(page, { state: "available", version: "0.2.0", releaseUrl: "https://github.com/thats2easyyy/sonobe/releases/tag/v0.2.0" });
    const available = notice(page, "Sonobe 0.2.0 is available");
    await expect(available).toContainText(BUILT_LOCALLY);
    await available.getByRole("button", { name: "Download" }).click();
    expect(await fakeOpened(page)).toEqual(["https://github.com/thats2easyyy/sonobe/releases/tag/v0.2.0"]);
  });

  test("Check for Updates… answers when nothing is new, and a failure says what to do", async ({ page }) => {
    await installFakeUpdates(page, { status: { state: "upToDate" } });
    await openEditor(page);
    await runCommand(page, "Check for Updates");
    await expect(notice(page, "Sonobe is up to date")).toContainText("Version 0.1.0 is the newest.");
    expect(await fakeUpdateCalls(page)).toEqual(["check"]);

    // An automatic check that fails keeps to itself, whether it lacked a connection or the feed answered with an error.
    await pushFakeUpdate(page, { state: "checking", manual: false });
    await pushFakeUpdate(page, { state: "failed", error: { kind: "network", phase: "check", message: "Sonobe couldn't reach the release feed to check for updates.", hint: "Check your internet connection, then choose Check for Updates again." } });
    await pushFakeUpdate(page, { state: "checking", error: null });
    await pushFakeUpdate(page, { state: "failed", error: { kind: "other", phase: "check", message: "Sonobe couldn't check for updates.", hint: "Try again later, or look at the release page for the newest version. (The updater said: 503 Service Unavailable)" } });
    await page.waitForTimeout(300);
    await expect(notice(page, /couldn't/)).toHaveCount(0);

    // A download macOS refuses to install is said, with the way out.
    await pushFakeUpdate(page, { state: "downloading", version: "0.2.0", progress: 1, error: null });
    await pushFakeUpdate(page, {
      state: "failed",
      error: { kind: "rejected", phase: "download", message: "macOS wouldn't install the update: its signature doesn't match this copy of Sonobe.", hint: "Download the new version from the release page and replace Sonobe in your Applications folder." },
      releaseUrl: "https://github.com/thats2easyyy/sonobe/releases/tag/v0.2.0",
    });
    const failed = notice(page, "macOS wouldn't install the update");
    await expect(failed).toContainText("Download the new version from the release page");
    await expect(failed).toHaveAttribute("role", "alert");
    await failed.getByRole("button", { name: "Open release page" }).click();
    expect(await fakeOpened(page)).toEqual(["https://github.com/thats2easyyy/sonobe/releases/tag/v0.2.0"]);
  });

  test("the first launch of a newer version says so once, with its release notes", async ({ page }) => {
    await installFakeUpdates(page, { status: { current: "0.2.0", updatedFrom: "0.1.0", notesUrl: "https://github.com/thats2easyyy/sonobe/releases/tag/v0.2.0" } });
    await openEditor(page);
    const updated = notice(page, "Sonobe was updated to 0.2.0");
    await expect(updated).toBeVisible();
    await pushFakeUpdate(page, { state: "checking" });
    await pushFakeUpdate(page, { state: "upToDate" });
    // The app reports it until one window has heard it: the notice and its link outlive that.
    await pushFakeUpdate(page, { updatedFrom: null, notesUrl: null });
    await expect(page.locator(".sb-toast")).toHaveCount(1);
    await updated.getByRole("button", { name: "Release notes" }).click();
    expect(await fakeOpened(page)).toEqual(["https://github.com/thats2easyyy/sonobe/releases/tag/v0.2.0"]);
  });

  test("About shows where this copy stands, and Settings has the switch for automatic checks", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeUpdates(page, { status: { state: "upToDate" }, found: { state: "ready", version: "0.2.0" }, restart: "restart" });
    await openEditor(page);

    await runCommand(page, "About Sonobe");
    const about = page.getByRole("dialog", { name: "Sonobe" });
    const line = about.locator(".sb-update-line");
    await expect(line).toContainText("Sonobe is up to date.");
    await pushFakeUpdate(page, { state: "downloading", version: "0.2.0", progress: 0.42 });
    await expect(line).toContainText("Downloading Sonobe 0.2.0… 42%");
    await expect(line.getByRole("button")).toHaveCount(0);
    await pushFakeUpdate(page, { state: "ready", progress: null });
    await expect(line).toContainText("Sonobe 0.2.0 is ready to install.");
    await line.getByRole("button", { name: "Restart to Update" }).click();
    await expect.poll(() => fakeUpdateCalls(page)).toEqual(["restart"]);
    await page.keyboard.press("Escape");
    await expect(about).toBeHidden();

    await runCommand(page, "Settings");
    const settings = page.getByRole("dialog", { name: "Settings" });
    const updates = settings.getByRole("region", { name: "Updates" });
    await expect(updates).toContainText("Asks GitHub for the newest version. Nothing about you or your prototypes is sent.");
    const toggle = updates.getByRole("switch", { name: "Check for updates automatically" });
    await expect(toggle).toBeChecked();
    await toggle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await screenshot(page, "updates-02-settings");
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(await fakeUpdateCalls(page)).toEqual(["restart", "autoCheck:false"]);
    expect(problems).toEqual([]);
  });

  test("the browser editor, and a copy that never checks, show nothing about updates", async ({ page }) => {
    await installFakeUpdates(page, { status: { mode: "off", reason: "Sonobe run from a checkout doesn't check for updates. Pull the repository instead." } });
    await openEditor(page);
    await pushFakeUpdate(page, { state: "ready", version: "0.2.0" });
    await page.waitForTimeout(300);
    await expect(page.locator(".sb-toast")).toHaveCount(0);
    await runCommand(page, "About Sonobe");
    await expect(page.getByRole("dialog", { name: "Sonobe" })).toBeVisible();
    await expect(page.locator(".sb-update-line")).toHaveCount(0);
  });
});
