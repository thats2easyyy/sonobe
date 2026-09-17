/**
 * Budgets for built-ins that do a lot of work in one native call.
 *
 * No interrupt check can run inside a native call, so `new Array(2 ** 28).fill(0)` would allocate
 * gigabytes (and crash the process) and `bigArray.sort()` would run for seconds before the budget
 * could react. Scripts see guarded versions of the bulk built-ins instead: before the native call runs,
 * the guard projects what it will allocate and how many elements it will visit, and charges the
 * realm. An invocation that projects more than its memory allowance stops with "The script used too
 * much memory."; one native call projected to visit too many elements stops with "The script took too
 * long." Deterministic runtimes count the same projections as interrupt checks, so they stop at the
 * same place every run.
 *
 * Projections are upper bounds, never measurements: a guard counts what a call could allocate.
 */

import { ACTIVE, InternalAbort, MAX_INVOCATION_BYTES, MAX_NATIVE_WORK, MAX_STRING_LENGTH, guardNativeCall, isObjectLike } from "./realm.ts";

const HostReflect = Reflect;
const HostArray = Array;

export const ELEMENT_BYTES = 8;
export const STRING_ITEM_BYTES = 32;
export const ENTRY_BYTES = 48;

const memory = (bytes: number) => ACTIVE.realm?.chargeMemory(bytes);
const work = (units: number) => ACTIVE.realm?.chargeWork(units);

const TypedArrayPrototype = Object.getPrototypeOf(Int8Array.prototype) as object;
const TypedArray = Object.getPrototypeOf(Int8Array) as Function;
const typedLengthGetter = HostReflect.getOwnPropertyDescriptor(TypedArrayPrototype, "length")!.get!;
const bufferLengthGetter = HostReflect.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setSizeGetter = HostReflect.getOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const mapSizeGetter = HostReflect.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;

function brand(get: Function, value: unknown): number | null {
  if (!isObjectLike(value)) return null;
  try {
    return HostReflect.apply(get, value, []) as number;
  } catch {
    return null;
  }
}

const typedLength = (value: unknown) => brand(typedLengthGetter, value);
const isTypedArray = (value: unknown) => typedLength(value) !== null;

/** A clamped, non-negative length (primitive values only, so no script code runs). */
function clampLength(value: unknown): number {
  if (isObjectLike(value) || typeof value === "symbol" || typeof value === "bigint") return 0;
  const n = Math.trunc(Number(value));
  return n > 0 ? Math.min(n, Number.MAX_SAFE_INTEGER) : 0;
}

/** How many elements a native call walks over `value`: arrays, typed arrays, strings, and array-likes. */
export function lengthOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (!isObjectLike(value)) return 0;
  if (HostArray.isArray(value)) return value.length;
  const typed = typedLength(value);
  if (typed !== null) return typed;
  return clampLength(HostReflect.get(value, "length"));
}

/** How many keys enumerating `value` natively produces (arrays, typed arrays, strings; 0 for ordinary objects). */
export function keyCountOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (!isObjectLike(value)) return 0;
  if (HostArray.isArray(value)) return value.length;
  const typed = typedLength(value);
  if (typed !== null) return typed;
  if (value instanceof String) return value.length;
  return 0;
}

/** Charge copying the elements of `value` into a new list (spread, apply). */
export function chargeElements(value: unknown): void {
  const n = lengthOf(value);
  if (n < 1024) return;
  memory(n * ELEMENT_BYTES);
  work(n);
}

/** Charge enumerating the keys of `value` natively (Object.keys, for-in, object spread). */
export function chargeKeys(value: unknown, bytesPerKey = STRING_ITEM_BYTES): void {
  const n = keyCountOf(value);
  if (n < 1024) return;
  memory(n * bytesPerKey);
  work(n);
}

function relativeIndex(value: unknown, length: number, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (isObjectLike(value) || typeof value === "symbol" || typeof value === "bigint") return null;
  const n = Math.trunc(Number(value)) || 0;
  if (n < 0) return Math.max(length + n, 0);
  return Math.min(n, length);
}

function rangeLength(length: number, start: unknown, end: unknown): number {
  const s = relativeIndex(start, length, 0);
  const e = relativeIndex(end, length, length);
  if (s === null || e === null) return length;
  return Math.max(0, e - s);
}

function sortWork(n: number, comparator: unknown, typed: boolean): number {
  if (n < 2) return n;
  const log = Math.ceil(Math.log2(n + 1));
  // V8's default comparator converts both values to strings on every comparison.
  const weight = comparator === undefined ? (typed ? 1 : 16) : 4;
  return n * log * weight;
}

function checkString(value: unknown): void {
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) throw new InternalAbort("memory");
}

