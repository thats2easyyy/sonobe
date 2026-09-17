import { applyOps, getDiagnostics, type Id, type Op, type SonobeDocument } from "@sonobe/core";
import { afterEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../../../runtime/scheduler.ts";
import { getRegistry } from "../../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../../state/session.ts";
import { BUILDING_WITH_CLAUDE, FIRST_PROTOTYPE, getLesson, LESSONS, LISTS_WITH_LOOPS, nextLesson, photoChain, SPRING_FEEL, STATES_AND_PULSES } from "./catalog.ts";
import { countLayerCopies, createLessonContext, evaluateStep, loadLessonStarter, stepTarget, type LessonContextInput } from "./runner.ts";
import type { Lesson } from "./types.ts";

const registry = getRegistry();

function apply(doc: SonobeDocument, ops: Op[]): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.code}: ${e.message}`).join("\n"));
  return result.doc;
}

type State = Omit<LessonContextInput, "fired" | "value" | "copies"> & { fired: Map<string, number>; values: Record<string, unknown>; copyCounts: Record<string, number> };

const contextOf = (s: State) => createLessonContext({ ...s, fired: new Map(s.fired), value: (a) => s.values[a], copies: (id: Id) => s.copyCounts[id] ?? 0 });

/** Walk a lesson: each step must be unfinished before its action and finished after it. */
function walk(lesson: Lesson, initial: SonobeDocument, actions: Record<string, (s: State) => void>): State {
  const state: State = { doc: initial, fired: new Map(), values: {}, copyCounts: {}, selection: {}, ui: {}, connect: {}, agentChanges: 0 };
  for (const step of lesson.steps) {
    state.fired = new Map();
    const start = contextOf(state);
    expect(evaluateStep(step, start, start).done, `${lesson.id}/${step.id} before`).toBe(false);
    expect(() => stepTarget(step, start)).not.toThrow();
    const action = actions[step.id];
    if (!action) throw new Error(`No scripted action for ${lesson.id}/${step.id}`);
    action(state);
    expect(evaluateStep(step, contextOf(state), start), `${lesson.id}/${step.id} after`).toMatchObject({ done: true });
  }
  return state;
}

let session: EditorSession | null = null;
afterEach(() => {
  session?.dispose();
  session = null;
});

describe("lesson catalog", () => {
  it("has five lessons with unique ids and steps", () => {
    expect(LESSONS.map((l) => l.number)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(5);
    for (const lesson of LESSONS) expect(new Set(lesson.steps.map((s) => s.id)).size).toBe(lesson.steps.length);
    expect(getLesson("spring-feel")).toBe(SPRING_FEEL);
    expect(nextLesson("first-prototype")).toBe(STATES_AND_PULSES);
    expect(nextLesson("building-with-claude")).toBeUndefined();
  });

  it("builds every starter prototype without errors", () => {
    for (const lesson of LESSONS) {
      if (!lesson.starter) continue;
      const doc = lesson.starter(registry);
      const errors = getDiagnostics(doc, registry).filter((d) => d.severity === "error");
      expect(errors, lesson.id).toEqual([]);
    }
  });

  it("completes Your first prototype", () => {
    const state = walk(FIRST_PROTOTYPE, FIRST_PROTOTYPE.starter!(registry), {
      touch: (s) => (s.doc = apply(s.doc, [{ op: "addPatch", patch: { id: "tap_photo", type: "interaction", inputs: { layer: { layer: "photo" } }, ui: { x: 40, y: 60 } } }])),
      switch: (s) => {
        s.doc = apply(s.doc, [{ op: "addPatch", patch: { id: "loose", type: "switch", ui: { x: 260, y: 200 } } }, { op: "connect", from: "tap_photo.tap", to: "loose.turnOn" }]);
        const ctx = contextOf(s);
        expect(evaluateStep(FIRST_PROTOTYPE.steps[1]!, ctx, ctx)).toEqual({ done: false, hint: expect.stringContaining("Flip") });
        s.doc = apply(s.doc, [{ op: "addPatch", patch: { id: "toggle", type: "switch", ui: { x: 260, y: 60 } } }, { op: "connect", from: "tap_photo.tap", to: "toggle.flip" }]);
      },
      spring: (s) => (s.doc = apply(s.doc, [{ op: "addPatch", patch: { id: "spring", type: "popAnimation", typeParam: "number", ui: { x: 480, y: 60 } } }, { op: "connect", from: "toggle.on", to: "spring.number" }])),
      drive: (s) => (s.doc = apply(s.doc, [{ op: "connect", from: "spring.output", to: "photo_scale.progress" }])),
      end: (s) => {
        s.selection = { patches: ["photo_scale"] };
        const ctx = contextOf(s);
        expect(evaluateStep(FIRST_PROTOTYPE.steps[4]!, ctx, ctx).hint).toMatch(/Try 1.2/);
        expect(stepTarget(FIRST_PROTOTYPE.steps[4]!, ctx)).toEqual({ selector: "#sb-inspector" });
        s.doc = apply(s.doc, [{ op: "setInput", target: "photo_scale.end", value: 1.2 }]);
      },
      tap: (s) => s.fired.set("tap_photo.tap", 1),
    });
    expect(photoChain(state.doc.components.main!)).toEqual({ tap: "tap_photo", toggle: "toggle", spring: "spring", scale: "photo_scale", driven: true });
  });

  it("targets the handle the learner drags from", () => {
    let doc = FIRST_PROTOTYPE.starter!(registry);
    doc = apply(doc, [{ op: "addPatch", patch: { id: "tap_photo", type: "interaction", inputs: { layer: { layer: "photo" } }, ui: { x: 40, y: 60 } } }]);
    const ctx = createLessonContext({ doc });
    expect(stepTarget(FIRST_PROTOTYPE.steps[1]!, ctx)?.selector).toBe('.sb-pe .react-flow__node[data-id="tap_photo"] .react-flow__handle[data-handleid="out:tap"]');
    expect(stepTarget(FIRST_PROTOTYPE.steps[0]!, ctx)).toEqual({ selector: '#sb-layers [data-layer-id="photo"]', closest: ".sb-tree__row" });
  });

  it("completes States vs pulses", () => {
    walk(STATES_AND_PULSES, STATES_AND_PULSES.starter!(registry), {
      touch: (s) => (s.doc = apply(s.doc, [{ op: "addPatch", patch: { id: "tap_button", type: "interaction", inputs: { layer: { layer: "button" } }, ui: { x: 40, y: 60 } } }])),
      direct: (s) => (s.doc = apply(s.doc, [{ op: "connect", from: "tap_button.tap", to: "glow.progress" }])),
      flash: (s) => s.fired.set("tap_button.tap", 1),
      switch: (s) => {
        s.doc = apply(s.doc, [{ op: "addPatch", patch: { id: "light_on", type: "switch", ui: { x: 260, y: 60 } } }, { op: "connect", from: "tap_button.tap", to: "light_on.flip" }]);
        const ctx = contextOf(s);
        expect(evaluateStep(STATES_AND_PULSES.steps[3]!, ctx, ctx).hint).toMatch(/On output/);
        s.doc = apply(s.doc, [{ op: "connect", from: "light_on.on", to: "glow.progress" }]);
      },
      stays: (s) => (s.values["light_on.on"] = true),
    });
  });

  it("completes Spring feel", () => {
    walk(SPRING_FEEL, SPRING_FEEL.starter!(registry), {
      feel: (s) => s.fired.set("tap_card.tap", 2),
      select: (s) => (s.selection = { patches: ["zoom_spring"] }),
      bounce: (s) => (s.doc = apply(s.doc, [{ op: "setInput", target: "zoom_spring.bounciness", value: 12 }])),
      snappy: (s) => {
        s.doc = apply(s.doc, [{ op: "setInput", target: "zoom_spring.speed", value: 20 }]);
        const ctx = contextOf(s);
        expect(evaluateStep(SPRING_FEEL.steps[3]!, ctx, ctx).hint).toMatch(/Bounciness down/);
        s.doc = apply(s.doc, [{ op: "setInput", target: "zoom_spring.bounciness", value: 3 }]);
      },
      compare: (s) => s.fired.set("tap_card.tap", 1),
    });
  });

  it("completes Lists with loops, and the loop really copies the row", () => {
    const state = walk(LISTS_WITH_LOOPS, LISTS_WITH_LOOPS.starter!(registry), {
      loop: (s) => (s.doc = apply(s.doc, [{ op: "addPatch", patch: { id: "rows", type: "loop", ui: { x: 60, y: 60 } } }])),
      count: (s) => (s.doc = apply(s.doc, [{ op: "setInput", target: "rows.count", value: 5 }])),
      index: (s) => (s.doc = apply(s.doc, [{ op: "connect", from: "rows.index", to: "row_spacing.value1" }])),
      copies: (s) => (s.copyCounts.row = 5),
      more: (s) => {
        s.doc = apply(s.doc, [{ op: "setInput", target: "rows.count", value: 8 }]);
        s.copyCounts.row = 8;
      },
    });
    session = createEditorSession({ host: null, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate", document: state.doc });
    session.runtime.stepFrame();
    const scene = session.runtime.stepFrame();
    expect(countLayerCopies(scene, "row")).toBe(8);
    expect(countLayerCopies(null, "row")).toBe(0);
  });

  it("completes Building with Claude", () => {
    walk(BUILDING_WITH_CLAUDE, LISTS_WITH_LOOPS.starter!(registry), {
      open: (s) => (s.connect = { open: true, openCount: 1 }),
      setup: (s) => (s.connect = { ...s.connect, copied: { setup: 100 } }),
      prompt: (s) => (s.connect = { ...s.connect, copied: { ...s.connect?.copied, prompt: 200 } }),
      activity: (s) => (s.ui = { hudTab: "ai", hudCollapsed: false }),
      change: (s) => (s.agentChanges = 1),
    });
    expect(BUILDING_WITH_CLAUDE.steps.filter((step) => step.manual).map((step) => step.id)).toEqual(["setup", "prompt", "change"]);
  });

  it("treats a check that throws as unfinished", () => {
    const ctx = createLessonContext({ doc: FIRST_PROTOTYPE.starter!(registry) });
    expect(evaluateStep({ id: "x", title: "X", body: "", check: () => { throw new Error("boom"); } }, ctx, ctx)).toEqual({ done: false, hint: null });
  });
});

describe("loadLessonStarter", () => {
  it("replaces the document with a clean starter after confirming", async () => {
    session = createEditorSession({ host: null, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
    session.document.getState().apply([{ op: "setProject", changes: { name: "Scratch" } }], { label: "Rename" });
    let asked = 0;
    const target = { registry: session.registry, document: session.document, selection: session.selection, confirmDiscardChanges: async () => (asked++, false) };
    expect(await loadLessonStarter(target, FIRST_PROTOTYPE)).toBe(false);
    expect(session.document.getState().doc.project.name).toBe("Scratch");
    target.confirmDiscardChanges = async () => (asked++, true);
    expect(await loadLessonStarter(target, FIRST_PROTOTYPE)).toBe(true);
    expect(asked).toBe(2);
    expect(session.document.getState().doc.project.name).toBe("Your First Prototype");
    expect(session.document.getState().dirty).toBe(false);
    expect(await loadLessonStarter(target, BUILDING_WITH_CLAUDE)).toBe(true);
    expect(asked).toBe(2);
  });
});
