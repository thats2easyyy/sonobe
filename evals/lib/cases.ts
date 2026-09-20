/**
 * Eval cases: evals/cases/<id>/ holds case.json, prompt.md, and usually a start project and a
 * test.json. Loading validates everything up front, so a broken case fails before Claude runs.
 * Expectations read layer properties only ("@layer.prop"), so Claude's own patch ids and wiring
 * never matter.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyOps,
  createEmptyDocument,
  DEFAULT_DEVICE,
  type Op,
  type Registry,
  type SonobeDocument,
} from "@sonobe/core";
import { loadProjectFromDisk, saveProjectToDisk } from "@sonobe/core/node";
import { EXAMPLES_DIR } from "../../examples/lib/disk.ts";
import { importRecipeDesign } from "../../examples/lib/recipe.ts";
import {
  ExampleTestFormatError,
  parseExampleTest,
  type ExampleTest,
  type Scenario,
} from "../../examples/lib/scenarios.ts";
import { RECIPES } from "../../examples/recipes/index.ts";

/** The evals/ folder. */
export const EVALS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const CASES_DIR = path.join(EVALS_DIR, "cases");

/** Where a case's project starts. */
export type StartSpec =
  | { kind: "project"; dir: string; ops: Op[] }
  /** An example folder; with `patches: false`, only its layers (built from its recipe, after its design import). */
  | { kind: "example"; example: string; patches: boolean; ops: Op[] };

/** A fact about the finished document that doesn't depend on Claude's own ids or wiring. */
export type DocumentCheck =
  | { kind: "unchanged"; description: string }
  | {
      kind: "interface";
      description: string;
      component: string;
      /** Port keys that must be gone from both sides. */
      without?: string[];
      /** Display names the outputs must be, exactly (case-insensitive). */
      outputs?: string[];
      inputs?: string[];
    }
  | { kind: "keepsIds"; description: string; component?: string }
  | { kind: "presets"; description: string; presets: { name: string; locked?: boolean }[] };

export interface AnswerCheck {
  /** Each group lists words of which the final reply must contain at least one (case-insensitive). */
  mentions: string[][];
}

export interface EvalCase {
  /** The folder name. */
  id: string;
  dir: string;
  title: string;
  /** What the case checks and where it comes from. */
  about?: string;
  tags: string[];
  /** prompt.md, with {{url}} where the served file's address goes. */
  prompt: string;
  start: StartSpec;
  /** Scenarios on layer properties (the case's test.json, an example's, or both). */
  test?: ExampleTest;
  checks: DocumentCheck[];
  answer?: AnswerCheck;
  /** Whether error diagnostics in the finished document are acceptable (default no). */
  allowErrorDiagnostics: boolean;
  budget: { maxTurns?: number; timeoutSec?: number };
  /** Hide list_examples and get_example, so Claude can't copy an example's answer. */
  hideExamples: boolean;
  /** A file in the case folder the runner serves over HTTP; the prompt's {{url}} points at it. */
  serve?: string;
  /** solution.json: tool calls that solve the case (the fake client plays them). */
  solution?: string;
}

export class CaseFormatError extends Error {
  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.name = "CaseFormatError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const CASE_FIELDS = [
  "title",
  "about",
  "tags",
  "start",
  "test",
  "checks",
  "answer",
  "allowErrorDiagnostics",
  "budget",
  "examples",
  "serve",
];

/** The layer id an expectation or event target names: "@card#2/badge.scale" → "card". */
export function targetLayer(target: string): string | undefined {
  const m = /^@([A-Za-z_][A-Za-z0-9_]*)/.exec(target);
  return m?.[1];
}

/** Keep the expectations that read layer properties; drop scenarios left with none. */
export function layerExpectationsOnly(test: ExampleTest): ExampleTest {
  const scenarios = test.scenarios
    .map((s) => ({ ...s, expect: s.expect.filter((e) => e.target.startsWith("@")) }))
    .filter((s) => s.expect.length > 0);
  return { description: test.description, scenarios };
}

function readExampleTest(example: string, source: string): ExampleTest {
  const file = path.join(EXAMPLES_DIR, example, "test.json");
  if (!existsSync(file)) throw new CaseFormatError(source, `examples/${example} has no test.json.`);
  return layerExpectationsOnly(
    parseExampleTest(JSON.parse(readFileSync(file, "utf8")), `examples/${example}/test.json`),
  );
}

function parseOps(raw: unknown, where: string, fail: (m: string) => never): Op[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every(isRecord) || !raw.every((op) => typeof op.op === "string"))
    fail(`${where} must be a list of ops like { "op": "setInput", ... }.`);
  return raw as Op[];
}

