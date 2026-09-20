/**
 * Fire in the Inspector: a Text Field's pulse properties (Set Text, Begin Editing, End Editing) fire
 * into the running prototype from their rows, and the document doesn't change. Patch pulse inputs
 * keep the "Fires only from a connection" hint.
 */

import { expect, test } from "@playwright/test";
import { collectConsoleProblems, hook, openEditor, screenshot } from "./helpers.ts";

test("fires a Text Field's pulse properties into the viewer from the Inspector", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await openEditor(page);
  const applied = await hook(page, (s) =>
    s.apply(
      [
        { op: "addLayer", layer: { id: "composer", type: "textField", name: "Composer", props: { position: [20, 110], size: [350, 44], textToSet: "Hello from the Inspector" } } },
        { op: "addPatch", patch: { id: "mode", type: "switch", name: "Mode", ui: { x: 40, y: 1400 } } },
      ],
      "Add composer",
    ),
  );
  expect(applied.ok).toBe(true);
  const revision = await hook(page, (s) => s.revision());
  await hook(page, (s) => s.session.selection.getState().select({ layers: ["composer"], patches: [], comments: [] }));
  for (const more of await page.locator(".sb-insp-section__more").all()) await more.click();

  const field = page.locator('#sb-viewer [data-key="composer"] input');
  await page.getByRole("button", { name: "Fire Set Text" }).click();
  await expect(field).toHaveValue("Hello from the Inspector");
  await page.getByRole("button", { name: "Fire Begin Editing" }).click();
  await expect(field).toBeFocused();
  await screenshot(page, "inspector-fire-01-text-field");
  await page.getByRole("button", { name: "Fire End Editing" }).click();
  await expect(field).not.toBeFocused();
  expect(await hook(page, (s) => s.revision())).toBe(revision);

  await hook(page, (s) => s.session.selection.getState().select({ layers: [], patches: ["mode"], comments: [] }));
  const flip = page.locator(".sb-insp-row", { has: page.locator(".sb-insp-row__name", { hasText: /^Flip$/ }) });
  await expect(flip).toContainText("Fires only from a connection");
  await expect(flip.getByRole("button", { name: /^Fire/ })).toHaveCount(0);
  expect(problems).toEqual([]);
});
