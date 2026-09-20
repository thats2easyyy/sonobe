/**
 * examples/<folder>/test.json: scripted simulated input plus expectations on traced values. Scenarios
 * run through a SonobeHost's sim API (the same path as the sim_* MCP tools): each one resets a
 * deterministic simulation, traces its targets while the events play, and checks the samples.
 */

import { summarizeSeries } from "@sonobe/engine";
import { parseSimEvents, type SimEvent, type SimIssue, type SonobeHost } from "@sonobe/mcp";

export type CompareOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

/** Which sample an expectation reads: first, last, smallest, largest, or the first at or after a time in ms. */
export type SamplePoint = "start" | "end" | "min" | "max" | number;

export interface Expectation {
  /** What should be true, in plain language. Shown when the check fails. */
  description: string;
  /** Value address: "patchId.port" or "@layerId.prop", with "#n" for one loop copy. */
  target: string;
  /** One part of a vector or color: "x", "y", "z", "width", "height", "r", "g", "b", "a", or an index. */
  component?: string | number;
  /** Which sample to compare (default "end"). */
  at?: SamplePoint;
  op?: CompareOp;
  value?: number | boolean | string;
  /** Allowed difference for "==" and "!=" on numbers (default 0.001). */
  tolerance?: number;
  /** true: the value stopped moving before the scenario ended; false: still moving at the end. */
  settled?: boolean;
  /** The value stopped moving within this many milliseconds of the scenario start. */
  settlesWithinMs?: number;
}

export interface Scenario {
  name: string;
  /** Knob preset (id or name) the simulation runs; default: the document's running preset. */
  preset?: string;
  /** Simulated input with the same shapes as sim_dispatch; atMs counts from the scenario start. */
  events: SimEvent[];
  /** How long to simulate, in milliseconds. */
  durationMs: number;
  expect: Expectation[];
}

export interface ExampleTest {
  /** What the scenarios cover. */
  description: string;
  scenarios: Scenario[];
}

export class ExampleTestFormatError extends Error {
  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.name = "ExampleTestFormatError";
  }
}

