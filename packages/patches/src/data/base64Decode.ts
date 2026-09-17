/** Base64 Decode: decodes base64 text into text, JSON, or an image or sound data URL. */

import type { Value } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { definePatch, toBool, toText, zeroValue } from "../infra/index.ts";
import { concatBytes, decodeBase64, normalizeBase64, sniffImageMime, sniffSoundMime, utf8Decode } from "./base64.ts";
import { variantOf, warnIndexed } from "./shared.ts";

/** Base64 characters decoded per frame (a multiple of 4). */
export const DECODE_CHARS_PER_FRAME = 2_000_000;
/** Most inputs waiting in the queue. */
export const MAX_DECODE_QUEUE = 100;
/** Characters decoded to sniff media formats; SVG text is checked over a longer prefix. */
const SNIFF_CHARS = 64;
const SVG_SNIFF_CHARS = 1024;

const NOT_IMAGE = "The decoded data isn't an image (PNG, JPEG, GIF, WebP, AVIF, BMP, or SVG).";
const NOT_SOUND = "The decoded data isn't a sound (MP3, AAC, WAV, OGG, FLAC, or M4A).";

interface DecodeJob {
  generation: number;
  b64: string;
  offset: number;
  chunks: Uint8Array[];
}

export interface Base64DecodeState {
  generation: number;
  job: DecodeJob | null;
  queue: string[];
  /** The variant `output` holds; a type change resets it. */
  variant: string | undefined;
  output: Value;
  loading: boolean;
  error: boolean;
  errorMessage: string;
  started: boolean;
}

function finish(s: Base64DecodeState, output: Value): void {
  s.output = output;
  s.error = false;
  s.errorMessage = "";
  s.job = null;
}

function fail(s: Base64DecodeState, message: string, variant: string): void {
  s.output = zeroValue(variant);
  s.error = true;
  s.errorMessage = message;
  s.job = null;
}

function start(s: Base64DecodeState, text: string, variant: string): void {
  s.generation++;
  s.job = null;
  const normalized = normalizeBase64(text);
  if (!normalized.ok) return fail(s, normalized.message, variant);
  const { b64, mime } = normalized;
  if (b64 === "") return finish(s, zeroValue(variant));
  if (variant === "image" || variant === "sound") {
    const prefix = decodeBase64(b64.slice(0, SNIFF_CHARS));
    const family = variant === "image" ? "image/" : "audio/";
    const sniffed = mime?.startsWith(family)
      ? mime
      : variant === "image"
        ? sniffImageMime(prefix, decodeBase64(b64.slice(0, SVG_SNIFF_CHARS)))
        : sniffSoundMime(prefix);
    if (!sniffed) return fail(s, variant === "image" ? NOT_IMAGE : NOT_SOUND, variant);
    return finish(s, { url: `data:${sniffed};base64,${b64}` });
  }
  s.job = { generation: s.generation, b64, offset: 0, chunks: [] };
}

/** Decode the next slice; true when the job finished. */
function advance(s: Base64DecodeState, job: DecodeJob, variant: string): boolean {
  const end = Math.min(job.b64.length, job.offset + DECODE_CHARS_PER_FRAME);
  job.chunks.push(decodeBase64(job.b64.slice(job.offset, end)));
  job.offset = end;
  if (job.offset < job.b64.length) return false;
  const text = utf8Decode(concatBytes(job.chunks));
  if (variant === "json") {
    try {
      finish(s, JSON.parse(text) as Value);
    } catch {
      fail(s, "The decoded text isn't valid JSON. Switch this patch to Text to see what's inside.", variant);
    }
  } else finish(s, text);
  return true;
}

function submit(ctx: PatchContext, s: Base64DecodeState, text: string, variant: string): void {
  if (!toBool(ctx.input("queue"))) {
    s.queue = [];
    start(s, text, variant);
  } else if (!s.job) start(s, text, variant);
  else {
    s.queue.push(text);
    if (s.queue.length > MAX_DECODE_QUEUE) {
      s.queue.shift();
      warnIndexed(ctx, "queue", "Base64 Decode's queue holds 100 values; the oldest waiting value was dropped.");
    }
  }
}

export const base64Decode = definePatch<Base64DecodeState>("base64Decode", {
  mutedBehavior: "zero",
  state: () => ({ generation: 0, job: null, queue: [], variant: undefined, output: null, loading: false, error: false, errorMessage: "", started: false }),
  evaluate(ctx) {
    const s = ctx.state;
    const variant = variantOf(ctx, base64Decode);
    if (s.variant !== variant) {
      s.variant = variant;
      s.output = zeroValue(variant);
      s.started = false;
    }
    if (!s.started || ctx.changed("base64")) {
      s.started = true;
      submit(ctx, s, toText(ctx.input("base64")), variant);
    }
    let finishedThisFrame = false;
    if (s.job) finishedThisFrame = advance(s, s.job, variant);
    if (!s.job && !finishedThisFrame && s.queue.length > 0) start(s, s.queue.shift()!, variant);
    s.loading = s.job !== null;
    if (s.loading || s.queue.length > 0) ctx.requestNextFrame();
    ctx.output("output", s.output);
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
