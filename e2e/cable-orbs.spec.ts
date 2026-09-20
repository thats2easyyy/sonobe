/**
 * Cable orbs: a pulse sends a glowing orb along its cable, and a boolean sends one when it turns on
 * and a fainter one when it turns off. They're Web Animations on reused elements, reduced motion
 * flashes the cable instead, and a cable that goes quiet unmounts its orb.
 */

import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, hook, openEditor } from "./helpers.ts";

async function buildTicker(page: Page) {
  await hook(page, (s) => s.layout().setViewMode("patches"));
  const applied = await hook(page, (s) =>
    s.apply(
      [
        { op: "addPatch", patch: { id: "orb_tick", type: "repeatingPulse", name: "Orb Tick", ui: { x: 40, y: 1400 }, inputs: { interval: 0.4 } } },
        { op: "addPatch", patch: { id: "orb_switch", type: "switch", name: "Orb Switch", ui: { x: 320, y: 1360 } } },
        { op: "addPatch", patch: { id: "orb_not", type: "not", name: "Orb Not", ui: { x: 600, y: 1400 } } },
        { op: "connect", from: "orb_tick.tick", to: "orb_switch.flip" },
        { op: "connect", from: "orb_switch.on", to: "orb_not.value" },
      ],
      "Orb cables",
    ),
  );
  expect(applied.ok).toBe(true);
  await page.locator('[aria-label="Zoom to fit"]').first().click();
}

/** Tones of the orb heads animating in cables of one kind: "full" peaks at 1, "dim" lower. */
function headTones(page: Page, cables: string) {
  return page.evaluate((selector) => {
    const tones = new Set<string>();
    for (const head of document.querySelectorAll(`${selector} .sb-pe-orb__head`)) {
      for (const animation of head.getAnimations()) {
        if (animation.playState !== "running") continue;
        const peak = Math.max(...(animation.effect as KeyframeEffect).getKeyframes().map((k) => Number(k.fillOpacity ?? 0)));
        tones.add(peak === 1 ? "full" : "dim");
      }
    }
    return [...tones];
  }, cables);
}

const pulseCables = ".sb-pe-cable[data-pulse]";
const booleanCables = ".sb-pe-cable:not([data-pulse])";

test("pulses and boolean changes send orbs along their cables", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await openEditor(page);
  await buildTicker(page);

  const seen = new Set<string>();
  await expect
    .poll(async () => {
      for (const tone of await headTones(page, pulseCables)) seen.add(`pulse ${tone}`);
      for (const tone of await headTones(page, booleanCables)) seen.add(`boolean ${tone}`);
      return [...seen].sort();
    }, { timeout: 10_000, intervals: [50] })
    .toEqual(["boolean dim", "boolean full", "pulse full"]);

  // A cable keeps at most two orbs in flight, and the slots it doesn't use stay transparent.
  const inFlight = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll(".sb-pe-orb")].map((orb) => [...orb.querySelectorAll(".sb-pe-orb__head")].filter((head) => head.getAnimations().some((a) => a.playState === "running")).length)),
  );
  expect(inFlight).toBeLessThanOrEqual(2);

  // Once nothing fires, the orb's elements unmount.
  expect((await hook(page, (s) => s.apply([{ op: "setInput", target: "orb_tick.enabled", value: false }], "Stop ticking"))).ok).toBe(true);
  await expect(page.locator(".sb-pe-orb")).toHaveCount(0, { timeout: 6_000 });
  expect(problems).toEqual([]);
});

test("reduced motion flashes the cable instead of sending an orb", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openEditor(page);
  await buildTicker(page);

  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll(".sb-pe-cable__flash")].some((flash) => flash.getAnimations().length > 0)), { timeout: 10_000, intervals: [50] })
    .toBe(true);
  await expect(page.locator(".sb-pe-orb__head")).toHaveCount(0);
  expect(problems).toEqual([]);
});
