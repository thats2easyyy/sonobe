import { Button } from "../../ui/Button.tsx";
import { openReleasePage, updateStore, useUpdates } from "./updateStore.ts";
import type { UpdateStatus } from "./updatesHost.ts";

export interface UpdateLine {
  text: string;
  /** While downloading: how far along, 0 to 100. */
  percent?: number;
  action?: { label: string; run: "check" | "restart" | "openRelease" | "move" };
}

/** Where this copy stands with updates, as one sentence and at most one thing to do. Null for a copy that never checks. */
export function updateLine(status: UpdateStatus): UpdateLine | null {
  if (status.mode === "off") return null;
  const named = status.version ? `Sonobe ${status.version}` : "A new version of Sonobe";
  switch (status.state) {
    case "checking":
      return { text: "Checking for updates…" };
    case "upToDate":
      return { text: "Sonobe is up to date.", action: { label: "Check again", run: "check" } };
    case "available":
      // Moving to Applications is the one thing that lets this copy update itself, so it's offered ahead of the download.
      return { text: `${named} is available.${status.reason ? ` ${status.reason}` : ""}`, action: status.canMove ? { label: "Move to Applications", run: "move" } : { label: "Download", run: "openRelease" } };
    case "downloading":
      return { text: `Downloading ${named}…`, percent: Math.round((status.progress ?? 0) * 100) };
    case "ready":
      return { text: `${named} is ready to install.`, action: { label: "Restart to Update", run: "restart" } };
    case "failed": {
      const error = status.error;
      const offerPage = error !== null && error.kind !== "network" && error.kind !== "no-release";
      return { text: error ? `${error.message} ${error.hint}`.trim() : "Sonobe couldn't check for updates.", action: offerPage ? { label: "Open release page", run: "openRelease" } : { label: "Check again", run: "check" } };
    }
    default:
      return { text: status.autoCheck ? "Sonobe hasn't checked for updates yet." : "Automatic update checks are off.", action: { label: "Check now", run: "check" } };
  }
}

/** About's update line: the state in a sentence, with the one action that fits it. Nothing in the browser or in a copy that never checks. */
export function UpdateStatusLine() {
  const status = useUpdates((s) => s.status);
  const line = status ? updateLine(status) : null;
  if (!status || !line) return null;
  const run = (action: NonNullable<UpdateLine["action"]>["run"]) => {
    const { check, restart, moveToApplications } = updateStore.getState();
    if (action === "check") void check();
    else if (action === "restart") void restart();
    else if (action === "move") void moveToApplications();
    else openReleasePage(status.releaseUrl);
  };
  return (
    <div className="sb-update-line" data-state={status.state}>
      <p className="sb-update-line__text" role="status">
        {line.text}
        {line.percent !== undefined && (
          <span className="sb-update-line__percent sb-tabular" aria-hidden>
            {" "}
            {line.percent}%
          </span>
        )}
      </p>
      {line.action && (
        <Button size="sm" onClick={() => run(line.action!.run)}>
          {line.action.label}
        </Button>
      )}
    </div>
  );
}
