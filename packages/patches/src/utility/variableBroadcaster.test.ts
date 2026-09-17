import type { SonobeDocument } from "@sonobe/core";
import { buildDoc, createMockRegistry, createTestRuntime, type DocInput } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { definitions } from "./index.ts";
import { variableBroadcaster } from "./variableBroadcaster.ts";

const registry = createMockRegistry(definitions);
const run = (input: DocInput) => {
  const doc: SonobeDocument = buildDoc(input, registry);
  const rt = createTestRuntime(doc, registry);
  rt.step();
  return rt;
};

describe("variableBroadcaster", () => {
  it("declares name and scope settings", () => {
    expect(variableBroadcaster.settings?.map((s) => [s.key, s.default])).toEqual([
      ["name", ""],
      ["scope", "local"],
    ]);
  });

  it("computes nothing on its own", () => {
    const h = createPatchHarness(variableBroadcaster, { inputs: { value: 5 }, settings: { name: "Header Height" } });
    const frame = h.step();
    expect(frame.outputs).toEqual({});
    expect(h.logs).toEqual([]);
  });

  it("shares a wired value with receivers on the same frame", () => {
    const rt = run({
      patches: {
        press_progress: { type: "splitter", inputs: { value: 0.75 } },
        share: { type: "variableBroadcaster", settings: { name: "Press Progress" }, inputs: { value: { link: "press_progress.output" } } },
        progress_here: { type: "variableReceiver", settings: { name: "Press Progress" } },
      },
    });
    expect(rt.frame).toBe(0);
    expect(rt.getValue("progress_here.output")).toBe(0.75);
    expect(rt.issues()).toEqual([]);
  });

  it("shares a typed constant when Value isn't connected", () => {
    const rt = run({
      patches: {
        header_height: { type: "variableBroadcaster", typeParam: "point", settings: { name: "Header Offset" }, inputs: { value: [0, 96] } },
        offset: { type: "variableReceiver", typeParam: "point", settings: { name: "Header Offset" } },
        parts: { type: "pointUnpack", inputs: { value: { link: "offset.output" } } },
      },
    });
    expect(rt.getValue("parts.y")).toBe(96);
  });

  it("sends whole loops", () => {
    const rt = run({
      patches: {
        widths: { type: "splitter", inputs: { value: { loop: [100, 200, 300] } } },
        share: { type: "variableBroadcaster", settings: { name: "widths" }, inputs: { value: { link: "widths.output" } } },
        r: { type: "variableReceiver", settings: { name: "widths" } },
      },
    });
    expect(rt.getRawValue("r.output")).toEqual(loopOf([100, 200, 300]));
  });

  it("gives receivers the zero value while muted", () => {
    const rt = run({
      patches: {
        share: { type: "variableBroadcaster", muted: true, settings: { name: "Dark Mode" }, typeParam: "boolean", inputs: { value: true } },
        dark: { type: "variableReceiver", typeParam: "boolean", settings: { name: "Dark Mode" } },
      },
    });
    expect(rt.getValue("dark.output")).toBe(false);
  });
});
