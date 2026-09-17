/** State patches wired together in real runtime documents. */

import { applyOps } from "@sonobe/core";
import type { SonobeDocument } from "@sonobe/core";
import { createSpringState, fromBouncinessSpeed, isLoop, stepSpring } from "@sonobe/engine";
import type { PatchDefinition } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, drag, idle, sequence, sequenceDefinition, tap } from "@sonobe/engine/testing";
import type { DocInput } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { definitions } from "./index.ts";

function setup(input: DocInput, extra: PatchDefinition[] = []) {
  const registry = createMockRegistry([...definitions, ...extra]);
  const doc = buildDoc(input, registry);
  const rt = createTestRuntime(doc, registry);
  const update = (ops: Parameters<typeof applyOps>[1]): SonobeDocument => {
    const result = applyOps(rt.document, ops, { registry });
    expect(result.errors).toEqual([]);
    rt.updateDocument(result.doc);
    return result.doc;
  };
  /** Step `n` frames and collect `addresses` after each. */
  const record = (n: number, addresses: string[]) =>
    Array.from({ length: n }, () => {
      rt.step();
      return addresses.map((a) => rt.getValue(a));
    });
  return { rt, registry, update, record };
}

const column = (rows: unknown[][], i: number) => rows.map((r) => r[i]);
const framesWhere = (values: unknown[], predicate: (v: unknown) => boolean) => values.flatMap((v, i) => (predicate(v) ? [i] : []));

