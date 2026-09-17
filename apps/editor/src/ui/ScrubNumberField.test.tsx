// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrubNumberField, type ScrubNumberFieldProps } from "./ScrubNumberField.tsx";

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

function Controlled({ initial = 10, onCommit, onChangeSpy, ...rest }: Partial<ScrubNumberFieldProps> & { initial?: number; onChangeSpy?: (v: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ScrubNumberField
      aria-label="Width"
      {...rest}
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
      onCommit={onCommit}
    />
  );
}

const input = () => container.querySelector("input")!;
const field = () => container.querySelector<HTMLDivElement>(".sb-scrub")!;

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

function type(text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pointer(kind: "pointerdown" | "pointermove" | "pointerup", clientX: number) {
  act(() => {
    field().dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, clientX, clientY: 0, pointerId: 1, button: 0 }));
  });
}

describe("ScrubNumberField", () => {
  it("nudges with arrow keys: ±1, Shift ±10, Alt ±0.1", () => {
    const onCommit = vi.fn();
    act(() => root.render(<Controlled onCommit={onCommit} />));
    act(() => input().focus());
    press("ArrowUp");
    expect(input().value).toBe("11");
    press("ArrowUp", { shiftKey: true });
    expect(input().value).toBe("21");
    press("ArrowDown", { altKey: true });
    expect(input().value).toBe("20.9");
    expect(onCommit).toHaveBeenLastCalledWith(20.9);
    expect(input().getAttribute("aria-valuenow")).toBe("20.9");
  });

  it("evaluates typed arithmetic on Enter and clamps to bounds", () => {
    const onCommit = vi.fn();
    act(() => root.render(<Controlled onCommit={onCommit} max={40} />));
    act(() => input().focus());
    type("667-49-64.5");
    press("Enter");
    expect(onCommit).toHaveBeenCalledWith(40);
    expect(input().value).toBe("40");
  });

  it("reverts a draft on Escape without emitting", () => {
    const onChangeSpy = vi.fn();
    act(() => root.render(<Controlled onChangeSpy={onChangeSpy} />));
    act(() => input().focus());
    type("99");
    press("Escape");
    expect(input().value).toBe("10");
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it("maps display units through scale", () => {
    const onCommit = vi.fn();
    act(() => root.render(<Controlled initial={0.5} scale={100} unit="%" step={0.01} min={0} max={1} precision={0} onCommit={onCommit} />));
    expect(input().value).toBe("50");
    act(() => input().focus());
    type("75%");
    press("Enter");
    expect(onCommit).toHaveBeenCalledWith(0.75);
    press("ArrowUp", { shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(0.85);
  });

  it("scrubs on drag and commits once on release", () => {
    const onCommit = vi.fn();
    const onChangeSpy = vi.fn();
    act(() => root.render(<Controlled onCommit={onCommit} onChangeSpy={onChangeSpy} pixelsPerStep={2} />));
    pointer("pointerdown", 100);
    pointer("pointermove", 102);
    expect(onChangeSpy).not.toHaveBeenCalled();
    pointer("pointermove", 110);
    expect(input().value).toBe("15");
    expect(field().hasAttribute("data-scrubbing")).toBe(true);
    pointer("pointermove", 90);
    expect(input().value).toBe("5");
    pointer("pointerup", 90);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(5);
    expect(field().hasAttribute("data-scrubbing")).toBe(false);
  });

  it("enters typing mode on a click without movement", () => {
    act(() => root.render(<Controlled />));
    pointer("pointerdown", 50);
    pointer("pointerup", 50);
    expect(document.activeElement).toBe(input());
  });

  it("shows a mixed placeholder and applies scrubs relative to zero", () => {
    const onChange = vi.fn();
    act(() => root.render(<ScrubNumberField aria-label="X" value={0} mixed onChange={onChange} pixelsPerStep={1} />));
    expect(input().value).toBe("");
    expect(input().placeholder).toBe("Mixed");
    pointer("pointerdown", 0);
    pointer("pointermove", 4);
    expect(onChange).toHaveBeenLastCalledWith(4, { source: "scrub", delta: 4 });
  });

  it("is read-only when linked", () => {
    const onChange = vi.fn();
    act(() => root.render(<ScrubNumberField aria-label="Scale" value={1.08} linked onChange={onChange} />));
    expect(input().readOnly).toBe(true);
    pointer("pointerdown", 0);
    pointer("pointermove", 20);
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector(".sb-scrub__link")).not.toBeNull();
  });
});
