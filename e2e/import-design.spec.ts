import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectConsoleProblems, hook, openEditor, runCommand, screenshot } from "./helpers.ts";

const profileHtml = readFileSync(fileURLToPath(new URL("../packages/import/fixtures/profile.html", import.meta.url)), "utf8");

/** Wait for the import hologram to finish (about 3.5 s), so screenshots show the design. */
const hologramDone = (page: Page) => expect(page.locator(".sb-holo")).toHaveCount(0, { timeout: 10_000 });

/** A capture as the Chrome extension copies it. */
const receiptCapture = {
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

const pasteText = (page: Page, text: string) =>
  page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);

interface HoloClock {
  /** performance.now() when the hologram mounted; the clock stops there. */
  start: number | null;
  /** Move the stopped clock to `ms` after the hologram mounted, a few frames at a time. */
  seek(ms: number): Promise<void>;
  /** Run in real time again. */
  resume(): void;
}

/**
 * A page clock that stops the moment the import hologram mounts, so a screenshot can show one exact
 * frame of it: performance.now() and animation frames follow the clock, real time until then.
 */
async function installHoloClock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    const realFrame = window.requestAnimationFrame.bind(window);
    let now = realNow();
    let running = true;
    let queue = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    performance.now = () => now;
    window.requestAnimationFrame = (callback) => {
      queue.set(++nextId, callback);
      return nextId;
    };
    window.cancelAnimationFrame = (id) => void queue.delete(id);
    const flush = () => {
      const due = queue;
      queue = new Map();
      for (const callback of due.values()) {
        try {
          callback(now);
        } catch (error) {
          // Report it as the browser would, without stopping the other frames.
          queueMicrotask(() => {
            throw error;
          });
        }
      }
    };
    const pump = () => {
      if (running) {
        now = realNow();
        flush();
      }
      realFrame(pump);
    };
    realFrame(pump);
    const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const clock: HoloClock = {
      start: null,
      async seek(ms) {
        const target = clock.start! + ms;
        while (now < target) {
          now = Math.min(target, now + 50);
          flush();
          await yieldTask();
        }
        flush();
        await yieldTask();
      },
      resume: () => (running = true),
    };
    (window as unknown as { holoClock: HoloClock }).holoClock = clock;
    new MutationObserver(() => {
      if (clock.start === null && document.querySelector(".sb-holo")) {
        clock.start = now;
        running = false;
      }
    }).observe(document, { subtree: true, childList: true });
  });
}

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
    // The canvas builds the new screen as a hologram: wireframes trace in under a laser sweeping down,
    // then the design materializes as it sweeps back up.
    await expect(page.locator(".sb-holo")).toBeAttached();
    await expect(page.locator('.sb-holo[data-phase="up"]')).toBeAttached({ timeout: 10_000 });
    await hologramDone(page);

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
    await expect(page.locator(".sb-holo")).toBeAttached();
    await hologramDone(page);
    const refreshed = await hook(page, (s, id) => {
      const main = s.doc().components[s.doc().project.root]!;
      const json = JSON.stringify(main.layers);
      return { screens: main.layers.filter((l) => l.name === "Profile").length, keptFollow: json.includes(`"id":"${id}"`), renamed: json.includes("Ava Chen-Park") };
    }, followId);
    expect(refreshed).toEqual({ screens: 1, keptFollow: true, renamed: true });

    await page.getByRole("dialog").waitFor({ state: "detached" }).catch(() => undefined);
    expect(problems).toEqual([]);
  });

  test("builds the imported screen as a hologram with the selection held back until it lands", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installHoloClock(page);
    await openEditor(page);
    await page.evaluate(() => window.__sonobe!.layout().setViewMode("canvas"));
    await runCommand(page, "Import Design");
    const dialog = page.getByRole("dialog", { name: "Import Design" });
    await dialog.getByRole("radio", { name: "Paste HTML" }).click();
    await dialog.getByRole("textbox", { name: "HTML" }).fill(profileHtml);
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.waitForFunction(() => (window as unknown as { holoClock: HoloClock }).holoClock.start !== null, undefined, { polling: 50 });
    const holo = page.locator(".sb-holo");
    await expect(holo).toHaveAttribute("data-phase", "power");
    // The new screen is selected, but its outline and handles wait: they'd sit on the hologram's frame.
    expect((await hook(page, (s) => s.selection().layers)).length).toBe(1);
    await expect(page.locator(".sb-cv__handle")).toHaveCount(0);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".sb-cv img")].every((img) => img.complete), undefined, { polling: 50 });

    // Halfway back up: the design has materialized below the laser, the wireframe still shows above it.
    await page.evaluate(() => (window as unknown as { holoClock: HoloClock }).holoClock.seek(2700));
    await expect(holo).toHaveAttribute("data-phase", "up");
    await expect(page.locator(".sb-cv__handle")).toHaveCount(0);
    await expect(page.getByText("Imported “Profile”")).toBeVisible();
    await screenshot(page, "import-02-hologram");

    await page.evaluate(() => (window as unknown as { holoClock: HoloClock }).holoClock.resume());
    await hologramDone(page);
    await expect(page.locator(".sb-cv__handle").first()).toBeVisible();
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
    const size = await dialog.boundingBox();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog.getByText("Rendering the HTML")).toBeVisible();
    // While it captures, a hologram scanner covers the form, and the dialog keeps its size.
    await expect(dialog.locator(".sb-holo-scan")).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveText("Rendering the HTML");
    expect(await dialog.boundingBox()).toEqual(size);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog.getByText("Rendering the HTML")).toBeHidden();
    await expect(dialog.locator(".sb-holo-scan")).toHaveCount(0);
    expect(await dialog.boundingBox()).toEqual(size);
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

  test("lists every import note behind “N more” when there are more than the toast shows", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    await runCommand(page, "Import Design");
    const dialog = page.getByRole("dialog", { name: "Import Design" });
    await dialog.getByRole("radio", { name: "Paste HTML" }).click();
    // An inner shadow, an image that can't be downloaded, and SF Symbols the browser can't draw: one note each.
    await dialog.getByRole("textbox", { name: "HTML" }).fill(
      [
        '<!doctype html><body style="margin:0;font-family:system-ui">',
        '<div data-name="Card" style="width:300px;height:120px;box-shadow:inset 0 2px 6px #0004;background:#fff">',
        '<img data-name="Photo" src="http://127.0.0.1:9/missing.png" style="width:80px;height:80px">',
        '<svg data-sf-symbol="heart.fill" style="font-size:24px;color:#FF375F"></svg>',
        '<svg data-sf-symbol="star.fill" style="font-size:24px"></svg>',
        "</div></body>",
      ].join(""),
    );
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const toast = page.locator(".sb-toast", { hasText: "Imported “" });
    await expect(toast).toBeVisible();
    const more = toast.getByRole("button", { name: /^\d+ more notes?$/ });
    await expect(more).toBeVisible();
    const hidden = Number((await more.textContent())!.split(" ")[0]);
    await more.click();
    const notes = page.locator(".sb-toast", { hasText: "Import notes for" });
    await expect(notes).toBeVisible();
    await expect(notes.locator(".sb-toast__details li")).toHaveCount(hidden + 2);
    await expect(notes).toContainText("SF Symbol");
    // Clicking ends the hologram early.
    await hologramDone(page);
    await screenshot(page, "import-04-all-notes");
    // The image that can't be downloaded logs a failed request; nothing else should.
    expect(problems.filter((p) => !p.startsWith("Failed to load resource"))).toEqual([]);
  });

  test("pastes a design capture copied from another tool", async ({ page }) => {
    await openEditor(page);
    await pasteText(page, JSON.stringify(receiptCapture));
    await expect(page.getByText("Pasted “Receipt”")).toBeVisible();
    await expect(page.locator(".sb-holo")).toBeAttached();
    const names = await hook(page, (s) => s.doc().components[s.doc().project.root]!.layers.map((l) => l.name));
    expect(names).toContain("Receipt");
    // Undoing the import takes the hologram with it.
    await hook(page, (s) => s.session.document.getState().undo());
    await expect(page.locator(".sb-holo")).toHaveCount(0);
  });

  test("builds Claude's imports as a hologram, but not its other changes", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const addScreen = (label: string) =>
      hook(
        page,
        (s, label) =>
          s.session.document.getState().apply(
            [{ op: "addLayer", component: s.doc().project.root, layer: { type: "group", name: "Receipt", props: { position: [0, 0], size: [402, 874], color: "#FFFFFFFF" }, children: [{ type: "rectangle", name: "Header", props: { position: [0, 0], size: [402, 120] } }] } }],
            { label, author: { kind: "agent", name: "Claude" } },
          ).ok,
        label,
      );
    expect(await addScreen("added a receipt card")).toBe(true);
    await page.waitForTimeout(200);
    await expect(page.locator(".sb-holo")).toHaveCount(0);
    expect(await addScreen("imported Receipt")).toBe(true);
    await expect(page.locator(".sb-holo")).toBeAttached();
    // A click ends it early; it never takes the click from the canvas.
    const canvas = page.locator(".sb-cv");
    await canvas.click({ position: { x: 12, y: 40 } });
    await hologramDone(page);
    expect(problems).toEqual([]);
  });

  test("with reduced motion, crossfades from the wireframe to the design", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page);
    // Record every phase it shows: the whole crossfade takes 300 ms.
    await page.evaluate(() => {
      const phases: string[] = [];
      (window as unknown as { holoPhases: string[] }).holoPhases = phases;
      const note = () => document.querySelectorAll<HTMLElement>(".sb-holo").forEach((el) => phases.at(-1) !== el.dataset.phase && phases.push(el.dataset.phase ?? ""));
      new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-phase"] });
    });
    await pasteText(page, JSON.stringify(receiptCapture));
    await expect(page.getByText("Pasted “Receipt”")).toBeVisible();
    await expect(page.locator(".sb-holo")).toHaveCount(0, { timeout: 2_000 });
    expect(await page.evaluate(() => (window as unknown as { holoPhases: string[] }).holoPhases)).toEqual(["fade"]);
  });
});
