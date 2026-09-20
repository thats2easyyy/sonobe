/**
 * The Assistant on the person's Claude subscription (experimental, off by default, awaiting Anthropic's
 * permission), against the fake Assistant (e2e/fakeAssistant.ts): the Settings switch, the setup, the
 * canvas box drawing through the Assistant's own preview_design drafts, a permission card, and what
 * the box and the setup say when Claude isn't signed in or its adapter isn't installed. No Claude
 * account, API key or network.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { fakeConfirms, fakeConnectionCalls, fakeSignIns, installFakeAssistant, releaseFakeGate } from "./fakeAssistant.ts";
import { collectConsoleProblems, hook, openEditor, runCommand, screenshot } from "./helpers.ts";

const ON = { subscriptionEnabled: true, provider: "subscription" as const };
const SIGNED_OUT = "Claude isn't signed in on this computer. Choose Sign in (it opens Terminal), or run claude auth login in Terminal, then send your message again.";
const NOT_INSTALLED = "Sonobe couldn't find Claude's agent adapter. It needs Node.js 22 or later: in Terminal, run npm install -g @agentclientprotocol/claude-agent-acp, then try again.";

/** A checkout page in the pieces the fake sends with preview_design: the head and header, the order, the pay bar. */
const CHECKOUT_PARTS = [
  [
    "<!doctype html><html><head><style>",
    "body{margin:0;font-family:system-ui,sans-serif;color:#111118;background:#fff}",
    "header{padding:64px 20px 12px}h1{margin:0;font-size:34px}header p{margin:4px 0 0;color:#6B6B78;font-size:15px}",
    ".item{display:flex;gap:12px;margin:0 20px;padding:14px 0;border-bottom:1px solid #ECECF1}.item b{display:block;font-size:17px}.price{margin-left:auto;font-weight:600}",
    ".pay{position:fixed;left:20px;right:20px;bottom:34px;padding:16px;border-radius:14px;background:#111118;color:#fff;text-align:center;font-size:17px;font-weight:600}",
    '</style></head><body><header data-name="Header"><h1 data-name="Title">Checkout</h1><p data-name="Subtitle">2 tickets · Sunset Picnic</p></header>',
  ].join(""),
  [
    '<div class="item" data-name="Ticket"><div><b data-name="Ticket Name">General admission</b><span>Sat, June 14</span></div><div class="price">$36</div></div>',
    '<div class="item" data-name="Total"><div><b data-name="Promo Title">Promo code</b><span>SUMMER10 saves $3.60</span></div><div class="price">$32.40</div></div>',
  ].join(""),
  '<div class="pay" data-name="Pay Button">Pay $32.40 with Apple Pay</div></body></html>',
];
const CHECKOUT = CHECKOUT_PARTS.join("");

const designField = (page: Page): Locator => page.getByRole("textbox", { name: /^Describe a (screen for Claude|change to “.+”)$/ });
const designBox = (page: Page): Locator => page.locator(".sb-design-box");
const statusLine = (box: Locator, text: string | RegExp): Locator => box.getByRole("status").filter({ hasText: text });
const preview = (page: Page): Locator => page.locator("iframe[title='Design preview']");
const sheet = (page: Page): Locator => page.locator(".sb-assistant-sheet");
const screens = (page: Page) => hook(page, (s) => s.doc().components[s.doc().project.root]!.layers.map((l) => l.name));

async function openBox(page: Page): Promise<void> {
  await page.locator(".sb-cv__design").click();
  await expect(designField(page)).toBeFocused();
}

