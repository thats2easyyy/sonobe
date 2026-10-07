/**
 * Asking the Assistant about what's selected, against the fake Assistant (e2e/fakeAssistant.ts): the
 * selection shows over the message field and goes with the message, Explain asks in one press (from the
 * chat, the patch's menu and ⌘E), and the layers and patches a reply names are chips that select the
 * item in the editor. No API key or network.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { fakeAssistantSent, installFakeAssistant, releaseFakeGate } from "./fakeAssistant.ts";
import { blurFields, collectConsoleProblems, flowNode, hook, modKey, openEditor, runCommand, screenshot } from "./helpers.ts";

/** What Claude says about Zoom Spring: names it linked by id, two it left plain, an id shown as a name, and a link to nothing. */
const ANSWER = [
  "**[Zoom Spring](#zoom_spring)** is the spring behind the photo's zoom.",
  "",
  "- **What feeds it:** [Zoomed](#zoomed) flips each time [tap_photo](#tap_photo) hears a tap on the [Event Card](#@card).",
  "- **What it changes:** it moves between 0 and 1 with a bounce. Photo Scale turns that into the photo's size, and Card Shadow into its shadow.",
  "",
  "Raise its Bounciness for more wobble. [The old spring](#not_here) is gone.",
].join("\n");

const sheet = (page: Page): Locator => page.locator(".sb-assistant-sheet");
const field = (page: Page): Locator => sheet(page).getByRole("textbox", { name: "Message the Assistant" });
const selectionRow = (page: Page): Locator => sheet(page).locator(".sb-assistant-selection");
const reply = (page: Page): Locator => sheet(page).locator(".sb-assistant-msg[data-role='assistant'] .sb-assistant-msg__md").last();
const mention = (page: Page, name: string): Locator => reply(page).getByRole("button", { name, exact: true });
const selected = (page: Page) => hook(page, (s) => ({ patches: [...s.session.selection.getState().patches], layers: [...s.session.selection.getState().layers] }));
const select = (page: Page, items: { patches?: string[]; layers?: string[] }) => hook(page, (s, i) => s.session.selection.getState().select({ patches: i.patches ?? [], layers: i.layers ?? [], comments: [] }), items);
const finished = (page: Page) => expect(sheet(page).getByRole("button", { name: "Send" })).toBeVisible();

