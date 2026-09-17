/**
 * Shader layers: GLSL ES 3.00 fragment code with ShaderToy-style `mainImage`, drawn by one
 * shared WebGL2 context and copied into each layer's 2D canvas. Sharing a context keeps any
 * number of shader layers under the browser's WebGL context limit.
 *
 * Coordinates follow Sonobe (and Origami's Shader Layer): `fragCoord` is in device pixels
 * with the origin at the layer's top-left and +Y down. Textures are uploaded top row first,
 * so `texture(iChannel0, fragCoord / iResolution.xy)` shows an image upright.
 *
 * Textures: `iChannel0`–`iChannel3`, and any other `sampler2D` uniform, sample an image named
 * in the `uniforms` prop, e.g. `{"iChannel0": {"asset": "photo", "wrap": "clamp"}}`
 * (`wrap`: repeat | clamp | mirror, `filter`: mipmap | linear | nearest). Unset channels are
 * transparent. Limitation: a shader layer's children are drawn as DOM above the canvas and are
 * not captured into iChannel0 (the DOM has no synchronous DOM-to-texture path).
 */

import { readAssetUrl, readNumber } from "./values.ts";

export interface ShaderCompileError {
  message: string;
  /** Line in the user's code (1-based), when the log names one. */
  line: number | null;
}

export type TextureWrap = "repeat" | "clamp" | "mirror";
export type TextureFilter = "mipmap" | "linear" | "nearest";

/** An image bound to a sampler uniform. */
export interface TextureSpec {
  url: string;
  wrap: TextureWrap;
  filter: TextureFilter;
}

export interface ShaderInputs {
  /** [width px, height px, pixel ratio]. */
  resolution: [number, number, number];
  time: number;
  timeDelta: number;
  frame: number;
  /** [x, y, clickX, clickY] in layer pixels, top-left origin; click coords are negative while released. */
  mouse: [number, number, number, number];
  /** Extra uniform values by name (from the `uniforms` prop or published ports). */
  uniform: (name: string) => unknown;
  /** Image for a sampler uniform (iChannel0..3 or a custom sampler2D); null leaves it transparent. */
  texture?: (name: string) => TextureSpec | null;
}

export interface FragmentSource {
  source: string;
  /** Lines added before the user's code (subtract from log line numbers). */
  lineOffset: number;
  userLines: number;
}

const BUILTIN_UNIFORMS = ["iResolution", "iTime", "iTimeDelta", "iFrame", "iMouse", "iChannel0", "iChannel1", "iChannel2", "iChannel3", "iChannelResolution"];

const PRELUDE_UNIFORMS = `uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iMouse;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec3 iChannelResolution[4];
`;

const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const lineCount = (s: string) => s.split("\n").length - 1;

/**
 * Wraps user code into a complete fragment shader:
 * - code with `#version` is used verbatim
 * - code with `main()` but no `mainImage` gets the version, precision, and built-in uniforms
 * - otherwise `mainImage(out vec4, in vec2)` is called from a generated `main()`, and the
 *   output is premultiplied for compositing
 * Redundant declarations of the built-in uniforms are blanked (line numbers are preserved).
 */
