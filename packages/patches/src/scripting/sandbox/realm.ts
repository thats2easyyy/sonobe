/**
 * The sandbox realm: per-instance globals, invocation budgets, the synchronous job queue, and the
 * guards between script code and host objects.
 *
 * Script values are ordinary JavaScript values, so the guards keep host capabilities out of reach:
 * - every value read from a property or returned by a native call passes through `substitute`, which
 *   swaps host constructors that could compile code (Function and friends), reflect on or mutate
 *   built-ins (Object, Reflect), or read wall-clock time (Date) for safe versions;
 * - built-in objects are "intrinsics": script code can read them but never write to them;
 * - native mutators (Array.prototype.push...) can't be pointed at intrinsics.
 * This isn't a WebAssembly isolate (see the javascript patch's known gaps), but it never runs script
 * text through `eval` or `Function`, and runaway scripts stop at their budget.
 */

import { SafePromise } from "./promise.ts";

/** Maximum nesting of script function calls. */
export const MAX_CALL_DEPTH = 256;
/** Interrupt checks allowed per invocation in deterministic runtimes. */
export const DETERMINISTIC_TICK_LIMIT = 2_000_000;
/** Wall-clock milliseconds allowed per invocation in live runtimes. */
export const LIVE_BUDGET_MS = 50;
/** Longest string a script may build (64 MB of UTF-16). */
export const MAX_STRING_LENGTH = 32 * 1024 * 1024;

export const TOO_LONG_MESSAGE = "The script took too long. Check for a loop that never ends.";
export const TOO_MUCH_MEMORY_MESSAGE = "The script used too much memory.";

/** Stops an invocation. Script `try/catch` and promise machinery never catch it. */
export class InternalAbort extends Error {
  readonly reason: "timeout" | "memory";
  constructor(reason: "timeout" | "memory") {
    super(reason === "timeout" ? TOO_LONG_MESSAGE : TOO_MUCH_MEMORY_MESSAGE);
    this.reason = reason;
  }
}

/** Host callbacks a realm needs from the patch instance that owns it. */
export interface RealmHooks {
  /** A job, timer callback, or `evaluate` call is about to run: start staging outputs. */
  beginSegment(): void;
  /** The segment finished; `threw` means a script exception escaped it, so staged outputs are discarded. */
  endSegment(threw: boolean): void;
  unhandledRejection(reason: unknown): void;
  /** Epoch milliseconds for Date. */
  now(): number;
  /** Milliseconds for performance.now(). */
  perfNow(): number;
  /** Seeded random number in [0, 1). */
  random(): number;
}

/** The realm whose code is running, plus the current statement offset for error positions. */
export const ACTIVE: { realm: Realm | null; pos: number; thrownPos: number } = { realm: null, pos: 0, thrownPos: 0 };

/** Source offsets where error objects were thrown. */
export const ERROR_POSITIONS = new WeakMap<object, number>();

/** Remember where `value` was thrown (the first time only). */
export function markThrown(value: unknown): void {
  ACTIVE.thrownPos = ACTIVE.pos;
  if (isObjectLike(value) && !ERROR_POSITIONS.has(value)) ERROR_POSITIONS.set(value, ACTIVE.pos);
}

/** Record the current statement for a caught error nothing marked yet (native exceptions). */
export function markCaught(value: unknown): void {
  if (isObjectLike(value) && !ERROR_POSITIONS.has(value)) ERROR_POSITIONS.set(value, ACTIVE.pos);
}

/** Offset where `value` was thrown: the recorded position, or the current statement. */
export function thrownPosition(value: unknown): number {
  if (isObjectLike(value)) return ERROR_POSITIONS.get(value) ?? ACTIVE.pos;
  return ACTIVE.thrownPos;
}

export function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

