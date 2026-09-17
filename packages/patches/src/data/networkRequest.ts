/** Network Request: loads JSON, text, or media from a URL on a pulse, reporting loading and errors. */

import type { Value } from "@sonobe/core";
import type { FetchFormField, FetchInit, FetchResponse, PatchContext } from "@sonobe/engine";
import { definePatch, isPlainObject, toBool, toText, zeroValue } from "../infra/index.ts";
import { stripBom, variantOf, warnIndexed } from "./shared.ts";

/** A request still loading after this many prototype seconds fails (unless Disable Timeout is on). */
export const REQUEST_TIMEOUT_SECONDS = 60;
/** Error Details keeps at most this much of a non-JSON error body. */
export const MAX_ERROR_BODY_LENGTH = 10_000;

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const UNREACHABLE_MESSAGE = "Couldn't reach the server. Check the URL and your connection, and that the server allows requests from prototypes (CORS).";
const MEDIA_VARIANTS = new Set(["image", "video", "sound"]);
const NDJSON_TYPES = new Set(["application/x-ndjson", "application/ndjson", "application/jsonl", "application/x-jsonlines"]);

/** How a streamed body splits into JSON records. */
export type StreamFormat = "ndjson" | "sse" | "multipart";

interface StreamProgress {
  text: string;
  /** Bumped on every chunk; `applied` is the version the result last showed. */
  version: number;
  applied: number;
}

interface Job {
  generation: number;
  startedAt: number;
  abort?: () => void;
  /** Set once the server answers (before the body finishes). */
  response: { ok: boolean; status: number; contentType: string } | null;
  /** Streamed text so far, for Stream requests that update Result as data arrives. */
  stream: StreamProgress | null;
}

type Outcome = { kind: "rejected"; reason: unknown } | { kind: "response"; ok: boolean; status: number; text: string; url: string; stream: boolean; contentType: string };

export interface NetworkRequestState {
  generation: number;
  job: Job | null;
  settled: Outcome | null;
  /** The variant `result` was produced for; a type change resets it to the zero value. */
  variant: string | undefined;
  result: Value;
  loading: boolean;
  error: boolean;
  errorMessage: string;
  status: number;
  errorDetails: unknown;
}

function fail(s: NetworkRequestState, status: number, message: string, details: unknown): void {
  s.error = true;
  s.errorMessage = message;
  s.status = status;
  s.errorDetails = details;
}

function errorBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.length > MAX_ERROR_BODY_LENGTH ? text.slice(0, MAX_ERROR_BODY_LENGTH) : text;
  }
}

/** Parameter and header values: objects as JSON text, everything else with String(). */
function stringifyField(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return "";
    }
  }
  return String(value);
}

/** A media reference counted as a file in a request body. */
export function isFileValue(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  if (keys[0] === "assetId") return typeof value.assetId === "string";
  return keys[0] === "url" && typeof value.url === "string" && /^(data|blob):/i.test(value.url);
}

/** True when Body (searched recursively) holds a file. */
export function containsFile(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (isFileValue(value)) return true;
  if (Array.isArray(value)) return value.some((v) => containsFile(v, depth + 1));
  if (isPlainObject(value)) return Object.values(value).some((v) => containsFile(v, depth + 1));
  return false;
}

/** A media type without parameters, lowercased: "Text/HTML; charset=utf-8" → "text/html". */
function mediaType(contentType: string): string {
  return contentType.split(";")[0]!.trim().toLowerCase();
}

/** The record format a response's Content-Type names, if any. */
export function streamFormatOf(contentType: string): StreamFormat | undefined {
  const type = mediaType(contentType);
  if (NDJSON_TYPES.has(type)) return "ndjson";
  if (type === "text/event-stream") return "sse";
  if (type === "multipart/mixed") return "multipart";
  return undefined;
}

/** The format a text sniffs as: a boundary line means multipart, an event field means server-sent events, anything else NDJSON. */
function sniffFormat(lines: readonly string[], firstIndex: number): StreamFormat {
  const first = lines[firstIndex]!.trim();
  if (first.startsWith("--")) return "multipart";
  if (/^(data|event|id|retry):/.test(first) || first.startsWith(":")) return "sse";
  return "ndjson";
}

export type StreamRecords = { ok: true; records: unknown[] } | { ok: false; line: number };

export interface StreamParseOptions {
  /** The record format (from the response's Content-Type). Sniffed from the text when omitted. */
  format?: StreamFormat;
  /** The body is still arriving: a trailing record that isn't complete yet is left out instead of parsed. */
  partial?: boolean;
}

