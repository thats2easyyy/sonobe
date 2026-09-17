/** Network Request: loads JSON, text, or media from a URL on a pulse, reporting loading and errors. */

import type { Value } from "@sonobe/core";
import type { PatchContext, RuntimePatchDefinition } from "@sonobe/engine";
import { definePatch, isPlainObject, toBool, toText, zeroValue } from "../infra/index.ts";
import { errorText, stripBom, variantOf, warnIndexed, withMutedBehavior } from "./shared.ts";

/** A request still loading after this many prototype seconds fails (unless Disable Timeout is on). */
export const REQUEST_TIMEOUT_SECONDS = 60;
/** Error Details keeps at most this much of a non-JSON error body. */
export const MAX_ERROR_BODY_LENGTH = 10_000;
/** The multipart boundary Sonobe writes for form data bodies. */
export const FORM_BOUNDARY = "----SonobeFormBoundary7MA4YWxkTrZu0gW";

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const UNREACHABLE_MESSAGE = "Couldn't reach the server. Check the URL and your connection, and that the server allows requests from prototypes (CORS).";
const MEDIA_VARIANTS = new Set(["image", "video", "sound"]);

interface Job {
  generation: number;
  startedAt: number;
  abort?: () => void;
}

type Outcome = { kind: "rejected"; reason: unknown } | { kind: "response"; ok: boolean; status: number; text: string; url: string; stream: boolean };

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

export type StreamRecords = { ok: true; records: unknown[] } | { ok: false; line: number };

/**
 * Split a streamed response into JSON records: multipart/mixed parts when the text starts with a
 * boundary line, server-sent events when the first line is an event field, NDJSON otherwise.
 */
export function parseStreamRecords(text: string): StreamRecords {
  const lines = stripBom(text).split(/\r?\n/);
  const records: unknown[] = [];
  const parse = (payload: string, line: number): boolean => {
    try {
      records.push(JSON.parse(payload));
      return true;
    } catch {
      return false;
    }
  };
  const firstIndex = lines.findIndex((l) => l.trim() !== "");
  if (firstIndex < 0) return { ok: true, records };
  const first = lines[firstIndex]!.trim();

  if (first.startsWith("--")) {
    const boundary = first;
    let inHeaders = false;
    let body: string[] = [];
    let bodyLine = 0;
    const flush = (): boolean => {
      const payload = body.join("\n").trim();
      body = [];
      return payload === "" || parse(payload, bodyLine);
    };
    for (let i = firstIndex; i < lines.length; i++) {
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
    return flush() ? { ok: true, records } : { ok: false, line: bodyLine };
  }

  if (/^(data|event|id|retry):/.test(first) || first.startsWith(":")) {
    let data: string[] = [];
    let dataLine = 0;
    const dispatch = (): boolean => {
      const payload = data.join("\n");
      data = [];
      return payload.trim() === "" || payload.trim() === "[DONE]" || parse(payload, dataLine);
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line === "") {
        if (!dispatch()) return { ok: false, line: dataLine };
        continue;
      }
      if (!line.startsWith("data:")) continue;
      if (data.length === 0) dataLine = i + 1;
      data.push(line.slice(5).replace(/^ /, ""));
    }
    return dispatch() ? { ok: true, records } : { ok: false, line: dataLine };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    if (!parse(line, i + 1)) return { ok: false, line: i + 1 };
  }
  return { ok: true, records };
}

function convert(outcome: Extract<Outcome, { kind: "response" }>, variant: string): { ok: true; value: Value } | { ok: false; message: string } {
  if (variant === "text") return { ok: true, value: outcome.text };
  if (MEDIA_VARIANTS.has(variant)) {
    return outcome.text === "" ? { ok: false, message: "The server sent an empty response." } : { ok: true, value: { url: outcome.url } };
  }
  if (outcome.stream) {
    const r = parseStreamRecords(outcome.text);
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

function escapeFormName(name: string): string {
  return name.replace(/"/g, "%22").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

type Packed = { ok: true; body: string } | { ok: false; message: string };

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
  if (containsFile(body)) return { ok: false, message: "This viewer can't upload files yet." };
  if (typeKeys.length > 0) {
    for (const k of typeKeys) delete headers[k];
    warnIndexed(ctx, "formContentType", "Form data sets its own Content-Type, so the Content-Type header was dropped.");
  }
  const parts: string[] = [];
  for (const key of Object.keys(body)) {
    const value = body[key];
    parts.push(`--${FORM_BOUNDARY}\r\nContent-Disposition: form-data; name="${escapeFormName(key)}"\r\n\r\n${typeof value === "string" ? value : stringifyField(value)}\r\n`);
  }
  parts.push(`--${FORM_BOUNDARY}--\r\n`);
  headers["Content-Type"] = `multipart/form-data; boundary=${FORM_BOUNDARY}`;
  return { ok: true, body: parts.join("") };
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
  let body: string | undefined;
  if (method !== "get") {
    const packed = packBody(ctx, headers);
    if (!packed.ok) return failNow(packed.message);
    body = packed.body;
  }
  if (MEDIA_VARIANTS.has(variant) && (method !== "get" || Object.keys(headers).length > 0)) {
    return failNow("This viewer can't download media with headers or a body yet.");
  }
  const fetch = ctx.services.platform.fetch;
  if (!fetch) return failNow("This viewer can't make network requests.");

  s.job?.abort?.();
  const generation = ++s.generation;
  s.job = { generation, startedAt: ctx.time };
  const href = url.toString();
  const stream = toBool(ctx.input("stream"));
  const init: { method: string; headers: Record<string, string>; body?: string } = { method: method.toUpperCase(), headers };
  if (body !== undefined) init.body = body;
  const settle = (outcome: Outcome) => {
    if (generation === s.generation) s.settled = outcome;
  };
  let response: Promise<Awaited<ReturnType<typeof fetch>>>;
  try {
    response = Promise.resolve(fetch(href, init));
  } catch (e) {
    response = Promise.reject(e);
  }
  response
    .then(async (r): Promise<Outcome> => ({ kind: "response", ok: r.ok, status: r.status, text: await r.text(), url: href, stream }))
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

export const networkRequest: RuntimePatchDefinition<NetworkRequestState> = withMutedBehavior(
  definePatch<NetworkRequestState>("networkRequest", {
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
      if (ctx.node.muted) {
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
  }),
  "evaluate",
);