export class Realm {
  readonly global: Record<string, unknown>;
  readonly hooks: RealmHooks;
  deterministic: boolean;
  /** Allow assigning to undeclared names (Origami-style scripts). */
  sloppyGlobals = false;
  depth = 0;
  private ticks = 0;
  private nextCheck = 0;
  private deadline = 0;
  private readonly jobs: (() => boolean | void)[] = [];
  private jobHead = 0;
  private draining = false;
  readonly pendingRejections = new Map<object, unknown>();

  constructor(hooks: RealmHooks, deterministic: boolean) {
    this.hooks = hooks;
    this.deterministic = deterministic;
    this.global = createStandardGlobals(this);
    this.global.globalThis = this.global;
  }

  /** Start a new invocation budget. */
  beginInvocation(): void {
    this.ticks = 0;
    this.depth = 0;
    if (this.deterministic) this.nextCheck = DETERMINISTIC_TICK_LIMIT;
    else {
      this.nextCheck = 256;
      this.deadline = performance.now() + LIVE_BUDGET_MS;
    }
  }

  /** An interrupt check: loop iterations and function calls. */
  tick(): void {
    if (++this.ticks < this.nextCheck) return;
    if (this.deterministic) throw new InternalAbort("timeout");
    if (performance.now() > this.deadline) throw new InternalAbort("timeout");
    this.nextCheck = this.ticks + 256;
  }

  enqueue(job: () => boolean | void): void {
    this.jobs.push(job);
  }

  get hasJobs(): boolean {
    return this.jobHead < this.jobs.length;
  }

  /** Run queued jobs until none remain, then report unhandled rejections. */
  drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.jobHead < this.jobs.length) {
        const job = this.jobs[this.jobHead++]!;
        this.hooks.beginSegment();
        let threw = false;
        try {
          threw = job() === true;
        } catch (err) {
          this.hooks.endSegment(true);
          throw err;
        }
        this.hooks.endSegment(threw);
      }
    } finally {
      this.jobs.length = 0;
      this.jobHead = 0;
      this.draining = false;
    }
    if (this.pendingRejections.size) {
      const reasons = [...this.pendingRejections.values()];
      this.pendingRejections.clear();
      for (const reason of reasons) this.hooks.unhandledRejection(reason);
    }
  }

  /** Drop queued jobs and pending rejections (dispose, abort). */
  clearJobs(): void {
    this.jobs.length = 0;
    this.jobHead = 0;
    this.pendingRejections.clear();
  }

  /** Run `fn` with this realm active. */
  run<T>(fn: () => T): T {
    const previous = ACTIVE.realm;
    ACTIVE.realm = this;
    try {
      return fn();
    } finally {
      ACTIVE.realm = previous;
    }
  }
}

/** The realm running right now (throws outside script code). */
export function activeRealm(): Realm {
  const realm = ACTIVE.realm;
  if (!realm) throw new Error("No script realm is active.");
  return realm;
}

// ---------------------------------------------------------------------------
// Script functions
// ---------------------------------------------------------------------------

/** What the interpreter registers for each function object it creates. */
export interface ScriptFunctionRecord {
  /** Call as a function (not as a constructor). */
  call(thisArg: unknown, args: unknown[]): unknown;
  /** Source text for Function.prototype.toString. */
  source(): string;
}

export const SCRIPT_FUNCTIONS = new WeakMap<object, ScriptFunctionRecord>();

// ---------------------------------------------------------------------------
// Intrinsics and substitution
// ---------------------------------------------------------------------------

const HostObject = Object;
const HostFunction = Function;
const HostDate = Date;
const HostRegExp = RegExp;
const HostReflect = Reflect;
const hostToString = Function.prototype.toString;
const hostCall = Function.prototype.call;
const hostApply = Function.prototype.apply;
const hostBind = Function.prototype.bind;
const hostCaptureStackTrace = (Error as unknown as { captureStackTrace?: unknown }).captureStackTrace;

let intrinsics: WeakSet<object> | null = null;
let substitutes: Map<unknown, unknown> | null = null;
let protoMutators: Set<unknown> | null = null;
const extraIntrinsicRoots: unknown[] = [];

