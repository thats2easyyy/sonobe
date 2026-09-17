/**
 * Promises for script code. Reactions run on the owning realm's job queue, which the patch drains
 * synchronously inside a frame, so async script code settles on the same frame every run.
 */

import { ACTIVE, InternalAbort, activeRealm, callValue, getProp, isObjectLike, markCaught, type Realm } from "./realm.ts";

const PENDING = 0;
const FULFILLED = 1;
const REJECTED = 2;

interface Reaction {
  capability: Capability | null;
  handler: unknown;
  /** Host continuation (await); receives the settled value. */
  internal: ((value: unknown) => boolean | void) | null;
}

interface Slots {
  state: 0 | 1 | 2;
  result: unknown;
  fulfill: Reaction[];
  reject: Reaction[];
  handled: boolean;
  realm: Realm;
}

export interface Capability {
  promise: SafePromise;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

const SLOTS = new WeakMap<object, Slots>();

function slotsOf(value: unknown, method: string): Slots {
  const slots = isObjectLike(value) ? SLOTS.get(value) : undefined;
  if (!slots) throw new TypeError(`Method Promise.prototype.${method} called on incompatible receiver`);
  return slots;
}

/** True for promises created by script code or the sandbox. */
export function isSafePromise(value: unknown): value is SafePromise {
  return isObjectLike(value) && SLOTS.has(value);
}

function initSlots(promise: object, realm: Realm): Slots {
  const slots: Slots = { state: PENDING, result: undefined, fulfill: [], reject: [], handled: false, realm };
  SLOTS.set(promise, slots);
  return slots;
}

function triggerReactions(slots: Slots, reactions: Reaction[], value: unknown, rejected: boolean): void {
  for (const reaction of reactions) slots.realm.enqueue(() => runReaction(reaction, value, rejected));
}

function settle(promise: object, state: 1 | 2, value: unknown): void {
  const slots = SLOTS.get(promise)!;
  if (slots.state !== PENDING) return;
  const reactions = state === FULFILLED ? slots.fulfill : slots.reject;
  slots.state = state;
  slots.result = value;
  slots.fulfill = [];
  slots.reject = [];
  if (state === REJECTED && !slots.handled) slots.realm.pendingRejections.set(promise, value);
  triggerReactions(slots, reactions, value, state === REJECTED);
}

function runReaction(reaction: Reaction, value: unknown, rejected: boolean): boolean {
  if (reaction.internal) return reaction.internal(value) === true;
  const { capability, handler } = reaction;
  if (typeof handler !== "function") {
    if (rejected) capability?.reject(value);
    else capability?.resolve(value);
    return false;
  }
  let result: unknown;
  try {
    result = callValue(handler, undefined, [value]);
  } catch (err) {
    if (err instanceof InternalAbort) throw err;
    markCaught(err);
    capability?.reject(err);
    return true;
  }
  capability?.resolve(result);
  return false;
}

function createResolvingFunctions(promise: object): { resolve: (value?: unknown) => void; reject: (reason?: unknown) => void } {
  let alreadyResolved = false;
  const resolve = (resolution?: unknown) => {
    if (alreadyResolved) return;
    alreadyResolved = true;
    resolvePromise(promise, resolution);
  };
  const reject = (reason?: unknown) => {
    if (alreadyResolved) return;
    alreadyResolved = true;
    settle(promise, REJECTED, reason);
  };
  return { resolve, reject };
}

function resolvePromise(promise: object, resolution: unknown): void {
  if (resolution === promise) {
    settle(promise, REJECTED, new TypeError("Chaining cycle detected for promise"));
    return;
  }
  if (!isObjectLike(resolution)) {
    settle(promise, FULFILLED, resolution);
    return;
  }
  let then: unknown;
  try {
    then = getProp(resolution, "then");
  } catch (err) {
    if (err instanceof InternalAbort) throw err;
    markCaught(err);
    settle(promise, REJECTED, err);
    return;
  }
  if (typeof then !== "function") {
    settle(promise, FULFILLED, resolution);
    return;
  }
  const slots = SLOTS.get(promise)!;
  slots.realm.enqueue(() => {
    const { resolve, reject } = createResolvingFunctions(promise);
    try {
      callValue(then, resolution, [resolve, reject]);
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      reject(err);
      return true;
    }
    return false;
  });
}

/** A new pending promise with its resolving functions. */
export function newCapability(realm: Realm = activeRealm()): Capability {
  const promise = Object.create(SafePromise.prototype) as SafePromise;
  initSlots(promise, realm);
  const { resolve, reject } = createResolvingFunctions(promise);
  return { promise, resolve, reject };
}

/** `Promise.resolve(value)` without looking up `this`. */
export function promiseResolve(value: unknown): SafePromise {
  if (isSafePromise(value)) return value;
  const capability = newCapability();
  capability.resolve(value);
  return capability.promise;
}

function performThen(promise: object, onFulfilled: unknown, onRejected: unknown, capability: Capability | null, internal?: { fulfilled: (v: unknown) => boolean | void; rejected: (v: unknown) => boolean | void }): void {
  const slots = SLOTS.get(promise)!;
  const fulfill: Reaction = { capability, handler: onFulfilled, internal: internal?.fulfilled ?? null };
  const reject: Reaction = { capability, handler: onRejected, internal: internal?.rejected ?? null };
  if (slots.state === PENDING) {
    slots.fulfill.push(fulfill);
    slots.reject.push(reject);
  } else if (slots.state === FULFILLED) {
    const value = slots.result;
    slots.realm.enqueue(() => runReaction(fulfill, value, false));
  } else {
    if (!slots.handled) slots.realm.pendingRejections.delete(promise);
    const value = slots.result;
    slots.realm.enqueue(() => runReaction(reject, value, true));
  }
  slots.handled = true;
}

/** Continue host code when `value` settles (await, for await). */
export function awaitValue(value: unknown, fulfilled: (v: unknown) => boolean | void, rejected: (v: unknown) => boolean | void): void {
  performThen(promiseResolve(value), undefined, undefined, null, { fulfilled, rejected });
}

/** Settle a promise from host code (network deliveries). */
export function settlePromise(capability: Capability, ok: boolean, value: unknown): void {
  if (ok) capability.resolve(value);
  else capability.reject(value);
}

function iterableToList(iterable: unknown): unknown[] {
  if (iterable === null || iterable === undefined) throw new TypeError(`${iterable} is not iterable`);
  return Array.from(iterable as Iterable<unknown>);
}

export class SafePromise {
  constructor(executor: unknown) {
    if (typeof executor !== "function") throw new TypeError(`Promise resolver ${typeof executor === "object" ? String(executor) : typeof executor} is not a function`);
    initSlots(this, activeRealm());
    const { resolve, reject } = createResolvingFunctions(this);
    try {
      callValue(executor, undefined, [resolve, reject]);
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      reject(err);
    }
  }