export function buildFragmentSource(code: string): FragmentSource {
  const userLines = code.split("\n").length;
  if (/^\s*#version\b/m.test(code)) return { source: code, lineOffset: 0, userLines };
  const builtinDecl = new RegExp(`^\\s*uniform\\s+\\w+\\s+(?:${BUILTIN_UNIFORMS.join("|")})\\s*(?:\\[[^\\]]*\\])?\\s*;[^\\n]*$`, "gm");
  const body = code.replace(builtinDecl, "");
  const hasMainImage = /\bmainImage\s*\(/.test(code);
  const hasMain = /\bvoid\s+main\s*\(\s*(?:void)?\s*\)/.test(code);
  if (!hasMainImage && hasMain) {
    const prelude = `#version 300 es\nprecision highp float;\nprecision highp int;\n${PRELUDE_UNIFORMS}`;
    return { source: prelude + body, lineOffset: lineCount(prelude), userLines };
  }
  const prelude = `#version 300 es\nprecision highp float;\nprecision highp int;\n${PRELUDE_UNIFORMS}out vec4 sonobe_fragColor;\n`;
  const main = `
void main() {
  vec4 sonobe_color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(sonobe_color, vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y));
  float sonobe_a = clamp(sonobe_color.a, 0.0, 1.0);
  sonobe_fragColor = vec4(clamp(sonobe_color.rgb, 0.0, 1.0) * sonobe_a, sonobe_a);
}
`;
  return { source: prelude + body + main, lineOffset: lineCount(prelude), userLines };
}

/** Turns a GLSL info log into a friendly error pointing at the user's line numbers. */
export function parseShaderLog(log: string, lineOffset: number, userLines: number): ShaderCompileError {
  const re = /(?:ERROR|WARNING):\s*\d+:(\d+):\s*([^\n]*)/g;
  const messages: string[] = [];
  let firstLine: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) {
    const raw = Number(m[1]);
    const line = raw - lineOffset;
    const inUser = line >= 1 && line <= userLines;
    if (inUser && firstLine === null) firstLine = line;
    messages.push(inUser ? `Line ${line}: ${m[2]!.trim()}` : m[2]!.trim());
  }
  const message = messages.length > 0 ? messages.join("\n") : log.trim() || "The shader failed to compile.";
  return { message, line: firstLine };
}

/**
 * Reads a sampler uniform value: `{ asset }`, `{ assetId }`, `{ url }`, or a URL string, with
 * optional `wrap` (default repeat, like ShaderToy) and `filter` (default mipmap).
 */
export function readTextureSpec(value: unknown, resolveAssetUrl: (assetId: string) => string | undefined): TextureSpec | null {
  const url = readAssetUrl(value, resolveAssetUrl);
  if (!url) return null;
  const o = value && typeof value === "object" ? (value as { wrap?: unknown; filter?: unknown }) : {};
  const wrap: TextureWrap = o.wrap === "clamp" || o.wrap === "mirror" ? o.wrap : "repeat";
  const filter: TextureFilter = o.filter === "linear" || o.filter === "nearest" ? o.filter : "mipmap";
  return { url, wrap, filter };
}

interface UniformInfo {
  location: WebGLUniformLocation;
  type: number;
}

interface ProgramEntry {
  program: WebGLProgram | null;
  uniforms: Map<string, UniformInfo>;
  error: ShaderCompileError | null;
}

interface TextureEntry {
  status: "loading" | "loaded" | "error";
  image: HTMLImageElement | null;
  /** Uploaded texture; null until the image loads (and again after a context loss). */
  texture: WebGLTexture | null;
  width: number;
  height: number;
}

/** Normalizes a uniform value (number, boolean, vector, Color) to n floats. */
export function uniformVector(value: unknown, n: number): number[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const c = value as { r?: unknown; g?: unknown; b?: unknown; a?: unknown };
    if (typeof c.r === "number") return [c.r, readNumber(c.g, 0), readNumber(c.b, 0), readNumber(c.a, 1)].slice(0, n);
  }
  if (Array.isArray(value)) return Array.from({ length: n }, (_, i) => readNumber(value[i], 0));
  const v = readNumber(value, 0);
  return Array.from({ length: n }, () => v);
}

type GLCanvas = HTMLCanvasElement | OffscreenCanvas;

type TargetContext = { kind: "bitmap"; ctx: ImageBitmapRenderingContext } | { kind: "2d"; ctx: CanvasRenderingContext2D };

const targetContexts = new WeakMap<HTMLCanvasElement, TargetContext | null>();

/** A layer canvas keeps one context type for life: "bitmaprenderer" when transfers are possible, else "2d". */
function targetContext(target: HTMLCanvasElement, preferBitmap: boolean): TargetContext | null {
  if (targetContexts.has(target)) return targetContexts.get(target)!;
  let out: TargetContext | null = null;
  try {
    const bitmap = preferBitmap ? target.getContext("bitmaprenderer") : null;
    if (bitmap) out = { kind: "bitmap", ctx: bitmap };
    else {
      const ctx = target.getContext("2d");
      if (ctx) out = { kind: "2d", ctx };
    }
  } catch {
    out = null;
  }
  // Don't lock in "no context" before GL exists; a later draw may be able to transfer.
  if (out) targetContexts.set(target, out);
  return out;
}

function clearTarget(out: TargetContext | null, w: number, h: number): void {
  if (out?.kind === "bitmap") out.ctx.transferFromImageBitmap(null);
  else out?.ctx.clearRect(0, 0, w, h);
}

/** Cross-origin http(s) images need CORS to be uploaded; data:, blob:, and file: URLs don't. */
function needsCors(url: string, doc: Document | undefined): boolean {
  if (!/^https?:/i.test(url)) return false;
  try {
    const base = doc?.baseURI;
    return new URL(url, base).origin !== (base ? new URL(base).origin : "");
  } catch {
    return false;
  }
}

const MAX_PROGRAMS = 64;
const MAX_TEXTURES = 32;
const MAX_DIMENSION = 4096;
const CHANNEL = /^iChannel([0-3])$/;

