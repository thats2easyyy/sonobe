import { describe, expect, it } from "vitest";
import type { OrbTone } from "./orb.ts";
import { CAUSE_MS, createFrameQueue, createOrbQueue, createOrbRelay, RELAY_MAX_MS, type RelaySend } from "./orbSchedule.ts";

/** Drives a queue the way Orb does, with a fake clock: returns [time, tone] for each orb that leaves. */
function drive(sends: [now: number, tone: OrbTone][], { hold, gap = 200 }: { hold: boolean; gap?: number }) {
  const queue = createOrbQueue();
  const played: [number, OrbTone][] = [];
  let timer: number | null = null;
  const fire = (until: number) => {
    if (timer !== null && timer <= until) {
      const at = timer;
      timer = null;
      const tone = queue.take(at);
      if (tone) played.push([at, tone]);
    }
  };
  for (const [now, tone] of sends) {
    fire(now);
    const go = queue.offer(now, tone, { hold });
    if (!go) continue;
    queue.setGap(gap);
    if (go.timer) timer = go.at;
    else if (go.at === now) played.push([now, tone]);
  }
  fire(Infinity);
  return played;
}

describe("createOrbQueue", () => {
  it("drops pulses inside the gap", () => {
    const every = Array.from({ length: 40 }, (_, i) => [i * 16, "full"] as [number, OrbTone]);
    expect(drive(every, { hold: false }).map(([t]) => t)).toEqual([0, 208, 416, 624]);
  });

  it("holds a boolean's turn-off until the gap opens, so a quick tap shows both", () => {
    expect(
      drive(
        [
          [0, "full"],
          [80, "dim"],
        ],
        { hold: true },
      ),
    ).toEqual([
      [0, "full"],
      [200, "dim"],
    ]);
  });

  it("keeps only the latest held change", () => {
    const played = drive(
      [
        [0, "full"],
        [50, "dim"],
        [90, "full"],
      ],
      { hold: true },
    );
    expect(played).toEqual([
      [0, "full"],
      [200, "full"],
    ]);
  });

  it("waits for `ready` even for a pulse", () => {
    const queue = createOrbQueue();
    expect(queue.offer(0, "full", { ready: 300 })).toEqual({ at: 300, timer: true });
    expect(queue.waiting()).toBe(true);
    // A later send joins the one waiting rather than setting another timer.
    expect(queue.offer(10, "full", { ready: 500 })).toEqual({ at: 300, timer: false });
    expect(queue.take(300)).toBe("full");
    expect(queue.waiting()).toBe(false);
  });

  it("forgets a held send when cleared", () => {
    const queue = createOrbQueue();
    queue.offer(0, "full", { hold: true });
    queue.setGap(200);
    queue.offer(50, "dim", { hold: true });
    queue.clear();
    expect(queue.take(200)).toBeNull();
  });
});

/** A relay whose batches flush when told, and sends that record when they were told to leave. */
function relayHarness(flightMs = 300) {
  let pending: (() => void) | null = null;
  const relay = createOrbRelay((flush) => (pending = flush));
  const launched = new Map<string, number>();
  const send = (from: string, to: string, event: number, arrives = true): RelaySend => {
    const s: RelaySend = {
      from,
      to,
      event,
      launch: (ready) => {
        launched.set(`${from}→${to}`, ready);
        return arrives ? ready + flightMs : null;
      },
    };
    relay.send(s);
    return s;
  };
  const flush = () => {
    const f = pending;
    pending = null;
    f?.();
  };
  return { send, flush, launched };
}

describe("createOrbRelay", () => {
  it("launches an orb out of a node when the orb into it lands, whatever order they came in", () => {
    const { send, flush, launched } = relayHarness();
    send("sw", "not", 0);
    send("not", "out", 0);
    send("tick", "sw", 0);
    flush();
    expect(Object.fromEntries(launched)).toEqual({ "tick→sw": 0, "sw→not": 300, "not→out": 600 });
  });

  it("waits on an orb sent a moment before, in an earlier batch", () => {
    const { send, flush, launched } = relayHarness();
    send("tick", "sw", 0);
    flush();
    send("sw", "not", 45);
    flush();
    expect(launched.get("sw→not")).toBe(300);
  });

  it("doesn't wait on an orb from an unrelated moment", () => {
    const { send, flush, launched } = relayHarness();
    send("tick", "sw", 0);
    flush();
    send("sw", "not", CAUSE_MS + 20);
    flush();
    expect(launched.get("sw→not")).toBe(CAUSE_MS + 20);
  });

  it("doesn't wait on a send that sent no orb", () => {
    const { send, flush, launched } = relayHarness();
    send("tick", "sw", 0, false);
    send("sw", "not", 0);
    flush();
    expect(launched.get("sw→not")).toBe(0);
  });

  it("caps the wait, so a long chain can't fall far behind", () => {
    const { send, flush, launched } = relayHarness(RELAY_MAX_MS * 2);
    send("a", "b", 0);
    send("b", "c", 0);
    flush();
    expect(launched.get("b→c")).toBe(RELAY_MAX_MS);
  });

  it("gets through a loop", () => {
    const { send, flush, launched } = relayHarness();
    send("a", "b", 0);
    send("b", "a", 0);
    send("c", "c", 0);
    flush();
    expect(launched.size).toBe(3);
  });
});

describe("createFrameQueue", () => {
  it("runs jobs a few milliseconds a frame, at least one each frame, in order", () => {
    let clock = 0;
    const frames: (() => void)[] = [];
    const queue = createFrameQueue((run) => frames.push(run), () => clock, 4);
    const ran: [frame: number, job: number][] = [];
    let frame = 0;
    for (let i = 0; i < 6; i++)
      queue.add(() => {
        ran.push([frame, i]);
        clock += 3;
      });
    expect(frames).toHaveLength(1);
    while (frames.length) {
      frame++;
      frames.shift()!();
    }
    // 3 ms a job and a 4 ms budget: two a frame.
    expect(ran).toEqual([
      [1, 0],
      [1, 1],
      [2, 2],
      [2, 3],
      [3, 4],
      [3, 5],
    ]);
  });

  it("still runs a job that takes longer than the budget", () => {
    let clock = 0;
    const frames: (() => void)[] = [];
    const queue = createFrameQueue((run) => frames.push(run), () => clock, 4);
    const ran: number[] = [];
    queue.add(() => ran.push((clock += 10)));
    queue.add(() => ran.push((clock += 10)));
    frames.shift()!();
    expect(ran).toEqual([10]);
    frames.shift()!();
    expect(ran).toEqual([10, 20]);
    expect(frames).toHaveLength(0);
  });
});
