import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { saveProjectToDisk } from "@sonobe/core/node";
import { createPatchRegistry } from "@sonobe/patches";
import { afterAll, describe, expect, it } from "vitest";
import type { Scenario } from "../../examples/lib/scenarios.ts";
import type { EvalCase } from "./cases.ts";
import {
  checkAnswer,
  checkDocument,
  checkProject,
  failureLines,
  suffixedRebuilds,
} from "./checks.ts";

const registry = createPatchRegistry();
const temps: string[] = [];

afterAll(async () => {
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

function build(
  ops: Op[],
  doc: SonobeDocument = createEmptyDocument({ name: "Test" }),
): SonobeDocument {
  const r = applyOps(doc, ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
  return r.doc;
}

const box: Op = {
  op: "addLayer",
  layer: {
    id: "box",
    type: "rectangle",
    name: "Box",
    props: { position: [100, 100], size: [100, 100] },
  },
};
const grow: Op[] = [
  {
    op: "addPatch",
    patch: {
      id: "tap_box",
      type: "interaction",
      name: "Tap Box",
      inputs: { layer: { layer: "box" } },
    },
  },
  {
    op: "addPatch",
    patch: {
      id: "grown",
      type: "switch",
      name: "Grown",
      inputs: { flip: { link: "tap_box.tap" } },
    },
  },
  {
    op: "addPatch",
    patch: {
      id: "grow_scale",
      type: "transition",
      typeParam: "number",
      name: "Grow Scale",
      inputs: { progress: { link: "grown.on" }, start: 1, end: 2 },
    },
  },
  { op: "connect", from: "grow_scale.output", to: "@box.scale" },
];

function evalCase(overrides: Partial<EvalCase>): EvalCase {
  return {
    id: "t",
    dir: "",
    title: "T",
    tags: [],
    prompt: "p",
    start: { kind: "project", dir: "", ops: [] },
    checks: [],
    allowErrorDiagnostics: false,
    budget: {},
    hideExamples: false,
    ...overrides,
  };
}

const tapScenario = (value: number): Scenario => ({
  name: "Tapping grows the box",
  events: [{ kind: "tap", target: "@box", atMs: 50 }],
  durationMs: 300,
  expect: [
    { description: `The box ends at ${value}×`, target: "@box.scale", at: "end", op: "==", value },
  ],
});

async function save(doc: SonobeDocument): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sonobe-eval-checks-"));
  temps.push(dir);
  await saveProjectToDisk(dir, doc);
  return dir;
}

describe("checkProject", () => {
  const start = build([box]);
  const finished = build(grow, start);

  it("passes when every scenario, check and answer passes", async () => {
    const c = evalCase({
      test: { description: "d", scenarios: [tapScenario(2)] },
      answer: { mentions: [["grow", "bigger"]] },
    });
    const report = await checkProject(c, await save(finished), {
      registry,
      startDoc: start,
      answer: "Tap it and it grows.",
    });
    expect(failureLines(report)).toEqual([]);
    expect(report.pass).toBe(true);
    // Scenario expectation + the implicit no-errors check + the answer.
    expect(report.score).toEqual({ passed: 3, total: 3 });
  });

  it("fails with the numbers when an expectation misses", async () => {
    const report = await checkProject(
      evalCase({ test: { description: "d", scenarios: [tapScenario(3)] } }),
      await save(finished),
      { registry, startDoc: start },
    );
    expect(report.pass).toBe(false);
    expect(failureLines(report)).toEqual([
      "Tapping grows the box › The box ends at 3×: @box.scale at end is 2 (wanted == 3 ± 0.001)",
    ]);
  });

  it("turns a scenario that can't run into failed expectations instead of throwing", async () => {
    const gone: Scenario = {
      ...tapScenario(2),
      events: [{ kind: "tap", target: "@missing" }],
      expect: [{ description: "x", target: "@missing.scale", op: "==", value: 1 }],
    };
    const report = await checkProject(
      evalCase({ test: { description: "d", scenarios: [gone] } }),
      await save(finished),
      { registry, startDoc: start },
    );
    expect(report.pass).toBe(false);
    expect(report.scenarios[0]!.results[0]!.detail).toMatch(/couldn't run: .*missing/);
  });

  it("skips the answer when checking a project by hand", async () => {
    const c = evalCase({
      checks: [{ kind: "unchanged", description: "Nothing changed" }],
      answer: { mentions: [["tap"]] },
    });
    const report = await checkProject(c, await save(start), {
      registry,
      startDoc: start,
      checkAnswer: false,
    });
    expect(report.answer).toEqual([]);
    expect(report.pass).toBe(true);
  });

  it("reports a folder that isn't a project", async () => {
    const report = await checkProject(
      evalCase({ checks: [{ kind: "unchanged", description: "x" }] }),
      path.join(tmpdir(), "sonobe-no-such-project"),
      { registry, startDoc: start },
    );
    expect(report.pass).toBe(false);
    expect(report.error).toMatch(/doesn't open/);
  });
});

describe("checkDocument", () => {
  const start = build([box]);

  it("unchanged: lists the files that changed", () => {
    expect(checkDocument({ kind: "unchanged", description: "Same" }, start, start)).toMatchObject({
      pass: true,
    });
    const changed = checkDocument(
      { kind: "unchanged", description: "Same" },
      build(grow, start),
      start,
    );
    expect(changed).toMatchObject({ pass: false, detail: "Changed: components/main.json" });
  });

  it("interface: stale ports and the exact output names", () => {
    const withPorts = build([
      { op: "addComponent", component: { id: "card", name: "Card", kind: "patchComponent" } },
      {
        op: "updateInterface",
        component: "card",
        outputs: {
          swipedLeft: { name: "Swiped Left", type: "pulse" },
          flipped: { name: "Flipped", type: "boolean" },
        },
      },
    ]);
    const check = {
      kind: "interface" as const,
      description: "One output",
      component: "card",
      without: ["swipedLeft"],
      outputs: ["flipped"],
    };
    const stale = checkDocument(check, withPorts, withPorts);
    expect(stale.pass).toBe(false);
    expect(stale.detail).toBe(
      'card still has "swipedLeft"; outputs are "flipped", "swiped left" (wanted "flipped")',
    );
    const clean = build(
      [{ op: "updateInterface", component: "card", outputs: { swipedLeft: null } }],
      withPorts,
    );
    expect(checkDocument(check, clean, withPorts).pass).toBe(true);
    expect(checkDocument({ ...check, component: "nope" }, clean, withPorts).detail).toMatch(
      /no component "nope"/,
    );
  });

  it("presets: names ignore case, locked is checked when given", () => {
    const knobs = build([
      { op: "addKnob", knob: { id: "size", name: "Size", type: "number", value: 1 } },
      { op: "addKnobPreset", preset: { id: "shipped", name: "Shipped app", locked: true } },
    ]);
    expect(
      checkDocument(
        { kind: "presets", description: "p", presets: [{ name: "shipped APP", locked: true }] },
        knobs,
        knobs,
      ).pass,
    ).toBe(true);
    const missing = checkDocument(
      {
        kind: "presets",
        description: "p",
        presets: [{ name: "Proposal" }, { name: "Shipped app", locked: false }],
      },
      knobs,
      knobs,
    );
    expect(missing.pass).toBe(false);
    expect(missing.detail).toContain('no preset "Proposal"; "Shipped app" is locked');
  });
});

describe("suffixedRebuilds", () => {
  it("finds a removed id that came back with a number", () => {
    const start = build([box, ...grow]).components.main!;
    const rebuilt = build(
      [
        { op: "removePatch", id: "grown" },
        { op: "addPatch", patch: { id: "grown_2", type: "switch", name: "Grown" } },
      ],
      build([box, ...grow]),
    ).components.main!;
    expect(suffixedRebuilds(start, rebuilt)).toEqual(["grown_2 (rebuilt grown)"]);
  });

  it("leaves alone a second item next to the first, and new ids that only end in a number", () => {
    const start = build([box, ...grow]).components.main!;
    const more = build(
      [
        { op: "addPatch", patch: { id: "grown_2", type: "switch", name: "Grown" } },
        { op: "addPatch", patch: { id: "step_2", type: "switch", name: "Step 2" } },
      ],
      build([box, ...grow]),
    ).components.main!;
    expect(suffixedRebuilds(start, more)).toEqual([]);
  });
});

describe("checkAnswer", () => {
  it("needs one word from every group", () => {
    const results = checkAnswer(
      { mentions: [["tap"], ["grow", "bigger"]] },
      "Tap it and it gets BIGGER.",
    );
    expect(results.map((r) => [r.description, r.pass, r.detail])).toEqual([
      ['The reply mentions "tap"', true, 'Mentions "tap"'],
      ['The reply mentions one of "grow", "bigger"', true, 'Mentions "bigger"'],
    ]);
    expect(checkAnswer({ mentions: [["tap"]] }, undefined)[0]).toMatchObject({
      pass: false,
      detail: "There was no reply",
    });
  });
});
