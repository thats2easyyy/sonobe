/**
 * The console starts collapsed to a tab strip. The first time an error shows up in a session (a
 * console error from the prototype or a runtime error), it opens on the tab that has the error.
 * After that it stays wherever the person put it.
 */

import { useEffect } from "react";
import type { HudTab, LayoutStore } from "../shell/layoutStore.ts";
import type { EditorSession } from "../state/session.ts";

export interface ErrorCounts {
  /** Console entries at level "error". */
  console: number;
  /** Runtime diagnostics with severity "error". */
  runtime: number;
}

/** The tab to open when errors newly appear, or null. */
export function hudTabForNewErrors(previous: ErrorCounts, next: ErrorCounts): HudTab | null {
  if (next.console > previous.console) return "console";
  if (next.runtime > previous.runtime) return "diagnostics";
  return null;
}

export interface HudAutoOpener {
  /** Feed the latest counts; opens the HUD at most once. Returns the tab it opened, if any. */
  update(counts: ErrorCounts): HudTab | null;
  readonly opened: boolean;
}

export function createHudAutoOpener(layout: () => Pick<LayoutStore, "collapsed" | "setHudTab">, initial: ErrorCounts = { console: 0, runtime: 0 }): HudAutoOpener {
  let previous = initial;
  let opened = false;
  return {
    get opened() {
      return opened;
    },
    update(counts) {
      const tab = opened ? null : hudTabForNewErrors(previous, counts);
      previous = counts;
      if (!tab) return null;
      opened = true;
      const state = layout();
      // Already visible: leave the person's tab alone.
      if (!state.collapsed.hud) return null;
      state.setHudTab(tab);
      return tab;
    },
  };
}

const runtimeErrors = (session: EditorSession) => session.runtime.state.getState().diagnostics.filter((d) => d.severity === "error").length;

/** Open the HUD on the first error of the session. */
export function useHudAutoOpen(session: EditorSession, layout: () => Pick<LayoutStore, "collapsed" | "setHudTab">): void {
  useEffect(() => {
    const opener = createHudAutoOpener(layout, { console: session.console.getState().counts.error, runtime: runtimeErrors(session) });
    const check = () => {
      if (!opener.opened) opener.update({ console: session.console.getState().counts.error, runtime: runtimeErrors(session) });
    };
    const offConsole = session.console.subscribe(check);
    const offRuntime = session.runtime.state.subscribe((s, p) => {
      if (s.diagnostics !== p.diagnostics) check();
    });
    return () => {
      offConsole();
      offRuntime();
    };
    // `layout` is a stable accessor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
}