function parseStart(raw: unknown, dir: string, fail: (m: string) => never): StartSpec {
  if (!isRecord(raw))
    fail(
      'start must be { "project": "start" } or { "example": "01-tap-to-grow", "patches": false }.',
    );
  const ops = parseOps(raw.ops, "start.ops", fail);
  if (typeof raw.project === "string") {
    const projectDir = path.join(dir, raw.project);
    if (!existsSync(path.join(projectDir, "project.json")))
      fail(`start.project "${raw.project}" isn't a project folder (no project.json).`);
    return { kind: "project", dir: projectDir, ops };
  }
  if (typeof raw.example === "string") {
    const example = raw.example;
    if (!existsSync(path.join(EXAMPLES_DIR, example, "project.json")))
      fail(`start.example "${example}" isn't a folder in examples/.`);
    if (raw.patches !== undefined && typeof raw.patches !== "boolean")
      fail("start.patches must be true or false.");
    const patches = raw.patches !== false;
    if (!patches && !RECIPES.some((r) => r.folder === example))
      fail(`start.example "${example}" has no recipe, so its layers can't be built alone.`);
    return { kind: "example", example, patches, ops };
  }
  fail('start needs "project" (a folder in the case) or "example" (a folder in examples/).');
}

function parseChecks(raw: unknown, fail: (m: string) => never): DocumentCheck[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail("checks must be a list.");
  return (raw as unknown[]).map((c, i): DocumentCheck => {
    const where = `checks[${i}]`;
    if (!isRecord(c)) fail(`${where} must be an object with a kind.`);
    const strings = (v: unknown, field: string): string[] | undefined => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v) || !v.every((s) => typeof s === "string"))
        fail(`${where}.${field} must be a list of text.`);
      return v as string[];
    };
    switch (c.kind) {
      case "unchanged":
        return {
          kind: "unchanged",
          description: String(c.description ?? "The document is unchanged"),
        };
      case "interface": {
        if (typeof c.component !== "string") fail(`${where}.component must name a component id.`);
        const check: DocumentCheck = {
          kind: "interface",
          component: c.component as string,
          description: String(c.description ?? `Component ${c.component}'s interface is as asked`),
        };
        const without = strings(c.without, "without");
        const outputs = strings(c.outputs, "outputs");
        const inputs = strings(c.inputs, "inputs");
        if (without) check.without = without;
        if (outputs) check.outputs = outputs;
        if (inputs) check.inputs = inputs;
        if (!without && !outputs && !inputs) fail(`${where} needs without, outputs or inputs.`);
        return check;
      }
      case "keepsIds": {
        if (c.component !== undefined && typeof c.component !== "string")
          fail(`${where}.component must name a component id.`);
        return {
          kind: "keepsIds",
          description: String(c.description ?? "Rebuilt items keep their ids"),
          ...(typeof c.component === "string" ? { component: c.component } : {}),
        };
      }
      case "presets": {
        const presets = c.presets;
        if (
          !Array.isArray(presets) ||
          !presets.length ||
          !presets.every((p) => isRecord(p) && typeof p.name === "string")
        )
          fail(
            `${where}.presets must list presets like { "name": "Shipped app", "locked": true }.`,
          );
        return {
          kind: "presets",
          description: String(c.description ?? "The knob presets exist"),
          presets: (presets as { name: string; locked?: unknown }[]).map((p) => ({
            name: p.name,
            ...(typeof p.locked === "boolean" ? { locked: p.locked } : {}),
          })),
        };
      }
      default:
        fail(`${where}.kind must be unchanged, interface, keepsIds or presets.`);
    }
  });
}

function parseAnswer(raw: unknown, fail: (m: string) => never): AnswerCheck | undefined {
  if (raw === undefined) return undefined;
  const mentions = isRecord(raw) ? raw.mentions : undefined;
  if (
    !Array.isArray(mentions) ||
    !mentions.length ||
    !mentions.every((g) => Array.isArray(g) && g.length && g.every((w) => typeof w === "string"))
  )
    fail('answer.mentions must be groups of words, like [["tap"], ["grow", "bigger"]].');
  return { mentions: mentions as string[][] };
}

function parseBudget(raw: unknown, fail: (m: string) => never): EvalCase["budget"] {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail("budget must be { maxTurns, timeoutSec }.");
  const budget: EvalCase["budget"] = {};
  for (const key of ["maxTurns", "timeoutSec"] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0)
      fail(`budget.${key} must be a whole number above 0.`);
    budget[key] = v;
  }
  return budget;
}

