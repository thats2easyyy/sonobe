/**
 * Closure compiler for script sources. The syntax tree compiles once into JavaScript closures over
 * statically resolved variable slots; running a program only calls closures. Code that can suspend
 * (await, yield) compiles into generator closures, and everything else stays plain, so ordinary
 * functions pay nothing for async support. Loops and calls tick the realm's budget.
 */

import type * as A from "./ast.ts";
import { Lexer } from "./lexer.ts";
import { parseScript } from "./parser.ts";
import { awaitValue, newCapability, type SafePromise } from "./promise.ts";
import {
  ACTIVE,
  InternalAbort,
  MAX_CALL_DEPTH,
  MAX_STRING_LENGTH,
  SCRIPT_FUNCTIONS,
  activeRealm,
  callValue,
  constructValue,
  deleteProp,
  getProp,
  guardWrite,
  isConstructor,
  isObjectLike,
  markCaught,
  markThrown,
  registerIntrinsics,
  setProp,
  substitute,
  type Realm,
  type ScriptFunctionRecord,
} from "./realm.ts";
import { chargeElements, chargeKeys } from "./natives.ts";

// ---------------------------------------------------------------------------
// Runtime structures
// ---------------------------------------------------------------------------

/** A runtime environment: variable slots plus the enclosing environment. */
export interface Env {
  v: unknown[];
  p: Env | null;
}

const TDZ: unique symbol = Symbol("uninitialized");
const CHAIN: unique symbol = Symbol("chain");

const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;

interface Completion {
  t: 1 | 2 | 3;
  label: string | null;
  value: unknown;
}

type Ex = (env: Env) => unknown;
type St = (env: Env) => Completion | undefined;
type ExG = (env: Env) => Generator<unknown, unknown, unknown>;
type StG = (env: Env) => Generator<unknown, Completion | undefined, unknown>;
type Binder = (env: Env, value: unknown) => void;
type BinderG = (env: Env, value: unknown) => Generator<unknown, void, unknown>;

/** Either a plain closure or a suspending one. */
interface Ev {
  s: Ex | null;
  g: ExG | null;
}

/** Yielded by suspending closures for `await`; anything else yielded is a generator value. */
export class AwaitSignal {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}

const ARRAY_VALUES = Array.prototype[Symbol.iterator];

function envAt(env: Env, depth: number): Env {
  let e = env;
  for (let i = 0; i < depth; i++) e = e.p!;
  return e;
}

function makeArgumentsObject(): unknown {
  // eslint-disable-next-line prefer-rest-params
  return arguments;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value.length > 30 ? `${value.slice(0, 30)}…` : value);
  if (typeof value === "function") return value.name ? `function ${value.name}` : "a function";
  if (typeof value === "object") return Array.isArray(value) ? "an array" : "an object";
  return String(value);
}

function checkString(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) throw new InternalAbort("memory");
  return value;
}

function toPropertyKey(value: unknown): PropertyKey {
  if (typeof value === "string" || typeof value === "symbol") return value;
  if (typeof value === "number") return String(value);
  if (isObjectLike(value)) {
    const primitive = (value as { [Symbol.toPrimitive]?: unknown })[Symbol.toPrimitive];
    if (typeof primitive === "function") return toPropertyKey(callValue(primitive, value, ["string"]));
    return String(value);
  }
  return String(value);
}

function defineData(target: object, key: PropertyKey, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
  else (target as Record<PropertyKey, unknown>)[key] = value;
}

function copyDataProperties(target: object, source: unknown, excluded?: ReadonlySet<PropertyKey>): void {
  if (source === null || source === undefined) return;
  const from = Object(source) as object;
  chargeKeys(from, 64);
  for (const key of Reflect.ownKeys(from)) {
    if (excluded?.has(key)) continue;
    const d = Reflect.getOwnPropertyDescriptor(from, key);
    if (d?.enumerable) defineData(target, key, getProp(from, key));
  }
}

function getIterator(value: unknown): { it: object; next: unknown } {
  const method = value === null || value === undefined ? undefined : getProp(value, Symbol.iterator);
  if (typeof method !== "function") throw new TypeError(`${describeValue(value)} is not iterable`);
  const it = callValue(method, value, []);
  if (!isObjectLike(it)) throw new TypeError("Result of the Symbol.iterator method is not an object");
  return { it, next: getProp(it, "next") };
}

function iteratorStep(it: object, next: unknown): { done: boolean; value: unknown } {
  const r = callValue(next, it, []);
  if (!isObjectLike(r)) throw new TypeError(`Iterator result ${describeValue(r)} is not an object`);
  if (getProp(r, "done")) return { done: true, value: undefined };
  return { done: false, value: getProp(r, "value") };
}

function closeIterator(it: object, suppress: boolean): void {
  try {
    const ret = getProp(it, "return");
    if (ret !== undefined && ret !== null) callValue(ret, it, []);
  } catch (err) {
    if (err instanceof InternalAbort || !suppress) throw err;
  }
}

function isBreakFor(c: Completion, labels: ReadonlySet<string> | null): boolean {
  return c.t === BREAK && (c.label === null || (labels !== null && labels.has(c.label)));
}

function isContinueFor(c: Completion, labels: ReadonlySet<string> | null): boolean {
  return c.t === CONTINUE && (c.label === null || (labels !== null && labels.has(c.label)));
}

// ---------------------------------------------------------------------------
// Private names
// ---------------------------------------------------------------------------

class PrivateName {
  readonly description: string;
  kind: "field" | "method" | "accessor" = "field";
  method: unknown = undefined;
  getter: unknown = undefined;
  setter: unknown = undefined;
  isStatic = false;
  constructor(description: string) {
    this.description = description;
  }
}

const PRIVATE_DATA = new WeakMap<object, Map<PrivateName, unknown>>();

function privateGet(obj: unknown, pn: PrivateName): unknown {
  const data = isObjectLike(obj) ? PRIVATE_DATA.get(obj) : undefined;
  if (!data?.has(pn)) throw new TypeError(`Cannot read private member #${pn.description} from an object whose class did not declare it`);
  if (pn.kind === "field") return data.get(pn);
  if (pn.kind === "method") return pn.method;
  if (pn.getter === undefined) throw new TypeError(`'#${pn.description}' was defined without a getter`);
  return callValue(pn.getter, obj, []);
}

function privateSet(obj: unknown, pn: PrivateName, value: unknown): void {
  const data = isObjectLike(obj) ? PRIVATE_DATA.get(obj) : undefined;
  if (!data?.has(pn)) throw new TypeError(`Cannot write private member #${pn.description} to an object whose class did not declare it`);
  if (pn.kind === "field") data.set(pn, value);
  else if (pn.kind === "method") throw new TypeError(`Private method #${pn.description} is not writable`);
  else if (pn.setter === undefined) throw new TypeError(`'#${pn.description}' was defined without a setter`);
  else callValue(pn.setter, obj, [value]);
}

