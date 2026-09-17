/**
 * Lesson contracts. A lesson is a starter prototype plus steps. Each step has instructions, a UI
 * element to spotlight, and a check over the live editor state: the document (read through the
 * same address model the MCP tools use), pulses that fired in the running prototype, runtime values,
 * the selection, the layout, and Connect Claude activity.
 */

import type { Component, Id, Registry, SonobeDocument } from "@sonobe/core";

export type LessonViewMode = "canvas" | "split" | "patches";
export type LessonHudTab = "console" | "diagnostics" | "ai" | "performance";

export interface LessonUiState {
  viewMode: LessonViewMode;
  drawer: string | null;
  hudTab: LessonHudTab;
  hudCollapsed: boolean;
}

export interface LessonConnectState {
  open: boolean;
  /** Times the Connect Claude dialog was opened this session. */
  openCount: number;
  /** When a setup command, config, or prompt was last copied. */
  copied: Partial<Record<"setup" | "config" | "prompt", number>>;
}

export interface LessonContext {
  doc: SonobeDocument;
  /** The prototype's root component, where lessons build. */
  component: Component;
  /** Pulse outputs that fired since the step started ("tap_photo.tap" → count). */
  fired: ReadonlyMap<string, number>;
  /** A live value from the running prototype ("card_zoomed.on", "@card.scale"), or undefined. */
  value: (address: string) => unknown;
  /** How many copies of a layer the viewer draws (loops replicate layers). */
  copies: (layerId: Id) => number;
  selection: { layers: readonly Id[]; patches: readonly Id[] };
  ui: LessonUiState;
  connect: LessonConnectState;
  /** Changes made by an agent (Claude) this session. */
  agentChanges: number;
}

export interface LessonCheckResult {
  done: boolean;
  /** Progress feedback while the step isn't done yet ("Connected to Progress. Now set End."). */
  hint?: string | null;
}

/** `start` is the context when the step began, for "since this step started" checks. */
export type LessonCheck = (ctx: LessonContext, start: LessonContext) => boolean | LessonCheckResult;

export interface LessonTarget {
  /** CSS selector for the element to spotlight. */
  selector: string;
  /** Spotlight the closest ancestor matching this selector instead (e.g. a whole tree row). */
  closest?: string;
}

export interface LessonApp {
  setViewMode(mode: LessonViewMode): void;
  showHudTab(tab: LessonHudTab): void;
  openConnect(): void;
}

export interface LessonStep {
  id: string;
  title: string;
  /** Instructions. Plain text with **bold** and `code`. */
  body: string;
  /** A second, smaller line: a shortcut, a why, or what to do when stuck. */
  tip?: string;
  /** What to spotlight while this step is active. */
  target?: LessonTarget | ((ctx: LessonContext) => LessonTarget | null);
  check: LessonCheck;
  /** Shows a button that completes the step by hand (for things that happen outside Sonobe). */
  manual?: string;
  /** Put the app in the right state when the step starts. */
  prepare?: (app: LessonApp) => void;
}

export interface Lesson {
  id: string;
  number: number;
  title: string;
  summary: string;
  /** Learning path level (docs/guides README). */
  level: 0 | 1 | 2 | 3 | 4;
  minutes: number;
  /** "You'll be able to…" */
  outcomes: readonly string[];
  /** Related guide slug in docs/guides. */
  guide?: string;
  /** The prototype the lesson starts from. Without one, the lesson keeps the open prototype. */
  starter?: (registry: Registry) => SonobeDocument;
  steps: readonly LessonStep[];
  celebrate: { title: string; body: string };
}
