import { expect, test, type Page } from "@playwright/test";
import { blurFields, centerOf, collectConsoleProblems, collectUiWarnings, connectNewPatch, dragCable, fitPatches, flowNode, handle, hook, modKey, newIds, openEditor, patchIds, patchesOfType, runCommand, screenshot, storedInput, touchLayer, waitForPrototype } from "./helpers.ts";

test.describe("building an interaction in the UI", () => {
  test("inserts a patch from the picker", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const before = await patchIds(page);

    // The patch editor's tools sit in the Patches panel header, clear of the graph.
    const tools = page.locator(".sb-app-patches .sb-panel__header").getByRole("toolbar", { name: "Patch editor tools" });
    await expect(tools).toBeVisible();
    await tools.getByRole("button", { name: "Insert patch" }).click();
    const picker = page.getByRole("dialog", { name: "Insert patch" });
    await expect(picker).toBeVisible();
    await page.keyboard.type("counter");
    await expect(picker.getByText("Counter", { exact: true }).first()).toBeVisible();
    await screenshot(page, "app-02-patch-picker");
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();

    await expect.poll(async () => newIds(before, await patchIds(page)).length).toBe(1);
    const [counter] = newIds(before, await patchIds(page));
    expect(await patchesOfType(page, "counter")).toEqual([counter]);
    await expect(flowNode(page, counter!)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("Interaction → Switch → Pop Animation → Transition → @photo.scale, then a tap animates it", async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    const problems = collectConsoleProblems(page);
    const warnings = await collectUiWarnings(page);
    await openEditor(page);
    const mod = await modKey(page);
    await runCommand(page, "Patches Only");

    // Touch on the Photo layer row adds a pre-wired Interaction.
    const interaction = await touchLayer(page, "Photo");
    expect(await storedInput(page, `${interaction}.layer`)).toEqual({ layer: "photo" });

    // Link-drag search builds the rest of the chain.
    const toggle = await connectNewPatch(page, interaction, "tap", "Switch", "switch");
    const toggleInputs = await hook(page, (s, id) => s.doc().components[s.doc().project.root]!.patches[id]!.inputs, toggle);
    expect(Object.values(toggleInputs)).toContainEqual({ link: `${interaction}.tap` });

    const spring = await connectNewPatch(page, toggle, "on", "Pop Animation", "popAnimation");
    expect(await storedInput(page, `${spring}.number`)).toBe(`${toggle}.on`);

    const transition = await connectNewPatch(page, spring, "output", "Transition", "transition");
    expect(await storedInput(page, `${transition}.progress`)).toBe(`${spring}.output`);

    // Drop the Transition's output onto the Photo layer's Scale input (it replaces the demo's driver).
    expect(await storedInput(page, "@photo.scale")).toBe("photo_scale.output");
    await fitPatches(page);
    await dragCable(page, handle(page, transition, "out:output"), handle(page, "@photo", "in:scale"));
    await expect.poll(() => storedInput(page, "@photo.scale")).toBe(`${transition}.output`);

    // Undo and redo the connection from the keyboard.
    await blurFields(page);
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(() => storedInput(page, "@photo.scale")).toBe("photo_scale.output");
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(() => storedInput(page, "@photo.scale")).toBe(`${transition}.output`);

    // Start at 1 and grow to 1.4 through the inspector.
    await flowNode(page, transition).click({ position: { x: 48, y: 10 } });
    await expect.poll(() => hook(page, (s) => s.selection().patches)).toEqual([transition]);
    const inspector = page.locator("#sb-inspector");
    for (const [name, value] of [["Start", "1"], ["End", "1.4"]] as const) {
      const field = inspector.getByRole("spinbutton", { name, exact: true });
      await field.click();
      await field.fill(value);
      await field.press("Enter");
    }
    await expect.poll(() => storedInput(page, `${transition}.start`)).toBe(1);
    await expect.poll(() => storedInput(page, `${transition}.end`)).toBe(1.4);
    await blurFields(page);
    await screenshot(page, "app-03-interaction-wired");

    // Zoom to fit keeps every node header clear of the chrome at the top of the canvas.
    await fitPatches(page);
    const pane = (await page.locator(".sb-pe .react-flow__pane").boundingBox())!;
    const topmost = await page.locator(".sb-pe .react-flow__node:not(.react-flow__node-comment)").evaluateAll((nodes) => Math.min(...nodes.map((n) => n.getBoundingClientRect().top)));
    expect(topmost - pane.y).toBeGreaterThanOrEqual(40);
    await screenshot(page, "stage4-patch-editor-02-wired-fit");

    // Tap the photo in the viewer: scale springs from 1 toward 1.4 over many frames.
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number)).toBeCloseTo(1, 3);
    // The device content layer captures input for the prototype, so tap at the photo's position on screen.
    const photoCenter = await centerOf(page.locator('#sb-viewer [data-layer="photo"]').first());
    // Sampled on every animation frame in the page, from before the tap: the prototype rests once the spring
    // settles, and reads made from here, a round trip each, can miss most of it on a busy machine.
    const recording = hook(
      page,
      (s) =>
        new Promise<{ frame: number; scale: number }[]>((resolve) => {
          const samples: { frame: number; scale: number }[] = [];
          const end = performance.now() + 1500;
          const sample = () => {
            samples.push({ frame: s.frame(), scale: s.getValue("@photo.scale") as number });
            if (performance.now() < end) requestAnimationFrame(sample);
            else resolve(samples);
          };
          requestAnimationFrame(sample);
        }),
    );
    await page.mouse.click(photoCenter.x, photoCenter.y);
    await page.waitForTimeout(240);
    await screenshot(page, "app-04-tap-animating");
    const samples = await recording;
    const frames = new Set(samples.map((s) => s.frame));
    const distinct = new Set(samples.map((s) => s.scale.toFixed(4)));
    expect(frames.size).toBeGreaterThan(8);
    expect(distinct.size).toBeGreaterThan(4);
    expect(samples.some((s) => s.scale > 1.01 && s.scale < 1.39)).toBe(true);
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number), { timeout: 5000 }).toBeGreaterThan(1.38);
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

test.describe("patch editor chrome and graph states", () => {
  test("the toolbar is one Tab stop with arrow-key navigation", async ({ page }) => {
    await openEditor(page);
    const tools = page.locator(".sb-app-patches .sb-panel__header").getByRole("toolbar", { name: "Patch editor tools" });
    const tidy = tools.getByRole("button", { name: "Tidy up" });
    const comment = tools.getByRole("button", { name: "Add comment" });
    const insert = tools.getByRole("button", { name: "Insert patch" });
    const zoom = tools.getByRole("button", { name: /^Patches zoom/ });
    await tidy.focus();
    await page.keyboard.press("ArrowRight");
    await expect(comment).toBeFocused();
    await page.keyboard.press("End");
    await expect(zoom).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tidy).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(zoom).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(insert).toBeFocused();
    await expect(tidy).toHaveAttribute("tabindex", "-1");
    await expect(insert).toHaveAttribute("tabindex", "0");
  });

  test("selecting a node lights its cables, and dragging a cable dims the inputs it can't reach", async ({ page }) => {
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await fitPatches(page);
    const canvas = page.locator(".sb-pe__canvas");
    await expect(page.locator(".sb-pe-cable[data-related]")).toHaveCount(0);
    await flowNode(page, "zoom_spring").locator(".sb-pe-node__header").click();
    await expect(page.locator(".sb-pe-cable[data-related]")).toHaveCount(3);

    const from = await centerOf(handle(page, "zoom_spring", "out:output"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 160, { steps: 6 });
    await expect(canvas).toHaveAttribute("data-connecting", "out");
    await expect(page.locator(".sb-pe-port--in[data-armable='true']").first()).toBeVisible();
    await expect(flowNode(page, "zoom_spring").locator(".sb-pe-port--in[data-armable]")).toHaveCount(0);
    // The dim is a transition: read it until it lands.
    const dimmed = page.locator(".sb-pe-port--in:not([data-armable='true']):not([data-armable='convert']) .sb-pe-port__label").first();
    await expect.poll(async () => Number(await dimmed.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5);
    await page.mouse.up();
    await expect(canvas).not.toHaveAttribute("data-connecting", /.+/);
  });

  test("a patch inserted from the header button lands inside the pane at 1180 wide", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await openEditor(page);
    const before = await patchIds(page);
    await page.locator(".sb-app-patches .sb-panel__header").getByRole("button", { name: "Insert patch" }).click();
    await page.keyboard.type("counter");
    await page.keyboard.press("Enter");
    await expect.poll(async () => newIds(before, await patchIds(page)).length).toBe(1);
    const [counter] = newIds(before, await patchIds(page));
    await expect
      .poll(async () => {
        const pane = await page.locator(".sb-pe .react-flow__pane").boundingBox();
        const box = await flowNode(page, counter!).boundingBox();
        return !!pane && !!box && box.x >= pane.x && box.y >= pane.y && box.x + box.width <= pane.x + pane.width && box.y + box.height <= pane.y + pane.height;
      })
      .toBe(true);
  });

  test("connects with the keyboard alone: arm an output, then connect inputs, Shift keeps it armed", async ({ page }) => {
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await fitPatches(page);
    const hint = page.getByRole("status").filter({ hasText: "Select an input to connect" });
    const focused = page.locator(":focus");

    await flowNode(page, "zoom_spring").focus();
    await page.keyboard.press("ArrowRight");
    await expect(focused).toHaveAttribute("aria-label", /^Number input, number/);
    await page.keyboard.press("ArrowRight");
    await expect(focused).toHaveAttribute("aria-label", /^Output output, number/);
    await expect(page.getByRole("tooltip")).toContainText("Zoom Spring · Output");
    await page.keyboard.press("Enter");
    await expect(hint).toBeVisible();
    await expect(focused).toHaveAttribute("aria-label", /armed/);

    await flowNode(page, "heart_scale").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expect(focused).toHaveAttribute("aria-label", /^Start input, number.*Enter connects Zoom Spring/);
    await page.keyboard.press("Shift+Enter");
    await expect.poll(() => storedInput(page, "heart_scale.start")).toBe("zoom_spring.output");
    await expect(hint).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect.poll(() => storedInput(page, "heart_scale.end")).toBe("zoom_spring.output");
    await expect(hint).toBeHidden();
    await expect(page.getByRole("tooltip")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(flowNode(page, "heart_scale")).toBeFocused();
  });

  test("the keyboard card on an input goes when the armed output is cancelled", async ({ page }) => {
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await fitPatches(page);
    const focused = page.locator(":focus");
    await flowNode(page, "zoom_spring").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await flowNode(page, "heart_scale").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expect(focused).toHaveAttribute("aria-label", /Enter connects Zoom Spring/);
    await expect(page.getByRole("tooltip")).toContainText("Enter connects Zoom Spring");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Select an input to connect" })).toBeHidden();
  });

  test("a cable reached with the keyboard is named by its ends and shows it has focus", async ({ page }) => {
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await fitPatches(page);
    const cable = page.locator(".react-flow__edge").filter({ has: page.locator(".sb-pe-cable") }).first();
    await expect(cable).toHaveAttribute("aria-label", /^.+ to .+, \w/);
    await expect(cable).not.toHaveAttribute("aria-label", /_/);
    await page.keyboard.press("Shift");
    await cable.focus();
    await expect(cable).toBeFocused();
    const wire = cable.locator(".sb-pe-cable__wire");
    await expect.poll(async () => parseFloat(await wire.evaluate((el) => getComputedStyle(el).strokeWidth))).toBeGreaterThanOrEqual(3.5);
    const glow = cable.locator(".sb-pe-cable__glow");
    await expect.poll(async () => glow.evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
    expect(await glow.evaluate((el) => getComputedStyle(el).stroke)).not.toBe(await wire.evaluate((el) => getComputedStyle(el).stroke));
    await page.locator(".sb-pe .react-flow__pane").click({ position: { x: 4, y: 4 } });
    await expect(glow).toBeHidden();
  });

  test("pressing a port leaves focus on the node: Enter renames, and Alt+Right Arrow steps into the ports", async ({ page }) => {
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await fitPatches(page);
    const node = flowNode(page, "zoom_spring");
    await node.locator(".sb-pe-port--out .sb-pe-port__label").click();
    await expect(node).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(node.locator(".sb-pe-title-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(node.locator(".sb-pe-title-input")).toBeHidden();
    await node.focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.locator(":focus")).toHaveAttribute("aria-roledescription", "port");
  });

  test("a refused keyboard connect is explained beside the port, in names", async ({ page }) => {
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await fitPatches(page);
    await flowNode(page, "like_spring").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    const hint = page.getByRole("alert", { name: "Can't connect" });
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText("like_spring");
    // The hint is placed after it mounts: measure it and the port together until they agree.
    await expect(async () => {
      const row = (await page.locator(":focus").boundingBox())!;
      const box = (await hint.boundingBox())!;
      expect(Math.abs(box.x - row.x)).toBeLessThan(60);
      expect(Math.abs(box.y - (row.y + row.height))).toBeLessThan(40);
    }).toPass({ timeout: 5000 });
  });

  test("a refused cable is explained where it was dropped, with the converter to insert", async ({ page }) => {
    await openEditor(page);
    await runCommand(page, "Patches Only");
    await fitPatches(page);
    const before = await patchIds(page);
    const target = handle(page, "card_shadow", "in:start");
    await dragCable(page, handle(page, "heart_color", "out:output"), target);
    const hint = page.getByRole("alert", { name: "Can't connect" });
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("needs a number");
    await expect(async () => {
      const drop = (await target.boundingBox())!;
      const box = (await hint.boundingBox())!;
      expect(Math.abs(box.x - drop.x)).toBeLessThan(60);
      expect(box.y - drop.y).toBeLessThan(60);
    }).toPass({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(hint).toBeHidden();
    await dragCable(page, handle(page, "heart_color", "out:output"), target);
    await hint.getByRole("button", { name: /^Insert / }).click();
    await expect(hint).toBeHidden();
    await expect.poll(async () => newIds(before, await patchIds(page)).length).toBe(1);
  });

  test("naming a new component takes the typing: the field is focused, and no single-key insert fires", async ({ page }) => {
    await openEditor(page);
    const before = await patchIds(page);
    await hook(page, (s) => s.session.selection.getState().select({ patches: ["liked", "like_spring"], comments: [], layers: [] }));
    const pane = (await page.locator(".sb-pe .react-flow__pane").boundingBox())!;
    await page.mouse.move(pane.x + pane.width - 40, pane.y + 60);
    await page.keyboard.press("Control+Alt+g");
    const field = page.getByRole("textbox", { name: "Component name" });
    await expect(field).toBeFocused();
    await page.keyboard.type("Zoom logic");
    await page.keyboard.press("Enter");
    await expect(field).toBeHidden();
    const names = await hook(page, (s) => Object.values(s.doc().components).map((c) => c.name));
    expect(names).toContain("Zoom logic");
    const after = await patchIds(page);
    expect(after.length).toBe(before.length - 1);
    const instance = after.find((id) => !before.includes(id))!;
    expect(await hook(page, (s, id) => s.doc().components[s.doc().project.root]!.patches[id]!.name, instance)).toBe("Zoom logic");
  });

  test("a narrow pane is flagged when the patch editor mounts in it, not only after a resize", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 760 });
    await openEditor(page);
    const canvas = page.locator(".sb-pe__canvas");
    for (const layout of ["Patches Only", "Canvas Only", "Patches Only"]) await runCommand(page, layout);
    // The canvas has no box while the patch editor remounts: keep polling instead of throwing.
    await expect.poll(async () => (await canvas.boundingBox())?.width ?? Infinity).toBeLessThan(300);
    await expect(canvas).toHaveAttribute("data-narrow", "true");
    await expect(canvas).toHaveAttribute("data-compact", "true");
    await expect(page.getByRole("button", { name: "Zoom to fit" })).toBeHidden();
    await expect(page.getByRole("button", { name: /^Patches zoom/ })).toBeVisible();
    await page.reload();
    await expect(canvas).toHaveAttribute("data-narrow", "true");
  });

  test("a layout changed just before a reload is kept", async ({ page }) => {
    await openEditor(page);
    await expect(page.locator(".sb-pe__canvas")).toBeVisible();
    // The layout is saved a moment after a change; the page going away writes it at once.
    const reloaded = page.waitForEvent("load");
    await page.evaluate(() => {
      window.__sonobe!.layout().setViewMode("canvas");
      window.location.reload();
    });
    await reloaded;
    await waitForPrototype(page);
    expect(await hook(page, (s) => s.layout().viewMode)).toBe("canvas");
    await expect(page.locator(".sb-pe__canvas")).toHaveCount(0);
  });

  test("a component path folds into a menu and stays inside the Patches header at 1180 wide", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 });
    await openEditor(page);
    await hook(page, (s) => {
      s.apply(
        [
          { op: "addComponent", component: { id: "swipe_dismiss_card", name: "Swipe to dismiss card with rubber banding", kind: "patchComponent" } },
          { op: "addComponent", component: { id: "nested_inner_component_with_long_name", name: "Nested inner component with a long name", kind: "patchComponent" } },
        ],
        "Add components",
      );
      s.session.selection.getState().enterComponent("swipe_dismiss_card");
      s.session.selection.getState().enterComponent("nested_inner_component_with_long_name");
    });
    const header = page.locator(".sb-app-patches .sb-panel__header");
    const crumbs = header.getByRole("navigation", { name: "Component path" });
    await expect(crumbs.locator("[aria-current]")).toHaveText("Nested inner component with a long name");
    await expect(crumbs.getByRole("button", { name: "Main" })).toBeVisible();
    await expect.poll(() => crumbs.evaluate((nav) => nav.scrollWidth <= nav.clientWidth && nav.getBoundingClientRect().height <= 34)).toBe(true);
    await crumbs.getByRole("button", { name: "1 more level" }).click();
    await page.getByRole("menuitem", { name: "Swipe to dismiss card with rubber banding" }).click();
    await expect(crumbs.locator("[aria-current]")).toHaveText("Swipe to dismiss card with rubber banding");
  });
});

