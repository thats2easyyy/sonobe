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
    expect(container.querySelector('[role="alertdialog"]')?.getAttribute("aria-label")).toBe("Replace your changes to “Checkout”?");
    expect(container.querySelector(".sb-assistant-confirm")?.getAttribute("data-kind")).toBe("replace");
    expect(buttons()).toEqual(["Keep my changes", "Replace"]);
    expect(document.activeElement?.textContent).toBe("Keep my changes");
    act(() => (container.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(onConfirm).toHaveBeenCalledWith("c1", true);

    act(() => root.render(<ConfirmCard item={{ ...replace, status: "approved" }} onConfirm={onConfirm} />));
    expect(container.textContent).toContain("You allowed the change.");
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
});
