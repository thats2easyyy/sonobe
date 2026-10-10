/**
 * Live values zoomed far out. An output row's text isn't painted there (patch-editor.css, data-lod),
 * so the row stops following every value: its text stays put while the prototype runs, its dot still
 * shows whether the value is on, and its slot keeps its width, so no node resizes at the threshold.
 * Zooming back in shows the value as it is by then.
 */

import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, flowNode, hook, openEditor, patchZoom } from "./helpers.ts";

const PATCHES = [
  { op: "addPatch", patch: { id: "lv_time", type: "time", name: "LV Time", ui: { x: 40, y: 1400 } } },
  { op: "addPatch", patch: { id: "lv_json", type: "textToJson", name: "LV JSON", inputs: { text: "[1, 2, 3]" }, ui: { x: 320, y: 1400 } } },
  { op: "addPatch", patch: { id: "lv_tick", type: "repeatingPulse", name: "LV Tick", inputs: { interval: 0.3 }, ui: { x: 40, y: 1560 } } },
  { op: "addPatch", patch: { id: "lv_switch", type: "switch", name: "LV Switch", ui: { x: 320, y: 1560 } } },
  { op: "connect", from: "lv_tick.tick", to: "lv_switch.flip" },
];

const far = (page: Page) => page.locator('.sb-pe__canvas[data-lod="far"]');
const liveText = (page: Page, node: string, port: string) => flowNode(page, node).locator(`.sb-pe-port--out:has([data-handleid="out:${port}"]) .sb-pe-port__live`);
const width = (page: Page, node: string) => flowNode(page, node).evaluate((el) => (el as HTMLElement).offsetWidth);

/** How often an element's text changed over `frames` animation frames. */
const textChanges = (page: Page, node: string, port: string, frames: number) =>
  liveText(page, node, port).evaluate(
    (el, frames) =>
      new Promise<number>((resolve) => {
        let changes = 0;
        const observer = new MutationObserver((records) => (changes += records.length));
        observer.observe(el, { childList: true, characterData: true, subtree: true });
        const step = () => {
          if (--frames > 0) return requestAnimationFrame(step);
          observer.disconnect();
          resolve(changes);
        };
        requestAnimationFrame(step);
      }),
    frames,
  );

test("zoomed far out, output rows follow whether a value is on and not its text, and keep their width", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await openEditor(page);
  await hook(page, (s) => s.layout().setViewMode("patches"));
  const applied = await hook(page, (s, ops) => s.apply(ops as never, "Live value patches"), PATCHES);
  expect(applied.ok).toBe(true);
  await page.locator('[aria-label="Zoom to fit"]').first().click();
  await expect.poll(() => page.locator(".sb-pe [data-appear]").count()).toBe(0);
  await expect(far(page)).toHaveCount(0);

  // Near: the running clock's text keeps changing, and the JSON value has its slot.
  expect(await textChanges(page, "lv_time", "time", 30)).toBeGreaterThan(3);
  await expect(liveText(page, "lv_json", "json")).not.toBeEmpty();
  const near = { json: await width(page, "lv_json"), time: await width(page, "lv_time") };
  const clock = async () => Number(await liveText(page, "lv_time", "time").textContent());
  const earlier = await clock();

  for (let i = 0; i < 12 && !(await far(page).count()); i++) await patchZoom(page, "Zoom Out");
  await expect(far(page)).toHaveCount(1);
  await page.waitForTimeout(200);

  // Far: no text changes while the prototype runs, the switch's dot still turns on and off, and nothing changed width.
  expect(await textChanges(page, "lv_time", "time", 30)).toBe(0);
  const on = flowNode(page, "lv_switch").locator('.sb-pe-port--out:has([data-handleid="out:on"])');
  await expect(on).toHaveAttribute("data-live", "true");
  await expect(on).not.toHaveAttribute("data-live", "true");
  expect({ json: await width(page, "lv_json"), time: await width(page, "lv_time") }).toEqual(near);

  // Back in: the clock shows a later time than it did, and runs on.
  await page.locator('[aria-label="Zoom to fit"]').first().click();
  await expect(far(page)).toHaveCount(0);
  await expect.poll(clock).toBeGreaterThan(earlier);
  expect(await textChanges(page, "lv_time", "time", 30)).toBeGreaterThan(3);
  expect({ json: await width(page, "lv_json"), time: await width(page, "lv_time") }).toEqual(near);
  expect(problems).toEqual([]);
});
