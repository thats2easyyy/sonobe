import type { StoreApi } from "zustand/vanilla";
import type { AssistantState } from "../panels/assistant/assistantStore.ts";
import type { LessonLayoutState } from "../panels/learn/lessons/lessonLayout.ts";
import type { LayoutStore } from "../shell/layoutStore.ts";

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
