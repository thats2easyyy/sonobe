import { describe, expect, it } from "vitest";
import { compileScript } from "./compiler.ts";
import { InternalAbort, LIVE_BUDGET_MS, Realm, type RealmHooks } from "./realm.ts";

const hooks: RealmHooks = { beginSegment() {}, endSegment() {}, unhandledRejection() {}, now: () => 0, perfNow: () => 0, random: () => 0.5 };

function sandboxValue(expression: string, deterministic = true): unknown {
  const realm = new Realm(hooks, deterministic);
  realm.beginInvocation();
  const module = compileScript(`export const result = (() => { ${expression} })();`, "module").run(realm);
  return module.getExport("result");
}

function hostValue(expression: string): unknown {
  // Test code only: the same expression evaluated by V8 itself, as the reference.
  return new Function(expression)() as unknown;
}

/** A comparable snapshot: match arrays keep index, groups and indices; undefined stays visible. */
function normalize(value: unknown): string {
  const seen = (v: unknown): unknown => {
    if (v === undefined) return "<undefined>";
    if (Array.isArray(v)) {
      const items = v.map(seen);
      const extra = v as unknown[] & { index?: unknown; groups?: unknown; indices?: unknown };
      return "index" in v ? { items, index: extra.index, groups: seen(extra.groups), indices: seen(extra.indices) } : items;
    }
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, seen(x)]));
    return v;
  };
  return JSON.stringify(seen(value));
}

function same(expression: string): void {
  let expected: string;
  try {
    expected = normalize(hostValue(expression));
  } catch (err) {
    expected = `throws ${(err as Error).name}`;
  }
  let actual: string;
  try {
    actual = normalize(sandboxValue(expression));
  } catch (err) {
    actual = `throws ${(err as Error).name}`;
  }
  expect(actual, expression).toBe(expected);
}

