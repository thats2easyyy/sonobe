/**
 * Visual QA for the Viewer and Canvas panels. Drives the dev harness in muted headless Chromium,
 * checks the document changes each gesture makes, and writes screenshots to
 * apps/editor/screenshots/viewer-*.png and canvas-*.png.
 *
 *   cd apps/editor && npx vite --port 5202          # in another terminal
 *   node apps/editor/src/panels/canvas/dev/visualQa.ts [harness url]
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const shotsDir = resolve(here, "../../../../screenshots");
const harness = process.argv[2] ?? "http://localhost:5202/src/panels/canvas/dev/index.html";

type Point = [number, number];

const failures: string[] = [];
const passed: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) passed.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

async function open(page: Page, query: string) {
  await page.goto(`${harness}?${query}`);
  await page.waitForSelector(".sb-panel");
  await page.waitForTimeout(900);
}

async function shot(page: Page, name: string, selector?: string) {
  const path = resolve(shotsDir, `${name}.png`);
  if (selector) await page.locator(selector).first().screenshot({ path });
  else await page.screenshot({ path });
}

/** A layer prop from the live document. */
function layerProp(page: Page, id: string, key: string): Promise<unknown> {
  return page.evaluate(
    ([layerId, propKey]) => {
      interface L {
        id: string;
        props: Record<string, unknown>;
        children?: L[];
      }
      const find = (layers: L[]): L | undefined => {
        for (const l of layers) {
          if (l.id === layerId) return l;
          const inner = l.children ? find(l.children) : undefined;
          if (inner) return inner;
        }
        return undefined;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__sonobe;
      return find(s.document.getState().doc.components.main.layers)?.props[propKey!];
    },
    [id, key],
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionEval = <T>(page: Page, fn: (s: any) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__sonobe)`) as Promise<T>;

interface Artboard {
  left: number;
  top: number;
  zoom: number;
}

async function artboard(page: Page): Promise<Artboard> {
  return page.evaluate(() => {
    const el = document.querySelector(".sb-cv__artboard") as HTMLElement;
    const r = el.getBoundingClientRect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const size = (window as any).__sonobe.runtime.scene()?.size ?? [402, 874];
    return { left: r.left, top: r.top, zoom: r.width / size[0] };
  });
}

const toPage = (ab: Artboard, p: Point): Point => [ab.left + p[0] * ab.zoom, ab.top + p[1] * ab.zoom];

async function drag(page: Page, from: Point, to: Point, options: { steps?: number; hold?: (page: Page) => Promise<void> } = {}) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  const steps = options.steps ?? 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  await page.waitForTimeout(80);
  if (options.hold) await options.hold(page);
  await page.mouse.up();
  await page.waitForTimeout(80);
}

/** Open a menu from its trigger button and pick an item by its title. */
async function chooseMenu(page: Page, trigger: string | RegExp, item: string) {
  await page.getByRole("button", { name: trigger }).first().click();
  await page.waitForTimeout(150);
  await page.locator('[role^="menuitem"]').filter({ has: page.locator(".sb-menu__title", { hasText: new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) }).first().click();
  await page.waitForTimeout(250);
}

const selection = (page: Page) => sessionEval(page, (s) => s.selection.getState().layers as string[]);
/** Every layer in the root component, depth first. */
const allLayers = (page: Page) =>
  sessionEval(page, (s) => {
    const out: { id: string; type: string; props: { text?: string; image?: { asset?: string } } }[] = [];
    const walk = (layers: { id: string; type: string; props: { text?: string }; children?: unknown[] }[]) => {
      for (const l of layers) {
        out.push(l);
        if (l.children) walk(l.children as typeof layers);
      }
    };
    walk(s.document.getState().doc.components.main.layers);
    return out;
  });
const historyLabels = (page: Page) => sessionEval(page, (s) => (s.document.getState().historyEntries() as { label: string }[]).map((e) => e.label));
const mod = process.platform === "darwin" ? "Meta" : "Control";

async function viewerQa(context: BrowserContext, page: Page) {
  await open(page, "panels=both");
  await page.waitForSelector(".sonobe-device .sonobe-stage");
  await page.waitForTimeout(600);
  check("viewer renders the device frame", (await page.locator(".sonobe-device").count()) === 1);
  check("viewer shows the fps readout", (await page.locator(".sb-vw__pill-meta").first().textContent())?.includes("fps") ?? false);
  check("viewer header has no second device picker", (await page.locator('[data-testid=viewer-column] .sb-panel__header [aria-label="Device"]').count()) === 0);
  check("viewer header names the device when there's room", await page.locator(".sb-vw__device-name").isVisible());
  await shot(page, "viewer-01-default");

  await sessionEval(page, (s) => s.selection.getState().select({ layers: ["card"] }));
  await sessionEval(page, (s) => s.selection.getState().setHovered({ kind: "layer", id: "like_button", component: "main", source: "layers" }));
  await page.waitForTimeout(250);
  check("viewer outlines selected and hovered layers", (await page.locator(".sb-vw-highlight polygon:visible").count()) >= 2);
  await shot(page, "viewer-02-highlight", "[data-testid=viewer-column]");
  await sessionEval(page, (s) => {
    s.selection.getState().setHovered(null);
    s.selection.getState().clear();
  });

  await page.getByRole("button", { name: "Show hit targets" }).click();
  await page.waitForTimeout(500);
  await shot(page, "viewer-03-hit-targets", "[data-testid=viewer-column]");
  await page.getByRole("button", { name: "Show hit targets" }).click();

  await chooseMenu(page, "More viewer options", "Rotate to Landscape");
  await page.waitForTimeout(400);
  const device = await sessionEval(page, (s) => s.document.getState().doc.project.device);
  check("rotate writes project.device via setProject", (device as { orientation?: string }).orientation === "landscape");
  await shot(page, "viewer-04-landscape", "[data-testid=viewer-column]");
  await chooseMenu(page, "More viewer options", "Rotate to Portrait");

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Alt+KeyD");
  await chooseMenu(page, /^Viewer zoom:/, "Actual Size (1:1)");
  await page.waitForTimeout(300);
  check("⌥D hides the device frame", (await page.locator(".sonobe-device[data-frame=off]").count()) === 1);
  check("the zoom menu switches to 1:1", (await page.getByRole("button", { name: "Viewer zoom: 1:1" }).count()) === 1);
  await shot(page, "viewer-05-no-frame-1to1", "[data-testid=viewer-column]");
  await chooseMenu(page, /^Viewer zoom:/, "Fit to Panel");
  await page.keyboard.press("Alt+KeyD");

  await page.getByRole("button", { name: "More viewer options" }).click();
  await page.waitForTimeout(150);
  await page.getByRole("menuitem", { name: /^Device/ }).hover();
  await page.waitForTimeout(400);
  await shot(page, "viewer-06-device-menu");
  await page.getByRole("menuitemcheckbox", { name: /iPhone SE/ }).click();
  await page.waitForTimeout(400);
  check("the device menu changes project.device", ((await sessionEval(page, (s) => s.document.getState().doc.project.device.preset)) as string) === "iphone-se");
  await shot(page, "viewer-07-iphone-se", "[data-testid=viewer-column]");
  await sessionEval(page, (s) => s.document.getState().undo());

  await page.getByRole("button", { name: "On phone" }).click();
  await page.waitForSelector(".sb-phone__qr[data-state=ready]", { timeout: 5000 }).catch(() => undefined);
  check("phone preview draws a QR code", (await page.locator(".sb-phone__qr[data-state=ready] svg path").count()) === 1);
  await shot(page, "viewer-08-on-phone");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Pause prototype" }).click();
  await page.waitForTimeout(350);
  check("pause shows the frame counter", (await page.locator(".sb-vw__pill").first().textContent())?.includes("Paused") ?? false);
  await page.getByRole("button", { name: "Play prototype" }).click();

  await chooseMenu(page, "More viewer options", "Pop Out Viewer");
  await page.waitForTimeout(600);
  check("pop out floats the viewer", (await page.locator(".sb-float .sonobe-device").count()) === 1);
  check("the floating window keeps restart", (await page.locator('.sb-float button[aria-label="Restart prototype"]').count()) === 1);
  await drag(page, [1100, 102], [760, 140], { steps: 6 });
  await shot(page, "viewer-09-floating");
  await page.getByRole("button", { name: "Dock viewer" }).first().click();
  await page.waitForTimeout(400);

  await sessionEval(page, (s) =>
    s.runtime.state.setState({
      diagnostics: [{ code: "patch_threw", severity: "error", message: "Pop Animation threw: bounciness must be a number", component: "main", itemIds: ["card"] }],
    }),
  );
  await page.waitForTimeout(200);
  check("runtime errors show a banner", (await page.locator(".sb-vw__issue").count()) === 1);
  await shot(page, "viewer-10-runtime-error", "[data-testid=viewer-column]");

  await sessionEval(page, (s) => s.document.getState().newDocument());
  await page.waitForTimeout(500);
  check("empty prototypes show guidance", (await page.locator(".sb-vw__empty-card").count()) === 1);
  await shot(page, "viewer-11-empty", "[data-testid=viewer-column]");

  await open(page, "panels=both&theme=light");
  await page.waitForSelector(".sonobe-device .sonobe-stage");
  await sessionEval(page, (s) => s.selection.getState().select({ layers: ["like_button"] }));
  await page.waitForTimeout(400);
  await shot(page, "viewer-12-light", "[data-testid=viewer-column]");

  // The header at the default shell width (296) and near the minimum (250).
  for (const width of [296, 250]) {
    await open(page, `panels=both&viewerWidth=${width}`);
    await page.waitForSelector(".sonobe-device .sonobe-stage");
    const layout = await page.evaluate(() => {
      const header = document.querySelector("[data-testid=viewer-column] .sb-panel__header") as HTMLElement;
      const box = header.getBoundingClientRect();
      const visible = [...header.querySelectorAll<HTMLElement>(".sb-panel__actions > *, .sb-panel__actions button")].filter((el) => el.getBoundingClientRect().width > 0);
      const labels = visible.map((el) => el.getAttribute("aria-label") ?? el.querySelector("button")?.getAttribute("aria-label") ?? "").filter(Boolean);
      return { overflow: Math.max(0, ...visible.map((el) => el.getBoundingClientRect().right - box.right)), labels: [...new Set(labels)] };
    });
    check(`viewer header fits at ${width}px`, layout.overflow <= 0.5, `overflows by ${layout.overflow}px`);
    for (const needed of ["Restart prototype", "Device frame", "More viewer options"]) check(`"${needed}" stays in the header at ${width}px`, layout.labels.includes(needed), JSON.stringify(layout.labels));
    check(`zoom stays in the header at ${width}px`, layout.labels.some((l) => l.startsWith("Viewer zoom:")), JSON.stringify(layout.labels));
    await shot(page, `viewer-13-header-${width}`, "[data-testid=viewer-column] .sb-panel__header");
  }
  await shot(page, "viewer-14-narrow", "[data-testid=viewer-column]");

  // Desktop host: the phone preview server and a host viewer window.
  const hostPage = await context.newPage();
  await hostPage.addInitScript(() => {
    const stopped = { running: false, url: null, urls: [], lanReachable: true, clients: 0, error: null };
    const running = { running: true, url: "http://192.168.1.24:5204/p?token=7f3a9c", urls: ["http://192.168.1.24:5204/p?token=7f3a9c", "http://10.0.0.12:5204/p?token=7f3a9c"], lanReachable: true, clients: 1, error: null };
    let status: object = stopped;
    const listeners = new Set<(s: object) => void>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).sonobeHost = {
      getPreviewStatus: async () => status,
      startPreview: async () => {
        await new Promise((r) => setTimeout(r, 250));
        status = running;
        for (const l of listeners) l(status);
        return status;
      },
      stopPreview: async () => {
        status = stopped;
        return status;
      },
      onPreviewStatus: (cb: (s: object) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      popOutViewer: async (options?: { alwaysOnTop?: boolean }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__poppedOut = ((window as any).__poppedOut ?? 0) + 1;
        return { open: true, alwaysOnTop: options?.alwaysOnTop ?? false, error: null };
      },
      closeViewerWindow: async () => ({ open: false, alwaysOnTop: false, error: null }),
      getViewerWindowStatus: async () => ({ open: false, alwaysOnTop: false, error: null }),
      onViewerWindowStatus: () => () => undefined,
    };
  });
  await open(hostPage, "panels=both&lan=host");
  await hostPage.waitForSelector(".sonobe-device .sonobe-stage");
  await hostPage.getByRole("button", { name: "On phone" }).click();
  await hostPage.waitForTimeout(300);
  check("host phone preview offers to start the server", (await hostPage.getByRole("button", { name: "Start phone preview" }).count()) === 1);
  await shot(hostPage, "viewer-15-phone-start");
  await hostPage.getByRole("button", { name: "Start phone preview" }).click();
  await hostPage.waitForSelector(".sb-phone__qr[data-state=ready]", { timeout: 5000 }).catch(() => undefined);
  await hostPage.waitForTimeout(200);
  check("host phone preview shows the player URL", (await hostPage.locator(".sb-phone__url code").textContent())?.includes("192.168.1.24") ?? false);
  check("host phone preview counts phones", (await hostPage.locator(".sb-phone__status").textContent())?.includes("1 phone connected") ?? false);
  await shot(hostPage, "viewer-16-phone-running");
  await hostPage.keyboard.press("Escape");
  await chooseMenu(hostPage, "More viewer options", "Open in New Window");
  await hostPage.waitForTimeout(300);
  check("pop out uses the host window", ((await hostPage.evaluate(() => (window as unknown as { __poppedOut?: number }).__poppedOut ?? 0)) as number) === 1 && (await hostPage.locator(".sb-float").count()) === 0);
  await hostPage.getByRole("button", { name: "More viewer options" }).click();
  await hostPage.waitForTimeout(200);
  check("an open viewer window can be closed or kept on top", (await hostPage.getByRole("menuitem", { name: "Close Viewer Window" }).count()) === 1 && (await hostPage.getByRole("menuitemcheckbox", { name: "Keep Viewer Window on Top" }).count()) === 1);
  await shot(hostPage, "viewer-17-window-open-menu");
  await hostPage.keyboard.press("Escape");
  await hostPage.close();
}

async function canvasQa(page: Page) {
  await open(page, "panels=canvas&autoplay=0");
  await page.waitForSelector(".sb-cv__artboard .sonobe-stage");
  await page.waitForTimeout(300);
  check("rulers show by default", (await page.locator(".sb-cv__ruler").count()) === 2);
  await shot(page, "canvas-01-default");

  let ab = await artboard(page);
  // Click the card: a click on any child selects the top-level group.
  await page.mouse.click(...toPage(ab, [200, 520]));
  check("click selects the top-level layer", JSON.stringify(await selection(page)) === '["card"]', JSON.stringify(await selection(page)));
  await page.mouse.move(...toPage(ab, [346, 186]));
  await page.waitForTimeout(150);
  await shot(page, "canvas-02-select-hover");

  // Move with smart guides.
  await drag(page, toPage(ab, [200, 520]), toPage(ab, [230, 548]), { hold: (p) => shot(p, "canvas-03-move-guides") });
  const moved = (await layerProp(page, "card", "position")) as number[];
  check("drag moves the layer", moved[0] !== 16 && moved[1] !== 146, JSON.stringify(moved));
  check("a drag is one undo entry", (await historyLabels(page)).filter((l) => l.startsWith("Move")).length === 1, JSON.stringify(await historyLabels(page)));
  await page.keyboard.press(`${mod}+KeyZ`);
  await page.waitForTimeout(150);
  check("undo restores the position", JSON.stringify(await layerProp(page, "card", "position")) === "[16,146]", JSON.stringify(await layerProp(page, "card", "position")));

  // Resize from the bottom-right handle.
  ab = await artboard(page);
  await page.mouse.click(...toPage(ab, [200, 520]));
  await drag(page, toPage(ab, [386, 586]), toPage(ab, [360, 640]), { hold: (p) => shot(p, "canvas-04-resize") });
  const size = (await layerProp(page, "card", "size")) as number[];
  check("handle drag resizes", size[0] < 370 && size[1] > 440, JSON.stringify(size));
  await page.keyboard.press(`${mod}+KeyZ`);

  // Rotate with the knob.
  ab = await artboard(page);
  const knob = await page.locator(".sb-cv__knob").boundingBox();
  if (knob) {
    const k: Point = [knob.x + knob.width / 2, knob.y + knob.height / 2];
    await drag(page, k, [k[0] + 140, k[1] + 40], { hold: (p) => shot(p, "canvas-05-rotate") });
    check("knob drag rotates", typeof (await layerProp(page, "card", "rotation")) === "number");
    await page.keyboard.press(`${mod}+KeyZ`);
  } else {
    check("rotation knob is visible", false);
  }

  // Deep select with ⌘-click, then nudge.
  ab = await artboard(page);
  await page.keyboard.down(mod);
  await page.mouse.click(...toPage(ab, [278, 282]));
  await page.keyboard.up(mod);
  check("⌘-click selects the deepest layer", JSON.stringify(await selection(page)) === '["sun"]', JSON.stringify(await selection(page)));
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(1100);
  check("arrows nudge (⇧ ×10) as one entry", JSON.stringify(await layerProp(page, "sun", "position")) === "[224,89]", JSON.stringify(await layerProp(page, "sun", "position")));
  await shot(page, "canvas-06-deep-select");

  // Marquee from outside the artboard.
  ab = await artboard(page);
  await page.mouse.click(ab.left - 30, ab.top + 40);
  await drag(page, [ab.left - 30, ab.top + 50 * ab.zoom], toPage(ab, [300, 135]), { hold: (p) => shot(p, "canvas-07-marquee") });
  const marquee = await selection(page);
  check("marquee selects top-level layers", marquee.includes("title") && marquee.includes("subtitle") && !marquee.includes("card"), JSON.stringify(marquee));

  // ⌥ distances.
  ab = await artboard(page);
  await page.mouse.click(...toPage(ab, [200, 520]));
  await page.mouse.move(...toPage(ab, [346, 186]));
  await page.keyboard.down("Alt");
  await page.mouse.move(...toPage(ab, [347, 187]));
  await page.waitForTimeout(150);
  await shot(page, "canvas-08-alt-measure");
  await page.keyboard.up("Alt");

  // Draw a rectangle.
  const before = (await allLayers(page)).length;
  await page.keyboard.press("Escape");
  await page.keyboard.press("KeyR");
  ab = await artboard(page);
  await drag(page, toPage(ab, [40, 640]), toPage(ab, [180, 760]), { hold: (p) => shot(p, "canvas-09-insert-drag") });
  const layersAfter = await allLayers(page);
  const inserted = (await selection(page))[0];
  check("R + drag inserts a rectangle", layersAfter.length === before + 1 && layersAfter.some((l) => l.id === inserted && l.type === "rectangle"), `${before} → ${layersAfter.length}, selected ${inserted}`);
  check("insert is labeled", (await historyLabels(page))[0] === "Insert Rectangle", JSON.stringify((await historyLabels(page))[0]));
  await shot(page, "canvas-10-inserted");

  // Text tool: click, type, finish.
  await page.keyboard.press("KeyT");
  ab = await artboard(page);
  await page.mouse.click(...toPage(ab, [220, 700]));
  await page.waitForSelector(".sb-cv__text-editor");
  await page.keyboard.type("Hello Sonobe");
  await page.waitForTimeout(100);
  await shot(page, "canvas-11-text-edit");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const texts = (await allLayers(page)).filter((l) => l.type === "text").map((l) => l.props.text);
  check("inline text editing writes the text", texts.includes("Hello Sonobe"), JSON.stringify(texts));
  check("inserting and typing text is one undo entry", (await historyLabels(page))[0] === "Insert Text" && (await historyLabels(page))[1] === "Insert Rectangle", JSON.stringify((await historyLabels(page)).slice(0, 3)));

  // Group from the selection (⌘G).
  ab = await artboard(page);
  await page.mouse.click(...toPage(ab, [60, 80]));
  await page.keyboard.down("Shift");
  await page.mouse.click(...toPage(ab, [60, 118]));
  await page.keyboard.up("Shift");
  await page.keyboard.press(`${mod}+KeyG`);
  await page.waitForTimeout(200);
  check("⌘G groups the selection", (await historyLabels(page))[0]?.startsWith("Group") ?? false, JSON.stringify((await historyLabels(page))[0]));
  await shot(page, "canvas-12-grouped");
  await page.keyboard.press(`${mod}+KeyZ`);

  // Zoom with ⌘-scroll, then fit.
  ab = await artboard(page);
  await page.mouse.move(...toPage(ab, [346, 186]));
  await page.keyboard.down(mod);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -40);
  await page.keyboard.up(mod);
  await page.waitForTimeout(200);
  const zoomed = await artboard(page);
  check("⌘-scroll zooms about the pointer", zoomed.zoom > ab.zoom * 1.5, `${ab.zoom} → ${zoomed.zoom}`);
  await shot(page, "canvas-13-zoomed");
  await page.keyboard.press("Shift+Digit1");
  await page.waitForTimeout(150);

  // A layout group: dragging a child reorders it.
  await sessionEval(page, (s) =>
    s.document.getState().apply(
      [
        {
          op: "addLayer",
          layer: {
            id: "chips",
            type: "group",
            name: "Chips",
            props: { position: [24, 780], size: [354, 64], layout: "row", spacing: 10, padding: [8, 8, 8, 8], color: "#FFFFFFFF", cornerRadius: 16 },
            children: [
              { id: "chip_a", type: "rectangle", name: "Chip A", props: { size: [96, 48], color: "#FF6F91FF", cornerRadius: 12 } },
              { id: "chip_b", type: "rectangle", name: "Chip B", props: { size: [96, 48], color: "#FFB36BFF", cornerRadius: 12 } },
              { id: "chip_c", type: "rectangle", name: "Chip C", props: { size: [96, 48], color: "#6A5ACDFF", cornerRadius: 12 } },
            ],
          },
        },
      ],
      { label: "Add chips" },
    ),
  );
  await page.waitForTimeout(250);
  ab = await artboard(page);
  await page.keyboard.down(mod);
  await page.mouse.click(...toPage(ab, [80, 812]));
  await page.keyboard.up(mod);
  // Past chip C's center (x = 292): lands last.
  await drag(page, toPage(ab, [80, 812]), toPage(ab, [320, 812]), { hold: (p) => shot(p, "canvas-14-layout-reorder") });
  const order = (await sessionEval(page, (s) => (s.document.getState().doc.components.main.layers as { id: string; children?: { id: string }[] }[]).find((l) => l.id === "chips")?.children?.map((c) => c.id))) as string[];
  check("dragging a layout child reorders it", JSON.stringify(order) === '["chip_b","chip_c","chip_a"]', JSON.stringify(order));

  await open(page, "panels=both&theme=light&autoplay=0");
  await page.waitForSelector(".sb-cv__artboard .sonobe-stage");
  ab = await artboard(page);
  await page.mouse.click(...toPage(ab, [346, 186]));
  await page.waitForTimeout(250);
  await shot(page, "canvas-15-light-both");

  // Rulers highlight the selection; ⇧R hides and shows them.
  await open(page, "panels=canvas&autoplay=0");
  await page.waitForSelector(".sb-cv__artboard .sonobe-stage");
  ab = await artboard(page);
  await page.mouse.click(...toPage(ab, [200, 520]));
  await page.waitForTimeout(200);
  await shot(page, "canvas-16-rulers-selection", "[data-testid=canvas-column]");
  await page.keyboard.press("Shift+KeyR");
  await page.waitForTimeout(300);
  check("⇧R hides the rulers", (await page.locator(".sb-cv__ruler").count()) === 0);
  await page.keyboard.press("Shift+KeyR");
  await page.waitForTimeout(300);
  check("⇧R shows the rulers again", (await page.locator(".sb-cv__ruler").count()) === 2);

  // Equal spacing: c is 23 pt from b, a → b is 20 pt; dragging near it snaps to 20.
  await page.keyboard.press("Escape");
  await sessionEval(page, (s) =>
    s.document.getState().apply(
      [
        { op: "addLayer", layer: { id: "tile_a", type: "rectangle", name: "Tile A", props: { position: [40, 640], size: [70, 60], color: "#FF6F91FF", cornerRadius: 12 } } },
        { op: "addLayer", layer: { id: "tile_b", type: "rectangle", name: "Tile B", props: { position: [130, 640], size: [70, 60], color: "#FFB36BFF", cornerRadius: 12 } } },
        { op: "addLayer", layer: { id: "tile_c", type: "rectangle", name: "Tile C", props: { position: [250, 640], size: [70, 60], color: "#6A5ACDFF", cornerRadius: 12 } } },
      ],
      { label: "Add tiles" },
    ),
  );
  await page.waitForTimeout(250);
  ab = await artboard(page);
  let spacingMarks = 0;
  await drag(page, toPage(ab, [285, 670]), toPage(ab, [258, 670]), {
    steps: 10,
    hold: async (p) => {
      spacingMarks = await p.locator(".sb-cv__spacing").count();
      await shot(p, "canvas-17-equal-spacing", "[data-testid=canvas-column]");
    },
  });
  check("dragging shows equal-spacing marks", spacingMarks >= 2, `${spacingMarks} marks`);
  check("equal spacing snaps the gap to match", JSON.stringify(await layerProp(page, "tile_c", "position")) === "[220,640]", JSON.stringify(await layerProp(page, "tile_c", "position")));

  // Drop an image file on the card.
  ab = await artboard(page);
  const dropAt = toPage(ab, [200, 360]);
  await page.evaluate(async ([x, y]) => {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 480);
    gradient.addColorStop(0, "#FFB36B");
    gradient.addColorStop(0.6, "#FF6F91");
    gradient.addColorStop(1, "#3B2A66");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 720, 480);
    ctx.fillStyle = "rgba(255, 233, 176, 0.95)";
    ctx.beginPath();
    ctx.arc(520, 200, 70, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "golden-hour.png", { type: "image/png" }));
    const target = document.querySelector("[data-testid=canvas-column] .sb-cv")!;
    target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    (window as unknown as { __qaDrop?: unknown }).__qaDrop = { dt, x, y };
  }, dropAt);
  await page.waitForTimeout(200);
  check("dragging files over the canvas shows the drop target", (await page.locator(".sb-cv__drop-target").count()) === 1 && ((await page.locator(".sb-cv__drop-label").textContent()) ?? "").includes("Add image"));
  await shot(page, "canvas-18-drop-hover", "[data-testid=canvas-column]");
  await page.evaluate(() => {
    const { dt, x, y } = (window as unknown as { __qaDrop: { dt: DataTransfer; x: number; y: number } }).__qaDrop;
    document.querySelector("[data-testid=canvas-column] .sb-cv")!.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  });
  await page.waitForTimeout(900);
  const images = (await allLayers(page)).filter((l) => l.type === "image");
  check("dropping an image adds an Image layer", images.length === 1 && typeof images[0]?.props.image?.asset === "string", JSON.stringify(images));
  check("the dropped image is selected", JSON.stringify(await selection(page)) === JSON.stringify(images.map((l) => l.id)), JSON.stringify(await selection(page)));
  const decoded = await page.evaluate((id) => {
    const img = document.querySelector<HTMLImageElement>(`[data-testid=canvas-column] .sb-cv__artboard [data-layer="${id}"] img`);
    return img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
  }, images[0]?.id ?? "");
  check("the dropped image draws its pixels", !!decoded && decoded.width === 720 && decoded.height === 480, JSON.stringify(decoded));
  check("the dropped image fits the group it landed in", JSON.stringify((images[0]?.props as { size?: number[] } | undefined)?.size) === "[370,247]", JSON.stringify(images[0]?.props));
  check("the drop is one undo entry", (await historyLabels(page))[0] === "Add image “golden-hour”", JSON.stringify((await historyLabels(page))[0]));
  await shot(page, "canvas-19-dropped", "[data-testid=canvas-column]");

  // Re-fit when the window (and so the panel) shrinks.
  await open(page, "panels=both&autoplay=0");
  await page.waitForSelector(".sb-cv__artboard .sonobe-stage");
  await page.setViewportSize({ width: 1000, height: 640 });
  await page.waitForTimeout(500);
  const fit = await page.evaluate(() => {
    const cv = document.querySelector("[data-testid=canvas-column] .sb-cv")!.getBoundingClientRect();
    const board = document.querySelector("[data-testid=canvas-column] .sb-cv__artboard")!.getBoundingClientRect();
    return board.left >= cv.left && board.right <= cv.right && board.top >= cv.top && board.bottom <= cv.bottom;
  });
  check("the canvas re-fits when the panel shrinks", fit);
  await shot(page, "canvas-20-refit-small");
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function main() {
  mkdirSync(shotsDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--mute-audio", "--autoplay-policy=user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on("pageerror", (err) => errors.push(err.message));
    p.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
  };
  watch(page);
  context.on("page", watch);
  try {
    await viewerQa(context, page);
    await canvasQa(page);
  } finally {
    await browser.close();
  }
  check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  console.log(`\n${passed.length} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log(`Screenshots: ${shotsDir}`);
  process.exitCode = failures.length ? 1 : 0;
}

await main();
