/**
 * Interactive lessons for the Learn drawer: a lesson engine (steps with instructions, a spotlight
 * target, and checks over live editor state), progress that persists per viewer, and five lessons.
 */

export { BUILDING_WITH_CLAUDE, FIRST_PROTOTYPE, getLesson, LESSONS, LISTS_WITH_LOOPS, nextLesson, photoChain, SPRING_FEEL, STATES_AND_PULSES } from "./catalog.ts";
export { InlineText, renderInline } from "./InlineText.tsx";
export { createLessonStore, LESSON_PROGRESS_KEY, lessonStore, sanitizeProgress, useLessons, type ActiveLesson, type LessonProgress, type LessonProgressState } from "./lessonStore.ts";
export { ADVANCE_DELAY_MS, LessonPlayer, type LessonPlayerProps } from "./LessonPlayer.tsx";
export { LessonsHome, type LessonsHomeProps } from "./LessonsHome.tsx";
export { findLessonTarget, LessonSpotlight } from "./LessonSpotlight.tsx";
export { findLinked, firedSince, inputSource, isLinked, layerPropSource, layerRef, numberInput, patchesOfType, patchOnLayer, patchSource, type PortRef } from "./queries.ts";
export { countLayerCopies, createLessonContext, DEFAULT_CONNECT, DEFAULT_UI, evaluateStep, loadLessonStarter, stepTarget, type LessonContextInput, type LessonSessionLike } from "./runner.ts";
export { firstPrototypeStarter, listsWithLoopsStarter, springFeelStarter, statesAndPulsesStarter } from "./starters.ts";
export type { Lesson, LessonApp, LessonCheck, LessonCheckResult, LessonConnectState, LessonContext, LessonStep, LessonTarget, LessonUiState } from "./types.ts";
export { agentChangeCount, lessonApp, readLessonContext, useLessonRunner, type LessonRunnerState } from "./useLessonRunner.ts";