function privateAdd(obj: object, pn: PrivateName, value: unknown): void {
  let data = PRIVATE_DATA.get(obj);
  if (!data) PRIVATE_DATA.set(obj, (data = new Map()));
  if (data.has(pn)) throw new TypeError(`Cannot initialize #${pn.description} twice on the same object`);
  data.set(pn, value);
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

type BinaryOp = (a: any, b: any) => unknown;

const BINARY_OPS: Readonly<Record<string, BinaryOp>> = {
  "+": (a, b) => checkString(a + b),
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  "%": (a, b) => a % b,
  "**": (a, b) => a ** b,
  "<<": (a, b) => a << b,
  ">>": (a, b) => a >> b,
  ">>>": (a, b) => a >>> b,
  "&": (a, b) => a & b,
  "|": (a, b) => a | b,
  "^": (a, b) => a ^ b,
  "==": (a, b) => a == b,
  "!=": (a, b) => a != b,
  "===": (a, b) => a === b,
  "!==": (a, b) => a !== b,
  "<": (a, b) => a < b,
  ">": (a, b) => a > b,
  "<=": (a, b) => a <= b,
  ">=": (a, b) => a >= b,
  instanceof: (a, b) => {
    if (!isObjectLike(b)) throw new TypeError("Right-hand side of 'instanceof' is not callable");
    return a instanceof (b as new () => unknown);
  },
  in: (a, b) => {
    if (!isObjectLike(b)) throw new TypeError(`Cannot use 'in' operator to search for '${String(a)}' in ${describeValue(b)}`);
    return toPropertyKey(a) in b;
  },
};

function toNumeric(value: unknown): number | bigint {
  return typeof value === "bigint" ? value : Number(value);
}

function increment(n: number | bigint, delta: 1 | -1): number | bigint {
  return typeof n === "bigint" ? n + BigInt(delta) : n + delta;
}

// ---------------------------------------------------------------------------
// Compile-time scopes
// ---------------------------------------------------------------------------

type BindingKind = "var" | "let" | "const" | "class" | "function" | "param" | "internal" | "callee";

interface Binding {
  index: number;
  kind: BindingKind;
}

interface FnInfo {
  async: boolean;
  generator: boolean;
}

interface CScope {
  parent: CScope | null;
  names: Map<string, Binding>;
  initial: unknown[];
  fn: FnInfo;
  /** Class scopes: private names declared by the class, resolved through the `%private` slot. */
  privateNames: ReadonlySet<string> | null;
}

interface Resolved {
  depth: number;
  index: number;
  kind: BindingKind;
}

const LEXICAL: ReadonlySet<BindingKind> = new Set(["let", "const", "class", "callee"]);

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

interface Slots {
  this: number;
  newTarget: number;
  home: number;
  func: number;
  arguments: number;
}

interface FunctionTemplate {
  name: string;
  length: number;
  kind: "normal" | "arrow" | "method" | "constructor";
  async: boolean;
  generator: boolean;
  initial: unknown[];
  slots: Slots;
  run: (env: Env, args: unknown[]) => unknown;
  runG: ((env: Env, args: unknown[]) => Generator<unknown, unknown, unknown>) | null;
  start: number;
  end: number;
  source: string;
}

interface FieldDef {
  key: PropertyKey | PrivateName;
  init: FunctionRecord | null;
}

interface ClassInfo {
  derived: boolean;
  fields: FieldDef[];
  brands: PrivateName[];
}

interface FunctionRecord extends ScriptFunctionRecord {
  template: FunctionTemplate;
  env: Env;
  home: object | undefined;
  realm: Realm;
  wrapper: Function;
  classInfo: ClassInfo | null;
}

const CLASS_RECORDS = new WeakMap<object, FunctionRecord>();

function invoke(record: FunctionRecord, thisArg: unknown, args: unknown[], newTarget: unknown): unknown {
  const realm = record.realm;
  const previous = ACTIVE.realm;
  ACTIVE.realm = realm;
  try {
    realm.tick();
    if (++realm.depth > MAX_CALL_DEPTH) throw new RangeError("Maximum call stack size exceeded");
    const t = record.template;
    const env: Env = { v: t.initial.slice(), p: record.env };
    const s = t.slots;
    if (s.this >= 0) env.v[s.this] = thisArg;
    if (s.newTarget >= 0) env.v[s.newTarget] = newTarget;
    if (s.home >= 0) env.v[s.home] = record.home;
    if (s.func >= 0) env.v[s.func] = record.wrapper;
    if (s.arguments >= 0) env.v[s.arguments] = Reflect.apply(makeArgumentsObject, undefined, args);
    if (t.async) return t.generator ? new ScriptAsyncGenerator(t.runG!(env, args), realm) : runAsync(t.runG!(env, args), realm);
    if (t.generator) return t.runG!(env, args);
    const savedPos = ACTIVE.pos;
    const result = t.run(env, args);
    ACTIVE.pos = savedPos;
    return result;
  } finally {
    realm.depth--;
    ACTIVE.realm = previous;
  }
}

function constructClass(record: FunctionRecord, thisArg: unknown, args: unknown[], newTarget: unknown): unknown {
  const realm = record.realm;
  const previous = ACTIVE.realm;
  ACTIVE.realm = realm;
  try {
    realm.tick();
    if (++realm.depth > MAX_CALL_DEPTH) throw new RangeError("Maximum call stack size exceeded");
    const t = record.template;
    const info = record.classInfo!;
    const env: Env = { v: t.initial.slice(), p: record.env };
    const s = t.slots;
    env.v[s.newTarget] = newTarget;
    env.v[s.home] = record.home;
    env.v[s.func] = record.wrapper;
    if (s.arguments >= 0) env.v[s.arguments] = Reflect.apply(makeArgumentsObject, undefined, args);
    if (!info.derived) {
      env.v[s.this] = thisArg;
      initializeInstance(record, thisArg as object);
    } else env.v[s.this] = TDZ;
    const savedPos = ACTIVE.pos;
    const result = t.run(env, args);
    ACTIVE.pos = savedPos;
    if (isObjectLike(result)) return result;
    if (info.derived) {
      if (result !== undefined) throw new TypeError("Derived constructors may only return object or undefined");
      const value = env.v[s.this];
      if (value === TDZ) throw new ReferenceError("Must call super constructor in derived class before accessing 'this' or returning from derived constructor");
      return value;
    }
    return thisArg;
  } finally {
    realm.depth--;
    ACTIVE.realm = previous;
  }
}

function initializeInstance(classRecord: FunctionRecord, obj: object): void {
  const info = classRecord.classInfo!;
  for (const pn of info.brands) privateAdd(obj, pn, true);
  for (const field of info.fields) {
    const value = field.init ? invoke(field.init, obj, [], undefined) : undefined;
    if (field.key instanceof PrivateName) privateAdd(obj, field.key, value);
    else {
      guardWrite(obj);
      Object.defineProperty(obj, field.key, { value, writable: true, enumerable: true, configurable: true });
    }
  }
}

/** Resume a script generator with its realm active (host code may drive it). */
function* withRealm(realm: Realm, gen: Generator<unknown, unknown, unknown>): Generator<unknown, unknown, unknown> {
  let mode: 0 | 1 = 0;
  let arg: unknown;
  for (;;) {
    let r: IteratorResult<unknown, unknown>;
    const previous = ACTIVE.realm;
    ACTIVE.realm = realm;
    try {
      r = mode === 0 ? gen.next(arg) : gen.throw(arg);
    } finally {
      ACTIVE.realm = previous;
    }
    if (r.done) return r.value;
    let returning = true;
    try {
      arg = yield r.value;
      mode = 0;
      returning = false;
    } catch (err) {
      arg = err;
      mode = 1;
      returning = false;
    } finally {
      if (returning) {
        const prev = ACTIVE.realm;
        ACTIVE.realm = realm;
        try {
          gen.return(undefined);
        } finally {
          ACTIVE.realm = prev;
        }
      }
    }
  }
}

function runAsync(gen: Generator<unknown, unknown, unknown>, realm: Realm): SafePromise {
  const capability = newCapability(realm);
  const step = (mode: 0 | 1, arg: unknown): boolean => {
    let r: IteratorResult<unknown, unknown>;
    const previous = ACTIVE.realm;
    ACTIVE.realm = realm;
    try {
      r = mode === 0 ? gen.next(arg) : gen.throw(arg);
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      capability.reject(err);
      return true;
    } finally {
      ACTIVE.realm = previous;
    }
    if (r.done) {
      capability.resolve(r.value);
      return false;
    }
    const signal = r.value as AwaitSignal;
    awaitValue(signal.value, (v) => step(0, v), (e) => step(1, e));
    return false;
  };
  step(0, undefined);
  return capability.promise;
}

interface AsyncGeneratorRequest {
  mode: 0 | 1 | 2;
  value: unknown;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

/** Async generator objects for `async function*`. */
class ScriptAsyncGenerator {
  #gen: Generator<unknown, unknown, unknown>;
  #realm: Realm;
  #queue: AsyncGeneratorRequest[] = [];
  #running = false;
  #done = false;

  constructor(gen: Generator<unknown, unknown, unknown>, realm: Realm) {
    this.#gen = gen;
    this.#realm = realm;
  }

  next(value?: unknown): SafePromise {
    return this.#enqueue(0, value);
  }

  throw(value?: unknown): SafePromise {
    return this.#enqueue(1, value);
  }

  return(value?: unknown): SafePromise {
    return this.#enqueue(2, value);
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  #enqueue(mode: 0 | 1 | 2, value: unknown): SafePromise {
    const capability = newCapability(this.#realm);
    this.#queue.push({ mode, value, resolve: capability.resolve, reject: capability.reject });
    this.#resumeNext();
    return capability.promise;
  }

  #resumeNext(): void {
    if (this.#running || !this.#queue.length) return;
    const request = this.#queue[0]!;
    if (this.#done) {
      this.#queue.shift();
      if (request.mode === 1) request.reject(request.value);
      else request.resolve({ value: request.mode === 2 ? request.value : undefined, done: true });
      this.#resumeNext();
      return;
    }
    this.#running = true;
    this.#step(request.mode, request.value);
  }

  #step(mode: 0 | 1 | 2, arg: unknown): boolean {
    let r: IteratorResult<unknown, unknown>;
    const previous = ACTIVE.realm;
    ACTIVE.realm = this.#realm;
    try {
      r = mode === 0 ? this.#gen.next(arg) : mode === 1 ? this.#gen.throw(arg) : this.#gen.return(arg);
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      markCaught(err);
      this.#finish().reject(err);
      return true;
    } finally {
      ACTIVE.realm = previous;
    }
    if (r.value instanceof AwaitSignal) {
      awaitValue(r.value.value, (v) => this.#step(0, v), (e) => this.#step(1, e));
      return false;
    }
    if (r.done) this.#finish().resolve({ value: r.value, done: true });
    else {
      this.#running = false;
      this.#queue.shift()!.resolve({ value: r.value, done: false });
      this.#resumeNext();
    }
    return false;
  }

  #finish(): AsyncGeneratorRequest {
    this.#done = true;
    this.#running = false;
    const request = this.#queue.shift()!;
    queueMicrotaskOn(this.#realm, () => this.#resumeNext());
    return request;
  }
}

function queueMicrotaskOn(realm: Realm, fn: () => void): void {
  realm.enqueue(() => {
    fn();
  });
}

function makeFunction(template: FunctionTemplate, env: Env, home?: object, nameOverride?: PropertyKey): Function {
  const record = { template, env, home, realm: activeRealm(), wrapper: null as unknown as Function, classInfo: null } as FunctionRecord;
  let fn: Function;
  const t = template;
  if (t.kind === "constructor") {
    fn = function (this: unknown, ...args: unknown[]) {
      if (new.target === undefined) throw new TypeError(`Class constructor ${t.name || "(anonymous)"} cannot be invoked without 'new'`);
      return constructClass(record, this, args, new.target);
    };
  } else if (t.async && t.generator) {
    fn = { m(this: unknown, ...args: unknown[]) { return invoke(record, this, args, undefined); } }.m;
  } else if (t.generator) {
    fn =
      t.kind === "normal"
        ? function* (this: unknown, ...args: unknown[]) {
            return yield* withRealm(record.realm, invoke(record, this, args, undefined) as Generator<unknown, unknown, unknown>);
          }
        : { *m(this: unknown, ...args: unknown[]) { return yield* withRealm(record.realm, invoke(record, this, args, undefined) as Generator<unknown, unknown, unknown>); } }.m;
  } else if (t.kind === "arrow") {
    fn = (...args: unknown[]) => invoke(record, undefined, args, undefined);
  } else if (t.kind === "normal" && !t.async) {
    fn = function (this: unknown, ...args: unknown[]) {
      return invoke(record, this, args, new.target);
    };
  } else {
    fn = { m(this: unknown, ...args: unknown[]) { return invoke(record, this, args, undefined); } }.m;
  }
  let name = t.name;
  if (nameOverride !== undefined) name = typeof nameOverride === "symbol" ? (nameOverride.description ? `[${nameOverride.description}]` : "") : String(nameOverride);
  Object.defineProperty(fn, "name", { value: name, configurable: true });
  Object.defineProperty(fn, "length", { value: t.length, configurable: true });
  record.wrapper = fn;
  record.call = (thisArg, args) => {
    if (t.kind === "constructor") throw new TypeError(`Class constructor ${name || "(anonymous)"} cannot be invoked without 'new'`);
    if (t.generator && !t.async) return Reflect.apply(fn, thisArg, args);
    return invoke(record, thisArg, args, undefined);
  };
  record.source = () => t.source;
  SCRIPT_FUNCTIONS.set(fn, record);
  return fn;
}

// ---------------------------------------------------------------------------
// Syntax tree helpers
// ---------------------------------------------------------------------------

function forEachChild(node: A.Node, visit: (child: A.Node) => void): void {
  const n = node as unknown as Record<string, unknown>;
  switch (node.type) {
    case "Identifier":
    case "PrivateIdentifier":
    case "Literal":
    case "RegExpLiteral":
    case "ThisExpression":
    case "Super":
    case "MetaProperty":
    case "EmptyStatement":
    case "DebuggerStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return;
    default:
      break;
  }
  for (const key in n) {
    if (key === "start" || key === "end" || key === "type") continue;
    const value = n[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === "object" && "type" in item) visit(item as A.Node);
    } else if (value && typeof value === "object" && "type" in value) visit(value as A.Node);
  }
}

const isFunctionNode = (node: A.Node): boolean =>
  node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";

const suspendCache = new WeakMap<object, boolean>();

/** True when evaluating `node` can suspend (await, yield) in the current function. */
function hasSuspend(node: A.Node | null | undefined): boolean {
  if (!node) return false;
  const cached = suspendCache.get(node);
  if (cached !== undefined) return cached;
  let found = node.type === "AwaitExpression" || node.type === "YieldExpression" || (node.type === "ForOfStatement" && node.await);
  if (!found && !isFunctionNode(node) && node.type !== "ClassDeclaration" && node.type !== "ClassExpression") {
    forEachChild(node, (child) => {
      if (!found && hasSuspend(child)) found = true;
    });
  }
  if (!found && (node.type === "ClassDeclaration" || node.type === "ClassExpression")) {
    found = hasSuspend(node.superClass) || node.body.some((m) => m.type !== "StaticBlock" && m.computed && hasSuspend(m.key as A.Expression));
  }
  suspendCache.set(node, found);
  return found;
}

function usesArguments(node: A.FunctionNode): boolean {
  let found = false;
  const visit = (child: A.Node) => {
    if (found) return;
    if (child.type === "Identifier" && child.name === "arguments") found = true;
    else if (child.type === "FunctionDeclaration" || child.type === "FunctionExpression") return;
    else if (child.type === "PropertyDefinition" || child.type === "StaticBlock") return;
    else forEachChild(child, visit);
  };
  for (const p of node.params) visit(p);
  visit(node.body);
  return found;
}

function patternNames(pattern: A.Pattern, out: A.Identifier[]): void {
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern);
      return;
    case "AssignmentPattern":
      patternNames(pattern.left, out);
      return;
    case "RestElement":
      patternNames(pattern.argument, out);
      return;
    case "ArrayPattern":
      for (const e of pattern.elements) if (e) patternNames(e, out);
      return;
    case "ObjectPattern":
      for (const p of pattern.properties) patternNames(p.type === "RestElement" ? p.argument : p.value, out);
      return;
    default:
      return;
  }
}

function collectVarNames(statements: readonly A.Statement[], out: A.Identifier[]): void {
  const visit = (s: A.Statement | null | undefined): void => {
    if (!s) return;
    switch (s.type) {
      case "VariableDeclaration":
        if (s.kind === "var") for (const d of s.declarations) patternNames(d.id, out);
        return;
      case "ExportNamedDeclaration":
        if (s.declaration) visit(s.declaration);
        return;
      case "BlockStatement":
        s.body.forEach(visit);
        return;
      case "IfStatement":
        visit(s.consequent);
        visit(s.alternate);
        return;
      case "ForStatement":
        if (s.init?.type === "VariableDeclaration") visit(s.init);
        visit(s.body);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        if (s.left.type === "VariableDeclaration") visit(s.left);
        visit(s.body);
        return;
      case "WhileStatement":
      case "DoWhileStatement":
      case "LabeledStatement":
        visit(s.body);
        return;
      case "TryStatement":
        visit(s.block);
        if (s.handler) visit(s.handler.body);
        visit(s.finalizer);
        return;
      case "SwitchStatement":
        for (const c of s.cases) c.consequent.forEach(visit);
        return;
      default:
        return;
    }
  };
  statements.forEach(visit);
}

interface LexicalDecls {
  names: { id: A.Identifier; kind: BindingKind }[];
  functions: A.FunctionDeclaration[];
}

function collectLexical(statements: readonly A.Statement[], topLevelFunctionsAreVar: boolean): LexicalDecls {
  const decls: LexicalDecls = { names: [], functions: [] };
  for (const raw of statements) {
    let s: A.Statement | A.Expression = raw;
    if (s.type === "ExportNamedDeclaration") {
      if (!s.declaration) continue;
      s = s.declaration;
    } else if (s.type === "ExportDefaultDeclaration") {
      const d = s.declaration;
      if (d.type === "FunctionDeclaration") {
        decls.functions.push(d);
        if (!topLevelFunctionsAreVar) decls.names.push({ id: d.id ?? { type: "Identifier", name: "*default*", start: d.start, end: d.end }, kind: "function" });
      } else if (d.type === "ClassDeclaration" && d.id) decls.names.push({ id: d.id, kind: "class" });
      continue;
    }
    if (s.type === "VariableDeclaration" && s.kind !== "var") {
      const ids: A.Identifier[] = [];
      for (const d of s.declarations) patternNames(d.id, ids);
      for (const id of ids) decls.names.push({ id, kind: s.kind });
    } else if (s.type === "ClassDeclaration") decls.names.push({ id: s.id, kind: "class" });
    else if (s.type === "FunctionDeclaration") {
      decls.functions.push(s);
      if (!topLevelFunctionsAreVar) decls.names.push({ id: s.id, kind: "function" });
    }
  }
  return decls;
}

// ---------------------------------------------------------------------------
// Compiled programs
// ---------------------------------------------------------------------------

/** A module's bindings after its top level ran. */
export interface ModuleInstance {
  /** An exported binding's current value (undefined before initialization). */
  getExport(name: string): unknown;
  /** Exported names in declaration order. */
  readonly exportNames: readonly string[];
  /** Origami-style programs: the value the file body returned. */
  readonly returned: unknown;
}

export interface CompiledScript {
  readonly source: string;
  readonly kind: A.Program["kind"];
  /** 1-based line and column of a source offset. */
  position(offset: number): { line: number; column: number };
  /** Run the top level in `realm`. Throws script exceptions and InternalAbort. */
  run(realm: Realm): ModuleInstance;
}

/** Parse and compile a script. Throws ScriptSyntaxError. */
export function compileScript(source: string, kind: A.Program["kind"] = "module"): CompiledScript {
  const program = parseScript(source, { kind });
  return new Compiler(source).program(program);
}

class Compiler {
  private readonly src: string;
  private readonly lexer: Lexer;

  constructor(src: string) {
    this.src = src;
    this.lexer = new Lexer(src);
  }

  private error(message: string, offset: number): never {
    return this.lexer.error(message, offset);
  }

  // ---- scopes -----------------------------------------------------------------------

  private newScope(parent: CScope | null, fn: FnInfo, privateNames: ReadonlySet<string> | null = null): CScope {
    return { parent, names: new Map(), initial: [], fn, privateNames };
  }

  private declareName(scope: CScope, name: string, kind: BindingKind, offset: number): Binding {
    const existing = scope.names.get(name);
    if (existing) {
      const redeclarable = (k: BindingKind) => k === "var" || k === "function" || k === "param";
      if (redeclarable(existing.kind) && redeclarable(kind)) {
        if (kind === "function") existing.kind = "function";
        return existing;
      }
      this.error(`"${name}" has already been declared.`, offset);
    }
    const binding: Binding = { index: scope.initial.length, kind };
    scope.initial.push(LEXICAL.has(kind) ? TDZ : undefined);
    scope.names.set(name, binding);
    return binding;
  }

  private resolve(scope: CScope, name: string): Resolved | null {
    let depth = 0;
    for (let s: CScope | null = scope; s; s = s.parent) {
      const b = s.names.get(name);
      if (b) return { depth, index: b.index, kind: b.kind };
      depth++;
    }
    return null;
  }

  private mustResolve(scope: CScope, name: string, offset: number): Resolved {
    const r = this.resolve(scope, name);
    if (!r) this.error(`Internal error: "${name}" isn't declared.`, offset);
    return r;
  }

  // ---- programs -----------------------------------------------------------------