/** Read and validate evals/cases/<id>. Throws CaseFormatError naming the first problem. */
export function loadCase(dir: string): EvalCase {
  const id = path.basename(dir);
  const source = `evals/cases/${id}`;
  const fail = (message: string): never => {
    throw new CaseFormatError(source, message);
  };
  const casePath = path.join(dir, "case.json");
  if (!existsSync(casePath)) fail("there's no case.json.");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(casePath, "utf8"));
  } catch (err) {
    fail(`case.json isn't valid JSON: ${(err as Error).message}`);
  }
  if (!isRecord(raw)) fail("case.json must hold an object.");
  const json = raw as Record<string, unknown>;
  for (const key of Object.keys(json))
    if (!CASE_FIELDS.includes(key))
      fail(`case.json has an unknown field "${key}". Fields: ${CASE_FIELDS.join(", ")}.`);
  if (typeof json.title !== "string" || !json.title.trim()) fail("title must be text.");
  if (json.about !== undefined && typeof json.about !== "string") fail("about must be text.");
  if (
    json.tags !== undefined &&
    (!Array.isArray(json.tags) || !json.tags.every((t) => typeof t === "string"))
  )
    fail("tags must be a list of text.");

  const promptPath = path.join(dir, "prompt.md");
  if (!existsSync(promptPath)) fail("there's no prompt.md.");
  const prompt = readFileSync(promptPath, "utf8").trim();
  if (!prompt) fail("prompt.md is empty.");

  const start = parseStart(json.start, dir, fail);

  let test: ExampleTest | undefined;
  try {
    const scenarios: Scenario[] = [];
    let description = "";
    if (json.test !== undefined) {
      if (!isRecord(json.test) || typeof json.test.example !== "string")
        fail('test must be { "example": "<folder>" } (its layer expectations), or left out.');
      const fromExample = readExampleTest((json.test as { example: string }).example, source);
      scenarios.push(...fromExample.scenarios);
      description = fromExample.description;
    }
    const testPath = path.join(dir, "test.json");
    if (existsSync(testPath)) {
      const own = parseExampleTest(
        JSON.parse(readFileSync(testPath, "utf8")),
        `${source}/test.json`,
      );
      for (const s of own.scenarios)
        for (const e of s.expect)
          if (!e.target.startsWith("@"))
            fail(
              `test.json scenario "${s.name}" reads "${e.target}". Evals check layer properties only ("@layer.prop"), so Claude's own patch ids don't matter.`,
            );
      scenarios.push(...own.scenarios);
      description = description ? `${own.description} ${description}` : own.description;
    }
    const names = new Set<string>();
    for (const s of scenarios) {
      if (names.has(s.name)) fail(`two scenarios are named "${s.name}".`);
      names.add(s.name);
    }
    if (scenarios.length) test = { description, scenarios };
  } catch (err) {
    if (err instanceof ExampleTestFormatError) throw new CaseFormatError(source, err.message);
    throw err;
  }

  const checks = parseChecks(json.checks, fail);
  const answer = parseAnswer(json.answer, fail);
  if (!test && !checks.length && !answer)
    fail("the case checks nothing: add a test.json, checks, or answer.");

  if (json.allowErrorDiagnostics !== undefined && typeof json.allowErrorDiagnostics !== "boolean")
    fail("allowErrorDiagnostics must be true or false.");
  if (json.examples !== undefined && typeof json.examples !== "boolean")
    fail("examples must be true or false.");
  let serve: string | undefined;
  if (json.serve !== undefined) {
    if (typeof json.serve !== "string" || !existsSync(path.join(dir, json.serve)))
      fail("serve must name a file in the case folder.");
    serve = json.serve as string;
  }
  if (prompt.includes("{{url}}") !== (serve !== undefined))
    fail(
      serve
        ? "prompt.md must say where the served file is with {{url}}."
        : "prompt.md uses {{url}}, but serve names no file.",
    );

  const solutionPath = path.join(dir, "solution.json");
  const evalCase: EvalCase = {
    id,
    dir,
    title: json.title as string,
    tags: (json.tags as string[] | undefined) ?? [],
    prompt,
    start,
    checks,
    allowErrorDiagnostics: json.allowErrorDiagnostics === true,
    budget: parseBudget(json.budget, fail),
    hideExamples: typeof json.examples === "boolean" ? !json.examples : start.kind === "example",
  };
  if (typeof json.about === "string") evalCase.about = json.about;
  if (test) evalCase.test = test;
  if (answer) evalCase.answer = answer;
  if (serve) evalCase.serve = serve;
  if (existsSync(solutionPath)) evalCase.solution = solutionPath;
  return evalCase;
}

