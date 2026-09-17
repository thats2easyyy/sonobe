/**
 * Tool results: concise text for the model plus structuredContent, and teaching errors
 * ({ code, message, hint, suggestions with ready ops, changed }). Browser-safe.
 */

import type { SonobeError, Suggestion } from "@sonobe/core";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { isHostError } from "./host.ts";

export interface TeachingError {
  code: string;
  message: string;
  hint?: string;
  suggestions?: Suggestion[];
  /** Whether anything in the document changed. */
  changed?: "none" | "partial" | "all";
  address?: string;
  opIndex?: number;
  data?: Record<string, unknown>;
}

/** A successful result. */
export function success(text: string, structured?: Record<string, unknown>): CallToolResult {
  const result: CallToolResult = { content: [{ type: "text", text }] };
  if (structured !== undefined) result.structuredContent = structured;
  return result;
}

/**
 * Put the complete teaching text into structuredContent as its first field, `text`. Some clients
 * (Claude Code) give the model only structuredContent when a result has it, so metadata alone
 * would hide the outline, guide or trace the text carries. Results without structuredContent
 * (images, plain text) pass through unchanged.
 */
export function withCompleteText(result: CallToolResult): CallToolResult {
  const structured = result.structuredContent;
  if (structured === undefined || structured === null || typeof structured !== "object")
    return result;
  const text = (result.content ?? [])
    .map((c) => (c.type === "text" ? c.text : ""))
    .filter(Boolean)
    .join("\n");
  if (!text) return result;
  const { text: _previous, ...rest } = structured as Record<string, unknown>;
  return { ...result, structuredContent: { text, ...rest } };
}

/** Suggestions as numbered lines with compact ops JSON. */
export function formatSuggestions(
  suggestions: readonly Suggestion[] | undefined,
  indent = "",
): string[] {
  if (!suggestions?.length) return [];
  const lines = [`${indent}Suggestions:`];
  suggestions.forEach((s, i) => {
    lines.push(`${indent}  ${i + 1}. ${s.description}`);
    if (s.ops?.length) lines.push(`${indent}     ops: ${JSON.stringify(s.ops)}`);
  });
  return lines;
}

/** One core error as teaching text. */
export function formatSonobeError(error: SonobeError | TeachingError, indent = ""): string[] {
  const where = [error.opIndex !== undefined ? `op ${error.opIndex}` : "", error.address ?? ""]
    .filter(Boolean)
    .join(", ");
  const lines = [`${indent}Error ${error.code}${where ? ` (${where})` : ""}: ${error.message}`];
  if (error.hint) lines.push(`${indent}Hint: ${error.hint}`);
  lines.push(...formatSuggestions(error.suggestions, indent));
  return lines;
}

/** An isError result that teaches the fix. */
export function failure(error: TeachingError): CallToolResult {
  const changed = error.changed ?? "none";
  const lines = formatSonobeError(error);
  if (changed === "none") lines.push("Nothing changed.");
  const structured: Record<string, unknown> = {
    ok: false,
    changed,
    error: {
      code: error.code,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.address ? { address: error.address } : {}),
      ...(error.opIndex !== undefined ? { opIndex: error.opIndex } : {}),
      suggestions: error.suggestions ?? [],
    },
  };
  if (error.data) Object.assign(structured, error.data);
  return {
    isError: true,
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: structured,
  };
}

/** Convert anything thrown by a host or tool into a teaching error result. */
export function failureFromThrown(err: unknown): CallToolResult {
  if (isHostError(err))
    return failure({
      code: err.code,
      message: err.message,
      ...(err.hint ? { hint: err.hint } : {}),
      suggestions: err.suggestions,
      ...(err.data ? { data: err.data } : {}),
    });
  const message = err instanceof Error ? err.message : String(err);
  return failure({
    code: "internal",
    message: `Sonobe hit an unexpected error: ${message}`,
    hint: "This is a bug in Sonobe. The document wasn't changed by this call; try a different approach or report it.",
  });
}

/** Wrap a tool handler so thrown errors become teaching results. */
export function guarded<A extends unknown[]>(
  handler: (...args: A) => Promise<CallToolResult> | CallToolResult,
): (...args: A) => Promise<CallToolResult> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      return failureFromThrown(err);
    }
  };
}