function bytesPerElement(value: unknown): number {
  const bpe = isObjectLike(value) ? HostReflect.get(value, "BYTES_PER_ELEMENT") : undefined;
  return typeof bpe === "number" && bpe > 0 ? bpe : ELEMENT_BYTES;
}

type Check = (thisArg: unknown, args: unknown[]) => void;

function method(host: Function, check: Check | null, after?: (result: unknown) => void): Function {
  const fn = function (this: unknown, ...args: unknown[]) {
    guardNativeCall(host, this, args);
    check?.(this, args);
    const result = HostReflect.apply(host, this, args);
    after?.(result);
    return result;
  };
  Object.defineProperty(fn, "name", { value: host.name });
  Object.defineProperty(fn, "length", { value: host.length });
  return fn;
}

function constructor(host: Function, check: (args: unknown[]) => void): Function {
  const wrapper = function (this: unknown, ...args: unknown[]) {
    check(args);
    if (new.target === undefined) return HostReflect.apply(host, undefined, args);
    return HostReflect.construct(host, args, new.target === wrapper ? host : new.target);
  };
  for (const key of HostReflect.ownKeys(host)) {
    if (key === "prototype" || key === "length" || key === "name" || key === "caller" || key === "arguments") continue;
    HostReflect.defineProperty(wrapper, key, HostReflect.getOwnPropertyDescriptor(host, key)!);
  }
  Object.defineProperty(wrapper, "prototype", { value: host.prototype, writable: false, enumerable: false, configurable: false });
  Object.defineProperty(wrapper, "name", { value: host.name });
  Object.defineProperty(wrapper, "length", { value: host.length });
  Object.setPrototypeOf(wrapper, Object.getPrototypeOf(host));
  return wrapper;
}

function collectionCount(value: unknown): number {
  const size = brand(setSizeGetter, value) ?? brand(mapSizeGetter, value);
  if (size !== null) return size;
  if (typeof value === "string" || HostArray.isArray(value) || isTypedArray(value)) return lengthOf(value);
  return 0;
}

/**
 * Elements `flat(depth)` would copy (`leaves`) and walk (`visited`). Arrays at the last level count
 * whole without a walk, and counting stops as soon as either projection is over its allowance.
 */
function flatProjection(root: unknown, depth: number): { leaves: number; visited: number } {
  let leaves = 0;
  let visited = 0;
  const stack: [unknown, number][] = [[root, depth]];
  while (stack.length) {
    const [array, d] = stack.pop()!;
    const n = lengthOf(array);
    if (d <= 0) leaves += n;
    else {
      visited += n;
      for (let i = 0; i < n && visited <= MAX_NATIVE_WORK; i++) {
        const item = (array as Record<number, unknown>)[i];
        if (HostArray.isArray(item)) stack.push([item, d - 1]);
        else leaves++;
      }
    }
    if (leaves * ELEMENT_BYTES > MAX_INVOCATION_BYTES || visited > MAX_NATIVE_WORK) break;
  }
  return { leaves, visited };
}

