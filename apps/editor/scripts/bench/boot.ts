// Boot and first opens: how long until the editor paints and is usable, and how long the surfaces
// that load on demand (the welcome screen, Settings) take the first time. One new browser context per run.
import type { Browser, Page } from "@playwright/test";
import { newPage, openEditor, sleep } from "./lib.ts";

/** One measurement: named numbers, in ms unless the name says otherwise. */
export type Sample = Record<string, number>;

const mod = process.platform === "darwin" ? "Meta" : "Control";

/** Load the editor once: paint, the boot marks, long tasks and the JavaScript loaded by the time it's usable. */
export async function bootRun(browser: Browser, base: string): Promise<Sample> {
  const { context, page, problems } = await newPage(browser);
  try {
    await openEditor(page, base);
    await sleep(400);
    const data = await page.evaluate(() => {
      const perf = (window as any).__perf;
      const usable = perf.marks.usable as number;
      const js = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((r) => /\.js(\?|$)/.test(r.name) && r.startTime <= usable);
      const long = perf.longTasks.filter((l: { start: number }) => l.start <= usable);
      return {
        "first contentful paint": performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")?.startTime ?? NaN,
        "first commit": perf.marks.rootFilled ?? NaN,
        "patch editor's first node": perf.marks.patchNode ?? NaN,
        "usable (4 frames, layer rows, a patch node)": usable,
        "loading label visible": perf.marks.loadingShown ?? NaN,
        "longest task": Math.max(0, ...long.map((l: { duration: number }) => l.duration)),
        "JS loaded by usable (KB)": js.reduce((a, r) => a + r.decodedBodySize, 0) / 1000,
      };
    });
    if (problems.length) throw new Error(`The editor at ${base} logged errors while booting:\n${problems.join("\n")}`);
    return data;
  } finally {
    await context.close();
  }
}

/** A first launch: nothing remembers the welcome screen, so it opens over the editor. */
export async function welcomeRun(browser: Browser, base: string): Promise<Sample> {
  const { context, page } = await newPage(browser, { seenWelcome: false });
  try {
    await page.goto(`${base}/?sonobeTest`);
    await page.waitForFunction(() => (window as any).__perf?.marks.dialog !== undefined, undefined, { timeout: 30_000 });
    const marks = await page.evaluate(() => (window as any).__perf.marks);
    return { "welcome screen, first launch": marks.dialog, "welcome screen after the first commit": marks.dialog - marks.rootFilled };
  } finally {
    await context.close();
  }
}

/** Press Mod+, and time the Settings dialog entering the DOM, from the keydown. */
async function openSettings(page: Page): Promise<number> {
  await page.evaluate(() => {
    const d: any = ((window as any).__dialog = {});
    const observer = new MutationObserver(() => {
      if (!document.querySelector("[role=dialog]")) return;
      d.shown = performance.now();
      observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("keydown", () => (d.key = performance.now()), { capture: true, once: true });
  });
  await page.keyboard.press(`${mod}+,`);
  await page.waitForFunction(() => (window as any).__dialog.shown !== undefined, undefined, { timeout: 5000 });
  return page.evaluate(() => (window as any).__dialog.shown - (window as any).__dialog.key);
}

/** Settings opened twice: the first open loads its code, the second doesn't. */
export async function settingsRun(browser: Browser, base: string): Promise<Sample> {
  const { context, page } = await newPage(browser);
  try {
    await openEditor(page, base);
    await sleep(1500);
    const first = await openSettings(page);
    await page.keyboard.press("Escape");
    await page.waitForSelector("[role=dialog]", { state: "detached", timeout: 5000 });
    await sleep(600);
    return { "Settings, first open": first, "Settings, second open": await openSettings(page) };
  } finally {
    await context.close();
  }
}

/** The Assistant sheet open, then Settings for the first time: how long is the sheet off screen while Settings loads? */
export async function assistantRun(browser: Browser, base: string): Promise<Sample> {
  const { context, page } = await newPage(browser);
  try {
    await openEditor(page, base);
    await sleep(1000);
    await page.keyboard.press(`${mod}+6`);
    await page.waitForSelector(".sb-assistant-sheet", { timeout: 5000 });
    await sleep(800);
    await page.evaluate(() => {
      const sheet = document.querySelector(".sb-assistant-sheet")!;
      const hidden: any = ((window as any).__hidden = { ms: 0, done: false });
      let last = performance.now();
      const tick = (t: number) => {
        if (!sheet.isConnected || getComputedStyle(sheet).display === "none") hidden.ms += t - last;
        last = t;
        if (!hidden.done) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await openSettings(page);
    await sleep(500);
    const ms = await page.evaluate(() => (((window as any).__hidden.done = true), (window as any).__hidden.ms));
    return { "Assistant hidden while Settings first opens": ms };
  } finally {
    await context.close();
  }
}

export const BOOT_RUNS = [bootRun, welcomeRun, settingsRun, assistantRun];
