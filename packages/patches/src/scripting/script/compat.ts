/**
 * Origami-style scripts: a file body that builds `new Patch()` and returns it. This module installs
 * the extra globals (Patch, PatchInput, PatchOutput, types, Http, Base64, Image, console.watch) and
 * converts between Sonobe values and Origami's `{ x, y, z, w }` shapes.
 */

import type { ValueType } from "@sonobe/core";
import { newCapability, promiseResolve, type SafePromise } from "../sandbox/promise.ts";
import { callValue, getProp, isObjectLike } from "../sandbox/realm.ts";
import { ORIGAMI_TYPES } from "./header.ts";
import { ScriptAbortController, decodeUtf8Base64, encodeUtf8Base64 } from "./web.ts";

/** What the Origami globals need from the running instance. */
export interface CompatBridge {
  /** This frame's value of declared input `index`, in Origami shape. */
  inputValue(index: number): unknown;
  inputValues(index: number): unknown[];
  isDirty(index: number): boolean;
  readRising(index: number): boolean;
  readFalling(index: number): boolean;
  setOutput(index: number, value: unknown): void;
  setOutputValues(index: number, values: unknown): void;
  pulseOutput(index: number): void;
  /** The active variant's constant name ("POSITION"), or null. */
  typeName(): string | null;
  /** The script-level fetch function. */
  fetch: (url: unknown, init?: unknown) => unknown;
  watch(args: unknown[]): void;
}

const VECTOR_KEYS: Partial<Record<ValueType, readonly string[]>> = { point: ["x", "y"], size: ["x", "y"], anchor: ["x", "y"], point3d: ["x", "y", "z"], point4d: ["x", "y", "z", "w"] };

/** A Sonobe script value as Origami sees it: vectors and colors as `{ x, y, z, w }`. */
export function toOrigamiValue(value: unknown, type: ValueType): unknown {
  const keys = VECTOR_KEYS[type];
  if (keys && Array.isArray(value)) return Object.fromEntries(keys.map((k, i) => [k, value[i] ?? 0]));
  if (type === "color" && isObjectLike(value)) {
    const c = value as { r?: number; g?: number; b?: number; a?: number };
    return { x: c.r ?? 0, y: c.g ?? 0, z: c.b ?? 0, w: c.a ?? 1 };
  }
  return value;
}

/** An Origami-shaped value converted to the shapes the Sonobe conversions accept. */
export function fromOrigamiValue(value: unknown, type: ValueType): unknown {
  if (type === "color" && isObjectLike(value) && getProp(value, "r") === undefined && getProp(value, "x") !== undefined) {
    const w = getProp(value, "w");
    return { r: getProp(value, "x"), g: getProp(value, "y"), b: getProp(value, "z"), a: w === undefined ? 1 : w };
  }
  return value;
}

const PATCHES = new WeakSet<object>();

/** True for objects made by the Origami `Patch` constructor. */
export function isCompatPatch(value: unknown): value is object {
  return isObjectLike(value) && PATCHES.has(value);
}

function portIndex(port: object, side: "inputs" | "outputs", patch: object): number {
  const list = getProp(patch, side);
  return Array.isArray(list) ? list.indexOf(port) : -1;
}

function rejected(message: string): SafePromise {
  const capability = newCapability();
  capability.reject(new Error(message));
  return capability.promise;
}

