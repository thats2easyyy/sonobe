/**
 * Knobs in the editor: Make Knob from an Inspector field, tuning it in the Knobs tab while the
 * prototype keeps running (no restart), a second preset, Flip Presets (Mod+') with the viewer
 * caption, one undo for a run of flips, the patch editor's knob chip, and the tab in both themes.
 */

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blurFields, collectConsoleProblems, flowNode, hook, modKey, openEditor, screenshot } from "./helpers.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const opacity = (page: Page) => hook(page, (s) => s.getValue("@card.opacity") as number);
const knobValues = (page: Page) => hook(page, (s) => s.doc().knobs?.knobs[0]?.values);
const active = (page: Page) => hook(page, (s) => s.doc().knobs?.active);

test.describe("Knobs", () => {
  test("make a knob, tune it live, compare two presets and undo the flips", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    await hook(page, (s) => s.session.selection.getState().select({ layers: ["card"] }));

    // Make Knob on the card's Opacity.
    const row = page.locator(".sb-insp-row", { has: page.locator(".sb-insp-row__name", { hasText: /^Opacity$/ }) });
    await row.click({ button: "right", position: { x: 20, y: 10 } });
    await page.getByRole("menuitem", { name: "Make Knob…" }).click();
    const name = page.getByRole("textbox", { name: "Knob name" });
    await expect(name).toHaveValue("Opacity");
    await name.fill("Card Fade");
    await page.getByRole("textbox", { name: "Knob group" }).fill("Look");
    await name.press("Enter");
    await expect.poll(() => hook(page, (s) => s.doc().knobs?.knobs.map((k) => k.name))).toEqual(["Card Fade"]);
    await expect(row.locator(".sb-insp-knob__chip")).toHaveText("Card Fade");

    // Show it in Knobs from the toast, then drag its slider: the prototype keeps running.
    await page.locator(".sb-toast").getByRole("button", { name: "Show" }).click();
    await expect(page.getByRole("tab", { name: /Knobs/ })).toHaveAttribute("aria-selected", "true");
    const slider = page.getByRole("slider", { name: "Card Fade" });
    await expect(slider).toBeVisible();
    const frameBefore = await hook(page, (s) => s.frame());
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const tuned = (await knobValues(page))!.default as number;
    expect(tuned).toBeGreaterThan(0.2);
    expect(tuned).toBeLessThan(0.45);
    await expect.poll(() => opacity(page)).toBeCloseTo(tuned, 5);
    expect(await hook(page, (s) => s.frame())).toBeGreaterThan(frameBefore);
    expect(await hook(page, (s) => s.session.document.getState().historyEntries().map((e) => e.label).slice(0, 2))).toEqual([`Tune Card Fade to ${tuned} (Default)`, "Make Knob “Card Fade”"]);
    await page.mouse.move(700, 860);
    await page.waitForTimeout(300);
    await screenshot(page, "knobs-01-tab-dark");

    // A second preset starts as a copy and runs; tune it, then flip back and forth with Mod+'.
    await page.getByRole("button", { name: "Add Preset to Compare" }).click();
    await expect(page.getByRole("radiogroup", { name: "Presets" }).getByRole("radio")).toHaveCount(2);
    await expect.poll(() => active(page)).toBe("preset_2");
    const field = page.getByRole("spinbutton", { name: "Card Fade value" });
    await field.fill("0.9");
    await field.press("Enter");
    await expect.poll(() => opacity(page)).toBeCloseTo(0.9, 5);
    await blurFields(page);
    const mod = await modKey(page);
    const frameBeforeFlip = await hook(page, (s) => s.frame());
    await page.keyboard.press(`${mod}+'`);
    await expect.poll(() => active(page)).toBe("default");
    await expect(page.locator(".sb-vw__preset-caption")).toHaveText("Default");
    await expect.poll(() => opacity(page)).toBeCloseTo(tuned, 5);
    await expect(page.locator(".sb-knob-row").first().locator(".sb-knob-row__diff")).toHaveText("≠");
    await page.keyboard.press(`${mod}+'`);
    await expect.poll(() => active(page)).toBe("preset_2");
    await page.keyboard.press(`${mod}+'`);
    await expect.poll(() => active(page)).toBe("default");
    expect(await hook(page, (s) => s.frame())).toBeGreaterThan(frameBeforeFlip);

    // One undo returns to the preset that ran before the flips, and keeps the tuning.
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(() => active(page)).toBe("preset_2");
    await expect.poll(() => opacity(page)).toBeCloseTo(0.9, 5);
    expect(await hook(page, (s) => s.session.document.getState().historyEntries()[0]!.label)).toBe(`Tune Card Fade to 0.9 (Preset 2)`);

    await page.getByRole("button", { name: "Use light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.mouse.move(700, 860);
    await page.waitForTimeout(400);
    await screenshot(page, "knobs-02-tab-light");
    expect(problems).toEqual([]);
  });

  test("a knob-driven input shows a chip on its node, sized the way the shared estimate says", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    await page.evaluate(() => window.__sonobe!.layout().setViewMode("patches"));
    const result = await hook(page, (s) =>
      s.apply(
        [
          { op: "addKnob", knob: { id: "zoom_bounce", name: "Zoom Bounce", type: "number", value: 6, min: 0, max: 20, step: 0.5 } },
          { op: "setInput", target: "zoom_spring.bounciness", value: { link: "$knob.zoom_bounce" } },
        ],
        "Knob",
      ),
    );
    expect(result.ok).toBe(true);
    const node = flowNode(page, "zoom_spring");
    const chip = node.locator(".sb-pe-value--knob");
    await expect(chip).toContainText("Zoom Bounce");
    await expect(chip).toContainText("6");
    await expect(page.locator('.sb-pe .react-flow__edge[data-id*="zoom_bounce"]')).toHaveCount(0);

    const sizes = await page.evaluate(
      async ({ core }) => {
        const s = window.__sonobe!;
        const graph = await import(/* @vite-ignore */ core);
        const { nodeTextMeasurer } = await import(/* @vite-ignore */ "/src/panels/patch-editor/model/measure.ts");
        const doc = s.doc();
        const model = graph.deriveGraph({ doc, componentId: doc.project.root, registry: s.session.registry });
        const data = model.nodes.find((n: { id: string }) => n.id === "zoom_spring")!.data;
        const el = document.querySelector<HTMLElement>('.sb-pe .react-flow__node[data-id="zoom_spring"]')!;
        const estimate = graph.estimateNodeSize(data, { measure: nodeTextMeasurer(), live: (address: string) => s.session.runtime.runtime.getRawValue(address) });
        const chipEl = el.querySelector<HTMLElement>(".sb-pe-value--knob")!;
        return { dom: { width: el.offsetWidth, height: el.offsetHeight }, estimate, chip: chipEl.offsetWidth };
      },
      { core: `/@fs${path.join(repo, "packages/core/src/graph/index.ts")}` },
    );
    expect(Math.abs(sizes.estimate.width - sizes.dom.width), JSON.stringify(sizes)).toBeLessThanOrEqual(3);
    expect(sizes.estimate.height).toBe(sizes.dom.height);

    // Clicking the chip shows the knob in the Inspector's Knobs tab.
    await chip.click();
    await expect(page.getByRole("tab", { name: /Knobs/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('.sb-knob-row[aria-label="Zoom Bounce"]')).toBeVisible();
    expect(problems).toEqual([]);
  });
});
