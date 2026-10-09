// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster, toast } from "./Toast.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Toaster />));
});

afterEach(() => {
  act(() => toast.clear());
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const titles = () => [...document.querySelectorAll(".sb-toast__title")].map((el) => el.textContent);
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const show = (fn: () => void) => act(fn);

describe("Toast timing", () => {
  it("restarts the timer when a toast is replaced by id", () => {
    show(() => toast({ id: "t", title: "First", duration: 2600 }));
    advance(2000);
    show(() => toast({ id: "t", title: "Second", duration: 2600 }));
    advance(2000);
    expect(titles()).toEqual(["Second"]);
    advance(1000);
    expect(titles()).toEqual([]);
  });

  it("keeps a toast shown again under an id that was just dismissed", () => {
    let pressed = 0;
    show(() => toast({ id: "t", title: "Ready", duration: "persistent", action: { label: "Restart", onClick: () => void pressed++ } }));
    // The action takes its toast down; the answer comes back before the exit animation ends.
    act(() => document.querySelector<HTMLButtonElement>(".sb-toast__action")!.click());
    expect(pressed).toBe(1);
    advance(100);
    show(() => toast({ id: "t", title: "Still ready", duration: "persistent" }));
    advance(5000);
    expect(titles()).toEqual(["Still ready"]);
    // Dismissed and left alone, it goes.
    act(() => toast.dismiss("t"));
    advance(300);
    expect(titles()).toEqual([]);
  });

  it("keeps a toast with an action for at least 8 s", () => {
    show(() => toast({ title: "Added to Knobs", action: { label: "Show", onClick: () => undefined } }));
    advance(7500);
    expect(titles()).toEqual(["Added to Knobs"]);
    advance(1000);
    expect(titles()).toEqual([]);
  });

  it("keeps a failure with an action until it is dismissed", () => {
    show(() => toast.error("Couldn't save", { action: { label: "Retry", onClick: () => undefined } }));
    advance(60_000);
    expect(titles()).toEqual(["Couldn't save"]);
  });

  it("leaves explicit durations alone", () => {
    show(() => toast({ title: "Undid", duration: 2600, action: { label: "Redo", onClick: () => undefined } }));
    advance(2800);
    expect(titles()).toEqual([]);
  });

  it("pauses while focus is inside the toaster", () => {
    show(() => toast({ title: "Quick", duration: 3000 }));
    const close = document.querySelector<HTMLButtonElement>(".sb-toast__close")!;
    act(() => close.focus());
    advance(10_000);
    expect(titles()).toEqual(["Quick"]);
    act(() => close.blur());
    advance(3400);
    expect(titles()).toEqual([]);
  });

  it("stops pausing once the focused toast is dismissed", () => {
    show(() => toast({ id: "a", title: "Gone", duration: "persistent" }));
    show(() => toast({ id: "b", title: "Stays a while", duration: 3000 }));
    const close = document.querySelector<HTMLButtonElement>(".sb-toast__close")!;
    act(() => close.focus());
    advance(10_000);
    expect(titles()).toEqual(["Gone", "Stays a while"]);
    act(() => close.click());
    advance(300);
    advance(3600);
    expect(titles()).toEqual([]);
  });
});

describe("Toaster inset", () => {
  const stack = () => document.querySelector<HTMLElement>(".sb-toaster")!;

  it("keeps clear of a sheet on the right edge", () => {
    act(() => root.render(<Toaster inset={360} />));
    expect(stack().style.getPropertyValue("--sb-toast-inset")).toBe("360px");
  });

  it("sets nothing when no sheet is open", () => {
    act(() => root.render(<Toaster inset={0} />));
    expect(stack().style.getPropertyValue("--sb-toast-inset")).toBe("");
  });
});
