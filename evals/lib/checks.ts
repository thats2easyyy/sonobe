/**
 * Checking a finished project against its case: the case's scenarios run through the headless host
 * (examples/lib/scenarios.ts, the same runner as the examples), then the document and answer checks.
 */

import { serializeDocument, type Component, type SonobeDocument } from "@sonobe/core";
import type { EngineRegistry } from "@sonobe/engine";
import { createHeadlessHost } from "@sonobe/mcp";
import {
  runScenario,
  type ExpectationResult,
  type Scenario,
  type ScenarioReport,
} from "../../examples/lib/scenarios.ts";
import type { AnswerCheck, DocumentCheck, EvalCase } from "./cases.ts";

export interface CheckResult {
  description: string;
  pass: boolean;
  detail: string;
}

export interface CheckReport {
  pass: boolean;
  scenarios: ScenarioReport[];
  document: CheckResult[];
  answer: CheckResult[];
  diagnostics: { errors: number; warnings: number; codes: string[] };
  /** Expectations and checks met, out of all of them. */
  score: { passed: number; total: number };
  /** Why the project couldn't be checked at all (it doesn't open). */
  error?: string;
}

export interface CheckOptions {
  registry: EngineRegistry;
  /** The document the run started from (for unchanged and keepsIds). */
  startDoc: SonobeDocument;
  /** Claude's final reply. */
  answer?: string;
  /** Check the reply (default true; false when checking a project by hand). */
  checkAnswer?: boolean;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A scenario that couldn't run (a target layer is gone, a preset doesn't exist): every expectation fails with the reason. */
export function failedScenario(scenario: Scenario, err: unknown): ScenarioReport {
  const why = `The scenario couldn't run: ${message(err)}`;
  return {
    name: scenario.name,
    pass: false,
    results: scenario.expect.map((e): ExpectationResult => ({
      description: e.description,
      pass: false,
      detail: why,
    })),
    warnings: [],
    issues: [],
  };
}

/** Every item id in a component: layers (nested), patches and comments. */
export function itemIds(component: Component): Set<string> {
  const ids = new Set<string>();
  const walk = (layers: Component["layers"]) => {
    for (const layer of layers) {
      ids.add(layer.id);
      if (layer.children) walk(layer.children);
    }
  };
  walk(component.layers);
  for (const id of Object.keys(component.patches)) ids.add(id);
  for (const c of component.comments) ids.add(c.id);
  return ids;
}

/**
 * Ids that look like a rebuilt item's numbered copy: new since the start, "<id>_<n>" where <id> was
 * in the start and is gone now. That's what removing an item in one batch and adding it back in
 * another leaves (the removed id is retired).
 */
export function suffixedRebuilds(
  start: Component | undefined,
  final: Component | undefined,
): string[] {
  if (!start || !final) return [];
  const before = itemIds(start);
  const after = itemIds(final);
  const found: string[] = [];
  for (const id of after) {
    if (before.has(id)) continue;
    const m = /^(.+)_(\d+)$/.exec(id);
    if (m && before.has(m[1]!) && !after.has(m[1]!)) found.push(`${id} (rebuilt ${m[1]})`);
  }
  return found.sort();
}

const names = (ports: Record<string, { name: string }>) =>
  Object.values(ports)
    .map((p) => p.name.trim().toLowerCase())
    .sort();
const quoted = (list: readonly string[]) =>
  list.length ? list.map((s) => `"${s}"`).join(", ") : "none";

/** Check one document fact. */
export function checkDocument(
  check: DocumentCheck,
  doc: SonobeDocument,
  startDoc: SonobeDocument,
): CheckResult {
  const { description } = check;
  switch (check.kind) {
    case "unchanged": {
      const before = serializeDocument(startDoc);
      const after = serializeDocument(doc);
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((f) => before[f] !== after[f])
        .sort();
      return {
        description,
        pass: !changed.length,
        detail: changed.length ? `Changed: ${changed.join(", ")}` : "No file changed",
      };
    }
    case "interface": {
      const component = doc.components[check.component];
      if (!component)
        return {
          description,
          pass: false,
          detail: `There's no component "${check.component}" any more.`,
        };
      const problems: string[] = [];
      const keys = [
        ...Object.keys(component.interface.inputs),
        ...Object.keys(component.interface.outputs),
      ];
      const stale = (check.without ?? []).filter((k) => keys.includes(k));
      if (stale.length) problems.push(`still has ${quoted(stale)}`);
      for (const side of ["inputs", "outputs"] as const) {
        const wanted = check[side];
        if (!wanted) continue;
        const have = names(component.interface[side]);
        const want = wanted.map((w) => w.trim().toLowerCase()).sort();
        if (have.join("\n") !== want.join("\n"))
          problems.push(`${side} are ${quoted(have)} (wanted ${quoted(want)})`);
      }
      return {
        description,
        pass: !problems.length,
        detail: problems.length
          ? `${check.component} ${problems.join("; ")}`
          : `${check.component}: inputs ${quoted(names(component.interface.inputs))}, outputs ${quoted(names(component.interface.outputs))}`,
      };
    }
    case "keepsIds": {
      const ids = check.component ? [check.component] : Object.keys(startDoc.components);
      const found = ids.flatMap((id) =>
        suffixedRebuilds(startDoc.components[id], doc.components[id]),
      );
      return {
        description,
        pass: !found.length,
        detail: found.length
          ? `Numbered copies of removed ids: ${found.join(", ")}`
          : "No rebuilt item got a numbered id",
      };
    }
    case "presets": {
      const presets = doc.knobs?.presets ?? [];
      const problems: string[] = [];
      for (const want of check.presets) {
        const preset = presets.find(
          (p) => p.name.trim().toLowerCase() === want.name.trim().toLowerCase(),
        );
        if (!preset) problems.push(`no preset "${want.name}"`);
        else if (want.locked !== undefined && (preset.locked === true) !== want.locked)
          problems.push(`"${preset.name}" is ${preset.locked ? "locked" : "not locked"}`);
      }
      return {
        description,
        pass: !problems.length,
        detail: problems.length
          ? `${problems.join("; ")} (presets: ${quoted(presets.map((p) => `${p.name}${p.locked ? " (locked)" : ""}`))})`
          : `Presets: ${quoted(presets.map((p) => `${p.name}${p.locked ? " (locked)" : ""}`))}`,
      };
    }
  }
}

