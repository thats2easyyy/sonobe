/**
 * Live drafts of import_design's html. While Claude writes an import_design call, its input streams
 * as input_json_delta chunks; this decodes the top-level "html" string and the small fields from the
 * partial JSON and emits them as design_draft events, so the canvas previews the page before the tool
 * runs. Pure and Electron-free.
 */

import type { BetaMessage, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AssistantDesignFields, AssistantEvent } from "./protocol.ts";

/** The tool whose html streams to the canvas. */
const DESIGN_TOOL = "import_design";

/** Decodes import_design's top-level "html" string and small fields from partial JSON, across chunk boundaries. Never throws. */
export interface JsonFieldStream {
  /** Feed the next partial_json chunk; returns the html text decoded from it (never ending in a lone high surrogate) and whether a field changed. */
  push(chunk: string): { html: string; fieldsChanged: boolean };
  readonly fields: AssistantDesignFields;
  readonly htmlLength: number;
  readonly htmlDone: boolean;
}

type FieldKey = keyof AssistantDesignFields;
const FIELD_KEYS: ReadonlySet<string> = new Set<FieldKey>(["name", "replace", "component", "width", "height", "position"]);

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

const isSpace = (ch: string) => ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A field's value when it has the type the preview reads (strings; finite numbers; a two-number position). */
function fieldValue(key: FieldKey, value: unknown): AssistantDesignFields[FieldKey] | undefined {
  if (key === "position") return Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]) ? [value[0], value[1]] : undefined;
  if (key === "width" || key === "height") return finite(value) ? value : undefined;
  return typeof value === "string" ? value : undefined;
}

const sameValue = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b);

/** The fields of a whole import_design input. */
function designFields(input: Record<string, unknown>): AssistantDesignFields {
  const out: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    const value = fieldValue(key as FieldKey, input[key]);
    if (value !== undefined) out[key] = value;
  }
  return out as AssistantDesignFields;
}

type State =
  /** Before the opening brace. */
  | "open"
  /** After "{": a key or "}". */
  | "first_key"
  /** After ",": a key. */
  | "next_key"
  | "key"
  | "colon"
  | "value"
  | "html"
  /** Any other value, scanned to its end (and kept when it's a field). */
  | "raw"
  | "after_value"
  /** The object closed. */
  | "end"
  /** The input wasn't the JSON object expected: stop for good. */
  | "dead";

