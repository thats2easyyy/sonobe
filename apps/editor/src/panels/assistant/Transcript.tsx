import { ArrowRight, Ban, Check, ChevronRight, CircleAlert, Info, KeyRound, LoaderCircle, MessageSquarePlus, RefreshCw, ShieldQuestion, SkipForward, TriangleAlert, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { Button } from "../../ui/Button.tsx";
import { detectPlatform, formatShortcutLabel, isEditableTarget } from "../../ui/commands/shortcutManager.ts";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { isBehindModal } from "../../ui/lib/focus.ts";
import { Markdown } from "../learn/Markdown.tsx";
import { parseMarkdown } from "../learn/markdown.ts";
import "../learn/markdown.css";
import type { ChatItem, ToolChip } from "./assistantStore.ts";
import { assistantEditor } from "./editorLink.ts";
import { MentionChip, SelectionChips } from "./MentionChip.tsx";
import { linkMentions, withoutOpenLink } from "./mentions.ts";
import { selectionLabel } from "./selectionContext.ts";
import type { AssistantConfirmOption } from "./types.ts";

export interface TranscriptProps {
  items: readonly ChatItem[];
  running: boolean;
  thinking: boolean;
  /** `optionId`: the choice on a permission card. */
  onConfirm: (confirmationId: string, approved: boolean, optionId?: string) => void;
  /** Opens the setup (from "invalid key" and Claude subscription notices). */
  onManageKey: () => void;
  /** Starts a new chat, for the notices that say to. Without it they have no button. */
  onNewChat?: () => void;
  /** Starter prompts for an empty chat. */
  onSuggestion: (text: string) => void;
  /** The starters to show. Default SUGGESTIONS. */
  suggestions?: readonly string[];
}

export const SUGGESTIONS = ["Explain how this prototype works", "Make the photo zoom in when I tap it", "Add a like button with a bouncy animation"];

const KEY_CODES = new Set(["invalid_key", "no_key", "secrets_unavailable"]);
/** Claude subscription errors the setup fixes (signing in, installing the adapter). */
const SETUP_CODES = new Set(["not_signed_in", "agent_not_installed", "agent_failed"]);
/** Notices that tell the person to start a new chat: the budget's, the subscription switch's. */
const NEW_CHAT_TEXT = /start a new chat/i;

/** Tools that only look: their finished calls fold into one row. `save_document` and the like stay in view. */
const READ_ONLY_TOOL = /^(get_|list_|search_|screenshot$)/;
const isRead = (tool: ToolChip) => tool.status === "done" && !tool.changedDocument && READ_ONLY_TOOL.test(tool.name);

function ToolIcon({ tool }: { tool: ToolChip }) {
  switch (tool.status) {
    case "running":
      return <LoaderCircle size={12} className="sb-spin" aria-hidden />;
    case "done":
      return tool.changedDocument ? <span className="sb-assistant-tool__edit" aria-hidden /> : <Check size={12} aria-hidden />;
    case "error":
      return <X size={12} aria-hidden />;
    case "declined":
      return <Ban size={12} aria-hidden />;
    case "skipped":
      return <SkipForward size={12} aria-hidden />;
  }
}

const STATUS_LABEL: Record<ToolChip["status"], string> = { running: "running", done: "done", error: "failed", declined: "declined", skipped: "not run" };

/** One tool call. Its text is cut to a line, with the whole of it on hover, except a failure, which wraps. */
function ToolRow({ tool }: { tool: ToolChip }) {
  const [cut, setCut] = useState(false);
  return (
    <li className="sb-assistant-tool" data-status={tool.status} data-edited={tool.changedDocument || undefined}>
      <span className="sb-assistant-tool__icon">
        <ToolIcon tool={tool} />
      </span>
      <Tooltip content={cut ? (tool.detail ? `${tool.title} · ${tool.detail}` : tool.title) : undefined} placement="top-start">
        <span className="sb-assistant-tool__text" onPointerEnter={(event) => setCut(event.currentTarget.scrollWidth > event.currentTarget.clientWidth || event.currentTarget.scrollHeight > event.currentTarget.clientHeight)}>
          <span className="sb-assistant-tool__title">{tool.title}</span>
          {tool.detail ? (
            <span className="sb-assistant-tool__detail">
              <span aria-hidden> · </span>
              {tool.detail}
            </span>
          ) : null}
        </span>
      </Tooltip>
      <span className="sb-visually-hidden">, {STATUS_LABEL[tool.status]}</span>
    </li>
  );
}

type ToolGroup = { kind: "row"; tool: ToolChip } | { kind: "fold"; tools: ToolChip[] };

/** Consecutive finished reads become one fold, when there are two or more. Everything else stays a row. */
function groupTools(tools: readonly ToolChip[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  let reads: ToolChip[] = [];
  const flush = () => {
    if (reads.length > 1) groups.push({ kind: "fold", tools: reads });
    else groups.push(...reads.map((tool) => ({ kind: "row" as const, tool })));
    reads = [];
  };
  for (const tool of tools) {
    if (isRead(tool)) reads.push(tool);
    else {
      flush();
      groups.push({ kind: "row", tool });
    }
  }
  flush();
  return groups;
}

function ToolFold({ tools }: { tools: readonly ToolChip[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="sb-assistant-tool-fold">
      <button type="button" className="sb-assistant-tool-fold__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} aria-hidden className="sb-assistant-tool-fold__chevron" />
        <span>
          Looked at the prototype<span className="sb-assistant-tool-fold__count"> · {tools.length} steps</span>
        </span>
      </button>
      {open ? (
        <ul className="sb-assistant-tools" aria-label="Reads">
          {tools.map((tool) => (
            <ToolRow key={tool.toolUseId} tool={tool} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ToolChips({ tools }: { tools: readonly ToolChip[] }) {
  if (!tools.length) return null;
  return (
    <ul className="sb-assistant-tools" aria-label="Tool activity">
      {groupTools(tools).map((group) => (group.kind === "fold" ? <ToolFold key={group.tools[0]!.toolUseId} tools={group.tools} /> : <ToolRow key={group.tool.toolUseId} tool={group.tool} />))}
    </ul>
  );
}

function Notice({ item, onManageKey, onNewChat }: { item: Extract<ChatItem, { kind: "notice" }>; onManageKey: () => void; onNewChat: (() => void) | undefined }) {
  if (item.code === "stopped") return <p className="sb-assistant-stopped">{item.text}</p>;
  const Icon = item.tone === "error" ? CircleAlert : item.tone === "warn" ? TriangleAlert : Info;
  return (
    <div className="sb-assistant-notice" data-tone={item.tone} role={item.tone === "error" ? "alert" : undefined}>
      <Icon size={14} aria-hidden className="sb-assistant-notice__icon" />
      <span className="sb-assistant-notice__text">{item.text}</span>
      {item.code && KEY_CODES.has(item.code) ? (
        <Button variant="ghost" icon={<KeyRound size={13} />} onClick={onManageKey} className="sb-assistant-notice__action">
          API key
        </Button>
      ) : item.code && SETUP_CODES.has(item.code) ? (
        <Button variant="ghost" onClick={onManageKey} className="sb-assistant-notice__action">
          Set up…
        </Button>
      ) : onNewChat && (item.code === "budget" || NEW_CHAT_TEXT.test(item.text)) ? (
        <Button variant="ghost" icon={<MessageSquarePlus size={13} />} onClick={onNewChat} className="sb-assistant-notice__action">
          New chat
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
 * A question just arrived. Someone typing in a field keeps their focus, so a stray space or Enter can't
 * answer it, and so does a dialog or the palette open over the card; the card scrolls into view instead.
 * Otherwise focus goes to `target`, or to the card.
 */
function claimFocus(card: HTMLElement | null, target?: HTMLElement | null) {
  if (!card) return;
  if (isEditableTarget(document.activeElement) || isBehindModal(card)) card.scrollIntoView({ block: "nearest" });
  else (target ?? card).focus({ preventScroll: true });
}

/** A card that has been answered: one quiet line, with the question on hover. */
function ResolvedCard({ item, label, result }: { item: Extract<ChatItem, { kind: "confirm" }>; label?: string; result: string }) {
  const Icon = item.status === "approved" ? Check : Ban;
  return (
    <Tooltip content={item.message} placement="top-start">
      <div className="sb-assistant-confirm" data-kind={item.confirmKind ?? "delete"} data-status={item.status} role="group" aria-label={item.message}>
        <Icon size={12} aria-hidden className="sb-assistant-confirm__icon" />
        {label ? <span className="sb-assistant-confirm__label">{label}</span> : null}
        <p className="sb-assistant-confirm__result">{result}</p>
      </div>
    </Tooltip>
  );
}

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
    if (item.status === "pending") claimFocus(cardRef.current);
  }, [item.status]);
  const ordered = [...options.filter(isAllow), ...options.filter((o) => !isAllow(o))];
  const primary = ordered.find(isAllow);
  const chosen = options.find((o) => o.id === item.optionId);
  const result = chosen ? PERMISSION_RESULT[chosen.kind] : item.status === "approved" ? "Allowed" : "Not allowed";
  if (!pending) return <ResolvedCard item={item} label={item.title} result={result} />;
  return (
    <div ref={cardRef} className="sb-assistant-confirm" data-kind="permission" data-status={item.status} role="alertdialog" aria-labelledby={titleId} aria-describedby={messageId} tabIndex={-1}>
      <div className="sb-assistant-confirm__head">
        <ShieldQuestion size={15} aria-hidden className="sb-assistant-confirm__icon" />
        <p id={titleId} className="sb-assistant-confirm__title">
          {item.title}
        </p>
      </div>
      <p id={messageId} className="sb-assistant-confirm__message">
        {item.message}
      </p>
      <div className="sb-assistant-confirm__actions" data-kind="permission">
        {ordered.map((option) => (
          <Button key={option.id} variant={option === primary ? "primary" : isAllow(option) ? "secondary" : "ghost"} onClick={() => onConfirm(item.id, isAllow(option), option.id)}>
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * A confirmation the Assistant is waiting on: deleting items, replacing a screen with a new design, or
 * (on the Claude subscription) a permission Claude Code asks for. The transcript and the canvas's
 * Design with Claude box both show it. Focus goes to the choice that keeps the person's work (never
 * Delete or Replace), unless they're typing, and then it stays where it is.
 */
export function ConfirmCard({ item, onConfirm }: { item: Extract<ChatItem, { kind: "confirm" }>; onConfirm: TranscriptProps["onConfirm"] }) {
  if (item.confirmKind === "permission" && item.options?.length) return <PermissionCard item={item} options={item.options} onConfirm={onConfirm} />;
  return <YesNoCard item={item} onConfirm={onConfirm} />;
}

function YesNoCard({ item, onConfirm }: { item: Extract<ChatItem, { kind: "confirm" }>; onConfirm: TranscriptProps["onConfirm"] }) {
  const kind = item.confirmKind ?? "delete";
  const copy = CONFIRM_COPY[kind];
  const cardRef = useRef<HTMLDivElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  // The same confirmation can show in the transcript and the canvas's box at once, so the ids are per card.
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    if (item.status === "pending") claimFocus(cardRef.current, declineRef.current);
  }, [item.status]);
  if (item.status !== "pending") return <ResolvedCard item={item} result={item.status === "approved" ? copy.approved : copy.declined} />;
  const Icon = kind === "replace" ? RefreshCw : kind === "permission" ? ShieldQuestion : Trash2;
  return (
    // Focus lands on a button, so the dialog's message is its description: it says what the choice changes.
    <div ref={cardRef} className="sb-assistant-confirm" data-kind={kind} data-status={item.status} role="alertdialog" aria-labelledby={titleId} aria-describedby={messageId}>
      <div className="sb-assistant-confirm__head">
        <Icon size={15} aria-hidden className="sb-assistant-confirm__icon" />
        <p id={titleId} className="sb-assistant-confirm__title">
          {item.title}
        </p>
      </div>
      <p id={messageId} className="sb-assistant-confirm__message">
        {item.message}
      </p>
      <div className="sb-assistant-confirm__actions">
        <Button ref={declineRef} onClick={() => onConfirm(item.id, false)}>
          {item.declineLabel ?? copy.decline}
        </Button>
        <Button variant={kind === "delete" ? "danger" : "primary"} onClick={() => onConfirm(item.id, true)}>
          {item.approveLabel ?? copy.approve}
        </Button>
      </div>
    </div>
  );
}

/**
 * A reply's text. The layers, patches and knobs it names are chips that show the item in the editor:
 * the ones the Assistant linked by id, and names found by name (mentions.ts). `streaming`: the reply is
 * still arriving, so a link that's half written at its end waits.
 */
const ReplyText = memo(function ReplyText({ text, streaming }: { text: string; streaming: boolean }) {
  const index = useStore(assistantEditor, (s) => s.index);
  const blocks = useMemo(() => {
    const parsed = parseMarkdown(streaming ? withoutOpenLink(text) : text);
    return index ? linkMentions(parsed, index) : parsed;
  }, [text, streaming, index]);
  const renderLink = useCallback(
    (href: string, children: ReactNode) => {
      const target = index?.resolve(href);
      return target ? <MentionChip target={target}>{children}</MentionChip> : undefined;
    },
    [index],
  );
  return <Markdown blocks={blocks} renderLink={renderLink} copyCode={false} headingOffset={2} className="sb-assistant-msg__md" />;
});

/** The chat: messages, streamed replies with tool chips, notices, and confirmations. */
export function Transcript({ items, running, thinking, onConfirm, onManageKey, onNewChat, onSuggestion, suggestions = SUGGESTIONS }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastId = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const newest = items.at(-1);
    // A message you send, or a question waiting for you, is always in view, even from far up the chat.
    if (newest && newest.id !== lastId.current && (newest.kind === "user" || (newest.kind === "confirm" && newest.status === "pending"))) pinned.current = true;
    lastId.current = newest?.id;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, thinking]);

  if (!items.length) {
    return (
      <div className="sb-assistant-empty">
        <p className="sb-assistant-empty__title">What should we build?</p>
        <p className="sb-assistant-empty__body">Describe a change and Claude makes it. It shows in AI Activity as Assistant and can be undone with {formatShortcutLabel("Mod+Z", detectPlatform())}.</p>
        <div className="sb-assistant-suggestions">
          {suggestions.map((text) => (
            <button key={text} type="button" className="sb-assistant-suggestion" onClick={() => onSuggestion(text)}>
              <span>{text}</span>
              <ArrowRight size={12} strokeWidth={1.75} className="sb-assistant-suggestion__arrow" aria-hidden />
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
                {item.selection ? (
                  <div className="sb-assistant-msg__about" role="group" aria-label={`Sent with ${selectionLabel(item.selection)} selected`}>
                    <SelectionChips context={item.selection} />
                  </div>
                ) : null}
                <p className="sb-assistant-msg__user">{item.text}</p>
              </div>
            );
          case "assistant":
            return (
              <div key={item.id} className="sb-assistant-msg" data-role="assistant" data-textless={!item.text || undefined}>
                {item.text ? <ReplyText text={item.text} streaming={running && item === last} /> : null}
                <ToolChips tools={item.tools} />
              </div>
            );
          case "notice":
            return <Notice key={item.id} item={item} onManageKey={onManageKey} onNewChat={onNewChat} />;
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