  then(onFulfilled?: unknown, onRejected?: unknown): SafePromise {
    slotsOf(this, "then");
    const capability = newCapability();
    performThen(this, onFulfilled, onRejected, capability);
    return capability.promise;
  }

  catch(onRejected?: unknown): SafePromise {
    return callValue(getProp(this, "then"), this, [undefined, onRejected]) as SafePromise;
  }

  finally(onFinally?: unknown): SafePromise {
    slotsOf(this, "finally");
    if (typeof onFinally !== "function") return this.then(onFinally, onFinally);
    return this.then(
      (value: unknown) => promiseResolve(callValue(onFinally, undefined, [])).then(() => value),
      (reason: unknown) =>
        promiseResolve(callValue(onFinally, undefined, [])).then(() => {
          throw reason;
        }),
    );
  }

  static resolve(value?: unknown): SafePromise {
    return promiseResolve(value);
  }

  static reject(reason?: unknown): SafePromise {
    const capability = newCapability();
    capability.reject(reason);
    return capability.promise;
  }

  static withResolvers(): { promise: SafePromise; resolve: (v?: unknown) => void; reject: (r?: unknown) => void } {
    const capability = newCapability();
    return { promise: capability.promise, resolve: capability.resolve, reject: capability.reject };
  }

  static try(fn: unknown, ...args: unknown[]): SafePromise {
    const capability = newCapability();
    try {
      capability.resolve(callValue(fn, undefined, args));
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      capability.reject(err);
    }
    return capability.promise;
  }

  static all(iterable: unknown): SafePromise {
    const capability = newCapability();
    try {
      const items = iterableToList(iterable);
      const values = new Array<unknown>(items.length);
      let remaining = items.length;
      if (remaining === 0) capability.resolve(values);
      items.forEach((item, i) => {
        performThen(promiseResolve(item), undefined, undefined, null, {
          fulfilled: (v) => {
            values[i] = v;
            if (--remaining === 0) capability.resolve(values);
          },
          rejected: (r) => capability.reject(r),
        });
      });
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      capability.reject(err);
    }
    return capability.promise;
  }

  static allSettled(iterable: unknown): SafePromise {
    const capability = newCapability();
    try {
      const items = iterableToList(iterable);
      const values = new Array<unknown>(items.length);
      let remaining = items.length;
      if (remaining === 0) capability.resolve(values);
      items.forEach((item, i) => {
        const done = (entry: object) => {
          values[i] = entry;
          if (--remaining === 0) capability.resolve(values);
        };
        performThen(promiseResolve(item), undefined, undefined, null, {
          fulfilled: (value) => done({ status: "fulfilled", value }),
          rejected: (reason) => done({ status: "rejected", reason }),
        });
      });
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      capability.reject(err);
    }
    return capability.promise;
  }

  static race(iterable: unknown): SafePromise {
    const capability = newCapability();
    try {
      for (const item of iterableToList(iterable)) {
        performThen(promiseResolve(item), undefined, undefined, null, { fulfilled: (v) => capability.resolve(v), rejected: (r) => capability.reject(r) });
      }
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      capability.reject(err);
    }
    return capability.promise;
  }

  static any(iterable: unknown): SafePromise {
    const capability = newCapability();
    try {
      const items = iterableToList(iterable);
      const errors = new Array<unknown>(items.length);
      let remaining = items.length;
      if (remaining === 0) capability.reject(new AggregateError([], "All promises were rejected"));
      items.forEach((item, i) => {
        performThen(promiseResolve(item), undefined, undefined, null, {
          fulfilled: (v) => capability.resolve(v),
          rejected: (r) => {
            errors[i] = r;
            if (--remaining === 0) capability.reject(new AggregateError(errors, "All promises were rejected"));
          },
        });
      });
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      capability.reject(err);
    }
    return capability.promise;
  }
}

Object.defineProperty(SafePromise, "name", { value: "Promise" });
Object.defineProperty(SafePromise.prototype, Symbol.toStringTag, { value: "Promise", configurable: true });

/** The realm that owns a promise (for deliveries). */
export function promiseRealm(promise: SafePromise): Realm | undefined {
  return SLOTS.get(promise)?.realm ?? ACTIVE.realm ?? undefined;
}
