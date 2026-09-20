import { describe, expect, it } from "vitest";
import type { OrbTone } from "./orb.ts";
import { CAUSE_MS, createFrameQueue, createOrbBudget, createOrbQueue, createOrbRelay, FAR_ORB_CAP, RELAY_MAX_MS, RELAY_STAGGER_MS, staleOrb, type RelaySend } from "./orbSchedule.ts";

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

/** A relay whose batches flush when told, and sends that record when they were told to leave (no earlier than `gate`, as a cable still drawing in holds its orb). */
function relayHarness(flightMs = 300) {
  let pending: (() => void) | null = null;
  const relay = createOrbRelay((flush) => (pending = flush));
  const launched = new Map<string, number>();
  const send = (from: string, to: string, event: number, { arrives = true, gate = -Infinity }: { arrives?: boolean; gate?: number } = {}): RelaySend => {
    const s: RelaySend = {
      from,
      to,
      event,
      launch: (ready) => {
        const leave = Math.max(ready, gate);
        launched.set(`${from}→${to}`, leave);
        return arrives ? { leave, arrive: leave + flightMs } : null;
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
  it("sends an orb out of a node RELAY_STAGGER_MS behind the orb into it, whatever order they came in", () => {
    const { send, flush, launched } = relayHarness();
    send("sw", "not", 0);
    send("not", "out", 0);
    send("tick", "sw", 0);
    flush();
    expect(Object.fromEntries(launched)).toEqual({ "tick→sw": 0, "sw→not": RELAY_STAGGER_MS, "not→out": 2 * RELAY_STAGGER_MS });
  });

  it("follows an orb sent a moment before, in an earlier batch", () => {
    const { send, flush, launched } = relayHarness();
    send("tick", "sw", 0);
    flush();
    send("sw", "not", 45);
    flush();
    expect(launched.get("sw→not")).toBe(RELAY_STAGGER_MS);
  });

  it("leaves once the orb before has landed, after a flight shorter than the stagger", () => {
    const { send, flush, launched } = relayHarness(50);
    send("a", "b", 0);
    send("b", "c", 0);
    flush();
    expect(launched.get("b→c")).toBe(50);
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
    send("tick", "sw", 0, { arrives: false });
    send("sw", "not", 0);
    flush();
    expect(launched.get("sw→not")).toBe(0);
  });

  it("caps the wait, so a long chain keeps up with its values", () => {
    const { send, flush, launched } = relayHarness();
    const chain = ["a", "b", "c", "d", "e", "f", "g"];
    for (let i = 0; i < chain.length - 1; i++) send(chain[i]!, chain[i + 1]!, 0);
    flush();
    const leaves = chain.slice(0, -1).map((node, i) => launched.get(`${node}→${chain[i + 1]}`));
    expect(leaves).toEqual([0, RELAY_STAGGER_MS, 2 * RELAY_STAGGER_MS, 3 * RELAY_STAGGER_MS, RELAY_MAX_MS, RELAY_MAX_MS]);
  });

  it("never sends an orb ahead of the one it follows, which its cable drawing in may hold back", () => {
    const { send, flush, launched } = relayHarness();
    send("a", "b", 0, { gate: 600 });
    send("b", "c", 0);
    flush();
    expect(launched.get("a→b")).toBe(600);
    expect(launched.get("b→c")).toBe(600);
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

describe("staleOrb", () => {
  it("drops an orb whose cable draws in more than the relay's longest wait after its change", () => {
    expect(staleOrb(1000, 900)).toBe(false);
    expect(staleOrb(1000, 1000 + RELAY_MAX_MS)).toBe(false);
    expect(staleOrb(1000, 1001 + RELAY_MAX_MS)).toBe(true);
    // A reveal: Done turned on 208 ms in, and its cable finished drawing at 715 ms.
    expect(staleOrb(208, 715)).toBe(true);
  });
});

describe("createOrbBudget", () => {
  it("lets FAR_ORB_CAP orbs fly at once zoomed far out, and any number closer in", () => {
    const budget = createOrbBudget();
    const taken = Array.from({ length: FAR_ORB_CAP + 10 }, () => budget.take(0, 400, true));
    expect(taken.filter(Boolean)).toHaveLength(FAR_ORB_CAP);
    expect(budget.take(10, 400, false)).toBe(true);
    // Once they land there's room again.
    expect(budget.take(400, 800, true)).toBe(true);
    expect(budget.take(400, 800, true)).toBe(true);
    // Orbs closer in don't count against it.
    const near = createOrbBudget(2);
    for (let i = 0; i < 5; i++) expect(near.take(0, 400, false)).toBe(true);
    expect([near.take(0, 400, true), near.take(0, 400, true), near.take(0, 400, true)]).toEqual([true, true, false]);
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
