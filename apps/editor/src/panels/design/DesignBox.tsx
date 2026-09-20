/**
 * The Design with Claude box: floats at the bottom of the canvas, follows the selection (a new screen,
 * or a redesign of the selected layer), sends to the in-app Assistant with the canvas's context, and
 * shows what Claude is doing and what it made. Without the Assistant, it copies a prompt instead.
 */

import { artboardSize, findLayer } from "@sonobe/core";
import { Check, CircleAlert, Copy, FolderCode, KeyRound, LoaderCircle, MessageSquare, ScanLine, SendToBack, Sparkles, TriangleAlert, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStore } from "zustand";
import { appPanels } from "../../app/appPanels.ts";
import { getDesktopHostApi } from "../../host/detect.ts";
import { arrangeLayers } from "../../state/editActions.ts";
import { currentComponentId } from "../../state/selection.ts";
import type { EditorSession } from "../../state/session.ts";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { useOptionalCommands } from "../../ui/commands/CommandProvider.tsx";
import { assistantStore, useAssistant, type ChatItem } from "../assistant/assistantStore.ts";
import { Composer } from "../assistant/Composer.tsx";
import { sharedAssistantController } from "../assistant/controller.ts";
import { ConfirmCard } from "../assistant/Transcript.tsx";
import { getAssistantHost, type AssistantCodeFolderStatus } from "../assistant/types.ts";
import type { Rect } from "../canvas/geometry.ts";
import { connectedSessions, folderName } from "../connect/connectInfo.ts";
import { connectClaudeStore } from "../connect/connectStore.ts";
import { useMcpStatus, type McpStatusSource } from "../connect/useMcpStatus.ts";
import { canvasContext, designTarget, type DesignTarget } from "./context.ts";
import { designStore, sendDesign, useDesign, type DesignResult } from "./designStore.ts";
import { claudePrompt } from "./prompt.ts";
import { designStatusLine, type DesignStatusLine } from "./status.ts";
import "../assistant/assistant.css";
import "./design.css";

const REPLY_CHARS = 280;

/** The chips after an import: follow-ups Claude gets as box messages about the screen it made. */
export const followUps = (name: string) => ({
  interactive: `Make “${name}” interactive: wire its buttons and controls with patches so they respond, and tell me what you wired.`,
  knobs: `Turn the main colors, corner radius and spacing of “${name}” into knobs I can tune, and link its layers to them. Group them under “${name}”.`,
  darker: `Try a darker version of “${name}”.`,
});

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** The chip and field copy for what the box will change. */
function chipCopy(target: DesignTarget | null, size: [number, number]): { chip: string; placeholder: string; ariaLabel: string } {
  if (!target) return { chip: `New screen · ${size[0]} × ${size[1]}`, placeholder: "Describe a screen, like “a checkout with Apple Pay and a promo code”", ariaLabel: "Describe a screen for Claude" };
  if (target.isResult) return { chip: `Change “${target.name}”`, placeholder: "Ask for changes, or make it interactive…", ariaLabel: `Describe a change to “${target.name}”` };
  return { chip: `Redesign “${target.name}”`, placeholder: `What should change in “${target.name}”?`, ariaLabel: `Describe a change to “${target.name}”` };
}

/** The newest reply text of a run, or of the replies after `from` in the transcript. */
function replyText(items: readonly ChatItem[], runId: string | null, from: number): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== "assistant" || !item.text.trim()) continue;
    if (runId !== null ? item.runId === runId : i >= from) return item.text.trim();
  }
  return "";
}

const STATUS_ICONS: Record<DesignStatusLine["tone"], JSX.Element | null> = {
  busy: <LoaderCircle size={13} className="sb-spin" aria-hidden />,
  done: <Check size={13} aria-hidden />,
  info: null,
  warn: <TriangleAlert size={13} aria-hidden />,
  error: <CircleAlert size={13} aria-hidden />,
};

/** Renders when designStore.open. */
export function DesignBox({ session, bounds }: { session: EditorSession; bounds(id: string): Rect | null }): JSX.Element | null {
  const open = useDesign((s) => s.open);

  // The chip's × means "New screen" until the selection changes.
  useEffect(
    () =>
      session.selection.subscribe((s, previous) => {
        if (s.layers !== previous.layers && designStore.getState().newScreen) designStore.getState().setNewScreen(false);
      }),
    [session],
  );

  return open ? <DesignBoxPanel session={session} bounds={bounds} /> : null;
}