  program(program: A.Program): CompiledScript {
    const fn: FnInfo = { async: false, generator: false };
    const scope = this.newScope(null, fn);
    this.declareName(scope, "%this", "internal", program.start);
    const vars: A.Identifier[] = [];
    collectVarNames(program.body, vars);
    for (const id of vars) this.declareName(scope, id.name, "var", id.start);
    const lexical = collectLexical(program.body, false);
    for (const { id, kind } of lexical.names) this.declareName(scope, id.name, kind, id.start);
    const hasDefault = program.body.some((s) => s.type === "ExportDefaultDeclaration");
    if (hasDefault && !scope.names.has("*default*")) this.declareName(scope, "*default*", "let", program.start);
    const exports = new Map<string, number>();
    for (const s of program.body) {
      if (s.type === "ExportNamedDeclaration") {
        if (s.declaration) {
          const ids: A.Identifier[] = [];
          if (s.declaration.type === "VariableDeclaration") for (const d of s.declaration.declarations) patternNames(d.id, ids);
          else ids.push(s.declaration.id);
          for (const id of ids) exports.set(id.name, scope.names.get(id.name)!.index);
        }
        for (const spec of s.specifiers) {
          const b = scope.names.get(spec.local);
          if (!b) this.error(`"${spec.local}" isn't declared, so it can't be exported.`, s.start);
          exports.set(spec.exported, b.index);
        }
      } else if (s.type === "ExportDefaultDeclaration") {
        const d = s.declaration;
        const name = (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id ? d.id.name : "*default*";
        exports.set("default", scope.names.get(name)!.index);
      }
    }
    const hoist = this.hoistFunctions(lexical.functions, scope);
    const body = this.statements(program.body, scope);
    const initial = scope.initial;
    const source = this.src;
    const lexer = this.lexer;
    const kind = program.kind;
    return {
      source,
      kind,
      position: (offset) => lexer.position(offset),
      run(realm) {
        const env: Env = { v: initial.slice(), p: null };
        const returned = realm.run(() => {
          hoist(env);
          const c = body(env);
          return c && c.t === RETURN ? c.value : undefined;
        });
        return {
          exportNames: [...exports.keys()],
          returned,
          getExport(name) {
            const index = exports.get(name);
            if (index === undefined) return undefined;
            const value = env.v[index];
            return value === TDZ ? undefined : value;
          },
        };
      },
    };
  }

  private hoistFunctions(functions: readonly A.FunctionDeclaration[], scope: CScope): (env: Env) => void {
    if (!functions.length) return () => {};
    const entries = functions.map((node) => {
      const name = node.id?.name ?? "*default*";
      const r = this.mustResolve(scope, name, node.start);
      if (r.depth !== 0) this.error(`Internal error: function "${name}" hoisted into the wrong scope.`, node.start);
      const template = this.functionTemplate(node, scope, "normal", node.id ? node.id.name : "default");
      return { index: r.index, template };
    });
    return (env) => {
      for (const e of entries) env.v[e.index] = makeFunction(e.template, env);
    };
  }

  // ---- functions ------------------------------------------------------------------

  private functionTemplate(node: A.FunctionNode, outer: CScope, kind: FunctionTemplate["kind"], name: string): FunctionTemplate {
    const fn: FnInfo = { async: node.async, generator: node.generator };
    const scope = this.newScope(outer, fn);
    const slots: Slots = { this: -1, newTarget: -1, home: -1, func: -1, arguments: -1 };
    if (kind !== "arrow") {
      slots.this = this.declareName(scope, "%this", "internal", node.start).index;
      slots.newTarget = this.declareName(scope, "%newtarget", "internal", node.start).index;
      slots.home = this.declareName(scope, "%home", "internal", node.start).index;
      slots.func = this.declareName(scope, "%func", "internal", node.start).index;
      if (usesArguments(node)) slots.arguments = this.declareName(scope, "arguments", "var", node.start).index;
    }
    const paramIds: A.Identifier[] = [];
    for (const p of node.params) patternNames(p, paramIds);
    const seen = new Set<string>();
    for (const id of paramIds) {
      if (seen.has(id.name)) this.error(`Duplicate parameter "${id.name}".`, id.start);
      seen.add(id.name);
      this.declareName(scope, id.name, "param", id.start);
    }
    let length = 0;
    for (const p of node.params) {
      if (p.type === "AssignmentPattern" || p.type === "RestElement") break;
      length++;
    }
    const binders = node.params.map((p) => {
      if (p.type === "RestElement") {
        const bind = this.binder(p.argument, scope, "init");
        const index = node.params.indexOf(p);
        return (env: Env, args: unknown[]) => bind(env, args.slice(index));
      }
      const bind = this.binder(p, scope, "init");
      const index = node.params.indexOf(p);
      return (env: Env, args: unknown[]) => bind(env, args[index]);
    });
    const bindParams = (env: Env, args: unknown[]) => {
      for (const b of binders) b(env, args);
    };

    const bodyNode = node.body;
    let run: FunctionTemplate["run"];
    let runG: FunctionTemplate["runG"] = null;
    if (bodyNode.type === "BlockStatement") {
      const statements = bodyNode.body;
      const vars: A.Identifier[] = [];
      collectVarNames(statements, vars);
      for (const id of vars) this.declareName(scope, id.name, "var", id.start);
      const lexical = collectLexical(statements, false);
      for (const { id, kind: k } of lexical.names) this.declareName(scope, id.name, k, id.start);
      const hoist = this.hoistFunctions(lexical.functions, scope);
      if (node.async || node.generator) {
        const body = this.statementsG(statements, scope);
        runG = function* (env, args) {
          bindParams(env, args);
          hoist(env);
          const c = yield* body(env);
          return c && c.t === RETURN ? c.value : undefined;
        };
        run = () => undefined;
      } else {
        const body = this.statements(statements, scope);
        run = (env, args) => {
          bindParams(env, args);
          hoist(env);
          const c = body(env);
          return c && c.t === RETURN ? c.value : undefined;
        };
      }
    } else {
      const expr = bodyNode;
      const start = expr.start;
      if (node.async) {
        const ev = this.ev(expr, scope);
        runG = function* (env, args) {
          bindParams(env, args);
          ACTIVE.pos = start;
          return ev.g ? yield* ev.g(env) : ev.s!(env);
        };
        run = () => undefined;
      } else {
        const body = this.expr(expr, scope);
        run = (env, args) => {
          bindParams(env, args);
          ACTIVE.pos = start;
          return body(env);
        };
      }
    }
    return { name, length, kind, async: node.async, generator: node.generator, initial: scope.initial, slots, run, runG, start: node.start, end: node.end, source: this.src.slice(node.start, node.end) };
  }

  /** `constructor(...args) { super(...args); }` or an empty constructor. */
  private defaultConstructor(outer: CScope, name: string, derived: boolean, start: number, end: number): FunctionTemplate {
    const scope = this.newScope(outer, { async: false, generator: false });
    const slots: Slots = {
      this: this.declareName(scope, "%this", "internal", start).index,
      newTarget: this.declareName(scope, "%newtarget", "internal", start).index,
      home: this.declareName(scope, "%home", "internal", start).index,
      func: this.declareName(scope, "%func", "internal", start).index,
      arguments: -1,
    };
    const run = derived
      ? (env: Env, args: unknown[]) => {
          superConstruct(env, slots, args);
          return undefined;
        }
      : () => undefined;
    return { name, length: 0, kind: "constructor", async: false, generator: false, initial: scope.initial, slots, run, runG: null, start, end, source: this.src.slice(start, end) };
  }

  /** A function (or class) value for `node` named after an assignment target, or null when `node` isn't anonymous. */
  private namedValue(node: A.Expression, scope: CScope): ((env: Env, name: PropertyKey) => unknown) | null {
    if ((node.type === "FunctionExpression" && !node.id) || node.type === "ArrowFunctionExpression") {
      const template = this.functionTemplate(node, scope, node.type === "ArrowFunctionExpression" ? "arrow" : "normal", "");
      return (env, name) => makeFunction(template, env, undefined, name);
    }
    if (node.type === "ClassExpression" && !node.id) {
      const cls = this.classValue(node, scope);
      return (env, name) => cls(env, name);
    }
    return null;
  }

  private namedEv(node: A.Expression, scope: CScope, name: string): Ex {
    const named = this.namedValue(node, scope);
    if (named) return (env) => named(env, name);
    return this.expr(node, scope);
  }

  // ---- identifiers --------------------------------------------------------------------

  private readIdentifier(scope: CScope, name: string, offset: number): Ex {
    const r = this.resolve(scope, name);
    if (!r) {
      if (name === "undefined") return () => undefined;
      if (name === "NaN") return () => NaN;
      if (name === "Infinity") return () => Infinity;
      return () => {
        const g = activeRealm().global;
        const v = g[name];
        if (v !== undefined || name in g) return v;
        throw new ReferenceError(`${name} is not defined`);
      };
    }
    const { depth, index } = r;
    const lexical = LEXICAL.has(r.kind) || name === "%this";
    const tdz = (): never => {
      if (name === "%this") throw new ReferenceError("Must call super constructor in derived class before accessing 'this' or returning from derived constructor");
      throw new ReferenceError(`Cannot access '${name}' before initialization`);
    };
    if (!lexical) {
      if (depth === 0) return (env) => env.v[index];
      if (depth === 1) return (env) => env.p!.v[index];
      return (env) => envAt(env, depth).v[index];
    }
    if (depth === 0) {
      return (env) => {
        const v = env.v[index];
        return v === TDZ ? tdz() : v;
      };
    }
    return (env) => {
      const v = envAt(env, depth).v[index];
      return v === TDZ ? tdz() : v;
    };
  }

  /** Assignment to a name (`x = v`), honoring const, TDZ, and globals. */
  private writeIdentifier(scope: CScope, name: string): Binder {
    const r = this.resolve(scope, name);
    if (!r) {
      return (_env, value) => {
        const realm = activeRealm();
        const g = realm.global;
        if (name in g || realm.sloppyGlobals) {
          const d = Object.getOwnPropertyDescriptor(g, name);
          if (d && !d.writable && !d.set) throw new TypeError(`Cannot assign to read only property '${name}'`);
          g[name] = value;
          return;
        }
        throw new ReferenceError(`${name} is not defined`);
      };
    }
    const { depth, index, kind } = r;
    if (kind === "const" || kind === "callee") {
      return (env) => {
        if (envAt(env, depth).v[index] === TDZ) throw new ReferenceError(`Cannot access '${name}' before initialization`);
        throw new TypeError("Assignment to constant variable.");
      };
    }
    if (LEXICAL.has(kind)) {
      return (env, value) => {
        const e = envAt(env, depth);
        if (e.v[index] === TDZ) throw new ReferenceError(`Cannot access '${name}' before initialization`);
        e.v[index] = value;
      };
    }
    if (depth === 0) return (env, value) => void (env.v[index] = value);
    return (env, value) => void (envAt(env, depth).v[index] = value);
  }

  /** Initialize a declared name (declarations, parameters). */
  private initIdentifier(scope: CScope, name: string, offset: number): Binder {
    const { depth, index } = this.mustResolve(scope, name, offset);
    if (depth === 0) return (env, value) => void (env.v[index] = value);
    return (env, value) => void (envAt(env, depth).v[index] = value);
  }

  // ---- patterns ---------------------------------------------------------------------

  private binder(pattern: A.Pattern, scope: CScope, mode: "init" | "assign"): Binder {
    switch (pattern.type) {
      case "Identifier":
        return mode === "init" ? this.initIdentifier(scope, pattern.name, pattern.start) : this.writeIdentifier(scope, pattern.name);
      case "MemberExpression": {
        const ref = this.memberRef(pattern, scope);
        return (env, value) => ref.set(ref.base(env), value);
      }
      case "AssignmentPattern": {
        const inner = this.binder(pattern.left, scope, mode);
        const fallback = pattern.left.type === "Identifier" ? this.namedEv(pattern.right, scope, pattern.left.name) : this.expr(pattern.right, scope);
        return (env, value) => inner(env, value === undefined ? fallback(env) : value);
      }
      case "RestElement":
        return this.binder(pattern.argument, scope, mode);
      case "ArrayPattern": {
        const elements = pattern.elements.map((e) => (e === null ? null : { rest: e.type === "RestElement", bind: this.binder(e, scope, mode) }));
        return (env, value) => {
          if (Array.isArray(value) && value[Symbol.iterator] === ARRAY_VALUES) {
            for (let i = 0; i < elements.length; i++) {
              const e = elements[i];
              if (!e) continue;
              e.bind(env, e.rest ? value.slice(i) : value[i]);
            }
            return;
          }
          const { it, next } = getIterator(value);
          let done = false;
          try {
            for (const e of elements) {
              if (e?.rest) {
                const rest: unknown[] = [];
                while (!done) {
                  const r = iteratorStep(it, next);
                  if (r.done) done = true;
                  else rest.push(r.value);
                }
                e.bind(env, rest);
                continue;
              }
              let item: unknown;
              if (!done) {
                const r = iteratorStep(it, next);
                if (r.done) done = true;
                else item = r.value;
              }
              e?.bind(env, item);
            }
          } catch (err) {
            if (!done && !(err instanceof InternalAbort)) closeIterator(it, true);
            throw err;
          }
          if (!done) closeIterator(it, false);
        };
      }
      case "ObjectPattern": {
        const used: (PropertyKey | Ex)[] = [];
        const props = pattern.properties.map((p) => {
          if (p.type === "RestElement") {
            const bind = this.binder(p.argument, scope, mode);
            return { rest: true as const, bind, key: null, computed: null };
          }
          const computed = p.computed ? this.expr(p.key, scope) : null;
          const key = p.computed ? null : p.key.type === "Identifier" ? p.key.name : String((p.key as A.Literal).value);
          if (key !== null) used.push(key);
          return { rest: false as const, bind: this.binder(p.value, scope, mode), key, computed };
        });
        const hasRest = props.some((p) => p.rest);
        return (env, value) => {
          if (value === null || value === undefined) throw new TypeError(`Cannot destructure ${describeValue(value)}.`);
          const taken = hasRest ? new Set<PropertyKey>() : null;
          for (const p of props) {
            if (p.rest) {
              const rest = {};
              copyDataProperties(rest, value, taken!);
              p.bind(env, rest);
              continue;
            }
            const key = p.computed ? toPropertyKey(p.computed(env)) : p.key!;
            taken?.add(key);
            p.bind(env, getProp(value, key));
          }
        };
      }
    }
  }

  private binderG(pattern: A.Pattern, scope: CScope, mode: "init" | "assign"): BinderG {
    if (!hasSuspend(pattern)) {
      const bind = this.binder(pattern, scope, mode);
      return function* (env, value) {
        bind(env, value);
      };
    }
    switch (pattern.type) {
      case "AssignmentPattern": {
        const inner = this.binderG(pattern.left, scope, mode);
        const fallback = this.ev(pattern.right, scope);
        return function* (env, value) {
          const v = value === undefined ? (fallback.g ? yield* fallback.g(env) : fallback.s!(env)) : value;
          yield* inner(env, v);
        };
      }
      case "RestElement":
        return this.binderG(pattern.argument, scope, mode);
      case "MemberExpression": {
        const ref = this.memberRefG(pattern, scope);
        return function* (env, value) {
          const base = yield* ref.base(env);
          ref.set(base, value);
        };
      }
      case "ArrayPattern": {
        const elements = pattern.elements.map((e) => (e === null ? null : { rest: e.type === "RestElement", bind: this.binderG(e, scope, mode) }));
        return function* (env, value) {
          const { it, next } = getIterator(value);
          let done = false;
          try {
            for (const e of elements) {
              if (e?.rest) {
                const rest: unknown[] = [];
                while (!done) {
                  const r = iteratorStep(it, next);
                  if (r.done) done = true;
                  else rest.push(r.value);
                }
                yield* e.bind(env, rest);
                continue;
              }
              let item: unknown;
              if (!done) {
                const r = iteratorStep(it, next);
                if (r.done) done = true;
                else item = r.value;
              }
              if (e) yield* e.bind(env, item);
            }
          } catch (err) {
            if (!done && !(err instanceof InternalAbort)) closeIterator(it, true);
            throw err;
          }
          if (!done) closeIterator(it, false);
        };
      }
      case "ObjectPattern": {
        const props = pattern.properties.map((p) => {
          if (p.type === "RestElement") return { rest: true as const, bind: this.binderG(p.argument, scope, mode), key: null, computed: null };
          const computed = p.computed ? this.ev(p.key, scope) : null;
          const key = p.computed ? null : p.key.type === "Identifier" ? p.key.name : String((p.key as A.Literal).value);
          return { rest: false as const, bind: this.binderG(p.value, scope, mode), key, computed };
        });
        return function* (env, value) {
          if (value === null || value === undefined) throw new TypeError(`Cannot destructure ${describeValue(value)}.`);
          const taken = new Set<PropertyKey>();
          for (const p of props) {
            if (p.rest) {
              const rest = {};
              copyDataProperties(rest, value, taken);
              yield* p.bind(env, rest);
              continue;
            }
            const key = p.computed ? toPropertyKey(p.computed.g ? yield* p.computed.g(env) : p.computed.s!(env)) : p.key!;
            taken.add(key);
            yield* p.bind(env, getProp(value, key));
          }
        };
      }
      default:
        return this.error("Invalid assignment target.", (pattern as A.Node).start);
    }
  }

  // ---- member references ------------------------------------------------------------

  private privateName(scope: CScope, name: string, offset: number): Ex {
    let depth = 0;
    for (let s: CScope | null = scope; s; s = s.parent) {
      if (s.privateNames?.has(name)) {
        const index = s.names.get("%private")!.index;
        const d = depth;
        return (env) => (envAt(env, d).v[index] as Map<string, PrivateName>).get(name);
      }
      depth++;
    }
    return this.error(`#${name} isn't declared in an enclosing class.`, offset);
  }

  /** Reads and writes through a member expression, with the base evaluated once. */
  private memberRef(node: A.MemberExpression, scope: CScope): {
    base: (env: Env) => { object: unknown; key: unknown; receiver: unknown };
    get: (b: { object: unknown; key: unknown; receiver: unknown }) => unknown;
    set: (b: { object: unknown; key: unknown; receiver: unknown }, value: unknown) => void;
  } {
    if (node.object.type === "Super") {
      const home = this.readIdentifier(scope, "%home", node.start);
      const thisRead = this.readIdentifier(scope, "%this", node.start);
      const key = node.computed ? this.expr(node.property as A.Expression, scope) : null;
      const name = node.computed ? null : (node.property as A.Identifier).name;
      return {
        base: (env) => {
          const h = home(env) as object;
          const k = key ? toPropertyKey(key(env)) : name!;
          return { object: Object.getPrototypeOf(h), key: k, receiver: thisRead(env) };
        },
        get: (b) => (b.object === null ? undefined : substitute(Reflect.get(b.object as object, b.key as PropertyKey, b.receiver))),
        set: (b, value) => {
          guardWrite(b.receiver);
          if (!Reflect.set(b.object as object, b.key as PropertyKey, value, b.receiver)) throw new TypeError(`Cannot assign to read only property '${String(b.key)}'`);
        },
      };
    }
    const object = this.expr(node.object, scope);
    if (node.property.type === "PrivateIdentifier") {
      const pn = this.privateName(scope, node.property.name, node.property.start);
      return {
        base: (env) => ({ object: object(env), key: pn(env), receiver: undefined }),
        get: (b) => privateGet(b.object, b.key as PrivateName),
        set: (b, value) => privateSet(b.object, b.key as PrivateName, value),
      };
    }
    const key = node.computed ? this.expr(node.property, scope) : null;
    const name = node.computed ? null : (node.property as A.Identifier).name;
    return {
      base: (env) => ({ object: object(env), key: key ? toPropertyKey(key(env)) : name, receiver: undefined }),
      get: (b) => getProp(b.object, b.key as PropertyKey),
      set: (b, value) => setProp(b.object, b.key as PropertyKey, value),
    };
  }

  private memberRefG(node: A.MemberExpression, scope: CScope): {
    base: (env: Env) => Generator<unknown, { object: unknown; key: unknown; receiver: unknown }, unknown>;
    get: (b: { object: unknown; key: unknown; receiver: unknown }) => unknown;
    set: (b: { object: unknown; key: unknown; receiver: unknown }, value: unknown) => void;
  } {
    const sync = this.memberRef(node, scope);
    if (!hasSuspend(node)) {
      return {
        *base(env) {
          return sync.base(env);
        },
        get: sync.get,
        set: sync.set,
      };
    }
    if (node.object.type === "Super") {
      const home = this.readIdentifier(scope, "%home", node.start);
      const thisRead = this.readIdentifier(scope, "%this", node.start);
      const key = this.ev(node.property as A.Expression, scope);
      return {
        *base(env) {
          const k = toPropertyKey(key.g ? yield* key.g(env) : key.s!(env));
          return { object: Object.getPrototypeOf(home(env) as object), key: k, receiver: thisRead(env) };
        },
        get: sync.get,
        set: sync.set,
      };
    }
    const object = this.ev(node.object, scope);
    if (node.property.type === "PrivateIdentifier") {
      const pn = this.privateName(scope, node.property.name, node.property.start);
      return {
        *base(env) {
          const o = object.g ? yield* object.g(env) : object.s!(env);
          return { object: o, key: pn(env), receiver: undefined };
        },
        get: sync.get,
        set: sync.set,
      };
    }
    const key = node.computed ? this.ev(node.property, scope) : null;
    const name = node.computed ? null : (node.property as A.Identifier).name;
    return {
      *base(env) {
        const o = object.g ? yield* object.g(env) : object.s!(env);
        const k = key ? toPropertyKey(key.g ? yield* key.g(env) : key.s!(env)) : name;
        return { object: o, key: k, receiver: undefined };
      },
      get: sync.get,
      set: sync.set,
    };
  }

  private describe(node: A.Node): string {
    const text = this.src.slice(node.start, node.end).replace(/\s+/g, " ");
    return text.length > 50 ? `${text.slice(0, 50)}…` : text;
  }

  // ---- expressions ------------------------------------------------------------------

  private ev(node: A.Expression, scope: CScope): Ev {
    return hasSuspend(node) ? { s: null, g: this.exprG(node, scope) } : { s: this.expr(node, scope), g: null };
  }

  private args(list: readonly (A.Expression | A.SpreadElement)[], scope: CScope): (env: Env) => unknown[] {
    if (!list.some((a) => a.type === "SpreadElement")) {
      const fns = list.map((a) => this.expr(a as A.Expression, scope));
      switch (fns.length) {
        case 0:
          return () => [];
        case 1: {
          const [a] = fns;
          return (env) => [a!(env)];
        }
        case 2: {
          const [a, b] = fns;
          return (env) => [a!(env), b!(env)];
        }
        default:
          return (env) => fns.map((f) => f(env));
      }
    }
    const items = list.map((a) => (a.type === "SpreadElement" ? { spread: true, fn: this.expr(a.argument, scope) } : { spread: false, fn: this.expr(a, scope) }));
    return (env) => {
      const out: unknown[] = [];
      for (const item of items) {
        const v = item.fn(env);
        if (item.spread) spreadInto(out, v);
        else out.push(v);
      }
      return out;
    };
  }

  private argsG(list: readonly (A.Expression | A.SpreadElement)[], scope: CScope): (env: Env) => Generator<unknown, unknown[], unknown> {
    const items = list.map((a) => (a.type === "SpreadElement" ? { spread: true, ev: this.ev(a.argument, scope) } : { spread: false, ev: this.ev(a, scope) }));
    return function* (env) {
      const out: unknown[] = [];
      for (const item of items) {
        const v = item.ev.g ? yield* item.ev.g(env) : item.ev.s!(env);
        if (item.spread) spreadInto(out, v);
        else out.push(v);
      }
      return out;
    };
  }

  private expr(node: A.Expression, scope: CScope, chain = false): Ex {
    switch (node.type) {
      case "Literal": {
        const value = node.value;
        return () => value;
      }
      case "RegExpLiteral": {
        const { pattern, flags } = node;
        return () => new RegExp(pattern, flags);
      }
      case "TemplateLiteral": {
        const quasis = node.quasis.map((q) => q.cooked ?? "");
        const exprs = node.expressions.map((e) => this.expr(e, scope));
        if (!exprs.length) {
          const text = quasis[0]!;
          return () => text;
        }
        return (env) => {
          let out = quasis[0]!;
          for (let i = 0; i < exprs.length; i++) out += `${exprs[i]!(env)}${quasis[i + 1]}`;
          return checkString(out);
        };
      }
      case "TaggedTemplateExpression": {
        const strings = templateObject(node.quasi);
        const exprs = node.quasi.expressions.map((e) => this.expr(e, scope));
        const callee = this.calleeRef(node.tag, scope);
        const describe = this.describe(node.tag);
        return (env) => {
          const { fn, thisValue } = callee(env);
          return callValue(fn, thisValue, [strings, ...exprs.map((e) => e(env))], describe);
        };
      }
      case "Identifier":
        return this.readIdentifier(scope, node.name, node.start);
      case "ThisExpression":
        return this.readIdentifier(scope, "%this", node.start);
      case "MetaProperty":
        return this.readIdentifier(scope, "%newtarget", node.start);
      case "ArrayExpression": {
        const elements = node.elements.map((e) => (e === null ? null : e.type === "SpreadElement" ? { spread: true, fn: this.expr(e.argument, scope) } : { spread: false, fn: this.expr(e, scope) }));
        return (env) => {
          const out: unknown[] = [];
          for (const e of elements) {
            if (e === null) out.length++;
            else if (e.spread) spreadInto(out, e.fn(env));
            else out.push(e.fn(env));
          }
          return out;
        };
      }
      case "ObjectExpression": {
        const props = node.properties.map((p) => this.objectProperty(p, scope));
        return (env) => {
          const o = {};
          for (const p of props) p(env, o);
          return o;
        };
      }
      case "FunctionExpression": {
        const template = this.functionTemplate(node, node.id ? this.calleeScope(scope, node.id) : scope, "normal", node.id?.name ?? "");
        if (!node.id) return (env) => makeFunction(template, env);
        return (env) => {
          const inner: Env = { v: [TDZ], p: env };
          const fn = makeFunction(template, inner);
          inner.v[0] = fn;
          return fn;
        };
      }
      case "ArrowFunctionExpression": {
        const template = this.functionTemplate(node, scope, "arrow", "");
        return (env) => makeFunction(template, env);
      }
      case "ClassExpression": {
        const cls = this.classValue(node, scope);
        return (env) => cls(env, undefined);
      }
      case "UnaryExpression":
        return this.unary(node, scope);
      case "UpdateExpression": {
        const { operator, prefix } = node;
        const delta = operator === "++" ? 1 : -1;
        if (node.argument.type === "Identifier") {
          const read = this.readIdentifier(scope, node.argument.name, node.start);
          const write = this.writeIdentifier(scope, node.argument.name);
          return (env) => {
            const old = toNumeric(read(env));
            const next = increment(old, delta);
            write(env, next);
            return prefix ? next : old;
          };
        }
        const ref = this.memberRef(node.argument as A.MemberExpression, scope);
        return (env) => {
          const b = ref.base(env);
          const old = toNumeric(ref.get(b));
          const next = increment(old, delta);
          ref.set(b, next);
          return prefix ? next : old;
        };
      }
      case "BinaryExpression": {
        if (node.left.type === "PrivateIdentifier") {
          const pn = this.privateName(scope, node.left.name, node.left.start);
          const right = this.expr(node.right, scope);
          return (env) => {
            const o = right(env);
            if (!isObjectLike(o)) throw new TypeError(`Cannot use 'in' operator to search for '#${(node.left as A.PrivateIdentifier).name}' in ${describeValue(o)}`);
            return PRIVATE_DATA.get(o)?.has(pn(env) as PrivateName) ?? false;
          };
        }
        const l = this.expr(node.left, scope);
        const r = this.expr(node.right, scope);
        const op = BINARY_OPS[node.operator]!;
        switch (node.operator) {
          case "===":
            return (env) => l(env) === r(env);
          case "!==":
            return (env) => l(env) !== r(env);
          case "<":
            return (env) => (l(env) as number) < (r(env) as number);
          case "-":
            return (env) => (l(env) as number) - (r(env) as number);
          default:
            return (env) => op(l(env), r(env));
        }
      }
      case "LogicalExpression": {
        const l = this.expr(node.left, scope);
        const r = this.expr(node.right, scope);
        if (node.operator === "&&") return (env) => l(env) && r(env);
        if (node.operator === "||") return (env) => l(env) || r(env);
        return (env) => l(env) ?? r(env);
      }
      case "ConditionalExpression": {
        const test = this.expr(node.test, scope);
        const a = this.expr(node.consequent, scope);
        const b = this.expr(node.alternate, scope);
        return (env) => (test(env) ? a(env) : b(env));
      }
      case "AssignmentExpression":
        return this.assignment(node, scope);
      case "SequenceExpression": {
        const fns = node.expressions.map((e) => this.expr(e, scope));
        return (env) => {
          let v: unknown;
          for (const f of fns) v = f(env);
          return v;
        };
      }
      case "CallExpression":
        return this.call(node, scope, chain);
      case "NewExpression": {
        const callee = this.expr(node.callee, scope);
        const args = this.args(node.arguments, scope);
        const describe = this.describe(node.callee);
        return (env) => {
          const fn = callee(env);
          return constructValue(fn, args(env), fn, describe);
        };
      }
      case "MemberExpression":
        return this.member(node, scope, chain);
      case "ChainExpression": {
        const inner = this.expr(node.expression, scope, true);
        return (env) => {
          const v = inner(env);
          return v === CHAIN ? undefined : v;
        };
      }
      case "AwaitExpression":
      case "YieldExpression":
        return this.error("Internal error: await or yield in a non-suspending context.", node.start);
    }
  }

  private calleeScope(scope: CScope, id: A.Identifier): CScope {
    const inner = this.newScope(scope, scope.fn);
    this.declareName(inner, id.name, "callee", id.start);
    return inner;
  }

  private objectProperty(p: A.Property | A.SpreadElement, scope: CScope): (env: Env, o: object) => void {
    if (p.type === "SpreadElement") {
      const source = this.expr(p.argument, scope);
      return (env, o) => copyDataProperties(o, source(env));
    }
    const staticKey = p.computed ? null : p.key.type === "Identifier" ? p.key.name : String((p.key as A.Literal).value);
    const computed = p.computed ? this.expr(p.key as A.Expression, scope) : null;
    const keyOf = (env: Env): PropertyKey => (computed ? toPropertyKey(computed(env)) : staticKey!);
    if (p.kind === "get" || p.kind === "set") {
      const template = this.functionTemplate(p.value as A.FunctionExpression, scope, "method", "");
      const kind = p.kind;
      return (env, o) => {
        const key = keyOf(env);
        const fn = makeFunction(template, env, o, typeof key === "symbol" ? key : `${kind} ${String(key)}`);
        const existing = Object.getOwnPropertyDescriptor(o, key);
        const d: PropertyDescriptor = { enumerable: true, configurable: true };
        if (kind === "get") {
          d.get = fn as () => unknown;
          if (existing?.set) d.set = existing.set;
        } else {
          d.set = fn as (v: unknown) => void;
          if (existing?.get) d.get = existing.get;
        }
        Object.defineProperty(o, key, d);
      };
    }
    if (p.method) {
      const template = this.functionTemplate(p.value as A.FunctionExpression, scope, "method", "");
      return (env, o) => {
        const key = keyOf(env);
        defineData(o, key, makeFunction(template, env, o, key));
      };
    }
    if (!p.computed && !p.shorthand && staticKey === "__proto__") {
      const value = this.expr(p.value, scope);
      return (env, o) => {
        const v = value(env);
        if (isObjectLike(v) || v === null) Object.setPrototypeOf(o, v);
      };
    }
    const named = this.namedValue(p.value, scope);
    if (named) return (env, o) => {
      const key = keyOf(env);
      defineData(o, key, named(env, key));
    };
    const value = this.expr(p.value, scope);
    if (staticKey !== null) return (env, o) => defineData(o, staticKey, value(env));
    return (env, o) => {
      const key = keyOf(env);
      defineData(o, key, value(env));
    };
  }

  private unary(node: A.UnaryExpression, scope: CScope): Ex {
    const { operator } = node;
    if (operator === "typeof" && node.argument.type === "Identifier" && !this.resolve(scope, node.argument.name)) {
      const name = node.argument.name;
      if (name === "undefined") return () => "undefined";
      return () => {
        const g = activeRealm().global;
        return name in g ? typeof g[name] : "undefined";
      };
    }
    if (operator === "delete") {
      const arg = node.argument;
      if (arg.type === "MemberExpression") {
        if (arg.object.type === "Super") return () => {
          throw new ReferenceError("Unsupported reference to 'super'");
        };
        const ref = this.memberRef(arg, scope);
        return (env) => {
          const b = ref.base(env);
          return deleteProp(b.object, b.key as PropertyKey);
        };
      }
      if (arg.type === "ChainExpression" && arg.expression.type === "MemberExpression") {
        const member = arg.expression;
        const object = this.expr(member.object as A.Expression, scope, true);
        const key = member.computed ? this.expr(member.property as A.Expression, scope) : null;
        const name = member.computed ? null : (member.property as A.Identifier).name;
        return (env) => {
          const o = object(env);
          if (o === CHAIN || ((o === null || o === undefined) && member.optional)) return true;
          return deleteProp(o, key ? toPropertyKey(key(env)) : name!);
        };
      }
      const value = this.expr(arg, scope);
      return (env) => {
        value(env);
        return true;
      };
    }
    const a = this.expr(node.argument, scope);
    return this.unaryOp(operator, a);
  }

  private unaryOp(operator: A.UnaryExpression["operator"], a: Ex): Ex {
    switch (operator) {
      case "!":
        return (env) => !a(env);
      case "-":
        return (env) => -(a(env) as number);
      case "+":
        return (env) => +(a(env) as number);
      case "~":
        return (env) => ~(a(env) as number);
      case "typeof":
        return (env) => typeof a(env);
      case "void":
        return (env) => {
          a(env);
          return undefined;
        };
      default:
        return () => true;
    }
  }

  private assignment(node: A.AssignmentExpression, scope: CScope): Ex {
    const { operator, left } = node;
    if (operator === "=") {
      if (left.type === "Identifier") {
        const write = this.writeIdentifier(scope, left.name);
        const value = this.namedEv(node.right, scope, left.name);
        return (env) => {
          const v = value(env);
          write(env, v);
          return v;
        };
      }
      if (left.type === "MemberExpression") {
        const ref = this.memberRef(left, scope);
        const value = this.expr(node.right, scope);
        return (env) => {
          const b = ref.base(env);
          const v = value(env);
          ref.set(b, v);
          return v;
        };
      }
      const bind = this.binder(left, scope, "assign");
      const value = this.expr(node.right, scope);
      return (env) => {
        const v = value(env);
        bind(env, v);
        return v;
      };
    }
    const right = this.expr(node.right, scope);
    const logical = operator === "&&=" || operator === "||=" || operator === "??=";
    const op = logical ? null : BINARY_OPS[operator.slice(0, -1)]!;
    const combine = (old: unknown, env: Env, write: (v: unknown) => void): unknown => {
      if (operator === "&&=") {
        if (!old) return old;
      } else if (operator === "||=") {
        if (old) return old;
      } else if (operator === "??=") {
        if (old !== null && old !== undefined) return old;
      } else {
        const v = op!(old, right(env));
        write(v);
        return v;
      }
      const v = right(env);
      write(v);
      return v;
    };
    if (left.type === "Identifier") {
      const read = this.readIdentifier(scope, left.name, left.start);
      const write = this.writeIdentifier(scope, left.name);
      return (env) => combine(read(env), env, (v) => write(env, v));
    }
    const ref = this.memberRef(left as A.MemberExpression, scope);
    return (env) => {
      const b = ref.base(env);
      return combine(ref.get(b), env, (v) => ref.set(b, v));
    };
  }

  private member(node: A.MemberExpression, scope: CScope, chain: boolean): Ex {
    if (node.object.type === "Super") {
      const ref = this.memberRef(node, scope);
      return (env) => ref.get(ref.base(env));
    }
    const object = this.expr(node.object, scope, chain);
    const optional = node.optional;
    if (node.property.type === "PrivateIdentifier") {
      const pn = this.privateName(scope, node.property.name, node.property.start);
      return (env) => {
        const o = object(env);
        if (o === CHAIN) return CHAIN;
        if (optional && (o === null || o === undefined)) return CHAIN;
        return privateGet(o, pn(env) as PrivateName);
      };
    }
    if (!node.computed) {
      const name = (node.property as A.Identifier).name;
      if (!chain) return (env) => getProp(object(env), name);
      return (env) => {
        const o = object(env);
        if (o === CHAIN || (optional && (o === null || o === undefined))) return CHAIN;
        return getProp(o, name);
      };
    }
    const key = this.expr(node.property, scope);
    if (!chain) {
      return (env) => {
        const o = object(env);
        return getProp(o, toPropertyKey(key(env)));
      };
    }
    return (env) => {
      const o = object(env);
      if (o === CHAIN || (optional && (o === null || o === undefined))) return CHAIN;
      return getProp(o, toPropertyKey(key(env)));
    };
  }

  /** The function and `this` for a call. */
  private calleeRef(callee: A.Expression | A.Super, scope: CScope, chain = false): (env: Env) => { fn: unknown; thisValue: unknown } {
    if (callee.type === "MemberExpression") {
      if (callee.object.type === "Super") {
        const ref = this.memberRef(callee, scope);
        return (env) => {
          const b = ref.base(env);
          return { fn: ref.get(b), thisValue: b.receiver };
        };
      }
      const object = this.expr(callee.object, scope, chain);
      const optional = callee.optional;
      if (callee.property.type === "PrivateIdentifier") {
        const pn = this.privateName(scope, callee.property.name, callee.property.start);
        return (env) => {
          const o = object(env);
          if (o === CHAIN || (optional && (o === null || o === undefined))) return { fn: CHAIN, thisValue: undefined };
          return { fn: privateGet(o, pn(env) as PrivateName), thisValue: o };
        };
      }
      const key = callee.computed ? this.expr(callee.property, scope) : null;
      const name = callee.computed ? null : (callee.property as A.Identifier).name;
      return (env) => {
        const o = object(env);
        if (o === CHAIN || (optional && (o === null || o === undefined))) return { fn: CHAIN, thisValue: undefined };
        return { fn: getProp(o, key ? toPropertyKey(key(env)) : name!), thisValue: o };
      };
    }
    const fn = this.expr(callee as A.Expression, scope, chain);
    return (env) => ({ fn: fn(env), thisValue: undefined });
  }

  private call(node: A.CallExpression, scope: CScope, chain: boolean): Ex {
    const args = this.args(node.arguments, scope);
    if (node.callee.type === "Super") {
      const slots = this.superSlots(scope, node.start);
      return (env) => {
        superConstructAt(env, slots, args(env));
        return undefined;
      };
    }
    const describe = this.describe(node.callee);
    const optional = node.optional;
    if (node.callee.type === "MemberExpression") {
      const callee = this.calleeRef(node.callee, scope, chain);
      return (env) => {
        const { fn, thisValue } = callee(env);
        if (fn === CHAIN) return CHAIN;
        if (optional && (fn === null || fn === undefined)) return CHAIN;
        return callValue(fn, thisValue, args(env), describe);
      };
    }
    const callee = this.expr(node.callee, scope, chain);
    return (env) => {
      const fn = callee(env);
      if (fn === CHAIN) return CHAIN;
      if (optional && (fn === null || fn === undefined)) return CHAIN;
      return callValue(fn, undefined, args(env), describe);
    };
  }

  private superSlots(scope: CScope, offset: number): SuperSlots {
    return {
      func: this.mustResolve(scope, "%func", offset),
      newTarget: this.mustResolve(scope, "%newtarget", offset),
      this: this.mustResolve(scope, "%this", offset),
    };
  }

  // ---- suspending expressions ------------------------------------------------------

  private exprG(node: A.Expression, scope: CScope, chain = false): ExG {
    if (!hasSuspend(node)) {
      const f = this.expr(node, scope, chain);
      return function* (env) {
        return f(env);
      };
    }
    switch (node.type) {
      case "AwaitExpression": {
        const arg = this.ev(node.argument, scope);
        return function* (env) {
          const v = arg.g ? yield* arg.g(env) : arg.s!(env);
          return yield new AwaitSignal(v);
        };
      }
      case "YieldExpression": {
        const arg = node.argument ? this.ev(node.argument, scope) : null;
        const isAsync = scope.fn.async;
        if (node.delegate) {
          return function* (env) {
            const v = arg!.g ? yield* arg!.g(env) : arg!.s!(env);
            if (!isAsync) return yield* v as Iterable<unknown>;
            return yield* delegateAsync(v);
          };
        }
        return function* (env) {
          let v = arg ? (arg.g ? yield* arg.g(env) : arg.s!(env)) : undefined;
          if (isAsync) v = yield new AwaitSignal(v);
          return yield v;
        };
      }
      case "TemplateLiteral": {
        const quasis = node.quasis.map((q) => q.cooked ?? "");
        const exprs = node.expressions.map((e) => this.ev(e, scope));
        return function* (env) {
          let out = quasis[0]!;
          for (let i = 0; i < exprs.length; i++) {
            const e = exprs[i]!;
            out += `${e.g ? yield* e.g(env) : e.s!(env)}${quasis[i + 1]}`;
          }
          return checkString(out);
        };
      }
      case "TaggedTemplateExpression": {
        const strings = templateObject(node.quasi);
        const exprs = node.quasi.expressions.map((e) => this.ev(e, scope));
        const callee = this.calleeRefG(node.tag, scope);
        const describe = this.describe(node.tag);
        return function* (env) {
          const { fn, thisValue } = yield* callee(env);
          const values: unknown[] = [strings];
          for (const e of exprs) values.push(e.g ? yield* e.g(env) : e.s!(env));
          return callValue(fn, thisValue, values, describe);
        };
      }
      case "ArrayExpression": {
        const elements = node.elements.map((e) => (e === null ? null : e.type === "SpreadElement" ? { spread: true, ev: this.ev(e.argument, scope) } : { spread: false, ev: this.ev(e, scope) }));
        return function* (env) {
          const out: unknown[] = [];
          for (const e of elements) {
            if (e === null) {
              out.length++;
              continue;
            }
            const v = e.ev.g ? yield* e.ev.g(env) : e.ev.s!(env);
            if (e.spread) spreadInto(out, v);
            else out.push(v);
          }
          return out;
        };
      }
      case "ObjectExpression": {
        const props = node.properties.map((p) => {
          if (!hasSuspend(p)) {
            const sync = this.objectProperty(p, scope);
            return function* (env: Env, o: object): Generator<unknown, void, unknown> {
              sync(env, o);
            };
          }
          return this.objectPropertyG(p, scope);
        });
        return function* (env) {
          const o = {};
          for (const p of props) yield* p(env, o);
          return o;
        };
      }
      case "UnaryExpression": {
        if (node.operator === "delete" && node.argument.type === "MemberExpression") {
          const ref = this.memberRefG(node.argument, scope);
          return function* (env) {
            const b = yield* ref.base(env);
            return deleteProp(b.object, b.key as PropertyKey);
          };
        }
        const arg = this.exprG(node.argument, scope);
        const op = node.operator;
        return function* (env) {
          const v = yield* arg(env);
          switch (op) {
            case "!":
              return !v;
            case "-":
              return -(v as number);
            case "+":
              return +(v as number);
            case "~":
              return ~(v as number);
            case "typeof":
              return typeof v;
            default:
              return op === "void" ? undefined : true;
          }
        };
      }
      case "UpdateExpression": {
        const ref = this.memberRefG(node.argument as A.MemberExpression, scope);
        const delta = node.operator === "++" ? 1 : -1;
        const prefix = node.prefix;
        return function* (env) {
          const b = yield* ref.base(env);
          const old = toNumeric(ref.get(b));
          const next = increment(old, delta);
          ref.set(b, next);
          return prefix ? next : old;
        };
      }
      case "BinaryExpression": {
        if (node.left.type === "PrivateIdentifier") {
          const pn = this.privateName(scope, node.left.name, node.left.start);
          const right = this.exprG(node.right, scope);
          return function* (env) {
            const o = yield* right(env);
            if (!isObjectLike(o)) throw new TypeError("Cannot use 'in' operator on a non-object");
            return PRIVATE_DATA.get(o)?.has(pn(env) as PrivateName) ?? false;
          };
        }
        const l = this.ev(node.left, scope);
        const r = this.ev(node.right, scope);
        const op = BINARY_OPS[node.operator]!;
        return function* (env) {
          const a = l.g ? yield* l.g(env) : l.s!(env);
          const b = r.g ? yield* r.g(env) : r.s!(env);
          return op(a, b);
        };
      }
      case "LogicalExpression": {
        const l = this.ev(node.left, scope);
        const r = this.ev(node.right, scope);
        const operator = node.operator;
        return function* (env) {
          const a = l.g ? yield* l.g(env) : l.s!(env);
          if (operator === "&&" ? !a : operator === "||" ? a : a !== null && a !== undefined) return a;
          return r.g ? yield* r.g(env) : r.s!(env);
        };
      }
      case "ConditionalExpression": {
        const test = this.ev(node.test, scope);
        const a = this.ev(node.consequent, scope);
        const b = this.ev(node.alternate, scope);
        return function* (env) {
          const t = test.g ? yield* test.g(env) : test.s!(env);
          const branch = t ? a : b;
          return branch.g ? yield* branch.g(env) : branch.s!(env);
        };
      }
      case "AssignmentExpression":
        return this.assignmentG(node, scope);
      case "SequenceExpression": {
        const items = node.expressions.map((e) => this.ev(e, scope));
        return function* (env) {
          let v: unknown;
          for (const e of items) v = e.g ? yield* e.g(env) : e.s!(env);
          return v;
        };
      }
      case "CallExpression": {
        const args = this.argsG(node.arguments, scope);
        if (node.callee.type === "Super") {
          const slots = this.superSlots(scope, node.start);
          return function* (env) {
            superConstructAt(env, slots, yield* args(env));
            return undefined;
          };
        }
        const callee = this.calleeRefG(node.callee, scope, chain);
        const describe = this.describe(node.callee);
        const optional = node.optional;
        return function* (env) {
          const { fn, thisValue } = yield* callee(env);
          if (fn === CHAIN || (optional && (fn === null || fn === undefined))) return CHAIN;
          return callValue(fn, thisValue, yield* args(env), describe);
        };
      }
      case "NewExpression": {
        const callee = this.ev(node.callee, scope);
        const args = this.argsG(node.arguments, scope);
        const describe = this.describe(node.callee);
        return function* (env) {
          const fn = callee.g ? yield* callee.g(env) : callee.s!(env);
          return constructValue(fn, yield* args(env), fn, describe);
        };
      }
      case "MemberExpression": {
        const callee = this.calleeRefG(node, scope, chain);
        return function* (env) {
          return (yield* callee(env)).fn;
        };
      }
      case "ChainExpression": {
        const inner = this.exprG(node.expression, scope, true);
        return function* (env) {
          const v = yield* inner(env);
          return v === CHAIN ? undefined : v;
        };
      }
      case "ClassExpression":
        return this.error("await and yield in class names and extends clauses aren't supported yet.", node.start);
      default:
        return this.error(`Internal error: can't suspend inside ${node.type}.`, node.start);
    }
  }

  private objectPropertyG(p: A.Property | A.SpreadElement, scope: CScope): (env: Env, o: object) => Generator<unknown, void, unknown> {
    if (p.type === "SpreadElement") {
      const source = this.exprG(p.argument, scope);
      return function* (env, o) {
        copyDataProperties(o, yield* source(env));
      };
    }
    if (p.kind !== "init" || p.method) return this.error("await in a computed method name isn't supported yet.", p.start);
    const computed = p.computed ? this.ev(p.key as A.Expression, scope) : null;
    const staticKey = p.computed ? null : p.key.type === "Identifier" ? p.key.name : String((p.key as A.Literal).value);
    const value = this.ev(p.value, scope);
    return function* (env, o) {
      const key = computed ? toPropertyKey(computed.g ? yield* computed.g(env) : computed.s!(env)) : staticKey!;
      defineData(o, key, value.g ? yield* value.g(env) : value.s!(env));
    };
  }

  private calleeRefG(callee: A.Expression | A.Super, scope: CScope, chain = false): (env: Env) => Generator<unknown, { fn: unknown; thisValue: unknown }, unknown> {
    if (callee.type === "MemberExpression") {
      if (!hasSuspend(callee)) {
        const sync = this.calleeRef(callee, scope, chain);
        return function* (env) {
          return sync(env);
        };
      }
      const ref = this.memberRefG(callee, scope);
      const object = callee.object.type === "Super" ? null : this.exprG(callee.object, scope, chain);
      const optional = callee.optional;
      if (!object) {
        return function* (env) {
          const b = yield* ref.base(env);
          return { fn: ref.get(b), thisValue: b.receiver };
        };
      }
      const key = callee.property.type === "PrivateIdentifier" ? null : callee.computed ? this.ev(callee.property, scope) : null;
      const name = callee.computed || callee.property.type === "PrivateIdentifier" ? null : (callee.property as A.Identifier).name;
      const pn = callee.property.type === "PrivateIdentifier" ? this.privateName(scope, callee.property.name, callee.property.start) : null;
      return function* (env) {
        const o = yield* object(env);
        if (o === CHAIN || (optional && (o === null || o === undefined))) return { fn: CHAIN, thisValue: undefined };
        if (pn) return { fn: privateGet(o, pn(env) as PrivateName), thisValue: o };
        const k = key ? toPropertyKey(key.g ? yield* key.g(env) : key.s!(env)) : name!;
        return { fn: getProp(o, k), thisValue: o };
      };
    }
    const fn = this.exprG(callee as A.Expression, scope, chain);
    return function* (env) {
      return { fn: yield* fn(env), thisValue: undefined };
    };
  }

  private assignmentG(node: A.AssignmentExpression, scope: CScope): ExG {
    const { operator, left } = node;
    const right = this.ev(node.right, scope);
    if (operator === "=") {
      if (left.type === "MemberExpression") {
        const ref = this.memberRefG(left, scope);
        return function* (env) {
          const b = yield* ref.base(env);
          const v = right.g ? yield* right.g(env) : right.s!(env);
          ref.set(b, v);
          return v;
        };
      }
      const bind = this.binderG(left, scope, "assign");
      return function* (env) {
        const v = right.g ? yield* right.g(env) : right.s!(env);
        yield* bind(env, v);
        return v;
      };
    }
    const logical = operator === "&&=" || operator === "||=" || operator === "??=";
    const op = logical ? null : BINARY_OPS[operator.slice(0, -1)]!;
    let read: (env: Env) => Generator<unknown, { old: unknown; write: (v: unknown) => void }, unknown>;
    if (left.type === "Identifier") {
      const r = this.readIdentifier(scope, left.name, left.start);
      const w = this.writeIdentifier(scope, left.name);
      read = function* (env) {
        return { old: r(env), write: (v: unknown) => w(env, v) };
      };
    } else {
      const ref = this.memberRefG(left as A.MemberExpression, scope);
      read = function* (env) {
        const b = yield* ref.base(env);
        return { old: ref.get(b), write: (v: unknown) => ref.set(b, v) };
      };
    }
    return function* (env) {
      const { old, write } = yield* read(env);
      if (operator === "&&=" ? !old : operator === "||=" ? old : operator === "??=" ? old !== null && old !== undefined : false) return old;
      const rv = right.g ? yield* right.g(env) : right.s!(env);
      const v = op ? op(old, rv) : rv;
      write(v);
      return v;
    };
  }

  // ---- classes ----------------------------------------------------------------------

  private classValue(node: A.ClassNode, outer: CScope): (env: Env, inferredName: PropertyKey | undefined) => Function {
    const privateNames = new Set<string>();
    for (const m of node.body) if (m.type !== "StaticBlock" && m.key.type === "PrivateIdentifier") privateNames.add(m.key.name);
    const scope = this.newScope(outer, outer.fn, privateNames.size ? privateNames : null);
    const nameSlot = node.id ? this.declareName(scope, node.id.name, "const", node.id.start).index : -1;
    const privateSlot = privateNames.size ? this.declareName(scope, "%private", "internal", node.start).index : -1;
    const superClass = node.superClass ? this.expr(node.superClass, scope) : null;
    const derived = node.superClass !== null;
    const className = node.id?.name ?? "";
    const ctorNode = node.body.find((m): m is A.MethodDefinition => m.type === "MethodDefinition" && m.kind === "constructor");
    const ctorTemplate = ctorNode ? this.functionTemplate(ctorNode.value, scope, "constructor", className) : this.defaultConstructor(scope, className, derived, node.start, node.end);
    ctorTemplate.source = this.src.slice(node.start, node.end);

    interface MemberPlan {
      isStatic: boolean;
      key: ((env: Env) => PropertyKey) | null;
      privateName: string | null;
      kind: "method" | "get" | "set" | "field" | "static-block";
      template: FunctionTemplate | null;
    }
    const plans: MemberPlan[] = [];
    for (const m of node.body) {
      if (m.type === "MethodDefinition" && m.kind === "constructor") continue;
      if (m.type === "StaticBlock") {
        const blockFn: A.FunctionExpression = { type: "FunctionExpression", id: null, params: [], body: { type: "BlockStatement", body: m.body, start: m.start, end: m.end }, async: false, generator: false, expression: false, start: m.start, end: m.end };
        plans.push({ isStatic: true, key: null, privateName: null, kind: "static-block", template: this.functionTemplate(blockFn, scope, "method", "") });
        continue;
      }
      const privateName = m.key.type === "PrivateIdentifier" ? m.key.name : null;
      let key: MemberPlan["key"] = null;
      if (!privateName) {
        if (m.computed) {
          if (hasSuspend(m.key as A.Expression)) this.error("await and yield in computed class member names aren't supported yet.", m.key.start);
          const k = this.expr(m.key as A.Expression, scope);
          key = (env) => toPropertyKey(k(env));
        } else {
          const text = m.key.type === "Identifier" ? m.key.name : String((m.key as A.Literal).value);
          key = () => text;
        }
      }
      if (m.type === "MethodDefinition") {
        plans.push({ isStatic: m.static, key, privateName, kind: m.kind as "method" | "get" | "set", template: this.functionTemplate(m.value, scope, "method", "") });
      } else {
        let template: FunctionTemplate | null = null;
        if (m.value) {
          const initFn: A.ArrowFunctionExpression = { type: "ArrowFunctionExpression", id: null, params: [], body: m.value, async: false, generator: false, expression: true, start: m.value.start, end: m.value.end };
          template = this.functionTemplate(initFn, scope, "method", "");
        }
        plans.push({ isStatic: m.static, key, privateName, kind: "field", template });
      }
    }

    return (env, inferredName) => {
      const cenv: Env = { v: scope.initial.slice(), p: env };
      const names = new Map<string, PrivateName>();
      if (privateSlot >= 0) {
        for (const name of privateNames) names.set(name, new PrivateName(name));
        cenv.v[privateSlot] = names;
      }
      let protoParent: object | null = Object.prototype;
      let constructorParent: object = Function.prototype;
      if (superClass) {
        const parent = superClass(cenv);
        if (parent === null) {
          protoParent = null;
        } else {
          if (!isConstructor(parent)) throw new TypeError(`Class extends value ${describeValue(parent)} is not a constructor or null`);
          const p = getProp(parent, "prototype");
          if (p !== null && !isObjectLike(p)) throw new TypeError(`Class extends value does not have valid prototype property ${describeValue(p)}`);
          protoParent = p as object | null;
          constructorParent = parent as object;
        }
      }
      const proto = Object.create(protoParent) as object;
      const name = className || (inferredName === undefined ? "" : typeof inferredName === "symbol" ? `[${inferredName.description ?? ""}]` : String(inferredName));
      const F = makeFunction({ ...ctorTemplate, name }, cenv, proto);
      const record = SCRIPT_FUNCTIONS.get(F) as FunctionRecord;
      const info: ClassInfo = { derived, fields: [], brands: [] };
      record.classInfo = info;
      CLASS_RECORDS.set(F, record);
      Object.setPrototypeOf(F, constructorParent);
      Object.defineProperty(F, "prototype", { value: proto, writable: false, enumerable: false, configurable: false });
      Object.defineProperty(proto, "constructor", { value: F, writable: true, enumerable: false, configurable: true });
      const statics: (() => void)[] = [];
      for (const plan of plans) {
        const target = plan.isStatic ? F : proto;
        if (plan.kind === "static-block") {
          const fn = makeFunction(plan.template!, cenv, F);
          statics.push(() => callValue(fn, F, []));
          continue;
        }
        if (plan.kind === "field") {
          const key: PropertyKey | PrivateName = plan.privateName !== null ? names.get(plan.privateName)! : plan.key!(cenv);
          const initRecord = plan.template ? (SCRIPT_FUNCTIONS.get(makeFunction(plan.template, cenv, target, typeof key === "symbol" || typeof key === "string" ? key : `#${(key as PrivateName).description}`)) as FunctionRecord) : null;
          if (plan.isStatic) {
            statics.push(() => {
              const value = initRecord ? invoke(initRecord, F, [], undefined) : undefined;
              if (key instanceof PrivateName) privateAdd(F, key, value);
              else Object.defineProperty(F, key, { value, writable: true, enumerable: true, configurable: true });
            });
          } else info.fields.push({ key, init: initRecord });
          continue;
        }
        if (plan.privateName !== null) {
          const pn = names.get(plan.privateName)!;
          const fn = makeFunction(plan.template!, cenv, target, `#${plan.privateName}`);
          if (plan.kind === "method") {
            pn.kind = "method";
            pn.method = fn;
          } else {
            pn.kind = "accessor";
            if (plan.kind === "get") pn.getter = fn;
            else pn.setter = fn;
          }
          pn.isStatic = plan.isStatic;
          if (plan.isStatic) {
            if (!PRIVATE_DATA.get(F)?.has(pn)) privateAdd(F, pn, true);
          } else if (!info.brands.includes(pn)) info.brands.push(pn);
          continue;
        }
        const key = plan.key!(cenv);
        if (plan.kind === "method") {
          const fn = makeFunction(plan.template!, cenv, target, key);
          Object.defineProperty(target, key, { value: fn, writable: true, enumerable: false, configurable: true });
        } else {
          const fn = makeFunction(plan.template!, cenv, target, typeof key === "symbol" ? key : `${plan.kind} ${String(key)}`);
          const existing = Object.getOwnPropertyDescriptor(target, key);
          const d: PropertyDescriptor = { enumerable: false, configurable: true };
          if (plan.kind === "get") {
            d.get = fn as () => unknown;
            if (existing?.set) d.set = existing.set;
          } else {
            d.set = fn as (v: unknown) => void;
            if (existing?.get) d.get = existing.get;
          }
          Object.defineProperty(target, key, d);
        }
      }
      if (nameSlot >= 0) cenv.v[nameSlot] = F;
      for (const run of statics) run();
      return F;
    };
  }

  // ---- statements -----------------------------------------------------------------

  private statements(list: readonly A.Statement[], scope: CScope): St {
    const items = list.filter((s) => s.type !== "FunctionDeclaration" && s.type !== "EmptyStatement" && !(s.type === "ExportNamedDeclaration" && s.declaration?.type === "FunctionDeclaration") && !(s.type === "ExportDefaultDeclaration" && s.declaration.type === "FunctionDeclaration"));
    const fns = items.map((s) => this.stmt(s, scope, null));
    const starts = items.map((s) => s.start);
    const n = fns.length;
    if (n === 1) {
      const f = fns[0]!;
      const start = starts[0]!;
      return (env) => {
        ACTIVE.pos = start;
        return f(env);
      };
    }
    return (env) => {
      for (let i = 0; i < n; i++) {
        ACTIVE.pos = starts[i]!;
        const c = fns[i]!(env);
        if (c !== undefined) return c;
      }
      return undefined;
    };
  }

  private block(list: readonly A.Statement[], scope: CScope): St {
    const lexical = collectLexical(list, false);
    if (!lexical.names.length) return this.statements(list, scope);
    const inner = this.newScope(scope, scope.fn);
    for (const { id, kind } of lexical.names) this.declareName(inner, id.name, kind, id.start);
    const hoist = this.hoistFunctions(lexical.functions, inner);
    const body = this.statements(list, inner);
    const initial = inner.initial;
    return (env) => {
      const e: Env = { v: initial.slice(), p: env };
      hoist(e);
      return body(e);
    };
  }

  private stmt(node: A.Statement, scope: CScope, labels: ReadonlySet<string> | null): St {
    switch (node.type) {
      case "ExpressionStatement": {
        const f = this.expr(node.expression, scope);
        return (env) => {
          f(env);
          return undefined;
        };
      }
      case "VariableDeclaration":
        return this.variableDeclaration(node, scope);
      case "FunctionDeclaration":
      case "EmptyStatement":
      case "DebuggerStatement":
        return () => undefined;
      case "ClassDeclaration": {
        const cls = this.classValue(node, scope);
        const init = this.initIdentifier(scope, node.id.name, node.start);
        return (env) => {
          init(env, cls(env, undefined));
          return undefined;
        };
      }
      case "BlockStatement":
        return this.block(node.body, scope);
      case "IfStatement": {
        const test = this.expr(node.test, scope);
        const a = this.stmt(node.consequent, scope, null);
        const b = node.alternate ? this.stmt(node.alternate, scope, null) : null;
        return (env) => (test(env) ? a(env) : b ? b(env) : undefined);
      }
      case "ForStatement":
        return this.forStatement(node, scope, labels);
      case "ForInStatement":
      case "ForOfStatement":
        return this.forInOf(node, scope, labels);
      case "WhileStatement": {
        const test = this.expr(node.test, scope);
        const body = this.stmt(node.body, scope, null);
        return (env) => {
          const realm = ACTIVE.realm!;
          while (test(env)) {
            const c = body(env);
            if (c !== undefined) {
              if (isBreakFor(c, labels)) break;
              if (!isContinueFor(c, labels)) return c;
            }
            realm.tick();
          }
          return undefined;
        };
      }
      case "DoWhileStatement": {
        const test = this.expr(node.test, scope);
        const body = this.stmt(node.body, scope, null);
        return (env) => {
          const realm = ACTIVE.realm!;
          do {
            const c = body(env);
            if (c !== undefined) {
              if (isBreakFor(c, labels)) break;
              if (!isContinueFor(c, labels)) return c;
            }
            realm.tick();
          } while (test(env));
          return undefined;
        };
      }
      case "ReturnStatement": {
        const arg = node.argument ? this.expr(node.argument, scope) : null;
        return (env) => ({ t: RETURN, label: null, value: arg ? arg(env) : undefined });
      }
      case "BreakStatement": {
        const c: Completion = { t: BREAK, label: node.label, value: undefined };
        return () => c;
      }
      case "ContinueStatement": {
        const c: Completion = { t: CONTINUE, label: node.label, value: undefined };
        return () => c;
      }
      case "ThrowStatement": {
        const arg = this.expr(node.argument, scope);
        return (env) => {
          const v = arg(env);
          markThrown(v);
          throw v;
        };
      }
      case "TryStatement":
        return this.tryStatement(node, scope);
      case "SwitchStatement":
        return this.switchStatement(node, scope);
      case "LabeledStatement":
        return this.labeled(node, scope, labels);
      case "ExportNamedDeclaration":
        return node.declaration ? this.stmt(node.declaration, scope, null) : () => undefined;
      case "ExportDefaultDeclaration": {
        const d = node.declaration;
        if (d.type === "FunctionDeclaration") return () => undefined;
        if (d.type === "ClassDeclaration") {
          const cls = this.classValue(d, scope);
          const init = this.initIdentifier(scope, d.id ? d.id.name : "*default*", d.start);
          return (env) => {
            init(env, cls(env, "default"));
            return undefined;
          };
        }
        const value = this.namedEv(d, scope, "default");
        const init = this.initIdentifier(scope, "*default*", node.start);
        return (env) => {
          init(env, value(env));
          return undefined;
        };
      }
    }
  }

  private variableDeclaration(node: A.VariableDeclaration, scope: CScope): St {
    const parts = node.declarations.map((d) => {
      if (!d.init) {
        if (node.kind === "var") return null;
        const init = this.binder(d.id, scope, "init");
        return (env: Env) => init(env, undefined);
      }
      const bind = this.binder(d.id, scope, node.kind === "var" ? "assign" : "init");
      const value = d.id.type === "Identifier" ? this.namedEv(d.init, scope, d.id.name) : this.expr(d.init, scope);
      return (env: Env) => bind(env, value(env));
    }).filter((p): p is (env: Env) => void => p !== null);
    if (parts.length === 1) {
      const p = parts[0]!;
      return (env) => {
        p(env);
        return undefined;
      };
    }
    return (env) => {
      for (const p of parts) p(env);
      return undefined;
    };
  }

  private loopScope(decl: A.VariableDeclaration | null | undefined, scope: CScope): CScope | null {
    if (!decl || decl.kind === "var") return null;
    const inner = this.newScope(scope, scope.fn);
    const ids: A.Identifier[] = [];
    for (const d of decl.declarations) patternNames(d.id, ids);
    for (const id of ids) this.declareName(inner, id.name, decl.kind, id.start);
    return inner;
  }

  private forStatement(node: A.ForStatement, scope: CScope, labels: ReadonlySet<string> | null): St {
    const loop = this.loopScope(node.init?.type === "VariableDeclaration" ? node.init : null, scope);
    const s = loop ?? scope;
    const init = node.init ? (node.init.type === "VariableDeclaration" ? this.variableDeclaration(node.init, s) : this.expr(node.init, s)) : null;
    const test = node.test ? this.expr(node.test, s) : null;
    const update = node.update ? this.expr(node.update, s) : null;
    const body = this.stmt(node.body, s, null);
    const initial = loop?.initial ?? null;
    return (env) => {
      const realm = ACTIVE.realm!;
      let e = initial ? { v: initial.slice(), p: env } : env;
      if (init) init(e);
      for (;;) {
        if (test && !test(e)) break;
        const c = body(e);
        if (c !== undefined) {
          if (isBreakFor(c, labels)) break;
          if (!isContinueFor(c, labels)) return c;
        }
        if (initial) e = { v: e.v.slice(), p: env };
        if (update) update(e);
        realm.tick();
      }
      return undefined;
    };
  }

  private forInOf(node: A.ForInStatement | A.ForOfStatement, scope: CScope, labels: ReadonlySet<string> | null): St {
    const decl = node.left.type === "VariableDeclaration" ? node.left : null;
    const loop = this.loopScope(decl, scope);
    const s = loop ?? scope;
    const target = decl ? decl.declarations[0]!.id : (node.left as A.Pattern);
    const bind = this.binder(target, s, decl && decl.kind !== "var" ? "init" : "assign");
    const right = this.expr(node.right, scope);
    const body = this.stmt(node.body, s, null);
    const initial = loop?.initial ?? null;
    if (node.type === "ForInStatement") {
      return (env) => {
        const realm = ACTIVE.realm!;
        const o = right(env);
        if (o === null || o === undefined) return undefined;
        const obj = Object(o) as object;
        chargeKeys(obj);
        const keys: string[] = [];
        for (const k in obj) keys.push(k);
        for (const k of keys) {
          if (!(k in obj)) continue;
          const e = initial ? { v: initial.slice(), p: env } : env;
          bind(e, k);
          const c = body(e);
          if (c !== undefined) {
            if (isBreakFor(c, labels)) break;
            if (!isContinueFor(c, labels)) return c;
          }
          realm.tick();
        }
        return undefined;
      };
    }
    return (env) => {
      const realm = ACTIVE.realm!;
      const iterable = right(env);
      if (Array.isArray(iterable) && iterable[Symbol.iterator] === ARRAY_VALUES) {
        for (let i = 0; i < iterable.length; i++) {
          const e = initial ? { v: initial.slice(), p: env } : env;
          bind(e, iterable[i]);
          const c = body(e);
          if (c !== undefined) {
            if (isBreakFor(c, labels)) break;
            if (!isContinueFor(c, labels)) return c;
          }
          realm.tick();
        }
        return undefined;
      }
      const { it, next } = getIterator(iterable);
      for (;;) {
        const r = iteratorStep(it, next);
        if (r.done) break;
        let c: Completion | undefined;
        try {
          const e = initial ? { v: initial.slice(), p: env } : env;
          bind(e, r.value);
          c = body(e);
        } catch (err) {
          if (!(err instanceof InternalAbort)) closeIterator(it, true);
          throw err;
        }
        if (c !== undefined) {
          if (isContinueFor(c, labels)) {
            realm.tick();
            continue;
          }
          closeIterator(it, false);
          return isBreakFor(c, labels) ? undefined : c;
        }
        realm.tick();
      }
      return undefined;
    };
  }

  private tryStatement(node: A.TryStatement, scope: CScope): St {
    const block = this.block(node.block.body, scope);
    let handler: ((env: Env, error: unknown) => Completion | undefined) | null = null;
    if (node.handler) {
      const h = node.handler;
      if (h.param) {
        const catchScope = this.newScope(scope, scope.fn);
        const ids: A.Identifier[] = [];
        patternNames(h.param, ids);
        for (const id of ids) this.declareName(catchScope, id.name, "let", id.start);
        const bind = this.binder(h.param, catchScope, "init");
        const body = this.block(h.body.body, catchScope);
        const initial = catchScope.initial;
        handler = (env, error) => {
          const e: Env = { v: initial.slice(), p: env };
          bind(e, error);
          return body(e);
        };
      } else {
        const body = this.block(h.body.body, scope);
        handler = (env) => body(env);
      }
    }
    const finalizer = node.finalizer ? this.block(node.finalizer.body, scope) : null;
    return (env) => {
      let completion: Completion | undefined;
      let thrown = false;
      let error: unknown;
      try {
        completion = block(env);
      } catch (err) {
        if (err instanceof InternalAbort) throw err;
        markCaught(err);
        if (handler) {
          try {
            completion = handler(env, err);
          } catch (err2) {
            if (err2 instanceof InternalAbort) throw err2;
            markCaught(err2);
            thrown = true;
            error = err2;
          }
        } else {
          thrown = true;
          error = err;
        }
      }
      if (finalizer) {
        const c = finalizer(env);
        if (c !== undefined) return c;
      }
      if (thrown) throw error;
      return completion;
    };
  }

  private switchStatement(node: A.SwitchStatement, scope: CScope): St {
    const discriminant = this.expr(node.discriminant, scope);
    const all = node.cases.flatMap((c) => c.consequent);
    const lexical = collectLexical(all, false);
    const inner = lexical.names.length ? this.newScope(scope, scope.fn) : null;
    if (inner) for (const { id, kind } of lexical.names) this.declareName(inner, id.name, kind, id.start);
    const s = inner ?? scope;
    const hoist = this.hoistFunctions(lexical.functions, s);
    const tests = node.cases.map((c) => (c.test ? this.expr(c.test, s) : null));
    const bodies = node.cases.map((c) => this.statements(c.consequent, s));
    const defaultIndex = node.cases.findIndex((c) => c.test === null);
    const initial = inner?.initial ?? null;
    return (env) => {
      const d = discriminant(env);
      const e = initial ? { v: initial.slice(), p: env } : env;
      hoist(e);
      let start = -1;
      for (let i = 0; i < tests.length; i++) {
        const t = tests[i];
        if (t && t(e) === d) {
          start = i;
          break;
        }
      }
      if (start < 0) start = defaultIndex;
      if (start < 0) return undefined;
      for (let i = start; i < bodies.length; i++) {
        const c = bodies[i]!(e);
        if (c !== undefined) {
          if (c.t === BREAK && c.label === null) return undefined;
          return c;
        }
      }
      return undefined;
    };
  }

  private labeled(node: A.LabeledStatement, scope: CScope, labels: ReadonlySet<string> | null): St {
    const set = new Set(labels ?? []);
    set.add(node.label);
    const body = node.body;
    if (body.type === "ForStatement" || body.type === "ForInStatement" || body.type === "ForOfStatement" || body.type === "WhileStatement" || body.type === "DoWhileStatement" || body.type === "LabeledStatement") {
      return this.stmt(body, scope, set);
    }
    const inner = this.stmt(body, scope, null);
    return (env) => {
      const c = inner(env);
      if (c !== undefined && c.t === BREAK && c.label !== null && set.has(c.label)) return undefined;
      return c;
    };
  }

  // ---- suspending statements --------------------------------------------------------

  private statementsG(list: readonly A.Statement[], scope: CScope): StG {
    const items = list
      .filter((s) => s.type !== "FunctionDeclaration" && s.type !== "EmptyStatement")
      .map((s) => ({ start: s.start, s: hasSuspend(s) ? null : this.stmt(s, scope, null), g: hasSuspend(s) ? this.stmtG(s, scope, null) : null }));
    return function* (env) {
      for (const item of items) {
        ACTIVE.pos = item.start;
        const c = item.g ? yield* item.g(env) : item.s!(env);
        if (c !== undefined) return c;
      }
      return undefined;
    };
  }

  private blockG(list: readonly A.Statement[], scope: CScope): StG {
    const lexical = collectLexical(list, false);
    if (!lexical.names.length) return this.statementsG(list, scope);
    const inner = this.newScope(scope, scope.fn);
    for (const { id, kind } of lexical.names) this.declareName(inner, id.name, kind, id.start);
    const hoist = this.hoistFunctions(lexical.functions, inner);
    const body = this.statementsG(list, inner);
    const initial = inner.initial;
    return function* (env) {
      const e: Env = { v: initial.slice(), p: env };
      hoist(e);
      return yield* body(e);
    };
  }

  private stmtOrG(node: A.Statement, scope: CScope, labels: ReadonlySet<string> | null): { s: St | null; g: StG | null } {
    return hasSuspend(node) ? { s: null, g: this.stmtG(node, scope, labels) } : { s: this.stmt(node, scope, labels), g: null };
  }

  private stmtG(node: A.Statement, scope: CScope, labels: ReadonlySet<string> | null): StG {
    if (!hasSuspend(node)) {
      const sync = this.stmt(node, scope, labels);
      return function* (env) {
        return sync(env);
      };
    }
    switch (node.type) {
      case "ExpressionStatement": {
        const f = this.exprG(node.expression, scope);
        return function* (env) {
          yield* f(env);
          return undefined;
        };
      }
      case "VariableDeclaration": {
        const parts = node.declarations.map((d) => {
          const bind = this.binderG(d.id, scope, node.kind === "var" ? "assign" : "init");
          const value = d.init ? this.ev(d.init, scope) : null;
          const skip = !d.init && node.kind === "var";
          return { bind, value, skip };
        });
        return function* (env) {
          for (const p of parts) {
            if (p.skip) continue;
            const v = p.value ? (p.value.g ? yield* p.value.g(env) : p.value.s!(env)) : undefined;
            yield* p.bind(env, v);
          }
          return undefined;
        };
      }
      case "BlockStatement":
        return this.blockG(node.body, scope);
      case "IfStatement": {
        const test = this.ev(node.test, scope);
        const a = this.stmtOrG(node.consequent, scope, null);
        const b = node.alternate ? this.stmtOrG(node.alternate, scope, null) : null;
        return function* (env) {
          const t = test.g ? yield* test.g(env) : test.s!(env);
          const branch = t ? a : b;
          if (!branch) return undefined;
          return branch.g ? yield* branch.g(env) : branch.s!(env);
        };
      }
      case "ForStatement": {
        const loop = this.loopScope(node.init?.type === "VariableDeclaration" ? node.init : null, scope);
        const s = loop ?? scope;
        const init = node.init ? (node.init.type === "VariableDeclaration" ? this.stmtOrG(node.init, s, null) : null) : null;
        const initExpr = node.init && node.init.type !== "VariableDeclaration" ? this.ev(node.init, s) : null;
        const test = node.test ? this.ev(node.test, s) : null;
        const update = node.update ? this.ev(node.update, s) : null;
        const body = this.stmtOrG(node.body, s, null);
        const initial = loop?.initial ?? null;
        return function* (env) {
          const realm = ACTIVE.realm!;
          let e = initial ? { v: initial.slice(), p: env } : env;
          if (init) {
            if (init.g) yield* init.g(e);
            else init.s!(e);
          } else if (initExpr) {
            if (initExpr.g) yield* initExpr.g(e);
            else initExpr.s!(e);
          }
          for (;;) {
            if (test && !(test.g ? yield* test.g(e) : test.s!(e))) break;
            const c = body.g ? yield* body.g(e) : body.s!(e);
            if (c !== undefined) {
              if (isBreakFor(c, labels)) break;
              if (!isContinueFor(c, labels)) return c;
            }
            if (initial) e = { v: e.v.slice(), p: env };
            if (update) {
              if (update.g) yield* update.g(e);
              else update.s!(e);
            }
            realm.tick();
          }
          return undefined;
        };
      }
      case "ForInStatement":
      case "ForOfStatement":
        return this.forInOfG(node, scope, labels);
      case "WhileStatement":
      case "DoWhileStatement": {
        const test = this.ev(node.test, scope);
        const body = this.stmtOrG(node.body, scope, null);
        const doWhile = node.type === "DoWhileStatement";
        return function* (env) {
          const realm = ACTIVE.realm!;
          let first = doWhile;
          for (;;) {
            if (!first && !(test.g ? yield* test.g(env) : test.s!(env))) break;
            first = false;
            const c = body.g ? yield* body.g(env) : body.s!(env);
            if (c !== undefined) {
              if (isBreakFor(c, labels)) break;
              if (!isContinueFor(c, labels)) return c;
            }
            realm.tick();
          }
          return undefined;
        };
      }
      case "ReturnStatement": {
        const arg = this.ev(node.argument!, scope);
        const isAsyncGenerator = scope.fn.async && scope.fn.generator;
        return function* (env) {
          let v = arg.g ? yield* arg.g(env) : arg.s!(env);
          if (isAsyncGenerator) v = yield new AwaitSignal(v);
          return { t: RETURN, label: null, value: v };
        };
      }
      case "ThrowStatement": {
        const arg = this.exprG(node.argument, scope);
        return function* (env) {
          const v = yield* arg(env);
          markThrown(v);
          throw v;
        };
      }
      case "TryStatement": {
        const block = this.blockG(node.block.body, scope);
        let handler: ((env: Env, error: unknown) => Generator<unknown, Completion | undefined, unknown>) | null = null;
        if (node.handler) {
          const h = node.handler;
          const catchScope = this.newScope(scope, scope.fn);
          const ids: A.Identifier[] = [];
          if (h.param) patternNames(h.param, ids);
          for (const id of ids) this.declareName(catchScope, id.name, "let", id.start);
          const bind = h.param ? this.binderG(h.param, catchScope, "init") : null;
          const body = this.blockG(h.body.body, catchScope);
          const initial = catchScope.initial;
          handler = function* (env, error) {
            const e: Env = { v: initial.slice(), p: env };
            if (bind) yield* bind(e, error);
            return yield* body(e);
          };
        }
        const finalizer = node.finalizer ? this.blockG(node.finalizer.body, scope) : null;
        return function* (env) {
          let completion: Completion | undefined;
          let thrown = false;
          let error: unknown;
          let finished = false;
          try {
            try {
              completion = yield* block(env);
            } catch (err) {
              if (err instanceof InternalAbort) throw err;
              markCaught(err);
              if (handler) {
                try {
                  completion = yield* handler(env, err);
                } catch (err2) {
                  if (err2 instanceof InternalAbort) throw err2;
                  markCaught(err2);
                  thrown = true;
                  error = err2;
                }
              } else {
                thrown = true;
                error = err;
              }
            }
            finished = true;
          } finally {
            if (!finished && finalizer) {
              // The generator is being closed (return() while suspended): run the finalizer.
              const it = finalizer(env);
              for (let r = it.next(); !r.done; r = it.next()) {}
            }
          }
          if (finalizer) {
            const c = yield* finalizer(env);
            if (c !== undefined) return c;
          }
          if (thrown) throw error;
          return completion;
        };
      }
      case "SwitchStatement": {
        const discriminant = this.ev(node.discriminant, scope);
        const all = node.cases.flatMap((c) => c.consequent);
        const lexical = collectLexical(all, false);
        const inner = lexical.names.length ? this.newScope(scope, scope.fn) : null;
        if (inner) for (const { id, kind } of lexical.names) this.declareName(inner, id.name, kind, id.start);
        const s = inner ?? scope;
        const hoist = this.hoistFunctions(lexical.functions, s);
        const tests = node.cases.map((c) => (c.test ? this.ev(c.test, s) : null));
        const bodies = node.cases.map((c) => this.statementsG(c.consequent, s));
        const defaultIndex = node.cases.findIndex((c) => c.test === null);
        const initial = inner?.initial ?? null;
        return function* (env) {
          const d = discriminant.g ? yield* discriminant.g(env) : discriminant.s!(env);
          const e = initial ? { v: initial.slice(), p: env } : env;
          hoist(e);
          let start = -1;
          for (let i = 0; i < tests.length; i++) {
            const t = tests[i];
            if (t && (t.g ? yield* t.g(e) : t.s!(e)) === d) {
              start = i;
              break;
            }
          }
          if (start < 0) start = defaultIndex;
          if (start < 0) return undefined;
          for (let i = start; i < bodies.length; i++) {
            const c = yield* bodies[i]!(e);
            if (c !== undefined) {
              if (c.t === BREAK && c.label === null) return undefined;
              return c;
            }
          }
          return undefined;
        };
      }
      case "LabeledStatement": {
        const set = new Set(labels ?? []);
        set.add(node.label);
        const body = node.body;
        if (["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement", "LabeledStatement"].includes(body.type)) return this.stmtG(body, scope, set);
        const inner = this.stmtG(body, scope, null);
        return function* (env) {
          const c = yield* inner(env);
          if (c !== undefined && c.t === BREAK && c.label !== null && set.has(c.label)) return undefined;
          return c;
        };
      }
      case "ClassDeclaration":
        return this.error("await and yield in class names and extends clauses aren't supported yet.", node.start);
      default:
        return this.error(`Internal error: can't suspend inside ${node.type}.`, node.start);
    }
  }

  private forInOfG(node: A.ForInStatement | A.ForOfStatement, scope: CScope, labels: ReadonlySet<string> | null): StG {
    const decl = node.left.type === "VariableDeclaration" ? node.left : null;
    const loop = this.loopScope(decl, scope);
    const s = loop ?? scope;
    const target = decl ? decl.declarations[0]!.id : (node.left as A.Pattern);
    const bind = this.binderG(target, s, decl && decl.kind !== "var" ? "init" : "assign");
    const right = this.ev(node.right, scope);
    const body = this.stmtOrG(node.body, s, null);
    const initial = loop?.initial ?? null;
    const isForIn = node.type === "ForInStatement";
    const isAwait = node.type === "ForOfStatement" && node.await;
    return function* (env) {
      const realm = ACTIVE.realm!;
      const iterable = right.g ? yield* right.g(env) : right.s!(env);
      let it: object;
      let next: unknown;
      let asyncIterator = false;
      if (isForIn) {
        if (iterable === null || iterable === undefined) return undefined;
        const obj = Object(iterable) as object;
        chargeKeys(obj);
        const keys: string[] = [];
        for (const k in obj) keys.push(k);
        const values = keys.values();
        it = values;
        next = values.next;
      } else if (isAwait) {
        const method = iterable === null || iterable === undefined ? undefined : getProp(iterable, Symbol.asyncIterator);
        if (method !== undefined && method !== null) {
          it = callValue(method, iterable, []) as object;
          if (!isObjectLike(it)) throw new TypeError("Result of the Symbol.asyncIterator method is not an object");
          next = getProp(it, "next");
          asyncIterator = true;
        } else ({ it, next } = getIterator(iterable));
      } else ({ it, next } = getIterator(iterable));
      for (;;) {
        let result = callValue(next, it, []);
        if (asyncIterator) result = yield new AwaitSignal(result);
        if (!isObjectLike(result)) throw new TypeError(`Iterator result ${describeValue(result)} is not an object`);
        if (getProp(result, "done")) break;
        let value = getProp(result, "value");
        if (isAwait && !asyncIterator) value = yield new AwaitSignal(value);
        let c: Completion | undefined;
        try {
          const e = initial ? { v: initial.slice(), p: env } : env;
          yield* bind(e, value);
          c = body.g ? yield* body.g(e) : body.s!(e);
        } catch (err) {
          if (!(err instanceof InternalAbort) && !isForIn) {
            try {
              const ret = getProp(it, "return");
              if (ret !== undefined && ret !== null) {
                const r = callValue(ret, it, []);
                if (asyncIterator) yield new AwaitSignal(r);
              }
            } catch (closeErr) {
              if (closeErr instanceof InternalAbort) throw closeErr;
            }
          }
          throw err;
        }
        if (c !== undefined) {
          if (isContinueFor(c, labels)) {
            realm.tick();
            continue;
          }
          if (!isForIn) {
            const ret = getProp(it, "return");
            if (ret !== undefined && ret !== null) {
              const r = callValue(ret, it, []);
              if (asyncIterator) yield new AwaitSignal(r);
            }
          }
          return isBreakFor(c, labels) ? undefined : c;
        }
        realm.tick();
      }
      return undefined;
    };
  }
}

interface SuperSlots {
  func: Resolved;
  newTarget: Resolved;
  this: Resolved;
}

function superConstructAt(env: Env, slots: SuperSlots, args: unknown[]): void {
  const func = envAt(env, slots.func.depth).v[slots.func.index] as Function;
  const newTarget = envAt(env, slots.newTarget.depth).v[slots.newTarget.index];
  const thisEnv = envAt(env, slots.this.depth);
  construct(func, newTarget, thisEnv, slots.this.index, args);
}

function superConstruct(env: Env, slots: Slots, args: unknown[]): void {
  construct(env.v[slots.func] as Function, env.v[slots.newTarget], env, slots.this, args);
}

function construct(func: Function, newTarget: unknown, thisEnv: Env, thisIndex: number, args: unknown[]): void {
  const parent = Object.getPrototypeOf(func) as unknown;
  if (!isConstructor(parent)) throw new TypeError("Super constructor is not a constructor");
  const value = constructValue(parent, args, newTarget);
  if (thisEnv.v[thisIndex] !== TDZ) throw new ReferenceError("Super constructor may only be called once");
  thisEnv.v[thisIndex] = value;
  const record = CLASS_RECORDS.get(func);
  if (record) initializeInstance(record, value as object);
}

function spreadInto(out: unknown[], value: unknown): void {
  if (Array.isArray(value) && value[Symbol.iterator] === ARRAY_VALUES) {
    chargeElements(value);
    for (let i = 0; i < value.length; i++) out.push(value[i]);
    return;
  }
  const { it, next } = getIterator(value);
  for (;;) {
    const r = iteratorStep(it, next);
    if (r.done) return;
    out.push(r.value);
  }
}

const templateObjects = new WeakMap<A.TemplateLiteral, readonly string[]>();

function templateObject(quasi: A.TemplateLiteral): readonly string[] {
  let strings = templateObjects.get(quasi);
  if (!strings) {
    const cooked = quasi.quasis.map((q) => q.cooked) as string[];
    Object.defineProperty(cooked, "raw", { value: Object.freeze(quasi.quasis.map((q) => q.raw)) });
    strings = Object.freeze(cooked);
    templateObjects.set(quasi, strings);
  }
  return strings;
}

function* delegateAsync(iterable: unknown): Generator<unknown, unknown, unknown> {
  const method = iterable === null || iterable === undefined ? undefined : getProp(iterable, Symbol.asyncIterator);
  let it: object;
  let next: unknown;
  let isAsync = false;
  if (method !== undefined && method !== null) {
    it = callValue(method, iterable, []) as object;
    next = getProp(it, "next");
    isAsync = true;
  } else ({ it, next } = getIterator(iterable));
  let received: unknown;
  for (;;) {
    let result = callValue(next, it, [received]);
    if (isAsync) result = yield new AwaitSignal(result);
    if (!isObjectLike(result)) throw new TypeError(`Iterator result ${describeValue(result)} is not an object`);
    if (getProp(result, "done")) return getProp(result, "value");
    received = yield getProp(result, "value");
  }
}

registerIntrinsics(ScriptAsyncGenerator);
