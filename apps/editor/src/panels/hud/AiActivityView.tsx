import { CircleCheck, LoaderCircle, LocateFixed, Plug, Redo2, Undo2 } from "lucide-react";
import type { SonobeDocument } from "@sonobe/core";
import { useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { formatRelativeTime, undoActionLabel, type ActivityItem, type ChangeActivity } from "./activityModel.ts";
import { useActivityFeed, useNow } from "./hooks.ts";
import { itemDisplayName, summarizeNames } from "./itemNames.ts";
import { revealItems } from "./reveal.ts";
import { getRegistry } from "../../state/registry.ts";

export interface AiActivityViewProps {
  /** Shows a "Connect Claude" button in the empty state. */
  onConnectClaude?: () => void;
}

const lowerFirst = (text: string) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

function namesFor(doc: SonobeDocument, item: { ids: readonly string[]; components: readonly string[] } | { ids: readonly string[]; component?: string }): string {
  const component = "components" in item ? item.components[0] : item.component;
  return summarizeNames(item.ids.map((id) => itemDisplayName(doc, component, id, getRegistry())));
}

/** AI Activity tab: what Claude is doing now, and each change it made as one undoable entry. */
export function AiActivityView({ onConnectClaude }: AiActivityViewProps) {
  const session = useEditorSession();
  const feed = useActivityFeed();
  const doc = useDocument((s) => s.doc);
  const now = useNow();

  const reveal = (component: string | undefined, ids: readonly string[]) => {
    if (!revealItems(session, component, ids)) toast({ title: "Those items aren't in the document anymore", tone: "neutral" });
  };

  const undo = (item: ChangeActivity) => {
    const result = session.document.getState().undoTo(item.txnId);
    if (!result.ok) {
      toast.error("Couldn't undo that change", { description: result.errors[0]?.message ?? "It's no longer in the undo history." });
      return;
    }
    const extra = result.entries.length - 1;
    toast({
      title: `Undid “${item.label}”`,
      ...(extra > 0 ? { description: `Also undid ${extra} newer ${extra === 1 ? "change" : "changes"}.` } : {}),
      tone: "neutral",
      action: {
        label: "Redo",
        onClick: () => {
          for (let i = 0; i < result.entries.length; i++) if (!session.document.getState().redo().ok) break;
        },
      },
    });
  };

  const redo = () => {
    const result = session.document.getState().redo();
    if (!result.ok) toast.error("Couldn't redo that change", { description: result.errors[0]?.message ?? "" });
  };

  if (feed.length === 0) {
    return (
      <div className="sb-hudview">
        <div className="sb-hudview__empty">
          <EmptyState
            size="sm"
            variant="inline"
            title="Claude hasn't edited this prototype"
            description="Its changes appear here, one undo step each."
            actions={
              onConnectClaude && (
                <Button size="sm" variant="ai" icon={<Plug size={12} />} onClick={onConnectClaude}>
                  Connect Claude
                </Button>
              )
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="sb-hudview">
      <div className="sb-hudview__scroll sb-scroll" role="list" aria-label="AI activity">
        {feed.map((item) => (
          <ActivityRow key={item.key} item={item} doc={doc} now={now} onReveal={reveal} onUndo={undo} onRedo={redo} />
        ))}
      </div>
    </div>
  );
}

interface ActivityRowProps {
  item: ActivityItem;
  doc: SonobeDocument;
  now: number;
  onReveal: (component: string | undefined, ids: readonly string[]) => void;
  onUndo: (item: ChangeActivity) => void;
  onRedo: () => void;
}

function ActivityRow({ item, doc, now, onReveal, onUndo, onRedo }: ActivityRowProps) {
  if (item.kind === "working") {
    const names = namesFor(doc, item);
    return (
      <div className="sb-feed__row" data-kind="working" role="listitem">
        <span className="sb-feed__glyph" data-agent aria-hidden>
          <LoaderCircle size={14} strokeWidth={2} className="sb-feed__spin" />
        </span>
        <div className="sb-feed__text">
          <div className="sb-feed__label">
            <strong>{item.author.name}</strong> is {lowerFirst(item.intent)}
          </div>
          {names && <div className="sb-feed__detail">working on {names}</div>}
        </div>
        <span className="sb-feed__actions">{item.ids.length > 0 && <IconButton size="sm" icon={<LocateFixed size={14} />} label={`Reveal ${names}`} tooltipPlacement="top" onClick={() => onReveal(item.component, item.ids)} />}</span>
        <span className="sb-feed__time sb-tabular">{formatRelativeTime(item.startedAt, now)}</span>
      </div>
    );
  }

  if (item.kind === "note") {
    const names = namesFor(doc, item);
    return (
      <div className="sb-feed__row" data-kind="note" role="listitem">
        <span className="sb-feed__glyph" aria-hidden>
          {item.verb === "finish" ? <CircleCheck size={14} strokeWidth={2} /> : item.verb === "undo" ? <Undo2 size={14} strokeWidth={2} /> : <Redo2 size={14} strokeWidth={2} />}
        </span>
        <div className="sb-feed__text">
          <div className="sb-feed__label">
            <strong>{item.author.name}</strong> {item.verb === "finish" ? lowerFirst(item.label) : lowerFirst(item.label.replace(/^(Undo|Redo) /, (m) => `${m.trim() === "Undo" ? "undid" : "redid"} `))}
          </div>
          {names && <div className="sb-feed__detail">{names}</div>}
        </div>
        <span className="sb-feed__actions">{item.ids.length > 0 && <IconButton size="sm" icon={<LocateFixed size={14} />} label={`Reveal ${names}`} tooltipPlacement="top" onClick={() => onReveal(item.components[0], item.ids)} />}</span>
        <span className="sb-feed__time sb-tabular">{formatRelativeTime(item.timestamp, now)}</span>
      </div>
    );
  }

  const names = namesFor(doc, item);
  const edits = `${item.opCount} ${item.opCount === 1 ? "edit" : "edits"}`;
  return (
    <div className="sb-feed__row" data-kind="change" data-status={item.status} role="listitem">
      {item.status === "undone" ? (
        <span className="sb-feed__glyph" role="img" aria-label="Undone">
          <Undo2 size={14} strokeWidth={2} />
        </span>
      ) : (
        <span className="sb-feed__glyph" aria-hidden />
      )}
      <div className="sb-feed__text">
        <div className="sb-feed__label">
          <strong>{item.author.name}</strong> {lowerFirst(item.label)}
        </div>
        <div className="sb-feed__detail">{names ? `${names} · ${edits}` : edits}</div>
      </div>
      <span className="sb-feed__actions">
        {item.status === "past" && (
          <Tooltip content="From before the document was replaced, so it can't be undone here." placement="top">
            <span className="sb-feed__past">Can't undo (older document)</span>
          </Tooltip>
        )}
        {item.canUndo && (
          <Tooltip content={item.newer > 0 ? `Also undoes ${item.newer} newer ${item.newer === 1 ? "change" : "changes"}` : "Undo just this change"} placement="top">
            <Button size="sm" variant="ghost" icon={<Undo2 size={12} />} onClick={() => onUndo(item)}>
              {undoActionLabel(item)}
            </Button>
          </Tooltip>
        )}
        {item.canRedo && (
          <Button size="sm" variant="ghost" icon={<Redo2 size={12} />} onClick={onRedo}>
            Redo
          </Button>
        )}
        {item.ids.length > 0 && item.status !== "past" && <IconButton size="sm" icon={<LocateFixed size={14} />} label={`Reveal ${names}`} tooltipPlacement="top" onClick={() => onReveal(item.components[0], item.ids)} />}
      </span>
      <span className="sb-feed__time sb-tabular">{formatRelativeTime(item.timestamp, now)}</span>
    </div>
  );
}