function DesignBoxPanel({ session, bounds }: { session: EditorSession; bounds(id: string): Rect | null }): JSX.Element | null {
  const controller = useMemo(() => sharedAssistantController(), []);
  const [host] = useState(() => getAssistantHost());
  const commands = useOptionalCommands();
  const design = useDesign((s) => s);
  const assistant = useAssistant((s) => s);
  const componentId = useStore(session.selection, currentComponentId);
  // The chip follows the selection.
  useStore(session.selection, (s) => s.layers);
  const doc = useStore(session.document, (s) => s.doc);
  const topTxn = useStore(session.document, (s) => s.historyEntries(1)[0]?.txnId ?? null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const [sending, setSending] = useState(false);
  /** Where the box's latest message sits in the transcript (its reply comes after it). */
  const [sentAt, setSentAt] = useState<number | null>(null);
  /** The result that was showing when the box sent again: it belongs to the earlier message. */
  const [staleResult, setStaleResult] = useState<DesignResult | null>(null);
  const [noKey, setNoKey] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sentBack, setSentBack] = useState<string | null>(null);
  const [mcpSource] = useState<McpStatusSource | null>(() => {
    const api = getDesktopHostApi() as Partial<McpStatusSource> | undefined;
    return typeof api?.getMcpStatus === "function" ? (api as McpStatusSource) : null;
  });
  const mcp = useMcpStatus(noKey ? mcpSource : null, { intervalMs: 10_000 });

  useEffect(() => {
    void controller.refresh();
    composerRef.current?.focus({ preventScroll: true });
  }, [controller]);

  useEffect(() => {
    if (assistant.status?.hasKey) setNoKey(false);
  }, [assistant.status?.hasKey]);

  const component = doc.components[componentId];
  if (!component || component.kind === "patchComponent") return null;

  const target = designTarget(session, { newScreen: design.newScreen, result: design.result });
  const copy = chipCopy(target, artboardSize(doc, componentId));
  const boxRun = sending || (assistant.running && design.request?.runId != null && design.request.runId === assistant.runId);
  const busy = assistant.running && !boxRun;
  const line = designStatusLine(design, assistant, Date.now());
  const confirms = assistant.items.filter((i): i is Extract<ChatItem, { kind: "confirm" }> => i.kind === "confirm" && i.status === "pending" && i.runId === assistant.runId);
  // A result whose screen is gone (undone, deleted) has nothing left to follow up on.
  const shown = !boxRun && design.result && design.result !== staleResult ? design.result : null;
  const result = shown && findLayer(doc.components[shown.component]?.layers ?? [], shown.layerId) ? shown : null;
  // A reply without an import (a question, or wiring patches) shows the reply alone.
  const reply = boxRun ? "" : result ? result.reply : sentAt !== null ? replyText(assistant.items, design.request?.runId ?? null, sentAt) : "";
  const codeFolder: AssistantCodeFolderStatus | undefined = assistant.status?.codeFolder;

  const focusCanvas = () => boxRef.current?.closest(".sb-panel__body")?.querySelector<HTMLElement>(".sb-cv")?.focus({ preventScroll: true });
  const close = () => {
    designStore.getState().closeBox();
    focusCanvas();
  };

  const submit = (text: string): boolean => {
    if (!controller.available || busy || boxRun) return false;
    if (assistant.status && !assistant.status.hasKey) {
      setNoKey(true);
      return false;
    }
    setNoKey(false);
    setSending(true);
    setSentAt(assistant.items.length);
    setStaleResult(designStore.getState().result);
    const done = () => setSending(false);
    void sendDesign(session, text, bounds).then(done, done);
    return true;
  };

  const onSend = (raw: string): boolean => {
    const text = raw.trim();
    if (!text) return false;
    if (!controller.available) {
      void copyPrompt(true);
      return false;
    }
    return submit(text);
  };

  const copyPrompt = async (browser: boolean) => {
    const prompt = claudePrompt({ docName: doc.project.name, text: composerRef.current?.value.trim() ?? "", context: canvasContext(session, target, bounds), browser });
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      toast({ title: "Couldn't copy the prompt", description: "Sonobe wasn't allowed to use the clipboard. Click the button again, or allow clipboard access for this page.", tone: "warn" });
      return;
    }
    if (browser) {
      toast({ title: "Prompt copied", description: "Paste it into Claude, then paste the HTML it writes into File → Import Design.", tone: "ai" });
      return;
    }
    const connected = connectedSessions(mcp.status)[0];
    toast(
      connected
        ? { title: "Prompt copied", description: `Paste it into ${connected.label}${connected.folder ? ` in ${folderName(connected.folder)}` : ""}. It builds on this canvas through Sonobe's tools.`, tone: "ai" }
        : { title: "Prompt copied", description: "Paste it into Claude Code in your app's folder.", tone: "ai", action: { label: "Connect Claude…", onClick: () => connectClaudeStore.getState().show() } },
    );
  };

  const showCodeFolder = (status: AssistantCodeFolderStatus) => assistantStore.setState((s) => (s.status ? { status: { ...s.status, codeFolder: status } } : {}));

  const linkCodeFolder = async () => {
    const api = host?.assistant;
    if (!api?.linkCodeFolder) return;
    setCodeError(null);
    try {
      const linked = await api.linkCodeFolder();
      showCodeFolder(linked.status);
      if (linked.error) setCodeError(linked.error);
    } catch (err) {
      setCodeError(`Sonobe couldn't link the folder: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const unlinkCodeFolder = async () => {
    const api = host?.assistant;
    if (!api?.unlinkCodeFolder) return;
    setCodeError(null);
    try {
      showCodeFolder(await api.unlinkCodeFolder());
    } catch (err) {
      setCodeError(`Sonobe couldn't unlink the folder: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const undo = (r: DesignResult) => {
    if (!r.txnId) return;
    const undone = session.document.getState().undoTo(r.txnId);
    if (!undone.ok) toast({ title: "Couldn't undo the import", description: "Something changed on top of it. Use Edit → Undo, or History, to step back.", tone: "warn" });
  };

  const sendToBack = (r: DesignResult) => {
    session.selection.getState().select({ layers: [r.layerId], patches: [], comments: [] });
    if (commands?.registry.get("layer.sendToBack")) commands.registry.run("layer.sendToBack");
    else {
      const arranged = arrangeLayers(session, "back");
      if (!arranged.ok && arranged.message) toast({ title: arranged.message, ...(arranged.hint ? { description: arranged.hint } : {}), tone: "warn" });
    }
    setSentBack(r.layerId);
  };

  const runAction = (action: NonNullable<DesignStatusLine["action"]>) => {
    if (action === "settings") appPanels.getState().show("settings");
    else if (action === "new_chat") void controller.newChat();
    else assistantStore.getState().show();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (boxRun) void controller.stop();
    else close();
  };

  const codeTooltip = (status: AssistantCodeFolderStatus) => {
    const linked = status.linked!;
    if (status.missing) return `“${linked.name}” isn't at ${linked.path} anymore.`;
    return linked.persisted ? linked.path : `${linked.path}\nLinked for this window. Save the prototype to keep the link.`;
  };

  return (
    <section ref={boxRef} className="sb-design-box" aria-label="Design with Claude" onKeyDown={onKeyDown}>
      {/* Always in the tree, so screen readers hear each new line. */}
      <div className="sb-design-box__status" data-tone={line?.tone} data-empty={line ? undefined : ""}>
        {line ? STATUS_ICONS[line.tone] : null}
        <p className="sb-design-box__status-text" role="status" aria-live="polite">
          {line?.text ?? ""}
        </p>
        {line?.action ? (
          <Button size="sm" variant="ghost" icon={line.action === "api_key" ? <KeyRound size={13} /> : undefined} onClick={() => runAction(line.action!)}>
            {line.action === "settings" ? "Open Settings" : line.action === "new_chat" ? "New chat" : "API key"}
          </Button>
        ) : null}
      </div>

      {reply ? <p className="sb-design-box__reply">{clip(reply, REPLY_CHARS)}</p> : null}

      {result ? (
        <div className="sb-design-box__chips" role="group" aria-label="Next steps">
          {result.txnId && topTxn === result.txnId ? (
            <Button size="sm" icon={<Undo2 size={13} />} onClick={() => undo(result)}>
              Undo
            </Button>
          ) : null}
          {result.kind === "added" && result.coveredScreen && sentBack !== result.layerId ? (
            <Button size="sm" icon={<SendToBack size={13} />} onClick={() => sendToBack(result)}>
              Send to Back
            </Button>
          ) : null}
          <Button size="sm" variant="ai" onClick={() => submit(followUps(result.name).interactive)}>
            Make it interactive
          </Button>
          <Button size="sm" variant="ai" onClick={() => submit(followUps(result.name).knobs)}>
            Add knobs
          </Button>
          <Button size="sm" variant="ai" onClick={() => submit(followUps(result.name).darker)}>
            Try a darker version
          </Button>
        </div>
      ) : null}

      {confirms.map((item) => (
        <ConfirmCard key={item.id} item={item} onConfirm={(id, approved) => void controller.confirm(id, approved)} />
      ))}

      {!controller.available ? (
        <div className="sb-design-box__notice">
          <p>Claude designs on the canvas in the Sonobe desktop app, with your own API key or Claude Code. Here, copy a prompt for Claude, then paste the HTML it writes.</p>
          <div className="sb-design-box__actions">
            <Button size="sm" variant="ai" icon={<Copy size={13} />} onClick={() => void copyPrompt(true)}>
              Copy prompt
            </Button>
            <Button size="sm" icon={<ScanLine size={13} />} onClick={() => appPanels.getState().show("importDesign")}>
              Import Design…
            </Button>
          </div>
        </div>
      ) : noKey ? (
        <div className="sb-design-box__notice">
          <p>Designing on the canvas uses your own Anthropic API key, kept in your keychain.</p>
          <div className="sb-design-box__actions">
            <Button size="sm" variant="ai" icon={<KeyRound size={13} />} onClick={() => assistantStore.getState().show()}>
              Add API key…
            </Button>
            <Button size="sm" icon={<Copy size={13} />} onClick={() => void copyPrompt(false)}>
              Copy for Claude Code
            </Button>
          </div>
        </div>
      ) : null}

      <div className="sb-design-box__target">
        <span className="sb-design-box__chip" data-kind={target ? (target.isResult ? "result" : "redesign") : "new"}>
          <Sparkles size={12} aria-hidden />
          <span className="sb-design-box__chip-label">{copy.chip}</span>
          {target ? <IconButton size="xs" icon={<X size={11} />} label="Design a new screen instead" className="sb-design-box__chip-clear" onClick={() => designStore.getState().setNewScreen(true)} /> : null}
        </span>
      </div>

      <Composer
        ref={composerRef}
        running={boxRun}
        disabled={busy}
        onSend={onSend}
        onStop={() => void controller.stop()}
        usage={assistant.usage}
        limits={assistant.limits}
        placeholder={copy.placeholder}
        ariaLabel={copy.ariaLabel}
        usageThreshold={0.5}
      />

      <footer className="sb-design-box__footer">
        {controller.available && codeFolder ? (
          codeFolder.linked ? (
            <>
              <span className="sb-design-box__code" data-missing={codeFolder.missing || undefined}>
                <Tooltip content={<span className="sb-design-box__tooltip">{codeTooltip(codeFolder)}</span>}>
                  <span className="sb-design-box__code-label" tabIndex={0}>
                    <FolderCode size={12} aria-hidden />
                    Code: {codeFolder.linked.name}
                    {codeFolder.missing ? " (missing)" : ""}
                  </span>
                </Tooltip>
                <IconButton size="xs" icon={<X size={11} />} label="Unlink code folder" onClick={() => void unlinkCodeFolder()} />
              </span>
              {codeFolder.missing ? (
                <Button size="sm" variant="ghost" onClick={() => void linkCodeFolder()}>
                  Link again…
                </Button>
              ) : null}
            </>
          ) : (
            <Button size="sm" variant="ghost" icon={<FolderCode size={13} />} onClick={() => void linkCodeFolder()}>
              Match my code…
            </Button>
          )
        ) : null}
        <span className="sb-design-box__spacer" />
        {controller.available ? (
          <Button size="sm" variant="ghost" icon={<MessageSquare size={13} />} onClick={() => assistantStore.getState().show()}>
            Open chat
          </Button>
        ) : null}
        <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={close} />
      </footer>
      {codeError ? (
        <p className="sb-design-box__code-error" role="alert">
          {codeError}
        </p>
      ) : null}
    </section>
  );
}