/** One WebGL2 context shared by every shader layer of a renderer. */
export class ShaderHost {
  private readonly doc: Document | undefined;
  private canvas: GLCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private vertex: WebGLShader | null = null;
  private emptyTexture: WebGLTexture | null = null;
  private readonly programs = new Map<string, ProgramEntry>();
  private readonly textures = new Map<string, TextureEntry>();
  private readonly samplers = new Map<string, WebGLSampler>();
  private readonly textureListeners = new Set<() => void>();
  private readonly channelResolution = new Float32Array(12);
  private unavailable: ShaderCompileError | null = null;
  private lost = false;
  private version = 0;

  constructor(doc?: Document) {
    this.doc = doc;
  }

  /** True once a WebGL2 context exists (attempts creation on first call). */
  available(): boolean {
    return this.ensureContext() !== null;
  }

  /** Increments when a texture finishes loading or fails; include it in redraw signatures. */
  get textureVersion(): number {
    return this.version;
  }

  /** Called whenever a texture finishes loading or fails. Returns an unsubscribe function. */
  onTextureChange(listener: () => void): () => void {
    this.textureListeners.add(listener);
    return () => this.textureListeners.delete(listener);
  }

  /**
   * Renders the shader into `target` at w × h device pixels. Returns a compile error
   * (or unavailability reason) instead of throwing; the target is cleared in that case.
   */
  draw(code: string, target: HTMLCanvasElement, w: number, h: number, inputs: ShaderInputs): ShaderCompileError | null {
    w = Math.max(1, Math.min(MAX_DIMENSION, Math.round(w)));
    h = Math.max(1, Math.min(MAX_DIMENSION, Math.round(h)));
    if (target.width !== w) target.width = w;
    if (target.height !== h) target.height = h;
    const gl = this.ensureContext();
    const canvas = this.canvas;
    const transfer = !!canvas && typeof (canvas as OffscreenCanvas).transferToImageBitmap === "function";
    const out = targetContext(target, transfer);
    if (!gl || !canvas) {
      clearTarget(out, w, h);
      return this.unavailable ?? { message: "WebGL2 is not available on this device.", line: null };
    }
    const entry = this.program(gl, code);
    if (!entry.program) {
      clearTarget(out, w, h);
      return entry.error;
    }
    if (out?.kind === "bitmap") {
      // Exact-size buffer, handed to the layer canvas without a pixel copy.
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    } else if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(entry.program);
    this.bindTextures(gl, entry, inputs);
    for (const [name, u] of entry.uniforms) if (u.type !== gl.SAMPLER_2D) this.setUniform(gl, name, u, inputs);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (out?.kind === "bitmap") {
      out.ctx.transferFromImageBitmap((canvas as OffscreenCanvas).transferToImageBitmap());
    } else if (out?.kind === "2d") {
      out.ctx.clearRect(0, 0, w, h);
      out.ctx.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, w, h);
    }
    return null;
  }

  dispose(): void {
    const gl = this.gl;
    if (gl && !this.lost) {
      for (const e of this.programs.values()) if (e.program) gl.deleteProgram(e.program);
      for (const t of this.textures.values()) if (t.texture) gl.deleteTexture(t.texture);
      for (const s of this.samplers.values()) gl.deleteSampler(s);
      if (this.vertex) gl.deleteShader(this.vertex);
      if (this.emptyTexture) gl.deleteTexture(this.emptyTexture);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    for (const t of this.textures.values()) {
      if (t.image) {
        t.image.onload = null;
        t.image.onerror = null;
      }
    }
    this.programs.clear();
    this.textures.clear();
    this.samplers.clear();
    this.textureListeners.clear();
    this.gl = null;
    this.canvas = null;
  }

  private ensureContext(): WebGL2RenderingContext | null {
    if (this.gl && !this.lost) return this.gl;
    if (this.unavailable) return null;
    if (this.lost) return null;
    try {
      const canvas: GLCanvas | null =
        typeof OffscreenCanvas === "function" ? new OffscreenCanvas(256, 256) : (this.doc?.createElement("canvas") ?? null);
      const gl = canvas?.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false, depth: false, stencil: false }) as WebGL2RenderingContext | null | undefined;
      if (!canvas || !gl) {
        this.unavailable = { message: "WebGL2 is not available on this device.", line: null };
        return null;
      }
      canvas.addEventListener("webglcontextlost", (e: Event) => {
        e.preventDefault();
        this.lost = true;
        this.programs.clear();
        this.samplers.clear();
        for (const t of this.textures.values()) t.texture = null;
      });
      canvas.addEventListener("webglcontextrestored", () => {
        this.lost = false;
        this.initResources(gl);
      });
      this.canvas = canvas;
      this.gl = gl;
      this.initResources(gl);
      return gl;
    } catch (err) {
      this.unavailable = { message: `WebGL2 could not start: ${String(err)}`, line: null };
      return null;
    }
  }

  private initResources(gl: WebGL2RenderingContext): void {
    this.programs.clear();
    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (vs) {
      gl.shaderSource(vs, VERTEX_SHADER);
      gl.compileShader(vs);
    }
    this.vertex = vs;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.emptyTexture = tex;
  }

  private program(gl: WebGL2RenderingContext, code: string): ProgramEntry {
    const cached = this.programs.get(code);
    if (cached) {
      this.programs.delete(code);
      this.programs.set(code, cached);
      return cached;
    }
    const entry = this.compile(gl, code);
    if (this.programs.size >= MAX_PROGRAMS) {
      const oldest = this.programs.keys().next().value as string;
      const old = this.programs.get(oldest);
      if (old?.program) gl.deleteProgram(old.program);
      this.programs.delete(oldest);
    }
    this.programs.set(code, entry);
    return entry;
  }

  private compile(gl: WebGL2RenderingContext, code: string): ProgramEntry {
    const { source, lineOffset, userLines } = buildFragmentSource(code);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fs || !this.vertex) return { program: null, uniforms: new Map(), error: { message: "Could not create a shader.", line: null } };
    gl.shaderSource(fs, source);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const error = parseShaderLog(gl.getShaderInfoLog(fs) ?? "", lineOffset, userLines);
      gl.deleteShader(fs);
      return { program: null, uniforms: new Map(), error };
    }
    const program = gl.createProgram();
    if (!program) return { program: null, uniforms: new Map(), error: { message: "Could not create a shader program.", line: null } };
    gl.attachShader(program, this.vertex);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = parseShaderLog(gl.getProgramInfoLog(program) ?? "", lineOffset, userLines);
      gl.deleteProgram(program);
      return { program: null, uniforms: new Map(), error };
    }
    const uniforms = new Map<string, UniformInfo>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const location = gl.getUniformLocation(program, info.name);
      if (location) uniforms.set(info.name.replace(/\[0\]$/, ""), { location, type: info.type });
    }
    return { program, uniforms, error: null };
  }

  /** Binds every active sampler: iChannelN to unit N, other samplers to units 4+. Fills iChannelResolution. */
  private bindTextures(gl: WebGL2RenderingContext, entry: ProgramEntry, inputs: ShaderInputs): void {
    const res = this.channelResolution;
    res.fill(0);
    const maxUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
    let nextUnit = 4;
    for (const [name, u] of entry.uniforms) {
      if (u.type !== gl.SAMPLER_2D) continue;
      const channel = CHANNEL.exec(name);
      const unit = channel ? Number(channel[1]) : nextUnit++;
      if (unit >= maxUnits) continue;
      const spec = inputs.texture?.(name) ?? null;
      const tex = spec ? this.texture(gl, spec.url) : null;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex?.texture ?? this.emptyTexture);
      gl.bindSampler(unit, spec && tex?.texture ? this.sampler(gl, spec) : null);
      gl.uniform1i(u.location, unit);
      if (channel && tex?.texture) {
        res[unit * 3] = tex.width;
        res[unit * 3 + 1] = tex.height;
        res[unit * 3 + 2] = 1;
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Texture for an image URL, loading it on first use (a finished load notifies listeners). */
  private texture(gl: WebGL2RenderingContext, url: string): TextureEntry {
    const cached = this.textures.get(url);
    if (cached) {
      this.textures.delete(url);
      this.textures.set(url, cached);
      if (cached.status === "loaded" && !cached.texture) this.upload(gl, cached);
      return cached;
    }
    const entry: TextureEntry = { status: "loading", image: null, texture: null, width: 0, height: 0 };
    if (this.textures.size >= MAX_TEXTURES) {
      const oldest = this.textures.keys().next().value as string;
      const old = this.textures.get(oldest);
      if (old?.texture) gl.deleteTexture(old.texture);
      if (old?.image) old.image.onload = old.image.onerror = null;
      this.textures.delete(oldest);
    }
    this.textures.set(url, entry);
    const img = this.doc?.createElement("img") ?? (typeof Image === "function" ? new Image() : null);
    if (!img) {
      entry.status = "error";
      return entry;
    }
    entry.image = img;
    if (needsCors(url, this.doc)) img.crossOrigin = "anonymous";
    img.decoding = "async";
    const settle = () => {
      img.onload = img.onerror = null;
      if (this.textures.get(url) !== entry) return;
      const live = this.gl;
      if (entry.status === "loaded" && live && !this.lost) this.upload(live, entry);
      this.version++;
      for (const listener of [...this.textureListeners]) listener();
    };
    img.onload = () => {
      entry.status = "loaded";
      entry.width = img.naturalWidth;
      entry.height = img.naturalHeight;
      settle();
    };
    img.onerror = () => {
      entry.status = "error";
      settle();
    };
    img.src = url;
    return entry;
  }

  private upload(gl: WebGL2RenderingContext, entry: TextureEntry): void {
    const img = entry.image;
    if (!img || entry.width <= 0 || entry.height <= 0) return;
    const tex = gl.createTexture();
    if (!tex) return;
    try {
      let source: TexImageSource = img;
      const max = Math.min(MAX_DIMENSION * 2, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
      if (entry.width > max || entry.height > max) {
        const k = max / Math.max(entry.width, entry.height);
        const w = Math.max(1, Math.floor(entry.width * k));
        const h = Math.max(1, Math.floor(entry.height * k));
        const scaled = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : this.doc?.createElement("canvas");
        if (!scaled) throw new Error("no canvas");
        scaled.width = w;
        scaled.height = h;
        (scaled.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null)?.drawImage(img, 0, 0, w, h);
        source = scaled;
        entry.width = w;
        entry.height = h;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      entry.texture = tex;
    } catch {
      // Tainted (cross-origin without CORS) or undecodable images stay transparent.
      gl.deleteTexture(tex);
      entry.status = "error";
    }
  }

  private sampler(gl: WebGL2RenderingContext, spec: TextureSpec): WebGLSampler | null {
    const key = `${spec.wrap}|${spec.filter}`;
    const cached = this.samplers.get(key);
    if (cached) return cached;
    const s = gl.createSampler();
    if (!s) return null;
    const wrap = spec.wrap === "clamp" ? gl.CLAMP_TO_EDGE : spec.wrap === "mirror" ? gl.MIRRORED_REPEAT : gl.REPEAT;
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap);
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, spec.filter === "nearest" ? gl.NEAREST : spec.filter === "linear" ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, spec.filter === "nearest" ? gl.NEAREST : gl.LINEAR);
    this.samplers.set(key, s);
    return s;
  }

  private setUniform(gl: WebGL2RenderingContext, name: string, u: UniformInfo, inputs: ShaderInputs): void {
    const loc = u.location;
    switch (name) {
      case "iResolution":
        gl.uniform3f(loc, inputs.resolution[0], inputs.resolution[1], inputs.resolution[2]);
        return;
      case "iTime":
        gl.uniform1f(loc, inputs.time);
        return;
      case "iTimeDelta":
        gl.uniform1f(loc, inputs.timeDelta);
        return;
      case "iFrame":
        gl.uniform1i(loc, inputs.frame);
        return;
      case "iMouse":
        gl.uniform4f(loc, inputs.mouse[0], inputs.mouse[1], inputs.mouse[2], inputs.mouse[3]);
        return;
      case "iChannelResolution":
        gl.uniform3fv(loc, this.channelResolution);
        return;
    }
    const value = inputs.uniform(name);
    if (value === undefined) return;
    switch (u.type) {
      case gl.FLOAT:
        gl.uniform1f(loc, uniformVector(value, 1)[0]!);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(loc, uniformVector(value, 2));
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(loc, uniformVector(value, 3));
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(loc, uniformVector(value, 4));
        break;
      case gl.INT:
      case gl.BOOL:
        gl.uniform1i(loc, Math.round(uniformVector(value, 1)[0]!));
        break;
      case gl.INT_VEC2:
      case gl.BOOL_VEC2:
        gl.uniform2iv(loc, uniformVector(value, 2).map(Math.round));
        break;
      case gl.INT_VEC3:
      case gl.BOOL_VEC3:
        gl.uniform3iv(loc, uniformVector(value, 3).map(Math.round));
        break;
      case gl.INT_VEC4:
      case gl.BOOL_VEC4:
        gl.uniform4iv(loc, uniformVector(value, 4).map(Math.round));
        break;
      case gl.FLOAT_MAT2:
        gl.uniformMatrix2fv(loc, false, uniformVector(value, 4));
        break;
      case gl.FLOAT_MAT3:
        gl.uniformMatrix3fv(loc, false, uniformVector(value, 9));
        break;
      case gl.FLOAT_MAT4:
        gl.uniformMatrix4fv(loc, false, uniformVector(value, 16));
        break;
    }
  }
}
