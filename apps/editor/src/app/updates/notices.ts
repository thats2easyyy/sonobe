/**
 * What Sonobe says about updates, as toasts: a new version is ready or available (these stay until
 * dismissed), the answer to Check for Updates…, a failure with what to do, "Sonobe was updated", and
 * the offer to move to the Applications folder. A notice is shown when the status changes into what it
 * describes, so one closed with its ✕ stays closed, and automatic checks say nothing until there is
 * something to act on.
 */

import type { StoreApi } from "zustand/vanilla";
import { toast as kitToast, type ToastOptions } from "../../ui/Toast.tsx";
import { openReleasePage, updateStore, type UpdatesState } from "./updateStore.ts";
import type { UpdateStatus } from "./updatesHost.ts";

/** One toast per subject: a newer notice about the same thing replaces the one that's up. */
export const UPDATE_NOTICE_ID = "app-update";
export const UPDATED_NOTICE_ID = "app-updated";
export const MOVE_NOTICE_ID = "app-update-move";

export type UpdateNoticeAction = "restart" | "openRelease" | "openNotes" | "move";

export interface UpdateNotice extends Pick<ToastOptions, "title" | "description" | "tone" | "duration"> {
  id: string;
  action?: { label: string; run: UpdateNoticeAction };
}

const named = (status: UpdateStatus) => (status.version ? `Sonobe ${status.version}` : "A new version of Sonobe");

/** The notice that describes `status`, whether or not it's time to show it. Null for a state that has none. */
export function describeUpdate(status: UpdateStatus): UpdateNotice | null {
  switch (status.state) {
    case "ready":
      return { id: UPDATE_NOTICE_ID, title: `${named(status)} is ready`, description: "Sonobe restarts, and opens what you had open again.", tone: "info", duration: "persistent", action: { label: "Restart to Update", run: "restart" } };
    case "available":
      return { id: UPDATE_NOTICE_ID, title: `${named(status)} is available`, ...(status.reason ? { description: status.reason } : {}), tone: "info", duration: "persistent", action: { label: "Download", run: "openRelease" } };
    case "downloading":
      return { id: UPDATE_NOTICE_ID, title: `${named(status)} is downloading`, description: "Sonobe says so when it's ready to install.", tone: "info" };
    case "checking":
      return { id: UPDATE_NOTICE_ID, title: "Checking for updates…", tone: "neutral" };
    case "upToDate":
      return { id: UPDATE_NOTICE_ID, title: "Sonobe is up to date", description: `Version ${status.current} is the newest.`, tone: "success" };
    case "failed": {
      const error = status.error;
      if (!error) return null;
      // Nothing to download while nothing is published, and the release page is no help without a connection.
      const offerPage = error.kind !== "network" && error.kind !== "no-release";
      return {
        id: UPDATE_NOTICE_ID,
        title: error.message,
        ...(error.hint ? { description: error.hint } : {}),
        tone: error.kind === "no-release" ? "neutral" : error.kind === "network" ? "warn" : "danger",
        ...(offerPage ? { duration: "persistent" as const, action: { label: "Open release page", run: "openRelease" as const } } : {}),
      };
    }
    default:
      return null;
  }
}

/** Whether a failure is worth interrupting for when nobody asked: not a missing connection, and not "nothing is published yet". */
const loud = (status: UpdateStatus) => status.error !== null && status.error.kind !== "network" && status.error.kind !== "no-release";

/**
 * The notice to show for the change from `previous` to `next`, or null when there's nothing new to say.
 * A check the person asked for is always answered. An automatic one speaks only when a version is
 * ready or available, or when a download failed.
 */
export function noticeFor(previous: UpdateStatus | null, next: UpdateStatus): UpdateNotice | null {
  if (next.mode === "off") return null;
  const entered = !previous || previous.state !== next.state || previous.version !== next.version || previous.error?.message !== next.error?.message;
  // Check for Updates… while an update is already downloading or ready changes nothing but `manual`.
  const asked = next.manual && previous?.manual === false;
  const cancelled = previous?.restarting === true && !next.restarting;
  const quiet = next.state === "checking" || next.state === "upToDate" || next.state === "downloading" || (next.state === "failed" && !loud(next));
  if (quiet ? !(next.manual && (entered || asked)) : !(entered || asked || cancelled)) return null;
  return describeUpdate(next);
}

/** "Sonobe was updated to X", for the first launch of a newer version. */
export function updatedNotice(status: UpdateStatus): UpdateNotice | null {
  if (status.mode === "off" || !status.updatedFrom) return null;
  return { id: UPDATED_NOTICE_ID, title: `Sonobe was updated to ${status.current}`, tone: "success", ...(status.notesUrl ? { action: { label: "Release notes", run: "openNotes" as const } } : {}) };
}

/** The offer to move to the Applications folder, where Sonobe can update itself. */
export function moveNotice(status: UpdateStatus): UpdateNotice | null {
  if (status.mode === "off" || !status.offerMove || !status.canMove) return null;
  return { id: MOVE_NOTICE_ID, title: "Move Sonobe to your Applications folder", description: "From there it can update itself. It opens again with what you have open.", tone: "info", duration: "persistent", action: { label: "Move", run: "move" } };
}

export interface NoticeToaster {
  (options: ToastOptions): unknown;
  dismiss(id: string): void;
}

/**
 * Shows the update notices as the store's status changes. "Sonobe was updated" and the move offer are
 * said once per window. Returns the unsubscribe.
 */
export function attachUpdateNotices(store: StoreApi<UpdatesState> = updateStore, toast: NoticeToaster = kitToast, open: (url: string) => void = openReleasePage): () => void {
  let saidUpdated = false;
  let offeredMove = false;

  const show = (notice: UpdateNotice) => {
    const { action, ...rest } = notice;
    toast({ ...rest, ...(action ? { action: { label: action.label, onClick: () => run(action.run) } } : {}) });
  };

  const run = (action: UpdateNoticeAction) => {
    const { status, restart, moveToApplications } = store.getState();
    if (action === "openRelease" && status) open(status.releaseUrl);
    else if (action === "openNotes" && status?.notesUrl) open(status.notesUrl);
    else if (action === "move") void moveToApplications();
    else if (action === "restart") {
      // The button took its notice down. If Sonobe is still here with the update ready (the person cancelled), it comes back.
      void restart().then((restarted) => {
        const now = store.getState().status;
        const notice = !restarted && now?.state === "ready" ? describeUpdate(now) : null;
        if (notice) show(notice);
      });
    }
  };

  const onStatus = (next: UpdateStatus | null, previous: UpdateStatus | null) => {
    if (!next || next === previous) return;
    const notice = noticeFor(previous, next);
    if (notice) show(notice);
    // The notice that's up described a state that's over.
    else if (previous && (previous.state !== next.state || previous.version !== next.version)) toast.dismiss(UPDATE_NOTICE_ID);
    const updated = saidUpdated ? null : updatedNotice(next);
    if (updated) {
      saidUpdated = true;
      show(updated);
    }
    const move = offeredMove ? null : moveNotice(next);
    if (move) {
      offeredMove = true;
      show(move);
    }
  };

  onStatus(store.getState().status, null);
  return store.subscribe((state, previous) => onStatus(state.status, previous.status));
}
