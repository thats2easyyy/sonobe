import { CircleUserRound, KeyRound, LoaderCircle, MessageSquarePlus, Monitor, ScanLine, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { appPanels } from "../../app/appPanels.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { isBehindModal } from "../../ui/lib/focus.ts";
import { connectClaudeStore } from "../connect/connectStore.ts";
import { assistantStore as defaultStore, useAssistant, type AssistantState } from "./assistantStore.ts";
import { Composer } from "./Composer.tsx";
import { createAssistantController, sharedAssistantController, type AssistantController } from "./controller.ts";
import { KeySetup } from "./KeySetup.tsx";
import { activeProvider, billedElsewhere, chatProvider, providerName, providerReady, providerSubtitle, subscriptionSwitchedOff } from "./provider.ts";
import { SubscriptionSetup } from "./SubscriptionSetup.tsx";
import { Transcript } from "./Transcript.tsx";
import { FALLBACK_MODELS, getAssistantHost, type AssistantHostLike, type AssistantProvider, type AssistantSubscriptionState } from "./types.ts";
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

/** "Quickest and cheapest, for small edits." → "Quickest and cheapest": the menu rows are one line. */
const gist = (text: string) => text.split(/[.,]\s|\.$/)[0] ?? text;

/**
 * The drawer's focus lands late (a frame, a status read, a new chat), so each one asks first whether the person is
 * still here: focus is in the drawer or nowhere, or still on `from`. Never behind an open dialog or the palette.
 */
function canTakeFocus(root: HTMLElement | null, from?: Element | null): boolean {
  if (!root || isBehindModal(root)) return false;
  const active = document.activeElement;
  return !active || active === document.body || root.contains(active) || active === from;
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
  const draft = useAssistant((s) => s.draft, store);
  const setManaging = (setup: boolean) => store.getState().setSetup(setup);
  const rootRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // The login's last answer (not "checking" or "unknown"): a check from the setup keeps it up until it answers.
  const settled = useRef<AssistantSubscriptionState | null>(null);

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
  // On the subscription, what pays when the adapter's login isn't a Claude plan (an API key, a gateway, another provider).
  const billedTo = provider === "subscription" ? billedElsewhere(status?.subscription) : null;
  const modelOptions: SelectOption[] = models.map((m) => ({
    value: m.id,
    label: m.label,
    description:
      provider !== "subscription"
        ? `${gist(m.description)} · $${m.pricing.input} in / $${m.pricing.output} out per 1M tokens`
        : billedTo
          ? `${gist(m.description)}. Billed to ${billedTo}.`
          : `${gist(m.description)}. Uses your Claude plan's limits.`,
  }));
  const subscriptionState = status?.subscription?.state;
  if (subscriptionState && subscriptionState !== "checking" && subscriptionState !== "unknown") settled.current = subscriptionState;
  // A subscription chat whose switch another window turned off: no setup fixes it, so the chat shows, with New chat.
  const switchedOff = subscriptionSwitchedOff(status, provider);
  // "Checking" counts as ready, but a check that started from signed out, not installed or failed (Check again, a sign-in)
  // keeps the setup up with its spinner, rather than showing the chat until the answer comes. Ready from there opens the chat.
  const rechecking = !switchedOff && provider === "subscription" && subscriptionState === "checking" && settled.current !== null && settled.current !== "ready";
  const showSetup = controller.available && status !== null && ((!switchedOff && !providerReady(status, provider)) || rechecking || managing);
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

  const focusComposer = () =>
    requestAnimationFrame(() => {
      if (canTakeFocus(rootRef.current)) composerRef.current?.focus({ preventScroll: true });
    });
  const newChat = () => void controller.newChat().then(focusComposer);

  // Focus goes to the message field when the sheet opens (a frame later: the palette gives focus back as it closes),
  // after New chat, and on returning from the setup; in the setup, to its first field or button. The first time it
  // comes from what had focus as the sheet opened (the button that opened it), since opening the sheet is the person
  // asking for it; later, not over focus they put elsewhere. Never over a question waiting for their answer, whose
  // card has taken focus itself.
  const surface = !controller.available || status === null ? "other" : showSetup ? "setup" : "chat";
  const openedFrom = useRef<Element | null>(null);
  useLayoutEffect(() => {
    openedFrom.current = document.activeElement;
  }, []);
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (surface === "other") return;
    const frame = requestAnimationFrame(() => {
      const first = !focusedOnce.current;
      focusedOnce.current = true;
      if (surface === "chat" && store.getState().items.some((item) => item.kind === "confirm" && item.status === "pending")) return;
      if (!canTakeFocus(rootRef.current, first ? openedFrom.current : null)) return;
      const target = surface === "chat" ? composerRef.current : (rootRef.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? rootRef.current?.querySelector<HTMLElement>(".sb-assistant__scroll .sb-btn:not(:disabled)"));
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [surface, store]);

  const subtitle = providerSubtitle(status, provider);
  // With only the API key there is one answer to "what does this run on", so its hint waits in the key button's tooltip; the strip is for telling a plan from a key.
  const showStrip = provider === "subscription" || (subscriptionOn && status?.hasKey === true);

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
          <KeySetup controller={controller} status={status} keyCheck={keyCheck} onConnectClaude={connect} subscriptionEnabled={subscriptionOn} {...(status.hasKey ? { onDone: done } : {})} />
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
          onConfirm={(id, approved, optionId) => {
            void controller.confirm(id, approved, optionId);
            // The button goes away with the answer: focus moves to the field, where Escape still stops the reply.
            composerRef.current?.focus({ preventScroll: true });
          }}
          onManageKey={() => setManaging(true)}
          onNewChat={newChat}
          onSuggestion={(text) => {
            send(text);
            composerRef.current?.focus();
          }}
        />
        {provider !== active ? (
          <p className="sb-assistant-provider-note">
            This chat uses {providerName(provider)}. A new chat uses {providerName(active)}.{" "}
            <button type="button" className="sb-assistant-link" disabled={running} onClick={newChat}>
              New chat
            </button>
          </p>
        ) : null}
        <Composer ref={composerRef} running={running} onSend={send} onStop={() => void controller.stop()} usage={usage} limits={limits} provider={provider} billedTo={billedTo} value={draft} onValueChange={store.getState().setDraft} />
      </>
    );
  }

  return (
    <section
      ref={rootRef}
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
        <h2 className="sb-assistant__title">Assistant</h2>
        <div className="sb-assistant__actions">
          {controller.available && status && !showSetup ? (
            <>
              <Select
                options={modelOptions}
                value={model}
                onChange={(id) => store.getState().setModel(id)}
                aria-label="Model"
                size="sm"
                variant="ghost"
                disabled={running}
                searchable={false}
                menuWidth={440}
                placement="bottom-end"
                renderValue={(option) => option?.label.replace(/^Claude /, "") ?? "Model"}
              />
              <IconButton icon={<MessageSquarePlus size={14} />} label="New chat" size="sm" disabled={items.length === 0 && !running} onClick={newChat} />
              {provider === "subscription" && !switchedOff ? (
                <IconButton icon={<CircleUserRound size={14} />} label="Claude subscription" size="sm" onClick={() => setManaging(true)} />
              ) : (
                <IconButton icon={<KeyRound size={14} />} label="API key" tooltip={status.hasKey && !showStrip ? `API key · ${status.keyHint ?? ""}` : undefined} size="sm" onClick={() => setManaging(true)} />
              )}
            </>
          ) : null}
          {onClose ? <IconButton icon={<X size={14} />} label="Close Assistant" size="sm" onClick={onClose} /> : null}
        </div>
      </header>
      <div className="sb-assistant__body">
        {controller.available && status && showStrip ? (
          <Tooltip content={subtitle.full} placement="bottom-start" disabled={subtitle.full === subtitle.text}>
            <p className="sb-assistant__subtitle" data-tone={billedTo ? "warn" : undefined} tabIndex={subtitle.full === subtitle.text ? undefined : 0}>
              {billedTo ? <TriangleAlert size={11} aria-hidden className="sb-assistant__subtitle-icon" /> : null}
              {subtitle.text}
            </p>
          </Tooltip>
        ) : null}
        {body}
      </div>
    </section>
  );
}
