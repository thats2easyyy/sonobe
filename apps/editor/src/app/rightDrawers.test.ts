import { afterEach, describe, expect, it } from "vitest";
import { createAssistantStore } from "../panels/assistant/assistantStore.ts";
import { createLessonLayout } from "../panels/learn/lessons/lessonLayout.ts";
import { createLayoutStore } from "../shell/layoutStore.ts";
import { keepOneRightDrawer } from "./rightDrawers.ts";

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
