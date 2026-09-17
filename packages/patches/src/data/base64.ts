/**
 * Base64 and byte helpers for the base64 patches: RFC 4648 encoding and decoding over Uint8Array,
 * normalizing pasted base64 (data: prefixes, URL-safe alphabet, whitespace, missing padding),
 * UTF-8, percent-decoding data URLs, and sniffing image and sound formats from magic bytes.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** Standard base64 with `=` padding. */
export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 0x3fff * 3;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK);
    const codes: number[] = [];
    for (let i = start; i < end; i += 3) {
      const b0 = bytes[i]!;
      const b1 = i + 1 < end ? bytes[i + 1]! : 0;
      const b2 = i + 2 < end ? bytes[i + 2]! : 0;
      codes.push(ALPHABET.charCodeAt(b0 >> 2), ALPHABET.charCodeAt(((b0 & 3) << 4) | (b1 >> 4)));
      codes.push(i + 1 < end ? ALPHABET.charCodeAt(((b1 & 15) << 2) | (b2 >> 6)) : 61);
      codes.push(i + 2 < end ? ALPHABET.charCodeAt(b2 & 63) : 61);
    }
    parts.push(String.fromCharCode(...codes));
  }
  return parts.join("");
}

/** Decode normalized, padded base64 (see {@link normalizeBase64}). */
export function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = LOOKUP[clean.charCodeAt(i)]!;
    const c1 = LOOKUP[clean.charCodeAt(i + 1)]!;
    const c2 = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)]! : 0;
    const c3 = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)]! : 0;
    out[o++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < clean.length) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (i + 3 < clean.length) out[o++] = ((c2 & 3) << 6) | c3;
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** `+` → `-`, `/` → `_`, no padding. */
export function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type NormalizedBase64 = { ok: true; b64: string; mime: string | null } | { ok: false; message: string };

/**
 * Normalize pasted base64: trim, strip a `data:…;base64,` prefix (remembering its MIME type), drop
 * whitespace, map the URL-safe alphabet, validate, and re-pad to a multiple of 4.
 */
export function normalizeBase64(text: string): NormalizedBase64 {
  let s = text.trim();
  let mime: string | null = null;
  const prefix = /^data:([^,;]*)((?:;[^,;]*)*);base64,/i.exec(s);
  if (prefix) {
    mime = prefix[1] ? prefix[1].toLowerCase() : null;
    s = s.slice(prefix[0].length);
  } else if (/^data:/i.test(s)) {
    return { ok: false, message: "This is a data URL, but it isn't base64." };
  }
  s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) return { ok: false, message: "This isn't valid base64 text." };
  return { ok: true, b64: s + "=".repeat((4 - (s.length % 4)) % 4), mime };
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** UTF-8 decoding that replaces invalid sequences with U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Bytes of a percent-encoded data URL payload: `%XX` escapes as bytes, other text as UTF-8. */
export function percentDecodeBytes(text: string): Uint8Array {
  const out: number[] = [];
  let run = "";
  const flush = () => {
    if (run) for (const b of utf8Encode(run)) out.push(b);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "%" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      flush();
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else run += text[i];
  }
  flush();
  return Uint8Array.from(out);
}

/** Concatenate byte chunks. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const c of chunks) length += c.length;
  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((b, i) => bytes[at + i] === b);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function isSvgText(bytes: Uint8Array): boolean {
  let text = utf8Decode(bytes).replace(/^﻿/, "").trimStart();
  if (text.startsWith("<?xml")) {
    const end = text.indexOf("?>");
    if (end < 0) return false;
    text = text.slice(end + 2).trimStart();
    for (;;) {
      if (text.startsWith("<!--")) {
        const close = text.indexOf("-->");
        if (close < 0) return false;
        text = text.slice(close + 3).trimStart();
      } else if (/^<!DOCTYPE/i.test(text)) {
        const close = text.indexOf(">");
        if (close < 0) return false;
        text = text.slice(close + 1).trimStart();
      } else break;
    }
  }
  return text.startsWith("<svg");
}

/** An image MIME type from the first bytes, or null. `svgPrefix` is a longer prefix for the SVG text check. */
export function sniffImageMime(bytes: Uint8Array, svgPrefix: Uint8Array = bytes): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("BM"))) return "image/bmp";
  if (startsWith(bytes, ascii("ftyp"), 4) && (startsWith(bytes, ascii("avif"), 8) || startsWith(bytes, ascii("avis"), 8))) return "image/avif";
  return isSvgText(svgPrefix) ? "image/svg+xml" : null;
}

/** A sound MIME type from the first bytes, or null. */
export function sniffSoundMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, ascii("ID3"))) return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return "audio/aac";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WAVE"), 8)) return "audio/wav";
  if (startsWith(bytes, ascii("OggS"))) return "audio/ogg";
  if (startsWith(bytes, ascii("fLaC"))) return "audio/flac";
  if (startsWith(bytes, ascii("ftyp"), 4)) return "audio/mp4";
  return null;
}
