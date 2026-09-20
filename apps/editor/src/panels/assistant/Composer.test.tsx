// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer, type ComposerProps } from "./Composer.tsx";
import { usage } from "./testing.ts";
import type { AssistantLimits } from "./types.ts";

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

const limits: AssistantLimits = { maxTurns: 30, tokenBudget: 1_000_000, deleteConfirmThreshold: 10 };

function mount(props: Partial<ComposerProps> = {}) {
  act(() => {
    root.render(<Composer running={false} onSend={() => undefined} onStop={() => undefined} usage={usage()} limits={limits} {...props} />);
  });
  return container.querySelector("textarea")!;
}

function type(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const pressEnter = (textarea: HTMLTextAreaElement) =>
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });

describe("Composer", () => {
  it("keeps the text when onSend returns false, and clears it otherwise", () => {
    const onSend = vi.fn<(text: string) => boolean | void>(() => false);
    let textarea = mount({ onSend });
    type(textarea, "a checkout");
    pressEnter(textarea);
    expect(onSend).toHaveBeenCalledWith("a checkout");
    expect(textarea.value).toBe("a checkout");

    onSend.mockImplementation(() => undefined);
    textarea = mount({ onSend });
    pressEnter(textarea);
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(textarea.value).toBe("");
  });

  it("takes its placeholder and label from props", () => {
    const textarea = mount({ placeholder: "What should change in “Card”?", ariaLabel: "Describe a change to “Card”" });
    expect(textarea.getAttribute("placeholder")).toBe("What should change in “Card”?");
    expect(textarea.getAttribute("aria-label")).toBe("Describe a change to “Card”");
    const plain = mount({ placeholder: undefined, ariaLabel: undefined });
    expect(plain.getAttribute("aria-label")).toBe("Message the Assistant");
  });

  it("hides the usage meter below usageThreshold, counting budget tokens", () => {
    // 900K tokens in all, but mostly cache reads: 400K budget tokens is 40% of the budget.
    mount({ usage: usage(900_000, 400_000), usageThreshold: 0.5 });
    expect(container.querySelector(".sb-assistant-usage")).toBeNull();

    mount({ usage: usage(900_000, 500_000), usageThreshold: 0.5 });
    const meter = container.querySelector(".sb-assistant-usage");
    expect(meter).not.toBeNull();
    expect(container.querySelector('[role="meter"]')?.getAttribute("aria-valuetext")).toBe("500K of 1M budget used in this chat");
    expect(meter?.getAttribute("title")).toMatch(/^Cache reads count at a tenth and cache writes at 1\.25×, the way they're billed\. Estimated at list prices/);
    expect(meter?.getAttribute("title")).toContain("900K tokens in all.");

    // Default: always shown.
    mount({ usage: usage(0), usageThreshold: undefined });
    expect(container.querySelector(".sb-assistant-usage")).not.toBeNull();
  });

  it("falls back to total tokens from hosts that don't send budget tokens", () => {
    const { budgetTokens: _budget, ...older } = usage(250_000);
    mount({ usage: older });
    expect(container.querySelector('[role="meter"]')?.getAttribute("aria-valuetext")).toBe("250K of 1M budget used in this chat");
    expect(container.querySelector(".sb-assistant-usage")?.getAttribute("title")).not.toContain("in all");
  });
});
