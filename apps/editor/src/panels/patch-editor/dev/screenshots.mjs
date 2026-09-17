// Visual QA for the patch editor harness (Chromium, muted). Writes apps/editor/screenshots/patch-editor-*.png
// and fails (exit 1) when a check doesn't hold.
//
//   (cd apps/editor && npx vite --port 5207 --strictPort)                  # dev server
//   node apps/editor/src/panels/patch-editor/dev/screenshots.mjs [name…]    # all shots, or only the named ones

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const require = createRequire(`${root}package.json`);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:5207/src/panels/patch-editor/dev/index.html";
const OUT = process.env.OUT ?? `${root}apps/editor/screenshots`;
mkdirSync(OUT, { recursive: true });

const problems = [];
const check = (name, ok, detail) => {
  if (!ok) problems.push(`[${name}] ${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
};

/** @param {import("playwright").Page} page */
const center = async (locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** @param {import("playwright").Page} page */
async function drag(page, from, to, { modifiers = [], steps = 16 } = {}) {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) * 0.1, from.y + (to.y - from.y) * 0.1, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

const handle = (page, nodeId, handleId) => page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="${handleId}"]`);

/** Viewport rects of every non-comment node. */
const nodeRects = (page) => page.locator(".sb-pe .react-flow__node:not(.react-flow__node-comment)").evaluateAll((els) => els.map((el) => ({ id: el.getAttribute("data-id"), ...el.getBoundingClientRect().toJSON() })));
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A free pane point near `near`, away from nodes. */
async function emptyPoint(page, near, dx = 180) {
  const pane = await page.locator(".sb-pe .react-flow__pane").boundingBox();
  const rects = await nodeRects(page);
  const free = (x, y) => rects.every((r) => x < r.x - 30 || x > r.x + r.width + 30 || y < r.y - 30 || y > r.y + r.height + 30);
  let best = null;
  let bestD = Infinity;
  for (let y = pane.y + 60; y < pane.y + pane.height - 60; y += 12) {
    for (let x = pane.x + 30; x < pane.x + pane.width - 60; x += 12) {
      if (!free(x, y)) continue;
      const d = Math.hypot(x - (near.x + dx), y - near.y);
      if (d < bestD) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  return best;
}

/** @type {{ name: string; query?: string; theme?: "dark" | "light"; viewport?: { width: number; height: number }; reduced?: boolean; run?: (page: import("playwright").Page, h: (fn: string, ...args: unknown[]) => Promise<unknown>) => Promise<void> }[]} */
const SHOTS = [
  {
    name: "patch-editor-01-default",
    viewport: { width: 1100, height: 560 },
    run: async (page) => {
      const attribution = page.locator(".react-flow__attribution");
      check("01", (await attribution.count()) === 0 || !(await attribution.first().isVisible()), "no React Flow attribution on the canvas");
      const zoom = await page.locator(".sb-pe-zoom__value").innerText();
      check("01", parseInt(zoom, 10) >= 65, `readable first fit (zoom ${zoom})`);
    },
  },
  {
    name: "patch-editor-02-linksearch-layers",
    run: async (page) => {
      const from = await center(handle(page, "zoom_spring", "out:output"));
      const drop = await emptyPoint(page, from, 140);
      await drag(page, from, drop);
      await page.locator(".sb-pe-linksearch").waitFor();
      await page.keyboard.type("opacity");
      await page.waitForTimeout(150);
      const first = await page.locator(".sb-pe-linksearch [role=option]").first().innerText();
      check("02", /›\s*Opacity/.test(first), `layer property ranks first for "opacity" (${first.replace(/\s+/g, " ")})`);
    },
  },
  {
    name: "patch-editor-03-drive-picker",
    run: async (page, h) => {
      await h("drive", "sun", "opacity");
      await page.locator(".sb-pe-linksearch").waitFor();
      await page.waitForTimeout(350);
      check("03", (await page.locator('.react-flow__node[data-id="@sun"] .sb-pe-port[data-undriven]').count()) === 1, "Sun node shows the undriven Opacity row");
      const placeholder = await page.locator(".sb-pe-linksearch input").getAttribute("placeholder");
      check("03", placeholder === "Drive Opacity from…", `picker asks what drives Opacity (${placeholder})`);
    },
  },
  {
    name: "patch-editor-04-drive-connected",
    run: async (page, h) => {
      await h("drive", "sun", "opacity");
      await page.locator(".sb-pe-linksearch").waitFor();
      await page.keyboard.type("classic animation");
      await page.waitForTimeout(150);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      const link = await page.evaluate(() => {
        const s = window.__harness.session;
        const find = (layers) => layers.flatMap((l) => [l, ...find(l.children ?? [])]);
        return find(s.document.getState().doc.components.main.layers).find((l) => l.id === "sun")?.props.opacity;
      });
      check("04", !!link?.link && link.link.endsWith(".output"), `Sun opacity driven by the new patch (${JSON.stringify(link)})`);
      const rects = await nodeRects(page);
      const inserted = rects.find((r) => r.id === link?.link?.split(".")[0]);
      check("04", !!inserted && rects.every((r) => r.id === inserted.id || !overlaps(r, inserted)), "the driving patch doesn't overlap other nodes");
    },
  },
  {
    name: "patch-editor-05-layer-drop",
    run: async (page) => {
      const from = await center(handle(page, "like_spring", "out:output"));
      const photo = page.locator('.react-flow__node[data-id="@photo"] .sb-pe-node__header');
      await drag(page, from, await center(photo));
      await page.locator(".sb-pe-linksearch").waitFor();
      await page.waitForTimeout(150);
      const placeholder = await page.locator(".sb-pe-linksearch input").getAttribute("placeholder");
      check("05", placeholder === "Drive a property of Photo…", `dropping on a layer lists its properties (${placeholder})`);
    },
  },
  {
    name: "patch-editor-06-splice-chooser",
    run: async (page, h) => {
      await page.evaluate(() => window.__harness.session.document.getState().apply([{ op: "addPatch", patch: { id: "mixer", type: "transition", typeParam: "number", ui: { x: 520, y: 700 } } }], { label: "Add Transition" }));
      await page.waitForTimeout(300);
      const header = page.locator('.react-flow__node[data-id="mixer"] .sb-pe-node__header');
      const start = await center(header);
      const cable = await page.locator('.react-flow__edge[data-id="cable:card_shadow.progress"] path.sb-pe-cable__wire').boundingBox();
      await drag(page, start, { x: cable.x + cable.width * 0.55, y: cable.y + cable.height * 0.5 }, { modifiers: ["Meta"], steps: 24 });
      await page.locator(".sb-pe-splice").waitFor({ timeout: 3000 }).catch(() => undefined);
      check("06", (await page.locator(".sb-pe-splice [role=menuitem]").count()) >= 3, "⌘-drag onto a cable offers a port chooser");
      void h;
    },
  },
  {
    name: "patch-editor-07-insert-free-space",
    run: async (page) => {
      const target = await center(page.locator('.react-flow__node[data-id="zoomed"]'));
      const before = new Set((await nodeRects(page)).map((r) => r.id));
      await page.mouse.move(target.x, target.y);
      await page.keyboard.press("s");
      await page.waitForTimeout(400);
      const rects = await nodeRects(page);
      const added = rects.find((r) => !before.has(r.id));
      check("07", !!added, "single-key insert added a patch");
      check("07", !!added && rects.every((r) => r.id === added.id || !overlaps(r, added)), "inserted patch finds free space");
      const frames = await page.locator(".sb-pe .react-flow__node-comment").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      const straddles = added && frames.some((f) => overlaps(f, added) && !(added.x >= f.x && added.y >= f.y && added.x + added.width <= f.x + f.width && added.y + added.height <= f.y + f.height));
      check("07", !straddles, "inserted patch doesn't straddle a comment frame");
    },
  },
  {
    name: "patch-editor-08-hovercard-after-drag",
    run: async (page) => {
      const port = page.locator('.react-flow__node[data-id="zoom_spring"] .sb-pe-port--out').first();
      await page.mouse.move(...Object.values(await center(port)));
      await page.waitForTimeout(700);
      check("08", (await page.locator(".sb-pe-hovercard").count()) === 1, "hover card opens next to the port");
      const from = await center(handle(page, "zoom_spring", "out:output"));
      await drag(page, from, await center(handle(page, "like_spring", "in:speed")));
      await page.waitForTimeout(200);
      const pane = await page.locator(".sb-pe .react-flow__pane").boundingBox();
      await page.mouse.click(pane.x + pane.width - 80, pane.y + pane.height - 80);
      await page.waitForTimeout(700);
      const cards = await page.locator(".sb-pe-hovercard").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
      check("08", cards.every((r) => r.x > 40 || r.y > 40), `no hover card stuck at the page corner (${JSON.stringify(cards)})`);
      check("08", cards.length === 0, "hover card closed after the drag and click");
    },
  },
  {
    name: "patch-editor-09-resize-columns",
    viewport: { width: 1280, height: 800 },
    run: async (page, h) => {
      await h("resize", 1280, 360);
      await page.waitForTimeout(400);
      await h("resize", 520, 800);
      await page.waitForTimeout(500);
      const pane = await page.locator(".sb-pe .react-flow__pane").boundingBox();
      const rects = await nodeRects(page);
      const leftmost = Math.min(...rects.map((r) => r.x));
      check("09", leftmost >= pane.x - 1, `after a split change the graph starts inside the pane (left ${Math.round(leftmost)} vs ${Math.round(pane.x)})`);
    },
  },
  {
    name: "patch-editor-10-component-live",
    query: "component=1&instances=2&enter=press_feedback",
    reduced: false,
    run: async (page) => {
      check("10", (await page.locator(".sb-pe-live").innerText()).includes("Press Feedback"), "live scope chip names the instance");
      await page.evaluate(() => {
        const rt = window.__harness.session.runtime.runtime;
        rt.dispatch([{ kind: "pointer", phase: "down", pointerId: 1, x: 200, y: 280 }]);
      });
      await page.waitForTimeout(450);
      const live = await page.locator('.react-flow__node[data-id="spring"] .sb-pe-port__live').allInnerTexts();
      check("10", live.length > 0 && live.some((t) => t.trim() !== ""), `live values inside the component (${live.join(", ")})`);
    },
  },
  {
    name: "patch-editor-11-light-drive",
    theme: "light",
    run: async (page, h) => {
      await h("drive", "photo", "opacity");
      await page.locator(".sb-pe-linksearch").waitFor();
      await page.waitForTimeout(350);
    },
  },
];

const wanted = new Set(process.argv.slice(2));
const browser = await chromium.launch({ args: ["--mute-audio"] });

for (const shot of SHOTS) {
  if (wanted.size && !wanted.has(shot.name)) continue;
  const theme = shot.theme ?? "dark";
  const context = await browser.newContext({ viewport: shot.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: shot.reduced === false ? "no-preference" : "reduce" });
  await context.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[${shot.name}] console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${shot.name}] page error: ${e.message}`));
  const query = [`theme=${theme}`, shot.query].filter(Boolean).join("&");
  await page.goto(`${BASE}?${query}`, { waitUntil: "networkidle" });
  await page.locator(".sb-pe .react-flow__node").first().waitFor();
  await page.waitForTimeout(700);
  const h = (fn, ...args) => page.evaluate(([name, rest]) => window.__harness[name](...rest), [fn, args]);
  try {
    await shot.run?.(page, h);
  } catch (err) {
    problems.push(`[${shot.name}] ${err instanceof Error ? err.message : String(err)}`);
  }
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log(`wrote ${shot.name}.png`);
  await context.close();
}

await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
