import { afterEach, describe, expect, it } from "vitest";
import { createAssistantStore } from "../panels/assistant/assistantStore.ts";
import { designStore, initialDesignData } from "../panels/design/designStore.ts";
import { createLessonLayout } from "../panels/learn/lessons/lessonLayout.ts";
import { createLayoutStore } from "../shell/layoutStore.ts";
import { keepBoxClearOfDrawers, keepOneRightDrawer } from "./rightDrawers.ts";

let stop: (() => void) | undefined;
afterEach(() => stop?.());

function setup() {
  const layout = createLayoutStore({ storageKey: null });
  const assistant = createAssistantStore({ persistModel: false });
  const lesson = createLessonLayout({ layout, storageKey: null });
  stop = keepOneRightDrawer(layout, assistant, lesson);
  return { layout, assistant, lesson };
}

describe("keepOneRightDrawer", () => {
  it("shows whichever of Learn and the Assistant opened last", () => {
    const { layout, assistant } = setup();
    layout.getState().setDrawer("learn");
    assistant.getState().show();
    expect(assistant.getState().open).toBe(true);
    expect(layout.getState().drawer).toBeNull();

    layout.getState().toggleDrawer("learn");
    expect(layout.getState().drawer).toBe("learn");
    expect(assistant.getState().open).toBe(false);
  });

  it("leaves the other one alone when a drawer closes", () => {
    const { layout, assistant } = setup();
    assistant.getState().show();
    assistant.getState().hide();
    expect(layout.getState().drawer).toBeNull();
    layout.getState().setDrawer("learn");
    layout.getState().setDrawer(null);
    expect(assistant.getState().open).toBe(false);
  });

  it("doesn't take a docked lesson down when the Assistant opens", () => {
    const { layout, assistant, lesson } = setup();
    layout.getState().setDrawer("learn");
    lesson.enter();
    assistant.getState().show();
    expect(layout.getState().drawer).toBe("learn");
    expect(assistant.getState().open).toBe(true);
  });
});

describe("keepBoxClearOfDrawers", () => {
  function box() {
    designStore.setState(initialDesignData());
    const assistant = createAssistantStore({ persistModel: false });
    const layout = createLayoutStore({ storageKey: null });
    const lesson = createLessonLayout({ layout, storageKey: null });
    stop = keepBoxClearOfDrawers(designStore, assistant, layout, lesson);
    return { assistant, layout, lesson };
  }

  it("closes the Design box when the Assistant opens", () => {
    const { assistant } = box();
    designStore.getState().openBox();
    assistant.getState().show();
    expect(assistant.getState().open).toBe(true);
    expect(designStore.getState().open).toBe(false);
  });

  it("closes the sheet when the box opens over it, and leaves the chat's messages", () => {
    const { assistant } = box();
    assistant.setState({ items: [{ kind: "user", id: "u1", text: "Hi" }] });
    assistant.getState().show();
    designStore.getState().openBox();
    expect(designStore.getState().open).toBe(true);
    expect(assistant.getState().open).toBe(false);
    expect(assistant.getState().items).toHaveLength(1);
  });

  it("closes the box when Learn opens, and Learn when the box opens", () => {
    const { layout } = box();
    designStore.getState().openBox();
    layout.getState().setDrawer("learn");
    expect(designStore.getState().open).toBe(false);
    designStore.getState().openBox();
    expect(layout.getState().drawer).toBeNull();
    expect(designStore.getState().open).toBe(true);
  });

  it("keeps what was typed in the box while it is closed", () => {
    const { layout } = box();
    designStore.getState().openBox();
    designStore.getState().setText("a checkout screen");
    layout.getState().setDrawer("learn");
    expect(designStore.getState().text).toBe("a checkout screen");
  });

  it("leaves a docked lesson and the box together, since the shell makes room", () => {
    const { layout, lesson } = box();
    layout.getState().setDrawer("learn");
    lesson.enter();
    designStore.getState().openBox();
    expect(layout.getState().drawer).toBe("learn");
    expect(designStore.getState().open).toBe(true);
  });

  it("leaves both alone while neither opens", () => {
    const { assistant } = box();
    designStore.getState().openBox();
    designStore.getState().openBox();
    assistant.getState().hide();
    expect(designStore.getState().open).toBe(true);
  });
});
