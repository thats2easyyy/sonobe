import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileScript } from "./compiler.ts";
import { ScriptSyntaxError } from "./lexer.ts";
import { InternalAbort, Realm, type RealmHooks } from "./realm.ts";

interface RunResult {
  get(name: string): unknown;
  realm: Realm;
  rejections: unknown[];
  drain(): void;
}

function run(source: string, options: { deterministic?: boolean; kind?: "module" | "function" } = {}): RunResult {
  const rejections: unknown[] = [];
  let random = 0;
  const hooks: RealmHooks = {
    beginSegment() {},
    endSegment() {},
    unhandledRejection: (reason) => rejections.push(reason),
    now: () => 1_767_225_600_000,
    perfNow: () => 1234,
    random: () => (random = (random + 0.25) % 1),
  };
  const realm = new Realm(hooks, options.deterministic ?? true);
  const script = compileScript(source, options.kind ?? "module");
  realm.beginInvocation();
  const module = script.run(realm);
  const drain = () => realm.run(() => realm.drain());
  drain();
  return { get: (name) => module.getExport(name), realm, rejections, drain };
}

const value = (source: string, name = "result") => run(source).get(name);

describe("sandbox: language", () => {
  it("evaluates expressions, closures, and hoisted functions", () => {
    expect(value("export const result = add(2, 3) * 2; function add(a, b) { return a + b; }")).toBe(10);
    expect(value("const counter = () => { let n = 0; return () => ++n; }; const c = counter(); c(); c(); export const result = c();")).toBe(3);
    expect(value("export const result = typeof notDeclared;")).toBe("undefined");
    expect(value("export const result = 2 ** 3 ** 2;")).toBe(512);
    expect(value("export const result = null ?? 'fallback';")).toBe("fallback");
    expect(value("export const result = `a${1 + 1}b${'c'}`;")).toBe("a2bc");
    expect(value("export const result = 10n ** 20n;")).toBe(10n ** 20n);
  });

  it("gives each loop iteration its own let binding", () => {
    expect(value("const fns = []; for (let i = 0; i < 3; i++) fns.push(() => i); export const result = fns.map((f) => f());")).toEqual([0, 1, 2]);
    expect(value("const fns = []; for (const k of ['a', 'b']) fns.push(() => k); export const result = fns.map((f) => f()).join('');")).toBe("ab");
  });

  it("destructures objects and arrays with defaults and rest", () => {
    expect(value("const { a, b: { c = 5 } = {}, ...rest } = { a: 1, d: 4, e: 5 }; export const result = [a, c, rest];")).toEqual([1, 5, { d: 4, e: 5 }]);
    expect(value("const [x, , y = 9, ...others] = [1, 2, undefined, 4, 5]; export const result = [x, y, others];")).toEqual([1, 9, [4, 5]]);
    expect(value("let a = 1, b = 2; [a, b] = [b, a]; export const result = [a, b];")).toEqual([2, 1]);
    expect(value("function f({ x = 1, y } = {}, ...more) { return [x, y, more.length]; } export const result = f({ y: 2 }, 3, 4);")).toEqual([1, 2, 2]);
    expect(value("function* g() { yield 1; yield 2; yield 3; } const [first, ...tail] = g(); export const result = [first, tail];")).toEqual([1, [2, 3]]);
  });

  it("supports spread, optional chaining, and object literal features", () => {
    expect(value("const o = { a: 1 }; export const result = { ...o, b: 2, ['c' + 1]: 3 };")).toEqual({ a: 1, b: 2, c1: 3 });
    expect(value("const o = { deep: null }; export const result = [o?.deep?.x, o.missing?.(), o.deep?.x.y.z];")).toEqual([undefined, undefined, undefined]);
    expect(value("const o = { get double() { return this.n * 2; }, n: 4, m() { return this.n; } }; export const result = [o.double, o.m()];")).toEqual([8, 4]);
    expect(value("export const result = Math.max(...[3, 9, 2]);")).toBe(9);
    expect(value("const f = function () {}; const g = () => {}; export const result = [f.name, g.name, ({ h() {} }).h.name];")).toEqual(["f", "g", "h"]);
  });

  it("runs classes with fields, accessors, statics, private members, and inheritance", () => {
    const source = `
      class Animal {
        #sound;
        legs = 4;
        static count = 0;
        constructor(sound) { this.#sound = sound; Animal.count++; }
        speak() { return this.#sound; }
        get loud() { return this.#sound.toUpperCase(); }
        static #secret() { return "s"; }
        static reveal() { return Animal.#secret(); }
        has(o) { return #sound in o; }
      }
      class Dog extends Animal {
        constructor() { super("woof"); this.legs = 3; }
        speak() { return super.speak() + "!"; }
      }
      const d = new Dog();
      export const result = [d.speak(), d.loud, d.legs, Animal.count, Animal.reveal(), d.has(d), d.has({}), d instanceof Animal];
    `;
    expect(value(source)).toEqual(["woof!", "WOOF", 3, 1, "s", true, false, true]);
    expect(value("class MyError extends Error { constructor(m) { super(m); this.name = 'MyError'; } } const e = new MyError('x'); export const result = [e instanceof Error, e.message, e.name];")).toEqual([true, "x", "MyError"]);
    expect(value("class Bag extends Map { total() { return [...this.values()].reduce((a, b) => a + b, 0); } } const b = new Bag([['a', 1], ['b', 2]]); export const result = b.total();")).toBe(3);
    expect(() => run("class A {} A();")).toThrow(/without 'new'/);
  });

  it("drives generators with next, return, and yield*", () => {
    expect(value("function* inner() { yield 2; return 3; } function* outer() { const r = yield* inner(); yield 1; yield r; } export const result = [...outer()];")).toEqual([2, 1, 3]);
    expect(value("function* g() { try { yield 1; yield 2; } finally { log.push('closed'); } } const log = []; for (const x of g()) { log.push(x); break; } export const result = log;")).toEqual([1, "closed"]);
    expect(value("function* echo() { let got = yield 'ready'; while (true) got = yield got * 2; } const it = echo(); it.next(); export const result = [it.next(2).value, it.next(5).value];")).toEqual([4, 10]);
  });

  it("handles control flow: labels, switch, try/finally overrides", () => {
    expect(value("let out = []; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 1) continue outer; if (i === 2) break outer; out.push(i + '' + j); } } export const result = out;")).toEqual(["00", "10"]);
    expect(value("function f(x) { switch (x) { case 1: return 'one'; case 2: case 3: return 'few'; default: return 'many'; } } export const result = [f(1), f(3), f(9)];")).toEqual(["one", "few", "many"]);
    expect(value("function f() { try { throw new Error('x'); } catch (e) { return 'caught ' + e.message; } finally { log.push('finally'); } } const log = []; export const result = [f(), log];")).toEqual(["caught x", ["finally"]]);
    expect(value("function f() { try { return 1; } finally { return 2; } } export const result = f();")).toBe(2);
    expect(value("let n = 0; do { n++; } while (n < 5); export const result = n;")).toBe(5);
    expect(value("const keys = []; for (const k in { a: 1, b: 2 }) keys.push(k); export const result = keys;")).toEqual(["a", "b"]);
  });

  it("settles promises and async functions on the realm's job queue in spec order", () => {
    const source = `
      export const log = [];
      async function work() { log.push("start"); await null; log.push("after await"); return 7; }
      Promise.resolve().then(() => log.push("then 1"));
      work().then((v) => log.push("resolved " + v));
      queue();
      function queue() { log.push("sync end"); }
      export async function later() { const values = await Promise.all([1, Promise.resolve(2), work()]); return values; }
    `;
    const r = run(source);
    expect(r.get("log")).toEqual(["start", "sync end", "then 1", "after await", "resolved 7"]);
    let out: unknown;
    r.realm.run(() => (r.get("later") as () => { then(f: (v: unknown) => void): void })().then((v) => (out = v)));
    r.drain();
    expect(out).toEqual([1, 2, 7]);
  });

  it("supports async generators, for await, and error propagation through awaits", () => {
    const source = `
      export const log = [];
      async function* ticks() { yield 1; await null; yield 2; }
      async function main() {
        for await (const t of ticks()) log.push(t);
        try { await Promise.reject(new Error("nope")); } catch (e) { log.push(e.message); }
        return "done";
      }
      main().then((v) => log.push(v));
    `;
    expect(run(source).get("log")).toEqual([1, 2, "nope", "done"]);
    expect(run("Promise.reject(new Error('lost'));").rejections).toHaveLength(1);
  });

  it("reports syntax errors with line and column", () => {
    const expectSyntax = (source: string, message: RegExp, line: number) => {
      try {
        compileScript(source);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ScriptSyntaxError);
        expect((err as ScriptSyntaxError).message).toMatch(message);
        expect((err as ScriptSyntaxError).line).toBe(line);
      }
    };
    expectSyntax("const a = 1;\nconst b = ;", /Unexpected/, 2);
    expectSyntax("import x from 'y';", /Scripts are one file/, 1);
    expectSyntax("export { a } from 'b';", /Scripts are one file/, 1);
    expectSyntax("\n\nconst x = await fetch('a');", /Use await inside evaluate or a callback/, 3);
    expectSyntax("let a; let a;", /already been declared/, 1);
    expectSyntax("with (a) {}", /with statements/, 1);
  });

  it("runs Origami-style file bodies that return a value, allowing implicit globals", () => {
    const hooks: RealmHooks = { beginSegment() {}, endSegment() {}, unhandledRejection() {}, now: () => 0, perfNow: () => 0, random: () => 0 };
    const realm = new Realm(hooks, true);
    realm.sloppyGlobals = true;
    realm.beginInvocation();
    const module = compileScript("var patch = { n: 1 }; patch.n++; counter = 5; return patch;", "function").run(realm);
    expect(module.returned).toEqual({ n: 2 });
    expect(realm.global.counter).toBe(5);
    expect(() => run("undeclared = 1;")).toThrow(/undeclared is not defined/);
  });
});

