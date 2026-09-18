/**
 * Headless screenshots: draw a SceneFrame as SVG with @sonobe/renderer/svg, then rasterize it to PNG
 * with resvg (@resvg/resvg-js, a native module loaded on first use), within size and byte caps.
 * Media for image layers loads from the project's assets folder as data URIs. Node only.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { SonobeDocument } from "@sonobe/core";
import type { SceneFrame } from "@sonobe/engine";
import {
  findSceneNode,
  renderSceneSvg,
  sceneNodeBounds,
  walkSceneNodes,
  type SvgAsset,
  type SvgRect,
} from "@sonobe/renderer/svg";
import { HostError, isHostError, type Screenshot } from "./host.ts";

/** Largest PNG a screenshot returns (bytes); bigger renders are redrawn smaller. */
export const MAX_SCREENSHOT_BYTES = 2_500_000;
/** Longest image edge in pixels. */
export const MAX_SCREENSHOT_EDGE = 2048;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 32 * 1024 * 1024;

interface RenderedImage {
  asPng(): Uint8Array;
  readonly width: number;
  readonly height: number;
}

interface ResvgModule {
  Resvg: new (svg: string, options?: Record<string, unknown>) => { render(): RenderedImage };
}

let loading: Promise<ResvgModule | null> | undefined;
let loadError = "";

/** resvg, loaded once; null when the native module isn't installed where Sonobe runs. */
export function loadRasterizer(): Promise<ResvgModule | null> {
  loading ??= (async () => {
    try {
      // A computed specifier keeps bundlers from inlining the native module: it loads from node_modules at runtime.
      const specifier = ["@resvg", "resvg-js"].join("/");
      const mod = (await import(specifier)) as Partial<ResvgModule> & {
        default?: Partial<ResvgModule>;
      };
      const Resvg = mod.Resvg ?? mod.default?.Resvg;
      if (typeof Resvg !== "function") throw new Error("the module has no Resvg class");
      return { Resvg };
    } catch (err) {
      loadError = err instanceof Error ? err.message.split("\n")[0]! : String(err);
      return null;
    }
  })();
  return loading;
}

export interface RasterImage {
  png: Uint8Array;
  width: number;
  height: number;
}

const unavailable = () =>
  new HostError(
    "screenshots_unavailable",
    "Sonobe's headless screenshot renderer isn't installed next to this server.",
    {
      hint: `The native module @resvg/resvg-js couldn't load (${loadError || "not found"}). Install it where Sonobe runs, or open the project in the Sonobe app. Meanwhile, check structure with get_outline and behavior with sim_get_values or sim_trace.`,
    },
  );

/**
 * The rasterizer runs in its own Node process: a native panic in resvg aborts the process it runs
 * in, and that must never take the MCP server down. Requests are length-prefixed JSON on stdin;
 * replies are length-prefixed frames on stdout ([1][width][height][png] or [0][error text]). A request
 * with a pixel `crop` renders the whole drawing and cuts the region out itself (encoding the PNG with
 * zlib), for drawings resvg can't render with a cropped viewBox.
 */
