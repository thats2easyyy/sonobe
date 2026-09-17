// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Popover } from "./Popover.tsx";
import { dismissableLayerCount } from "./lib/layerStack.ts";

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
  document.body.innerHTML = "";
});

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const set = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  return (
    <>
      <button ref={setAnchor} onClick={() => set(!open)}>
        Trigger
      </button>
      <Popover open={open} onOpenChange={set} anchor={anchor} aria-label="Demo popover">
        <input aria-label="Inside" />
      </Popover>
    </>
  );
}

const trigger = () => container.querySelector("button")!;
const popover = () => document.querySelector<HTMLElement>(".sb-popover");

describe("Popover", () => {
  it("positions portaled content once it mounts and focuses the first control", () => {
    act(() => root.render(<Harness />));
    act(() => trigger().click());
    const el = popover();
    expect(el).not.toBeNull();
    expect(el!.style.left).not.toBe("-10000px");
    expect(document.activeElement).toBe(el!.querySelector("input"));
    expect(dismissableLayerCount()).toBe(1);
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const onOpenChange = vi.fn();
    act(() => root.render(<Harness onOpenChange={onOpenChange} />));
    act(() => trigger().focus());
    act(() => trigger().click());
    act(() => {
      popover()!.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(dismissableLayerCount()).toBe(0);
  });

  it("closes on an outside press but not on a press inside or on the trigger", () => {
    const onOpenChange = vi.fn();
    act(() => root.render(<Harness onOpenChange={onOpenChange} />));
    act(() => trigger().click());
    act(() => {
      popover()!.querySelector("input")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(popover()).not.toBeNull();
    act(() => {
      trigger().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(popover()).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(popover()).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