test.describe("the Inspector across selections", () => {
  /** Two rectangles, so selecting one after the other keeps every Inspector row. */
  async function twoLayers(page: Page) {
    await openEditor(page);
    const applied = await hook(page, (s) => {
      const result = s.apply(
        [
          { op: "addLayer", layer: { id: "insp_a", type: "rectangle", name: "Insp A", props: { opacity: 0.5, rotation: 10 } } },
          { op: "addLayer", layer: { id: "insp_b", type: "rectangle", name: "Insp B", props: { opacity: 0.25, rotation: 20 } } },
        ],
        "Two layers",
      );
      s.session.selection.getState().select({ layers: ["insp_a"] });
      return result.ok;
    });
    expect(applied).toBe(true);
  }
  const opacityOf = (page: Page, id: string) => hook(page, (s, id) => s.doc().components[s.doc().project.root]!.layers.find((l) => l.id === id)!.props.opacity, id);
  const selectByHook = (page: Page, id: string) => hook(page, (s, id) => s.session.selection.getState().select({ layers: [id] }), id);

  test("a number typed for one layer is never written to the layer selected next", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await twoLayers(page);
    const opacity = page.locator('.sb-insp input[aria-label="Opacity"]');
    await expect(opacity).toHaveValue("50");
    await opacity.click();
    await page.keyboard.type("33");
    // Pressing a Layers row takes focus first, which commits the number to the layer it was typed for.
    await page.locator(".sb-layerspanel").getByRole("treeitem", { name: "Insp B" }).click();
    await expect(opacity).toHaveValue("25");
    expect(await opacityOf(page, "insp_a")).toBe(0.33);
    expect(await opacityOf(page, "insp_b")).toBe(0.25);

    // With no blur before the selection changes (Claude selects, undo brings a selection back), the draft is dropped.
    await opacity.click();
    await page.keyboard.type("44");
    await selectByHook(page, "insp_a");
    await expect(opacity).toHaveValue("33");
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.locator(".sb-layerspanel").getByRole("treeitem", { name: "Insp B" }).click();
    await expect(opacity).toHaveValue("25");
    expect(await opacityOf(page, "insp_a")).toBe(0.33);
    expect(await opacityOf(page, "insp_b")).toBe(0.25);
    expect(problems).toEqual([]);
  });

  test("its rows stay for the next layer, scrolled where they were, and focus leaves them", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await twoLayers(page);
    const scroller = page.locator(".sb-insp.sb-scroll");
    const row = page.locator(".sb-insp-row", { has: page.locator('input[aria-label="Opacity"]') });
    await row.evaluate((el) => void ((el as HTMLElement & { kept?: boolean }).kept = true));
    await scroller.evaluate((el) => void (el.scrollTop = 150));
    const fill = page.locator(".sb-insp-section__toggle", { hasText: "Fill" });
    await fill.focus();
    await expect(fill).toBeFocused();

    await selectByHook(page, "insp_b");
    await expect(page.locator('.sb-insp input[aria-label="Name"]')).toHaveValue("Insp B");
    expect(await row.evaluate((el) => (el as HTMLElement & { kept?: boolean }).kept === true)).toBe(true);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBe(150);
    // A button that stays is another layer's now: focus leaves it, as it left the Inspector that was rebuilt before.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });
});