test.describe("asking the Assistant about a selection", () => {
  test("the selection goes with the message, and the names in the reply select what they name", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: "", answer: ANSWER });
    await openEditor(page);

    await flowNode(page, "zoom_spring").click();
    await runCommand(page, "Assistant");

    // What's selected is over the message field, and the starters ask about it.
    await expect(selectionRow(page)).toHaveAccessibleName("Goes with your message: Zoom Spring");
    await expect(selectionRow(page).getByRole("button", { name: "Zoom Spring", exact: true })).toBeVisible();
    await expect(field(page)).toHaveAttribute("placeholder", "Ask about the selection or describe a change…");
    await expect(sheet(page).locator(".sb-assistant-suggestion")).toHaveText(["What does this do?", "How does this work?", "What's happening here?"]);

    await sheet(page).getByRole("button", { name: "What does this do?" }).click();
    await finished(page);
    expect((await fakeAssistantSent(page)).at(-1)).toEqual({
      text: "What does this do?",
      model: "claude-sonnet-5",
      selection: { component: { id: "main", name: "Main" }, items: [{ kind: "patch", id: "zoom_spring", name: "Zoom Spring", type: "popAnimation" }] },
    });

    // The message keeps its chips, and the reply's names are chips: linked by id, found by name, and an id shown by its name.
    await expect(sheet(page).locator(".sb-assistant-msg__about").getByRole("button", { name: "Zoom Spring", exact: true })).toBeVisible();
    await expect(reply(page).locator(".sb-mention")).toHaveText(["Zoom Spring", "Zoomed", "Tap Photo", "Event Card", "Photo Scale", "Card Shadow"]);
    await expect(reply(page)).toContainText("The old spring is gone.");
    await expect(reply(page).locator("a")).toHaveCount(0);
    await expect(mention(page, "Zoom Spring")).toHaveAttribute("data-selected", "true");
    await screenshot(page, "assistant-ask-01-reply");

    // Pointing at a name highlights the item; pressing it selects it, and the chat's selection follows.
    await mention(page, "Tap Photo").hover();
    await expect(flowNode(page, "tap_photo").locator(".sb-pe-node")).toHaveAttribute("data-pointed", "true");
    await mention(page, "Tap Photo").click();
    expect(await selected(page)).toEqual({ patches: ["tap_photo"], layers: [] });
    await expect(mention(page, "Tap Photo")).toHaveAttribute("data-selected", "true");
    await expect(mention(page, "Zoom Spring")).not.toHaveAttribute("data-selected", /.*/);
    await expect(selectionRow(page)).toHaveAccessibleName("Goes with your message: Tap Photo");

    // Reading along keeps the graph's zoom: a patch in view doesn't move it, and one off screen pans to it.
    const view = () => page.locator(".sb-pe .react-flow__viewport").evaluate((el) => (el as HTMLElement).style.transform);
    const scale = (transform: string) => /scale\(([^)]+)\)/.exec(transform)?.[1];
    const before = await view();
    await mention(page, "Zoomed").click();
    expect(await selected(page)).toEqual({ patches: ["zoomed"], layers: [] });
    await page.waitForTimeout(400);
    expect(await view()).toBe(before);
    await mention(page, "Photo Scale").click();
    await expect.poll(view).not.toBe(before);
    await page.waitForTimeout(400);
    expect(scale(await view())).toBe(scale(before));
    await expect(flowNode(page, "photo_scale")).toBeInViewport({ ratio: 1 });

    await mention(page, "Event Card").click();
    expect(await selected(page)).toEqual({ patches: [], layers: ["card"] });
    await expect(selectionRow(page)).toHaveAccessibleName("Goes with your message: Event Card");

    // × leaves it out of the next message; another selection shows again.
    await selectionRow(page).getByRole("button", { name: "Leave the selection out of the message" }).click();
    await expect(selectionRow(page)).toHaveCount(0);
    await field(page).fill("Add a like counter");
    await field(page).press("Enter");
    await finished(page);
    expect((await fakeAssistantSent(page)).at(-1)).toEqual({ text: "Add a like counter", model: "claude-sonnet-5" });

    await select(page, { patches: ["zoomed", "zoom_spring"] });
    await expect(selectionRow(page)).toHaveAccessibleName("Goes with your message: Zoomed and Zoom Spring");
    await selectionRow(page).getByRole("button", { name: "Explain" }).click();
    await finished(page);
    const explained = (await fakeAssistantSent(page)).at(-1)!;
    expect(explained.text).toBe("What do these do, and how do they work together?");
    expect(explained.selection?.items.map((i) => i.id)).toEqual(["zoomed", "zoom_spring"]);

    await page.getByRole("button", { name: "Use light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await mention(page, "Photo Scale").hover();
    await screenshot(page, "assistant-ask-03-light");

    expect(problems).toEqual([]);
  });

  test("Explain with Claude asks from the patch's menu and from the keyboard", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: "", answer: ANSWER });
    await openEditor(page);

    await flowNode(page, "like_spring").click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Explain with Claude/ }).click();
    await expect(sheet(page)).toBeVisible();
    await finished(page);
    expect((await fakeAssistantSent(page)).at(-1)).toMatchObject({ text: "What does this do, and how does it work?", selection: { items: [{ kind: "patch", id: "like_spring", name: "Like Spring", type: "popAnimation" }] } });
    await expect(field(page)).toBeFocused();

    // From the keyboard, with a layer and a patch selected.
    await select(page, { patches: ["liked"], layers: ["like_button"] });
    await blurFields(page);
    await page.keyboard.press(`${await modKey(page)}+e`);
    await finished(page);
    const sent = await fakeAssistantSent(page);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toBe("What do these do, and how do they work together?");
    expect(sent[1]!.selection?.items).toEqual([
      { kind: "patch", id: "liked", name: "Liked", type: "switch" },
      { kind: "layer", id: "like_button", name: "Like Button", type: "group" },
    ]);

    // Nothing selected: there's nothing to explain.
    await select(page, {});
    await blurFields(page);
    await page.keyboard.press(`${await modKey(page)}+e`);
    expect(await fakeAssistantSent(page)).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  test("Explain with Claude asks from the layer list's menu and from Patch Info", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: "", answer: ANSWER });
    await openEditor(page);

    await page.getByRole("treeitem", { name: /Like Button/ }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Explain with Claude/ }).click();
    await finished(page);
    expect((await fakeAssistantSent(page)).at(-1)).toMatchObject({ text: "What does this do, and how does it work?", selection: { items: [{ kind: "layer", id: "like_button", name: "Like Button", type: "group" }] } });

    // Patch Info says what the patch type does; its button asks what this one does here.
    await flowNode(page, "heart_color").click();
    await page.keyboard.press(`${await modKey(page)}+i`);
    const info = page.getByRole("dialog", { name: "Patch info" });
    await expect(info).toContainText("Heart Color");
    await screenshot(page, "assistant-ask-02-patch-info");
    await info.getByRole("button", { name: "Explain with Claude" }).click();
    await expect(info).toHaveCount(0);
    await finished(page);
    const sent = await fakeAssistantSent(page);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ text: "What does this do, and how does it work?", selection: { items: [{ kind: "patch", id: "heart_color", name: "Heart Color", type: "transition" }] } });
    expect(problems).toEqual([]);
  });

  test("before the Assistant has a key, Explain with Claude opens its setup and asks nothing", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await installFakeAssistant(page, { html: "", answer: ANSWER, hasKey: false });
    await openEditor(page);

    await flowNode(page, "like_spring").click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Explain with Claude/ }).click();
    await expect(sheet(page).getByText("Use your own Anthropic API key")).toBeVisible();
    // No question went out to come back as an error: the chat is empty when the key is in.
    await page.waitForTimeout(300);
    expect(await fakeAssistantSent(page)).toEqual([]);
    await expect(sheet(page).locator(".sb-assistant-msg")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("a name that's half written while the reply streams waits, and a patch's name opens the patch editor", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    // The reply stops in the middle of "[Zoomed](#zoomed)".
    await installFakeAssistant(page, { html: "", answer: ANSWER, answerHold: ANSWER.indexOf("](#zoomed)") + 6 });
    await openEditor(page);
    await runCommand(page, "Canvas Only");
    await select(page, { layers: ["card"] });
    await runCommand(page, "Assistant");
    await field(page).fill("How does the zoom work?");
    await field(page).press("Enter");

    await expect(reply(page)).toContainText("What feeds it:");
    await expect(reply(page).locator(".sb-mention")).toHaveText(["Zoom Spring"]);
    await expect(reply(page)).not.toContainText("[Zoomed");
    await expect(reply(page)).not.toContainText("#zoom");
    await releaseFakeGate(page);
    await finished(page);
    await expect(reply(page).locator(".sb-mention")).toHaveCount(6);

    // The patch editor was hidden: a patch's name brings it back, with the patch selected.
    await expect(page.locator(".sb-pe__canvas")).toHaveCount(0);
    await mention(page, "Photo Scale").click();
    await expect(flowNode(page, "photo_scale")).toBeVisible();
    expect(await selected(page)).toEqual({ patches: ["photo_scale"], layers: [] });
    expect(problems).toEqual([]);
  });
});