describe("sandbox: budgets", () => {
  it("stops runaway loops at a deterministic interrupt limit", () => {
    expect(() => run("while (true) {}")).toThrow(InternalAbort);
    expect(() => run("for (;;) {}")).toThrow(/took too long/);
  });

  it("turns deep recursion into a catchable RangeError", () => {
    expect(value("function f(n) { return f(n + 1); } let result; try { f(0); } catch (e) { result = e instanceof RangeError; } export { result };")).toBe(true);
  });

  it("refuses huge strings", () => {
    expect(() => run("let s = 'x'; while (true) s += s;")).toThrow(/too much memory/);
    expect(() => run("'x'.repeat(2 ** 30);")).toThrow(/too much memory/);
  });

  it("refuses huge native allocations before V8 makes them", () => {
    for (const deterministic of [true, false]) {
      const memory = (source: string) => expect(() => run(source, { deterministic }), source).toThrow(/too much memory/);
      memory("new Array(2 ** 28).fill(0);");
      memory("new Uint8Array(2 ** 30);");
      memory("new ArrayBuffer(2 ** 31);");
      memory("new Float64Array(1e9);");
      memory("const a = []; a.length = 2 ** 30;");
      memory("Array.from({ length: 2 ** 30 });");
      memory("Object.keys(new Uint8Array(4e7));");
      memory("new Set(new Uint32Array(3e7));");
      memory("const row = new Array(1e6).fill(0); new Array(1000).fill(row).flat();");
      memory("'ab'.repeat(1e7).split('');");
      memory("JSON.parse('[' + '0,'.repeat(1e7) + '0]');");
      memory("const keep = []; for (let i = 0; i < 100; i++) keep.push(new Uint8Array(60e6));");
      memory("[1].flatMap(() => new Array(2 ** 27));");
      expect(() => run("const a = []; a[5e7] = 1; a.fill(0);", { deterministic })).toThrow(/too much memory|took too long/);
      expect(() => run("Math.max.apply(null, { length: 2 ** 30 });", { deterministic })).toThrow(/too much memory|took too long/);
    }
  });

  it("stops one native call that would visit too many elements", () => {
    expect(() => run("new Array(1e6).fill(0).map(Math.random).sort();", { deterministic: false })).toThrow(/took too long/);
    // Each call visits 4 million slots natively; deterministic runtimes count those visits as interrupt checks.
    expect(() => run("const a = []; a.length = 4e6; for (let i = 0; i < 100; i++) a.indexOf(1);")).toThrow(/took too long/);
  });

  it("can't catch a memory stop, and still allows ordinary allocations", () => {
    expect(() => run("try { new Array(2 ** 28).fill(0); } catch { globalThis.caught = true; }")).toThrow(InternalAbort);
    expect(value("export const result = new Uint8Array(1e6).length + new Array(1000).fill(1).length + Object.keys(new Array(5000).fill(0)).length + [...new Array(2000)].length;")).toBe(1_008_000);
    expect(value("class Bytes extends Uint8Array { total() { return this.reduce((a, b) => a + b, 0); } } export const result = [new Bytes([1, 2, 3]).total(), new Bytes(2) instanceof Uint8Array, Array.isArray(Array.from('abc')), new Map([[1, 2]]).get(1)];")).toEqual([6, true, true, 2]);
  });

  it("contains an allocation that would crash V8 (in a child process, so a regression can't take down the runner)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sonobe-oom-"));
    const file = path.join(dir, "oom.ts");
    writeFileSync(
      file,
      `import { compileScript } from ${JSON.stringify(new URL("./compiler.ts", import.meta.url).href)};
import { InternalAbort, Realm } from ${JSON.stringify(new URL("./realm.ts", import.meta.url).href)};
const hooks = { beginSegment() {}, endSegment() {}, unhandledRejection() {}, now: () => 0, perfNow: () => 0, random: () => 0 };
for (const deterministic of [true, false]) {
  const realm = new Realm(hooks, deterministic);
  realm.beginInvocation();
  try {
    compileScript("try { new Array(2 ** 28).fill(0); } catch {}", "module").run(realm);
    console.log("ran");
  } catch (err) {
    console.log(err instanceof InternalAbort ? err.reason : "threw " + err);
  }
}
`,
    );
    try {
      const result = spawnSync(process.execPath, ["--max-old-space-size=512", file], { encoding: "utf8", timeout: 60_000 });
      expect(result.stderr).not.toContain("FATAL ERROR");
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual(["memory", "memory"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the prototype clock and seeded randomness", () => {
    const r = run("export const result = [Date.now(), new Date().getTime(), typeof performance === 'undefined', Math.random(), Math.random()];");
    expect(r.get("result")).toEqual([1_767_225_600_000, 1_767_225_600_000, true, 0.25, 0.5]);
  });
});

