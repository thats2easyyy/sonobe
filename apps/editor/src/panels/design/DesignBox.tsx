/**
 * The Design with Claude box: floats at the bottom of the canvas, follows the selection (a new screen,
 * or a redesign of the selected layer), sends to the in-app Assistant with the canvas's context, and
 * shows what Claude is doing and what it made. Without the Assistant, it copies a prompt instead, or
 * opens it in the person's own Claude Code (Open in Claude Code, macOS). While a connected session
 * (Claude Code) draws on the canvas, it says so and can hide that preview.
 */

import { artboardSize } from "@sonobe/core";
import { Check, CircleAlert, Copy, EyeOff, FolderCode, KeyRound, LoaderCircle, MessageSquare, ScanLine, SendToBack, Sparkles, SquareTerminal, TriangleAlert, Undo2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
import { useLatest } from "../../ui/lib/hooks.ts";
import { observeResize } from "../../ui/lib/observeResize.ts";
import { assistantStore, useAssistant, type ChatItem } from "../assistant/assistantStore.ts";
import { Composer } from "../assistant/Composer.tsx";
import { sharedAssistantController } from "../assistant/controller.ts";
import { ConfirmCard } from "../assistant/Transcript.tsx";
import type { AssistantCodeFolderStatus } from "../assistant/types.ts";
import type { Rect } from "../canvas/geometry.ts";
import { connectedSessions, folderName } from "../connect/connectInfo.ts";
import { connectClaudeStore } from "../connect/connectStore.ts";
import { useMcpStatus, type McpStatusSource } from "../connect/useMcpStatus.ts";
import { canvasContext, designTarget, type DesignTarget } from "./context.ts";
import { designStore, dismissDraft, liveMcpDraft, sendDesign, useDesign, type DesignResult } from "./designStore.ts";
import { claudePrompt } from "./prompt.ts";
import { designResultChips, designRunState, designStatusLine, mcpDraftText, resultPlacement, type DesignResultChip, type DesignStatusLine } from "./status.ts";
import "../assistant/assistant.css";
import "./design.css";

/** The chip and field copy for what the box will change. */
function chipCopy(target: DesignTarget | null, size: [number, number]): { chip: string; placeholder: string; ariaLabel: string } {
  if (!target) return { chip: `New screen · ${size[0]} × ${size[1]}`, placeholder: "Describe a screen, like “a checkout with Apple Pay and a promo code”", ariaLabel: "Describe a screen for Claude" };
  if (target.isResult) return { chip: `Change “${target.name}”`, placeholder: "Ask for changes, or make it interactive…", ariaLabel: `Describe a change to “${target.name}”` };
  return { chip: `Redesign “${target.name}”`, placeholder: `What should change in “${target.name}”?`, ariaLabel: `Describe a change to “${target.name}”` };
}

const CHIP_ICONS: Partial<Record<DesignResultChip["id"], JSX.Element>> = { undo: <Undo2 size={13} />, sendToBack: <SendToBack size={13} /> };

const STATUS_ICONS: Record<DesignStatusLine["tone"], JSX.Element | null> = {
  busy: <LoaderCircle size={13} className="sb-spin" aria-hidden />,
  done: <Check size={13} aria-hidden />,
  info: null,
  warn: <TriangleAlert size={13} aria-hidden />,
  error: <CircleAlert size={13} aria-hidden />,
};

export interface DesignBoxProps {
  session: EditorSession;
  bounds(id: string): Rect | null;
  /** The box's height in px while it shows, then 0: the canvas keeps the artboard above it. */
  onHeightChange?(height: number): void;
}

/** Renders when designStore.open. attachDesign (EditorApp) follows the Assistant's events and the selection for it. */
export function DesignBox(props: DesignBoxProps): JSX.Element | null {
  const open = useDesign((s) => s.open);
  return open ? <DesignBoxPanel {...props} /> : null;
}

function DesignBoxPanel({ session, bounds, onHeightChange }: DesignBoxProps): JSX.Element | null {
  const controller = useMemo(() => sharedAssistantController(), []);
  const commands = useOptionalCommands();
  const design = useDesign((s) => s);
  const assistant = useAssistant((s) => s);
  const componentId = useStore(session.selection, currentComponentId);
  // The chip follows the selection.
  useStore(session.selection, (s) => s.layers);
  const doc = useStore(session.document, (s) => s.doc);
  const topTxn = useStore(session.document, (s) => s.historyEntries(1)[0]?.txnId ?? null);
  const resultTxn = design.result?.txnId ?? null;
  // Undo (the chip, ⌘Z or History) puts the result's import on the redo stack.
  const resultUndone = useStore(session.document, (s) => resultTxn !== null && s.redoEntries().some((e) => e.txnId === resultTxn));
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const noticeId = useId();
  const [noKey, setNoKey] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  const [mcpSource] = useState<McpStatusSource | null>(() => {
    const api = getDesktopHostApi() as Partial<McpStatusSource> | undefined;
    return typeof api?.getMcpStatus === "function" ? (api as McpStatusSource) : null;
  });
  const mcp = useMcpStatus(noKey ? mcpSource : null, { intervalMs: 10_000 });
  const reportHeight = useLatest(onHeightChange);
  const component = doc.components[componentId];
  const shows = !!component && component.kind !== "patchComponent";

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!shows || !el) return;
    const measure = () => reportHeight.current?.(el.offsetHeight);
    measure();
    const stop = observeResize([el], measure);
    return () => {
      stop();
      reportHeight.current?.(0);
    };
  }, [shows, reportHeight]);

  useEffect(() => {
    void controller.refresh();
  }, [controller]);

  // Each way in (the header, ⌘K, the Layers menu) moves focus to the field, even when the box is already open.
  // A passive effect, so it runs after a closing menu or palette gives focus back to where it was.
  useEffect(() => {
    composerRef.current?.focus({ preventScroll: true });
  }, [design.focusRequest]);

  useEffect(() => {
    if (assistant.status?.hasKey) setNoKey(false);
  }, [assistant.status?.hasKey]);

  if (!shows) return null;

  const target = designTarget(session, { newScreen: design.newScreen, result: design.result });
  const copy = chipCopy(target, artboardSize(doc, componentId));
  const runState = designRunState(design, assistant);
  const boxRun = runState === "running";
  const busy = runState === "busy";
  const now = Date.now();
  // Where the result is now: the line and chips follow Undo, Send to Back and deletes.
  const placement = design.result ? resultPlacement(doc, design.result, resultUndone) : undefined;
  const noKeyText = `Designing on the canvas uses your own Anthropic API key, kept in your keychain.${controller.canOpenInClaudeCode ? " With a Claude plan, open it in Claude Code instead: it draws on this canvas as it writes." : ""}`;
  // A reply without an import (a question, or wiring patches) is the status line itself. Without a key, the
  // notice below shows why nothing was sent, and the (hidden) live region says so to screen readers.
  const line = noKey ? null : designStatusLine(design, assistant, now, placement);
  const noKeyAnnouncement = `Nothing was sent. Designing here needs your own Anthropic API key${controller.canOpenInClaudeCode ? ", or you can open it in Claude Code" : ""}.`;
  const confirms = assistant.items.filter((i): i is Extract<ChatItem, { kind: "confirm" }> => i.kind === "confirm" && i.status === "pending" && i.runId === assistant.runId);
  // The chips follow the box's own finished request; a result that's undone or gone has nothing left to follow up on.
  const result = design.result && placement?.state === "here" ? design.result : null;
  const chips = result ? designResultChips(design, topTxn, placement) : [];
  // An MCP client (Claude Code) drawing on the canvas: the person can take its preview off.
  const remote = liveMcpDraft(design, now);
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
    void sendDesign(session, text, bounds);
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

  const promptFor = (browser: boolean, text = composerRef.current?.value.trim() ?? "") => claudePrompt({ docName: doc.project.name, text, context: canvasContext(session, target, bounds), browser });

  const copyPrompt = async (browser: boolean, prompt = promptFor(browser)) => {
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

  // Terminal runs the person's own `claude` in their app's folder, and it draws on this canvas through preview_design.
  const openInClaudeCode = async () => {
    // Sending cleared the field: a request the Assistant couldn't finish (an error, Stop, the budget) goes to Claude Code instead.
    const { request } = design;
    const unfinished = request && request.outcome !== undefined && request.outcome !== "completed" && !request.imported ? request.text : "";
    const text = composerRef.current?.value.trim() || unfinished;
    if (!text) {
      toast({ title: "Describe the screen first", description: "Write what Claude Code should design in the box, then choose Open in Claude Code.", tone: "warn" });
      composerRef.current?.focus({ preventScroll: true });
      return;
    }
    const prompt = promptFor(false, text);
    setHandingOff(true);
    const opened = await controller.openInClaudeCode(prompt);
    setHandingOff(false);
    if (!opened || (!opened.ok && opened.cancelled)) return;
    if (opened.ok) toast({ title: "Opened Claude Code", description: `In Terminal, in “${folderName(opened.folder)}”. It designs on this canvas as it writes.`, tone: "ai" });
    else toast.error("Couldn't open Claude Code", { description: opened.error ?? "Copy the prompt instead, and paste it into Claude Code in your app's folder.", action: { label: "Copy prompt", onClick: () => void copyPrompt(false, prompt) } });
  };

  // Not while the box's own reply runs: Claude Code would design on the canvas beside it.
  const openButton = (variant: "ai" | "ghost") => (
    <Button size="sm" variant={variant} icon={<SquareTerminal size={13} />} loading={handingOff} disabled={boxRun} onClick={() => void openInClaudeCode()}>
      Open in Claude Code
    </Button>
  );

  const linkCodeFolder = async () => {
    setCodeError(null);
    const linked = await controller.linkCodeFolder();
    if (linked?.error) setCodeError(linked.error);
  };

  const unlinkCodeFolder = async () => {
    setCodeError(null);
    await controller.unlinkCodeFolder();
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
  };

  const hidePreview = (key: string) => {
    dismissDraft(key);
    composerRef.current?.focus({ preventScroll: true });
  };

  const runChip = (chip: DesignResultChip, r: DesignResult) => {
    if (chip.id === "undo") undo(r);
    else if (chip.id === "sendToBack") sendToBack(r);
    else if (chip.message) submit(chip.message);
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
      {/* Always in the tree, so screen readers hear each new line. The detail (the size so far) isn't announced. */}
      <div className="sb-design-box__status" data-tone={line?.tone} data-empty={line ? undefined : ""}>
        {line ? STATUS_ICONS[line.tone] : null}
        <div className="sb-design-box__status-body">
          <p className="sb-design-box__status-text" role="status" aria-live="polite">
            {line?.text ?? (noKey ? noKeyAnnouncement : "")}
          </p>
          {line?.detail ? (
            <span className="sb-design-box__status-detail" aria-hidden>
              {line.detail}
            </span>
          ) : null}
        </div>
        {line?.action ? (
          <Button size="sm" variant="ghost" icon={line.action === "api_key" ? <KeyRound size={13} /> : undefined} onClick={() => runAction(line.action!)}>
            {line.action === "settings" ? "Open Settings" : line.action === "new_chat" ? "New chat" : "API key"}
          </Button>
        ) : null}
      </div>

      {remote ? (
        <div className="sb-design-box__mcp">
          <span className="sb-design-box__mcp-dot" aria-hidden />
          <p className="sb-design-box__mcp-text">{mcpDraftText(remote)}</p>
          <Button size="sm" variant="ghost" icon={<EyeOff size={13} />} onClick={() => hidePreview(remote.key)}>
            Hide preview
          </Button>
        </div>
      ) : null}

      {result && chips.length ? (
        <>
          {/* After a follow-up that didn't import, the status line is that reply. */}
          {result.reply && design.request?.imported ? <p className="sb-design-box__reply">{result.reply}</p> : null}
          <div className="sb-design-box__chips" role="group" aria-label="Next steps">
            {chips.map((chip) => (
              <Button key={chip.id} size="sm" variant={chip.message ? "ai" : undefined} icon={CHIP_ICONS[chip.id]} onClick={() => runChip(chip, result)}>
                {chip.label}
              </Button>
            ))}
          </div>
        </>
      ) : null}

      {confirms.map((item) => (
        <ConfirmCard key={item.id} item={item} onConfirm={(id, approved) => void controller.confirm(id, approved)} />
      ))}

      {!controller.available ? (
        <div className="sb-design-box__notice">
          <p id={noticeId}>Claude designs on the canvas in the Sonobe desktop app, with your own API key or Claude Code. Here, copy a prompt for Claude, then paste the HTML it writes.</p>
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
          <p id={noticeId}>{noKeyText}</p>
          <div className="sb-design-box__actions">
            {controller.canOpenInClaudeCode ? openButton("ai") : null}
            <Button size="sm" variant={controller.canOpenInClaudeCode ? undefined : "ai"} icon={<KeyRound size={13} />} onClick={() => assistantStore.getState().show()}>
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
        ariaDescribedBy={!controller.available || noKey ? noticeId : undefined}
        sendLabel={controller.available ? undefined : "Copy prompt"}
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
        {/* The no-key notice offers it first; otherwise it's here, for plan users with or without a key. */}
        {controller.canOpenInClaudeCode && !noKey ? openButton("ghost") : null}
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
