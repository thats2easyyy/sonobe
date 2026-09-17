/** Shared helpers for driving the editor: open it, collect console problems, read runtime state, save screenshots. */

import { expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SonobeTestHook } from "../apps/editor/src/app/testHook.ts";

declare global {
  interface Window {
    __sonobe?: SonobeTestHook;
  }
}

export interface OpenOptions {
  /** Keep the File System Access API (native folder pickers). Default false: projects save in browser storage. */
  fileSystemAccess?: boolean;
  /** Extra path or hash, e.g. "#gallery". */
  path?: string;
}

/** Console errors and uncaught exceptions seen by the page. */
export function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(`${error.name}: ${error.message}`));
  return problems;
}

/** Open the editor and wait for the prototype to render a few frames. */
export async function openEditor(page: Page, options: OpenOptions = {}): Promise<void> {
  await page.addInitScript((keepFsa) => {
    if (!keepFsa) Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
  }, options.fileSystemAccess ?? false);
  await page.goto(options.path ?? "/");
  await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3, undefined, { timeout: 30_000 });
}

/** "Meta" or "Control": the key the app treats as Mod (it follows navigator.platform, which the Desktop Chrome profile sets to Windows). */
export async function modKey(page: Page): Promise<"Meta" | "Control"> {
  const mac = await page.evaluate(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    return /mac|iphone|ipad|ipod/.test((nav.userAgentData?.platform || nav.platform || nav.userAgent || "").toLowerCase());
  });
  return mac ? "Meta" : "Control";
}

/** Blur any text field so document shortcuts reach the command registry. */
export async function blurFields(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

export async function screenshot(page: Page, name: string): Promise<void> {
  const path = fileURLToPath(new URL(`../apps/editor/screenshots/${name}.png`, import.meta.url));
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
}

/** Evaluate against the test hook. `fn` runs in the page, so it can only use `sonobe` and the serializable `arg`. */
export function hook<T, A = undefined>(page: Page, fn: (sonobe: SonobeTestHook, arg: A) => T, arg?: A): Promise<T> {
  return page.evaluate(
    ({ source, arg }) => {
      const sonobe = window.__sonobe;
      if (!sonobe) throw new Error("window.__sonobe isn't installed");
      return new Function("sonobe", "arg", `return (${source})(sonobe, arg)`)(sonobe, arg) as T;
    },
    { source: fn.toString(), arg },
  );
}

/** Patches of a given type in the root component. */
export const patchesOfType = (page: Page, type: string) => hook(page, (s, t) => Object.entries(s.doc().components[s.doc().project.root]!.patches).filter(([, p]) => p.type === t).map(([id]) => id), type);

/** The stored value of a patch input or layer prop in the root component ("{link}" objects become their link text). */
export const storedInput = (page: Page, address: string) =>
  hook(
    page,
    (s, addr) => {
      const component = s.doc().components[s.doc().project.root]!;
      const plain = (v: unknown) => (v && typeof v === "object" && "link" in (v as object) ? (v as { link: string }).link : v);
      if (addr.startsWith("@")) {
        const [layerId, key] = addr.slice(1).split(".") as [string, string];
        type L = { id: string; props: Record<string, unknown>; children?: L[] };
        const find = (layers: L[]): L | undefined => {
          for (const l of layers) {
            if (l.id === layerId) return l;
            const inner = l.children ? find(l.children) : undefined;
            if (inner) return inner;
          }
          return undefined;
        };
        return plain(find(component.layers as L[])?.props[key]);
      }
      const [patchId, key] = addr.split(".") as [string, string];
      return plain(component.patches[patchId]?.inputs[key]);
    },
    address,
  );

export const patchIds = (page: Page) => hook(page, (s) => Object.keys(s.doc().components[s.doc().project.root]!.patches));

/** The patch editor's React Flow node for a patch or layer ("@id"). */
export const flowNode = (page: Page, id: string): Locator => page.locator(`.react-flow__node[data-id="${id}"]`);

/** A port handle on a flow node ("out:tap", "in:flip"). */
export const handle = (page: Page, nodeId: string, handleId: string): Locator => flowNode(page, nodeId).locator(`.react-flow__handle[data-handleid="${handleId}"]`);

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag with the mouse in small steps (React Flow and the canvas listen to pointer moves). */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 14): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) * 0.1, from.y + (to.y - from.y) * 0.1, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Drag a cable from a handle to a point or another handle. */
export async function dragCable(page: Page, from: Locator, to: Locator | { x: number; y: number }): Promise<void> {
  const start = await centerOf(from);
  const end = "x" in to ? to : await centerOf(to);
  await drag(page, start, end);
}

/** A point in the patch editor pane that isn't covered by a node. */
export async function emptyPanePoint(page: Page, near: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const pane = page.locator(".sb-pe .react-flow__pane");
  const box = await pane.boundingBox();
  if (!box) throw new Error("Patch editor pane isn't visible");
  const rects = await page.locator(".sb-pe .react-flow__node:not(.react-flow__node-comment)").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }));
  const free = (x: number, y: number) => rects.every((r) => x < r.x - 28 || x > r.x + r.width + 28 || y < r.y - 28 || y > r.y + r.height + 28);
  // The free grid point closest to "a little right of the source", away from the floating toolbar and zoom controls.
  const target = { x: near.x + 170, y: near.y };
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (let y = box.y + 64; y < box.y + box.height - 64; y += 16) {
    for (let x = box.x + 32; x < box.x + box.width - 32; x += 16) {
      if (!free(x, y) || Math.hypot(x - near.x, y - near.y) < 90) continue;
      const distance = Math.hypot(x - target.x, y - target.y);
      if (distance < bestDistance) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  }
  if (best) return best;
  const debugPath = fileURLToPath(new URL("../test-results/empty-pane-debug.png", import.meta.url));
  mkdirSync(dirname(debugPath), { recursive: true });
  await page.screenshot({ path: debugPath });
  throw new Error(`No empty space in the patch editor near ${JSON.stringify(near)}. Pane ${JSON.stringify(box)}; ${rects.length} nodes: ${JSON.stringify(rects.map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]))}. Screenshot: ${debugPath}`);
}

export { centerOf };
