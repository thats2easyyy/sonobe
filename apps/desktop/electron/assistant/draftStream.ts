/**
 * Live drafts of import_design's html. While Claude writes an import_design call, its input streams
 * as input_json_delta chunks; this decodes the top-level "html" string and the small fields from the
 * partial JSON and emits them as design_draft events, so the canvas previews the page before the tool
 * runs. Pure and Electron-free.
 */

import type { BetaMessage, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AssistantDesignFields, AssistantEvent } from "./protocol.ts";

/** Decodes import_design's top-level "html" string and small fields from partial JSON, across chunk boundaries. Never throws. */
export interface JsonFieldStream {
  /** Feed the next partial_json chunk; returns the html text decoded from it (never ending in a lone high surrogate) and whether a field changed. */
  push(chunk: string): { html: string; fieldsChanged: boolean };
  readonly fields: AssistantDesignFields;
  readonly htmlLength: number;
  readonly htmlDone: boolean;
}

export function createJsonFieldStream(): JsonFieldStream {
  throw new Error("not implemented");
}

export interface DraftStreams {
  onEvent(event: BetaRawMessageStreamEvent): void;
  /** After finalMessage: a done event (offset 0, append "", html: input.html) for import_design blocks with html that never emitted done. */
  finish(message: BetaMessage): void;
}

export function createDraftStreams(_options: { runId: string; turn: number; emit(event: AssistantEvent): void; now?: () => number; intervalMs?: number /* default 50 */ }): DraftStreams {
  throw new Error("not implemented");
}
