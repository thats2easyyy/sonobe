/**
 * The live design preview's shell (apps/editor/src/panels/design/previewShell.ts) in Chromium, in a
 * sandboxed frame as the canvas makes it. The CDN script it allows is routed to a stand-in, so this
 * needs no network and pins the timing the real script has.
 */

import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_MESSAGE_TYPE, previewShellHtml } from "../apps/editor/src/panels/design/previewShell.ts";
import { collectConsoleProblems } from "./helpers.ts";

const NONCE = "5f0c2a9e7b1d4c36";

/** Stands in for Tailwind's v3 Play CDN (cdn.tailwindcss.com): like it, it styles what changes in the document after it runs, never what's already there. */
const TAILWIND_V3 = `(() => {
  const style = document.createElement("style");
  document.head.appendChild(style);
  const build = () => {
    const css = document.querySelector(".p-8") ? ".p-8{padding:2rem}" : "";
    if (style.textContent !== css) style.textContent = css;
  };
  new MutationObserver(build).observe(document.documentElement, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
  window.tailwind = {};
})();`;

/** A page with the shell in a frame sandboxed as DesignPreview's is. */
async function openShell(page: Page): Promise<void> {
  await page.setContent('<iframe title="Design preview" sandbox="allow-scripts" style="width:402px;height:300px"></iframe>');
  await page.locator("iframe").evaluate((frame: HTMLIFrameElement, srcdoc) => new Promise<void>((resolve) => ((frame.onload = () => resolve()), (frame.srcdoc = srcdoc))), previewShellHtml(NONCE));
}

/** What the canvas posts into the frame. */
const post = (page: Page, html: string) => page.locator("iframe").evaluate((frame: HTMLIFrameElement, message) => frame.contentWindow!.postMessage(message, "*"), { type: PREVIEW_MESSAGE_TYPE, nonce: NONCE, html });

test.describe("The design preview's shell", () => {
  test("styles a Tailwind v3 page that arrives in one post", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.route((url) => url.hostname === "cdn.tailwindcss.com", (route) => route.fulfill({ contentType: "text/javascript", body: TAILWIND_V3 }));
    await openShell(page);
    // One preview_design call with the whole page, or the Assistant's html in a single done event.
    await post(page, '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><p class="p-8">Checkout</p></body></html>');
    const text = page.frameLocator("iframe").locator("p");
    await expect(text).toHaveText("Checkout");
    await expect.poll(() => text.evaluate((el) => getComputedStyle(el).paddingTop)).toBe("32px");
    expect(problems).toEqual([]);
  });
});
