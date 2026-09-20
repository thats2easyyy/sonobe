import { CircleUserRound, KeyRound, LoaderCircle, MessageSquarePlus, Monitor, ScanLine, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { appPanels } from "../../app/appPanels.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { connectClaudeStore } from "../connect/connectStore.ts";
import { assistantStore as defaultStore, useAssistant, type AssistantState } from "./assistantStore.ts";
import { Composer } from "./Composer.tsx";
import { createAssistantController, sharedAssistantController, type AssistantController } from "./controller.ts";
import { KeySetup } from "./KeySetup.tsx";
import { activeProvider, chatProvider, providerName, providerReady, providerSubtitle } from "./provider.ts";
import { SubscriptionSetup } from "./SubscriptionSetup.tsx";
import { Transcript } from "./Transcript.tsx";
import { FALLBACK_MODELS, getAssistantHost, type AssistantHostLike, type AssistantProvider } from "./types.ts";
import "./assistant.css";

export interface AssistantDrawerProps {
  /** Shows a close button. */
  onClose?: () => void;
  /** Opens Connect Claude (default: connectClaudeStore.show()). */
  onConnectClaude?: () => void;
  /** Opens File → Import Design, from the browser notice (default: appPanels.show("importDesign")). */
  onImportDesign?: () => void;
  /** Default: window.sonobeHost. Null means browser mode (desktop-only notice). */
  host?: AssistantHostLike | null;
  store?: StoreApi<AssistantState>;
  /** Or pass a controller you created (tests); the drawer won't dispose it. */
  controller?: AssistantController;
  className?: string;
}

/**
 * The Assistant drawer: chat with Claude using the person's own Anthropic API key (or, with the
 * experimental switch on, their Claude subscription), with streamed replies, tool activity chips, Stop,
 * a model picker, confirmations (deleting items, replacing a screen, permissions), and a usage meter.
 * When what the chat runs on isn't ready it shows the setup; in the browser, a desktop-only notice that
 * points to Import Design. Fills its container.
 */
export function AssistantDrawer({ onClose, onConnectClaude, onImportDesign, host, store = defaultStore, controller: providedController, className }: AssistantDrawerProps) {
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
  const managing = useAssistant((s) => s.setup, store);
  const setManaging = (setup: boolean) => store.getState().setSetup(setup);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void controller.refresh();
  }, [controller]);

  const connect = onConnectClaude ?? (() => connectClaudeStore.getState().show());
  const importDesign = onImportDesign ?? (() => appPanels.getState().show("importDesign"));
  const models = status?.models ?? FALLBACK_MODELS;
  const subscriptionOn = status?.connection?.subscriptionEnabled === true;
  // The window's chat keeps what its first message ran on; a new chat runs on what's active.
  const active = activeProvider(status);
  const provider = chatProvider(status);
  const modelOptions: SelectOption[] = models.map((m) => ({
    value: m.id,
    label: m.label,
    description: provider === "subscription" ? `${m.description} Uses your Claude plan's limits.` : `${m.description} $${m.pricing.input}/$${m.pricing.output} per million tokens (in/out).`,
  }));
  const showSetup = controller.available && status !== null && (!providerReady(status, provider) || managing);
  // Which setup shows: the person's pick while the switch is on, else the key.
  const setupProvider: AssistantProvider = subscriptionOn ? (status?.connection?.provider ?? "api_key") : "api_key";

  const pick = (next: AssistantProvider) => {
    // The setup stays up for the pick, even when it's ready already: the person looks before going back.
    setManaging(true);
    void controller.setConnection({ provider: next });
  };

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
        description="It uses your own Anthropic API key, kept in your computer's keychain, so it isn't available in the browser. Claude's live edits need the desktop app too. Here, ask Claude for a screen as HTML and paste it into File → Import Design."
        actions={
          <Button variant="ai" icon={<ScanLine size={14} />} onClick={importDesign}>
            Import Design…
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
  } else if (showSetup) {
    const done = () => setManaging(false);
    body = (
      <div className="sb-assistant__scroll">
        {/* Changing it mid-reply would reset the chat under it, so it waits for the reply. */}
        {subscriptionOn ? (
          <div className="sb-assistant-setup__choice">
            <SegmentedControl<AssistantProvider>
              fullWidth
              aria-label="What the Assistant runs on"
              value={setupProvider}
              onChange={pick}
              options={[
                {
                  value: "subscription",
                  disabled: running,
                  label: (
                    <>
                      Claude subscription
                      <Badge size="sm" tone="warn">
                        Experimental
                      </Badge>
                    </>
                  ),
                },
                { value: "api_key", label: "API key", disabled: running },
              ]}
            />
          </div>
        ) : null}
        {setupProvider === "subscription" ? (
          <SubscriptionSetup controller={controller} subscription={status.subscription} onDone={done} doneLabel={items.length ? "Back to chat" : "Use Claude subscription"} />
        ) : (
          <KeySetup controller={controller} status={status} keyCheck={keyCheck} onConnectClaude={connect} {...(status.hasKey ? { onDone: done } : {})} />
        )}
      </div>
    );
  } else {
    body = (
      <>
        <Transcript
          items={items}
          running={running}
          thinking={thinking}
          onConfirm={(id, approved, optionId) => void controller.confirm(id, approved, optionId)}
          onManageKey={() => setManaging(true)}
          onSuggestion={(text) => {
            send(text);
            composerRef.current?.focus();
          }}
        />
        {provider !== active ? (
          <p className="sb-assistant-provider-note">
            This chat uses {providerName(provider)}. A new chat uses {providerName(active)}.{" "}
            <button type="button" className="sb-assistant-link" disabled={running} onClick={() => void controller.newChat()}>
              New chat
            </button>
          </p>
        ) : null}
        <Composer ref={composerRef} running={running} onSend={send} onStop={() => void controller.stop()} usage={usage} limits={limits} provider={provider} />
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
          <p className="sb-assistant__subtitle">{controller.available ? providerSubtitle(status, provider) : "Desktop only"}</p>
        </div>
        <div className="sb-assistant__actions">
          {controller.available && status && !showSetup ? (
            <>
              <Select options={modelOptions} value={model} onChange={(id) => store.getState().setModel(id)} aria-label="Model" size="sm" variant="ghost" disabled={running} searchable={false} renderValue={(option) => option?.label.replace(/^Claude /, "") ?? "Model"} />
              <IconButton icon={<MessageSquarePlus size={15} />} label="New chat" size="sm" disabled={items.length === 0 && !running} onClick={() => void controller.newChat()} />
              {provider === "subscription" ? (
                <IconButton icon={<CircleUserRound size={15} />} label="Claude subscription" size="sm" onClick={() => setManaging(true)} />
              ) : (
                <IconButton icon={<KeyRound size={15} />} label="API key" size="sm" onClick={() => setManaging(true)} />
              )}
            </>
          ) : null}
          {onClose ? <IconButton icon={<X size={15} />} label="Close Assistant" size="sm" onClick={onClose} /> : null}
        </div>
      </header>
      <div className="sb-assistant__body">{body}</div>
    </section>
  );
}
