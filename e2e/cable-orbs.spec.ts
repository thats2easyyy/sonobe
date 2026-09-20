/**
 * Cable orbs: a pulse sends a glowing orb along its cable, and a boolean sends one when it turns on
 * and a fainter one when it turns off. They're Web Animations on reused elements, an orb out of a
 * node follows the one flying into it a moment behind, a boolean's glow keeps its old state until its
 * orb leaves (and changes at once zoomed far out), no orb sets off along a cable still drawing in, a
 * quick tap still shows its turn-off, reduced motion flashes the cable instead, and a cable that goes
 * quiet unmounts its orb.
 */

import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, hook, openEditor } from "./helpers.ts";

interface Launch {
  t: number;
  cable: string;
  tone: string;
  /** The glow the cable was holding (data-orb-hold), and whether its own glow showed. */
  hold: string | null;
  glow: boolean;
  /** How much of its wire was still to draw in (the draw's stroke-dashoffset), 0 once it's there. */
  undrawn: number;
}

/** Record every orb head that starts playing: when, on which cable, its tone, and the cable's glow then. */
async function recordLaunches(page: Page) {
  await page.addInitScript(() => {
    const launches: Launch[] = [];
    (window as unknown as { __orbLaunches: typeof launches }).__orbLaunches = launches;
    const play = Animation.prototype.play;
    Animation.prototype.play = function (this: Animation) {
      const target = (this.effect as KeyframeEffect | null)?.target as Element | null | undefined;
      if (target?.classList.contains("sb-pe-orb__head")) {
        const cable = target.closest(".sb-pe-cable");
        const glow = cable?.querySelector(".sb-pe-cable__glow");
        const wire = cable?.querySelector(".sb-pe-cable__wire");
        const drawing = !!target.closest(".react-flow__edge")?.hasAttribute("data-appear");
        launches.push({
          t: performance.now(),
          cable: target.closest(".react-flow__edge")?.getAttribute("data-id") ?? "",
          tone: target.closest(".sb-pe-orb__slot")?.getAttribute("data-tone") ?? "",
          hold: cable?.getAttribute("data-orb-hold") ?? null,
          glow: !!glow && getComputedStyle(glow).visibility === "visible",
          undrawn: drawing && wire ? Math.max(0, parseFloat(getComputedStyle(wire).strokeDashoffset) || 0) : 0,
        });
      }
      return play.call(this);
    };
  });
}

const launches = (page: Page) => page.evaluate(() => (window as unknown as { __orbLaunches: Launch[] }).__orbLaunches);
/** Wait for everything arriving on the canvas to be there, and forget the launches so far (orbs wait for their cables to draw in). */
async function settle(page: Page) {
  await expect.poll(() => page.locator(".sb-pe [data-appear]").count()).toBe(0);
  await page.evaluate(() => void ((window as unknown as { __orbLaunches: Launch[] }).__orbLaunches.length = 0));
}

const TICKER = [
  { op: "addPatch", patch: { id: "orb_tick", type: "repeatingPulse", name: "Orb Tick", ui: { x: 40, y: 1400 }, inputs: { interval: 0.4 } } },
  { op: "addPatch", patch: { id: "orb_switch", type: "switch", name: "Orb Switch", ui: { x: 320, y: 1360 } } },
  { op: "addPatch", patch: { id: "orb_not", type: "not", name: "Orb Not", ui: { x: 600, y: 1400 } } },
  { op: "connect", from: "orb_tick.tick", to: "orb_switch.flip" },
  { op: "connect", from: "orb_switch.on", to: "orb_not.value" },
];

async function buildTicker(page: Page) {
  await hook(page, (s) => s.layout().setViewMode("patches"));
  const applied = await hook(page, (s, ops) => s.apply(ops as never, "Orb cables"), TICKER);
  expect(applied.ok).toBe(true);
  await page.locator('[aria-label="Zoom to fit"]').first().click();
}

