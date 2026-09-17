import { applyOps } from "@sonobe/core";
import type { Op, SonobeDocument } from "@sonobe/core";
import { DETERMINISTIC_EPOCH_MS, isLoop, makeLoop, type PatchDefinition, type PlatformServices, type SonobeRuntime } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, runPatch, sequenceDefinition, type RunPatchOptions } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { javascript } from "./javascript.ts";
import { LIVE_BUDGET_MS } from "./sandbox/realm.ts";

const FILE = "test.js";

function scriptDoc(source: string): SonobeDocument {
  const doc = buildDoc({}, createMockRegistry([javascript]));
  return { ...doc, scripts: { [FILE]: source } };
}

function run(source: string, frames: Record<string, unknown>[], options: RunPatchOptions = {}) {
  return runPatch(javascript, frames, { id: "js", settings: { script: FILE }, doc: scriptDoc(source), ...options });
}

const column = (result: ReturnType<typeof run>, key: string) => result.frames.map((f) => f.outputs[key]);
const messages = (result: ReturnType<typeof run>, level?: string) => result.logs.filter((l) => !level || l.level === level).map((l) => l.args.join(" "));
/** Script errors, which the patch raises as `script_error` runtime issues. */
const scriptErrors = (result: ReturnType<typeof run>) => result.issues.filter((i) => i.code === "script_error").map((i) => i.message);
const items = (value: unknown) => (isLoop(value) ? value.items : value);

