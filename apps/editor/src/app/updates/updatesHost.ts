/**
 * The desktop app's updates (`sonobeHost.updates`), detected at runtime so the editor keeps working in
 * the browser, in tests, and with an older preload. Mirrors `UpdateStatus`, `UpdateProblem` and
 * `SonobeUpdates` in apps/desktop/electron/host-api.d.ts. Keep in sync.
 */

import { getDesktopHostApi } from "../../host/detect.ts";

export type UpdateMode = "install" | "notify" | "off";
export type UpdateState = "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "failed";
export type UpdateProblemKind = "network" | "no-release" | "damaged" | "rejected" | "location" | "other";
export type UpdatePhase = "check" | "download" | "install";

/** What went wrong with an update, in words for people. */
export interface UpdateProblem {
  kind: UpdateProblemKind;
  /** What Sonobe was doing. A check that failed has found no version; a download or an install that failed has one behind it. */
  phase: UpdatePhase;
  message: string;
  /** What to do about it. */
  hint: string;
}

export interface UpdateStatus {
  /** install: downloads a new version and offers Restart to Update. notify: only says there is one. off: never checks. */
  mode: UpdateMode;
  /** Why this copy can't do more, as a sentence; null when nothing needs saying. */
  reason: string | null;
  state: UpdateState;
  /** This app's version. */
  current: string;
  /** The newer version, once a check found one. */
  version: string | null;
  /** The release page of `version`, or of the latest release. */
  releaseUrl: string;
  /** This version's release notes, on the first launch after an update. */
  notesUrl: string | null;
  /** 0 to 1 while downloading. */
  progress: number | null;
  error: UpdateProblem | null;
  /** The person asked for the check behind this state, so it deserves an answer even when nothing is new. */
  manual: boolean;
  /** How many times the person has chosen Check for Updates… in this launch. Each one is answered. */
  asks: number;
  /** "Check for updates automatically". */
  autoCheck: boolean;
  /** The version this copy ran as before, on the first launch after an update, until one window has been told. */
  updatedFrom: string | null;
  /** Nobody has been offered the move to Applications yet. */
  offerMove: boolean;
  /** Moving the app to Applications would let it update itself. */
  canMove: boolean;
  /** Restart to Update is closing the windows. Back to false with the state still `ready`: the person cancelled. */
  restarting: boolean;
}

export interface UpdatesHost {
  status(): Promise<UpdateStatus | null>;
  check(): Promise<UpdateStatus | null>;
  /** Resolves false when the person cancelled or the restart didn't happen. */
  restart(): Promise<boolean>;
  setAutoCheck(enabled: boolean): Promise<UpdateStatus | null>;
  moveToApplications(): Promise<boolean>;
  onStatus(cb: (status: UpdateStatus) => void): () => void;
}

const MODES: readonly UpdateMode[] = ["install", "notify", "off"];
const STATES: readonly UpdateState[] = ["idle", "checking", "upToDate", "available", "downloading", "ready", "failed"];
const KINDS: readonly UpdateProblemKind[] = ["network", "no-release", "damaged", "rejected", "location", "other"];
const PHASES: readonly UpdatePhase[] = ["check", "download", "install"];

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const isFn = (v: unknown): v is (...args: never[]) => unknown => typeof v === "function";

/** A normalized update status, or null when `value` doesn't look like one. */
export function toUpdateStatus(value: unknown): UpdateStatus | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const mode = MODES.find((m) => m === v.mode);
  const state = STATES.find((s) => s === v.state);
  const current = text(v.current);
  if (!mode || !state || !current) return null;
  const e = v.error && typeof v.error === "object" ? (v.error as Record<string, unknown>) : null;
  const message = text(e?.message);
  return {
    mode,
    reason: text(v.reason),
    state,
    current,
    version: text(v.version),
    releaseUrl: text(v.releaseUrl) ?? "",
    notesUrl: text(v.notesUrl),
    progress: typeof v.progress === "number" && Number.isFinite(v.progress) ? Math.min(1, Math.max(0, v.progress)) : null,
    error: message ? { kind: KINDS.find((k) => k === e?.kind) ?? "other", phase: PHASES.find((p) => p === e?.phase) ?? "check", message, hint: text(e?.hint) ?? "" } : null,
    manual: v.manual === true,
    asks: typeof v.asks === "number" && Number.isFinite(v.asks) ? v.asks : 0,
    autoCheck: v.autoCheck !== false,
    updatedFrom: text(v.updatedFrom),
    offerMove: v.offerMove === true,
    canMove: v.canMove === true,
    restarting: v.restarting === true,
  };
}

/** The desktop app's updates, when the host has them. */
export function getUpdatesHost(): UpdatesHost | null {
  if (typeof window === "undefined") return null;
  // e2e only (e2e/fakeUpdates.ts); never in a production build.
  const fake = import.meta.env?.DEV ? (window as unknown as { __sonobeFakeUpdates?: unknown }).__sonobeFakeUpdates : undefined;
  const api = (fake ?? getDesktopHostApi()?.updates) as Partial<Record<keyof UpdatesHost, (...args: never[]) => unknown>> | undefined;
  if (!api || !isFn(api.status) || !isFn(api.check) || !isFn(api.restart) || !isFn(api.setAutoCheck) || !isFn(api.onStatus)) return null;
  const call = (name: keyof UpdatesHost, ...args: unknown[]) => (api[name] as (...a: unknown[]) => unknown)(...args);
  return {
    status: async () => toUpdateStatus(await call("status")),
    check: async () => toUpdateStatus(await call("check")),
    restart: async () => (await call("restart")) === true,
    setAutoCheck: async (enabled) => toUpdateStatus(await call("setAutoCheck", enabled)),
    moveToApplications: async () => isFn(api.moveToApplications) && (await call("moveToApplications")) === true,
    onStatus: (cb) => {
      const off = call("onStatus", (status: unknown) => {
        const next = toUpdateStatus(status);
        if (next) cb(next);
      });
      return isFn(off) ? (off as () => void) : () => undefined;
    },
  };
}