const OPS: readonly string[] = [">", ">=", "<", "<=", "==", "!="];
const POINTS: readonly string[] = ["start", "end", "min", "max"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseExpectation(raw: unknown, where: string, fail: (m: string) => never): Expectation {
  if (!isRecord(raw)) fail(`${where} must be an object.`);
  const { description, target, component, at, op, value, tolerance, settled, settlesWithinMs } = raw;
  if (typeof description !== "string" || !description.trim()) fail(`${where}.description must say what should be true.`);
  if (typeof target !== "string" || !target.trim()) fail(`${where}.target must be a value address like "@card.scale".`);
  const out: Expectation = { description, target };
  if (component !== undefined) {
    if (typeof component !== "string" && typeof component !== "number") fail(`${where}.component must be a name like "y" or an index.`);
    out.component = component;
  }
  if (at !== undefined) {
    if (!(typeof at === "number" && at >= 0) && !(typeof at === "string" && POINTS.includes(at))) fail(`${where}.at must be "start", "end", "min", "max", or milliseconds.`);
    out.at = at as SamplePoint;
  }
  if (op !== undefined || value !== undefined) {
    if (typeof op !== "string" || !OPS.includes(op)) fail(`${where}.op must be one of ${OPS.join(" ")}.`);
    if (typeof value !== "number" && typeof value !== "boolean" && typeof value !== "string") fail(`${where}.value must be a number, boolean, or text.`);
    if (typeof value !== "number" && op !== "==" && op !== "!=") fail(`${where}: ${op} needs a number value.`);
    out.op = op as CompareOp;
    out.value = value;
  }
  if (tolerance !== undefined) {
    if (typeof tolerance !== "number" || tolerance < 0) fail(`${where}.tolerance must be a number of at least 0.`);
    out.tolerance = tolerance;
  }
  if (settled !== undefined) {
    if (typeof settled !== "boolean") fail(`${where}.settled must be true or false.`);
    out.settled = settled;
  }
  if (settlesWithinMs !== undefined) {
    if (typeof settlesWithinMs !== "number" || settlesWithinMs <= 0) fail(`${where}.settlesWithinMs must be a positive number.`);
    out.settlesWithinMs = settlesWithinMs;
  }
  if (out.op === undefined && out.settled === undefined && out.settlesWithinMs === undefined) fail(`${where} needs op and value, settled, or settlesWithinMs.`);
  return out;
}

/** Validate a parsed test.json. Throws ExampleTestFormatError naming the first problem. */
export function parseExampleTest(json: unknown, source = "test.json"): ExampleTest {
  const fail = (message: string): never => {
    throw new ExampleTestFormatError(source, message);
  };
  if (!isRecord(json)) fail("The file must hold an object with description and scenarios.");
  const { description, scenarios } = json as Record<string, unknown>;
  if (typeof description !== "string") fail("description must be text.");
  if (!Array.isArray(scenarios) || !scenarios.length) fail("scenarios must be a non-empty array.");
  const names = new Set<string>();
  const parsed = (scenarios as unknown[]).map((raw, i): Scenario => {
    const where = `scenarios[${i}]`;
    if (!isRecord(raw)) fail(`${where} must be an object.`);
    const s = raw as Record<string, unknown>;
    if (typeof s.name !== "string" || !s.name.trim()) fail(`${where}.name must be text.`);
    if (names.has(s.name as string)) fail(`${where}.name "${s.name}" is used twice.`);
    names.add(s.name as string);
    if (typeof s.durationMs !== "number" || s.durationMs <= 0 || s.durationMs > 60_000) fail(`${where}.durationMs must be between 1 and 60000.`);
    const events = parseSimEvents(s.events ?? []);
    if (!events.ok) fail(`${where}.events: ${events.message}`);
    if (!Array.isArray(s.expect) || !s.expect.length) fail(`${where}.expect must list at least one expectation.`);
    const expect = (s.expect as unknown[]).map((e, j) => parseExpectation(e, `${where}.expect[${j}]`, fail));
    if (s.preset !== undefined && (typeof s.preset !== "string" || !s.preset.trim())) fail(`${where}.preset must name a knob preset, like "Shipped app".`);
    const scenario: Scenario = { name: s.name as string, events: (events as { events: SimEvent[] }).events, durationMs: s.durationMs as number, expect };
    if (typeof s.preset === "string") scenario.preset = s.preset;
    return scenario;
  });
  return { description: description as string, scenarios: parsed };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const VECTOR_COMPONENTS: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, width: 0, height: 1 };

/** One component of a traced JSON value: a vector index, a color channel, or the value itself. */
export function pickComponent(value: unknown, component: string | number | undefined): unknown {
  if (component === undefined) return value;
  if (Array.isArray(value)) {
    const index = typeof component === "number" ? component : VECTOR_COMPONENTS[component];
    return index === undefined ? undefined : value[index];
  }
  if (isRecord(value)) return value[String(component)];
  return undefined;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return Number.NaN;
}

/** Compare an actual value with an expected one. Numbers compare with a tolerance for == and !=. */
export function compare(actual: unknown, op: CompareOp, expected: number | boolean | string, tolerance = 0.001): boolean {
  if (typeof expected === "number") {
    const n = toNumber(actual);
    if (!Number.isFinite(n)) return false;
    switch (op) {
      case ">":
        return n > expected;
      case ">=":
        return n >= expected;
      case "<":
        return n < expected;
      case "<=":
        return n <= expected;
      case "==":
        return Math.abs(n - expected) <= tolerance;
      case "!=":
        return Math.abs(n - expected) > tolerance;
    }
  }
  const equal = actual === expected;
  return op === "!=" ? !equal : op === "==" ? equal : false;
}

const round = (v: unknown): unknown => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);

function describeTarget(e: Expectation): string {
  return e.component === undefined ? e.target : `${e.target} ${e.component}`;
}

export interface ExpectationResult {
  description: string;
  pass: boolean;
  /** Why it passed or failed, with the actual numbers. */
  detail: string;
}

