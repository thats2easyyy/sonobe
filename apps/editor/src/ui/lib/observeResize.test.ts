import { describe, expect, it } from "vitest";
import { observeResize, type ResizeObserverLike } from "./observeResize.ts";

function harness() {
  const observers: FakeObserver[] = [];
  class FakeObserver implements ResizeObserverLike {
    targets: Element[] = [];
    disconnected = false;
    readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target: Element) {
      this.targets.push(target);
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const frames = new Map<number, () => void>();
  let next = 1;
  return {
    observers,
    frames,
    options: {
      Observer: FakeObserver,
      requestFrame: (cb: () => void) => {
        const id = next++;
        frames.set(id, cb);
        return id;
      },
      cancelFrame: (id: unknown) => void frames.delete(id as number),
    },
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      for (const cb of pending) cb();
    },
  };
}

const el = {} as Element;

describe("observeResize", () => {
  it("coalesces notifications into one call on the next frame", () => {
    const h = harness();
    let calls = 0;
    observeResize([el, null], () => calls++, h.options);
    expect(h.observers[0]!.targets).toEqual([el]);
    h.observers[0]!.callback();
    h.observers[0]!.callback();
    h.observers[0]!.callback();
    expect(calls).toBe(0);
    expect(h.frames.size).toBe(1);
    h.flush();
    expect(calls).toBe(1);
    h.observers[0]!.callback();
    h.flush();
    expect(calls).toBe(2);
  });

  it("cancels a pending frame and disconnects on dispose", () => {
    const h = harness();
    let calls = 0;
    const dispose = observeResize([el], () => calls++, h.options);
    h.observers[0]!.callback();
    dispose();
    expect(h.observers[0]!.disconnected).toBe(true);
    expect(h.frames.size).toBe(0);
    h.observers[0]!.callback();
    h.flush();
    expect(calls).toBe(0);
  });

  it("does nothing without elements or an observer", () => {
    const h = harness();
    const dispose = observeResize([null, undefined], () => undefined, h.options);
    expect(h.observers).toEqual([]);
    dispose();
    expect(() => observeResize([el], () => undefined, { Observer: undefined })()).not.toThrow();
  });
});
