/**
 * Watches the editor while a lesson step is active and re-checks the step whenever something it can
 * see changes: the document, the selection, the layout, Connect Claude, pulses in the running
 * prototype, and (on a short interval) live values and the viewer's scene.
 */

import { useEffect, useState } from "react";
import { connectClaudeStore } from "../../connect/connectStore.ts";
import { layoutStore } from "../../../shell/layoutStore.ts";
import { useEditorSession } from "../../../state/EditorProvider.tsx";
import type { EditorSession } from "../../../state/session.ts";
import { countLayerCopies, createLessonContext, evaluateStep, stepTarget } from "./runner.ts";
import type { Lesson, LessonApp, LessonContext, LessonTarget } from "./types.ts";

export interface LessonRunnerState {
  /** The step these results belong to (results lag one render behind a step change). */
  step: number;
  done: boolean;
  hint: string | null;
  target: LessonTarget | null;
}

const POLL_MS = 400;

const agentCounters = new WeakMap<EditorSession, { count: number }>();

/** Agent-authored changes to this session's document since lessons first looked. */
export function agentChangeCount(session: EditorSession): number {
  let counter = agentCounters.get(session);
  if (!counter) {
    const created = { count: 0 };
    session.document.getState().subscribeRevision((s, previous) => {
      const change = s.lastChange;
      if (change && change !== previous.lastChange && change.author.kind === "agent") created.count++;
    });
    agentCounters.set(session, created);
    counter = created;
  }
  return counter.count;
}

export const lessonApp: LessonApp = {
  setViewMode: (mode) => layoutStore.getState().setViewMode(mode),
  showHudTab: (tab) => layoutStore.getState().setHudTab(tab),
  openConnect: () => connectClaudeStore.getState().show(),
};

/** Build a LessonContext from the live session. `fired` is the step's pulse tally. */
export function readLessonContext(session: EditorSession, fired: ReadonlyMap<string, number>): LessonContext {
  const layout = layoutStore.getState();
  const selection = session.selection.getState();
  return createLessonContext({
    doc: session.document.getState().doc,
    fired: new Map(fired),
    value: (address) => {
      try {
        return session.runtime.runtime.getValue(address);
      } catch {
        return undefined;
      }
    },
    copies: (layerId) => countLayerCopies(session.runtime.scene(), layerId),
    selection: { layers: selection.layers, patches: selection.patches },
    ui: { viewMode: layout.viewMode, drawer: layout.drawer, hudTab: layout.hudTab, hudCollapsed: layout.collapsed.hud },
    connect: connectClaudeStore.getState(),
    agentChanges: agentChangeCount(session),
  });
}

const sameTarget = (a: LessonTarget | null, b: LessonTarget | null) => a?.selector === b?.selector && a?.closest === b?.closest;

export function useLessonRunner(lesson: Lesson, stepIndex: number, enabled: boolean): LessonRunnerState {
  const session = useEditorSession();
  const [state, setState] = useState<LessonRunnerState>({ step: stepIndex, done: false, hint: null, target: null });
  const step = enabled ? lesson.steps[stepIndex] : undefined;

  useEffect(() => {
    step?.prepare?.(lessonApp);
    // Prepare once per step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, stepIndex, enabled]);

  useEffect(() => {
    if (!step) {
      setState({ step: stepIndex, done: false, hint: null, target: null });
      return;
    }
    const fired = new Map<string, number>();
    const start = readLessonContext(session, fired);
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const evaluate = () => {
      scheduled = undefined;
      const ctx = readLessonContext(session, fired);
      const result = evaluateStep(step, ctx, start);
      const target = stepTarget(step, ctx);
      setState((previous) => (previous.step === stepIndex && previous.done === result.done && previous.hint === result.hint && sameTarget(previous.target, target) ? previous : { step: stepIndex, done: result.done, hint: result.hint, target }));
    };
    const schedule = () => {
      scheduled ??= setTimeout(evaluate, 16);
    };
    const unsubscribers = [
      session.document.subscribe(schedule),
      session.selection.subscribe(schedule),
      layoutStore.subscribe(schedule),
      connectClaudeStore.subscribe(schedule),
      session.presence.subscribe(schedule),
      session.runtime.subscribePulses((fire) => {
        for (const address of fire.addresses) fired.set(address, (fired.get(address) ?? 0) + 1);
        schedule();
      }),
    ];
    const timer = setInterval(schedule, POLL_MS);
    evaluate();
    return () => {
      for (const off of unsubscribers) off();
      clearInterval(timer);
      if (scheduled !== undefined) clearTimeout(scheduled);
    };
  }, [session, step, stepIndex]);

  return state.step === stepIndex ? state : { step: stepIndex, done: false, hint: null, target: null };
}
