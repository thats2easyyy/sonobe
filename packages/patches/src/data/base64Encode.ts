/** Base64 Encode: encodes text, JSON, or an image or sound's bytes as base64 text. */

import type { AssetRef } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { definePatch, isPlainObject, toBool, toText } from "../infra/index.ts";
import { encodeBase64, normalizeBase64, percentDecodeBytes, toUrlSafe, utf8Encode } from "./base64.ts";
import { variantOf, warnIndexed } from "./shared.ts";

/** Bytes encoded per frame (a multiple of 3). */
export const ENCODE_BYTES_PER_FRAME = 1_500_000;
/** Most inputs waiting in the queue. */
export const MAX_QUEUED_INPUTS = 100;

interface EncodeInput {
  value: unknown;
  urlSafe: boolean;
}

interface EncodeJob {
  generation: number;
  urlSafe: boolean;
  bytes: Uint8Array | null;
  offset: number;
  parts: string[];
  reading: boolean;
  failure: string | null;
}

export interface Base64EncodeState {
  generation: number;
  job: EncodeJob | null;
  queue: EncodeInput[];
  base64: string;
  loading: boolean;
  error: boolean;
  errorMessage: string;
  started: boolean;
}

function finish(s: Base64EncodeState, b64: string, urlSafe: boolean): void {
  s.base64 = urlSafe ? toUrlSafe(b64) : b64;
  s.error = false;
  s.errorMessage = "";
  s.job = null;
}

function finishWithError(s: Base64EncodeState, message: string): void {
  s.base64 = "";
  s.error = true;
  s.errorMessage = message;
  s.job = null;
}

function start(ctx: PatchContext, s: Base64EncodeState, input: EncodeInput, variant: string): void {
  const generation = ++s.generation;
  const job: EncodeJob = { generation, urlSafe: input.urlSafe, bytes: null, offset: 0, parts: [], reading: false, failure: null };
  s.job = job;
  const { value } = input;
  if (variant === "text") {
    job.bytes = utf8Encode(toText(value));
    return;
  }
  if (variant === "json") {
    try {
      job.bytes = utf8Encode(JSON.stringify(value === undefined ? null : value) ?? "null");
    } catch {
      finishWithError(s, "This JSON contains itself, so it can't be encoded.");
    }
    return;
  }
  const kind = variant === "sound" ? "sound" : "image";
  if (value === null || value === undefined) return finish(s, "", false);
  let ref: AssetRef | undefined;
  if (isPlainObject(value) && typeof value.url === "string") ref = { url: value.url };
  else if (isPlainObject(value) && typeof value.assetId === "string") {
    if (ctx.services.resolveAssetUrl(value.assetId) === undefined) return finishWithError(s, `The ${kind} asset is missing.`);
    ref = { assetId: value.assetId };
  } else if (isPlainObject(value) && typeof value.live === "string") ref = { live: value.live };
  else if (typeof value === "string") ref = { url: value };
  if (ref === undefined) return finishWithError(s, `Couldn't read the ${kind} data.`);

  const url = ref.url;
  if (url !== undefined && /^data:/i.test(url)) {
    const comma = url.indexOf(",");
    if (comma < 0) return finishWithError(s, `Couldn't read the ${kind} data.`);
    if (/;base64$/i.test(url.slice(0, comma))) {
      const normalized = normalizeBase64(url);
      return normalized.ok ? finish(s, normalized.b64, input.urlSafe) : finishWithError(s, `Couldn't read the ${kind} data.`);
    }
    job.bytes = percentDecodeBytes(url.slice(comma + 1));
    return;
  }
  const readBytes = ctx.services.platform.readBytes;
  if (typeof readBytes !== "function") return finishWithError(s, "This viewer can't read media data yet.");
  job.reading = true;
  const source = ref;
  try {
    Promise.resolve(readBytes(source)).then(
      (bytes) => {
        if (generation !== s.generation || s.job !== job) return;
        job.reading = false;
        job.bytes = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
      },
      () => {
        if (generation === s.generation && s.job === job) job.failure = `Couldn't read the ${kind} data.`;
      },
    );
  } catch {
    job.failure = `Couldn't read the ${kind} data.`;
  }
}

/** Encode the next slice; true when the job finished. */
function advance(s: Base64EncodeState, job: EncodeJob): boolean {
  const bytes = job.bytes!;
  const end = Math.min(bytes.length, job.offset + ENCODE_BYTES_PER_FRAME);
  job.parts.push(encodeBase64(bytes.subarray(job.offset, end)));
  job.offset = end;
  if (job.offset < bytes.length) return false;
  finish(s, job.parts.join(""), job.urlSafe);
  return true;
}

export const base64Encode = definePatch<Base64EncodeState>("base64Encode", {
  mutedBehavior: "zero",
  state: () => ({ generation: 0, job: null, queue: [], base64: "", loading: false, error: false, errorMessage: "", started: false }),
  evaluate(ctx) {
    const s = ctx.state;
    const variant = variantOf(ctx, base64Encode);
    if (!s.started || ctx.changed("value") || ctx.changed("urlSafe")) {
      s.started = true;
      const input: EncodeInput = { value: ctx.input("value"), urlSafe: toBool(ctx.input("urlSafe")) };
      if (!toBool(ctx.input("queue"))) {
        s.queue = [];
        start(ctx, s, input, variant);
      } else if (!s.job) start(ctx, s, input, variant);
      else {
        s.queue.push(input);
        if (s.queue.length > MAX_QUEUED_INPUTS) {
          s.queue.shift();
          warnIndexed(ctx, "queue", "Base64 Encode's queue holds 100 values; the oldest waiting value was dropped.");
        }
      }
    }
    let finishedThisFrame = false;
    const job = s.job;
    if (job?.failure) {
      finishWithError(s, job.failure);
      finishedThisFrame = true;
    } else if (job?.bytes) finishedThisFrame = advance(s, job);
    if (!s.job && !finishedThisFrame && s.queue.length > 0) start(ctx, s, s.queue.shift()!, variant);
    s.loading = s.job !== null;
    if (s.loading || s.queue.length > 0) ctx.requestNextFrame();
    ctx.output("base64", s.base64);
    ctx.output("loading", s.loading);
    ctx.output("error", s.error);
    ctx.output("errorMessage", s.errorMessage);
  },
  dispose(state) {
    state.generation++;
    state.job = null;
    state.queue = [];
  },
});
