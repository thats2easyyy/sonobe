import { buildDoc, createMockRegistry, createTestRuntime, runFrames, sequence, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { definitions } from "./index.ts";

describe("device patches in a runtime document", () => {
  it("rotating the device swaps Device Info's screen size into a layer, turns the interface, and a tap buzzes", () => {
    const registry = createMockRegistry(definitions);
    const doc = buildDoc(
      {
        device: "iphone-17-pro",
        layers: [
          { id: "screen", type: "rectangle", name: "Screen", props: { size: { link: "info.screenSize" } } },
          { id: "card", type: "rectangle", name: "Card", props: { position: [20, 120], size: [200, 120] } },
        ],
        patches: {
          info: { type: "deviceInfo" },
          orient: { type: "interfaceOrientation" },
          orient_b: { type: "interfaceOrientation" },
          motion: { type: "deviceMotion" },
          touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
          buzz: { type: "vibrate", inputs: { vibrate: { link: "touch.tap" }, duration: 0.2 } },
        },
      },
      registry,
    );
    const vibrations: (number | number[])[] = [];
    const rt = createTestRuntime(doc, registry, { platform: { vibrate: (p) => vibrations.push(p) } });

    const [first] = runFrames(rt, 1);
    const screen = () => rt.scene().roots.find((n) => n.layerId === "screen")!;
    expect(first!.roots.find((n) => n.layerId === "screen")!.width).toBe(402);
    expect(rt.getValue("info.deviceName")).toBe("iPhone 17 Pro");
    expect(rt.getValue("orient.orientation")).toBe("portrait");
    expect(rt.getValue("motion.available")).toBe(false);

    rt.dispatch([{ kind: "orientation", orientation: "landscape" }]);
    rt.step();
    expect(rt.getValue("info.screenSize")).toEqual([874, 402]);
    expect(rt.getValue("info.safeArea")).toEqual([0, 34, 0, 62]);
    expect(rt.getValue("info.landscape")).toBe(true);
    expect(rt.getValue("info.orientation")).toBe(90);
    expect(rt.getValue("orient.orientation")).toBe("landscapeLeft");
    expect(screen().width).toBe(874);
    expect(screen().height).toBe(402);

    rt.dispatch([{ kind: "deviceMotion", acceleration: [0, -1, 0], rotationRate: [0, 0, 12] }]);
    rt.step();
    expect(rt.getValue("motion.available")).toBe(true);
    expect(rt.getValue("motion.tilt")).toEqual([90, 0, 0]);
    expect(rt.getValue("motion.rotationRate")).toEqual([0, 0, 12]);

    runFrames(rt, 3, sequence(tap(60, 160)));
    expect(vibrations).toEqual([200]);

    // Only the first Interface Orientation by id drives the viewer; the other warns once.
    expect(rt.issues().filter((i) => i.patchId === "orient_b" && i.severity === "warning")).toHaveLength(1);
    expect(rt.issues().filter((i) => i.patchId === "orient")).toHaveLength(0);
  });

  it("traces Device Time deterministically in UTC", () => {
    const registry = createMockRegistry(definitions);
    const doc = buildDoc({ patches: { clock: { type: "deviceTime" } } }, registry);
    const rt = createTestRuntime(doc, registry, { fps: 60 });
    const trace = rt.trace(["clock.timeOfDay", "clock.milliseconds"], 1000);
    expect(trace.values["clock.timeOfDay"]![0]).toBe(0);
    expect(trace.values["clock.timeOfDay"]!.at(-1)).toBeCloseTo(1, 2);
    expect(trace.values["clock.milliseconds"]![30]).toBe(500);
  });
});
