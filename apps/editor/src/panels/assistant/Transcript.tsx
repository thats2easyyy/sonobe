import { Ban, Check, CircleAlert, Info, KeyRound, LoaderCircle, RefreshCw, ShieldQuestion, Sparkles, SkipForward, TriangleAlert, Trash2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { Button } from "../../ui/Button.tsx";
import { Markdown } from "../learn/Markdown.tsx";
import "../learn/markdown.css";
import type { ChatItem, ToolChip } from "./assistantStore.ts";
import type { AssistantConfirmOption } from "./types.ts";

export interface TranscriptProps {
  items: readonly ChatItem[];
  running: boolean;
  thinking: boolean;
  /** `optionId`: the choice on a permission card. */
  onConfirm: (confirmationId: string, approved: boolean, optionId?: string) => void;
  /** Opens the setup (from "invalid key" and Claude subscription notices). */
  onManageKey: () => void;
  /** Starter prompts for an empty chat. */
  onSuggestion: (text: string) => void;
}

export const SUGGESTIONS = ["Explain how this prototype works", "Make the photo zoom in when I tap it", "Add a like button with a bouncy animation"];

const KEY_CODES = new Set(["invalid_key", "no_key", "secrets_unavailable"]);
/** Claude subscription errors the setup fixes (signing in, installing the adapter). */
const SETUP_CODES = new Set(["not_signed_in", "agent_not_installed", "agent_failed"]);

function ToolIcon({ status }: { status: ToolChip["status"] }) {
  switch (status) {
    case "running":
      return <LoaderCircle size={12} className="sb-spin" aria-hidden />;
    case "done":
      return <Check size={12} aria-hidden />;
    case "error":
      return <X size={12} aria-hidden />;
    case "declined":
      return <Ban size={12} aria-hidden />;
    case "skipped":
      return <SkipForward size={12} aria-hidden />;
  }
}

const STATUS_LABEL: Record<ToolChip["status"], string> = { running: "running", done: "done", error: "failed", declined: "declined", skipped: "not run" };

function ToolChips({ tools }: { tools: readonly ToolChip[] }) {
  if (!tools.length) return null;
  return (
    <ul className="sb-assistant-tools" aria-label="Tool activity">
      {tools.map((tool) => (
        <li key={tool.toolUseId} className="sb-assistant-tool" data-status={tool.status} data-edited={tool.changedDocument || undefined} title={tool.detail || tool.title}>
          <span className="sb-assistant-tool__icon">
            <ToolIcon status={tool.status} />
          </span>
          <span className="sb-assistant-tool__title">{tool.title}</span>
          {tool.detail ? <span className="sb-assistant-tool__detail">{tool.detail}</span> : null}
          <span className="sb-visually-hidden">, {STATUS_LABEL[tool.status]}</span>
        </li>
      ))}
    </ul>
  );
}

function Notice({ item, onManageKey }: { item: Extract<ChatItem, { kind: "notice" }>; onManageKey: () => void }) {
  const Icon = item.tone === "error" ? CircleAlert : item.tone === "warn" ? TriangleAlert : Info;
  return (
    <div className="sb-assistant-notice" data-tone={item.tone} role={item.tone === "error" ? "alert" : undefined}>
      <Icon size={14} aria-hidden className="sb-assistant-notice__icon" />
      <span className="sb-assistant-notice__text">{item.text}</span>
      {item.code && KEY_CODES.has(item.code) ? (
        <Button size="sm" variant="ghost" icon={<KeyRound size={13} />} onClick={onManageKey} className="sb-assistant-notice__action">
          API key
        </Button>
      ) : item.code && SETUP_CODES.has(item.code) ? (
        <Button size="sm" variant="ghost" onClick={onManageKey} className="sb-assistant-notice__action">
          Set up…
        </Button>
      ) : null}
    </div>
  );
}

const CONFIRM_COPY = {
  delete: { approve: "Delete", decline: "Keep them", approved: "You allowed the deletion.", declined: "You kept them." },
  replace: { approve: "Replace", decline: "Keep it", approved: "You allowed the change.", declined: "You kept it." },
  /** A permission question without its choices. */
  permission: { approve: "Allow", decline: "Don't allow", approved: "Allowed", declined: "Not allowed" },
} as const;

/** What a permission card says after the answer, from the chosen option's kind. */
const PERMISSION_RESULT: Record<AssistantConfirmOption["kind"], string> = { allow_once: "Allowed", allow_always: "Allowed for this chat", reject_once: "Not allowed", reject_always: "Not allowed" };

const isAllow = (option: AssistantConfirmOption) => option.kind === "allow_once" || option.kind === "allow_always";

/**
 * A permission card: Claude Code asks before a step that reaches outside this prototype (saving it,
 * opening another). One button per choice, allows first; nothing is focused for you, so Enter can't
 * answer it by accident, and Escape still stops the reply.
 */
function PermissionCard({ item, options, onConfirm }: { item: Extract<ChatItem, { kind: "confirm" }>; options: readonly AssistantConfirmOption[]; onConfirm: TranscriptProps["onConfirm"] }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const pending = item.status === "pending";
  useEffect(() => {
    if (item.status === "pending") cardRef.current?.focus({ preventScroll: true });
  }, [item.status]);
  const ordered = [...options.filter(isAllow), ...options.filter((o) => !isAllow(o))];
  const primary = ordered.find(isAllow);
  const chosen = options.find((o) => o.id === item.optionId);
  const result = chosen ? PERMISSION_RESULT[chosen.kind] : item.status === "approved" ? "Allowed" : "Not allowed";
  return (
    <div ref={cardRef} className="sb-assistant-confirm" data-kind="permission" data-status={item.status} role={pending ? "alertdialog" : undefined} aria-labelledby={pending ? titleId : undefined} aria-describedby={pending ? messageId : undefined} tabIndex={pending ? -1 : undefined}>
      <div className="sb-assistant-confirm__head">
        <ShieldQuestion size={15} aria-hidden className="sb-assistant-confirm__icon" />
        <p id={titleId} className="sb-assistant-confirm__title">
          {item.title}
        </p>
      </div>
      <p id={messageId} className="sb-assistant-confirm__message">
        {item.message}
      </p>
      {pending ? (
        <div className="sb-assistant-confirm__actions" data-kind="permission">
          {ordered.map((option) => (
            <Button key={option.id} size="sm" variant={option === primary ? "primary" : isAllow(option) ? "secondary" : "ghost"} onClick={() => onConfirm(item.id, isAllow(option), option.id)}>
              {option.label}
            </Button>
          ))}
        </div>
      ) : (
        <p className="sb-assistant-confirm__result">{result}</p>
      )}
    </div>
  );
}

/**
 * A confirmation the Assistant is waiting on: deleting items, replacing a screen with a new design, or
 * (on the Claude subscription) a permission Claude Code asks for. The transcript and the canvas's
 * Design with Claude box both show it. Focus goes to the choice that keeps the person's work: Delete for
 * a deletion they asked for, the decline button for a replace.
 */
export function ConfirmCard({ item, onConfirm }: { item: Extract<ChatItem, { kind: "confirm" }>; onConfirm: TranscriptProps["onConfirm"] }) {
  if (item.confirmKind === "permission" && item.options?.length) return <PermissionCard item={item} options={item.options} onConfirm={onConfirm} />;
  return <YesNoCard item={item} onConfirm={onConfirm} />;
}

function YesNoCard({ item, onConfirm }: { item: Extract<ChatItem, { kind: "confirm" }>; onConfirm: TranscriptProps["onConfirm"] }) {
  const kind = item.confirmKind ?? "delete";
  const copy = CONFIRM_COPY[kind];
  const approveRef = useRef<HTMLButtonElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  // The same confirmation can show in the transcript and the canvas's box at once, so the ids are per card.
  const titleId = useId();
  const messageId = useId();
  const pending = item.status === "pending";
  useEffect(() => {
    if (item.status === "pending") (kind === "delete" ? approveRef : declineRef).current?.focus({ preventScroll: true });
  }, [item.status, kind]);
  const Icon = kind === "replace" ? RefreshCw : kind === "permission" ? ShieldQuestion : Trash2;
  return (
    // Focus lands on a button, so the dialog's message is its description: it says what the choice changes.
    <div className="sb-assistant-confirm" data-kind={kind} data-status={item.status} role={pending ? "alertdialog" : undefined} aria-labelledby={pending ? titleId : undefined} aria-describedby={pending ? messageId : undefined}>
      <div className="sb-assistant-confirm__head">
        <Icon size={15} aria-hidden className="sb-assistant-confirm__icon" />
        <p id={titleId} className="sb-assistant-confirm__title">
          {item.title}
        </p>
      </div>
      <p id={messageId} className="sb-assistant-confirm__message">
        {item.message}
      </p>
      {item.status === "pending" ? (
        <div className="sb-assistant-confirm__actions">
          <Button ref={declineRef} size="sm" onClick={() => onConfirm(item.id, false)}>
            {item.declineLabel ?? copy.decline}
          </Button>
          <Button ref={approveRef} size="sm" variant={kind === "delete" ? "danger" : "primary"} onClick={() => onConfirm(item.id, true)}>
            {item.approveLabel ?? copy.approve}
          </Button>
        </div>
      ) : (
        <p className="sb-assistant-confirm__result">{item.status === "approved" ? copy.approved : copy.declined}</p>
      )}
    </div>
  );
}

/** The chat: messages, streamed replies with tool chips, notices, and confirmations. */
export function Transcript({ items, running, thinking, onConfirm, onManageKey, onSuggestion }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, thinking]);

  if (!items.length) {
    return (
      <div className="sb-assistant-empty">
        <span className="sb-assistant-empty__mark" aria-hidden>
          <Sparkles size={18} strokeWidth={1.75} />
        </span>
        <p className="sb-assistant-empty__title">What should we build?</p>
        <p className="sb-assistant-empty__body">Describe an interaction and the Assistant edits this prototype for you. Every change is labeled “Assistant” in History and can be undone.</p>
        <div className="sb-assistant-suggestions">
          {SUGGESTIONS.map((text) => (
            <button key={text} type="button" className="sb-assistant-suggestion" onClick={() => onSuggestion(text)}>
              {text}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const last = items.at(-1);
  const waiting = running && (last?.kind === "user" || (last?.kind === "assistant" && !last.text && last.tools.every((t) => t.status !== "running")));

  return (
    <div
      ref={scrollRef}
      className="sb-assistant-transcript"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      onScroll={(event) => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {items.map((item) => {
        switch (item.kind) {
          case "user":
            return (
              <div key={item.id} className="sb-assistant-msg" data-role="user" data-origin={item.origin}>
                {item.origin === "canvas" ? <span className="sb-assistant-msg__origin">From the canvas</span> : null}
                <p className="sb-assistant-msg__user">{item.text}</p>
              </div>
            );
          case "assistant":
            return (
              <div key={item.id} className="sb-assistant-msg" data-role="assistant" data-textless={!item.text || undefined}>
                {item.text ? <Markdown source={item.text} copyCode={false} headingOffset={2} className="sb-assistant-msg__md" /> : null}
                <ToolChips tools={item.tools} />
              </div>
            );
          case "notice":
            return <Notice key={item.id} item={item} onManageKey={onManageKey} />;
          case "confirm":
            return <ConfirmCard key={item.id} item={item} onConfirm={onConfirm} />;
        }
      })}
      {waiting ? (
        <div className="sb-assistant-typing" role="status">
          <span className="sb-assistant-typing__dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          {thinking ? "Thinking…" : "Working…"}
        </div>
      ) : null}
    </div>
  );
}