/**
 * Split a streamed response into JSON records: NDJSON lines, server-sent event `data:` payloads
 * (skipping `[DONE]`), or multipart/mixed parts. Line numbers in failures are 1-based.
 */
export function parseStreamRecords(text: string, options: StreamParseOptions = {}): StreamRecords {
  const partial = options.partial === true;
  const lines = stripBom(text).split(/\r?\n/);
  const records: unknown[] = [];
  const parse = (payload: string): boolean => {
    try {
      records.push(JSON.parse(payload));
      return true;
    } catch {
      return false;
    }
  };
  const firstIndex = lines.findIndex((l) => l.trim() !== "");
  if (firstIndex < 0) return { ok: true, records };
  const format = options.format ?? sniffFormat(lines, firstIndex);
  // While the body is still arriving, the last line may be cut off mid-record.
  const complete = partial ? lines.length - 1 : lines.length;

  if (format === "multipart") {
    const boundary = lines[firstIndex]!.trim();
    let inHeaders = false;
    let body: string[] = [];
    let bodyLine = 0;
    const flush = (): boolean => {
      const payload = body.join("\n").trim();
      body = [];
      return payload === "" || parse(payload);
    };
    for (let i = firstIndex; i < complete; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (trimmed === boundary || trimmed === `${boundary}--`) {
        if (i > firstIndex && !flush()) return { ok: false, line: bodyLine };
        if (trimmed === `${boundary}--`) return { ok: true, records };
        inHeaders = true;
        continue;
      }
      if (inHeaders) {
        if (trimmed === "") {
          inHeaders = false;
          bodyLine = i + 2;
        }
        continue;
      }
      body.push(line);
    }
    if (partial) return { ok: true, records };
    return flush() ? { ok: true, records } : { ok: false, line: bodyLine };
  }

  if (format === "sse") {
    let data: string[] = [];
    let dataLine = 0;
    const dispatch = (): boolean => {
      const payload = data.join("\n");
      data = [];
      return payload.trim() === "" || payload.trim() === "[DONE]" || parse(payload);
    };
    for (let i = 0; i < complete; i++) {
      const line = lines[i]!;
      if (line === "") {
        if (!dispatch()) return { ok: false, line: dataLine };
        continue;
      }
      if (!line.startsWith("data:")) continue;
      if (data.length === 0) dataLine = i + 1;
      data.push(line.slice(5).replace(/^ /, ""));
    }
    if (partial) return { ok: true, records };
    return dispatch() ? { ok: true, records } : { ok: false, line: dataLine };
  }

  for (let i = 0; i < complete; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    if (!parse(line)) return { ok: false, line: i + 1 };
  }
  return { ok: true, records };
}

/** The record format for a JSON response: from Content-Type, sniffed when Stream is on without one, else none. */
function recordFormat(contentType: string, stream: boolean): StreamFormat | "sniff" | undefined {
  return streamFormatOf(contentType) ?? (stream ? "sniff" : undefined);
}

function convert(outcome: Extract<Outcome, { kind: "response" }>, variant: string): { ok: true; value: Value } | { ok: false; message: string } {
  if (variant === "text") return { ok: true, value: outcome.text };
  if (MEDIA_VARIANTS.has(variant)) {
    const type = mediaType(outcome.contentType);
    if (type !== "" && (type.startsWith("text/") || type === "application/json")) return { ok: false, message: `The server sent ${type}, not ${variant === "image" ? "an image" : `a ${variant}`}.` };
    return outcome.text === "" ? { ok: false, message: "The server sent an empty response." } : { ok: true, value: { url: outcome.url } };
  }
  const format = recordFormat(outcome.contentType, outcome.stream);
  if (format) {
    const r = parseStreamRecords(outcome.text, format === "sniff" ? {} : { format });
    return r.ok ? { ok: true, value: r.records } : { ok: false, message: `Line ${r.line} of the stream isn't valid JSON.` };
  }
  if (outcome.text.trim() === "") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(stripBom(outcome.text)) };
  } catch {
    return { ok: false, message: "The response isn't valid JSON. Switch this patch to Text to see what came back." };
  }
}

function apply(s: NetworkRequestState, outcome: Outcome, variant: string): void {
  if (outcome.kind === "rejected") {
    fail(s, 0, UNREACHABLE_MESSAGE, { message: String(outcome.reason) });
    return;
  }
  if (!outcome.ok) {
    fail(s, outcome.status, `The request failed with status ${outcome.status}.`, { status: outcome.status, body: errorBody(outcome.text) });
    return;
  }
  s.status = outcome.status;
  const converted = convert(outcome, variant);
  if (!converted.ok) {
    fail(s, outcome.status, converted.message, { status: outcome.status, body: errorBody(outcome.text) });
    return;
  }
  s.result = converted.value;
  s.error = false;
  s.errorMessage = "";
  s.errorDetails = null;
}

