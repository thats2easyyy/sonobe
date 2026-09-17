/**
 * Lesson layout. While a lesson is on screen (its practice prototype is open and the Learn drawer
 * shows it), the drawer docks beside the panels, the Inspector collapses, and the center shows only
 * the patch editor, so the graph has room to read. A step that points at the Inspector shows it
 * until the lesson moves on. Leaving the lesson (exit, close the drawer, open another prototype)
 * puts back the layout from before. The earlier layout is saved in localStorage, so a reload
 * mid-lesson still restores it.
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { layoutStore, type LayoutStore, type ViewMode } from "../../../shell/layoutStore.ts";
import { readJSON, removeKey, writeJSON } from "../../../ui/lib/storage.ts";
import type { LessonTarget } from "./types.ts";

export const LESSON_LAYOUT_KEY = "sonobe.lessons.layout.v1";

/** The parts of the shell layout a lesson changes. */
export interface LessonLayoutSnapshot {
  inspectorCollapsed: boolean;
  viewMode: ViewMode;
}

/** What a lesson shows: the patch editor alone in the center, no Inspector. */
export const LESSON_LAYOUT: LessonLayoutSnapshot = { inspectorCollapsed: true, viewMode: "patches" };

export interface LessonLayoutState {
  /** A lesson is on screen and the shell is in lesson layout (the Learn drawer docks). */
  active: boolean;
  /** The layout from before the lesson (null when there's nothing to restore). */
  snapshot: LessonLayoutSnapshot | null;
  /** The Inspector is showing because the current step points at it. */
  inspectorForStep: boolean;
}

export interface LessonLayout extends StoreApi<LessonLayoutState> {
  /** A lesson came on screen: remember the layout, then apply the lesson layout. */
  enter(): void;
  /** The lesson left the screen: put back the layout from before it. */
  leave(): void;
  /** Restore a layout left behind (a reload or crash mid-lesson) when no lesson is on screen. */
  releaseStale(): void;
  /** Show the Inspector while a step points at it, and collapse it again when a later step doesn't. */
  showPanelsFor(target: LessonTarget | null | undefined): void;
}

export interface LessonLayoutOptions {
  layout?: Pick<StoreApi<LayoutStore>, "getState">;
  /** null disables persistence. */
  storageKey?: string | null;
}

const VIEW_MODES: readonly ViewMode[] = ["canvas", "split", "patches"];

export function isLessonLayoutSnapshot(value: unknown): value is LessonLayoutSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.inspectorCollapsed === "boolean" && VIEW_MODES.includes(v.viewMode as ViewMode);
}

/** True when a lesson target is in (or is) the Inspector. */
export function targetsInspector(target: LessonTarget | null | undefined): boolean {
  return !!target && /^#sb-inspector(?![\w-])/.test(target.selector.trim());
}

function applyLayout(layout: LayoutStore, next: LessonLayoutSnapshot): void {
  if (layout.collapsed.inspector !== next.inspectorCollapsed) layout.toggleCollapsed("inspector", next.inspectorCollapsed);
  if (layout.viewMode !== next.viewMode) layout.setViewMode(next.viewMode);
}

export function createLessonLayout(options: LessonLayoutOptions = {}): LessonLayout {
  const layout = options.layout ?? layoutStore;
  const key = options.storageKey === undefined ? LESSON_LAYOUT_KEY : options.storageKey;
  const stored = key ? (readJSON(key, isLessonLayoutSnapshot) ?? null) : null;
  const store = createStore<LessonLayoutState>()(() => ({ active: false, snapshot: stored, inspectorForStep: false }));

  const restore = () => {
    const { snapshot } = store.getState();
    if (snapshot) applyLayout(layout.getState(), snapshot);
    if (key) removeKey(key);
    store.setState({ active: false, snapshot: null, inspectorForStep: false });
  };

  return Object.assign(store, {
    enter() {
      const current = layout.getState();
      // After a reload mid-lesson the saved snapshot is the real "before"; the layout store already holds the lesson layout.
      const snapshot = store.getState().snapshot ?? { inspectorCollapsed: current.collapsed.inspector, viewMode: current.viewMode };
      if (key) writeJSON(key, snapshot);
      applyLayout(current, LESSON_LAYOUT);
      store.setState({ active: true, snapshot, inspectorForStep: false });
    },
    leave() {
      if (store.getState().active || store.getState().snapshot) restore();
    },
    releaseStale() {
      const { active, snapshot } = store.getState();
      if (!active && snapshot) restore();
    },
    showPanelsFor(target: LessonTarget | null | undefined) {
      const state = store.getState();
      if (!state.active) return;
      const current = layout.getState();
      if (targetsInspector(target)) {
        if (current.collapsed.inspector) {
          current.toggleCollapsed("inspector", false);
          store.setState({ inspectorForStep: true });
        }
      } else if (state.inspectorForStep) {
        if (!current.collapsed.inspector) current.toggleCollapsed("inspector", true);
        store.setState({ inspectorForStep: false });
      }
    },
  });
}

/** The editor's lesson layout. */
export const lessonLayout = createLessonLayout();

export function useLessonLayout<T>(selector: (state: LessonLayoutState) => T): T {
  return useStore(lessonLayout, selector);
}