/**
 * Check one expectation against a trace: `times` in ms from the scenario start, `series` one JSON
 * value per sample.
 */
export function evaluateExpectation(e: Expectation, times: readonly number[], series: readonly unknown[]): ExpectationResult {
  const label = describeTarget(e);
  const values = series.map((v) => pickComponent(v, e.component));
  if (!values.length) return { description: e.description, pass: false, detail: `${label} has no samples.` };
  const checks: { pass: boolean; text: string }[] = [];

  if (e.op !== undefined && e.value !== undefined) {
    const at = e.at ?? "end";
    let actual: unknown;
    let where: string;
    if (at === "start" || at === "end") {
      actual = at === "start" ? values[0] : values[values.length - 1];
      where = `at ${at}`;
    } else if (at === "min" || at === "max") {
      const numbers = values.map(toNumber).filter(Number.isFinite);
      actual = numbers.length ? (at === "min" ? Math.min(...numbers) : Math.max(...numbers)) : undefined;
      where = `${at} over ${Math.round(times[times.length - 1] ?? 0)} ms`;
    } else {
      let i = times.findIndex((t) => t >= at - 1e-6);
      if (i < 0) i = values.length - 1;
      actual = values[i];
      where = `at ${Math.round(times[i] ?? at)} ms`;
    }
    const pass = compare(actual, e.op, e.value, e.tolerance);
    checks.push({ pass, text: `${label} ${where} is ${JSON.stringify(round(actual))} (wanted ${e.op} ${JSON.stringify(e.value)}${e.op === "==" && typeof e.value === "number" ? ` ± ${e.tolerance ?? 0.001}` : ""})` });
  }

  if (e.settled !== undefined || e.settlesWithinMs !== undefined) {
    const summary = summarizeSeries(times.map((t) => t / 1000), values as never[]);
    const settleMs = summary?.settleTime === null || summary === null ? null : summary.settleTime * 1000;
    if (summary === null) {
      checks.push({ pass: false, text: `${label} isn't a number, so it can't settle` });
    } else {
      if (e.settled !== undefined) {
        const settled = settleMs !== null;
        checks.push({ pass: settled === e.settled, text: settled ? `${label} settled by ${Math.round(settleMs!)} ms` : `${label} was still moving at the end` });
      }
      if (e.settlesWithinMs !== undefined) {
        checks.push({ pass: settleMs !== null && settleMs <= e.settlesWithinMs, text: settleMs === null ? `${label} never settled (wanted within ${e.settlesWithinMs} ms)` : `${label} settled by ${Math.round(settleMs)} ms (wanted within ${e.settlesWithinMs} ms)` });
      }
    }
  }

  return { description: e.description, pass: checks.every((c) => c.pass), detail: checks.map((c) => c.text).join("; ") };
}

export interface ScenarioReport {
  name: string;
  pass: boolean;
  results: ExpectationResult[];
  /** Hit-report warnings for the events (missed touches, layers in the way). */
  warnings: string[];
  /** Runtime issues raised while simulating (unimplemented patches, script errors...). */
  issues: SimIssue[];
}

/** How long an input keeps the pointer busy, in ms, including the frames its last input needs to land. */
export function eventSpanMs(event: SimEvent, frameMs: number): number {
  switch (event.kind) {
    case "tap":
      return Math.max(frameMs, event.holdMs ?? 50) + 2 * frameMs;
    case "longPress":
      return Math.max(frameMs, event.durationMs ?? 600) + 2 * frameMs;
    case "drag":
      return Math.max(frameMs, event.durationMs ?? 300) + 3 * frameMs;
    case "key":
      return 3 * frameMs;
    default:
      return frameMs;
  }
}

export interface EventSegment {
  /** Frames stepped before the segment starts. */
  startFrame: number;
  endFrame: number;
  /** Events with atMs relative to the segment start, and their index in the scenario. */
  events: { index: number; event: SimEvent }[];
}

