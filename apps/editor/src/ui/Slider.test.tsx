// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Slider, type SliderProps } from "./Slider.tsx";

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

function Controlled({ initial = 95, onCommit, onChangeSpy, ...rest }: Partial<SliderProps> & { initial?: number; onChangeSpy?: (v: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Slider
      aria-label="Commit Distance"
      min={0}
      max={200}
      step={1}
      valueText={(v) => `${v} pt`}
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

const slider = () => container.querySelector<HTMLDivElement>('[role="slider"]')!;
const track = () => container.querySelector<HTMLDivElement>(".sb-slider__track")!;

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    slider().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

function pointer(kind: "pointerdown" | "pointermove" | "pointerup", clientX: number, target: Element = slider()) {
  act(() => {
    target.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, clientX, clientY: 0, pointerId: 1, button: 0 }));
  });
}

/** A 200 px track starting at x = 100, so one pixel is one point of a 0…200 range. */
function layOut() {
  vi.spyOn(track(), "getBoundingClientRect").mockReturnValue({ left: 100, width: 200, top: 0, height: 4, right: 300, bottom: 4, x: 100, y: 0, toJSON: () => ({}) });
}

describe("Slider", () => {
  it("says its value with the unit", () => {
    act(() => root.render(<Controlled />));
    expect(slider().getAttribute("aria-valuenow")).toBe("95");
    expect(slider().getAttribute("aria-valuetext")).toBe("95 pt");
    expect(slider().getAttribute("aria-valuemin")).toBe("0");
    expect(slider().getAttribute("aria-valuemax")).toBe("200");
  });

  it("jumps to the pointer, follows the drag in steps, and commits once on release", () => {
    const onCommit = vi.fn();
    const onChangeSpy = vi.fn();
    act(() => root.render(<Controlled onCommit={onCommit} onChangeSpy={onChangeSpy} step={5} />));
    layOut();
    pointer("pointerdown", 150);
    expect(onChangeSpy).toHaveBeenLastCalledWith(50);
    pointer("pointermove", 262);
    expect(onChangeSpy).toHaveBeenLastCalledWith(160);
    pointer("pointermove", 900);
    expect(onChangeSpy).toHaveBeenLastCalledWith(200);
    expect(onCommit).not.toHaveBeenCalled();
    pointer("pointerup", 900);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(200);
  });

  it("commits a drag it's removed in the middle of", () => {
    const onCommit = vi.fn();
    act(() => root.render(<Controlled onCommit={onCommit} />));
    layOut();
    pointer("pointerdown", 150);
    pointer("pointermove", 170);
    act(() => root.render(<div />));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(70);
  });

  it("steps with the keyboard: arrows, Shift ×10, Alt ×0.1, Home and End", () => {
    const onCommit = vi.fn();
    act(() => root.render(<Controlled onCommit={onCommit} />));
    press("ArrowRight");
    expect(slider().getAttribute("aria-valuenow")).toBe("96");
    press("ArrowRight", { shiftKey: true });
    expect(slider().getAttribute("aria-valuenow")).toBe("106");
    press("ArrowLeft", { altKey: true });
    expect(slider().getAttribute("aria-valuenow")).toBe("105.9");
    press("End");
    expect(slider().getAttribute("aria-valuenow")).toBe("200");
    press("Home");
    expect(onCommit).toHaveBeenLastCalledWith(0);
    expect(onCommit).toHaveBeenCalledTimes(5);
  });

  it("leaves ↑ and ↓ to the list around it when asked", () => {
    const outer = vi.fn();
    act(() =>
      root.render(
        <div onKeyDown={(event) => outer(event.key)}>
          <Controlled arrowKeys="horizontal" />
        </div>,
      ),
    );
    press("ArrowUp");
    expect(slider().getAttribute("aria-valuenow")).toBe("95");
    expect(outer).toHaveBeenCalledWith("ArrowUp");
    press("ArrowRight");
    expect(outer).not.toHaveBeenCalledWith("ArrowRight");
  });

  it("pins a value past the range to its end with a caret, and steps back from that end", () => {
    act(() => root.render(<Controlled initial={250} />));
    expect(slider().dataset.overflow).toBe("above");
    expect(slider().style.getPropertyValue("--sb-slider-ratio")).toBe("1");
    expect(slider().getAttribute("aria-valuetext")).toBe("250 pt, above the range");
    press("ArrowLeft");
    expect(slider().getAttribute("aria-valuenow")).toBe("199");
    expect(slider().dataset.overflow).toBeUndefined();
  });

  it("marks ticks and copies one on click without moving the thumb by itself", () => {
    const onSelect = vi.fn();
    const onChangeSpy = vi.fn();
    act(() => root.render(<Controlled onChangeSpy={onChangeSpy} ticks={[{ value: 40, label: "Shipped app: 40 pt", color: "red", onSelect }]} />));
    const tick = container.querySelector<HTMLButtonElement>(".sb-slider__tick")!;
    expect(tick.getAttribute("aria-label")).toBe("Shipped app: 40 pt");
    expect(tick.style.getPropertyValue("--sb-tick-ratio")).toBe("0.2");
    layOut();
    pointer("pointerdown", 140, tick);
    act(() => tick.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const onChangeSpy = vi.fn();
    act(() => root.render(<Controlled disabled onChangeSpy={onChangeSpy} />));
    layOut();
    pointer("pointerdown", 150);
    press("ArrowRight");
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(slider().tabIndex).toBe(-1);
  });
});
