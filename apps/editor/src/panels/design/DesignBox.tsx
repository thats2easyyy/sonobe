/**
 * The Design with Claude box: floats at the bottom of the canvas, follows the selection (a new screen,
 * or a redesign of the selected layer), sends to the in-app Assistant with the canvas's context, and
 * shows what Claude is doing and what it made. Without the Assistant, it copies a prompt instead.
 */

import { artboardSize, findLayer } from "@sonobe/core";
import { Check, CircleAlert, Copy, FolderCode, KeyRound, LoaderCircle, MessageSquare, ScanLine, SendToBack, Sparkles, TriangleAlert, Undo2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
import { designStore, sendDesign, useDesign, type DesignResult } from "./designStore.ts";
import { claudePrompt } from "./prompt.ts";
import { designResultChips, designRunState, designStatusLine, type DesignResultChip, type DesignStatusLine } from "./status.ts";
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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const [noKey, setNoKey] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sentBack, setSentBack] = useState<string | null>(null);
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
    composerRef.current?.focus({ preventScroll: true });
  }, [controller]);

  useEffect(() => {
    if (assistant.status?.hasKey) setNoKey(false);
  }, [assistant.status?.hasKey]);

  if (!shows) return null;

  const target = designTarget(session, { newScreen: design.newScreen, result: design.result });
  const copy = chipCopy(target, artboardSize(doc, componentId));
  const runState = designRunState(design, assistant);
  const boxRun = runState === "running";
  const busy = runState === "busy";
  // A reply without an import (a question, or wiring patches) is the status line itself.
  const line = designStatusLine(design, assistant, Date.now());
  const confirms = assistant.items.filter((i): i is Extract<ChatItem, { kind: "confirm" }> => i.kind === "confirm" && i.status === "pending" && i.runId === assistant.runId);
  // The chips follow the box's own finished import; a result whose screen is gone (undone, deleted) has nothing left to follow up on.
  const result = design.result && findLayer(doc.components[design.result.component]?.layers ?? [], design.result.layerId) ? design.result : null;
  const chips = result ? designResultChips(design, topTxn) : [];
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
    setSentBack(r.layerId);
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

      {result && chips.length ? (
        <>
          {result.reply ? <p className="sb-design-box__reply">{result.reply}</p> : null}
          <div className="sb-design-box__chips" role="group" aria-label="Next steps">
            {chips
              .filter((chip) => chip.id !== "sendToBack" || sentBack !== result.layerId)
              .map((chip) => (
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
