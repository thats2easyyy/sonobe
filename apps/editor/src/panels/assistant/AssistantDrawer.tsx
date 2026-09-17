import { KeyRound, LoaderCircle, MessageSquarePlus, Monitor, Plug, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { connectClaudeStore } from "../connect/connectStore.ts";
import { assistantStore as defaultStore, useAssistant, type AssistantState } from "./assistantStore.ts";
import { Composer } from "./Composer.tsx";
import { createAssistantController, sharedAssistantController, type AssistantController } from "./controller.ts";
import { KeySetup } from "./KeySetup.tsx";
import { Transcript } from "./Transcript.tsx";
import { FALLBACK_MODELS, getAssistantHost, type AssistantHostLike } from "./types.ts";
import "./assistant.css";

export interface AssistantDrawerProps {
  /** Shows a close button. */
  onClose?: () => void;
  /** Opens Connect Claude (default: connectClaudeStore.show()). */
  onConnectClaude?: () => void;
  /** Default: window.sonobeHost. Null means browser mode (desktop-only notice). */
  host?: AssistantHostLike | null;
  store?: StoreApi<AssistantState>;
  /** Or pass a controller you created (tests); the drawer won't dispose it. */
  controller?: AssistantController;
  className?: string;
}

/**
 * The Assistant drawer: chat with Claude using the person's own Anthropic API key, with streamed
 * replies, tool activity chips, Stop, a model picker, deletion confirmations, and a token budget meter.
 * Without a key it shows the key setup; in the browser, a desktop-only notice. Fills its container.
 */
export function AssistantDrawer({ onClose, onConnectClaude, host, store = defaultStore, controller: providedController, className }: AssistantDrawerProps) {
  const [api] = useState<AssistantHostLike | null>(() => (host === undefined ? getAssistantHost() : host));
  const useShared = providedController === undefined && host === undefined && store === defaultStore;
  const controller = useMemo(() => providedController ?? (useShared ? sharedAssistantController() : createAssistantController(api, store)), [providedController, useShared, api, store]);
  const owned = providedController === undefined && !useShared;
  useEffect(() => {
    if (!owned) return;
    controller.attach();
    return () => controller.dispose();
  }, [controller, owned]);

  const status = useAssistant((s) => s.status, store);
  const statusError = useAssistant((s) => s.statusError, store);
  const items = useAssistant((s) => s.items, store);
  const running = useAssistant((s) => s.running, store);
  const thinking = useAssistant((s) => s.thinking, store);
  const model = useAssistant((s) => s.model, store);
  const usage = useAssistant((s) => s.usage, store);
  const limits = useAssistant((s) => s.limits, store);
  const keyCheck = useAssistant((s) => s.keyCheck, store);
  const [managingKey, setManagingKey] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void controller.refresh();
  }, [controller]);

  const connect = onConnectClaude ?? (() => connectClaudeStore.getState().show());
  const models = status?.models ?? FALLBACK_MODELS;
  const modelOptions: SelectOption[] = models.map((m) => ({ value: m.id, label: m.label, description: `${m.description} $${m.pricing.input}/$${m.pricing.output} per million tokens (in/out).` }));
  const showKeySetup = controller.available && status !== null && (!status.hasKey || managingKey);

  const send = (text: string) => {
    void controller.send(text);
  };

  let body;
  if (!controller.available) {
    body = (
      <EmptyState
        className="sb-assistant-browser"
        icon={<Monitor size={20} strokeWidth={1.75} />}
        title="The Assistant runs in the Sonobe desktop app"
        description="It uses your own Anthropic API key, kept in your computer's keychain, so it isn't available in the browser. To build with Claude here, connect Claude Desktop or Claude Code over MCP."
        actions={
          <Button variant="ai" icon={<Plug size={14} />} onClick={connect}>
            Connect Claude…
          </Button>
        }
      />
    );
  } else if (status === null) {
    body = statusError ? (
      <EmptyState
        title="The Assistant didn't load"
        description={statusError}
        actions={
          <Button size="sm" onClick={() => void controller.refresh()}>
            Try again
          </Button>
        }
      />
    ) : (
      <div className="sb-assistant-loading" role="status">
        <LoaderCircle size={16} className="sb-spin" aria-hidden /> Loading…
      </div>
    );
  } else if (showKeySetup) {
    body = (
      <div className="sb-assistant__scroll">
        <KeySetup controller={controller} status={status} keyCheck={keyCheck} onConnectClaude={connect} {...(status.hasKey ? { onDone: () => setManagingKey(false) } : {})} />
      </div>
    );
  } else {
    body = (
      <>
        <Transcript
          items={items}
          running={running}
          thinking={thinking}
          onConfirm={(id, approved) => void controller.confirm(id, approved)}
          onManageKey={() => setManagingKey(true)}
          onSuggestion={(text) => {
            send(text);
            composerRef.current?.focus();
          }}
        />
        <Composer ref={composerRef} running={running} onSend={send} onStop={() => void controller.stop()} usage={usage} limits={limits} />
      </>
    );
  }

  return (
    <section
      className={cx("sb-assistant", className)}
      aria-label="Assistant"
      onKeyDown={(event) => {
        if (event.key === "Escape" && running) {
          event.preventDefault();
          event.stopPropagation();
          void controller.stop();
        }
      }}
    >
      <header className="sb-assistant__header">
        <span className="sb-assistant__mark" aria-hidden>
          <Sparkles size={14} strokeWidth={2} />
        </span>
        <div className="sb-assistant__heading">
          <h2 className="sb-assistant__title">Assistant</h2>
          <p className="sb-assistant__subtitle">{controller.available ? (status?.hasKey ? `Your API key · ${status.keyHint ?? ""}` : "Bring your own API key") : "Desktop only"}</p>
        </div>
        <div className="sb-assistant__actions">
          {controller.available && status?.hasKey && !managingKey ? (
            <>
              <Select options={modelOptions} value={model} onChange={(id) => store.getState().setModel(id)} aria-label="Model" size="sm" variant="ghost" disabled={running} searchable={false} renderValue={(option) => option?.label.replace(/^Claude /, "") ?? "Model"} />
              <IconButton icon={<MessageSquarePlus size={15} />} label="New chat" size="sm" disabled={items.length === 0 && !running} onClick={() => void controller.newChat()} />
              <IconButton icon={<KeyRound size={15} />} label="API key" size="sm" onClick={() => setManagingKey(true)} />
            </>
          ) : null}
          {onClose ? <IconButton icon={<X size={15} />} label="Close Assistant" size="sm" onClick={onClose} /> : null}
        </div>
      </header>
      <div className="sb-assistant__body">{body}</div>
    </section>
  );
}