/**
 * Split a scenario into consecutive trace segments. Inputs whose spans overlap stay in one segment,
 * and each segment starts on the frame before its first input fires, so hit reports describe the
 * scene the input actually lands on and every input fires on the same frame a single trace would use.
 */
export function segmentEvents(events: readonly SimEvent[], durationMs: number, fps: number): EventSegment[] {
  const frameMs = 1000 / fps;
  const totalFrames = Math.floor(durationMs / frameMs + 1e-9);
  const sorted = events.map((event, index) => ({ event, index, at: Math.max(0, event.atMs ?? 0) })).sort((a, b) => a.at - b.at || a.index - b.index);
  const groups: { at: number; end: number; items: typeof sorted }[] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const end = item.at + eventSpanMs(item.event, frameMs);
    if (last && item.at < last.end) {
      last.items.push(item);
      last.end = Math.max(last.end, end);
    } else {
      groups.push({ at: item.at, end, items: [item] });
    }
  }
  const segments: EventSegment[] = [];
  let cursor = 0;
  let pending: EventSegment["events"] = [];
  for (const group of groups) {
    // A single trace fires an input on frame ceil(atMs / frameMs); start the segment one frame before.
    const start = Math.min(totalFrames, Math.max(cursor, Math.ceil(group.at / frameMs - 1e-9) - 1));
    if (start > cursor) {
      segments.push({ startFrame: cursor, endFrame: start, events: pending });
      cursor = start;
      pending = [];
    }
    const offset = cursor * frameMs;
    for (const { event, index, at } of group.items) pending.push({ index, event: { ...event, atMs: Math.max(0, at - offset) } });
  }
  segments.push({ startFrame: cursor, endFrame: totalFrames, events: pending });
  return segments.filter((segment) => segment.endFrame > segment.startFrame);
}

/** Run one scenario on a fresh simulation of `docId`, tracing segment by segment. */
export async function runScenario(host: SonobeHost, docId: string, scenario: Scenario): Promise<ScenarioReport> {
  const state = await host.sim.reset({ docId, ...(scenario.preset !== undefined ? { preset: scenario.preset } : {}) });
  const frameMs = 1000 / state.fps;
  const targets = [...new Set(scenario.expect.map((e) => e.target))];
  const times: number[] = [];
  const values: Record<string, unknown[]> = Object.fromEntries(targets.map((t) => [t, [] as unknown[]]));
  const warnings: string[] = [];
  const issues: SimIssue[] = [...state.issues];
  for (const segment of segmentEvents(scenario.events, scenario.durationMs, state.fps)) {
    const frames = segment.endFrame - segment.startFrame;
    if (frames <= 0) continue;
    const trace = await host.sim.trace(state.simId, { targets, durationMs: frames * frameMs, events: segment.events.map((e) => e.event), advance: true });
    const offset = segment.startFrame * frameMs;
    // Times come from frame counts, so a Restart Prototype inside a scenario can't make them run backwards.
    for (let i = 0; i < trace.times.length; i++) times.push(Math.round((offset + (i + 1) * frameMs) * 100) / 100);
    for (const target of targets) values[target]!.push(...(trace.values[target] ?? []));
    for (const report of trace.events) {
      const original = segment.events[report.index];
      for (const w of report.warnings) warnings.push(`event ${original?.index ?? report.index} (${report.kind}): ${w}`);
    }
    issues.push(...trace.issues);
  }
  const results = scenario.expect.map((e) => evaluateExpectation(e, times, values[e.target] ?? []));
  return { name: scenario.name, pass: results.every((r) => r.pass) && !warnings.length && !issues.length, results, warnings, issues };
}

/** A readable multi-line report. */
export function formatReport(report: ScenarioReport): string {
  const lines = [`${report.pass ? "✓" : "✗"} ${report.name}`];
  for (const r of report.results) lines.push(`  ${r.pass ? "✓" : "✗"} ${r.description}\n      ${r.detail}`);
  for (const w of report.warnings) lines.push(`  ! ${w}`);
  for (const i of report.issues) lines.push(`  ! ${i.severity} ${i.code}: ${i.message}`);
  return lines.join("\n");
}