/** Install the Origami globals into a realm's global object. `patchOf` finds the script's patch. */
export function installCompatGlobals(global: Record<string, unknown>, bridge: CompatBridge, patchOf: () => object | null): void {
  const indexOf = (port: object, side: "inputs" | "outputs"): number => {
    const patch = patchOf();
    const index = patch ? portIndex(port, side, patch) : -1;
    if (index < 0) throw new Error(`This ${side === "inputs" ? "PatchInput" : "PatchOutput"} isn't in patch.${side}, so it has no value.`);
    return index;
  };

  function Patch(this: Record<string, unknown>) {
    if (!new.target) throw new TypeError("Patch needs new: var patch = new Patch();");
    this.inputs = [];
    this.outputs = [];
    this.variants = [];
    this.loopAware = false;
    this.alwaysNeedsToEvaluate = false;
    PATCHES.add(this);
  }
  Object.defineProperty(Patch.prototype, "type", { get: () => bridge.typeName(), enumerable: false, configurable: true });

  function PatchInput(this: Record<string, unknown>, name?: unknown, type?: unknown, defaultValue?: unknown) {
    if (!new.target) throw new TypeError("PatchInput needs new.");
    this.name = name === undefined ? "" : String(name);
    this.type = type;
    this.defaultValue = defaultValue;
  }
  Object.defineProperties(PatchInput.prototype, {
    value: { get(this: object) { return bridge.inputValue(indexOf(this, "inputs")); }, configurable: true },
    values: { get(this: object) { return bridge.inputValues(indexOf(this, "inputs")); }, configurable: true },
    isDirty: { value(this: object) { return bridge.isDirty(indexOf(this, "inputs")); }, writable: true, configurable: true },
    readRising: { value(this: object) { return bridge.readRising(indexOf(this, "inputs")); }, writable: true, configurable: true },
    readFalling: { value(this: object) { return bridge.readFalling(indexOf(this, "inputs")); }, writable: true, configurable: true },
  });

  function PatchOutput(this: Record<string, unknown>, name?: unknown, type?: unknown, defaultValue?: unknown) {
    if (!new.target) throw new TypeError("PatchOutput needs new.");
    this.name = name === undefined ? "" : String(name);
    this.type = type;
    this.defaultValue = defaultValue;
  }
  Object.defineProperties(PatchOutput.prototype, {
    value: {
      get() {
        return undefined;
      },
      set(this: object, value: unknown) {
        bridge.setOutput(indexOf(this, "outputs"), value);
      },
      configurable: true,
    },
    values: {
      get() {
        return undefined;
      },
      set(this: object, values: unknown) {
        bridge.setOutputValues(indexOf(this, "outputs"), values);
      },
      configurable: true,
    },
    pulse: { value(this: object) { bridge.pulseOutput(indexOf(this, "outputs")); }, writable: true, configurable: true },
  });

  const types: Record<string, string> = {};
  for (const name of Object.keys(ORIGAMI_TYPES)) types[name] = name;

  const request = (method: unknown, url: unknown, options?: unknown): SafePromise => {
    const opts = isObjectLike(options) ? options : {};
    for (const unsupported of ["responseType", "onData"]) {
      if (getProp(opts, unsupported) !== undefined) return rejected(`Http option ${unsupported} isn't supported yet.`);
    }
    if (getProp(opts, "contentType") === "formData") return rejected('Http option contentType: "formData" isn\'t supported yet.');
    let href = String(url);
    const params = getProp(opts, "urlParameters");
    if (isObjectLike(params)) {
      const query = Object.keys(params)
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(getProp(params, k)))}`)
        .join("&");
      if (query) href += (href.includes("?") ? "&" : "?") + query;
    }
    const controller = new ScriptAbortController();
    const init: Record<string, unknown> = { method: String(method ?? "GET").toUpperCase(), signal: controller.signal };
    const headers = getProp(opts, "headers");
    if (headers !== undefined) init.headers = headers;
    const body = getProp(opts, "body");
    if (body !== undefined) init.body = body;
    const fetched = promiseResolve(bridge.fetch(href, init));
    const response = fetched.then((res: unknown) =>
      promiseResolve(callValue(getProp(res, "text"), res, [])).then((text: unknown) => {
        const bodyText = String(text);
        const headers: Record<string, string> = {};
        const source = getProp(res, "headers");
        const forEach = isObjectLike(source) ? getProp(source, "forEach") : undefined;
        if (typeof forEach === "function") callValue(forEach, source, [(value: unknown, name: unknown) => void (headers[String(name)] = String(value))]);
        return {
          ok: getProp(res, "ok"),
          status: getProp(res, "status"),
          statusCode: getProp(res, "status"),
          headers,
          text: () => bodyText,
          json: () => {
            try {
              return JSON.parse(bodyText);
            } catch {
              return undefined;
            }
          },
        };
      }),
    );
    Object.defineProperty(response, "cancel", { value: () => controller.abort(new Error("Request cancelled")), enumerable: false });
    return response;
  };
  const json = (promise: SafePromise) => promise.then((res: unknown) => callValue(getProp(res, "json"), res, []));
  const Http = {
    request,
    get: (url: unknown, options?: unknown) => request("GET", url, options),
    post: (url: unknown, body?: unknown, options?: unknown) => request("POST", url, { ...(isObjectLike(options) ? options : {}), body }),
    getJson: (url: unknown, options?: unknown) => json(request("GET", url, options)),
    postJson: (url: unknown, data?: unknown, options?: unknown) => json(request("POST", url, { ...(isObjectLike(options) ? options : {}), body: data })),
  };

  const Base64 = {
    encode(data: unknown): SafePromise {
      if (typeof data !== "string") return rejected("Base64.encode of ArrayBuffers and images isn't supported yet. Pass text.");
      return promiseResolve(encodeUtf8Base64(data));
    },
    decode(text: unknown, target: unknown = "text"): SafePromise {
      if (target !== "text") return rejected(`Base64.decode to "${String(target)}" isn't supported yet. Decode to "text".`);
      const decoded = decodeUtf8Base64(String(text));
      return decoded === null ? rejected("Base64.decode got text that isn't valid base64.") : promiseResolve(decoded);
    },
  };

  const pixels = () => {
    throw new Error("Reading and writing pixels isn't supported yet.");
  };
  function Image(this: Record<string, unknown>, _source?: unknown, width?: unknown, height?: unknown) {
    if (!new.target) throw new TypeError("Image needs new.");
    this.width = Number(width) || 0;
    this.height = Number(height) || 0;
    this.format = "rgba";
  }
  Object.defineProperties(Image.prototype, {
    getPixelAt: { value: pixels, writable: true, configurable: true },
    setPixelAt: { value: pixels, writable: true, configurable: true },
  });

  global.Patch = Patch;
  global.PatchInput = PatchInput;
  global.PatchOutput = PatchOutput;
  global.types = types;
  global.Http = Http;
  global.Base64 = Base64;
  global.Image = Image;
  const console = global.console as Record<string, unknown> | undefined;
  if (console) console.watch = (...args: unknown[]) => bridge.watch(args);
}
