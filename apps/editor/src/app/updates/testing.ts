/** A fake `sonobeHost.updates` for tests. Not imported by app code. */

import type { UpdateStatus } from "./updatesHost.ts";

/** A status as the desktop app reports it: an install build that hasn't checked yet, changed by `overrides`. */
export function updateStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    mode: "install",
    reason: null,
    state: "idle",
    current: "0.1.0",
    version: null,
    releaseUrl: "https://github.com/thats2easyyy/sonobe/releases/latest",
    notesUrl: null,
    progress: null,
    error: null,
    manual: false,
    checkedAt: null,
    autoCheck: true,
    updatedFrom: null,
    offerMove: false,
    canMove: false,
    restarting: false,
    ...overrides,
  };
}

export interface FakeUpdatesHost {
  status(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  restart(): Promise<boolean>;
  setAutoCheck(enabled: boolean): Promise<UpdateStatus>;
  moveToApplications(): Promise<boolean>;
  onStatus(cb: (status: UpdateStatus) => void): () => void;
  /** Changes the status and tells every subscriber, as main does. */
  push(patch: Partial<UpdateStatus>): UpdateStatus;
  /** What was called, in order: "check", "restart", "move", "autoCheck:false". */
  calls: string[];
  /** Subscribers right now. */
  listeners(): number;
}

export interface FakeUpdatesOptions {
  /** What Check for Updates… finds. Default: nothing new. */
  found?: Partial<UpdateStatus>;
  /** What restart() resolves. Default false: the person cancelled. */
  restarts?: boolean;
}

export function fakeUpdatesHost(initial: Partial<UpdateStatus> = {}, options: FakeUpdatesOptions = {}): FakeUpdatesHost {
  let status = updateStatus(initial);
  const subscribers = new Set<(status: UpdateStatus) => void>();
  const calls: string[] = [];
  const push = (patch: Partial<UpdateStatus>) => {
    status = { ...status, ...patch };
    for (const cb of [...subscribers]) cb(status);
    return status;
  };
  return {
    status: async () => status,
    check: async () => {
      calls.push("check");
      push({ state: "checking", manual: true, error: null });
      return push({ state: "upToDate", checkedAt: 1, ...options.found });
    },
    restart: async () => {
      calls.push("restart");
      if (options.restarts) return true;
      push({ restarting: true });
      push({ restarting: false });
      return false;
    },
    setAutoCheck: async (enabled) => {
      calls.push(`autoCheck:${enabled}`);
      return push({ autoCheck: enabled });
    },
    moveToApplications: async () => {
      calls.push("move");
      return false;
    },
    onStatus: (cb) => {
      subscribers.add(cb);
      return () => void subscribers.delete(cb);
    },
    push,
    calls,
    listeners: () => subscribers.size,
  };
}