/** Mark objects (and everything reachable from their properties and prototypes) as read-only for scripts. */
export function registerIntrinsics(...roots: unknown[]): void {
  if (intrinsics) walkIntrinsics(intrinsics, roots);
  else extraIntrinsicRoots.push(...roots);
}

function walkIntrinsics(set: WeakSet<object>, roots: readonly unknown[]): void {
  const stack = [...roots];
  while (stack.length) {
    const o = stack.pop();
    if (!isObjectLike(o) || set.has(o)) continue;
    set.add(o);
    stack.push(HostReflect.getPrototypeOf(o));
    for (const key of HostReflect.ownKeys(o)) {
      const d = HostReflect.getOwnPropertyDescriptor(o, key);
      if (!d) continue;
      if ("value" in d) stack.push(d.value);
      else stack.push(d.get, d.set);
    }
  }
}

function intrinsicSet(): WeakSet<object> {
  if (intrinsics) return intrinsics;
  buildSubstitutes();
  const set = new WeakSet<object>();
  const roots: unknown[] = [
    HostObject, HostFunction, Array, String, Number, Boolean, Symbol, BigInt, Math, JSON, HostReflect, Promise, Map, Set, WeakMap, WeakSet,
    HostDate, HostRegExp, Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError, AggregateError, ArrayBuffer,
    DataView, Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
    BigInt64Array, BigUint64Array, parseInt, parseFloat, isNaN, isFinite, encodeURI, encodeURIComponent, decodeURI, decodeURIComponent,
    Object.getPrototypeOf(function* () {}), Object.getPrototypeOf(async function () {}), Object.getPrototypeOf(async function* () {}),
    Object.getPrototypeOf([][Symbol.iterator]()), Object.getPrototypeOf(new Map()[Symbol.iterator]()), Object.getPrototypeOf(new Set()[Symbol.iterator]()),
    Object.getPrototypeOf(""[Symbol.iterator]()), Object.getPrototypeOf(/a/[Symbol.matchAll]("")),
    SafePromise, ...substitutes!.values(),
    ...extraIntrinsicRoots,
  ];
  const globalIterator = (globalThis as { Iterator?: unknown }).Iterator;
  if (globalIterator) roots.push(globalIterator);
  walkIntrinsics(set, roots);
  intrinsics = set;
  return set;
}

/** True for built-in objects scripts may read but never change. */
export function isIntrinsic(value: unknown): boolean {
  return isObjectLike(value) && intrinsicSet().has(value);
}

function builtinName(value: object): string {
  if (typeof value === "function") return value.name || "a built-in function";
  const ctor = HostReflect.getOwnPropertyDescriptor(value, "constructor")?.value;
  if (typeof ctor === "function" && ctor.name) return `${ctor.name}.prototype`;
  const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
  return typeof tag === "string" ? tag : "a built-in object";
}

function builtinWriteError(value: object): TypeError {
  return new TypeError(`Scripts can't change built-in objects like ${builtinName(value)}.`);
}

/** Throw when a script tries to change an intrinsic. */
export function guardWrite(target: unknown): void {
  if (isIntrinsic(target)) throw builtinWriteError(target as object);
}

function blockedConstructor(name: string, prototype: unknown): Function {
  const fn = function () {
    throw new EvalError("Scripts can't turn text into code. Write a function instead.");
  };
  HostObject.defineProperty(fn, "name", { value: name });
  HostObject.defineProperty(fn, "prototype", { value: prototype, writable: false });
  return fn;
}

function copyStatics(target: Function | object, source: object, skip: readonly PropertyKey[]): void {
  for (const key of HostReflect.ownKeys(source)) {
    if (skip.includes(key) || key === "prototype" || key === "length" || key === "name" || key === "caller" || key === "arguments") continue;
    const d = HostReflect.getOwnPropertyDescriptor(source, key)!;
    HostReflect.defineProperty(target, key, d);
  }
}

