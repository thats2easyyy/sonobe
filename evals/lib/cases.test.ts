import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyOps, createEmptyDocument, findLayer } from "@sonobe/core";
import { saveProjectToDisk } from "@sonobe/core/node";
import { createPatchRegistry } from "@sonobe/patches";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildStartDocument,
  CASES_DIR,
  exampleLayersDocument,
  exampleSolutionOps,
  layerExpectationsOnly,
  loadCase,
  renderPrompt,
  selectCaseIds,
  targetLayer,
} from "./cases.ts";

const registry = createPatchRegistry();
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sonobe-eval-cases-"));
  const r = applyOps(
    createEmptyDocument({ name: "Box" }),
    [{ op: "addLayer", layer: { id: "box", type: "rectangle", name: "Box", props: {} } }],
    { registry },
  );
  if (!r.ok) throw new Error("setup failed");
  await saveProjectToDisk(path.join(root, "project"), r.doc);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const TEST = {
  description: "The box grows.",
  scenarios: [
    {
      name: "Tap",
      events: [{ kind: "tap", target: "@box" }],
      durationMs: 500,
      expect: [{ description: "It grows", target: "@box.scale", op: ">", value: 1 }],
    },
  ],
};

/** Write a case folder under the temp root; `files` maps file names to contents (objects become JSON). */
function writeCase(id: string, files: Record<string, unknown>): string {
  const dir = path.join(root, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files))
    writeFileSync(
      path.join(dir, name),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  return dir;
}

const startProject = { project: "../project" };

describe("loadCase", () => {
  it("loads a case with a start project, a prompt and a test", async () => {
    const dir = writeCase("good", {
      "case.json": { title: "Grow", tags: ["tap"], start: startProject, budget: { maxTurns: 12 } },
      "prompt.md": "Make the box grow.\n",
      "test.json": TEST,
    });
    const c = loadCase(dir);
    expect(c).toMatchObject({
      id: "good",
      title: "Grow",
      tags: ["tap"],
      prompt: "Make the box grow.",
      budget: { maxTurns: 12 },
      hideExamples: false,
      allowErrorDiagnostics: false,
    });
    expect(c.start).toMatchObject({ kind: "project", ops: [] });
    expect(c.test?.scenarios.map((s) => s.name)).toEqual(["Tap"]);
    expect(c.solution).toBeUndefined();
  });

  it("names the first problem", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [
        {
          "case.json": { title: "X", start: startProject, colour: 1 },
          "prompt.md": "Hi",
          "test.json": TEST,
        },
        /unknown field "colour"/,
      ],
      [{ "case.json": { title: "X", start: startProject }, "test.json": TEST }, /no prompt\.md/],
      [{ "case.json": { title: "X", start: startProject }, "prompt.md": "Hi" }, /checks nothing/],
      [
        {
          "case.json": { title: "X", start: { project: "nowhere" } },
          "prompt.md": "Hi",
          "test.json": TEST,
        },
        /isn't a project folder/,
      ],
      [
        {
          "case.json": { title: "X", start: { example: "99-nope" } },
          "prompt.md": "Hi",
          "test.json": TEST,
        },
        /isn't a folder in examples/,
      ],
      [
        {
          "case.json": { title: "X", start: startProject },
          "prompt.md": "Open {{url}}",
          "test.json": TEST,
        },
        /serve names no file/,
      ],
      [
        {
          "case.json": { title: "X", start: startProject, serve: "page.html" },
          "page.html": "<p>",
          "prompt.md": "Hi",
          "test.json": TEST,
        },
        /\{\{url\}\}/,
      ],
      [
        {
          "case.json": { title: "X", start: startProject, checks: [{ kind: "vibes" }] },
          "prompt.md": "Hi",
        },
        /checks\[0\]\.kind/,
      ],
      [
        {
          "case.json": { title: "X", start: startProject, budget: { maxTurns: 0 } },
          "prompt.md": "Hi",
          "test.json": TEST,
        },
        /budget\.maxTurns/,
      ],
    ];
    for (const [i, [files, message]] of cases.entries())
      expect(() => loadCase(writeCase(`bad-${i}`, files))).toThrow(message);
  });

  it("refuses expectations on patch ports, so Claude's own ids never matter", async () => {
    const test = {
      ...TEST,
      scenarios: [
        {
          ...TEST.scenarios[0]!,
          expect: [{ description: "On", target: "grown.on", op: "==", value: true }],
        },
      ],
    };
    const dir = writeCase("patch-target", {
      "case.json": { title: "X", start: startProject },
      "prompt.md": "Hi",
      "test.json": test,
    });
    expect(() => loadCase(dir)).toThrow(/layer properties only/);
  });

  it("takes an example's layer expectations and hides the examples from Claude", () => {
    const c = loadCase(path.join(CASES_DIR, "example-01-tap-to-grow"));
    const targets = c.test!.scenarios.flatMap((s) => s.expect.map((e) => e.target));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => t.startsWith("@"))).toBe(true);
    expect(c.hideExamples).toBe(true);
    expect(c.start).toEqual({
      kind: "example",
      example: "01-tap-to-grow",
      patches: false,
      ops: [],
    });
  });

  it("lets a case show the examples", async () => {
    const dir = writeCase("examples-on", {
      "case.json": { title: "X", start: { example: "01-tap-to-grow" }, examples: true },
      "prompt.md": "Hi",
      "test.json": TEST,
    });
    expect(loadCase(dir).hideExamples).toBe(false);
  });
});

