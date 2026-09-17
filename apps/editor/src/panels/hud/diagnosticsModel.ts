/** Diagnostics tab helpers: merging document and runtime problems, severity filters, and applying fixes. */

import type { ApplyOpsResult, Author, Diagnostic, Op, Severity, Suggestion } from "@sonobe/core";
import type { DocumentStore } from "../../state/document.ts";

export type DiagnosticSource = "document" | "runtime";

export interface HudDiagnostic extends Diagnostic {
  /** Stable identity for React keys and dedupe. */
  key: string;
  source: DiagnosticSource;
}

export type SeverityFilter = Record<Severity, boolean>;

export const SEVERITIES: readonly Severity[] = ["error", "warning", "info"];

export const ALL_SEVERITIES: SeverityFilter = { error: true, warning: true, info: true };

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function diagnosticKey(d: Diagnostic): string {
  return `${d.severity}|${d.code}|${d.component}|${d.itemIds.join(",")}|${d.port ?? ""}|${d.message}`;
}

/**
 * Document diagnostics followed by runtime issues, ordered by severity (stable within a severity).
 * A runtime issue is dropped when a document diagnostic already reports the same code for (at least)
 * the same items, since the document's message carries the suggestions.
 */
export function mergeDiagnostics(documentDiagnostics: readonly Diagnostic[], runtimeDiagnostics: readonly Diagnostic[] = []): HudDiagnostic[] {
  const seen = new Set<string>();
  const out: HudDiagnostic[] = [];
  const add = (d: Diagnostic, source: DiagnosticSource) => {
    const key = diagnosticKey(d);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...d, key, source });
  };
  const coveredByDocument = (d: Diagnostic) => d.itemIds.length > 0 && documentDiagnostics.some((x) => x.code === d.code && x.component === d.component && d.itemIds.every((id) => x.itemIds.includes(id)));
  for (const d of documentDiagnostics) add(d, "document");
  for (const d of runtimeDiagnostics) if (!coveredByDocument(d)) add(d, "runtime");
  return out
    .map((d, index) => ({ d, index }))
    .sort((a, b) => SEVERITY_RANK[a.d.severity] - SEVERITY_RANK[b.d.severity] || a.index - b.index)
    .map(({ d }) => d);
}

export function filterDiagnostics<T extends Diagnostic>(list: readonly T[], filter: SeverityFilter): T[] {
  return list.filter((d) => filter[d.severity]);
}

export function countBySeverity(list: readonly Diagnostic[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const d of list) counts[d.severity]++;
  return counts;
}

export type FixSuggestion = Suggestion & { ops: Op[] };

/** Suggestions that can be applied as ops. */
export function fixableSuggestions(d: Pick<Diagnostic, "suggestions">): FixSuggestion[] {
  return (d.suggestions ?? []).filter((s): s is FixSuggestion => Array.isArray(s.ops) && s.ops.length > 0);
}

/** Suggestions that are advice only (no ops). */
export function adviceSuggestions(d: Pick<Diagnostic, "suggestions">): Suggestion[] {
  return (d.suggestions ?? []).filter((s) => !s.ops || s.ops.length === 0);
}

/** A short history label for a fix: "Insert a Switch: each pulse…" → "Insert a Switch". */
export function fixLabel(suggestion: Pick<Suggestion, "description">): string {
  const head = suggestion.description.split(/[:.](?:\s|$)/, 1)[0]?.trim() ?? "";
  const label = head || suggestion.description.trim() || "Apply fix";
  return label.length > 64 ? `${label.slice(0, 63)}…` : label;
}

export interface FixOutcome {
  ok: boolean;
  /** History label used for the change. */
  label: string;
  /** Human-first reason when the fix couldn't be applied. */
  message?: string;
  result: ApplyOpsResult;
}

/**
 * Apply a diagnostic's suggestion as one undoable change. Ops without a component target the
 * diagnostic's component. The document is untouched when any op fails.
 */
export function applyDiagnosticFix(document: DocumentStore, diagnostic: Pick<Diagnostic, "component">, suggestion: FixSuggestion, author?: Author): FixOutcome {
  const label = fixLabel(suggestion);
  const result = document.getState().apply(suggestion.ops, {
    label,
    defaultComponent: diagnostic.component,
    ...(author ? { author } : {}),
  });
  if (result.ok) return { ok: true, label, result };
  const error = result.errors[0];
  const message = error ? (error.hint ? `${error.message} ${error.hint}` : error.message) : "The document changed, so this fix no longer applies.";
  return { ok: false, label, message, result };
}