function defineMethod(target: object, name: string, fn: Function, length: number): void {
  HostObject.defineProperty(fn, "name", { value: name });
  HostObject.defineProperty(fn, "length", { value: length });
  HostObject.defineProperty(target, name, { value: fn, writable: true, enumerable: false, configurable: true });
}

function substituteDescriptor(d: PropertyDescriptor | undefined): PropertyDescriptor | undefined {
  if (!d) return d;
  const out: PropertyDescriptor = { ...d };
  if ("value" in d) out.value = substitute(d.value);
  if (d.get) out.get = substitute(d.get) as () => unknown;
  if (d.set) out.set = substitute(d.set) as (v: unknown) => void;
  return out;
}

let safeObject: Function;
let safeReflect: Record<string, unknown>;
let safeDate: Function;
let safeRegExp: Function;

function buildSubstitutes(): void {
  if (substitutes) return;
  const map = new Map<unknown, unknown>();
  const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;
  map.set(HostFunction, blockedConstructor("Function", HostFunction.prototype));
  map.set(GeneratorFunction, blockedConstructor("GeneratorFunction", GeneratorFunction.prototype));
  map.set(AsyncFunction, blockedConstructor("AsyncFunction", AsyncFunction.prototype));
  map.set(AsyncGeneratorFunction, blockedConstructor("AsyncGeneratorFunction", AsyncGeneratorFunction.prototype));

  // Function.prototype.call/apply/bind/toString route through the guards.
  const call = function (this: unknown, thisArg: unknown, ...args: unknown[]) {
    return callValue(this, thisArg, args);
  };
  const apply = function (this: unknown, thisArg: unknown, argArray?: unknown) {
    return callValue(this, thisArg, argArray === undefined || argArray === null ? [] : listFromArrayLike(argArray));
  };
  const bind = function (this: unknown, thisArg: unknown, ...bound: unknown[]) {
    const target = this;
    if (typeof target !== "function") throw new TypeError("Bind must be called on a function");
    guardNativeCall(target, thisArg, bound);
    const boundFn = function (this: unknown, ...rest: unknown[]) {
      const args = [...bound, ...rest];
      return new.target ? constructValue(target, args, new.target === boundFn ? target : new.target) : callValue(target, thisArg, args);
    };
    HostObject.defineProperty(boundFn, "name", { value: `bound ${typeof target.name === "string" ? target.name : ""}` });
    HostObject.defineProperty(boundFn, "length", { value: Math.max(0, (typeof target.length === "number" ? target.length : 0) - bound.length) });
    return boundFn;
  };
  const toString = function (this: unknown) {
    const record = isObjectLike(this) ? SCRIPT_FUNCTIONS.get(this) : undefined;
    if (record) return record.source();
    if (typeof this === "function") return `function ${this.name}() { [native code] }`;
    return HostReflect.apply(hostToString, this, []);
  };
  for (const [fn, name, length] of [[call, "call", 1], [apply, "apply", 2], [bind, "bind", 1], [toString, "toString", 0]] as const) {
    HostObject.defineProperty(fn, "name", { value: name });
    HostObject.defineProperty(fn, "length", { value: length });
  }
  map.set(hostCall, call);
  map.set(hostApply, apply);
  map.set(hostBind, bind);
  map.set(hostToString, toString);

  if (typeof hostCaptureStackTrace === "function") {
    const captureStackTrace = function (target: unknown) {
      if (!isObjectLike(target)) throw new TypeError("Invalid argument");
      guardWrite(target);
      HostObject.defineProperty(target, "stack", { value: String((target as { message?: unknown }).message ?? ""), writable: true, configurable: true });
    };
    map.set(hostCaptureStackTrace, captureStackTrace);
  }

  // Object: statics that read or change arbitrary objects go through the guards.
  safeObject = function Object(this: unknown, value?: unknown) {
    if (new.target && new.target !== safeObject) return HostReflect.construct(HostObject, [], new.target);
    return HostObject(value);
  };
  HostObject.defineProperty(safeObject, "prototype", { value: HostObject.prototype, writable: false });
  HostObject.defineProperty(safeObject, "length", { value: 1 });
  copyStatics(safeObject, HostObject, []);
  const guardTarget = (method: string, length: number, index = 0) => {
    const host = (HostObject as unknown as Record<string, Function>)[method]!;
    defineMethod(safeObject, method, function (this: unknown, ...args: unknown[]) {
      guardWrite(args[index]);
      return HostReflect.apply(host, HostObject, args);
    }, length);
  };
  guardTarget("assign", 2);
  guardTarget("defineProperty", 3);
  guardTarget("defineProperties", 2);
  guardTarget("freeze", 1);
  guardTarget("seal", 1);
  guardTarget("preventExtensions", 1);
  guardTarget("setPrototypeOf", 2);
  defineMethod(safeObject, "getOwnPropertyDescriptor", (o: unknown, key: unknown) => substituteDescriptor(HostObject.getOwnPropertyDescriptor(o, key as PropertyKey)), 2);
  defineMethod(safeObject, "getOwnPropertyDescriptors", (o: unknown) => {
    const all = HostObject.getOwnPropertyDescriptors(o);
    for (const key of HostReflect.ownKeys(all)) (all as Record<PropertyKey, PropertyDescriptor>)[key] = substituteDescriptor((all as Record<PropertyKey, PropertyDescriptor>)[key])!;
    return all;
  }, 1);
  defineMethod(safeObject, "getPrototypeOf", (o: unknown) => substitute(HostObject.getPrototypeOf(o)), 1);
  defineMethod(safeObject, "values", (o: unknown) => HostObject.values(o as object).map(substitute), 1);
  defineMethod(safeObject, "entries", (o: unknown) => HostObject.entries(o as object).map(([k, v]) => [k, substitute(v)]), 1);

  safeReflect = HostObject.create(HostObject.prototype) as Record<string, unknown>;
  copyStatics(safeReflect, HostReflect, []);
  defineMethod(safeReflect, "apply", (fn: unknown, thisArg: unknown, args: unknown) => callValue(fn, thisArg, listFromArrayLike(args)), 3);
  defineMethod(safeReflect, "construct", (fn: unknown, args: unknown, newTarget?: unknown) => constructValue(fn, listFromArrayLike(args), newTarget ?? fn), 2);
  for (const [method, length] of [["defineProperty", 3], ["deleteProperty", 2], ["set", 3], ["setPrototypeOf", 2], ["preventExtensions", 1]] as const) {
    const host = (HostReflect as unknown as Record<string, Function>)[method]!;
    defineMethod(safeReflect, method, (...args: unknown[]) => {
      guardWrite(args[0]);
      return HostReflect.apply(host, HostReflect, args);
    }, length);
  }
  defineMethod(safeReflect, "get", (...args: [object, PropertyKey, unknown?]) => substitute(args.length > 2 ? HostReflect.get(args[0], args[1], args[2]) : HostReflect.get(args[0], args[1])), 2);
  defineMethod(safeReflect, "getOwnPropertyDescriptor", (o: object, key: PropertyKey) => substituteDescriptor(HostReflect.getOwnPropertyDescriptor(o, key)), 2);
  defineMethod(safeReflect, "getPrototypeOf", (o: object) => substitute(HostReflect.getPrototypeOf(o)), 1);

  // Date: no-argument dates read the prototype clock.
  safeDate = function Date(this: unknown, ...args: unknown[]) {
    const now = activeRealm().hooks.now();
    if (!new.target) return new HostDate(now).toString();
    return HostReflect.construct(HostDate, args.length ? args : [now], new.target);
  };
  HostObject.defineProperty(safeDate, "prototype", { value: HostDate.prototype, writable: false });
  HostObject.defineProperty(safeDate, "length", { value: 7 });
  copyStatics(safeDate, HostDate, ["now"]);
  defineMethod(safeDate, "now", () => activeRealm().hooks.now(), 0);

  // RegExp: no legacy statics (they expose the last match of host code).
  safeRegExp = function RegExp(this: unknown, pattern?: unknown, flags?: unknown) {
    return HostReflect.construct(HostRegExp, [pattern, flags], new.target ?? safeRegExp);
  };
  HostObject.defineProperty(safeRegExp, "prototype", { value: HostRegExp.prototype, writable: false });
  HostObject.defineProperty(safeRegExp, "length", { value: 2 });
  const escape = (HostRegExp as unknown as { escape?: Function }).escape;
  if (typeof escape === "function") defineMethod(safeRegExp, "escape", (s: unknown) => escape(s), 1);

  // String builders that could allocate huge strings in one native call.
  const hostRepeat = String.prototype.repeat;
  const hostPadStart = String.prototype.padStart;
  const hostPadEnd = String.prototype.padEnd;
  const checkLength = (length: number) => {
    if (length > MAX_STRING_LENGTH) throw new InternalAbort("memory");
  };
  const repeat = function (this: unknown, count?: unknown) {
    const s = String(this);
    const n = Number(count);
    if (Number.isFinite(n) && n > 0) checkLength(s.length * Math.floor(n));
    return HostReflect.apply(hostRepeat, s, [count]);
  };
  const padStart = function (this: unknown, maxLength?: unknown, fill?: unknown) {
    checkLength(Number(maxLength) || 0);
    return HostReflect.apply(hostPadStart, this, [maxLength, fill]);
  };
  const padEnd = function (this: unknown, maxLength?: unknown, fill?: unknown) {
    checkLength(Number(maxLength) || 0);
    return HostReflect.apply(hostPadEnd, this, [maxLength, fill]);
  };
  for (const [fn, name, length] of [[repeat, "repeat", 1], [padStart, "padStart", 2], [padEnd, "padEnd", 2]] as const) {
    HostObject.defineProperty(fn, "name", { value: name });
    HostObject.defineProperty(fn, "length", { value: length });
  }
  map.set(hostRepeat, repeat);
  map.set(hostPadStart, padStart);
  map.set(hostPadEnd, padEnd);

  map.set(HostObject, safeObject);
  map.set(HostReflect, safeReflect);
  map.set(HostDate, safeDate);
  map.set(HostRegExp, safeRegExp);
  map.set(Promise, SafePromise);
  substitutes = map;

  protoMutators = new Set<unknown>([
    Array.prototype.push, Array.prototype.pop, Array.prototype.shift, Array.prototype.unshift, Array.prototype.splice, Array.prototype.sort,
    Array.prototype.reverse, Array.prototype.fill, Array.prototype.copyWithin,
    (HostObject.prototype as unknown as Record<string, unknown>).__defineGetter__,
    (HostObject.prototype as unknown as Record<string, unknown>).__defineSetter__,
    HostObject.getOwnPropertyDescriptor(HostObject.prototype, "__proto__")?.set,
  ]);
}

