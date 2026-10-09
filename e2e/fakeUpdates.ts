/**
 * A fake `sonobeHost.updates` for Playwright. The editor's getUpdatesHost() returns
 * `window.__sonobeFakeUpdates` under Vite's DEV only, and `window.sonobeHost` stays unset, so the rest of
 * the editor stays in browser mode (a release page opens through window.open, which the fake records).
 * The test moves the status with pushFakeUpdate, as the desktop app's main process would. Nothing here
 * checks a feed or touches the network.
 */

import type { Page } from "@playwright/test";
import type { UpdateStatus } from "../apps/editor/src/app/updates/updatesHost.ts";

export interface FakeUpdatesOptions {
  /** Where this copy stands when the editor opens. Default: an install build that hasn't checked yet. */
  status?: Partial<UpdateStatus>;
  /** What Check for Updates… finds. Default: nothing new. */
  found?: Partial<UpdateStatus>;
  /** What Restart to Update does: "cancel" (the person cancels at the unsaved-changes prompt) or "restart". Default "cancel". */
  restart?: "cancel" | "restart";
}

declare global {
  interface Window {
    __sonobeFakeUpdates?: unknown;
    /** What the editor asked for, oldest first: "check", "restart", "move", "autoCheck:false". */
    __fakeUpdateCalls?: string[];
    /** Addresses the page opened in the browser. */
    __fakeOpened?: string[];
    __pushFakeUpdate?: (patch: Partial<UpdateStatus>) => void;
  }
}

/** Define window.__sonobeFakeUpdates before the app loads (per page; call before openEditor). */
export async function installFakeUpdates(page: Page, options: FakeUpdatesOptions = {}): Promise<void> {
  await page.addInitScript(fakeUpdates, options);
}

/** Change the status and tell the editor, as the app does. */
export async function pushFakeUpdate(page: Page, patch: Partial<UpdateStatus>): Promise<void> {
  await page.evaluate((p) => window.__pushFakeUpdate?.(p), patch);
}

export const fakeUpdateCalls = (page: Page): Promise<string[]> => page.evaluate(() => window.__fakeUpdateCalls ?? []);

export const fakeOpened = (page: Page): Promise<string[]> => page.evaluate(() => window.__fakeOpened ?? []);

/** Runs in the page before the app's scripts, so it uses nothing from this module but its argument. */
function fakeUpdates(options: FakeUpdatesOptions): void {
  let status: UpdateStatus = {
    mode: "install",
    reason: null,
    state: "idle",
    current: "0.1.0",
    version: null,
    releaseUrl: "https://github.com/thats2easyyy/sonobe/releases/latest",
    notesUrl: null,
    progress: null,
    error: null,
    manual: false,
    asks: 0,
    autoCheck: true,
    updatedFrom: null,
    offerMove: false,
    canMove: false,
    restarting: false,
    ...options.status,
  };
  const subscribers = new Set<(status: UpdateStatus) => void>();
  const calls: string[] = (window.__fakeUpdateCalls = []);
  const opened: string[] = (window.__fakeOpened = []);
  const push = (patch: Partial<UpdateStatus>) => {
    status = { ...status, ...patch };
    for (const cb of [...subscribers]) cb(status);
    return status;
  };
  window.__pushFakeUpdate = (patch) => void push(patch);
  window.open = (url?: string | URL) => {
    opened.push(String(url));
    return null;
  };
  window.__sonobeFakeUpdates = {
    status: async () => status,
    check: async () => {
      calls.push("check");
      // As main does: an ask is counted, and while an update is downloading or ready that's all that changes.
      const asked = { manual: true, asks: status.asks + 1 };
      if (status.state === "downloading" || status.state === "ready") return push(asked);
      push({ ...asked, state: "checking", error: null });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return push({ state: "upToDate", ...options.found });
    },
    restart: async () => {
      calls.push("restart");
      if (options.restart === "restart") return true;
      push({ restarting: true });
      await new Promise((resolve) => setTimeout(resolve, 150));
      push({ restarting: false });
      return false;
    },
    setAutoCheck: async (enabled: boolean) => {
      calls.push(`autoCheck:${enabled}`);
      return push({ autoCheck: enabled });
    },
    moveToApplications: async () => {
      calls.push("move");
      return false;
    },
    onStatus: (cb: (status: UpdateStatus) => void) => {
      subscribers.add(cb);
      return () => void subscribers.delete(cb);
    },
  };
}
