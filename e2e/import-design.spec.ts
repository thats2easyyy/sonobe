import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectConsoleProblems, hook, openEditor, runCommand, screenshot } from "./helpers.ts";

const profileHtml = readFileSync(fileURLToPath(new URL("../packages/import/fixtures/profile.html", import.meta.url)), "utf8");

test.describe("Import Design", () => {
  test("pastes HTML and adds the screen as named layers in one undo step", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const before = await hook(page, (s) => s.revision());

    await runCommand(page, "Import Design");
    const dialog = page.getByRole("dialog", { name: "Import Design" });
    await expect(dialog).toBeVisible();
    // The browser editor can't read other sites, so the URL tab explains the desktop app.
    await dialog.getByRole("radio", { name: "From URL" }).click();
    await expect(dialog.getByText("needs the Sonobe desktop app")).toBeVisible();

    await dialog.getByRole("radio", { name: "Paste HTML" }).click();
    await dialog.getByRole("textbox", { name: "HTML" }).fill(profileHtml);
    await screenshot(page, "import-01-dialog-html");
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText("Imported “Profile”")).toBeVisible();

    const imported = await hook(page, (s) => {
      const doc = s.doc();
      const main = doc.components[doc.project.root]!;
      const screen = main.layers.find((l) => l.name === "Profile");
      const names: string[] = [];
      const visit = (l: { name: string; children?: unknown[] }) => {
        names.push(l.name);
        for (const c of (l.children ?? []) as { name: string; children?: unknown[] }[]) visit(c);
      };
      if (screen) visit(screen);
      return { found: !!screen, names, selected: s.selection().layers, revision: s.revision(), assets: Object.values(doc.assets).map((a) => a.kind) };
    });
    expect(imported.found).toBe(true);
    for (const name of ["Profile Card", "Ava Chen", "Follow Button", "Home Icon", "Online"]) expect(imported.names).toContain(name);
    expect(imported.selected.length).toBe(1);
    expect(imported.revision).toBe(before + 1);
    expect(imported.assets.filter((k) => k === "image").length).toBeGreaterThanOrEqual(4);
    await screenshot(page, "import-02-imported");

    // Refresh the screen from changed code: it replaces the earlier import and keeps its ids.
    const followId = await hook(page, (s) => {
      const walk = (layers: { id: string; name: string; children?: unknown[] }[]): string | undefined => {
        for (const l of layers) {
          if (l.name === "Follow Button") return l.id;
          const found = walk((l.children ?? []) as { id: string; name: string; children?: unknown[] }[]);
          if (found) return found;
        }
        return undefined;
      };
      return walk(s.doc().components[s.doc().project.root]!.layers);
    });
    await runCommand(page, "Import Design");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: "Paste HTML" }).click();
    await dialog.getByRole("textbox", { name: "HTML" }).fill(profileHtml.replace("Follow\n", "Following\n").replace("<h1>Ava Chen</h1>", "<h1>Ava Chen-Park</h1>"));
    // The selected screen is the one the dialog offers to refresh.
    await expect(dialog.getByRole("button", { name: "Add to the prototype: Replace “Profile”" })).toBeVisible();
    await screenshot(page, "import-03-replace");
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const refreshed = await hook(page, (s, id) => {
      const main = s.doc().components[s.doc().project.root]!;
      const json = JSON.stringify(main.layers);
      return { screens: main.layers.filter((l) => l.name === "Profile").length, keptFollow: json.includes(`"id":"${id}"`), renamed: json.includes("Ava Chen-Park") };
    }, followId);
    expect(refreshed).toEqual({ screens: 1, keptFollow: true, renamed: true });

    await page.getByRole("dialog").waitFor({ state: "detached" }).catch(() => undefined);
    expect(problems).toEqual([]);
  });

  test("cancels a running import without an error or a change", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const before = await hook(page, (s) => s.revision());
    await runCommand(page, "Import Design");
    const dialog = page.getByRole("dialog", { name: "Import Design" });
    await dialog.getByRole("radio", { name: "Paste HTML" }).click();
    await dialog.getByRole("textbox", { name: "HTML" }).fill('<!doctype html><body><p data-name="Late">Loads late</p></body>');
    // Waiting for an element that never appears keeps the import running.
    await dialog.getByRole("button", { name: "More options" }).click();
    await dialog.getByRole("textbox", { name: "Wait for" }).fill("#never");
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog.getByText("Rendering the HTML")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByText("Rendering the HTML")).toBeHidden();
    // Cancel stops the import and keeps the dialog open, with no error.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    expect(await page.locator("iframe[sandbox]").count()).toBe(0);
    expect(await hook(page, (s) => s.revision())).toBe(before);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("pastes a design capture copied from another tool", async ({ page }) => {
    await openEditor(page);
    const capture = {
      format: "sonobe.design-capture",
      version: 1,
      source: { kind: "chrome", title: "Receipt" },
      viewport: { width: 402, height: 874 },
      root: {
        kind: "frame",
        name: "Receipt",
        box: [0, 0, 402, 300],
        fill: "#FFFFFFFF",
        children: [{ kind: "text", name: "Total", text: "Total $24.00", box: [20, 20, 120, 22], style: { fontFamily: "system-ui", fontSize: 17, fontWeight: 600, color: "#111111FF", lineHeight: 22 } }],
      },
      images: {},
    };
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, JSON.stringify(capture));
    await expect(page.getByText("Pasted “Receipt”")).toBeVisible();
    const names = await hook(page, (s) => s.doc().components[s.doc().project.root]!.layers.map((l) => l.name));
    expect(names).toContain("Receipt");
  });
});