/** A host value as scripts see it: dangerous host constructors and methods become their safe versions. */
export function substitute(value: unknown): unknown {
  if (!isObjectLike(value)) return value;
  if (!substitutes) buildSubstitutes();
  const replacement = substitutes!.get(value);
  if (replacement !== undefined) return replacement;
  if (value === (Error as unknown as { prepareStackTrace?: unknown }).prepareStackTrace) return undefined;
  return value;
}

function listFromArrayLike(value: unknown): unknown[] {
  if (!isObjectLike(value)) throw new TypeError("CreateListFromArrayLike called on non-object");
  return HostReflect.apply(Array.prototype.slice, value, []) as unknown[];
}

/** Refuse native calls that would point a mutator at a built-in object. */
export function guardNativeCall(fn: unknown, thisArg: unknown, args: readonly unknown[]): void {
  if (!protoMutators) buildSubstitutes();
  if (protoMutators!.has(fn) && isIntrinsic(thisArg)) throw builtinWriteError(thisArg as object);
  if (args.length > 1) {
    let mutator = false;
    let target: object | null = null;
    for (const a of args) {
      if (protoMutators!.has(a)) mutator = true;
      else if (!target && isIntrinsic(a)) target = a as object;
    }
    if (mutator && target) throw builtinWriteError(target);
  }
}