/** A runtime document with a javascript patch "js" running `source`, plus extra patches and connections. */
function runtimeDoc(source: string, options: { patches?: Record<string, { type: string; inputs?: Record<string, unknown> }>; ops?: Op[]; definitions?: PatchDefinition[] } = {}): SonobeDocument {
  const registry = createMockRegistry([javascript, ...(options.definitions ?? [])]);
  const doc = buildDoc({ patches: options.patches as never }, registry);
  const result = applyOps(doc, [{ op: "setScript", file: FILE, source }, { op: "addPatch", patch: { id: "js", type: "javascript", settings: { script: FILE } } }, ...(options.ops ?? [])], { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.doc;
}

/** Step after letting host promises (platform stubs) settle, as hosts must between steps. */
async function stepSettled(rt: SonobeRuntime, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    rt.step();
  }
}

describe("javascript: ports and evaluation", () => {
  it("evaluates on the first frame and when inputs change, holding outputs in between", () => {
    const r = run(
      `export const inputs = [{ key: "count", type: "number", default: 2 }];
export const outputs = [{ key: "label", type: "text", default: "none" }, { key: "runs", type: "number" }];
let runs = 0;
export function evaluate(patch) {
  runs++;
  patch.output("label", \`\${patch.input("count")} items\`);
  patch.output("runs", runs);
}`,
      [{}, {}, { count: 5 }, { count: 5 }],
    );
    expect(column(r, "label")).toEqual(["2 items", "2 items", "5 items", "5 items"]);
    expect(column(r, "runs")).toEqual([1, 1, 2, 2]);
    expect(r.issues).toEqual([]);
  });

  it("shows declared output defaults, or zero values, before the first write", () => {
    const r = run(`export const outputs = [{ key: "status", type: "text", default: "idle" }, { key: "tint", type: "color" }, { key: "list", type: "number", wholeLoop: true }];`, [{}]);
    expect(r.frames[0]!.outputs.status).toBe("idle");
    expect(r.frames[0]!.outputs.tint).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(items(r.frames[0]!.outputs.list)).toEqual([]);
  });

  it("reads pulses once per frame and fires one-frame pulse outputs; consecutive pulses each count", () => {
    const r = run(
      `export const inputs = [{ key: "tap", type: "pulse" }];
export const outputs = [{ key: "count", type: "number" }, { key: "tapped", type: "pulse" }];
let count = 0;
export function evaluate(patch) {
  if (patch.pulsed("tap")) { count++; patch.pulse("tapped"); patch.pulse("tapped"); }
  patch.output("count", count);
}`,
      [{ tap: true }, { tap: true }, {}, { tap: true }],
    );
    expect(column(r, "count")).toEqual([1, 2, 2, 3]);
    expect(r.frames.map((f) => f.pulses)).toEqual([["tapped"], ["tapped"], [], ["tapped"]]);
  });

  it("reports changed() against last frame, false on the first frame", () => {
    const r = run(
      `export const inputs = [{ key: "value", type: "number" }];
export const outputs = [{ key: "changed", type: "boolean" }, { key: "connected", type: "boolean" }];
export const alwaysEvaluate = true;
export function evaluate(patch) { patch.output("changed", patch.changed("value")); patch.output("connected", patch.isConnected("value")); }`,
      [{ value: 1 }, { value: 1 }, { value: 2 }, { value: 2 }],
    );
    expect(column(r, "changed")).toEqual([false, false, true, false]);
    expect(column(r, "connected")).toEqual([true, true, true, true]);
  });

  it("keeps evaluating while the script requests frames", () => {
    const r = run(
      `export const outputs = [{ key: "frames", type: "number" }];
let n = 0;
export function evaluate(patch) { n++; patch.output("frames", n); if (n < 3) patch.requestNextFrame(); }`,
      [{}, {}, {}, {}, {}],
    );
    expect(column(r, "frames")).toEqual([1, 2, 3, 3, 3]);
    expect(r.frames.map((f) => f.requestedNextFrame)).toEqual([true, true, false, false, false]);
  });

  it("gives each loop index its own module scope", () => {
    const r = run(
      `export const inputs = [{ key: "step", type: "number" }];
export const outputs = [{ key: "total", type: "number" }, { key: "index", type: "number" }];
export const alwaysEvaluate = true;
let total = 0;
export function evaluate(patch) { total += patch.input("step"); patch.output("total", total); patch.output("index", patch.loopIndex); }`,
      [{ step: makeLoop([1, 10]) }, { step: makeLoop([1, 10]) }, { step: makeLoop([1, 10, 100]) }],
    );
    expect(column(r, "total").map(items)).toEqual([[1, 10], [2, 20], [3, 30, 100]]);
    expect(items(r.frames[2]!.outputs.index)).toEqual([0, 1, 2]);
  });

  it("hands whole loops to whole-loop scripts and outputs arrays as loops", () => {
    const source = `export const inputs = [{ key: "values", type: "number", wholeLoop: true }, { key: "scale", type: "number", default: 2 }];
export const outputs = [{ key: "sum", type: "number" }, { key: "scaled", type: "number", wholeLoop: true }, { key: "first", type: "number" }, { key: "index", type: "number" }];
export function evaluate(patch) {
  const values = patch.inputItems("values");
  patch.output("sum", values.reduce((a, b) => a + b, 0));
  patch.output("scaled", values.map((v) => v * patch.input("scale")));
  patch.output("first", patch.input("values"));
  patch.output("index", patch.loopIndex);
}`;
    const r = run(source, [{ values: makeLoop([1, 2, 3]) }, { values: makeLoop([]) }]);
    expect(r.frames[0]!.outputs.sum).toBe(6);
    expect(items(r.frames[0]!.outputs.scaled)).toEqual([2, 4, 6]);
    expect(r.frames[0]!.outputs.first).toBe(1);
    expect(r.frames[0]!.outputs.index).toBe(0);
    expect(r.frames[1]!.outputs.sum).toBe(0);
    expect(items(r.frames[1]!.outputs.scaled)).toEqual([]);
    expect(r.frames[1]!.outputs.first).toBe(0);
  });

  it("converts engine values into plain copies and back", () => {
    const r = run(
      `export const inputs = [{ key: "tint", type: "color" }, { key: "at", type: "point" }, { key: "data", type: "json" }];
export const outputs = [{ key: "tint2", type: "color" }, { key: "moved", type: "point" }, { key: "keys", type: "text" }];
export function evaluate(patch) {
  const c = patch.input("tint");
  c.r = 0;
  patch.output("tint2", { r: patch.input("tint").r / 2, g: c.g, b: 1 });
  patch.output("moved", { x: patch.input("at")[0] + 1, y: 5 });
  patch.output("keys", Object.keys(patch.input("data")));
}`,
      [{ tint: "#FF8000FF", at: [1, 2], data: { json: { a: 1, b: 2 } } }],
    );
    expect(r.frames[0]!.outputs.tint2).toEqual({ r: 0.5, g: 128 / 255, b: 1, a: 1 });
    expect(r.frames[0]!.outputs.moved).toEqual([2, 5]);
    expect(r.frames[0]!.outputs.keys).toBe('["a","b"]');
  });

  it("keeps the previous output and warns once when a value doesn't fit", () => {
    const r = run(
      `export const inputs = [{ key: "mode", type: "number" }];
export const outputs = [{ key: "size", type: "point" }];
export function evaluate(patch) { patch.output("size", patch.input("mode") === 0 ? [10, 20] : "big"); }`,
      [{ mode: 0 }, { mode: 1 }, { mode: 2 }],
    );
    expect(column(r, "size")).toEqual([[10, 20], [10, 20], [10, 20]]);
    expect(messages(r, "warn")).toEqual(['js.size: couldn\'t use "big" as point, so the output keeps its previous value.']);
  });

  it("passes inputs through while muted without running the script", () => {
    const r = run(
      `export const inputs = [{ key: "value", type: "number" }];
export const outputs = [{ key: "out", type: "number" }];
export function evaluate(patch) { console.log("ran"); patch.output("out", patch.input("value") * 10); }`,
      [{ value: 3 }],
      { muted: true },
    );
    expect(r.frames[0]!.outputs.out).toBe(3);
    expect(r.logs).toEqual([]);
  });

  it("lets scripts that declare variants switch type through typeParam", () => {
    const source = `export const variants = ["number", "text"];
export const inputs = [{ key: "value", type: "variant" }];
export const outputs = [{ key: "same", type: "variant" }];
export function evaluate(patch) { patch.output("same", patch.input("value")); }`;
    const doc = scriptDoc(source);
    const ports = javascript.dynamicPorts!({ type: "javascript", typeParam: "text", inputs: {}, settings: { script: FILE }, ui: { x: 0, y: 0 } }, doc);
    expect(ports.variants).toEqual(["number", "text"]);
    expect(ports.outputs.map((p) => p.type)).toEqual(["text"]);
    const added = applyOps(runtimeDoc(source), [{ op: "updatePatch", id: "js", typeParam: "text" }], { registry: createMockRegistry([javascript]) });
    expect(added.ok).toBe(true);
    const rt = createTestRuntime(added.ok ? added.doc : doc, [javascript]);
    rt.step();
    expect(rt.getValue("js.same")).toBe("");
    expect(rt.issues()).toEqual([]);
  });

  it("has no ports without a script and throws a clear error for a missing file", () => {
    expect(javascript.dynamicPorts!({ type: "javascript", inputs: {}, ui: { x: 0, y: 0 } }, scriptDoc(""))).toEqual({ inputs: [], outputs: [] });
    expect(() => javascript.dynamicPorts!({ type: "javascript", inputs: {}, settings: { script: "nope.js" }, ui: { x: 0, y: 0 } }, scriptDoc(""))).toThrow("scripts/nope.js doesn't exist. Create it with setScript or choose another file.");
    const r = runPatch(javascript, [{}], { settings: { script: "nope.js" }, doc: scriptDoc("") });
    expect(r.frames[0]!.outputs).toEqual({});
  });
});

describe("javascript: timers", () => {
  it("fires timeouts and intervals on the prototype clock, never in the frame that created them", () => {
    const r = run(
      `export const outputs = [{ key: "fired", type: "number" }, { key: "ticks", type: "number" }, { key: "soon", type: "number" }];
let ticks = 0;
export function evaluate(patch) {
  setTimeout((label) => patch.output("fired", patch.frame), 100, "x");
  setTimeout(() => patch.output("soon", patch.frame), 0);
  const id = setInterval(() => { ticks++; patch.output("ticks", ticks); if (ticks === 3) clearInterval(id); }, 50);
  const cancelled = setTimeout(() => patch.output("fired", -1), 10);
  clearTimeout(cancelled);
}`,
      Array.from({ length: 13 }, () => ({})),
    );
    expect(column(r, "soon")).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(column(r, "ticks")).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3]);
    expect(r.frames[6]!.outputs.fired).toBe(6);
    expect(r.frames[12]!.outputs.fired).toBe(6);
    expect(r.frames[9]!.requestedNextFrame).toBe(false);
    expect(r.frames[5]!.requestedNextFrame).toBe(true);
  });

  it("fires an interval at most once per frame after a long gap", () => {
    const r = run(
      `export const outputs = [{ key: "ticks", type: "number" }];
let ticks = 0;
export function evaluate() { setInterval(() => patch.output("ticks", ++ticks), 1); }`,
      [{}, {}, {}],
    );
    expect(column(r, "ticks")).toEqual([0, 1, 2]);
  });

  it("rejects string callbacks", () => {
    const r = run(`export function evaluate() { setTimeout("alert(1)", 10); }`, [{}]);
    expect(scriptErrors(r)[0]).toMatch(/TypeError: setTimeout needs a function/);
  });
});

