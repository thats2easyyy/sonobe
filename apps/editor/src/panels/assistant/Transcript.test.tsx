// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem } from "./assistantStore.ts";
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

  it("still focuses Delete for a deletion, with its own copy", () => {
    const item: ConfirmItem = { kind: "confirm", id: "c2", runId: "r1", title: "Delete 12 items?", message: "…", count: 12, status: "pending" };
    act(() => root.render(<ConfirmCard item={item} onConfirm={() => undefined} />));
    expect(buttons()).toEqual(["Keep them", "Delete"]);
    expect(document.activeElement?.textContent).toBe("Delete");
    act(() => root.render(<ConfirmCard item={{ ...item, status: "declined" }} onConfirm={() => undefined} />));
    expect(container.textContent).toContain("You kept them.");
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
      { kind: "notice", id: "n3", tone: "error", text: "Claude's agent adapter stopped unexpectedly.", code: "agent_crashed" },
    ];
    act(() => root.render(<Transcript items={items} running={false} thinking={false} onConfirm={() => undefined} onManageKey={onManageKey} onSuggestion={() => undefined} />));
    expect(buttons()).toEqual(["Set up…", "API key"]);
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    expect(onManageKey).toHaveBeenCalledTimes(1);
  });
});
