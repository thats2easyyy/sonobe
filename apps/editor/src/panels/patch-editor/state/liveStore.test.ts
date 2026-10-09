// @vitest-environment happy-dom
import type { InputEvent } from "@sonobe/engine";
import { buildDoc, createMockRegistry } from "@sonobe/engine/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeHost, type RuntimeHost } from "../../../runtime/runtimeHost.ts";
import { createManualScheduler } from "../../../runtime/scheduler.ts";
import { createDocumentStore } from "../../../state/document.ts";
import { createLiveStore, followEveryFrame, type LiveStore } from "./liveStore.ts";

const registry = createMockRegistry();
const hosts: RuntimeHost[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
});

function setup() {
  const scheduler = createManualScheduler();
  const document = buildDoc({ layers: [{ id: "card", type: "rectangle", props: { position: [0, 0], size: [200, 200] } }], patches: { tap: { type: "interaction", inputs: { layer: { layer: "card" } } } } }, registry);
  const host = createRuntimeHost({ registry, document: createDocumentStore({ registry, document }), scheduler, textMeasurer: "approximate" });
  hosts.push(host);
  scheduler.frames(3);
  return { scheduler, host };
}

/** Every value `address` takes in the store from here on. */
function changes(live: LiveStore, address: string): unknown[] {
  const seen: unknown[] = [];
  live.subscribe(address, () => seen.push(live.get(address)));
  return seen;
}

const pointer = (phase: "move" | "down" | "up"): InputEvent => ({ kind: "pointer", phase, pointerId: 1, x: 50, y: 50 });

describe("createLiveStore", () => {
  it("tells an address's listeners when its value changes, and not when it's set to the same value", () => {
    const live = createLiveStore();
    const seen = changes(live, "a.on");
    const other = changes(live, "b.on");
    live.setValues({ "a.on": true, "b.on": [1, 2] });
    live.setValues({ "a.on": true, "b.on": [1, 2] });
    live.setValues({ "a.on": false });
    expect(seen).toEqual([true, false]);
    expect(other).toEqual([[1, 2]]);
  });
});

describe("followEveryFrame", () => {
  /** The pointer moves onto the layer, then presses and lets go a frame later, as a tap on a trackpad does. */
  function quickTap(scheduler: ReturnType<typeof setup>["scheduler"], host: RuntimeHost) {
    host.runtime.dispatch([pointer("move")]);
    scheduler.frame();
    host.runtime.dispatch([pointer("down")]);
    scheduler.frame();
    host.runtime.dispatch([pointer("up")]);
    scheduler.frames(8);
  }

  it("the 20 Hz subscription alone misses a boolean that is on for one frame", () => {
    const { scheduler, host } = setup();
    const live = createLiveStore();
    host.subscribeValues(["tap.down"], (values) => live.setValues(values), { hz: 20 });
    const seen = changes(live, "tap.down");
    const frames: unknown[] = [];
    host.subscribeFrame(() => frames.push(host.readValue("tap.down")));
    quickTap(scheduler, host);
    expect(frames.filter((down) => down === true)).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it("reads the address on every frame, so the store's listeners hear it turn on and off", () => {
    const { scheduler, host } = setup();
    const live = createLiveStore();
    host.subscribeValues(["tap.down"], (values) => live.setValues(values), { hz: 20 });
    host.subscribeFrame(followEveryFrame(live, [["tap.down", "tap.down"]], (address) => host.readValue(address)));
    const seen = changes(live, "tap.down");
    quickTap(scheduler, host);
    expect(seen).toEqual([true, false]);
  });

  it("stores a value under the address it has here, read from the address the runtime knows", () => {
    const live = createLiveStore();
    const values: Record<string, unknown> = { "card_1/tap.down": true };
    const frame = followEveryFrame(live, [["tap.down", "card_1/tap.down"]], (source) => values[source]);
    frame();
    expect(live.get("tap.down")).toBe(true);
    const seen = changes(live, "tap.down");
    frame();
    expect(seen).toEqual([]);
    values["card_1/tap.down"] = false;
    frame();
    expect(seen).toEqual([false]);
  });
});