describe("sandbox: isolation", () => {
  const blocked = (source: string) => expect(() => run(source)).toThrow();

  it("never compiles text into code", () => {
    blocked("(() => {}).constructor('return globalThis')();");
    blocked("Object.getPrototypeOf(async function () {}).constructor('return 1')();");
    blocked("Object.getPrototypeOf(function* () {}).constructor('yield 1')().next();");
    blocked("Function('return this')();");
    blocked("[].map.constructor('return process')();");
    blocked("Reflect.get(Function.prototype, 'constructor')('return 1')();");
    blocked("Object.getOwnPropertyDescriptor(Function.prototype, 'constructor').value('return 1')();");
    expect(value("export const result = [typeof eval, typeof process, typeof require, typeof window, typeof document, typeof globalThis.fetch];")).toEqual(["undefined", "undefined", "undefined", "undefined", "undefined", "undefined"]);
  });

  it("keeps built-in objects read-only", () => {
    blocked("Array.prototype.push = () => 0;");
    blocked("Object.prototype.polluted = true;");
    blocked("Array.prototype.push.call(Array.prototype, 1);");
    blocked("[1].forEach(Array.prototype.push, Array.prototype);");
    blocked("Object.assign(Array.prototype, { x: 1 });");
    blocked("Object.defineProperty(String.prototype, 'x', { value: 1 });");
    blocked("Reflect.set(Array.prototype, 'x', 1);");
    blocked("Array.prototype.push.apply(Object.prototype, [1]);");
    blocked("Array.prototype.push.bind(Array.prototype)(1);");
    blocked("delete Array.prototype.map;");
    blocked("({}).__proto__.x = 1;");
    blocked("Object.getOwnPropertyDescriptor(Object.prototype, '__proto__').set.call(Array.prototype, null);");
    expect((Array.prototype as unknown as { x?: unknown }).x).toBeUndefined();
    expect((Object.prototype as unknown as { polluted?: unknown }).polluted).toBeUndefined();
    expect(value("export const result = [1, 2].map((n) => n * 2).concat([3]);")).toEqual([2, 4, 3]);
  });

  it("hides host stack hooks and legacy RegExp statics", () => {
    expect(value("export const result = [Error.prepareStackTrace, typeof RegExp.$1, /a/.constructor === RegExp];")).toEqual([undefined, "undefined", true]);
  });

  it("isolates instances from each other", () => {
    const a = run("globalThis.shared = 1; Math.custom = 2; export const result = 1;");
    const b = run("export const result = [typeof shared, typeof Math.custom];");
    expect(a.get("result")).toBe(1);
    expect(b.get("result")).toEqual(["undefined", "undefined"]);
  });
});