/**
 * Show a streaming request's data so far: the text for Text, the complete records for JSON. Returns
 * true when the request failed (a complete record that isn't valid JSON), which ends it.
 */
function applyProgress(s: NetworkRequestState, job: Job, variant: string): boolean {
  const progress = job.stream;
  const response = job.response;
  if (!progress || !response?.ok || progress.version === progress.applied) return false;
  progress.applied = progress.version;
  if (variant === "text") {
    s.result = progress.text;
    return false;
  }
  const format = recordFormat(response.contentType, true);
  const r = parseStreamRecords(progress.text, format === "sniff" || format === undefined ? { partial: true } : { format, partial: true });
  if (r.ok) {
    s.result = r.records;
    return false;
  }
  job.abort?.();
  s.generation++;
  s.job = null;
  fail(s, response.status, `Line ${r.line} of the stream isn't valid JSON.`, { status: response.status, body: errorBody(progress.text) });
  return true;
}

function escapeName(name: string): string {
  return name.replace(/"/g, "%22").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** A file value as a form part: the asset's name (else "file") and, for data URLs, their MIME type. */
function formFile(ctx: PatchContext, file: Record<string, unknown>): FetchFormField["value"] {
  if (typeof file.assetId === "string") {
    let name: string | undefined;
    try {
      name = ctx.services.mediaInfo?.({ assetId: file.assetId })?.name;
    } catch {
      name = undefined;
    }
    return { assetId: file.assetId, filename: name ? name : "file" };
  }
  const url = String(file.url);
  const mime = /^data:([^;,]+)/i.exec(url)?.[1]?.toLowerCase();
  return mime ? { url, filename: "file", mime } : { url, filename: "file" };
}

type Packed = { ok: true; body: FetchInit["body"] } | { ok: false; message: string };

function packBody(ctx: PatchContext, headers: Record<string, string>): Packed {
  const body = ctx.input("body");
  let mode = toText(ctx.input("contentType"));
  if (mode !== "json" && mode !== "multipartFormData") mode = containsFile(body) ? "multipartFormData" : "json";
  const typeKeys = Object.keys(headers).filter((k) => k.toLowerCase() === "content-type");

  if (mode === "json") {
    if (typeKeys.length > 0 && typeof body === "string") return { ok: true, body };
    let text: string;
    try {
      text = JSON.stringify(body === undefined ? null : body) ?? "null";
    } catch {
      return { ok: false, message: "Body can't be sent because it contains itself." };
    }
    if (typeKeys.length === 0) headers["Content-Type"] = "application/json";
    return { ok: true, body: text };
  }

  if (!isPlainObject(body)) return { ok: false, message: "Form data needs a JSON object whose keys become form fields." };
  if (typeKeys.length > 0) {
    for (const k of typeKeys) delete headers[k];
    warnIndexed(ctx, "formContentType", "Form data sets its own Content-Type, so the Content-Type header was dropped.");
  }
  // The platform writes the multipart body and its boundary; files become file parts.
  const form: FetchFormField[] = Object.keys(body).map((key) => {
    const value = body[key];
    const name = escapeName(key);
    if (isFileValue(value)) return { name, value: formFile(ctx, value as Record<string, unknown>) };
    return { name, value: typeof value === "string" ? value : stringifyField(value) };
  });
  return { ok: true, body: { form } };
}

/** Send a request for this index. Returns true when it failed before anything was sent. */
function start(ctx: PatchContext, s: NetworkRequestState, variant: string): boolean {
  const failNow = (message: string): true => {
    fail(s, 0, message, null);
    return true;
  };
  const raw = toText(ctx.input("url")).trim();
  if (raw === "") return failNow("Add a URL to request.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return failNow("This URL isn't valid. Check for typos.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return failNow("Network Request only loads http:// and https:// URLs.");

  const params = ctx.input("urlParameters");
  if (params !== null && params !== undefined && !isPlainObject(params)) return failNow("URL Parameters must be a JSON object.");
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item !== null && item !== undefined) url.searchParams.append(key, stringifyField(item));
    } else url.searchParams.append(key, stringifyField(value));
  }

  const headerInput = ctx.input("headers");
  if (!isPlainObject(headerInput)) return failNow("Headers must be a JSON object.");
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(headerInput)) {
    if (value === null || value === undefined) continue;
    if (!HEADER_TOKEN.test(name)) return failNow(`The header name "${name}" isn't valid.`);
    headers[name] = Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined).map(stringifyField).join(", ") : stringifyField(value);
  }

  const method = toText(ctx.input("method")).toLowerCase() || "get";
  let body: FetchInit["body"];
  if (method !== "get") {
    const packed = packBody(ctx, headers);
    if (!packed.ok) return failNow(packed.message);
    body = packed.body;
  }
  // Responses arrive as text, so media is loaded by the layer from the URL itself: plain GETs only.
  if (MEDIA_VARIANTS.has(variant) && (method !== "get" || Object.keys(headers).length > 0)) {
    return failNow("This viewer can't download media with headers or a body yet.");
  }
  const fetch = ctx.services.platform.fetch;
  if (!fetch) return failNow("This viewer can't make network requests.");

  s.job?.abort?.();
  const generation = ++s.generation;
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const stream = toBool(ctx.input("stream"));
  const job: Job = { generation, startedAt: ctx.time, response: null, stream: null };
  if (controller) job.abort = () => controller.abort();
  s.job = job;
  const href = url.toString();
  const init: FetchInit = { method: method.toUpperCase(), headers };
  if (body !== undefined) init.body = body;
  if (controller) init.signal = controller.signal;
  if (stream && !MEDIA_VARIANTS.has(variant)) {
    const progress: StreamProgress = { text: "", version: 0, applied: 0 };
    job.stream = progress;
    init.onChunk = (chunk) => {
      if (generation !== s.generation) return;
      progress.text += String(chunk);
      progress.version++;
    };
  }
  const settle = (outcome: Outcome) => {
    if (generation === s.generation) s.settled = outcome;
  };
  let response: Promise<FetchResponse>;
  try {
    response = Promise.resolve(fetch(href, init));
  } catch (e) {
    response = Promise.reject(e);
  }
  response
    .then(async (r): Promise<Outcome> => {
      const contentType = r.headers?.["content-type"] ?? "";
      if (generation === s.generation) job.response = { ok: r.ok, status: r.status, contentType };
      return { kind: "response", ok: r.ok, status: r.status, text: await r.text(), url: href, stream, contentType };
    })
    .then(settle, (reason: unknown) => settle({ kind: "rejected", reason }));
  return false;
}

