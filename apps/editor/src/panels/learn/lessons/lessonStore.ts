/**
 * Lesson progress, per viewer: the lesson in progress and its step, and when each lesson was
 * finished. Persisted in localStorage (storage failures keep progress in memory).
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { readJSON, writeJSON } from "../../../ui/lib/storage.ts";

export const LESSON_PROGRESS_KEY = "sonobe.lessons.v1";

export interface ActiveLesson {
  id: string;
  /** Index of the current step. Equal to the step count once every step is done. */
  step: number;
}

export interface LessonProgress {
  active: ActiveLesson | null;
  /** Lesson id → when it was finished (Date.now()). */
  completed: Record<string, number>;
}

export interface LessonProgressState extends LessonProgress {
  start: (id: string) => void;
  /** Move to a step (clamped at 0). */
  goTo: (step: number) => void;
  /** Mark the current step done and move on. `stepCount` finishes the lesson on its last step. */
  advance: (stepCount: number) => void;
  /** Leave the lesson; progress on it is dropped. */
  exit: () => void;
  isCompleted: (id: string) => boolean;
  resetAll: () => void;
}

const EMPTY: LessonProgress = { active: null, completed: {} };

export function sanitizeProgress(input: unknown): LessonProgress {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const activeIn = src.active && typeof src.active === "object" ? (src.active as Record<string, unknown>) : null;
  const active = activeIn && typeof activeIn.id === "string" && typeof activeIn.step === "number" && Number.isInteger(activeIn.step) && activeIn.step >= 0 ? { id: activeIn.id, step: activeIn.step } : null;
  const completed: Record<string, number> = {};
  if (src.completed && typeof src.completed === "object") {
    for (const [id, at] of Object.entries(src.completed as Record<string, unknown>)) if (typeof at === "number" && Number.isFinite(at)) completed[id] = at;
  }
  return { active, completed };
}

export interface LessonStoreOptions {
  /** null disables persistence. */
  storageKey?: string | null;
  now?: () => number;
}

export function createLessonStore(options: LessonStoreOptions = {}): StoreApi<LessonProgressState> {
  const key = options.storageKey === undefined ? LESSON_PROGRESS_KEY : options.storageKey;
  const now = options.now ?? (() => Date.now());
  const initial = key ? sanitizeProgress(readJSON(key, (v): v is unknown => v !== null)) : EMPTY;
  const store = createStore<LessonProgressState>()((set, get) => ({
    ...initial,
    start: (id) => set({ active: { id, step: 0 } }),
    goTo: (step) => set((s) => (s.active ? { active: { ...s.active, step: Math.max(0, Math.round(step)) } } : s)),
    advance: (stepCount) =>
      set((s) => {
        if (!s.active) return s;
        const step = Math.min(stepCount, s.active.step + 1);
        const finished = step >= stepCount;
        return { active: { ...s.active, step }, completed: finished && s.completed[s.active.id] === undefined ? { ...s.completed, [s.active.id]: now() } : s.completed };
      }),
    exit: () => set({ active: null }),
    isCompleted: (id) => get().completed[id] !== undefined,
    resetAll: () => set({ ...EMPTY }),
  }));
  if (key) store.subscribe((s) => writeJSON(key, { active: s.active, completed: s.completed }));
  return store;
}

export const lessonStore = createLessonStore();

export function useLessons<T>(selector: (state: LessonProgressState) => T): T {
  return useStore(lessonStore, selector);
}
