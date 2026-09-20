import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, connectNewPatch, emptyPanePoint, flowNode, hook, newIds, openEditor, patchIds, runCommand } from "./helpers.ts";

/** One appearance the patch editor painted on a React Flow wrapper (state/appear.ts). */
interface Appeared {
  id: string | null;
  kind: "node" | "cable";
  mode: string;
}

declare global {
  interface Window {
    __appeared?: Appeared[];
  }
}

/** Record every data-appear the editor puts on a node or cable wrapper, from before the app loads. */
async function recordAppearances(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__appeared = [];
    new MutationObserver((records) => {
      for (const record of records) {
        const el = record.target as Element;
        const mode = el.getAttribute("data-appear");
        if (mode) window.__appeared!.push({ id: el.getAttribute("data-id"), kind: el.classList.contains("react-flow__edge") ? "cable" : "node", mode });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-appear"] });
  });
}

const appeared = (page: Page) => page.evaluate(() => window.__appeared ?? []);
const clearAppeared = (page: Page) => page.evaluate(() => void (window.__appeared = []));
const settled = (page: Page) => expect.poll(() => page.locator(".sb-pe [data-appear]").count()).toBe(0);
/**
 * Wait for a reveal to start and play out. It starts once the view is in place, which can be well
 * after the nodes are there (openEditor returns before the first fit), and until it starts nothing
 * carries data-appear, so settled() alone would pass too early.
 */
async function revealPlayed(page: Page): Promise<void> {
  await expect.poll(async () => (await appeared(page)).length).toBeGreaterThan(0);
  await settled(page);
}

test.describe("patch editor: nodes and cables arriving", () => {
  test("a component entered again, at its saved view, reveals every node in view, its interface nodes too", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await recordAppearances(page);
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await revealPlayed(page);
    expect(await hook(page, (s) => s.apply([{ op: "createComponent", component: "main", name: "Heart Logic", patchIds: ["liked", "like_spring"] }], "Group").ok)).toBe(true);
    const enter = () => hook(page, (s) => s.session.selection.getState().enterComponent("heart_logic"));

    for (const pass of ["first", "again"]) {
      await clearAppeared(page);
      await enter();
      await expect(flowNode(page, "$in")).toBeVisible();
      await revealPlayed(page);
      const inView = await page.locator(".sb-pe .react-flow__node").evaluateAll((els) => {
        const pane = document.querySelector(".sb-pe .react-flow__pane")!.getBoundingClientRect();
        return els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > pane.left && r.left < pane.right && r.bottom > pane.top && r.top < pane.bottom;
          })
          .map((el) => el.getAttribute("data-id"))
          .sort();
      });
      expect(inView, pass).toEqual(["$in", "$out", "like_spring", "liked"]);
      const revealed = new Set((await appeared(page)).filter((a) => a.kind === "node").map((a) => a.id));
      expect([...revealed].sort(), pass).toEqual(inView);
      // Back at the root, its own reveal plays before the next entry.
      await clearAppeared(page);
      await hook(page, (s) => s.session.selection.getState().setComponentPath(["main"]));
      await expect(flowNode(page, "tap_photo")).toBeVisible();
      await revealPlayed(page);
      await expect.poll(() => hook(page, (s) => !!s.selection().patchViewports.heart_logic)).toBe(true);
    }
    expect(problems).toEqual([]);
  });

  test("an option-drag copy stays where it was dropped, and so does its cable", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await recordAppearances(page);
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await revealPlayed(page);
    const before = await patchIds(page);
    const title = (await flowNode(page, "zoom_spring").locator(".sb-pe-node__title").boundingBox())!;
    const from = { x: title.x + title.width / 2, y: title.y + title.height / 2 };
    const to = await emptyPanePoint(page, from);
    await clearAppeared(page);
    await page.keyboard.down("Alt");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => newIds(before, await patchIds(page)).length).toBe(1);
    const [copy] = newIds(before, await patchIds(page));
    await expect(flowNode(page, copy!)).toBeVisible();
    await settled(page);
    // Only the ring glows on the copy; nothing fades, travels or draws.
    expect(await appeared(page)).toEqual([{ id: copy, kind: "node", mode: "placed" }]);
    expect(problems).toEqual([]);
  });

  test("the cable dragged into link search stays put while the picked patch fades in at its end", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await recordAppearances(page);
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await revealPlayed(page);
    await clearAppeared(page);
    const id = await connectNewPatch(page, "zoom_spring", "output", "transition", "transition");
    await settled(page);
    expect(await appeared(page)).toEqual([{ id, kind: "node", mode: "still" }]);
    expect(problems).toEqual([]);
  });
});