// ---------------------------------------------------------------------------
// Property access and calls
// ---------------------------------------------------------------------------

function describeKey(key: PropertyKey): string {
  return typeof key === "symbol" ? key.toString() : String(key);
}

/** `obj[key]` as scripts see it. */
export function getProp(obj: unknown, key: PropertyKey): unknown {
  if (obj === null || obj === undefined) throw new TypeError(`Cannot read properties of ${obj} (reading '${describeKey(key)}')`);
  const v = (obj as Record<PropertyKey, unknown>)[key];
  return isObjectLike(v) ? substitute(v) : v;
}

/** `obj[key] = value` as scripts see it. */
export function setProp(obj: unknown, key: PropertyKey, value: unknown): void {
  if (obj === null || obj === undefined) throw new TypeError(`Cannot set properties of ${obj} (setting '${describeKey(key)}')`);
  if (isObjectLike(obj) && isIntrinsic(obj)) throw builtinWriteError(obj);
  (obj as Record<PropertyKey, unknown>)[key] = value;
}

/** `delete obj[key]` as scripts see it. */
export function deleteProp(obj: unknown, key: PropertyKey): boolean {
  if (obj === null || obj === undefined) throw new TypeError(`Cannot convert undefined or null to object`);
  if (isObjectLike(obj) && isIntrinsic(obj)) throw builtinWriteError(obj);
  return delete (obj as Record<PropertyKey, unknown>)[key];
}