/** Guarded built-ins, keyed by the host function scripts would otherwise see. */
export function installNativeGuards(map: Map<unknown, unknown>): void {
  const set = (host: unknown, guarded: Function) => {
    if (typeof host === "function") map.set(host, guarded);
  };
  const AP = Array.prototype as unknown as Record<string, Function>;
  const TAP = TypedArrayPrototype as unknown as Record<string, Function>;

  // Constructors.
  const safeArray = constructor(HostArray, (args) => {
    if (args.length === 1 && typeof args[0] === "number" && args[0] > 0) memory(args[0] * ELEMENT_BYTES);
  });
  set(HostArray, safeArray);
  set(ArrayBuffer, constructor(ArrayBuffer, (args) => {
    const options = args[1];
    const max = isObjectLike(options) ? HostReflect.get(options, "maxByteLength") : undefined;
    memory(Math.max(clampLength(args[0]), clampLength(max)));
  }));
  const typedCtors: unknown[] = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, (globalThis as { Float16Array?: unknown }).Float16Array];
  for (const ctor of typedCtors) {
    if (typeof ctor !== "function") continue;
    const bpe = bytesPerElement(ctor);
    set(ctor, constructor(ctor, (args) => {
      const source = args[0];
      if (!isObjectLike(source)) {
        memory(clampLength(source) * bpe);
        return;
      }
      if (brand(bufferLengthGetter, source) !== null) return;
      const n = collectionCount(source) || lengthOf(source);
      memory(n * bpe);
      work(n);
    }));
  }
  for (const ctor of [Map, Set, WeakMap, WeakSet]) {
    set(ctor, constructor(ctor, (args) => {
      const n = collectionCount(args[0]);
      memory(n * ENTRY_BYTES);
      work(n);
    }));
  }

  // Array statics: `this` is the script's Array, so pass V8 its own constructor (the guard charged already).
  const hostFrom = HostArray.from as Function;
  const safeFrom = function (this: unknown, ...args: unknown[]) {
    const items = args[0];
    let n = 0;
    if (typeof items === "string") n = items.length * (STRING_ITEM_BYTES + ELEMENT_BYTES);
    else if (isObjectLike(items)) {
      const count = collectionCount(items) || (HostReflect.get(items, Symbol.iterator) === undefined || HostArray.isArray(items) || isTypedArray(items) ? lengthOf(items) : 0);
      n = count * ELEMENT_BYTES;
    }
    memory(n);
    work(n / ELEMENT_BYTES);
    return HostReflect.apply(hostFrom, this === safeArray ? HostArray : this, args);
  };
  Object.defineProperty(safeFrom, "name", { value: "from" });
  Object.defineProperty(safeFrom, "length", { value: 1 });
  set(hostFrom, safeFrom);
  set((TypedArray as unknown as { from: Function }).from, method((TypedArray as unknown as { from: Function }).from, (_self, args) => work(collectionCount(args[0]) || lengthOf(args[0]))));

  // Array.prototype.
  const iterate: Check = (self) => work(lengthOf(self));
  for (const name of ["every", "some", "find", "findIndex", "findLast", "findLastIndex", "forEach", "includes", "indexOf", "lastIndexOf", "reduce", "reduceRight", "reverse", "shift", "copyWithin"]) set(AP[name], method(AP[name]!, iterate));
  const copy: Check = (self) => {
    const n = lengthOf(self);
    memory(n * ELEMENT_BYTES);
    work(n);
  };
  for (const name of ["map", "filter", "toReversed", "with"]) set(AP[name], method(AP[name]!, copy));
  set(AP.push, method(AP.push!, (_self, args) => memory(args.length * ELEMENT_BYTES)));
  set(AP.unshift, method(AP.unshift!, (self, args) => {
    work(lengthOf(self));
    memory(args.length * ELEMENT_BYTES);
  }));
  set(AP.slice, method(AP.slice!, (self, args) => {
    const n = rangeLength(lengthOf(self), args[0], args[1]);
    memory(n * ELEMENT_BYTES);
    work(n);
  }));
  set(AP.fill, method(AP.fill!, (self, args) => {
    const n = rangeLength(lengthOf(self), args[1], args[2]);
    memory(n * ELEMENT_BYTES);
    work(n);
  }));
  const spliceCheck: Check = (self, args) => {
    const n = lengthOf(self);
    work(n);
    const start = relativeIndex(args[0], n, 0) ?? 0;
    const removed = args.length < 2 ? n - start : Math.min(clampLength(args[1]), n - start);
    memory((Math.max(removed, 0) + Math.max(args.length - 2, 0)) * ELEMENT_BYTES);
  };
  set(AP.splice, method(AP.splice!, spliceCheck));
  set(AP.toSpliced, method(AP.toSpliced!, (self, args) => {
    const n = lengthOf(self);
    memory((n + Math.max(args.length - 2, 0)) * ELEMENT_BYTES);
    work(n);
  }));
  set(AP.concat, method(AP.concat!, (self, args) => {
    let total = 0;
    for (const item of [self, ...args]) {
      const spreadable = HostArray.isArray(item) || (isObjectLike(item) && !!HostReflect.get(item, Symbol.isConcatSpreadable));
      total += spreadable ? lengthOf(item) : 1;
    }
    memory(total * ELEMENT_BYTES);
    work(total);
  }));
  set(AP.flat, method(AP.flat!, (self, args) => {
    const depth = args[0] === undefined ? 1 : Math.trunc(Number(isObjectLike(args[0]) ? 1 : args[0])) || 0;
    const { leaves, visited } = flatProjection(self, depth);
    memory(leaves * ELEMENT_BYTES);
    work(visited + leaves);
  }));
  const hostFlatMap = AP.flatMap!;
  const safeFlatMap = function (this: unknown, callback: unknown, thisArg?: unknown) {
    guardNativeCall(hostFlatMap, this, [callback, thisArg]);
    if (typeof callback !== "function") throw new TypeError("flatMap mapper function is not callable");
    work(lengthOf(this));
    const mapper = function (value: unknown, index: number, array: unknown) {
      const result = HostReflect.apply(callback, thisArg, [value, index, array]) as unknown;
      memory((HostArray.isArray(result) ? result.length : 1) * ELEMENT_BYTES);
      return result;
    };
    return HostReflect.apply(hostFlatMap, this, [mapper]);
  };
  Object.defineProperty(safeFlatMap, "name", { value: "flatMap" });
  Object.defineProperty(safeFlatMap, "length", { value: 1 });
  set(hostFlatMap, safeFlatMap);
  const joinCheck = (typed: boolean): Check => (self, args) => {
    const n = lengthOf(self);
    work(n);
    const separator = args[0] === undefined ? 1 : typeof args[0] === "string" ? args[0].length : 1;
    if ((n - 1) * separator + (typed ? n : 0) > MAX_STRING_LENGTH) throw new InternalAbort("memory");
  };
  for (const name of ["join", "toString", "toLocaleString"]) set(AP[name], method(AP[name]!, joinCheck(false), checkString));
  set(AP.sort, method(AP.sort!, (self, args) => {
    const n = lengthOf(self);
    memory(n * ELEMENT_BYTES);
    work(sortWork(n, args[0], false));
  }));
  set(AP.toSorted, method(AP.toSorted!, (self, args) => {
    const n = lengthOf(self);
    memory(2 * n * ELEMENT_BYTES);
    work(sortWork(n, args[0], false));
  }));

  // %TypedArray%.prototype.
  const typedCopy: Check = (self) => {
    const n = lengthOf(self);
    memory(n * bytesPerElement(self));
    work(n);
  };
  for (const name of ["every", "some", "find", "findIndex", "findLast", "findLastIndex", "forEach", "includes", "indexOf", "lastIndexOf", "reduce", "reduceRight"]) set(TAP[name], method(TAP[name]!, iterate));
  for (const name of ["map", "filter", "toReversed", "with"]) set(TAP[name], method(TAP[name]!, typedCopy));
  set(TAP.slice, method(TAP.slice!, (self, args) => memory(rangeLength(lengthOf(self), args[0], args[1]) * bytesPerElement(self))));
  set(TAP.sort, method(TAP.sort!, (self, args) => work(sortWork(lengthOf(self), args[0], true))));
  set(TAP.toSorted, method(TAP.toSorted!, (self, args) => {
    const n = lengthOf(self);
    memory(n * bytesPerElement(self));
    work(sortWork(n, args[0], true));
  }));
  for (const name of ["join", "toLocaleString"]) set(TAP[name], method(TAP[name]!, joinCheck(true), checkString));
  const U8P = Uint8Array.prototype as unknown as Record<string, Function | undefined>;
  for (const [name, ratio] of [["toBase64", 4 / 3], ["toHex", 2]] as const) {
    const host = U8P[name];
    if (!host) continue;
    set(host, method(host, (self) => {
      const chars = Math.ceil(lengthOf(self) * ratio);
      if (chars > MAX_STRING_LENGTH) throw new InternalAbort("memory");
      memory(chars * 2);
    }));
  }

  // ArrayBuffer.prototype.
  const ABP = ArrayBuffer.prototype as unknown as Record<string, Function | undefined>;
  const byteLength = (self: unknown) => brand(bufferLengthGetter, self) ?? 0;
  if (ABP.slice) set(ABP.slice, method(ABP.slice, (self, args) => memory(rangeLength(byteLength(self), args[0], args[1]))));
  if (ABP.resize) set(ABP.resize, method(ABP.resize, (_self, args) => memory(clampLength(args[0]))));
  for (const name of ["transfer", "transferToFixedLength"]) {
    const host = ABP[name];
    if (host) set(host, method(host, (self, args) => memory(args[0] === undefined ? byteLength(self) : clampLength(args[0]))));
  }

  // String.prototype builders (repeat, padStart and padEnd are guarded by the realm).
  const SP = String.prototype as unknown as Record<string, Function>;
  set(SP.concat, method(SP.concat!, (self, args) => {
    let total = typeof self === "string" ? self.length : 0;
    for (const arg of args) if (typeof arg === "string") total += arg.length;
    if (total > MAX_STRING_LENGTH) throw new InternalAbort("memory");
  }, checkString));
  for (const name of ["normalize", "toUpperCase", "toLowerCase", "toLocaleUpperCase", "toLocaleLowerCase", "toWellFormed"]) {
    if (SP[name]) set(SP[name], method(SP[name]!, (self) => work(lengthOf(self)), checkString));
  }

  // Key enumeration and JSON.
  const keys: Check = (_self, args) => chargeKeys(args[0]);
  for (const host of [Object.keys, Object.getOwnPropertyNames, Reflect.ownKeys]) set(host, method(host, keys));
  set(Object.getOwnPropertyDescriptors, method(Object.getOwnPropertyDescriptors, (_self, args) => chargeKeys(args[0], 2 * ENTRY_BYTES)));
  set(Object.fromEntries, method(Object.fromEntries, (_self, args) => {
    const n = lengthOf(args[0]);
    memory(n * ENTRY_BYTES);
    work(n);
  }));
  set(JSON.stringify, method(JSON.stringify, null, checkString));
  set(JSON.parse, method(JSON.parse, (_self, args) => {
    const text = args[0];
    if (typeof text !== "string") return;
    memory(text.length * 4);
    work(text.length >>> 3);
  }));
}