/** Case folders (those holding case.json), sorted. */
export function listCaseIds(dir: string = CASES_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, "case.json")))
    .map((e) => e.name)
    .sort();
}

/**
 * Cases matching the filters: an exact id, or a prefix ending in "*" ("example-*"). No filters
 * means every case. Throws when a filter matches nothing.
 */
export function selectCaseIds(ids: readonly string[], filters: readonly string[]): string[] {
  if (!filters.length) return [...ids];
  const picked = new Set<string>();
  for (const filter of filters) {
    const matches = filter.endsWith("*")
      ? ids.filter((id) => id.startsWith(filter.slice(0, -1)))
      : ids.filter((id) => id === filter);
    if (!matches.length) {
      const near = ids.filter((id) => id.includes(filter.replace(/\*$/, ""))).slice(0, 5);
      throw new Error(
        `No case matches "${filter}".${near.length ? ` Did you mean ${near.join(", ")}?` : ""} List them with --list.`,
      );
    }
    for (const id of matches) picked.add(id);
  }
  return ids.filter((id) => picked.has(id));
}

function apply(
  doc: SonobeDocument,
  ops: readonly Op[],
  registry: Registry,
  what: string,
): SonobeDocument {
  if (!ops.length) return doc;
  const r = applyOps(doc, ops, { registry });
  if (r.ok) return r.doc;
  throw new Error(
    `${what} failed: ${r.errors.map((e) => `${e.message}${e.hint ? ` ${e.hint}` : ""}`).join("; ")}`,
  );
}

/**
 * An example's layers without its patches, built from its recipe (no notes, no example link). An
 * example that starts from a design import gets the import first, as the recipe's ops find it: its
 * layers, its assets, and the patches the import makes itself (a Scroll for content that scrolls).
 */
export async function exampleLayersDocument(
  example: string,
  registry: Registry,
): Promise<SonobeDocument> {
  const recipe = RECIPES.find((r) => r.folder === example);
  if (!recipe) throw new Error(`examples/${example} has no recipe.`);
  const empty = createEmptyDocument({ name: recipe.name, device: DEFAULT_DEVICE });
  const setup: Op[] = [{ op: "setProject", changes: { background: recipe.background } }];
  const { doc } = await importRecipeDesign(
    recipe,
    apply(empty, setup, registry, `Setting up ${example}`),
    registry,
  );
  const layers = recipe.ops().filter((op) => op.op === "addLayer");
  return apply(doc, layers, registry, `Building the layers of ${example}`);
}

/** The ops an example's recipe adds on top of its layers: the reference answer for a patches-removed start. */
export function exampleSolutionOps(example: string): Op[] {
  const recipe = RECIPES.find((r) => r.folder === example);
  if (!recipe) throw new Error(`examples/${example} has no recipe.`);
  return recipe.ops().filter((op) => op.op !== "addLayer");
}

/** The document a case starts from. */
export async function buildStartDocument(
  evalCase: EvalCase,
  registry: Registry,
): Promise<SonobeDocument> {
  const { start } = evalCase;
  let doc: SonobeDocument;
  if (start.kind === "project") doc = await loadProjectFromDisk(start.dir);
  else if (start.patches) doc = await loadProjectFromDisk(path.join(EXAMPLES_DIR, start.example));
  else doc = await exampleLayersDocument(start.example, registry);
  return apply(doc, start.ops, registry, `${evalCase.id}: start.ops`);
}

/**
 * Save a case's start document as a project folder, with the asset files its records name copied
 * from the start project or the example (saveProjectToDisk writes the document and assets.json
 * only). Asset files are named by their bytes' hash, so an example's layers built from its design
 * import find theirs in the example's folder.
 */
export async function writeStartProject(
  evalCase: EvalCase,
  doc: SonobeDocument,
  dir: string,
): Promise<void> {
  await saveProjectToDisk(dir, doc);
  const { start } = evalCase;
  const from = path.join(
    start.kind === "project" ? start.dir : path.join(EXAMPLES_DIR, start.example),
    "assets",
  );
  const files = new Set(Object.values(doc.assets).map((asset) => asset.file));
  if (files.size) await mkdir(path.join(dir, "assets"), { recursive: true });
  for (const file of files)
    if (existsSync(path.join(from, file)))
      await copyFile(path.join(from, file), path.join(dir, "assets", file));
}

/** The prompt with {{url}} filled in. */
export function renderPrompt(evalCase: EvalCase, vars: { url?: string } = {}): string {
  return evalCase.prompt.replaceAll("{{url}}", vars.url ?? "{{url}}");
}