test.describe("The Assistant on your Claude subscription (experimental)", () => {
  test("the switch in Settings is off by default and says it awaits Anthropic's permission; on, the Assistant offers the subscription", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: CHECKOUT, hasKey: false });
    await openEditor(page);

    // Off: today's key setup, with no choice.
    await runCommand(page, "Assistant");
    await expect(sheet(page).getByText("Use your own Anthropic API key")).toBeVisible();
    await expect(sheet(page).getByRole("radio")).toHaveCount(0);

    await runCommand(page, "Settings");
    const settings = page.getByRole("dialog", { name: "Settings" });
    const toggle = settings.getByRole("switch", { name: "Use my Claude subscription in the Assistant" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(settings.getByText("Experimental · awaiting Anthropic's permission. Off by default and not part of any release until Anthropic agrees.", { exact: false })).toBeVisible();
    await toggle.scrollIntoViewIfNeeded();
    await screenshot(page, "subscription-01-settings");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await fakeConnectionCalls(page)).toEqual([{ subscriptionEnabled: true }]);
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();

    // On: the setup offers both, and picking the subscription reads the login.
    const subscription = sheet(page).getByRole("radio", { name: /Claude subscription/ });
    await expect(subscription).toContainText("Experimental");
    await expect(sheet(page).getByRole("radio", { name: "API key" })).toHaveAttribute("aria-checked", "true");
    await subscription.click();
    await expect(subscription).toHaveAttribute("aria-checked", "true");
    expect(await fakeConnectionCalls(page)).toEqual([{ subscriptionEnabled: true }, { provider: "subscription" }]);
    await expect(sheet(page).getByRole("heading", { name: "Use your Claude subscription" })).toBeVisible();
    await expect(sheet(page).getByText("Signed in · Claude Max · ava@example.com")).toBeVisible();
    await expect(sheet(page).getByText("Experimental: awaiting Anthropic's permission, so it's off by default and not in any release.")).toBeVisible();
    await screenshot(page, "subscription-02-setup");
    await sheet(page).getByRole("button", { name: "Use Claude subscription" }).click();
    await expect(sheet(page).getByText("What should we build?")).toBeVisible();
    await expect(sheet(page).locator(".sb-assistant__subtitle")).toHaveText("Claude subscription · Claude Max");
    expect(problems).toEqual([]);
  });

  test("the canvas box draws the screen from the Assistant's own preview_design drafts, then adds it", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: CHECKOUT, previewParts: CHECKOUT_PARTS, name: "Checkout", hold: 1, connection: ON });
    await openEditor(page);
    await openBox(page);
    const box = designBox(page);
    await designField(page).fill("a checkout screen");
    await designField(page).press("Enter");

    // Held after two preview_design calls: the canvas shows the page so far, as the Assistant's own reply.
    const frame = page.frameLocator("iframe[title='Design preview']");
    await expect(frame.getByText("General admission")).toBeVisible();
    await expect(frame.getByText("Pay $32.40 with Apple Pay")).toHaveCount(0);
    await expect(statusLine(box, "Writing “Checkout”")).toBeVisible();
    await expect(page.locator("[data-design-pill]")).toHaveText("Claude is writing “Checkout”");
    await expect(box.getByRole("button", { name: "Hide preview" })).toHaveCount(0);
    await screenshot(page, "subscription-03-drawing");

    await releaseFakeGate(page);
    await expect(statusLine(box, "Added “Checkout”.")).toBeVisible({ timeout: 30_000 });
    await expect(preview(page)).toBeHidden();
    expect(await screens(page)).toContain("Checkout");
    await expect(box.getByText("Added a checkout screen with Apple Pay and a promo code. Try “Make it interactive” next.")).toBeVisible();
    // The plan has no budget here: the box shows no meter.
    await expect(box.locator(".sb-assistant-usage")).toHaveCount(0);
    await screenshot(page, "subscription-04-added");
    expect(problems).toEqual([]);
  });

  test("a permission card in the chat shows Claude Code's choices, and Allow answers with its option", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: CHECKOUT, connection: ON, subscriptionReply: "permission" });
    await openEditor(page);
    await runCommand(page, "Assistant");
    const field = sheet(page).getByRole("textbox", { name: "Message the Assistant" });
    await field.fill("Save it when you're done");
    await field.press("Enter");

    const card = sheet(page).getByRole("alertdialog", { name: "Allow Claude to save this prototype?" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button")).toHaveText(["Allow", "Allow for this chat", "Don't allow"]);
    // Nothing is picked for you: focus is on the card, not a choice.
    await expect(card).toBeFocused();
    await screenshot(page, "subscription-05-permission");

    await card.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(sheet(page).getByText("Allowed", { exact: true })).toBeVisible();
    expect(await fakeConfirms(page)).toEqual([["perm-1", true, "allow-once"]]);
    await expect(sheet(page).getByText("Saved.", { exact: true })).toBeVisible();
    await expect(sheet(page).locator(".sb-assistant-usage__text")).toHaveText("22K tokens · your Claude plan");
    expect(problems).toEqual([]);
  });

  test("signed out, the box keeps the request and offers Sign in…", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: CHECKOUT, connection: ON, subscription: { state: "signed_out", kind: "none", label: "Not logged in", email: null, message: SIGNED_OUT } });
    await openEditor(page);
    await openBox(page);
    await designField(page).fill("a checkout screen");
    await designField(page).press("Enter");
    const notice = page.locator(".sb-design-box__notice");
    await expect(notice).toContainText(SIGNED_OUT);
    await expect(designField(page)).toHaveValue("a checkout screen");
    await expect(notice.getByRole("button").first()).toHaveText("Sign in…");
    await screenshot(page, "subscription-06-signed-out");
    await notice.getByRole("button", { name: "Sign in…" }).click();
    await expect(page.locator(".sb-toast", { hasText: "Sign in to Claude in Terminal" })).toContainText("When it's done, come back and send your message again.");
    expect(await fakeSignIns(page)).toBe(1);
    expect(problems).toEqual([]);
  });

  test("without Claude's agent adapter, the setup shows the command that installs it", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await installFakeAssistant(page, { html: CHECKOUT, connection: ON, subscription: { state: "not_installed", kind: null, label: null, email: null, adapterVersion: null, message: NOT_INSTALLED } });
    await openEditor(page);
    await runCommand(page, "Assistant");
    await expect(sheet(page).getByText("Install Claude's agent adapter (it needs Node.js 22 or later):")).toBeVisible();
    await expect(sheet(page).locator(".sb-assistant-sub__command code")).toHaveText("npm install -g @agentclientprotocol/claude-agent-acp");
    await screenshot(page, "subscription-07-not-installed");
    await sheet(page).getByRole("button", { name: "Copy" }).click();
    await expect(sheet(page).getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npm install -g @agentclientprotocol/claude-agent-acp");
    await expect(sheet(page).getByRole("button", { name: "Check again" })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
