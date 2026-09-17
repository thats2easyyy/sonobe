/** React hooks for HUD data: merged diagnostics, the AI activity feed, tab counts, frame samples, and a ticking clock. */

import type { Severity } from "@sonobe/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { diagnosticsFor } from "../../state/registry.ts";
import { deriveActivityFeed, type ActivityItem } from "./activityModel.ts";
import { countBySeverity, mergeDiagnostics, type HudDiagnostic } from "./diagnosticsModel.ts";
import { pushSample, type PerfSample } from "./perfModel.ts";

/** Document diagnostics (core getDiagnostics) plus runtime issues, errors first. */
export function useHudDiagnostics(): HudDiagnostic[] {
  const session = useEditorSession();
  const doc = useStore(session.document, (s) => s.doc);
  const runtimeDiagnostics = useStore(session.runtime.state, (s) => s.diagnostics);
  return useMemo(() => mergeDiagnostics(diagnosticsFor(doc, session.registry), runtimeDiagnostics), [doc, runtimeDiagnostics, session.registry]);
}

/** Agent work in progress and agent-authored changes, newest first. */
export function useActivityFeed(limit = 200): ActivityItem[] {
  const session = useEditorSession();
  const revision = useStore(session.document, (s) => s.revision);
  const recent = useStore(session.presence, (s) => s.recent);
  const working = useStore(session.presence, (s) => s.working);
  return useMemo(() => {
    const doc = session.document.getState();
    return deriveActivityFeed({ history: doc.historyEntries(limit), redo: doc.redoEntries(limit), recent, working });
    // revision re-derives the history lists, which aren't store state themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, revision, recent, working, limit]);
}

export interface HudCounts {
  consoleErrors: number;
  consoleWarnings: number;
  diagnostics: Record<Severity, number>;
  /** Agent work items in progress. */
  working: number;
}

/** Counts for tab badges and status readouts. */
export function useHudCounts(): HudCounts {
  const session = useEditorSession();
  const consoleErrors = useStore(session.console, (s) => s.counts.error);
  const consoleWarnings = useStore(session.console, (s) => s.counts.warn);
  const working = useStore(session.presence, (s) => s.working.length);
  const diagnostics = useHudDiagnostics();
  const bySeverity = useMemo(() => countBySeverity(diagnostics), [diagnostics]);
  return { consoleErrors, consoleWarnings, diagnostics: bySeverity, working };
}

export interface PerfSamplesOptions {
  /** Samples kept. Default 120 (a minute at the default interval). */
  capacity?: number;
  /** Default 500 ms. */
  intervalMs?: number;
}

/** Frame rate and frame time sampled from the runtime host on an interval. */
export function usePerfSamples(options: PerfSamplesOptions = {}): { samples: PerfSample[]; reset: () => void } {
  const session = useEditorSession();
  const capacity = options.capacity ?? 120;
  const intervalMs = options.intervalMs ?? 500;
  const [samples, setSamples] = useState<PerfSample[]>([]);
  useEffect(() => {
    const read = () => {
      const s = session.runtime.state.getState();
      setSamples((previous) => pushSample(previous, { t: performance.now(), fps: s.fps, frameMs: s.frameMs, playing: s.playing }, capacity));
    };
    read();
    const timer = setInterval(read, intervalMs);
    return () => clearInterval(timer);
  }, [session, capacity, intervalMs]);
  const reset = useCallback(() => setSamples([]), []);
  return { samples, reset };
}

/** Date.now(), refreshed every `intervalMs` (for relative times). */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
