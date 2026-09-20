/**
 * Cable orbs: a pulse sends a glowing orb along its cable, and a boolean sends one when it turns on
 * and a fainter one when it turns off. They're Web Animations on reused elements, an orb out of a
 * node waits for the one flying into it to land, a quick tap still shows its turn-off, reduced motion
 * flashes the cable instead, and a cable that goes quiet unmounts its orb.
 */

import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, hook, openEditor } from "./helpers.ts";

/** Record every orb head that starts playing: when, on which cable, and its tone. */
async function recordLaunches(page: Page) {
  await page.addInitScript(() => {
    const launches: { t: number; cable: string | null | undefined; tone: string }[] = [];
    (window as unknown as { __orbLaunches: typeof launches }).__orbLaunches = launches;
    const play = Animation.prototype.play;
    Animation.prototype.play = function (this: Animation) {
      const effect = this.effect as KeyframeEffect | null;
      const target = effect?.target as Element | null | undefined;
      if (effect && target?.classList.contains("sb-pe-orb__head")) {
        const peak = Math.max(...effect.getKeyframes().map((k) => Number(k.fillOpacity ?? 0)));
        launches.push({ t: performance.now(), cable: target.closest(".react-flow__edge")?.getAttribute("data-id"), tone: peak === 1 ? "full" : "dim" });
      }
      return play.call(this);
    };
  });
}

const launches = (page: Page) => page.evaluate(() => (window as unknown as { __orbLaunches: { t: number; cable: string; tone: string }[] }).__orbLaunches);

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

test("pulses and boolean changes send orbs along their cables, each waiting for the one before", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await recordLaunches(page);
  await openEditor(page);
  await buildTicker(page);

  const flip = "cable:orb_switch.flip";
  const value = "cable:orb_not.value";
  await expect
    .poll(async () => [...new Set((await launches(page)).map((l) => `${l.cable === flip ? "pulse" : "boolean"} ${l.tone}`))].sort(), { timeout: 10_000, intervals: [100] })
    .toEqual(["boolean dim", "boolean full", "pulse full"]);

  // The Switch's orb sets off as the pulse that flipped it lands (about 250 ms on), not with it. (Its
  // value reaches the editor up to 50 ms after the pulse, so without the wait it would be well under.)
  const seen = await launches(page);
  const pulses = seen.filter((l) => l.cable === flip).map((l) => l.t);
  const follows = seen.filter((l) => l.cable === value).map((l) => l.t - Math.max(...pulses.filter((t) => t <= l.t)));
  expect(Math.max(...follows)).toBeGreaterThan(180);

  // The landing is drawn above the nodes, in React Flow's viewport portal.
  await expect(page.locator(".react-flow__viewport-portal .sb-pe-orb-landing").first()).toBeAttached();

  // A cable keeps at most two orbs in flight.
  const inFlight = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll(".sb-pe-orb")].map((orb) => [...orb.querySelectorAll(".sb-pe-orb__head")].filter((head) => head.getAnimations().some((a) => a.playState === "running")).length)),
  );
  expect(inFlight).toBeLessThanOrEqual(2);

  // Once nothing fires, the orb's elements unmount.
  expect((await hook(page, (s) => s.apply([{ op: "setInput", target: "orb_tick.enabled", value: false }], "Stop ticking"))).ok).toBe(true);
  await expect(page.locator(".sb-pe-orb")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator(".sb-pe-orb-landing")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a quick tap sends the turn-off orb too", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await recordLaunches(page);
  await openEditor(page);
  await hook(page, (s) => s.layout().setViewMode("patches"));
  const applied = await hook(page, (s) =>
    s.apply(
      [
        { op: "addPatch", patch: { id: "q_tap", type: "interaction", name: "Q Tap", inputs: { layer: { layer: "photo" } }, ui: { x: 40, y: 1400 } } },
        { op: "addPatch", patch: { id: "q_not", type: "not", name: "Q Not", ui: { x: 360, y: 1400 } } },
        { op: "connect", from: "q_tap.down", to: "q_not.value" },
      ],
      "Tap into Not",
    ),
  );
  expect(applied.ok).toBe(true);
  await page.locator('[aria-label="Zoom to fit"]').first().click();
  await page.waitForTimeout(300);
  const photo = await page.locator('#sb-viewer [data-layer="photo"]').first().boundingBox();
  expect(photo).not.toBeNull();
  await page.mouse.move(photo!.x + photo!.width / 2, photo!.y + photo!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();

  // Down turns off well inside the cable's gap between orbs; the dim orb waits for it instead of being dropped.
  await expect.poll(async () => (await launches(page)).filter((l) => l.cable === "cable:q_not.value").map((l) => l.tone), { timeout: 5_000 }).toEqual(["full", "dim"]);
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

test("Settings → Motion → Reduce stops the orbs too, whatever the OS says", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.addInitScript(() => localStorage.setItem("sonobe.settings.v1", JSON.stringify({ motion: "reduce" })));
  await openEditor(page);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await buildTicker(page);

  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll(".sb-pe-cable__flash")].some((flash) => flash.getAnimations().length > 0)), { timeout: 10_000, intervals: [50] })
    .toBe(true);
  await expect(page.locator(".sb-pe-orb__head")).toHaveCount(0);
  expect(problems).toEqual([]);
});