test("pulses and boolean changes send orbs along their cables, each following the one before", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await recordLaunches(page);
  await openEditor(page);
  await buildTicker(page);
  await settle(page);

  const flip = "cable:orb_switch.flip";
  const value = "cable:orb_not.value";
  await expect
    .poll(async () => [...new Set((await launches(page)).map((l) => `${l.cable === flip ? "pulse" : "boolean"} ${l.tone}`))].sort(), { timeout: 10_000, intervals: [100] })
    .toEqual(["boolean dim", "boolean full", "pulse full"]);

  // The Switch's orb sets off a moment behind the pulse that flipped it (RELAY_STAGGER_MS, 80 ms), not
  // with it and not once it has landed, so the chain ripples along while the values change at once.
  // (Its value reaches the editor up to 50 ms after the pulse.)
  const seen = await launches(page);
  const pulses = seen.filter((l) => l.cable === flip).map((l) => l.t);
  const follows = seen.filter((l) => l.cable === value && pulses.some((t) => t <= l.t)).map((l) => l.t - Math.max(...pulses.filter((t) => t <= l.t)));
  expect(follows.length).toBeGreaterThan(0);
  expect(Math.min(...follows)).toBeGreaterThan(50);
  expect(Math.max(...follows)).toBeLessThan(250);

  // Its glow changes with it, not before: until the orb leaves, the cable holds the glow it had
  // (off before a turn-on, on before a turn-off) and hides its own.
  for (const l of seen.filter((l) => l.cable === value)) {
    expect(l.hold).toBe(l.tone === "full" ? "off" : "on");
    expect(l.glow).toBe(false);
  }

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
  await expect(page.locator(".sb-pe-cable[data-orb-hold]")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("no orb sets off along a cable still drawing in, when the graph arrives with the prototype running", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await recordLaunches(page);
  await openEditor(page);
  await hook(page, (s) => s.layout().setViewMode("patches"));
  // A document of just the ticker, firing every 0.1 s, so pulses and flips come while its graph arrives in view.
  const doc = await hook(page, (s, ops) => {
    const main = s.doc().components[s.doc().project.root]!;
    const clear = [...Object.keys(main.patches).map((id) => ({ op: "removePatch", id })), ...main.comments.map((c) => ({ op: "removeComment", id: c.id }))];
    const ticker = (ops as { op: string; patch?: { id: string } }[]).map((op) => (op.patch?.id === "orb_tick" ? { ...op, patch: { ...op.patch, inputs: { interval: 0.1 } } } : op));
    const r = s.apply([...clear, ...ticker] as never, "Orb cables");
    if (!r.ok) throw new Error("Couldn't build the ticker");
    return structuredClone(s.doc());
  }, TICKER);
  await settle(page);
  await hook(page, (s, d) => s.session.document.getState().replaceDocument(d as never), doc);
  await expect.poll(async () => (await launches(page)).length, { timeout: 10_000 }).toBeGreaterThan(3);
  const seen = await launches(page);
  expect(seen.filter((l) => l.undrawn > 0.02)).toEqual([]);
  expect(problems).toEqual([]);
});

test("zoomed far out, a boolean's glow changes at once while only the orb's head travels", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await recordLaunches(page);
  await openEditor(page);
  await buildTicker(page);
  for (let i = 0; i < 12 && !(await page.locator('.sb-pe__canvas[data-lod="far"]').count()); i++) await page.locator('[aria-label="Zoom out"]').first().click();
  await expect(page.locator('.sb-pe__canvas[data-lod="far"]')).toHaveCount(1);
  await settle(page);
  const value = "cable:orb_not.value";
  await expect.poll(async () => [...new Set((await launches(page)).filter((l) => l.cable === value).map((l) => l.tone))].sort(), { timeout: 10_000 }).toEqual(["dim", "full"]);
  // No cable holds its old glow: each shows its own, which follows the value.
  for (const l of (await launches(page)).filter((l) => l.cable === value)) expect(l.hold).toBeNull();
  await expect(page.locator(".sb-pe-cable[data-orb-hold]")).toHaveCount(0);
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