const WORKER_SOURCE = `"use strict";
const { Resvg } = require(process.argv[1]);
const zlib = require("zlib");
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, "latin1"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); };
const encodePng = (rgba, w, h) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
};
let buffer = Buffer.alloc(0);
const send = (parts) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
};
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const n = buffer.readUInt32BE(0);
    if (buffer.length < 4 + n) break;
    const request = JSON.parse(buffer.subarray(4, 4 + n).toString("utf8"));
    buffer = buffer.subarray(4 + n);
    try {
      const image = new Resvg(request.svg, request.options).render();
      const meta = Buffer.alloc(9);
      meta[0] = 1;
      if (request.crop) {
        const x = Math.max(0, Math.min(image.width - 1, Math.round(request.crop.x)));
        const y = Math.max(0, Math.min(image.height - 1, Math.round(request.crop.y)));
        const w = Math.max(1, Math.min(image.width - x, Math.round(request.crop.width)));
        const h = Math.max(1, Math.min(image.height - y, Math.round(request.crop.height)));
        const pixels = Buffer.from(image.pixels);
        const out = Buffer.alloc(w * h * 4);
        for (let row = 0; row < h; row++) pixels.copy(out, row * w * 4, ((y + row) * image.width + x) * 4, ((y + row) * image.width + x + w) * 4);
        meta.writeUInt32BE(w, 1);
        meta.writeUInt32BE(h, 5);
        send([meta, encodePng(out, w, h)]);
      } else {
        meta.writeUInt32BE(image.width, 1);
        meta.writeUInt32BE(image.height, 5);
        send([meta, image.asPng()]);
      }
    } catch (err) {
      send([Buffer.from([0]), Buffer.from(String((err && err.message) || err))]);
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface RasterWorker {
  child: ChildProcess;
  buffer: Buffer;
  waiting: ((frame: Buffer | null) => void) | null;
  stderr: string;
}

/** The UI font text falls back to when a layer's font isn't installed, by platform. */
const FALLBACK_FAMILY: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "Helvetica Neue",
  win32: "Segoe UI",
  linux: "DejaVu Sans",
};

let worker: RasterWorker | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Where @resvg/resvg-js resolves from this module (the repo, or node_modules beside a bundle). */
function resolveResvg(): string | null {
  try {
    return createRequire(import.meta.url).resolve(["@resvg", "resvg-js"].join("/"));
  } catch {
    return null;
  }
}

function setRef(w: RasterWorker, ref: boolean): void {
  for (const stream of [w.child.stdin, w.child.stdout, w.child.stderr]) {
    const s = stream as unknown as { ref?: () => void; unref?: () => void } | null;
    if (ref) s?.ref?.();
    else s?.unref?.();
  }
  if (ref) w.child.ref();
  else w.child.unref();
}

function startWorker(resvgPath: string): RasterWorker {
  const child = spawn(process.execPath, ["-e", WORKER_SOURCE, resvgPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const w: RasterWorker = { child, buffer: Buffer.alloc(0), waiting: null, stderr: "" };
  const finish = (frame: Buffer | null) => {
    const resolve = w.waiting;
    w.waiting = null;
    resolve?.(frame);
  };
  child.stdout!.on("data", (chunk: Buffer) => {
    w.buffer = Buffer.concat([w.buffer, chunk]);
    while (w.buffer.length >= 4) {
      const n = w.buffer.readUInt32BE(0);
      if (w.buffer.length < 4 + n) break;
      const frame = w.buffer.subarray(4, 4 + n);
      w.buffer = w.buffer.subarray(4 + n);
      finish(frame);
    }
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    w.stderr = (w.stderr + chunk.toString("utf8")).slice(-4000);
  });
  const died = () => {
    if (worker === w) worker = null;
    finish(null);
  };
  child.on("exit", died);
  child.on("error", died);
  child.stdin!.on("error", () => {
    // The worker died mid-write; "exit" reports it.
  });
  setRef(w, false);
  return w;
}

async function renderInWorker(
  resvgPath: string,
  svg: string,
  options: Record<string, unknown>,
  crop?: SvgRect,
): Promise<RasterImage> {
  const w = (worker ??= startWorker(resvgPath));
  setRef(w, true);
  try {
    const frame = await new Promise<Buffer | null>((resolve) => {
      w.waiting = resolve;
      const body = Buffer.from(JSON.stringify({ svg, options, ...(crop ? { crop } : {}) }), "utf8");
      const head = Buffer.alloc(4);
      head.writeUInt32BE(body.length, 0);
      w.child.stdin!.write(Buffer.concat([head, body]));
    });
    if (!frame) {
      const detail = w.stderr
        .split("\n")
        .find((l) => /panicked|Error|error/.test(l))
        ?.trim();
      throw new HostError(
        "screenshot_renderer_crashed",
        "Sonobe's screenshot renderer crashed while drawing this frame, so there's no image.",
        {
          hint: `Try one layer ("@layerId") or a smaller region; the renderer restarts on the next screenshot.${detail ? ` Renderer said: ${detail.slice(0, 200)}` : ""}`,
        },
      );
    }
    if (frame[0] !== 1)
      throw new HostError(
        "capture_failed",
        `Sonobe couldn't draw the frame: ${frame.subarray(1).toString("utf8")}`,
        { hint: 'Try target "viewer" or another layer.' },
      );
    return {
      width: frame.readUInt32BE(1),
      height: frame.readUInt32BE(5),
      png: new Uint8Array(frame.subarray(9)),
    };
  } finally {
    if (worker === w) setRef(w, false);
  }
}

