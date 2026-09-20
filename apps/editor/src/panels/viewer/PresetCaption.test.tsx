// @vitest-environment happy-dom
import { applyOps, createEmptyDocument } from "@sonobe/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { PRESET_CAPTION_MS, PresetCaption } from "./PresetCaption.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = getRegistry();
let container: HTMLDivElement;
let root: Root;
let session: EditorSession;

const withPresets = () =>
  applyOps(
    createEmptyDocument(),
    [
      { op: "addKnobPreset", preset: { id: "proposal", name: "Proposal" } },
      { op: "addKnobPreset", preset: { id: "shipped", name: "Shipped app" } },
      { op: "addKnob", knob: { id: "gap", name: "Gap", type: "number", value: 8 } },
    ],
    { registry },
  ).doc;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  session = createEditorSession({ host: null, registry, document: withPresets(), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  act(() => root.render(<PresetCaption session={session} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  session.dispose();
  vi.useRealTimers();
});

const caption = () => container.querySelector(".sb-vw__preset-caption")?.textContent ?? null;

describe("PresetCaption", () => {
  it("names the preset that starts running, from any change, for a moment", () => {
    expect(caption()).toBeNull();
    act(() => void session.document.getState().apply([{ op: "applyKnobPreset", id: "shipped" }], { label: "Switch Presets" }));
    expect(caption()).toBe("Shipped app");
    act(() => vi.advanceTimersByTime(PRESET_CAPTION_MS - 100));
    act(() => void session.document.getState().undo());
    expect(caption()).toBe("Proposal");
    act(() => vi.advanceTimersByTime(PRESET_CAPTION_MS));
    expect(caption()).toBeNull();
    // A tune isn't a switch, and neither is opening another prototype.
    act(() => void session.document.getState().apply([{ op: "setKnobValue", id: "gap", value: 10 }], { label: "Tune" }));
    act(() => session.document.getState().replaceDocument({ ...withPresets(), knobs: { ...withPresets().knobs!, active: "shipped" } }));
    expect(caption()).toBeNull();
  });
});