/** Call any function from script code. */
export function callValue(fn: unknown, thisArg: unknown, args: unknown[], describe?: string): unknown {
  if (typeof fn !== "function") throw new TypeError(`${describe ?? "The value"} is not a function`);
  const record = SCRIPT_FUNCTIONS.get(fn);
  if (record) return record.call(thisArg, args);
  guardNativeCall(fn, thisArg, args);
  return substitute(HostReflect.apply(fn, thisArg, args));
}

/** `new fn(...args)` from script code. */
export function constructValue(fn: unknown, args: unknown[], newTarget: unknown = fn, describe?: string): unknown {
  if (typeof fn !== "function" || typeof newTarget !== "function") throw new TypeError(`${describe ?? "The value"} is not a constructor`);
  return substitute(HostReflect.construct(fn, args, newTarget));
}

/** True for values `new` works on. */
export function isConstructor(value: unknown): boolean {
  if (typeof value !== "function") return false;
  try {
    HostReflect.construct(String, [], value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Standard globals
// ---------------------------------------------------------------------------

/** The ECMAScript built-ins every script sees (safe versions where needed), plus a per-realm Math. */
function createStandardGlobals(realm: Realm): Record<string, unknown> {
  buildSubstitutes();
  const math = HostObject.create(HostObject.prototype) as Record<PropertyKey, unknown>;
  for (const key of HostReflect.ownKeys(Math)) HostReflect.defineProperty(math, key, HostReflect.getOwnPropertyDescriptor(Math, key)!);
  defineMethod(math, "random", () => realm.hooks.random(), 0);
  const globals: Record<string, unknown> = {
    Object: safeObject,
    Function: substitutes!.get(HostFunction),
    Array,
    String,
    Number,
    Boolean,
    Symbol,
    BigInt,
    Math: math,
    JSON,
    Reflect: safeReflect,
    Promise: SafePromise,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Date: safeDate,
    RegExp: safeRegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    EvalError,
    URIError,
    AggregateError,
    ArrayBuffer,
    DataView,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    encodeURIComponent,
    decodeURI,
    decodeURIComponent,
    NaN,
    Infinity,
    undefined,
  };
  return globals;
}