describe("javascript: errors and budgets", () => {
  it("discards outputs staged by an invocation that throws and reports the script line", () => {
    const r = run(
      `export const inputs = [{ key: "value", type: "number" }];
export const outputs = [{ key: "doubled", type: "number" }];
export function evaluate(patch) {
  patch.output("doubled", patch.input("value") * 2);
  if (patch.input("value") > 5) throw new Error("too big");
}`,
      [{ value: 2 }, { value: 9 }, { value: 9.5 }, { value: 3 }],
    );
    expect(column(r, "doubled")).toEqual([4, 4, 4, 6]);
    expect(scriptErrors(r)).toEqual(["scripts/test.js:5:3 Error: too big"]);
  });

  it("reports syntax errors once with line and column, and never runs the script", () => {
    const r = run(`export const outputs = [{ key: "a", type: "number", default: 1 }];\nexport function evaluate(patch) {\n  patch.output("a" 5);\n}`, [{}, {}]);
    expect(column(r, "a")).toEqual([1, 1]);
    const errors = scriptErrors(r);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^scripts\/test\.js:3:20 SyntaxError: /);
  });

  it("reports top-level exceptions as compile errors", () => {
    const r = run(`export const outputs = [{ key: "a", type: "number" }];\nconst x = null;\nx.y = 1;\nexport function evaluate(patch) { patch.output("a", 5); }`, [{}, {}]);
    expect(column(r, "a")).toEqual([0, 0]);
    expect(scriptErrors(r)).toEqual(["scripts/test.js:3:1 TypeError: Cannot set properties of null (setting 'y')"]);
  });

  it("suggests the right key for undeclared ports", () => {
    const r = run(`export const outputs = [{ key: "label", type: "text" }, { key: "count", type: "number" }];\nexport function evaluate(patch) { patch.output("lable", "x"); }`, [{}]);
    expect(scriptErrors(r)[0]).toContain(`Error: "lable" isn't an output of this script. Did you mean "label"? Outputs: label, count.`);
  });

  it("stops a runaway script, marks it stalled, and keeps the runtime alive", () => {
    const r = run(
      `export const inputs = [{ key: "go", type: "number" }];
export const outputs = [{ key: "value", type: "number" }];
export function evaluate(patch) {
  if (patch.input("go") === 1) { while (true) {} }
  patch.output("value", patch.input("go"));
}`,
      [{ go: 0 }, { go: 1 }, { go: 2 }, { go: 3 }],
    );
    expect(column(r, "value")).toEqual([0, 0, 0, 0]);
    expect(scriptErrors(r)).toEqual(["scripts/test.js:4:34 The script took too long. Check for a loop that never ends."]);
  });

  it("stops a catastrophic regular expression within the budget, live and deterministic", () => {
    const source = `export const inputs = [{ key: "email", type: "text", default: "${"a".repeat(30)}!" }];
export const outputs = [{ key: "valid", type: "boolean", default: true }];
export function evaluate(patch) {
  patch.output("valid", /^(a+)+$/.test(patch.input("email")));
}`;
    for (const deterministic of [false, true]) {
      const rt = createTestRuntime(runtimeDoc(source), [javascript], { deterministic });
      const started = performance.now();
      rt.step();
      expect(performance.now() - started).toBeLessThan(LIVE_BUDGET_MS * 10);
      expect(rt.getValue("js.valid")).toBe(true);
      expect(rt.issues()).toEqual([{ code: "script_error", severity: "error", message: "scripts/test.js:4:3 The script took too long. Check for a loop that never ends.", patchId: "js" }]);
      // Stalled: later frames don't run the script again.
      const again = performance.now();
      rt.step();
      expect(performance.now() - again).toBeLessThan(LIVE_BUDGET_MS);
    }
  });

  it("stops a huge native allocation before it crashes the app, live and deterministic", () => {
    const source = `export const outputs = [{ key: "n", type: "number" }];
export function evaluate(patch) {
  const zeros = new Array(2 ** 28).fill(0);
  patch.output("n", zeros.length);
}`;
    for (const deterministic of [false, true]) {
      const rt = createTestRuntime(runtimeDoc(source), [javascript], { deterministic });
      rt.step();
      expect(rt.getValue("js.n")).toBe(0);
      expect(rt.issues()).toEqual([{ code: "script_error", severity: "error", message: "scripts/test.js:3:3 The script used too much memory.", patchId: "js" }]);
    }
  });

  it("logs unhandled promise rejections", () => {
    const r = run(`export async function evaluate() { await null; throw new Error("later"); }`, [{}]);
    expect(scriptErrors(r)).toEqual(["scripts/test.js:1:48 Uncaught (in promise) Error: later"]);
  });
});