describe("layerExpectationsOnly", () => {
  it("drops patch-port expectations and the scenarios left empty", () => {
    const out = layerExpectationsOnly({
      description: "d",
      scenarios: [
        {
          name: "a",
          events: [],
          durationMs: 100,
          expect: [
            { description: "x", target: "tap.down", op: "==", value: true },
            { description: "y", target: "@card.scale", op: "==", value: 1 },
          ],
        },
        {
          name: "b",
          events: [],
          durationMs: 100,
          expect: [{ description: "z", target: "spring.output", op: ">", value: 0 }],
        },
      ],
    });
    expect(out.scenarios.map((s) => [s.name, s.expect.map((e) => e.target)])).toEqual([
      ["a", ["@card.scale"]],
    ]);
  });
});

describe("selectCaseIds", () => {
  const ids = ["example-01-tap-to-grow", "example-02-like-toggle", "retro-knob-presets"];

  it("picks exact ids and prefixes, in listing order", () => {
    expect(selectCaseIds(ids, [])).toEqual(ids);
    expect(selectCaseIds(ids, ["retro-knob-presets", "example-*"])).toEqual(ids);
    expect(selectCaseIds(ids, ["example-02-like-toggle"])).toEqual(["example-02-like-toggle"]);
  });

  it("suggests close ids when a filter matches nothing", () => {
    expect(() => selectCaseIds(ids, ["knob"])).toThrow(/Did you mean retro-knob-presets/);
  });
});

describe("start documents", () => {
  it("builds an example's layers without its patches, notes or example link", () => {
    const doc = exampleLayersDocument("01-tap-to-grow", registry);
    const main = doc.components[doc.project.root]!;
    expect(Object.keys(main.patches)).toEqual([]);
    expect(findLayer(main.layers, "card")).toBeDefined();
    expect(main.notes).toBeUndefined();
    expect(doc.project.meta).toBeUndefined();
    expect(exampleSolutionOps("01-tap-to-grow").some((op) => op.op === "addLayer")).toBe(false);
  });

  it("applies a case's start ops", async () => {
    const c = loadCase(path.join(CASES_DIR, "study-debug-flick"));
    const doc = await buildStartDocument(c, registry);
    const spring = doc.components[doc.project.root]!.patches.sheet_spring!;
    expect(spring.inputs.gestureVelocity).toBeUndefined();
  });
});

describe("small helpers", () => {
  it("reads the layer a target names", () => {
    expect(targetLayer("@card.scale")).toBe("card");
    expect(targetLayer("@card#2/badge.opacity")).toBe("card");
    expect(targetLayer("spring.output")).toBeUndefined();
  });

  it("fills the served file's address into the prompt", () => {
    const c = { prompt: "Import {{url}} and check {{url}}." } as Parameters<typeof renderPrompt>[0];
    expect(renderPrompt(c, { url: "http://127.0.0.1:5/a.html" })).toBe(
      "Import http://127.0.0.1:5/a.html and check http://127.0.0.1:5/a.html.",
    );
  });
});
