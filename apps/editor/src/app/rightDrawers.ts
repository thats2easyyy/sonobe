import type { StoreApi } from "zustand/vanilla";
import { useAssistant, type AssistantState } from "../panels/assistant/assistantStore.ts";
import type { DesignState } from "../panels/design/designStore.ts";
import type { LessonLayoutState } from "../panels/learn/lessons/lessonLayout.ts";
import { useLayout, useLiveDrawerWidth, type LayoutStore } from "../shell/layoutStore.ts";

/** The width of the drawer covering the window's right edge (Learn or the Assistant), or 0: toasts keep clear of it. */
export function useRightDrawerInset(): number {
  const learnOpen = useLayout((s) => s.drawer !== null);
  const assistantOpen = useAssistant((s) => s.open);
  const width = useLayout((s) => s.sizes.drawer);
  const liveWidth = useLiveDrawerWidth();
  return learnOpen || assistantOpen ? (liveWidth ?? width) : 0;
}

/**
 * Learn and the Assistant share the right-hand side: whichever opened last is the one showing. A docked
 * lesson layout stays, so the Assistant opens over it instead of taking it down. Returns the unsubscribe.
 */
export function keepOneRightDrawer(layout: StoreApi<LayoutStore>, assistant: StoreApi<AssistantState>, lesson: StoreApi<LessonLayoutState>): () => void {
  const learnOpened = layout.subscribe((state, previous) => {
    if (state.drawer === "learn" && previous.drawer !== "learn") assistant.getState().hide();
  });
  const assistantOpened = assistant.subscribe((state, previous) => {
    if (state.open && !previous.open && layout.getState().drawer === "learn" && !lesson.getState().active) layout.getState().setDrawer(null);
  });
  return () => {
    learnOpened();
    assistantOpened();
  };
}

/**
 * The Design with Claude box shares the canvas's right edge with the Assistant sheet and the Learn
 * drawer, and both cover it: whichever opened last is the one showing, so the box is never left clipped
 * behind the chat or the lesson it sits beside. The chat keeps running while its sheet is closed. A
 * docked lesson makes room instead of covering, so the box and Learn stay together there. Returns the unsubscribe.
 */
export function keepBoxClearOfDrawers(design: StoreApi<DesignState>, assistant: StoreApi<AssistantState>, layout: StoreApi<LayoutStore>, lesson: StoreApi<LessonLayoutState>): () => void {
  const sheetOpened = assistant.subscribe((state, previous) => {
    if (state.open && !previous.open) design.getState().closeBox();
  });
  const learnOpened = layout.subscribe((state, previous) => {
    if (state.drawer === "learn" && previous.drawer !== "learn" && !lesson.getState().active) design.getState().closeBox();
  });
  const boxOpened = design.subscribe((state, previous) => {
    if (!state.open || previous.open) return;
    assistant.getState().hide();
    if (layout.getState().drawer === "learn" && !lesson.getState().active) layout.getState().setDrawer(null);
  });
  return () => {
    sheetOpened();
    learnOpened();
    boxOpened();
  };
}