describe("javascript: console and determinism", () => {
  it("prefixes console output and hides floods", () => {
    const r = run(`export function evaluate() { console.log("hello", { a: 1, nested: [1, "two"] }); console.warn("careful"); for (let i = 0; i < 150; i++) console.info(i); }`, [{}]);
    const all = messages(r);
    expect(all[0]).toBe(`[js#0] hello { a: 1, nested: [ 1, "two" ] }`);
    expect(r.logs[1]).toMatchObject({ level: "warn" });
    expect(all).toHaveLength(101);
    expect(all[100]).toBe("[js#0] more messages hidden");
  });

  it("uses the runtime's seeded random numbers and prototype clock", () => {
    const source = `export const outputs = [{ key: "random", type: "number" }, { key: "now", type: "number" }, { key: "perf", type: "number" }, { key: "date", type: "number" }];
export const alwaysEvaluate = true;
export function evaluate(patch) { patch.output("random", Math.random()); patch.output("now", Date.now()); patch.output("perf", performance.now()); patch.output("date", new Date().getTime()); }`;
    const a = run(source, [{}, {}, {}]);
    const b = run(source, [{}, {}, {}]);
    expect(column(a, "random")).toEqual(column(b, "random"));
    expect(new Set(column(a, "random")).size).toBe(3);
    expect(column(a, "now")).toEqual([DETERMINISTIC_EPOCH_MS, DETERMINISTIC_EPOCH_MS + 1000 / 60, DETERMINISTIC_EPOCH_MS + 2000 / 60]);
    expect(column(a, "date")).toEqual(column(a, "now").map((n) => Math.trunc(n as number)));
    expect(column(a, "perf")).toEqual([0, 1000 / 60, 2000 / 60]);
  });
});