/**
 * Rasterize SVG to PNG bytes. Runs resvg in a separate process (see WORKER_SOURCE), falling back to
 * this process when it can't spawn one. Fonts load only when the drawing has text; they're slow to load.
 */
export async function rasterizeSvg(
  svg: string,
  options: { hasText: boolean; crop?: SvgRect },
): Promise<RasterImage> {
  // resvg falls back to a regular-weight face when a layer's font isn't installed unless the default
  // families name an installed UI font, so bold text stays bold with the fallback.
  const fallback = FALLBACK_FAMILY[process.platform] ?? "DejaVu Sans";
  const resvgOptions = {
    fitTo: { mode: "original" },
    font: {
      loadSystemFonts: options.hasText,
      defaultFontFamily: fallback,
      sansSerifFamily: fallback,
    },
    logLevel: "off",
  };
  const resvgPath = resolveResvg();
  if (resvgPath) {
    const run = queue.then(() => renderInWorker(resvgPath, svg, resvgOptions, options.crop));
    queue = run.catch(() => undefined);
    return run;
  }
  const rasterizer = await loadRasterizer();
  if (!rasterizer) throw unavailable();
  const image = new rasterizer.Resvg(svg, resvgOptions).render();
  return { png: image.asPng(), width: image.width, height: image.height };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function sniffMime(bytes: Uint8Array): string | undefined {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return undefined;
}

const assetIdOf = (v: unknown): string | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const o = v as { assetId?: unknown; asset?: unknown };
  return typeof o.assetId === "string"
    ? o.assetId
    : typeof o.asset === "string"
      ? o.asset
      : undefined;
};

/**
 * Load the image assets a scene draws from a project folder as data URIs. Unknown assets, files
 * outside assets/, unsupported formats and oversized files are skipped (the drawing notes them).
 */
export async function loadSceneAssets(
  scene: SceneFrame,
  doc: SonobeDocument,
  projectDir: string | undefined,
): Promise<(ref: { assetId?: string; url?: string }) => SvgAsset | null> {
  const ids = new Set<string>();
  walkSceneNodes(scene, (n) => {
    if (n.type !== "image") return;
    const id = assetIdOf(n.props?.image);
    if (id) ids.add(id);
  });
  const loaded = new Map<string, SvgAsset>();
  let total = 0;
  for (const id of ids) {
    const record = doc.assets?.[id];
    const file = record?.file;
    if (!record || !projectDir || typeof file !== "string" || !file || path.basename(file) !== file)
      continue;
    try {
      const bytes = await readFile(path.join(projectDir, "assets", file));
      if (bytes.byteLength > MAX_ASSET_BYTES || total + bytes.byteLength > MAX_TOTAL_ASSET_BYTES)
        continue;
      const mime =
        sniffMime(bytes) ?? record.mime ?? MIME_BY_EXTENSION[path.extname(file).toLowerCase()];
      if (!mime || !Object.values(MIME_BY_EXTENSION).includes(mime)) continue;
      total += bytes.byteLength;
      loaded.set(id, {
        href: `data:${mime};base64,${bytes.toString("base64")}`,
        ...(record.width ? { width: record.width } : {}),
        ...(record.height ? { height: record.height } : {}),
      });
    } catch {
      // A missing file draws nothing; the drawing's notes say so.
    }
  }
  return (ref) =>
    ref.assetId !== undefined
      ? (loaded.get(ref.assetId) ?? null)
      : ref.url?.startsWith("data:")
        ? { href: ref.url }
        : null;
}