export function createJsonFieldStream(): JsonFieldStream {
  let state: State = "open";
  let fields: AssistantDesignFields = {};
  let htmlLength = 0;
  let htmlDone = false;
  let sawHtml = false;

  // The key being read: its raw text (escapes included) and whether the last character was a backslash.
  let keyText = "";
  let keyEscaped = false;
  let key = "";

  // html: an escape in progress ("\\" after a backslash, "u" while reading hex digits), and a high
  // surrogate held back until the low one arrives.
  let escape: "" | "\\" | "u" = "";
  let hex = "";
  let heldSurrogate = "";

  // A non-html value: its text when it's a field, its shape, and where the scan is inside it.
  let rawText = "";
  let rawKeep = false;
  let rawKind: "string" | "container" | "scalar" = "scalar";
  let rawDepth = 0;
  let rawInString = false;
  let rawEscaped = false;

  const setField = (name: FieldKey, value: unknown): boolean => {
    const next = fieldValue(name, value);
    if (sameValue(fields[name], next)) return false;
    const copy: Record<string, unknown> = { ...fields };
    if (next === undefined) delete copy[name];
    else copy[name] = next;
    fields = copy as AssistantDesignFields;
    return true;
  };

  return {
    get fields() {
      return fields;
    },
    get htmlLength() {
      return htmlLength;
    },
    get htmlDone() {
      return htmlDone;
    },
    push(chunk) {
      if (state === "dead" || typeof chunk !== "string") return { html: "", fieldsChanged: false };
      const out: string[] = [];
      if (heldSurrogate) {
        out.push(heldSurrogate);
        heldSurrogate = "";
      }
      let fieldsChanged = false;
      // The current non-html value ended: parse it when it's a field.
      const endRaw = () => {
        state = "after_value";
        if (!rawKeep) return;
        let value: unknown;
        try {
          value = JSON.parse(rawText);
        } catch {
          state = "dead";
          return;
        }
        if (setField(key as FieldKey, value)) fieldsChanged = true;
      };

      let i = 0;
      while (i < chunk.length && state !== "dead") {
        const ch = chunk[i]!;
        switch (state) {
          case "open":
            if (ch === "{") state = "first_key";
            else if (!isSpace(ch)) state = "dead";
            i++;
            break;
          case "first_key":
          case "next_key":
            if (ch === '"') {
              state = "key";
              keyText = "";
              keyEscaped = false;
            } else if (ch === "}" && state === "first_key") state = "end";
            else if (!isSpace(ch)) state = "dead";
            i++;
            break;
          case "key":
            if (keyEscaped) keyEscaped = false;
            else if (ch === "\\") keyEscaped = true;
            else if (ch === '"') {
              try {
                key = JSON.parse(`"${keyText}"`) as string;
                state = "colon";
              } catch {
                state = "dead";
              }
              i++;
              break;
            }
            keyText += ch;
            i++;
            break;
          case "colon":
            if (ch === ":") state = "value";
            else if (!isSpace(ch)) state = "dead";
            i++;
            break;
          case "value":
            if (isSpace(ch)) {
              i++;
              break;
            }
            // The first top-level html string streams; a second one is scanned past like any other value.
            if (key === "html" && ch === '"' && !sawHtml) {
              sawHtml = true;
              state = "html";
              i++;
              break;
            }
            state = "raw";
            rawKeep = FIELD_KEYS.has(key);
            rawText = "";
            rawKind = ch === '"' ? "string" : ch === "{" || ch === "[" ? "container" : "scalar";
            rawDepth = 0;
            rawInString = false;
            rawEscaped = false;
            break; // the raw scan reads this character
          case "raw": {
            if (rawKind === "scalar") {
              if (ch === "," || ch === "}" || isSpace(ch)) {
                endRaw();
                break; // after_value reads the delimiter
              }
              if (rawKeep) rawText += ch;
              i++;
              break;
            }
            if (rawKeep) rawText += ch;
            i++;
            if (rawInString) {
              if (rawEscaped) rawEscaped = false;
              else if (ch === "\\") rawEscaped = true;
              else if (ch === '"') {
                rawInString = false;
                if (rawKind === "string") endRaw();
              }
            } else if (ch === '"') rawInString = true;
            else if (ch === "{" || ch === "[") rawDepth++;
            else if (ch === "}" || ch === "]") {
              rawDepth--;
              if (rawDepth <= 0) endRaw();
            }
            break;
          }
          case "html": {
            if (escape === "\\") {
              escape = "";
              if (ch === "u") {
                escape = "u";
                hex = "";
              } else if (ESCAPES[ch] !== undefined) out.push(ESCAPES[ch]);
              else state = "dead";
              i++;
              break;
            }
            if (escape === "u") {
              if (!/[0-9a-fA-F]/.test(ch)) {
                state = "dead";
                break;
              }
              hex += ch;
              i++;
              if (hex.length === 4) {
                out.push(String.fromCharCode(parseInt(hex, 16)));
                escape = "";
              }
              break;
            }
            // A run of plain characters up to the next backslash or quote.
            let j = i;
            while (j < chunk.length && chunk[j] !== "\\" && chunk[j] !== '"') j++;
            if (j > i) out.push(chunk.slice(i, j));
            i = j;
            if (i >= chunk.length) break;
            if (chunk[i] === "\\") escape = "\\";
            else {
              htmlDone = true;
              state = "after_value";
            }
            i++;
            break;
          }
          case "after_value":
            if (ch === ",") state = "next_key";
            else if (ch === "}") state = "end";
            else if (!isSpace(ch)) state = "dead";
            i++;
            break;
          case "end":
            i = chunk.length;
            break;
        }
      }

      let html = out.join("");
      if (!htmlDone && html && isHighSurrogate(html.charCodeAt(html.length - 1))) {
        // Held until its pair arrives; dropped when decoding stopped (finish() supplies the html).
        heldSurrogate = state === "dead" ? "" : html.slice(-1);
        html = html.slice(0, -1);
      }
      htmlLength += html.length;
      return { html, fieldsChanged };
    },
  };
}