describe("javascript: web extras", () => {
  it("provides queueMicrotask, TextEncoder, TextDecoder, btoa, and atob", () => {
    const r = run(
      `export const outputs = [{ key: "log", type: "json" }];
export function evaluate(patch) {
  const log = [];
  queueMicrotask(() => { log.push("microtask"); patch.output("log", log); });
  const bytes = new TextEncoder().encode("héllo");
  log.push(bytes.length, new TextDecoder().decode(bytes), btoa("hi"), atob("aGk="));
  try { new TextDecoder("latin1"); } catch (e) { log.push(e.name); }
  try { btoa("é✓"); } catch (e) { log.push(e.name); }
  log.push("sync");
  patch.output("log", log);
}`,
      [{}],
    );
    expect(r.frames[0]!.outputs.log).toEqual([6, "héllo", "aGk=", "hi", "RangeError", "InvalidCharacterError", "sync", "microtask"]);
  });
});

describe("javascript: isolation", () => {
  it("keeps host capabilities out of reach through the patch object and globals", () => {
    const r = run(
      `export const outputs = [{ key: "results", type: "json" }];
export function evaluate(patch) {
  const attempts = [
    () => patch.output.constructor("return process")(),
    () => setTimeout.constructor("return globalThis")(),
    () => console.log.constructor.call(null, "return 1")(),
    () => fetch.constructor.apply(null, ["return 1"])(),
    () => Object.getPrototypeOf(patch.input).constructor("return 1")(),
    () => { Object.prototype.polluted = 1; },
  ];
  patch.output("results", attempts.map((attempt) => { try { attempt(); return "escaped"; } catch (e) { return e.name; } }));
}`,
      [{}],
    );
    expect(r.frames[0]!.outputs.results).toEqual(["EvalError", "EvalError", "EvalError", "EvalError", "EvalError", "TypeError"]);
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("suggests whole-loop mode above 1,000 per-item instances", () => {
    const r = run(`export const inputs = [{ key: "value", type: "number" }];\nexport const outputs = [{ key: "double", type: "number" }];\nexport function evaluate(patch) { patch.output("double", patch.input("value") * 2); }`, [
      { value: makeLoop(Array.from({ length: 1001 }, (_, i) => i)) },
    ]);
    expect(items(r.frames[0]!.outputs.double)).toHaveLength(1001);
    expect((items(r.frames[0]!.outputs.double) as number[])[1000]).toBe(2000);
    expect(messages(r, "warn")).toEqual(["js runs its script 1001 times, once per loop item. Mark a port wholeLoop: true to run it once with the whole loop."]);
  });
});

describe("javascript: Origami-style scripts", () => {
  it("runs PatchInput and PatchOutput scripts with Origami value shapes", () => {
    const r = run(
      `var patch = new Patch();
patch.inputs = [new PatchInput("Position", types.POSITION, { x: 1, y: 2 }), new PatchInput("Go", types.PULSE)];
patch.outputs = [new PatchOutput("Moved", types.POSITION), new PatchOutput("Done", types.PULSE), new PatchOutput("Dirty", types.BOOLEAN), new PatchOutput("Kind", types.STRING)];
patch.evaluate = function () {
  var p = patch.inputs[0].value;
  patch.outputs[0].value = { x: p.x + 10, y: p.y + 10 };
  if (patch.inputs[1].readRising()) patch.outputs[1].pulse();
  patch.outputs[2].value = patch.inputs[0].isDirty();
  patch.outputs[3].value = typeof Http.getJson + " " + typeof Base64.encode + " " + patch.type;
};
return patch;`,
      [{}, { go: true }, { position: [5, 5] }],
    );
    expect(column(r, "moved")).toEqual([[11, 12], [11, 12], [15, 15]]);
    expect(r.frames.map((f) => f.pulses)).toEqual([[], ["done"], []]);
    expect(column(r, "dirty")).toEqual([true, false, true]);
    expect(r.frames[0]!.outputs.kind).toBe("function function null");
    expect(r.issues).toEqual([]);
  });

  it("asks Origami scripts to return their patch", () => {
    const r = run(`var patch = new Patch();\npatch.outputs = [new PatchOutput("A", types.NUMBER)];`, [{}]);
    expect(scriptErrors(r)[0]).toMatch(/ends with return patch;/);
  });
});

describe("javascript: in the runtime", () => {
  const quoteScript = `export const inputs = [{ key: "load", type: "pulse" }];
export const outputs = [{ key: "quote", type: "text" }, { key: "loading", type: "boolean" }, { key: "error", type: "text" }];
export async function evaluate(patch) {
  if (!patch.pulsed("load")) return;
  patch.output("loading", true);
  try {
    const res = await fetch("https://quotes.example/today", { headers: { Accept: "application/json" }, body: { mood: "calm" }, method: "post" });
    const data = await res.json();
    patch.output("quote", res.status + " " + data.text);
  } catch (e) {
    patch.output("error", e.message);
  }
  patch.output("loading", false);
}`;
  const loader = sequenceDefinition("loader", "pulse", [true, false]);
  const wire = { patches: { src: { type: "loader" } }, ops: [{ op: "connect", from: "src.value", to: "js.load" }] as Op[], definitions: [loader] };

  it("delivers network results on the step after they settle", async () => {
    const calls: { url: string; init: unknown }[] = [];
    const platform: PlatformServices = {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => JSON.stringify({ text: "Stay curious." }) };
      },
    };
    const rt = createTestRuntime(runtimeDoc(quoteScript, wire), [javascript, loader], { platform });
    rt.step();
    expect([rt.getValue("js.loading"), rt.getValue("js.quote")]).toEqual([true, ""]);
    expect(rt.needsNextFrame).toBe(true);
    expect(calls.map(({ url, init }) => ({ url, init: { ...(init as object), signal: undefined } }))).toEqual([
      { url: "https://quotes.example/today", init: { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: '{"mood":"calm"}', signal: undefined } },
    ]);
    expect((calls[0]!.init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    await stepSettled(rt, 1);
    expect([rt.getValue("js.loading"), rt.getValue("js.quote")]).toEqual([false, "200 Stay curious."]);
    expect(rt.needsNextFrame).toBe(false);
    expect(rt.issues()).toEqual([]);
  });

  it("rejects fetch without a platform, for non-http URLs, and for failed transports", async () => {
    const offline = createTestRuntime(runtimeDoc(quoteScript, wire), [javascript, loader]);
    offline.step();
    expect(offline.getValue("js.error")).toBe("Network isn't available for scripts here.");

    const badUrl = createTestRuntime(runtimeDoc(quoteScript.replace("https://quotes.example/today", "file:///etc/passwd"), wire), [javascript, loader], { platform: { fetch: async () => ({ ok: true, status: 200, text: async () => "" }) } });
    badUrl.step();
    expect(badUrl.getValue("js.error")).toBe("Scripts can only fetch http or https URLs.");

    const failing = createTestRuntime(runtimeDoc(quoteScript, wire), [javascript, loader], { platform: { fetch: async () => Promise.reject(new Error("offline")) } });
    failing.step();
    await stepSettled(failing, 1);
    expect(failing.getValue("js.error")).toBe("Network request failed");
  });

  it("rejects aborted requests with AbortError on the next step and cancels them on the host", async () => {
    const source = `export const outputs = [{ key: "result", type: "text" }];
export const alwaysEvaluate = true;
const controller = new AbortController();
fetch("https://slow.example", { signal: controller.signal }).then(() => patch.output("result", "done"), (e) => patch.output("result", e.name));
export function evaluate(patch) { if (patch.frame === 1) controller.abort(); }`;
    const signals: AbortSignal[] = [];
    const rt = createTestRuntime(runtimeDoc(source), [javascript], {
      platform: {
        fetch: (_url, init) => {
          signals.push(init!.signal!);
          return new Promise(() => {});
        },
      },
    });
    rt.step();
    expect(signals.map((s) => s.aborted)).toEqual([false]);
    rt.step();
    expect(signals.map((s) => s.aborted)).toEqual([true]);
    expect(rt.getValue("js.result")).toBe("");
    await stepSettled(rt, 1);
    expect(rt.getValue("js.result")).toBe("AbortError");
  });

  it("cancels in-flight requests on the host when the prototype restarts", () => {
    const source = `export const outputs = [];
fetch("https://slow.example");`;
    const signals: AbortSignal[] = [];
    const rt = createTestRuntime(runtimeDoc(source), [javascript], { platform: { fetch: (_url, init) => (signals.push(init!.signal!), new Promise(() => {})) } });
    rt.step();
    rt.restart();
    rt.step();
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
  });

  it("exposes response headers to scripts, case-insensitively", async () => {
    const source = `export const outputs = [{ key: "type", type: "text" }, { key: "missing", type: "boolean" }, { key: "names", type: "text" }];
fetch("https://api.example/data").then((res) => {
  patch.output("type", res.headers.get("Content-Type"));
  patch.output("missing", res.headers.get("x-nope") === null && !res.headers.has("x-nope"));
  const names = [];
  res.headers.forEach((value, name) => names.push(name));
  patch.output("names", names.join(","));
});`;
    const platform: PlatformServices = { fetch: async () => ({ ok: true, status: 200, headers: { "content-type": "application/json", etag: "7" }, text: async () => "{}" }) };
    const rt = createTestRuntime(runtimeDoc(source), [javascript], { platform });
    rt.step();
    await stepSettled(rt, 1);
    expect([rt.getValue("js.type"), rt.getValue("js.missing"), rt.getValue("js.names")]).toEqual(["application/json", true, "content-type,etag"]);
  });

  it("runs Origami Http and Base64 helpers on fetch", async () => {
    const source = `var patch = new Patch();
patch.inputs = [new PatchInput("Load", types.PULSE)];
patch.outputs = [new PatchOutput("Name", types.STRING), new PatchOutput("Encoded", types.STRING), new PatchOutput("Problem", types.STRING)];
patch.evaluate = function () {
  if (!patch.inputs[0].readRising()) return;
  Http.getJson("https://api.example/user", { urlParameters: { id: 7 } }).then(function (json) { patch.outputs[0].value = json.name; });
  Base64.encode("hé").then(function (text) { patch.outputs[1].value = text; });
  Http.get("https://api.example/raw", { responseType: "raw" }).catch(function (e) { patch.outputs[2].value = e.message; });
};
return patch;`;
    const urls: string[] = [];
    const platform: PlatformServices = {
      fetch: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, text: async () => '{"name":"Ada"}' };
      },
    };
    const rt = createTestRuntime(runtimeDoc(source, wire), [javascript, loader], { platform });
    rt.step();
    expect(rt.getValue("js.encoded")).toBe("aMOp");
    expect(rt.getValue("js.problem")).toBe("Http option responseType isn't supported yet.");
    await stepSettled(rt, 1);
    expect(rt.getValue("js.name")).toBe("Ada");
    expect(urls).toEqual(["https://api.example/user?id=7"]);
  });

  it("raises script errors as runtime issues with the patch id", () => {
    const rt = createTestRuntime(runtimeDoc(`export const outputs = [];\nexport function evaluate() { null.boom; }`), [javascript]);
    rt.step();
    expect(rt.issues()).toEqual([{ code: "script_error", severity: "error", message: "scripts/test.js:2:30 TypeError: Cannot read properties of null (reading 'boom')", patchId: "js" }]);
  });

  it("reports a broken header as dynamic_ports_failed", () => {
    const doc = runtimeDoc(`export const inputs = [{ key: "a", type: "number" }];`);
    const rt = createTestRuntime({ ...doc, scripts: { [FILE]: "export const inputs = [SIZE];" } }, [javascript]);
    rt.step();
    expect(rt.issues()[0]).toMatchObject({ code: "dynamic_ports_failed", severity: "warning", patchId: "js" });
    expect(rt.issues()[0]!.message).toContain("scripts/test.js:1:24 Write the port list as plain values.");
  });

  it("restart disposes timers and module state", () => {
    const source = `export const outputs = [{ key: "count", type: "number" }, { key: "late", type: "boolean" }];
export const alwaysEvaluate = true;
let count = 0;
export function evaluate(patch) { patch.output("count", ++count); if (count === 1) setTimeout(() => patch.output("late", true), 1000); }`;
    const rt = createTestRuntime(runtimeDoc(source), [javascript]);
    runFrames(rt, 5);
    expect(rt.getValue("js.count")).toBe(5);
    rt.restart();
    runFrames(rt, 70);
    expect(rt.getValue("js.count")).toBe(70);
    expect(rt.getValue("js.late")).toBe(true);
    rt.restart();
    runFrames(rt, 10);
    expect(rt.getValue("js.late")).toBe(false);
  });

  it("rebuilds on a script change, keeping outputs whose key and type stay the same", () => {
    const v1 = `export const outputs = [{ key: "label", type: "text" }, { key: "count", type: "number" }];
export function evaluate(patch) { patch.output("label", "v1"); patch.output("count", 7); }`;
    const v2 = `export const outputs = [{ key: "label", type: "text" }, { key: "count", type: "text" }, { key: "version", type: "number" }];
export function evaluate(patch) { patch.output("version", 2); }`;
    const doc = runtimeDoc(v1);
    const rt = createTestRuntime(doc, [javascript]);
    runFrames(rt, 2);
    expect([rt.getValue("js.label"), rt.getValue("js.count")]).toEqual(["v1", 7]);
    rt.updateDocument({ ...doc, scripts: { [FILE]: v2 } });
    runFrames(rt, 1);
    expect([rt.getValue("js.label"), rt.getValue("js.count"), rt.getValue("js.version")]).toEqual(["v1", "", 2]);
  });

  it("traces scripts on a deterministic clone", () => {
    const source = `export const outputs = [{ key: "seconds", type: "number" }];
export function evaluate(patch) { setInterval(() => patch.output("seconds", Math.round(patch.time)), 1000); }`;
    const rt = createTestRuntime(runtimeDoc(source), [javascript]);
    const trace = rt.trace(["js.seconds"], 2100);
    expect(trace.values["js.seconds"]!.at(-1)).toBe(2);
    expect(rt.frame).toBe(-1);
  });
});