export interface SceneScreenshotRequest {
  scene: SceneFrame;
  /** The whole screen, or one layer by layer id or scene key ("card#2", "like_button/heart"). */
  target: { kind: "viewer" } | { kind: "layer"; layerId: string };
  /** Pixels per point (default 1). */
  scale?: number;
  /** Downscale so the image is at most this wide. */
  maxWidth?: number;
  /** PNG byte cap (default MAX_SCREENSHOT_BYTES). */
  maxBytes?: number;
  assets?: (ref: { assetId?: string; url?: string }) => SvgAsset | null | undefined;
  /** For messages: the simulation drawn. */
  simId?: string;
}

/** Draw and rasterize a scene (or one layer's box) as a PNG screenshot. */
export async function renderSceneScreenshot(request: SceneScreenshotRequest): Promise<Screenshot> {
  const { scene, target } = request;
  let crop: SvgRect = { x: 0, y: 0, width: scene.size[0], height: scene.size[1] };
  if (target.kind === "layer") {
    const node = findSceneNode(scene, target.layerId);
    if (!node) {
      throw new HostError(
        "not_found",
        `Layer "${target.layerId}" isn't drawn ${request.simId ? `in simulation "${request.simId}"` : "on screen"} right now.`,
        {
          hint: "Check the id with get_outline. Hidden layers and loop copies past the loop's count aren't drawn; \"@row#2\" picks one copy.",
        },
      );
    }
    const bounds = sceneNodeBounds(node);
    if (!bounds || bounds.width < 0.5 || bounds.height < 0.5) {
      throw new HostError("capture_failed", `Layer "${target.layerId}" has no area to capture.`, {
        hint: 'Give it a size, or use target "viewer" for the whole screen.',
      });
    }
    crop = bounds;
  }
  let scale =
    typeof request.scale === "number" && request.scale > 0 ? Math.min(request.scale, 3) : 1;
  if (request.maxWidth && crop.width * scale > request.maxWidth)
    scale = request.maxWidth / crop.width;
  const edge = Math.max(crop.width, crop.height) * scale;
  if (edge > MAX_SCREENSHOT_EDGE) scale *= MAX_SCREENSHOT_EDGE / edge;
  const maxBytes = request.maxBytes ?? MAX_SCREENSHOT_BYTES;
  for (let attempt = 0; ; attempt++) {
    const drawing = renderSceneSvg(scene, {
      crop,
      scale,
      ...(request.assets ? { resolveAsset: request.assets } : {}),
    });
    let image: RasterImage;
    try {
      image = await rasterizeSvg(drawing.svg, { hasText: drawing.hasText });
    } catch (err) {
      // resvg panics on some clipped images inside a cropped viewBox: draw the whole screen and cut the layer out.
      if (target.kind !== "layer" || !isHostError(err) || err.code !== "screenshot_renderer_crashed") throw err;
      const whole = renderSceneSvg(scene, { scale, ...(request.assets ? { resolveAsset: request.assets } : {}) });
      image = await rasterizeSvg(whole.svg, { hasText: whole.hasText, crop: { x: crop.x * scale, y: crop.y * scale, width: crop.width * scale, height: crop.height * scale } });
    }
    if (image.png.byteLength <= maxBytes) {
      return {
        data: Buffer.from(image.png).toString("base64"),
        mimeType: "image/png",
        width: image.width,
        height: image.height,
        timeMs: Math.round(scene.time * 100000) / 100,
        notes: drawing.notes,
      };
    }
    if (attempt >= 3 || image.width <= 64) {
      throw new HostError(
        "image_too_large",
        `The screenshot is still ${Math.round(image.png.byteLength / 1024)} KB at ${image.width}×${image.height}, over the ${Math.round(maxBytes / 1024)} KB limit.`,
        {
          hint: "Pass a smaller maxWidth or scale, or capture one layer.",
        },
      );
    }
    scale *= Math.max(0.25, Math.sqrt(maxBytes / image.png.byteLength) * 0.9);
  }
}