function outputAll(ctx: PatchContext, s: NetworkRequestState): void {
  ctx.output("result", s.result);
  ctx.output("loading", s.loading);
  ctx.output("error", s.error);
  ctx.output("errorMessage", s.errorMessage);
  ctx.output("status", s.status);
  ctx.output("errorDetails", s.errorDetails as never);
}

export const networkRequest = definePatch<NetworkRequestState>("networkRequest", {
  mutedBehavior: "evaluate",
  state: () => ({
    generation: 0,
    job: null,
    settled: null,
    variant: undefined,
    result: null,
    loading: false,
    error: false,
    errorMessage: "",
    status: 0,
    errorDetails: null,
  }),
  evaluate(ctx) {
    const s = ctx.state;
    const variant = variantOf(ctx, networkRequest);
    if (s.variant !== variant) {
      s.variant = variant;
      s.result = zeroValue(variant);
    }
    if (ctx.muted) {
      if (s.job || s.settled) {
        s.job?.abort?.();
        s.generation++;
        s.job = null;
        s.settled = null;
      }
      s.loading = false;
      ctx.output("result", zeroValue(variant));
      ctx.output("loading", false);
      ctx.output("error", false);
      ctx.output("errorMessage", "");
      ctx.output("status", 0);
      ctx.output("errorDetails", null);
      return;
    }
    let finished = false;
    if (s.settled) {
      apply(s, s.settled, variant);
      s.settled = null;
      s.job = null;
      finished = true;
    } else if (s.job) {
      finished = applyProgress(s, s.job, variant);
    }
    if (s.job && !toBool(ctx.input("disableTimeout")) && ctx.time - s.job.startedAt >= REQUEST_TIMEOUT_SECONDS) {
      s.job.abort?.();
      s.job = null;
      s.generation++;
      fail(s, 0, "The request timed out after 60 seconds.", null);
      finished = true;
    }
    if (ctx.pulsed("request")) finished = start(ctx, s, variant) || finished;
    s.loading = s.job !== null;
    if (s.loading) ctx.requestNextFrame();
    outputAll(ctx, s);
    if (finished) ctx.pulse("finished");
  },
  dispose(state) {
    state.job?.abort?.();
    state.generation++;
    state.job = null;
    state.settled = null;
  },
});
