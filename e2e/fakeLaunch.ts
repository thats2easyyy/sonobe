/**
 * What the desktop app tells a window it opened for something (`sonobeHost.launching` and `launch()`), faked
 * for Playwright. The editor's getLaunchHost() reads `window.__sonobeFakeLaunch` under Vite's DEV only, and
 * `window.sonobeHost` stays unset, so the rest of the editor stays in browser mode: the project a launch
 * names is one saved in browser storage ("browser:<name>"). The answer has the shape the main process
 * sends (apps/desktop/electron/launch.ts).
 *
 * It also notes what a person would see from the first frame on: every prototype name the toolbar showed,
 * whether the welcome screen ever appeared, and when the editor first rendered.
 */

import type { Page } from "@playwright/test";
import type { LaunchInfo } from "../apps/editor/src/app/launch.ts";

export interface FakeLaunchOptions {
  /** How long the app takes to answer. Default: at once, as the preload's early call makes it. */
  delayMs?: number;
}

/** What the page showed since it loaded. */
export interface LaunchSeen {
  /** Prototype names in the toolbar, in order, without repeats. */
  titles: string[];
  welcome: boolean;
  /** performance.now() when the app answered and when the editor first rendered; null before. */
  answeredAt: number | null;
  renderedAt: number | null;
}

declare global {
  interface Window {
    __sonobeFakeLaunch?: unknown;
    __launchSeen?: LaunchSeen;
  }
}

/** Define window.__sonobeFakeLaunch before the app loads, on every load from now on (call before the page opens or reloads). */
export async function installFakeLaunch(page: Page, info: Partial<LaunchInfo>, options: FakeLaunchOptions = {}): Promise<void> {
  await page.addInitScript(fakeLaunch, { info: { reopening: false, open: null, problems: [], ...info }, delayMs: options.delayMs ?? 0 });
}

export const launchSeen = (page: Page): Promise<LaunchSeen> => page.evaluate(() => window.__launchSeen!);

/** Runs in the page before the app's scripts, so it uses nothing from this module but its argument. */
function fakeLaunch({ info, delayMs }: { info: LaunchInfo; delayMs: number }): void {
  const seen: LaunchSeen = (window.__launchSeen = { titles: [], welcome: false, answeredAt: null, renderedAt: null });
  new MutationObserver(() => {
    if (seen.renderedAt === null && document.querySelector(".sb-app")) seen.renderedAt = performance.now();
    const title = (document.querySelector(".sb-toolbar__doc-title")?.textContent ?? "").trim();
    if (title && seen.titles[seen.titles.length - 1] !== title) seen.titles.push(title);
    if (document.querySelector(".sb-welcome")) seen.welcome = true;
  }).observe(document, { childList: true, subtree: true, characterData: true });
  window.__sonobeFakeLaunch = {
    launching: true,
    launch: async () => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      seen.answeredAt = performance.now();
      return info;
    },
  };
}