describe("sandbox regular expressions match V8", () => {
  it("matches literals, classes, anchors, alternation and quantifiers", () => {
    for (const expr of [
      `return /abc/.exec("xxabcx");`,
      `return /a.c/.exec("a\\nc abc");`,
      `return /a.c/s.exec("a\\nc");`,
      `return /^b/m.exec("a\\nb");`,
      `return /a$/m.exec("a\\nb");`,
      `return /(a|ab)(c|bcd)(d*)/.exec("abcd");`,
      `return /a{2,3}?/.exec("aaaa");`,
      `return /a{2,}/.exec("aaaa");`,
      `return /x*y+$/.exec("xxyyy");`,
      `return /[a-z]+\\d{2}/i.exec("HELLO42");`,
      `return /[^]/.exec("\\n");`,
      `return /[]/.exec("abc");`,
      `return /\\bfoo\\B/.exec("a foox foo");`,
      `return /(\\d+)\\s*(?:px|em)/.exec("width: 12 px");`,
      `return /(?:a|b)+?c/.exec("ababc");`,
      `return /a*?$/.exec("aaa");`,
    ])
      same(expr);
  });

  it("handles captures inside loops, empty iterations and backreferences", () => {
    for (const expr of [
      `return /(a|)*b/.exec("aab");`,
      `return /(a*)+/.exec("b");`,
      `return /(a*?)*/.exec("aa");`,
      `return /(z)((a+)?(b+)?(c))*/.exec("zaacbbbcac");`,
      `return /(?:(a)|b)+/.exec("ab");`,
      `return /(a)\\1/i.exec("aA");`,
      `return /(\\w+)\\s\\1/.exec("hello hello world");`,
      `return /\\1(a)/.exec("aa");`,
      `return /(?<x>a)|(?<x>b)\\k<x>/.exec("bb");`,
      `return /(?<year>\\d{4})-(?<month>\\d{2})/.exec("on 2026-09");`,
      `return /(a)|b/.exec("b");`,
      `return /(?=(a))*a/.exec("a");`,
      `return /(?=(a))+a/.exec("a");`,
    ])
      same(expr);
  });

  it("runs lookahead and lookbehind, including captures and backward backreferences", () => {
    for (const expr of [
      `return /\\d+(?=%)/.exec("50 then 30%");`,
      `return /\\d+(?!%)/.exec("30% 50");`,
      `return /(?<=\\$)\\d+/.exec("cost $42");`,
      `return /(?<!\\$)\\b\\d+/.exec("$42 or 17");`,
      `return /(?<=(\\d+)(\\d+))$/.exec("1053");`,
      `return /(?<=\\1(a))b/.exec("aab");`,
      `return /(?<=^|,)\\w+/g[Symbol.match]("a,bc,d");`,
      `return /(?=(\\w+))\\1:/.exec("abc:");`,
    ])
      same(expr);
  });

  it("follows Unicode, case folding, v-mode sets and modifiers", () => {
    for (const expr of [
      `return /./u.exec("😀x");`,
      `return /^.$/.exec("😀");`,
      `return /\\u{1F600}+/u.exec("😀😀!");`,
      `return /\\p{L}+/u.exec("123 héllo");`,
      `return /\\w/iu.test("\\u017f");`,
      `return /\\b/iu.test("\\u017f");`,
      `return /[\\q{abc|d}]+/v.exec("abcdabc");`,
      `return /[\\p{RGI_Emoji}--\\q{😀}]/v.exec("😀👍");`,
      `return /[[a-z]&&[^aeiou]]+/v.exec("queue strength");`,
      `return /(?i:ab)c/.exec("ABc ABC");`,
      `return /\\udc00/u.exec("\\ud800\\udc00");`,
      `const r = /./ug; r.lastIndex = 1; return [r.exec("😀a"), r.lastIndex];`,
    ])
      same(expr);
  });

  it("keeps Annex B quirks for patterns without the u flag", () => {
    for (const expr of [
      `return /(a)\\10/.exec("a\\b");`,
      `return /\\12/.exec("\\n");`,
      `return /\\8/.exec("8");`,
      `return /\\c/.exec("\\\\c");`,
      `return /a{,2}/.exec("a{,2}");`,
      `return /x{1/.exec("x{1");`,
      `return /\\p{L}/.exec("p{L}");`,
      `return /]/.exec("]");`,
      `return /\\k<a>/.exec("k<a>");`,
      `return /\\x4/.exec("x4");`,
    ])
      same(expr);
  });

  it("tracks lastIndex, sticky and hasIndices like V8", () => {
    for (const expr of [
      `const r = /a/g; return [r.test("aa"), r.lastIndex, r.test("aa"), r.lastIndex, r.test("aa"), r.lastIndex];`,
      `const r = /b/y; r.lastIndex = 1; return [r.exec("ab"), r.lastIndex, r.exec("ab"), r.lastIndex];`,
      `const r = /a/; r.lastIndex = 5; return [r.exec("aa"), r.lastIndex];`,
      `return /(?<word>b+)(c)?/d.exec("abbd");`,
      `const r = Object.freeze(/a/g); try { r.exec("a"); return "no"; } catch (e) { return e instanceof TypeError; }`,
    ])
      same(expr);
  });

  it("implements the string methods and their substitution patterns", () => {
    for (const expr of [
      `return "abcabc".match(/b/g);`,
      `return "abc".match(/(b)/);`,
      `return "abc".match(/z/g);`,
      `return [..."a1b22c333".matchAll(/\\d+/g)];`,
      `return [..."😀😀".matchAll(/(?:)/gu)].map((m) => m.index);`,
      `return "abc".replace(/(b)/, "[$01|$1|$10|$2|$&|$\`|$'|$$|$]");`,
      `return "abc".replace(/(?<x>b)/, "[$<x>|$<y>|$<x]");`,
      `return "abc".replace(/b/, "$<x>");`,
      `return "aaa".replace(/a/g, (m, i, s) => m + i + s.length);`,
      `return "2026-09-17".replace(/(?<y>\\d+)-(?<m>\\d+)-(?<d>\\d+)/, (...args) => JSON.stringify(args.at(-1)));`,
      `return "x-x-x".replaceAll("x", "$&$&");`,
      `return "aaa".replaceAll("", "-");`,
      `return "a.b.c".replaceAll(/\\./g, "!");`,
      `try { "a".replaceAll(/a/, "b"); return "no"; } catch (e) { return e.name; }`,
      `try { "a".matchAll(/a/); return "no"; } catch (e) { return e.name; }`,
      `return "hello world".search(/o\\s/);`,
      `return "abc".split(/(b)/);`,
      `return "ab".split(/(?:)/u);`,
      `return "😀x".split(/(?:)/u);`,
      `return "test".split(/(?:)/, 2);`,
      `return "".split(/a/);`,
      `return "a, b,c".split(/\\s*,\\s*/);`,
      `return "a1b2c3".split(/\\d/, 2);`,
      `return "abc".split("");`,
      `return "a,b,,c".split(",", 3);`,
      `return "abc".replace({ [Symbol.replace](s, r) { return s + ":" + r; } }, "x");`,
      `return "aXbX".split({ [Symbol.split](s) { return s.toLowerCase(); } });`,
      `class R extends RegExp { exec(s) { return super.exec(s + "b"); } } return new R("ab").test("a");`,
    ])
      same(expr);
  });
});

describe("sandbox regular expressions on a budget", () => {
  const catastrophic = `return /^(a+)+$/.test("a".repeat(30) + "!");`;

  it("stops catastrophic backtracking at the deterministic interrupt limit", () => {
    const started = performance.now();
    expect(() => sandboxValue(catastrophic, true)).toThrow(InternalAbort);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("stops catastrophic backtracking at the live wall-clock budget", () => {
    const started = performance.now();
    expect(() => sandboxValue(`return /(x+x+)+y/.test("x".repeat(40));`, false)).toThrow(/took too long/);
    expect(performance.now() - started).toBeLessThan(LIVE_BUDGET_MS * 6);
  });

  it("can't be caught by the script", () => {
    expect(() => sandboxValue(`try { /^(a|aa)+$/.test("a".repeat(60) + "!"); } catch { return "caught"; } return "done";`, true)).toThrow(InternalAbort);
  });

  it("stops polynomial blowups too, through String methods", () => {
    expect(() => sandboxValue(`return "a".repeat(20000).replace(/a*a*a*b/g, "");`, true)).toThrow(/took too long/);
    expect(() => sandboxValue(`return "a".repeat(20000).split(/a*a*a*b/).length;`, false)).toThrow(/took too long/);
  });

  it("keeps ordinary patterns fast", () => {
    expect(sandboxValue(`const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/; let n = 0; for (let i = 0; i < 1000; i++) if (re.test("user" + i + "@example.com")) n++; return n;`)).toBe(1000);
    expect(sandboxValue(`return "hello world, ".repeat(2000).match(/\\w+/g).length;`)).toBe(4000);
  });
});
