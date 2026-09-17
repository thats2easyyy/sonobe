import { describe, expect, it } from "vitest";
import type { InputEvent } from "@sonobe/engine";
import { loopOf } from "../infra/index.ts";
import { keyboard, parseKeyCombination } from "./keyboard.ts";
import { createInteractionRig } from "./testing.ts";

const down = (key: string): InputEvent => ({ kind: "key", phase: "down", key });
const up = (key: string): InputEvent => ({ kind: "key", phase: "up", key });

describe("parseKeyCombination", () => {
  it("normalizes names, characters, and combinations", () => {
    expect(parseKeyCombination("Space")).toEqual(["Space"]);
    expect(parseKeyCombination(" ")).toEqual(["Space"]);
    expect(parseKeyCombination("A")).toEqual(["a"]);
    expect(parseKeyCombination("shift + up")).toEqual(["Shift", "ArrowUp"]);
    expect(parseKeyCombination("Command+K")).toEqual(["Meta", "k"]);
    expect(parseKeyCombination("option+esc")).toEqual(["Alt", "Escape"]);
    expect(parseKeyCombination("delete")).toEqual(["Backspace"]);
    expect(parseKeyCombination("f5")).toEqual(["F5"]);
    expect(parseKeyCombination("MediaPlayPause")).toEqual(["MediaPlayPause"]);
  });

  it("watches the plus key and treats blank text as nothing", () => {
    expect(parseKeyCombination("+")).toEqual(["+"]);
    expect(parseKeyCombination("Shift++")).toEqual(["Shift", "+"]);
    expect(parseKeyCombination("")).toEqual([]);
    expect(parseKeyCombination("   ")).toEqual([]);
  });
});

describe("keyboard", () => {
  it("is true while the default Space key is held", () => {
    const r = createInteractionRig(keyboard);
    expect(r.step().outputs.down).toBe(false);
    expect(r.step({ events: [down(" ")] }).outputs.down).toBe(true);
    expect(r.step().outputs.down).toBe(true);
    expect(r.step({ events: [up(" ")] }).outputs.down).toBe(false);
  });

  it("needs every key in a combination, ignoring other held keys", () => {
    const r = createInteractionRig(keyboard, { inputs: { key: "Shift+Up" } });
    r.step();
    expect(r.step({ events: [down("ArrowUp")] }).outputs.down).toBe(false);
    expect(r.step({ events: [down("Shift"), down("x")] }).outputs.down).toBe(true);
    expect(r.step({ events: [up("Shift")] }).outputs.down).toBe(false);
  });

  it("matches characters case-insensitively", () => {
    const r = createInteractionRig(keyboard, { inputs: { key: "A" } });
    r.step();
    expect(r.step({ events: [down("a")] }).outputs.down).toBe(true);
  });

  it("is false for blank or unknown keys and while disabled", () => {
    const blank = createInteractionRig(keyboard, { inputs: { key: "" } });
    expect(blank.step({ events: [down(" ")] }).outputs.down).toBe(false);
    const unknown = createInteractionRig(keyboard, { inputs: { key: "Hyper" } });
    expect(unknown.step({ events: [down("a")] }).outputs.down).toBe(false);
    const disabled = createInteractionRig(keyboard, { inputs: { key: "a", enabled: false } });
    expect(disabled.step({ events: [down("a")] }).outputs.down).toBe(false);
  });

  it("evaluates a looped Key per index", () => {
    const r = createInteractionRig(keyboard, { inputs: { key: loopOf(["1", "2", "3"]) } });
    r.step();
    expect(r.step({ events: [down("2")] }).outputs.down).toEqual(loopOf([false, true, false]));
  });
});
