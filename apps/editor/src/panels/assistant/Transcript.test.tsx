// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem, ToolChip } from "./assistantStore.ts";
import { ConfirmCard, Transcript } from "./Transcript.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type ConfirmItem = Extract<ChatItem, { kind: "confirm" }>;
const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);

describe("ConfirmCard", () => {
  const replace: ConfirmItem = {
    kind: "confirm",
    id: "c1",
    runId: "r1",
    title: "Replace your changes to “Checkout”?",
    message: "You changed Title after Claude made this screen. Claude's new version replaces the whole screen. You can undo it afterwards.",
    count: 0,
    status: "pending",
    confirmKind: "replace",
    approveLabel: "Replace",
    declineLabel: "Keep my changes",
  };

  it("asks before a replace with its labels, focusing the choice that keeps the person's work", () => {
    const onConfirm = vi.fn();
    act(() => root.render(<ConfirmCard item={replace} onConfirm={onConfirm} />));
    const dialog = container.querySelector('[role="alertdialog"]')!;
    // Focus goes to a button, so the title names the dialog and the message, what the choice changes, describes it.
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Replace your changes to “Checkout”?");
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(replace.message);
    expect(container.querySelector(".sb-assistant-confirm")?.getAttribute("data-kind")).toBe("replace");
    expect(buttons()).toEqual(["Keep my changes", "Replace"]);
    expect(document.activeElement?.textContent).toBe("Keep my changes");
    act(() => (container.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(onConfirm).toHaveBeenCalledWith("c1", true);

    act(() => root.render(<ConfirmCard item={{ ...replace, status: "approved" }} onConfirm={onConfirm} />));
    expect(container.textContent).toContain("You allowed the change.");
    expect(container.querySelector("[aria-describedby]")).toBeNull();
    act(() => root.render(<ConfirmCard item={{ ...replace, status: "declined" }} onConfirm={onConfirm} />));
    expect(container.textContent).toContain("You kept it.");
  });

  it("focuses Keep them, never Delete, for a deletion, with its own copy", () => {
    const item: ConfirmItem = { kind: "confirm", id: "c2", runId: "r1", title: "Delete 12 items?", message: "…", count: 12, status: "pending" };
    act(() => root.render(<ConfirmCard item={item} onConfirm={() => undefined} />));
    expect(buttons()).toEqual(["Keep them", "Delete"]);
    expect(document.activeElement?.textContent).toBe("Keep them");
    act(() => root.render(<ConfirmCard item={{ ...item, status: "declined" }} onConfirm={() => undefined} />));
    expect(container.textContent).toContain("You kept them.");
  });

  it("leaves focus in a field the person is typing in, so a typed space can't answer", () => {
    const onConfirm = vi.fn();
    const field = document.createElement("textarea");
    container.before(field);
    field.focus();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const delete12: ConfirmItem = { kind: "confirm", id: "c3", runId: "r1", title: "Delete 12 items?", message: "…", count: 12, status: "pending" };
    for (const item of [delete12, replace, { ...replace, id: "p2", confirmKind: "permission" as const, options: [{ id: "a", label: "Allow", kind: "allow_once" as const }] }]) {
      act(() => root.render(<ConfirmCard item={item} onConfirm={onConfirm} />));
      expect(document.activeElement).toBe(field);
      expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
      act(() => void field.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      expect(onConfirm).not.toHaveBeenCalled();
    }
    field.remove();
    scroll.mockRestore();
  });

  it("leaves focus in a dialog or the palette open over it", () => {
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    const search = document.createElement("button");
    modal.appendChild(search);
    document.body.appendChild(modal);
    search.focus();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    act(() => root.render(<ConfirmCard item={replace} onConfirm={() => undefined} />));
    expect(document.activeElement).toBe(search);
    expect(scroll).toHaveBeenLastCalledWith({ block: "nearest" });
    modal.remove();
    scroll.mockRestore();
  });

  it("collapses to one line once answered, with the question on hover", () => {
    act(() => root.render(<ConfirmCard item={{ ...replace, status: "approved" }} onConfirm={() => undefined} />));
    const card = container.querySelector(".sb-assistant-confirm")!;
    expect(card.getAttribute("data-status")).toBe("approved");
    expect(card.getAttribute("data-kind")).toBe("replace");
    expect(card.querySelector("button")).toBeNull();
    expect(card.textContent).toBe("You allowed the change.");
    expect(card.getAttribute("aria-label")).toBe(replace.message);
    vi.useFakeTimers();
    try {
      act(() => void card.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
      act(() => void card.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" })));
      act(() => void vi.advanceTimersByTime(600));
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(replace.message);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ConfirmCard for a permission", () => {
  const permission: ConfirmItem = {
    kind: "confirm",
    id: "p1",
    runId: "r1",
    title: "Allow Claude to save this prototype?",
    message: "Claude wants to save this prototype to ~/Documents/Placemark.sonobe. Claude Code asks before steps that reach outside this prototype.",
    count: 0,
    status: "pending",
    confirmKind: "permission",
    // A reject listed first still comes last.
    options: [
      { id: "reject", label: "Don't allow", kind: "reject_once" },
      { id: "allow-once", label: "Allow", kind: "allow_once" },
      { id: "allow-with-updates", label: "Allow for this chat", kind: "allow_always" },
    ],
  };

  it("shows one button per choice, allows first, with nothing picked for you", () => {
    const onConfirm = vi.fn();
    act(() => root.render(<ConfirmCard item={permission} onConfirm={onConfirm} />));
    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Allow Claude to save this prototype?");
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(permission.message);
    expect(dialog.getAttribute("data-kind")).toBe("permission");
    expect(buttons()).toEqual(["Allow", "Allow for this chat", "Don't allow"]);
    expect([...container.querySelectorAll("button")].map((b) => b.getAttribute("data-variant"))).toEqual(["primary", "secondary", "ghost"]);
    // Focus is on the card, so Enter doesn't answer it.
    expect(document.activeElement).toBe(dialog);
    act(() => (container.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(onConfirm).toHaveBeenCalledWith("p1", true, "allow-with-updates");
    act(() => (container.querySelectorAll("button")[2] as HTMLButtonElement).click());
    expect(onConfirm).toHaveBeenLastCalledWith("p1", false, "reject");
  });

  it("says what was chosen", () => {
    const shows = (item: Partial<ConfirmItem>) => {
      act(() => root.render(<ConfirmCard item={{ ...permission, ...item }} onConfirm={() => undefined} />));
      return container.querySelector(".sb-assistant-confirm__result")?.textContent;
    };
    expect(shows({ status: "approved", optionId: "allow-once" })).toBe("Allowed");
    // The line names what was asked, before the answer.
    expect(container.querySelector(".sb-assistant-confirm__label")?.textContent).toBe(permission.title);
    expect(shows({ status: "approved", optionId: "allow-with-updates" })).toBe("Allowed for this chat");
    expect(shows({ status: "declined", optionId: "reject" })).toBe("Not allowed");
    // Settled without an answer (Stop, or the reply ended).
    expect(shows({ status: "declined" })).toBe("Not allowed");
    expect(container.querySelector("[role='alertdialog']")).toBeNull();
  });

  it("asks yes or no when the agent sent no choices", () => {
    const onConfirm = vi.fn();
    const { options: _options, ...bare } = permission;
    act(() => root.render(<ConfirmCard item={bare} onConfirm={onConfirm} />));
    expect(buttons()).toEqual(["Don't allow", "Allow"]);
    expect(document.activeElement?.textContent).toBe("Don't allow");
    act(() => (container.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(onConfirm).toHaveBeenCalledWith("p1", true);
  });
});

describe("Transcript", () => {
  it("tags a message sent from the canvas", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "a checkout", origin: "canvas" },
      { kind: "user", id: "u2", text: "what does this do?" },
    ];
    act(() => root.render(<Transcript items={items} running={false} thinking={false} onConfirm={() => undefined} onManageKey={() => undefined} onSuggestion={() => undefined} />));
    const messages = container.querySelectorAll(".sb-assistant-msg[data-role='user']");
    expect(messages[0]?.querySelector(".sb-assistant-msg__origin")?.textContent).toBe("From the canvas");
    expect(messages[1]?.querySelector(".sb-assistant-msg__origin")).toBeNull();
  });

  it("offers the setup for Claude subscription errors, and the key for key errors", () => {
    const onManageKey = vi.fn();
    const items: ChatItem[] = [
      { kind: "notice", id: "n1", tone: "error", text: "Claude isn't signed in on this computer.", code: "not_signed_in" },
      { kind: "notice", id: "n2", tone: "error", text: "Anthropic didn't accept this API key.", code: "invalid_key" },
      { kind: "notice", id: "n3", tone: "error", text: "Claude Code stopped unexpectedly during this reply.", code: "agent_crashed" },
      // The message says what to do: wait, or switch to the API key.
      { kind: "notice", id: "n4", tone: "error", text: "Your Claude plan's usage limit is reached.", code: "usage_limit" },
      { kind: "notice", id: "n5", tone: "error", text: "Claude is limiting requests right now (not your plan's usage limit).", code: "rate_limited" },
      { kind: "notice", id: "n6", tone: "error", text: "Sonobe couldn't set Claude Code to ask before it saves or opens files, so nothing ran.", code: "agent_failed" },
    ];
    act(() => root.render(<Transcript items={items} running={false} thinking={false} onConfirm={() => undefined} onManageKey={onManageKey} onSuggestion={() => undefined} />));
    expect(buttons()).toEqual(["Set up…", "API key", "Set up…"]);
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(onManageKey).toHaveBeenCalledTimes(1);
  });

  const tool = (over: Partial<ToolChip>): ToolChip => ({ toolUseId: "t", name: "get_outline", title: "Get outline", detail: "", status: "done", changedDocument: false, ...over });
  const assistantItem = (tools: ToolChip[]): ChatItem => ({ kind: "assistant", id: "a1", runId: "r1", turn: 1, text: "", thinking: "", tools });
  const renderItems = (items: ChatItem[], props: Partial<Parameters<typeof Transcript>[0]> = {}) =>
    act(() => root.render(<Transcript items={items} running={false} thinking={false} onConfirm={() => undefined} onManageKey={() => undefined} onSuggestion={() => undefined} {...props} />));

  it("folds finished reads into one row that expands, and keeps edits, failures and lone reads as rows", () => {
    renderItems([
      assistantItem([
        tool({ toolUseId: "1" }),
        tool({ toolUseId: "2", name: "list_patches", title: "List patches" }),
        tool({ toolUseId: "3", name: "add_layers", title: "Add layers", detail: "Card", changedDocument: true }),
        tool({ toolUseId: "4", name: "get_screenshot", title: "Screenshot" }),
        tool({ toolUseId: "5", name: "save_document", title: "Save prototype" }),
        tool({ toolUseId: "6", name: "get_outline", status: "error", detail: "Nothing to read" }),
      ]),
    ]);
    const rows = () => [...container.querySelectorAll("li.sb-assistant-tool")].map((li) => li.querySelector(".sb-assistant-tool__title")?.textContent);
    expect(rows()).toEqual(["Add layers", "Screenshot", "Save prototype", "Get outline"]);
    const fold = container.querySelector<HTMLButtonElement>(".sb-assistant-tool-fold__toggle")!;
    expect(fold.textContent).toBe("Looked at the prototype · 2 steps");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(fold.hasAttribute("aria-controls")).toBe(false);
    act(() => fold.click());
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toEqual(["Get outline", "List patches", "Add layers", "Screenshot", "Save prototype", "Get outline"]);
    expect(container.querySelector('li[data-status="done"][data-edited]')?.textContent).toContain("Add layers");
    expect(container.querySelector('ul[aria-label="Tool activity"]')).not.toBeNull();
  });

  it("doesn't fold a read that's still running or a single one", () => {
    renderItems([assistantItem([tool({ toolUseId: "1" }), tool({ toolUseId: "2", status: "running" })])]);
    expect(container.querySelector(".sb-assistant-tool-fold")).toBeNull();
    expect(container.querySelectorAll("li.sb-assistant-tool")).toHaveLength(2);
  });

  it("offers New chat on the notices that say to start one", () => {
    const onNewChat = vi.fn();
    renderItems(
      [
        { kind: "notice", id: "n1", tone: "warn", text: "This chat used its 1,500K token budget. Start a new chat to keep going.", code: "budget" },
        { kind: "notice", id: "n2", tone: "error", text: "Claude subscription is off in Settings → Claude. Turn it back on, or start a new chat to use your API key.", code: "subscription_off" },
        { kind: "notice", id: "n3", tone: "info", text: "The Assistant paused after 30 steps. Send a message to continue." },
      ],
      { onNewChat },
    );
    expect(buttons()).toEqual(["New chat", "New chat"]);
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(onNewChat).toHaveBeenCalledTimes(1);
    renderItems([{ kind: "notice", id: "n1", tone: "warn", text: "Start a new chat to keep going.", code: "budget" }]);
    expect(buttons()).toEqual([]);
  });

  it("shows Stopped as a quiet line, not a box", () => {
    renderItems([{ kind: "user", id: "u1", text: "go" }, { kind: "notice", id: "n1", tone: "info", text: "Stopped.", code: "stopped" }]);
    expect(container.querySelector(".sb-assistant-stopped")?.textContent).toBe("Stopped.");
    expect(container.querySelector(".sb-assistant-notice")).toBeNull();
  });

  it("scrolls to the bottom for a message you send or a question waiting for you, even from far up", () => {
    const user = (n: number): ChatItem => ({ kind: "user", id: `u${n}`, text: `message ${n}` });
    renderItems([user(1), user(2)]);
    const log = container.querySelector<HTMLElement>('[role="log"]')!;
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 300 });
    log.scrollTop = 0;
    act(() => void log.dispatchEvent(new Event("scroll")));
    // A reply streaming in while you read further up leaves you where you are…
    renderItems([user(1), user(2), { kind: "assistant", id: "a1", runId: "r1", turn: 1, text: "hi", thinking: "", tools: [] }]);
    expect(log.scrollTop).toBe(0);
    // …a message of your own, or a pending question, brings you back.
    renderItems([user(1), user(2), user(3)]);
    expect(log.scrollTop).toBe(1000);
    log.scrollTop = 0;
    act(() => void log.dispatchEvent(new Event("scroll")));
    renderItems([user(1), user(2), user(3), { kind: "confirm", id: "c1", runId: "r1", title: "Delete 12 items?", message: "…", count: 12, status: "pending" }]);
    expect(log.scrollTop).toBe(1000);
  });

  it("leaves the empty chat left-aligned with its three starter prompts", () => {
    renderItems([]);
    expect(container.querySelector(".sb-assistant-empty__title")?.textContent).toBe("What should we build?");
    expect(container.querySelector(".sb-assistant-empty__body")?.textContent).toBe("Describe a change and Claude makes it. It shows in AI Activity as Assistant and can be undone with Ctrl+Z.");
    expect(buttons()).toEqual(["Explain how this prototype works", "Make the photo zoom in when I tap it", "Add a like button with a bouncy animation"]);
  });

  it("names the undo shortcut of the platform it runs on", () => {
    const platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    renderItems([]);
    expect(container.querySelector(".sb-assistant-empty__body")?.textContent).toContain("undone with ⌘Z.");
    platform.mockRestore();
  });
});
