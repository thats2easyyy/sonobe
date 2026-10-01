import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrbTone } from "./orb.ts";
import { createOrbBudget, createOrbRelay, FAR_ORB_CAP, RELAY_MAX_MS, RELAY_STAGGER_MS } from "./orbSchedule.ts";
import { createOrbSender, type OrbCable } from "./orbSend.ts";

/** A wire's draw animation as the appear store reports it: what the last frame left to draw, and `finished`. */
function drawAnimation(left: number) {
  let settle!: { resolve: () => void; reject: (reason: Error) => void };
  const finished = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
  finished.catch(() => {});
  return { left, finished, settle };
}

describe("createOrbSender", () => {
  const FLIGHT_MS = 300;
  let clock = 0;
  /** The appear store's view of the cables: the graph waiting to show, a clock time each is planned to be there, and a wire drawing on screen. */
  let waiting = false;
  let planned: Record<string, number> = {};
  let drawing: Record<string, ReturnType<typeof drawAnimation> | undefined> = {};
  let far = false;
  let flushes: (() => void)[] = [];
  let relay = createOrbRelay();
  let budget = createOrbBudget();

  const appear = {
    readyAt(_kind: "cable", id: string) {
      if (waiting) return Infinity;
      const draw = drawing[id];
      return Math.max(clock + (draw ? Math.max(1, draw.left) : 0), planned[id] ?? clock);
    },
    drawing: (id: string) => drawing[id],
  };

  function cable(id: string, from: string, to: string, more: Partial<OrbCable> = {}) {
    const log: string[] = [];
    const sender = createOrbSender({
      cable: () => ({ id, from, to, pulse: false, reduced: false, ...more }),
      appear,
      relay,
      budget,
      far: () => far,
      arrival: () => FLIGHT_MS,
      prepare: () => log.push("prepare"),
      launch(tone: OrbTone) {
        log.push(`${tone}@${clock}`);
        sender.setGap(200);
      },
      release: () => log.push("release"),
      now: () => clock,
    });
    return { sender, log };
  }

  /** Run the relay's batch: the microtask after the sends of one moment. */
  const flush = () => {
    for (const run of flushes.splice(0)) run();
  };
  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };
  /** A frame finished (or cancelled) the wire's draw. */
  const finish = async (id: string, cancelled = false) => {
    const draw = drawing[id]!;
    drawing[id] = undefined;
    if (cancelled) draw.settle.reject(new Error("AbortError"));
    else draw.settle.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    clock = 1000;
    waiting = false;
    planned = {};
    drawing = {};
    far = false;
    flushes = [];
    relay = createOrbRelay((run) => flushes.push(run));
    budget = createOrbBudget();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("doesn't wait out a tick of the clock on a cable that's there", () => {
    // The store answers "there now" with its own reading of the clock, a tick after the sender's last one.
    const tick = () => (clock += 0.1);
    const log: string[] = [];
    const sender = createOrbSender({
      cable: () => ({ id: "c", from: "a", to: "b", pulse: false, reduced: false }),
      appear: { readyAt: () => tick(), drawing: () => undefined },
      relay,
      budget,
      far: () => false,
      arrival: () => FLIGHT_MS,
      prepare: () => {},
      launch(tone: OrbTone) {
        log.push(tone);
        sender.setGap(200);
      },
      release: () => log.push("release"),
      now: tick,
    });
    expect(sender.send("full")).toBe(true);
    flush();
    expect(log).toEqual(["full"]);
    // The next change waits for the gap, and then leaves from the timer the same way.
    sender.send("dim");
    flush();
    expect(log).toEqual(["full"]);
    advance(210);
    expect(log).toEqual(["full", "dim"]);
  });

  it("launches at once on a cable that's there, and holds a boolean's next change until the gap opens", () => {
    const { sender, log } = cable("c", "a", "b");
    expect(sender.send("full")).toBe(true);
    expect(log).toEqual([]);
    flush();
    expect(log).toEqual(["full@1000"]);
    advance(80);
    sender.send("dim");
    flush();
    expect(sender.waiting()).toBe(true);
    advance(119);
    expect(log).toEqual(["full@1000", "prepare"]);
    advance(1);
    expect(log).toEqual(["full@1000", "prepare", "dim@1200"]);
    expect(sender.waiting()).toBe(false);
  });

  it("drops a pulse inside the gap, and flashes at once with reduced motion", () => {
    const pulse = cable("c", "a", "b", { pulse: true });
    pulse.sender.send("full");
    flush();
    advance(50);
    pulse.sender.send("full");
    flush();
    advance(1000);
    expect(pulse.log).toEqual(["full@1000"]);

    const reduced = cable("r", "a", "b", { reduced: true });
    reduced.sender.send("full");
    expect(reduced.log).toEqual([`full@${clock}`]);
    expect(flushes).toEqual([]);
  });

  it("follows the orb flying into its node", () => {
    const into = cable("in", "a", "b");
    const out = cable("out", "b", "c");
    into.sender.send("full");
    out.sender.send("full");
    flush();
    expect(into.log).toEqual(["full@1000"]);
    advance(RELAY_STAGGER_MS);
    expect(out.log).toEqual(["prepare", `full@${1000 + RELAY_STAGGER_MS}`]);
  });

  it("holds a send while the wire draws, by the wire's own animation and not the clock it was planned on", async () => {
    const { sender, log } = cable("c", "a", "b");
    planned.c = 1040;
    drawing.c = drawAnimation(40);
    expect(sender.send("full")).toBe(true);
    flush();
    expect(log).toEqual(["prepare"]);
    // The plan's time comes and goes; the frames are late, and the wire isn't whole yet.
    drawing.c.left = 25;
    advance(60);
    drawing.c.left = 3;
    advance(60);
    expect(log).toEqual(["prepare"]);
    expect(sender.waiting()).toBe(true);
    await finish("c");
    expect(log).toEqual(["prepare", "full@1120"]);
    expect(sender.waiting()).toBe(false);
  });

  it("holds a send whose wire was nearly drawn when it was sent, and still drawing when the relay launched it", async () => {
    const { sender, log } = cable("c", "a", "b");
    drawing.c = drawAnimation(4);
    sender.send("full");
    // The rest of the tick (every other cable's send) takes longer than the wire had left; no frame has run.
    clock += 20;
    flush();
    expect(log).toEqual(["prepare"]);
    advance(50);
    expect(log).toEqual(["prepare"]);
    await finish("c");
    expect(log).toEqual(["prepare", "full@1070"]);
  });

  it("holds a send with reduced motion switched on mid-draw, too", async () => {
    const { sender, log } = cable("c", "a", "b", { reduced: true });
    drawing.c = drawAnimation(4);
    sender.send("full");
    expect(log).toEqual(["prepare"]);
    advance(10);
    await finish("c");
    expect(log).toEqual(["prepare", "full@1010"]);
  });

  it("sends one orb for a change that joins the send waiting, even past its time", async () => {
    const { sender, log } = cable("c", "a", "b");
    drawing.c = drawAnimation(30);
    sender.send("full");
    flush();
    drawing.c.left = 10;
    advance(100);
    // The waiting send's time (1030) has passed, but its wire is still drawing.
    sender.send("dim");
    flush();
    expect(log).toEqual(["prepare"]);
    advance(20);
    await finish("c");
    expect(log).toEqual(["prepare", "dim@1120"]);
    advance(1000);
    expect(log).toEqual(["prepare", "dim@1120"]);
  });

  it("goes on waiting when the draw is cut short and another begins", async () => {
    const { sender, log } = cable("c", "a", "b");
    drawing.c = drawAnimation(100);
    sender.send("full");
    flush();
    advance(100);
    // Panned away and back: the first animation is cancelled, and the wrapper painted again draws the rest.
    const first = drawing.c;
    const second = drawAnimation(60);
    first.settle.reject(new Error("AbortError"));
    drawing.c = second;
    await Promise.resolve();
    await Promise.resolve();
    advance(30);
    expect(log).toEqual(["prepare"]);
    await finish("c");
    expect(log).toEqual(["prepare", "full@1130"]);
  });

  it("launches when the draw is cancelled and the wire is whole (the appearance swept)", async () => {
    const { sender, log } = cable("c", "a", "b");
    drawing.c = drawAnimation(100);
    sender.send("full");
    flush();
    advance(100);
    await finish("c", true);
    expect(log).toEqual(["prepare", "full@1100"]);
  });

  it("asks by the clock, not in a spin, when an animation says it's over and the store still reads it as drawing", async () => {
    const { sender, log } = cable("c", "a", "b");
    const draw = (drawing.c = drawAnimation(40));
    sender.send("full");
    flush();
    advance(40);
    draw.left = 0.0001;
    draw.settle.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["prepare"]);
    expect(vi.getTimerCount()).toBe(1);
    drawing.c = undefined;
    advance(1);
    expect(log).toEqual(["prepare", "full@1041"]);
  });

  it("waits by the clock for a cable that fades in or isn't mounted yet", () => {
    const { sender, log } = cable("c", "a", "b");
    planned.c = 1180;
    sender.send("full");
    flush();
    advance(179);
    expect(log).toEqual(["prepare"]);
    advance(1);
    expect(log).toEqual(["prepare", "full@1180"]);
  });

  it("drops a send whose cable is there too long after its change, and lets the cable show its value", async () => {
    const late = cable("late", "a", "b");
    planned.late = 1000 + RELAY_MAX_MS + 1;
    expect(late.sender.send("full")).toBe(false);
    expect(flushes).toEqual([]);

    // Not too late when sent, but the frames fell behind while it waited.
    const { sender, log } = cable("c", "a", "b");
    drawing.c = drawAnimation(200);
    expect(sender.send("full")).toBe(true);
    flush();
    advance(RELAY_MAX_MS + 100);
    await finish("c");
    expect(log).toEqual(["prepare", "release"]);
    expect(sender.waiting()).toBe(false);

    // And one that's too late by the time the relay launches it.
    const slow = cable("slow", "a", "b");
    drawing.slow = drawAnimation(RELAY_MAX_MS - 10);
    expect(slow.sender.send("full")).toBe(true);
    clock += 20;
    flush();
    expect(slow.log).toEqual(["release"]);
    expect(slow.sender.waiting()).toBe(false);
  });

  it("sends nothing while the graph waits to show, and drops the send waiting when it starts to", async () => {
    const { sender, log } = cable("c", "a", "b");
    waiting = true;
    expect(sender.send("full")).toBe(false);
    waiting = false;
    drawing.c = drawAnimation(50);
    sender.send("full");
    flush();
    drawing.c.left = 20;
    advance(60);
    // Another document replaces this one: the graph waits to show again, and the draw is cancelled.
    waiting = true;
    await finish("c", true);
    expect(log).toEqual(["prepare", "release"]);
    expect(sender.waiting()).toBe(false);
  });

  it("launches nothing once stopped: not the send waiting on a draw, and not one the relay still holds", async () => {
    const { sender, log } = cable("c", "a", "b");
    drawing.c = drawAnimation(50);
    sender.send("full");
    flush();
    sender.stop();
    await finish("c");
    advance(1000);
    expect(log).toEqual(["prepare"]);

    sender.start();
    sender.send("full");
    sender.stop();
    flush();
    expect(log).toEqual(["prepare"]);
    expect(sender.send("full")).toBe(false);
  });

  it("skips a new flight zoomed far out once FAR_ORB_CAP are flying, releasing the cable", () => {
    far = true;
    const cables = Array.from({ length: FAR_ORB_CAP + 1 }, (_, i) => cable(`c${i}`, "a", `b${i}`));
    for (const c of cables) c.sender.send("full");
    flush();
    expect(cables.slice(0, FAR_ORB_CAP).every((c) => c.log.length === 1 && c.log[0] === "full@1000")).toBe(true);
    expect(cables[FAR_ORB_CAP]!.log).toEqual(["release"]);
  });
});
