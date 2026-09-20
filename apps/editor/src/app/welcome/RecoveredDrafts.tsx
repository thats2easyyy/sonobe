/**
 * The welcome screen's Recovered section: unsaved work Sonobe kept as drafts that no window has open
 * (left by a crash, a quit or a killed process). Open brings one back, Discard deletes it after
 * asking, and Show in Finder opens its folder. Drafts are never deleted without asking.
 */

import { FolderSearch, LifeBuoy, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DraftInfo } from "../../host/types.ts";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { toast } from "../../ui/Toast.tsx";

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function draftAge(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** "Not saved · 2 h ago · 66 layers", or "Unsaved changes to Checkout Flow · 5 min ago". */
export function draftSummary(draft: DraftInfo, displayName: (path: string) => string, now = Date.now()): string {
  const where = draft.projectPath ? `Unsaved changes to ${displayName(draft.projectPath)}` : "Not saved";
  const size = draft.counts.layers === 1 ? "1 layer" : `${draft.counts.layers} layers`;
  return [where, draftAge(draft.updatedAt, now), size, ...(draft.torn ? ["may be missing its last changes"] : [])].join(" · ");
}

export interface RecoveredDraftsProps {
  titleId: string;
  /** The welcome screen closes once a draft is open. */
  onOpened: () => void;
}

export function RecoveredDrafts({ titleId, onOpened }: RecoveredDraftsProps) {
  const session = useEditorSession();
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    void session
      .recoverableDrafts()
      .then((list) => {
        if (!cancelled) setDrafts(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => refresh(), [refresh]);

  if (drafts.length === 0) return null;
  const displayName = (path: string) => session.host?.displayName(path) ?? path;
  const reveal = session.host?.drafts?.reveal;
  const revealLabel = session.host?.platform === "darwin" ? "Show in Finder" : "Show in Folder";

  const open = async (draft: DraftInfo) => {
    setBusy(draft.id);
    try {
      const result = await session.restoreDraft(draft.id);
      if (result.ok) {
        onOpened();
        toast.success(`Recovered “${draft.name}”`, { description: [...(result.notes ?? []), "It isn't saved yet, and its undo history starts fresh."].join(" ") });
      } else if (!result.cancelled) {
        toast.error(`Couldn't open “${draft.name}”`, { description: result.error ?? "Its files may be damaged." });
        refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  const discard = async (draft: DraftInfo) => {
    const confirmed = await session.dialogs.confirm({
      title: `Discard “${draft.name}”?`,
      message: "Sonobe kept these unsaved changes when it last closed. Discarding deletes them for good.",
      confirmLabel: "Discard",
      danger: true,
    });
    if (!confirmed) return;
    setBusy(draft.id);
    try {
      await session.discardDraft(draft.id);
      setDrafts((list) => list.filter((d) => d.id !== draft.id));
    } catch (err) {
      toast.error(`Couldn't discard “${draft.name}”`, { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="sb-welcome__section sb-welcome__recovered" aria-labelledby={`${titleId}-recovered`}>
      <div className="sb-welcome__section-head">
        <h3 className="sb-welcome__section-title" id={`${titleId}-recovered`}>
          <LifeBuoy size={13} strokeWidth={2} aria-hidden /> Recovered
        </h3>
        <span className="sb-welcome__hint">Unsaved work Sonobe kept</span>
      </div>
      <ul className="sb-welcome__drafts">
        {drafts.map((draft) => (
          <li key={draft.id} className="sb-welcome__draft" data-torn={draft.torn || undefined}>
            <span className="sb-welcome__draft-text">
              <span className="sb-welcome__draft-name">{draft.name}</span>
              <span className="sb-welcome__draft-meta">{draftSummary(draft, displayName)}</span>
            </span>
            <span className="sb-welcome__draft-actions">
              <Button size="sm" variant="primary" loading={busy === draft.id} disabled={busy !== null} onClick={() => void open(draft)} aria-label={`Open ${draft.name}`}>
                Open
              </Button>
              {reveal && <IconButton size="sm" icon={<FolderSearch size={13} />} label={revealLabel} onClick={() => reveal(draft.id)} />}
              <IconButton size="sm" icon={<Trash2 size={13} />} label={`Discard ${draft.name}`} tooltip="Discard" disabled={busy !== null} onClick={() => void discard(draft)} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