/** Check the final reply: one word from every group. */
export function checkAnswer(check: AnswerCheck, answer: string | undefined): CheckResult[] {
  const text = (answer ?? "").toLowerCase();
  return check.mentions.map((group) => {
    const hit = group.find((w) => text.includes(w.toLowerCase()));
    const description =
      group.length === 1
        ? `The reply mentions "${group[0]}"`
        : `The reply mentions one of ${quoted(group)}`;
    return {
      description,
      pass: hit !== undefined,
      detail:
        hit !== undefined
          ? `Mentions "${hit}"`
          : text
            ? "Mentions none of them"
            : "There was no reply",
    };
  });
}

/** Run a case's checks on a finished project folder. */
export async function checkProject(
  evalCase: EvalCase,
  projectDir: string,
  options: CheckOptions,
): Promise<CheckReport> {
  const report: CheckReport = {
    pass: false,
    scenarios: [],
    document: [],
    answer: [],
    diagnostics: { errors: 0, warnings: 0, codes: [] },
    score: { passed: 0, total: 0 },
  };
  const host = createHeadlessHost({ registry: options.registry, maxSimSessions: 2 });
  try {
    let docId: string;
    try {
      docId = (await host.openDocument(projectDir)).docId;
    } catch (err) {
      report.error = `The project doesn't open: ${message(err)}`;
      return report;
    }
    const { doc } = await host.getDocument(docId);
    const { diagnostics } = await host.diagnostics(docId);
    const errors = diagnostics.filter((d) => d.severity === "error");
    report.diagnostics = {
      errors: errors.length,
      warnings: diagnostics.filter((d) => d.severity === "warning").length,
      codes: [
        ...new Set(diagnostics.filter((d) => d.severity !== "info").map((d) => d.code)),
      ].sort(),
    };
    if (!evalCase.allowErrorDiagnostics)
      report.document.push({
        description: "The document has no error diagnostics",
        pass: !errors.length,
        detail: errors.length
          ? errors.map((d) => `${d.code}: ${d.message}`).join("; ")
          : "No errors",
      });
    for (const check of evalCase.checks)
      report.document.push(checkDocument(check, doc, options.startDoc));
    for (const scenario of evalCase.test?.scenarios ?? []) {
      try {
        report.scenarios.push(await runScenario(host, docId, scenario));
      } catch (err) {
        report.scenarios.push(failedScenario(scenario, err));
      }
    }
    if (evalCase.answer && options.checkAnswer !== false)
      report.answer = checkAnswer(evalCase.answer, options.answer);
  } finally {
    await host.close();
  }
  const all = [...report.scenarios.flatMap((s) => s.results), ...report.document, ...report.answer];
  report.score = { passed: all.filter((r) => r.pass).length, total: all.length };
  report.pass =
    report.scenarios.every((s) => s.pass) &&
    report.document.every((c) => c.pass) &&
    report.answer.every((c) => c.pass);
  return report;
}

/** The failed lines of a report, for summaries: "scenario › expectation: detail". */
export function failureLines(report: CheckReport): string[] {
  if (report.error) return [report.error];
  const lines: string[] = [];
  for (const s of report.scenarios) {
    for (const r of s.results) if (!r.pass) lines.push(`${s.name} › ${r.description}: ${r.detail}`);
    for (const w of s.warnings) lines.push(`${s.name}: ${w}`);
    for (const i of s.issues) lines.push(`${s.name}: ${i.severity} ${i.code}: ${i.message}`);
  }
  for (const c of [...report.document, ...report.answer])
    if (!c.pass) lines.push(`${c.description}: ${c.detail}`);
  return lines;
}
