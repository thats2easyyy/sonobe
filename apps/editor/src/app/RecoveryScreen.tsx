/**
 * The recovery screen: what the root boundary shows when the editor can't draw at all (ARCHITECTURE §9,
 * Error containment). It says what happened and what became of unsaved work, and offers what helps:
 * reload, copy the error's details, report an issue. The session lives outside React, so its draft
 * keeper still works here; the document's own commands, dialogs and menus went with the tree, so
 * there is no Save.
 */

import { useEffect, useRef, useState } from "react";
import type { EditorSession } from "../state/session.ts";
import { Button } from "../ui/Button.tsx";
import { Tripwire, type BoundaryProblem } from "../ui/ErrorBoundary.tsx";
import { reportIssue } from "./appActions.ts";
import { errorDetails, errorText, keepDraft, type DraftStatus } from "./errorReports.ts";
import { peekAppSession } from "./session.ts";
import "./recovery.css";

export interface RecoveryScreenProps extends Pick<BoundaryProblem, "error" | "componentStack"> {
  /** Default: the app's session, when the editor got as far as starting one. */
  session?: EditorSession | null;
  /** Default: reload the page. */
  reload?: () => void;
}

/** What became of unsaved work, said only as far as the draft keeper confirms it. */
function draftSentence(status: DraftStatus): string {
  switch (status.state) {
    case "clean":
      return "There were no unsaved changes.";
    case "kept":
      return `Your unsaved changes to “${status.name}” are kept as a draft. After you reload, or quit and reopen Sonobe, the welcome screen lists it under Recovered.`;
    case "nothing":
      return `“${status.name}” had no edits to keep.`;
    case "lost":
      return `Sonobe couldn't keep a draft of your unsaved changes to “${status.name}”, so reloading loses them.`;
  }
}

export function RecoveryScreen({ error, componentStack, session = peekAppSession(), reload = () => window.location.reload() }: RecoveryScreenProps) {
  const [draft, setDraft] = useState<DraftStatus | null>(null);
  const [reloading, setReloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const details = errorDetails(error, componentStack);

  // With the draft in (or nothing of the person's to keep), the window stops counting as edited. The document's Save went
  // with the tree, so the desktop app's unsaved-changes prompt could offer only Don't Save, which deletes the draft; this
  // way closing or quitting leaves the draft for the next launch. Without a draft the flag stays, and the prompt still warns.
  const settle = (status: DraftStatus) => {
    setDraft(status);
    if (status.state === "kept" || status.state === "nothing") session?.host?.setDocumentEdited(false);
  };

  useEffect(() => {
    let cancelled = false;
    // Nothing is on screen to stop it with: a prototype left playing would keep its sound and haptics going.
    session?.runtime.pause();
    void keepDraft(session).then((status) => {
      if (!cancelled) settle(status);
    });
    return () => {
      cancelled = true;
    };
    // `settle` reads only the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const onReload = async () => {
    setReloading(true);
    // Edits can't arrive anymore, but the first write may not have landed: wait for it again before the page goes.
    settle(await keepDraft(session));
    reload();
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
    } catch {
      // The clipboard said no: show the text selected, ready for ⌘C.
      if (detailsRef.current) detailsRef.current.open = true;
      if (textRef.current) window.getSelection()?.selectAllChildren(textRef.current);
    }
  };

  return (
    <div className="sb-recovery" role="alert">
      <Tripwire name="The recovery screen" />
      {/* Where the toolbar was, so the window still moves. */}
      <div className="sb-recovery__drag" />
      <div className="sb-recovery__body">
        <h1 className="sb-recovery__title">Sonobe hit a problem</h1>
        <p className="sb-recovery__text">The editor couldn’t draw itself, so it stopped. Reload to start it again.</p>
        {draft && (
          <p className="sb-recovery__text sb-recovery__draft" data-state={draft.state}>
            {draftSentence(draft)}
          </p>
        )}
        <div className="sb-recovery__actions">
          <Button variant="primary" autoFocus loading={reloading} onClick={() => void onReload()}>
            Reload Sonobe
          </Button>
          <Button onClick={() => void onCopy()}>{copied ? "Copied" : "Copy details"}</Button>
          <Button variant="ghost" onClick={() => void reportIssue(session, { error: errorText(error) })}>
            Report an Issue…
          </Button>
        </div>
        <details ref={detailsRef} className="sb-recovery__more">
          <summary>Error details</summary>
          <pre ref={textRef} className="sb-recovery__details sb-selectable sb-scroll">
            {details}
          </pre>
        </details>
      </div>
    </div>
  );
}