describe("state patches in the runtime", () => {
  it("tap → switch → pop animation → transition settles the card's scale, matching engine spring physics", () => {
    const { rt } = setup({
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: [16, 120], size: [358, 220], scale: { link: "grow.output" } } }],
      patches: {
        tap_card: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "tap_card.tap" } } },
        pop: { type: "popAnimation", inputs: { number: { link: "toggle.on" }, bounciness: 5, speed: 10 } },
        grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.5 } },
      },
    });
    const config = fromBouncinessSpeed(5, 10);
    const reference = createSpringState(0);
    const script = sequence(idle(1), tap(100, 200), idle(150));
    let peak = 0;
    script.forEach((events, i) => {
      if (events.length) rt.dispatch(events);
      rt.step();
      reference.target = rt.getValue("toggle.on") === true ? 1 : 0;
      stepSpring(reference, config, i === 0 ? 0 : 1 / 60);
      expect(rt.getValue("pop.output") as number).toBeCloseTo(reference.value, 9);
      peak = Math.max(peak, rt.getValue("@card.scale") as number);
    });
    expect(rt.getValue("toggle.on")).toBe(true);
    expect(peak).toBeGreaterThan(1.5);
    expect(rt.getValue("@card.scale") as number).toBeCloseTo(1.5, 3);
  });

  it("runs a timed sequence from launch: Wait finishes, pulses delay as events, and states seed from their first value", () => {
    const { record } = setup({
      patches: {
        launch: { type: "whenPrototypeStarts" },
        timer: { type: "wait", inputs: { start: { link: "launch.started" }, duration: 0.5 } },
        shown: { type: "switch", inputs: { turnOn: { link: "timer.finished" } } },
        blip: { type: "delay", typeParam: "boolean", inputs: { value: { link: "launch.started" }, duration: 0.25 } },
        hold: { type: "delay", typeParam: "boolean", inputs: { value: { link: "launch.started" }, duration: 0.25, style: "whenDecreasing" } },
        started_on: { type: "switch", inputs: { turnOn: { link: "launch.started" } } },
        steady: { type: "delay", typeParam: "boolean", inputs: { value: { link: "started_on.on" }, duration: 0.25 } },
        next_frame: { type: "delay1", typeParam: "boolean", inputs: { value: { link: "launch.started" } } },
      },
    });
    const rows = record(40, ["launch.started", "timer.done", "timer.finished", "shown.on", "blip.output", "hold.output", "steady.output", "next_frame.output", "timer.progress"]);
    expect(framesWhere(column(rows, 0), (v) => v === true)).toEqual([0]);
    expect(framesWhere(column(rows, 1), (v) => v === true)[0]).toBe(30);
    expect(framesWhere(column(rows, 2), (v) => v === true)).toEqual([30]);
    expect(framesWhere(column(rows, 3), (v) => v === true)[0]).toBe(30);
    expect(framesWhere(column(rows, 4), (v) => v === true)).toEqual([15]);
    expect(framesWhere(column(rows, 5), (v) => v === true)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(column(rows, 6).every((v) => v === true)).toBe(true);
    expect(framesWhere(column(rows, 7), (v) => v === true)).toEqual([1]);
    expect(column(rows, 8)[15] as number).toBeCloseTo(0.5, 9);
  });

  it("launches a staggered entrance: a launch pulse into a looped boolean Delay fires every item on time", () => {
    const { record } = setup({
      patches: {
        launch: { type: "whenPrototypeStarts" },
        stagger: { type: "delay", typeParam: "boolean", inputs: { value: { link: "launch.started" }, duration: { loop: [0.05, 0.1, 0.15] } } },
        shown: { type: "switch", inputs: { turnOn: { link: "stagger.output" } } },
      },
    });
    const rows = record(14, ["stagger.output#0", "stagger.output#1", "stagger.output#2", "shown.on#0", "shown.on#2"]);
    expect([0, 1, 2].map((i) => framesWhere(column(rows, i), (v) => v === true))).toEqual([[3], [6], [9]]);
    expect(framesWhere(column(rows, 3), (v) => v === true)[0]).toBe(3);
    expect(framesWhere(column(rows, 4), (v) => v === true)).toEqual([9, 10, 11, 12, 13]);
  });

  it("steps a counter on a metronome and picks titles, pulsing when the step changes", () => {
    const { rt, record } = setup({
      layers: [{ id: "title", type: "text", name: "Title", props: { text: { link: "title_text.output" } } }],
      patches: {
        ticker: { type: "repeatingPulse", inputs: { interval: 0.5 } },
        step: { type: "counter", inputs: { increase: { link: "ticker.tick" }, maximumCount: 3 } },
        title_text: {
          type: "optionPicker",
          typeParam: "text",
          inputCount: 3,
          inputs: { option: { link: "step.count" }, option0: "Enter your name", option1: "Verify your email", option2: "You're all set" },
        },
        step_changed: { type: "pulseOnChange", inputs: { value: { link: "step.count" } } },
      },
    });
    const rows = record(95, ["@title.text", "step_changed.changed", "step.count"]);
    expect(rows[0]![0]).toBe("Enter your name");
    expect(rows[29]![0]).toBe("Enter your name");
    expect(rows[30]![0]).toBe("Verify your email");
    expect(rows[60]![0]).toBe("You're all set");
    expect(rows[90]![0]).toBe("Enter your name");
    expect(framesWhere(column(rows, 1), (v) => v === true)).toEqual([30, 60, 90]);
    expect(rt.issues()).toEqual([]);
  });

  it("drives screens from an Option Switch with 0-based ports, and clamps when options are removed", () => {
    const taps = sequenceDefinition("taps", "pulse", [false, false, true, false]);
    const { rt, update, record } = setup(
      {
        layers: [
          { id: "screen_a", type: "rectangle", name: "A", props: { enabled: { link: "visible.option0" } } },
          { id: "screen_b", type: "rectangle", name: "B", props: { enabled: { link: "visible.option1" } } },
          { id: "screen_c", type: "rectangle", name: "C", props: { enabled: { link: "visible.option2" } } },
        ],
        patches: {
          taps: { type: "taps" },
          tabs: { type: "optionSwitch", inputCount: 3, inputs: { setTo2: { link: "taps.value" } } },
          visible: { type: "optionSender", typeParam: "boolean", inputCount: 3, inputs: { option: { link: "tabs.option" } } },
          has_filter: { type: "optionEquals", typeParam: "index", inputCount: 2, inputs: { value: { link: "tabs.option" }, option0: 1, option1: 2 } },
        },
      },
      [taps],
    );
    const rows = record(4, ["@screen_a.enabled", "@screen_b.enabled", "@screen_c.enabled", "has_filter.option", "has_filter.equals"]);
    expect(rows[1]).toEqual([true, false, false, -1, false]);
    expect(rows[2]).toEqual([false, false, true, 1, true]);
    expect(rt.issues()).toEqual([]);

    update([{ op: "updatePatch", id: "tabs", inputCount: 2 }]);
    rt.step();
    expect(rt.getValue("tabs.option")).toBe(1);
    expect([rt.getValue("@screen_b.enabled"), rt.getValue("has_filter.option")]).toEqual([true, 0]);
  });

  it("closes a feedback loop through Delay One Frame with one frame of latency", () => {
    const { record } = setup({
      patches: {
        spin: { type: "add", inputs: { value1: { link: "last_angle.output" }, value2: 3 } },
        last_angle: { type: "delay1", inputs: { value: { link: "spin.output" } } },
      },
    });
    expect(column(record(5, ["spin.output"]), 0)).toEqual([3, 6, 9, 12, 15]);
  });

  it("times a press with a Stopwatch and Pulse", () => {
    const held = sequenceDefinition("held", "boolean", [false, true, true, true, true, false, false, true, false]);
    const { record } = setup(
      {
        patches: {
          held: { type: "held" },
          release: { type: "pulse", inputs: { on: { link: "held.value" } } },
          recording: { type: "stopwatch", inputs: { start: { link: "held.value" }, stop: { link: "release.turnedOff" }, reset: { link: "held.value" } } },
        },
      },
      [held],
    );
    const rows = record(9, ["recording.time", "recording.running", "release.turnedOff"]);
    expect(column(rows, 1)).toEqual([false, true, true, true, true, false, false, true, false]);
    expect(framesWhere(column(rows, 2), (v) => v === true)).toEqual([5, 8]);
    expect(rows[5]![0] as number).toBeCloseTo(4 / 60, 9);
    expect(rows[6]![0] as number).toBeCloseTo(4 / 60, 9);
    expect(rows[7]![0]).toBe(0);
    expect(rows[8]![0] as number).toBeCloseTo(1 / 60, 9);
  });

  it("drops a marker where a tap lands with Sample and Hold", () => {
    const { rt } = setup({
      layers: [
        { id: "canvas", type: "rectangle", name: "Canvas", props: { size: [390, 780] } },
        { id: "marker", type: "oval", name: "Marker", props: { size: [24, 24], position: { link: "landed.output" } } },
      ],
      patches: {
        touch: { type: "interaction", inputs: { layer: { layer: "canvas" } } },
        landed: { type: "sampleAndHold", typeParam: "point", inputs: { value: { link: "touch.position" }, sample: { link: "touch.tap" } } },
      },
    });
    rt.step();
    expect(rt.getValue("@marker.position")).toEqual([0, 0]);
    for (const events of sequence(tap(120, 300), idle(2), drag([200, 200], [300, 400], { frames: 4 }), idle(1))) {
      if (events.length) rt.dispatch(events);
      rt.step();
    }
    expect(rt.getValue("@marker.position")).toEqual([120, 300]);
  });

  it("keeps history across document edits and fires launch pulses again only on restart", () => {
    const { rt, update, record } = setup({
      patches: {
        launch: { type: "whenPrototypeStarts" },
        watch: { type: "pulseOnChange", inputs: { value: 5 } },
      },
    });
    expect(record(2, ["launch.started", "watch.changed"])).toEqual([
      [true, false],
      [false, false],
    ]);
    update([{ op: "updatePatch", id: "watch", typeParam: "text" }]);
    expect(record(1, ["launch.started", "watch.changed"])).toEqual([[false, false]]);
    update([{ op: "setInput", target: "watch.value", value: "6" }]);
    expect(record(2, ["launch.started", "watch.changed"])).toEqual([
      [false, true],
      [false, false],
    ]);
    rt.restart();
    expect(record(1, ["launch.started", "watch.changed"])).toEqual([[true, false]]);
  });

  it("evaluates per loop index and outputs idle values while muted", () => {
    const { rt } = setup({
      layers: [{ id: "label", type: "text", name: "Label", props: { text: { link: "picks.output" } } }],
      patches: {
        items: { type: "loop", inputs: { count: 3 } },
        picks: { type: "optionPicker", typeParam: "text", inputCount: 3, inputs: { option: { link: "items.index" }, option0: "a", option1: "b", option2: "c" } },
        match: { type: "optionEquals", muted: true, inputs: { value: 0 } },
        timer: { type: "wait", muted: true, inputs: { start: { link: "launch.started" }, duration: 0 } },
        launch: { type: "whenPrototypeStarts" },
      },
    });
    const scene = rt.step();
    const picks = rt.getRawValue("picks.output");
    expect(isLoop(picks) ? picks.items : picks).toEqual(["a", "b", "c"]);
    expect(scene.roots.map((n) => n.props.text)).toEqual(["a", "b", "c"]);
    expect([rt.getValue("match.option"), rt.getValue("match.equals")]).toEqual([-1, false]);
    expect([rt.getValue("timer.done"), rt.getValue("timer.progress"), rt.getValue("timer.finished")]).toEqual([false, 0, false]);
  });
});