export interface DraftStreams {
  onEvent(event: BetaRawMessageStreamEvent): void;
  /** After finalMessage: a done event (offset 0, append "", html: input.html) for import_design blocks with html that never emitted done. */
  finish(message: BetaMessage): void;
}

/** One import_design block while it streams. */
interface DraftBlock {
  toolUseId: string;
  stream: JsonFieldStream;
  /** Everything decoded so far. */
  html: string;
  /** Decoded but not sent yet. */
  pending: string;
  /** Code units already sent (the next append's offset). */
  sent: number;
  /** A field changed since the last event. */
  fieldsDirty: boolean;
  /** When the last event went out. */
  last: number;
}

export function createDraftStreams(options: { runId: string; turn: number; emit(event: AssistantEvent): void; now?: () => number; intervalMs?: number /* default 50 */ }): DraftStreams {
  const { runId, turn, emit } = options;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 50;
  /** Streaming import_design blocks, by content block index. */
  const blocks = new Map<number, DraftBlock>();
  /** Tool uses that emitted their done event. */
  const finished = new Set<string>();

  const send = (block: DraftBlock, at: number) => {
    emit({
      type: "design_draft",
      runId,
      turn,
      toolUseId: block.toolUseId,
      offset: block.sent,
      append: block.pending,
      ...(block.fieldsDirty ? { fields: { ...block.stream.fields } } : {}),
      done: false,
    });
    block.sent += block.pending.length;
    block.pending = "";
    block.fieldsDirty = false;
    block.last = at;
  };

  return {
    onEvent(event) {
      if (event.type === "content_block_start") {
        const b = event.content_block;
        if (b.type === "tool_use" && b.name === DESIGN_TOOL) {
          blocks.set(event.index, { toolUseId: b.id, stream: createJsonFieldStream(), html: "", pending: "", sent: 0, fieldsDirty: false, last: -Infinity });
        }
        return;
      }
      if (event.type === "content_block_delta") {
        if (event.delta.type !== "input_json_delta") return;
        const block = blocks.get(event.index);
        if (!block) return;
        const { html, fieldsChanged } = block.stream.push(event.delta.partial_json);
        if (html) {
          block.html += html;
          block.pending += html;
        }
        if (fieldsChanged) block.fieldsDirty = true;
        // Nothing goes out before the html does (a url or capture source never draws), and the first
        // html event carries the fields written before it.
        if (!block.html) return;
        const at = now();
        if (block.fieldsDirty || (block.pending && at - block.last >= intervalMs)) send(block, at);
        return;
      }
      if (event.type === "content_block_stop") {
        const block = blocks.get(event.index);
        if (!block) return;
        blocks.delete(event.index);
        // No html key (a url or capture source), or html the decoder gave up on: finish() has the input.
        if (!block.stream.htmlDone) return;
        finished.add(block.toolUseId);
        emit({ type: "design_draft", runId, turn, toolUseId: block.toolUseId, offset: block.sent, append: block.pending, fields: { ...block.stream.fields }, done: true, html: block.html });
      }
    },
    finish(message) {
      blocks.clear();
      for (const block of message.content) {
        if (block.type !== "tool_use" || block.name !== DESIGN_TOOL || finished.has(block.id)) continue;
        const input = block.input;
        if (!input || typeof input !== "object" || typeof (input as { html?: unknown }).html !== "string") continue;
        finished.add(block.id);
        const html = (input as { html: string }).html;
        emit({ type: "design_draft", runId, turn, toolUseId: block.id, offset: 0, append: "", fields: designFields(input as Record<string, unknown>), done: true, html });
      }
    },
  };
}
