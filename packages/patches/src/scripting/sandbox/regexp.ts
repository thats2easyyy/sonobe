/**
 * Regular expressions for scripts, on the realm's budget.
 *
 * V8 backtracks inside one native call that nothing can interrupt, so a catastrophic pattern
 * (`/^(a+)+$/` against "aaaa…!") would freeze the editor for minutes. Scripts run patterns through
 * this backtracking matcher instead. It charges the budget as it steps, so a runaway match stops with
 * "The script took too long." like any runaway loop, and its backtracking memory is capped.
 *
 * The matcher owns the control structure (alternation, quantifiers, groups, lookaround,
 * backreferences) and asks V8 only about one character at a time: every class, escape, dot, or
 * case-insensitive letter compiles to a tiny sticky RegExp tested at a single position, which takes
 * constant time. Character semantics (case folding, Unicode properties, `v`-mode set operations,
 * Annex B quirks) therefore stay identical to V8.
 *
 * V8 validated the pattern when the RegExp object was created, so the parser assumes valid syntax.
 * Scripts see replacements for RegExp.prototype exec, test, @@match, @@matchAll, @@replace, @@search
 * and @@split, and for the String.prototype methods that dispatch to them.
 */

import { ACTIVE, InternalAbort, MAX_STRING_LENGTH, callValue, constructValue, getProp, isConstructor, isObjectLike, setProp } from "./realm.ts";

const HostRegExp = RegExp;
const HostReflect = Reflect;
const regexpProto = RegExp.prototype;
const hostSplit = String.prototype.split;

/** Matcher steps between interrupt checks. */
export const REGEXP_STEPS_PER_TICK = 4;
/** Backtracking stack plus undo trail, in slots. */
export const MAX_REGEXP_BACKTRACK = 8_000_000;
/** Longest string a `v`-mode class like `[\p{RGI_Emoji}]` is tried against. */
const CLASS_STRING_MAX = 64;
const STRING_PROPERTY = /\\p\{(?:Basic_Emoji|Emoji_Keycap_Sequence|RGI_Emoji(?:_[A-Za-z_]+)?)\}/;
const RESULT_SLOT_BYTES = 16;
const STRING_ITEM_BYTES = 32;

function getter(name: string): Function | null {
  return HostReflect.getOwnPropertyDescriptor(regexpProto, name)?.get ?? null;
}

const sourceGetter = getter("source")!;
const FLAG_GETTERS: readonly [string, Function][] = (
  [
    ["d", "hasIndices"],
    ["g", "global"],
    ["i", "ignoreCase"],
    ["m", "multiline"],
    ["s", "dotAll"],
    ["u", "unicode"],
    ["v", "unicodeSets"],
    ["y", "sticky"],
  ] as const
).flatMap(([flag, name]) => {
  const get = getter(name);
  return get ? [[flag, get] as [string, Function]] : [];
});

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isOctal = (c: string | undefined) => c !== undefined && c >= "0" && c <= "7";
const isLineTerminator = (code: number) => code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;

function isHex(src: string, at: number, count: number): boolean {
  for (let k = 0; k < count; k++) {
    const c = src.charCodeAt(at + k);
    const hex = (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
    if (!hex) return false;
  }
  return true;
}

function tick(): void {
  ACTIVE.realm?.tick();
}

function chargeMemory(bytes: number): void {
  ACTIVE.realm?.chargeMemory(bytes);
}

function unsupported(): SyntaxError {
  return new SyntaxError("Scripts can't run this regular expression. Try writing the pattern another way.");
}

// ---------------------------------------------------------------------------
// Host atoms: single-character matchers
// ---------------------------------------------------------------------------

const atomCache = new Map<string, RegExp>();

function hostAtom(source: string, flags: string): RegExp {
  const key = `${flags}/${source}`;
  let re = atomCache.get(key);
  if (!re) {
    re = new HostRegExp(source, flags);
    if (atomCache.size > 1024) atomCache.clear();
    atomCache.set(key, re);
  }
  return re;
}

const SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

function escapeLiteral(text: string): string {
  return text.replace(SYNTAX, "\\$&");
}

function decodeName(raw: string): string {
  return raw.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_m, a: string | undefined, b: string | undefined) => String.fromCodePoint(parseInt(a ?? b ?? "0", 16)));
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface Mods {
  i: boolean;
  m: boolean;
  s: boolean;
}

type Node =
  | { t: "seq"; items: Node[] }
  | { t: "alt"; alts: Node[] }
  | { t: "char"; code: number }
  | { t: "atom"; re: RegExp; full: RegExp | null; maxLen: number }
  | { t: "bol"; m: boolean }
  | { t: "eol"; m: boolean }
  | { t: "word"; re: RegExp }
  | { t: "group"; index: number; body: Node }
  | { t: "look"; behind: boolean; negate: boolean; body: Node }
  | { t: "backref"; groups: number[]; icase: boolean; flags: string }
  | { t: "repeat"; min: number; max: number; greedy: boolean; body: Node; capFrom: number; capTo: number };

const BRACE = /\{(\d+)(?:(,)(\d*))?\}/y;

/** Capture group names by group number (index 0 is the whole match). */
function scanGroups(src: string, v: boolean): (string | undefined)[] {
  const names: (string | undefined)[] = [undefined];
  let inClass = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass--;
      else if (v && c === "[") inClass++;
      continue;
    }
    if (c === "[") {
      inClass = 1;
      continue;
    }
    if (c !== "(") continue;
    if (src[i + 1] !== "?") names.push(undefined);
    else if (src[i + 2] === "<" && src[i + 3] !== "=" && src[i + 3] !== "!") names.push(decodeName(src.slice(i + 3, src.indexOf(">", i))));
  }
  return names;
}

class Parser {
  readonly src: string;
  readonly u: boolean;
  readonly v: boolean;
  readonly groupNames: (string | undefined)[];
  readonly names = new Map<string, number[]>();
  i = 0;
  nextGroup = 0;

  constructor(src: string, u: boolean, v: boolean) {
    this.src = src;
    this.u = u;
    this.v = v;
    this.groupNames = scanGroups(src, v);
    this.groupNames.forEach((name, index) => {
      if (name === undefined) return;
      const list = this.names.get(name) ?? [];
      list.push(index);
      this.names.set(name, list);
    });
  }

  get groupCount(): number {
    return this.groupNames.length - 1;
  }

  parse(mods: Mods): Node {
    const node = this.disjunction(mods);
    if (this.i !== this.src.length) throw unsupported();
    return node;
  }

  private flagString(mods: Mods): string {
    return `${mods.i ? "i" : ""}${mods.m ? "m" : ""}${mods.s ? "s" : ""}${this.v ? "v" : this.u ? "u" : ""}`;
  }

  private disjunction(mods: Mods): Node {
    const alts = [this.alternative(mods)];
    while (this.src[this.i] === "|") {
      this.i++;
      alts.push(this.alternative(mods));
    }
    return alts.length === 1 ? alts[0]! : { t: "alt", alts };
  }

  private alternative(mods: Mods): Node {
    const items: Node[] = [];
    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if (c === "|" || c === ")") break;
      items.push(this.term(mods));
    }
    return items.length === 1 ? items[0]! : { t: "seq", items };
  }

  private expectClose(): void {
    if (this.src[this.i] !== ")") throw unsupported();
    this.i++;
  }

  private term(mods: Mods): Node {
    const src = this.src;
    const c = src[this.i];
    const g0 = this.nextGroup;
    if (c === "^") {
      this.i++;
      return { t: "bol", m: mods.m };
    }
    if (c === "$") {
      this.i++;
      return { t: "eol", m: mods.m };
    }
    if (c === "\\" && (src[this.i + 1] === "b" || src[this.i + 1] === "B")) {
      const text = src.slice(this.i, this.i + 2);
      this.i += 2;
      return { t: "word", re: hostAtom(text, `${this.flagString(mods)}y`) };
    }
    if (c === "(" && src[this.i + 1] === "?") {
      const k = src[this.i + 2];
      if (k === "=" || k === "!") {
        this.i += 3;
        const body = this.disjunction(mods);
        this.expectClose();
        const node: Node = { t: "look", behind: false, negate: k === "!", body };
        return this.u ? node : this.quantifier(node, g0);
      }
      if (k === "<" && (src[this.i + 3] === "=" || src[this.i + 3] === "!")) {
        const negate = src[this.i + 3] === "!";
        this.i += 4;
        const body = this.disjunction(mods);
        this.expectClose();
        return { t: "look", behind: true, negate, body };
      }
    }
    return this.quantifier(this.atom(mods), g0);
  }

  private quantifier(atom: Node, g0: number): Node {
    const src = this.src;
    const c = src[this.i];
    let min: number;
    let max: number;
    if (c === "*") {
      min = 0;
      max = Infinity;
      this.i++;
    } else if (c === "+") {
      min = 1;
      max = Infinity;
      this.i++;
    } else if (c === "?") {
      min = 0;
      max = 1;
      this.i++;
    } else if (c === "{") {
      BRACE.lastIndex = this.i;
      const m = BRACE.exec(src);
      if (!m) return atom;
      min = Number(m[1]);
      max = m[2] ? (m[3] ? Number(m[3]) : Infinity) : min;
      this.i += m[0].length;
    } else return atom;
    let greedy = true;
    if (src[this.i] === "?") {
      greedy = false;
      this.i++;
    }
    return { t: "repeat", min, max, greedy, body: atom, capFrom: g0 + 1, capTo: this.nextGroup + 1 };
  }

  private atomNode(text: string, mods: Mods, maxLen = 0): Node {
    const flags = this.flagString(mods);
    return { t: "atom", re: hostAtom(text, `${flags}y`), full: maxLen ? hostAtom(`^(?:${text})$`, flags) : null, maxLen };
  }

  private literal(text: string, mods: Mods): Node {
    if (!mods.i) {
      if (text.length === 2) return { t: "seq", items: [{ t: "char", code: text.charCodeAt(0) }, { t: "char", code: text.charCodeAt(1) }] };
      const code = text.charCodeAt(0);
      if (!this.u || !(isHigh(code) || isLow(code))) return { t: "char", code };
    }
    return this.atomNode(escapeLiteral(text), mods);
  }

  private atom(mods: Mods): Node {
    const src = this.src;
    const start = this.i;
    const c = src[start]!;
    if (c === ".") {
      this.i++;
      return this.atomNode(".", mods);
    }
    if (c === "[") {
      const end = this.classEnd(start);
      const text = src.slice(start, end);
      this.i = end;
      return this.atomNode(text, mods, this.classStrings(text));
    }
    if (c === "(") return this.group(mods);
    if (c === "\\") return this.escape(mods);
    const text = this.u && isHigh(src.charCodeAt(start)) && isLow(src.charCodeAt(start + 1)) ? src.slice(start, start + 2) : c;
    this.i += text.length;
    return this.literal(text, mods);
  }

  private classEnd(start: number): number {
    const src = this.src;
    let depth = 1;
    for (let j = start + 1; j < src.length; j++) {
      const c = src[j];
      if (c === "\\") j++;
      else if (this.v && c === "[") depth++;
      else if (c === "]" && --depth === 0) return j + 1;
    }
    throw unsupported();
  }

  /** The longest string a `v`-mode class can match (0 when it only matches single characters). */
  private classStrings(text: string): number {
    if (!this.v) return 0;
    let max = STRING_PROPERTY.test(text) ? CLASS_STRING_MAX : 0;
    for (let at = text.indexOf("\\q{"); at >= 0; at = text.indexOf("\\q{", at + 3)) {
      const close = text.indexOf("}", at);
      for (const piece of text.slice(at + 3, close < 0 ? text.length : close).split("|")) max = Math.max(max, piece.length, 1);
    }
    return max;
  }

  private group(mods: Mods): Node {
    const src = this.src;
    this.i++;
    if (src[this.i] === "?") {
      const k = src[this.i + 1];
      if (k === ":") {
        this.i += 2;
        const body = this.disjunction(mods);
        this.expectClose();
        return { t: "group", index: -1, body };
      }
      if (k === "<") {
        this.i = src.indexOf(">", this.i) + 1;
        const index = ++this.nextGroup;
        const body = this.disjunction(mods);
        this.expectClose();
        return { t: "group", index, body };
      }
      // Modifiers: (?ims-ims:...)
      const colon = src.indexOf(":", this.i);
      if (colon < 0) throw unsupported();
      const [add = "", remove = ""] = src.slice(this.i + 1, colon).split("-");
      const flag = (name: "i" | "m" | "s") => (add.includes(name) ? true : remove.includes(name) ? false : mods[name]);
      this.i = colon + 1;
      const body = this.disjunction({ i: flag("i"), m: flag("m"), s: flag("s") });
      this.expectClose();
      return { t: "group", index: -1, body };
    }
    const index = ++this.nextGroup;
    const body = this.disjunction(mods);
    this.expectClose();
    return { t: "group", index, body };
  }

  private backref(groups: number[], mods: Mods): Node {
    return { t: "backref", groups, icase: mods.i, flags: `${this.flagString(mods)}y` };
  }

  private escape(mods: Mods): Node {
    const src = this.src;
    const start = this.i;
    const c = src[start + 1] ?? "";
    const take = (length: number): Node => {
      this.i = start + length;
      return this.atomNode(src.slice(start, start + length), mods);
    };
    if (c >= "1" && c <= "9") {
      let j = start + 1;
      while (isDigit(src[j])) j++;
      const n = Number(src.slice(start + 1, j));
      if (this.u || n <= this.groupCount) {
        this.i = j;
        return this.backref([n], mods);
      }
      if (c === "8" || c === "9") {
        this.i = start + 2;
        return this.literal(c, mods);
      }
      return take(1 + octalLength(src, start + 1));
    }
    if (c === "0") return this.u ? take(2) : take(1 + octalLength(src, start + 1));
    if (c === "k" && (this.u || this.names.size > 0)) {
      const close = src.indexOf(">", start);
      this.i = close + 1;
      return this.backref(this.names.get(decodeName(src.slice(start + 3, close))) ?? [], mods);
    }
    if (c === "c") {
      if (/^[A-Za-z]$/.test(src[start + 2] ?? "")) return take(3);
      this.i = start + 1;
      return this.literal("\\", mods);
    }
    if (c === "x") {
      if (isHex(src, start + 2, 2)) return take(4);
      this.i = start + 2;
      return this.literal("x", mods);
    }
    if (c === "u") {
      if (this.u && src[start + 2] === "{") return take(src.indexOf("}", start) + 1 - start);
      if (isHex(src, start + 2, 4)) {
        const lead = parseInt(src.slice(start + 2, start + 6), 16);
        if (this.u && isHigh(lead) && src[start + 6] === "\\" && src[start + 7] === "u" && isHex(src, start + 8, 4) && isLow(parseInt(src.slice(start + 8, start + 12), 16))) return take(12);
        return take(6);
      }
      this.i = start + 2;
      return this.literal("u", mods);
    }
    if ((c === "p" || c === "P") && this.u) {
      const close = src.indexOf("}", start);
      const text = src.slice(start, close + 1);
      this.i = close + 1;
      return this.atomNode(text, mods, this.v && c === "p" && STRING_PROPERTY.test(text) ? CLASS_STRING_MAX : 0);
    }
    if (c !== "" && "dDsSwWfnrtv".includes(c)) return take(2);
    if (this.u) return take(2);
    this.i = start + 2;
    return this.literal(c, mods);
  }
}

function octalLength(src: string, at: number): number {
  if (!isOctal(src[at + 1])) return 1;
  if (src[at]! <= "3" && isOctal(src[at + 2])) return 3;
  return 2;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

const OP_CHAR = 1;
const OP_CHAR_B = 2;
const OP_ATOM = 3;
const OP_ATOM_B = 4;
const OP_STRS = 5;
const OP_STRS_B = 6;
const OP_BOL = 7;
const OP_EOL = 8;
const OP_WORD = 9;
const OP_SPLIT = 10;
const OP_JMP = 11;
const OP_SAVE = 12;
const OP_RESET = 13;
const OP_REG_ZERO = 14;
const OP_REG_POS = 15;
const OP_LOOP_GREEDY = 16;
const OP_LOOP_LAZY = 17;
const OP_LOOP_END = 18;
const OP_BACKREF = 19;
const OP_BACKREF_B = 20;
const OP_LOOK = 21;
const OP_GREEDY = 22;
const OP_LAZY = 23;
const OP_MATCH = 24;

interface Ins {
  op: number;
  a: number;
  b: number;
  c: number;
  d: number;
  re: RegExp | null;
  full: RegExp | null;
  s: string;
}

const ins = (op: number, a = 0, b = 0, c = 0, d = 0, re: RegExp | null = null, full: RegExp | null = null, s = ""): Ins => ({ op, a, b, c, d, re, full, s });

interface Program {
  code: Ins[];
  subs: Ins[][];
  lists: number[][];
  /** Capture slots / 2, including the whole match. */
  ncap: number;
  nreg: number;
  u: boolean;
  names: (string | undefined)[];
  hasNamed: boolean;
  /** Starts with ^ outside multiline mode: only position 0 can match. */
  anchored: boolean;
  /** A literal first character to scan for, or "". */
  first: string;
}

function compileProgram(source: string, flags: string): Program {
  const u = flags.includes("u") || flags.includes("v");
  const parser = new Parser(source, u, flags.includes("v"));
  const root = parser.parse({ i: flags.includes("i"), m: flags.includes("m"), s: flags.includes("s") });
  const prog: Program = { code: [], subs: [], lists: [], ncap: parser.groupNames.length, nreg: 0, u, names: parser.groupNames, hasNamed: parser.names.size > 0, anchored: false, first: "" };
  const emit = (code: Ins[], node: Node, dir: 1 | -1): void => {
    switch (node.t) {
      case "seq":
        for (const item of dir === 1 ? node.items : [...node.items].reverse()) emit(code, item, dir);
        return;
      case "alt": {
        const jumps: Ins[] = [];
        node.alts.forEach((alt, k) => {
          if (k === node.alts.length - 1) {
            emit(code, alt, dir);
            return;
          }
          const split = ins(OP_SPLIT);
          code.push(split);
          emit(code, alt, dir);
          const jump = ins(OP_JMP);
          code.push(jump);
          jumps.push(jump);
          split.a = code.length;
        });
        for (const jump of jumps) jump.a = code.length;
        return;
      }
      case "char":
        code.push(ins(dir === 1 ? OP_CHAR : OP_CHAR_B, node.code));
        return;
      case "atom":
        if (node.full) code.push(ins(dir === 1 ? OP_STRS : OP_STRS_B, 0, node.maxLen, 0, dir, null, node.full));
        else code.push(ins(dir === 1 ? OP_ATOM : OP_ATOM_B, 0, 0, 0, dir, node.re));
        return;
      case "bol":
        code.push(ins(OP_BOL, node.m ? 1 : 0));
        return;
      case "eol":
        code.push(ins(OP_EOL, node.m ? 1 : 0));
        return;
      case "word":
        code.push(ins(OP_WORD, 0, 0, 0, 0, node.re));
        return;
      case "group": {
        if (node.index < 0) {
          emit(code, node.body, dir);
          return;
        }
        const open = 2 * node.index;
        code.push(ins(OP_SAVE, dir === 1 ? open : open + 1));
        emit(code, node.body, dir);
        code.push(ins(OP_SAVE, dir === 1 ? open + 1 : open));
        return;
      }
      case "look": {
        const sub: Ins[] = [];
        emit(sub, node.body, node.behind ? -1 : 1);
        sub.push(ins(OP_MATCH));
        prog.subs.push(sub);
        code.push(ins(OP_LOOK, prog.subs.length - 1, node.negate ? 1 : 0));
        return;
      }
      case "backref":
        prog.lists.push(node.groups);
        code.push(ins(dir === 1 ? OP_BACKREF : OP_BACKREF_B, prog.lists.length - 1, 0, node.icase ? 1 : 0, dir, null, null, node.flags));
        return;
      case "repeat": {
        const { min, max, greedy, body } = node;
        if (max === 0) return;
        const simple = (body.t === "char" || (body.t === "atom" && !body.full)) && node.capFrom === node.capTo;
        if (min === 1 && max === 1) {
          emit(code, body, dir);
          return;
        }
        if (simple) {
          const atom = body.t === "char" ? ins(0, 0, 0, body.code, dir) : ins(0, 0, 0, -1, dir, body.re);
          atom.op = greedy ? OP_GREEDY : OP_LAZY;
          atom.a = min;
          atom.b = max;
          code.push(atom);
          return;
        }
        const count = prog.nreg++;
        const startReg = prog.nreg++;
        code.push(ins(OP_REG_ZERO, count));
        const loop = code.length;
        const decide = ins(greedy ? OP_LOOP_GREEDY : OP_LOOP_LAZY, count, min, max);
        code.push(decide);
        code.push(ins(OP_REG_POS, startReg));
        if (node.capFrom < node.capTo) code.push(ins(OP_RESET, 2 * node.capFrom, 2 * node.capTo));
        emit(code, body, dir);
        code.push(ins(OP_LOOP_END, count, startReg, min, loop));
        decide.d = code.length;
        return;
      }
    }
  };
  prog.code.push(ins(OP_SAVE, 0));
  emit(prog.code, root, 1);
  prog.code.push(ins(OP_SAVE, 1), ins(OP_MATCH));
  const first = prog.code[1]!;
  prog.anchored = first.op === OP_BOL && first.a === 0;
  if (first.op === OP_CHAR) prog.first = String.fromCharCode(first.a);
  return prog;
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

function atomForward(re: RegExp, input: string, p: number): number {
  if (p >= input.length) return -1;
  re.lastIndex = p;
  return re.test(input) ? re.lastIndex : -1;
}

function atomBackward(re: RegExp, input: string, p: number, u: boolean): number {
  if (p <= 0) return -1;
  let start = p - 1;
  if (u && start > 0 && isLow(input.charCodeAt(start)) && isHigh(input.charCodeAt(start - 1))) start--;
  re.lastIndex = start;
  return re.test(input) && re.lastIndex === p ? start : -1;
}

const stepBack = (input: string, p: number, u: boolean) => p - (u && p >= 2 && isLow(input.charCodeAt(p - 1)) && isHigh(input.charCodeAt(p - 2)) ? 2 : 1);
const stepForward = (input: string, p: number, u: boolean) => p + (u && isHigh(input.charCodeAt(p)) && isLow(input.charCodeAt(p + 1)) ? 2 : 1);

/** AdvanceStringIndex. */
export function advanceIndex(input: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= input.length) return index + 1;
  return isHigh(input.charCodeAt(index)) && isLow(input.charCodeAt(index + 1)) ? index + 2 : index + 1;
}

const literalCache = new Map<string, RegExp>();

function literalRegExp(text: string, flags: string): RegExp {
  const key = `${flags}/${text}`;
  let re = literalCache.get(key);
  if (!re) {
    re = new HostRegExp(escapeLiteral(text), flags);
    if (literalCache.size > 256) literalCache.clear();
    literalCache.set(key, re);
  }
  return re;
}

class Matcher {
  readonly prog: Program;
  readonly caps: number[];
  private readonly regs: number[];
  private readonly trail: number[] = [];
  private readonly stack: number[] = [];
  private input = "";
  private fuel = REGEXP_STEPS_PER_TICK;

  constructor(prog: Program) {
    this.prog = prog;
    this.caps = new Array<number>(prog.ncap * 2).fill(-1);
    this.regs = new Array<number>(prog.nreg).fill(0);
  }

  private reset(): void {
    this.caps.fill(-1);
    this.regs.fill(0);
    this.trail.length = 0;
    this.stack.length = 0;
  }

  /** Match starting exactly at `pos` (sticky). */
  matchAt(input: string, pos: number): boolean {
    this.input = input;
    this.reset();
    return this.run(this.prog.code, pos) >= 0;
  }

  /** The first match at or after `from`. */
  search(input: string, from: number): boolean {
    this.input = input;
    const prog = this.prog;
    const length = input.length;
    for (let p = from; p <= length; ) {
      if (prog.anchored && p > 0) return false;
      if (prog.first) {
        const at = input.indexOf(prog.first, p);
        if (at < 0) return false;
        p = at;
      }
      this.reset();
      if (this.run(prog.code, p) >= 0) return true;
      this.step();
      p = advanceIndex(input, p, prog.u);
    }
    return false;
  }

  private step(): void {
    if (--this.fuel <= 0) {
      this.fuel = REGEXP_STEPS_PER_TICK;
      tick();
    }
  }

  private push(pc: number, pos: number, extra: number): void {
    const stack = this.stack;
    stack.push(pc, pos, this.trail.length, extra);
    if (stack.length + this.trail.length > MAX_REGEXP_BACKTRACK) throw new InternalAbort("memory");
  }

  private unwind(mark: number): void {
    const { trail, caps, regs } = this;
    while (trail.length > mark) {
      const value = trail.pop()!;
      const key = trail.pop()!;
      if (key >= 0) caps[key] = value;
      else regs[-key - 1] = value;
    }
  }

  private atomStep(i: Ins, p: number): number {
    const input = this.input;
    if (i.c >= 0) {
      if (i.d === 1) return p < input.length && input.charCodeAt(p) === i.c ? p + 1 : -1;
      return p > 0 && input.charCodeAt(p - 1) === i.c ? p - 1 : -1;
    }
    return i.d === 1 ? atomForward(i.re!, input, p) : atomBackward(i.re!, input, p, this.prog.u);
  }

  /** Positions a string-capable class can reach from `p`, longest match first. */
  private strings(i: Ins, p: number): number[] {
    const input = this.input;
    const full = i.full!;
    const out: number[] = [];
    if (i.d === 1) {
      for (let k = Math.min(i.b, input.length - p); k >= 1; k--) {
        const end = p + k;
        if (isLow(input.charCodeAt(end)) && isHigh(input.charCodeAt(end - 1))) continue;
        this.step();
        if (full.test(input.slice(p, end))) out.push(end);
      }
    } else {
      for (let k = Math.min(i.b, p); k >= 1; k--) {
        const start = p - k;
        if (start > 0 && isLow(input.charCodeAt(start)) && isHigh(input.charCodeAt(start - 1))) continue;
        this.step();
        if (full.test(input.slice(start, p))) out.push(start);
      }
    }
    return out;
  }

  private backref(i: Ins, pos: number): number {
    const caps = this.caps;
    let group = -1;
    for (const n of this.prog.lists[i.a]!) {
      if (caps[2 * n]! >= 0 && caps[2 * n + 1]! >= 0) {
        group = n;
        break;
      }
    }
    if (group < 0) return pos;
    const start = caps[2 * group]!;
    const end = caps[2 * group + 1]!;
    const length = end - start;
    if (length === 0) return pos;
    const input = this.input;
    const text = input.slice(start, end);
    if (i.d === 1) {
      if (pos + length > input.length) return -1;
      if (!i.c) return input.startsWith(text, pos) ? pos + length : -1;
      const re = literalRegExp(text, i.s);
      re.lastIndex = pos;
      return re.test(input) ? re.lastIndex : -1;
    }
    if (pos - length < 0) return -1;
    if (!i.c) return input.startsWith(text, pos - length) ? pos - length : -1;
    const re = literalRegExp(text, i.s);
    re.lastIndex = pos - length;
    return re.test(input) && re.lastIndex === pos ? pos - length : -1;
  }

  /** Run `code` from `startPos`: the end position, or -1. Lookaround bodies reuse the stack above their base. */
  private run(code: readonly Ins[], startPos: number): number {
    const { input, caps, regs, stack, trail } = this;
    const length = input.length;
    const u = this.prog.u;
    const base = stack.length;
    let pc = 0;
    let pos = startPos;
    for (;;) {
      if (--this.fuel <= 0) {
        this.fuel = REGEXP_STEPS_PER_TICK;
        tick();
      }
      const i = code[pc]!;
      let ok = true;
      switch (i.op) {
        case OP_CHAR:
          if (pos < length && input.charCodeAt(pos) === i.a) {
            pos++;
            pc++;
          } else ok = false;
          break;
        case OP_CHAR_B:
          if (pos > 0 && input.charCodeAt(pos - 1) === i.a) {
            pos--;
            pc++;
          } else ok = false;
          break;
        case OP_ATOM:
        case OP_ATOM_B: {
          const next = i.op === OP_ATOM ? atomForward(i.re!, input, pos) : atomBackward(i.re!, input, pos, u);
          if (next >= 0) {
            pos = next;
            pc++;
          } else ok = false;
          break;
        }
        case OP_STRS:
        case OP_STRS_B: {
          const options = this.strings(i, pos);
          if (!options.length) {
            ok = false;
            break;
          }
          for (let k = options.length - 1; k >= 1; k--) this.push(pc + 1, options[k]!, 0);
          pos = options[0]!;
          pc++;
          break;
        }
        case OP_BOL:
          if (pos === 0 || (i.a === 1 && isLineTerminator(input.charCodeAt(pos - 1)))) pc++;
          else ok = false;
          break;
        case OP_EOL:
          if (pos === length || (i.a === 1 && isLineTerminator(input.charCodeAt(pos)))) pc++;
          else ok = false;
          break;
        case OP_WORD: {
          const re = i.re!;
          re.lastIndex = pos;
          if (re.test(input)) pc++;
          else ok = false;
          break;
        }
        case OP_SPLIT:
          this.push(i.a, pos, 0);
          pc++;
          break;
        case OP_JMP:
          pc = i.a;
          break;
        case OP_SAVE:
          trail.push(i.a, caps[i.a]!);
          caps[i.a] = pos;
          pc++;
          break;
        case OP_RESET:
          for (let slot = i.a; slot < i.b; slot++) {
            if (caps[slot] !== -1) {
              trail.push(slot, caps[slot]!);
              caps[slot] = -1;
            }
          }
          pc++;
          break;
        case OP_REG_ZERO:
        case OP_REG_POS:
          trail.push(-i.a - 1, regs[i.a]!);
          regs[i.a] = i.op === OP_REG_ZERO ? 0 : pos;
          pc++;
          break;
        case OP_LOOP_GREEDY:
        case OP_LOOP_LAZY: {
          const n = regs[i.a]!;
          if (n < i.b) pc++;
          else if (n >= i.c) pc = i.d;
          else if (i.op === OP_LOOP_GREEDY) {
            this.push(i.d, pos, 0);
            pc++;
          } else {
            this.push(pc + 1, pos, 0);
            pc = i.d;
          }
          break;
        }
        case OP_LOOP_END: {
          const n = regs[i.a]!;
          if (n >= i.c && pos === regs[i.b]) ok = false;
          else {
            trail.push(-i.a - 1, n);
            regs[i.a] = n + 1;
            pc = i.d;
          }
          break;
        }
        case OP_BACKREF:
        case OP_BACKREF_B: {
          const next = this.backref(i, pos);
          if (next >= 0) {
            pos = next;
            pc++;
          } else ok = false;
          break;
        }
        case OP_LOOK: {
          const mark = trail.length;
          const matched = this.run(this.prog.subs[i.a]!, pos) >= 0;
          if (i.b === 0) {
            if (matched) pc++;
            else ok = false;
          } else if (matched) {
            this.unwind(mark);
            ok = false;
          } else pc++;
          break;
        }
        case OP_GREEDY: {
          let p = pos;
          let count = 0;
          let minEnd = i.a === 0 ? pos : -1;
          while (count < i.b) {
            if (--this.fuel <= 0) {
              this.fuel = REGEXP_STEPS_PER_TICK;
              tick();
            }
            const next = this.atomStep(i, p);
            if (next < 0) break;
            p = next;
            count++;
            if (count === i.a) minEnd = p;
          }
          if (count < i.a) {
            ok = false;
            break;
          }
          if (p !== minEnd) this.push(-pc - 1, p, minEnd);
          pos = p;
          pc++;
          break;
        }
        case OP_LAZY: {
          let p = pos;
          let count = 0;
          while (count < i.a) {
            if (--this.fuel <= 0) {
              this.fuel = REGEXP_STEPS_PER_TICK;
              tick();
            }
            const next = this.atomStep(i, p);
            if (next < 0) break;
            p = next;
            count++;
          }
          if (count < i.a) {
            ok = false;
            break;
          }
          if (count < i.b) this.push(-pc - 1, p, count);
          pos = p;
          pc++;
          break;
        }
        case OP_MATCH:
          stack.length = base;
          return pos;
        default:
          throw unsupported();
      }
      if (ok) continue;
      // Backtrack.
      for (;;) {
        if (stack.length === base) return -1;
        if (--this.fuel <= 0) {
          this.fuel = REGEXP_STEPS_PER_TICK;
          tick();
        }
        const extra = stack.pop()!;
        const mark = stack.pop()!;
        const p = stack.pop()!;
        const entry = stack.pop()!;
        this.unwind(mark);
        if (entry >= 0) {
          pc = entry;
          pos = p;
          break;
        }
        const loopPc = -entry - 1;
        const loop = code[loopPc]!;
        if (loop.op === OP_GREEDY) {
          const next = loop.d === 1 ? stepBack(input, p, u) : stepForward(input, p, u);
          if (next !== extra) stack.push(entry, next, mark, extra);
          pc = loopPc + 1;
          pos = next;
          break;
        }
        const next = this.atomStep(loop, p);
        if (next < 0) continue;
        if (extra + 1 < loop.b) stack.push(entry, next, mark, extra + 1);
        pc = loopPc + 1;
        pos = next;
        break;
      }
    }
  }
}

const matchers = new Map<string, Matcher>();

function matcherFor(source: string, flags: string): Matcher {
  const key = `${flags}/${source}`;
  let m = matchers.get(key);
  if (!m) {
    m = new Matcher(compileProgram(source, flags));
    if (matchers.size > 128) matchers.delete(matchers.keys().next().value!);
    matchers.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Abstract operations
// ---------------------------------------------------------------------------

/** The internal source and flags of a real RegExp object, or null. */
function regExpSlots(value: unknown): { source: string; flags: string } | null {
  if (!isObjectLike(value) || value === regexpProto) return null;
  let source: string;
  try {
    source = HostReflect.apply(sourceGetter, value, []) as string;
  } catch {
    return null;
  }
  let flags = "";
  for (const [flag, get] of FLAG_GETTERS) if (HostReflect.apply(get, value, [])) flags += flag;
  return { source, flags };
}

function toStr(value: unknown): string {
  return `${value as string}`;
}

function toLength(value: unknown): number {
  const n = Math.trunc(+(value as number));
  if (!(n > 0)) return 0;
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}

function toIntegerOrInfinity(value: unknown): number {
  const n = +(value as number);
  return Number.isNaN(n) ? 0 : Math.trunc(n);
}

function requireObject(value: unknown, method: string): object {
  if (!isObjectLike(value)) throw new TypeError(`${method} called on a non-object`);
  return value;
}

function getMethod(value: unknown, key: symbol): unknown {
  const fn = getProp(value, key);
  if (fn === undefined || fn === null) return undefined;
  if (typeof fn !== "function") throw new TypeError(`${key.description ?? "The method"} is not a function`);
  return fn;
}

function isRegExp(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  const matcher = getProp(value, Symbol.match);
  if (matcher !== undefined) return !!matcher;
  return regExpSlots(value) !== null;
}

let SAFE_REGEXP: Function = RegExp;

function speciesConstructor(o: object): Function {
  const C = getProp(o, "constructor");
  if (C === undefined) return SAFE_REGEXP;
  if (!isObjectLike(C)) throw new TypeError("The object's constructor property isn't an object");
  const S = getProp(C, Symbol.species);
  if (S === undefined || S === null) return SAFE_REGEXP;
  if (isConstructor(S)) return S as Function;
  throw new TypeError("The object's @@species isn't a constructor");
}

function checkLength(total: number): void {
  if (total > MAX_STRING_LENGTH) throw new InternalAbort("memory");
}

/** RegExpBuiltinExec. */
function builtinExec(R: object, S: string): unknown[] | null {
  const slots = regExpSlots(R);
  if (!slots) throw new TypeError("RegExp.prototype.exec called on an object that isn't a RegExp");
  const flags = slots.flags;
  const global = flags.includes("g");
  const sticky = flags.includes("y");
  const unicode = flags.includes("u") || flags.includes("v");
  let lastIndex = toLength(getProp(R, "lastIndex"));
  if (!global && !sticky) lastIndex = 0;
  const matcher = matcherFor(slots.source, flags);
  const length = S.length;
  if (lastIndex > length) {
    if (global || sticky) setProp(R, "lastIndex", 0);
    return null;
  }
  let start = lastIndex;
  if (unicode && start > 0 && start < length && isLow(S.charCodeAt(start)) && isHigh(S.charCodeAt(start - 1))) start--;
  const found = sticky ? matcher.matchAt(S, start) : matcher.search(S, start);
  if (!found) {
    if (global || sticky) setProp(R, "lastIndex", 0);
    return null;
  }
  const caps = matcher.caps;
  if (global || sticky) setProp(R, "lastIndex", caps[1]);
  const prog = matcher.prog;
  chargeMemory((prog.ncap + 4) * RESULT_SLOT_BYTES);
  const A: unknown[] = [];
  for (let n = 0; n < prog.ncap; n++) {
    const s = caps[2 * n]!;
    const e = caps[2 * n + 1]!;
    A.push(s < 0 || e < 0 ? undefined : S.slice(s, e));
  }
  const result = A as unknown[] & Record<string, unknown>;
  result.index = caps[0];
  result.input = S;
  const groupsOf = (values: readonly unknown[]): Record<string, unknown> | undefined => {
    if (!prog.hasNamed) return undefined;
    const groups = Object.create(null) as Record<string, unknown>;
    for (let n = 1; n < prog.ncap; n++) {
      const name = prog.names[n];
      if (name === undefined) continue;
      if (!(name in groups) || groups[name] === undefined) groups[name] = values[n];
    }
    return groups;
  };
  result.groups = groupsOf(A);
  if (flags.includes("d")) {
    const indices: unknown[] = [];
    for (let n = 0; n < prog.ncap; n++) {
      const s = caps[2 * n]!;
      const e = caps[2 * n + 1]!;
      indices.push(s < 0 || e < 0 ? undefined : [s, e]);
    }
    (indices as unknown[] & Record<string, unknown>).groups = groupsOf(indices);
    result.indices = indices;
  }
  return A;
}

/** RegExpExec: a script-defined exec wins over the built-in one. */
function regExpExec(R: object, S: string): unknown {
  const exec = getProp(R, "exec");
  if (exec === safeExec && regExpSlots(R)) return builtinExec(R, S);
  if (typeof exec === "function") {
    const result = callValue(exec, R, [S]);
    if (result !== null && !isObjectLike(result)) throw new TypeError("A RegExp exec method must return an object or null");
    return result;
  }
  return builtinExec(R, S);
}

function getSubstitution(matched: string, str: string, position: number, captures: readonly unknown[], namedCaptures: unknown, template: string): string {
  if (!template.includes("$")) return template;
  const stringLength = str.length;
  const m = captures.length;
  let result = "";
  let i = 0;
  while (i < template.length) {
    const c = template[i];
    if (c !== "$" || i + 1 >= template.length) {
      const next = template.indexOf("$", i + 1);
      const end = next < 0 ? template.length : next;
      result += template.slice(i, end);
      i = end;
      continue;
    }
    const k = template[i + 1]!;
    if (k === "$") {
      result += "$";
      i += 2;
    } else if (k === "`") {
      result += str.slice(0, position);
      i += 2;
    } else if (k === "&") {
      result += matched;
      i += 2;
    } else if (k === "'") {
      result += str.slice(Math.min(position + matched.length, stringLength));
      i += 2;
    } else if (isDigit(k)) {
      let digitCount = isDigit(template[i + 2]) ? 2 : 1;
      let index = Number(template.slice(i + 1, i + 1 + digitCount));
      if (index > m && digitCount === 2) {
        digitCount = 1;
        index = Number(k);
      }
      if (index >= 1 && index <= m) {
        const capture = captures[index - 1];
        if (capture !== undefined) result += capture as string;
      } else result += template.slice(i, i + 1 + digitCount);
      i += 1 + digitCount;
    } else if (k === "<") {
      const gtPos = template.indexOf(">", i);
      if (gtPos < 0 || namedCaptures === undefined) {
        result += "$<";
        i += 2;
      } else {
        const capture = getProp(namedCaptures, template.slice(i + 2, gtPos));
        if (capture !== undefined) result += toStr(capture);
        i = gtPos + 1;
      }
    } else {
      result += "$";
      i += 1;
    }
    checkLength(result.length);
  }
  return result;
}

// ---------------------------------------------------------------------------
// RegExp.prototype replacements
// ---------------------------------------------------------------------------

const named = <T extends Function>(fn: T, name: string, length: number): T => {
  Object.defineProperty(fn, "name", { value: name });
  Object.defineProperty(fn, "length", { value: length });
  return fn;
};

const safeExec = named(function (this: unknown, string: unknown) {
  if (!regExpSlots(this)) throw new TypeError("RegExp.prototype.exec called on an object that isn't a RegExp");
  return builtinExec(this as object, toStr(string));
}, "exec", 1);

const safeTest = named(function (this: unknown, string: unknown) {
  const R = requireObject(this, "RegExp.prototype.test");
  return regExpExec(R, toStr(string)) !== null;
}, "test", 1);

const safeMatch = named(function (this: unknown, string: unknown) {
  const rx = requireObject(this, "RegExp.prototype[Symbol.match]");
  const S = toStr(string);
  const flags = toStr(getProp(rx, "flags"));
  if (!flags.includes("g")) return regExpExec(rx, S);
  const fullUnicode = flags.includes("u") || flags.includes("v");
  setProp(rx, "lastIndex", 0);
  const A: string[] = [];
  for (;;) {
    const result = regExpExec(rx, S);
    if (result === null) return A.length === 0 ? null : A;
    const matchStr = toStr(getProp(result, "0"));
    A.push(matchStr);
    chargeMemory(STRING_ITEM_BYTES);
    if (matchStr === "") setProp(rx, "lastIndex", advanceIndex(S, toLength(getProp(rx, "lastIndex")), fullUnicode));
  }
}, "[Symbol.match]", 1);

interface StringIteratorState {
  R: object;
  S: string;
  global: boolean;
  fullUnicode: boolean;
  done: boolean;
}

const iteratorStates = new WeakMap<object, StringIteratorState>();
const IteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;
const regExpStringIteratorProto = Object.create(IteratorPrototype) as Record<PropertyKey, unknown>;
Object.defineProperty(regExpStringIteratorProto, "next", {
  value: named(function (this: unknown) {
    const state = isObjectLike(this) ? iteratorStates.get(this) : undefined;
    if (!state) throw new TypeError("RegExp String Iterator next called on an incompatible receiver");
    if (state.done) return { value: undefined, done: true };
    const match = regExpExec(state.R, state.S);
    if (match === null) {
      state.done = true;
      return { value: undefined, done: true };
    }
    if (!state.global) {
      state.done = true;
      return { value: match, done: false };
    }
    if (toStr(getProp(match, "0")) === "") setProp(state.R, "lastIndex", advanceIndex(state.S, toLength(getProp(state.R, "lastIndex")), state.fullUnicode));
    return { value: match, done: false };
  }, "next", 0),
  writable: true,
  configurable: true,
});
Object.defineProperty(regExpStringIteratorProto, Symbol.toStringTag, { value: "RegExp String Iterator", configurable: true });

const safeMatchAll = named(function (this: unknown, string: unknown) {
  const R = requireObject(this, "RegExp.prototype[Symbol.matchAll]");
  const S = toStr(string);
  const C = speciesConstructor(R);
  const flags = toStr(getProp(R, "flags"));
  const matcher = constructValue(C, [R, flags]) as object;
  setProp(matcher, "lastIndex", toLength(getProp(R, "lastIndex")));
  const iterator = Object.create(regExpStringIteratorProto) as object;
  iteratorStates.set(iterator, { R: matcher, S, global: flags.includes("g"), fullUnicode: flags.includes("u") || flags.includes("v"), done: false });
  return iterator;
}, "[Symbol.matchAll]", 1);

const safeReplace = named(function (this: unknown, string: unknown, replaceValue: unknown) {
  const rx = requireObject(this, "RegExp.prototype[Symbol.replace]");
  const S = toStr(string);
  const lengthS = S.length;
  const functionalReplace = typeof replaceValue === "function";
  const template = functionalReplace ? "" : toStr(replaceValue);
  const flags = toStr(getProp(rx, "flags"));
  const global = flags.includes("g");
  const fullUnicode = flags.includes("u") || flags.includes("v");
  if (global) setProp(rx, "lastIndex", 0);
  const results: unknown[] = [];
  for (;;) {
    const result = regExpExec(rx, S);
    if (result === null) break;
    results.push(result);
    chargeMemory(STRING_ITEM_BYTES);
    if (!global) break;
    if (toStr(getProp(result, "0")) === "") setProp(rx, "lastIndex", advanceIndex(S, toLength(getProp(rx, "lastIndex")), fullUnicode));
  }
  const parts: string[] = [];
  let total = 0;
  let nextSourcePosition = 0;
  for (const result of results) {
    const nCaptures = Math.max(toLength(getProp(result, "length")) - 1, 0);
    const matched = toStr(getProp(result, "0"));
    const position = Math.max(Math.min(toIntegerOrInfinity(getProp(result, "index")), lengthS), 0);
    const captures: unknown[] = [];
    for (let n = 1; n <= nCaptures; n++) {
      const capture = getProp(result, String(n));
      captures.push(capture === undefined ? undefined : toStr(capture));
    }
    let namedCaptures = getProp(result, "groups");
    let replacement: string;
    if (functionalReplace) {
      const args: unknown[] = [matched, ...captures, position, S];
      if (namedCaptures !== undefined) args.push(namedCaptures);
      replacement = toStr(callValue(replaceValue, undefined, args));
    } else {
      if (namedCaptures !== undefined) {
        if (namedCaptures === null) throw new TypeError("Cannot convert null to an object");
        namedCaptures = Object(namedCaptures);
      }
      replacement = getSubstitution(matched, S, position, captures, namedCaptures, template);
    }
    if (position >= nextSourcePosition) {
      parts.push(S.slice(nextSourcePosition, position), replacement);
      total += position - nextSourcePosition + replacement.length;
      checkLength(total);
      nextSourcePosition = position + matched.length;
    }
  }
  if (nextSourcePosition < lengthS) {
    total += lengthS - nextSourcePosition;
    checkLength(total);
    parts.push(S.slice(nextSourcePosition));
  }
  chargeMemory(total * 2);
  return parts.join("");
}, "[Symbol.replace]", 2);

const safeSearch = named(function (this: unknown, string: unknown) {
  const rx = requireObject(this, "RegExp.prototype[Symbol.search]");
  const S = toStr(string);
  const previousLastIndex = getProp(rx, "lastIndex");
  if (!Object.is(previousLastIndex, 0)) setProp(rx, "lastIndex", 0);
  const result = regExpExec(rx, S);
  const currentLastIndex = getProp(rx, "lastIndex");
  if (!Object.is(currentLastIndex, previousLastIndex)) setProp(rx, "lastIndex", previousLastIndex);
  return result === null ? -1 : getProp(result, "index");
}, "[Symbol.search]", 1);

const safeSplit = named(function (this: unknown, string: unknown, limit: unknown) {
  const rx = requireObject(this, "RegExp.prototype[Symbol.split]");
  const S = toStr(string);
  const C = speciesConstructor(rx);
  const flags = toStr(getProp(rx, "flags"));
  const unicodeMatching = flags.includes("u") || flags.includes("v");
  const newFlags = flags.includes("y") ? flags : `${flags}y`;
  const splitter = constructValue(C, [rx, newFlags]) as object;
  const A: unknown[] = [];
  const lim = limit === undefined ? 2 ** 32 - 1 : (limit as number) >>> 0;
  if (lim === 0) return A;
  const size = S.length;
  if (size === 0) {
    if (regExpExec(splitter, S) === null) A.push(S);
    return A;
  }
  const add = (value: unknown): boolean => {
    A.push(value);
    chargeMemory(STRING_ITEM_BYTES);
    return A.length === lim;
  };
  let p = 0;
  const slots = C === SAFE_REGEXP ? regExpSlots(splitter) : null;
  if (slots) {
    // The splitter is a fresh built-in RegExp nobody else can see: search instead of trying every position.
    const matcher = matcherFor(slots.source, slots.flags);
    let q = 0;
    while (q < size) {
      if (!matcher.search(S, q)) break;
      const caps = matcher.caps;
      const m = caps[0]!;
      if (m >= size) break;
      const e = Math.min(caps[1]!, size);
      if (e === p) {
        q = advanceIndex(S, m, unicodeMatching);
        continue;
      }
      const groups = caps.slice(2);
      if (add(S.slice(p, m))) return A;
      p = e;
      for (let n = 0; n < groups.length; n += 2) {
        const s = groups[n]!;
        const t = groups[n + 1]!;
        if (add(s < 0 || t < 0 ? undefined : S.slice(s, t))) return A;
      }
      q = p;
    }
    A.push(S.slice(p, size));
    return A;
  }
  let q = p;
  while (q < size) {
    setProp(splitter, "lastIndex", q);
    const z = regExpExec(splitter, S);
    if (z === null) {
      q = advanceIndex(S, q, unicodeMatching);
      continue;
    }
    const e = Math.min(toLength(getProp(splitter, "lastIndex")), size);
    if (e === p) {
      q = advanceIndex(S, q, unicodeMatching);
      continue;
    }
    if (add(S.slice(p, q))) return A;
    p = e;
    const numberOfCaptures = Math.max(toLength(getProp(z, "length")) - 1, 0);
    for (let n = 1; n <= numberOfCaptures; n++) if (add(getProp(z, String(n)))) return A;
    q = p;
  }
  A.push(S.slice(p, size));
  return A;
}, "[Symbol.split]", 2);

// ---------------------------------------------------------------------------
// String.prototype replacements
// ---------------------------------------------------------------------------

function requireCoercible(value: unknown, method: string): void {
  if (value === null || value === undefined) throw new TypeError(`String.prototype.${method} called on null or undefined`);
}

function regExpCreate(pattern: unknown, flags: string | undefined): object {
  return constructValue(SAFE_REGEXP, [pattern === undefined ? "" : toStr(pattern), flags ?? ""]) as object;
}

function invoke(target: object, key: symbol, args: unknown[]): unknown {
  return callValue(getProp(target, key), target, args);
}

/** Occurrences of `search` in `S` (0 for an empty search), stopping once `limit` is reached. */
function countOccurrences(S: string, search: string, limit: number): number {
  let count = 0;
  for (let at = S.indexOf(search); at >= 0 && count < limit; at = S.indexOf(search, at + search.length)) {
    count++;
    if ((count & 0xff) === 0) tick();
  }
  return count;
}

function replaceString(S: string, search: string, replaceValue: unknown, all: boolean): string {
  const functional = typeof replaceValue === "function";
  const template = functional ? "" : toStr(replaceValue);
  const advanceBy = Math.max(1, search.length);
  const positions: number[] = [];
  for (let at = S.indexOf(search); at >= 0; ) {
    positions.push(at);
    if (!all) break;
    if ((positions.length & 0x3ff) === 0) {
      chargeMemory(0x400 * 8);
      tick();
    }
    const next = at + advanceBy;
    at = next > S.length ? -1 : S.indexOf(search, next);
  }
  if (!positions.length) return S;
  const parts: string[] = [];
  let total = 0;
  let endOfLastMatch = 0;
  for (const position of positions) {
    const replacement = functional ? toStr(callValue(replaceValue, undefined, [search, position, S])) : getSubstitution(search, S, position, [], undefined, template);
    parts.push(S.slice(endOfLastMatch, position), replacement);
    total += position - endOfLastMatch + replacement.length;
    checkLength(total);
    endOfLastMatch = position + search.length;
  }
  if (endOfLastMatch < S.length) {
    parts.push(S.slice(endOfLastMatch));
    total += S.length - endOfLastMatch;
    checkLength(total);
  }
  chargeMemory(total * 2);
  return parts.join("");
}

const stringMatch = named(function (this: unknown, regexp: unknown) {
  requireCoercible(this, "match");
  if (regexp !== undefined && regexp !== null) {
    const matcher = getMethod(regexp, Symbol.match);
    if (matcher !== undefined) return callValue(matcher, regexp, [this]);
  }
  const S = toStr(this);
  return invoke(regExpCreate(regexp, undefined), Symbol.match, [S]);
}, "match", 1);

const stringMatchAll = named(function (this: unknown, regexp: unknown) {
  requireCoercible(this, "matchAll");
  if (regexp !== undefined && regexp !== null) {
    if (isRegExp(regexp)) {
      const flags = getProp(regexp, "flags");
      requireCoercible(flags, "matchAll");
      if (!toStr(flags).includes("g")) throw new TypeError("String.prototype.matchAll called with a non-global RegExp argument");
    }
    const matcher = getMethod(regexp, Symbol.matchAll);
    if (matcher !== undefined) return callValue(matcher, regexp, [this]);
  }
  const S = toStr(this);
  return invoke(regExpCreate(regexp, "g"), Symbol.matchAll, [S]);
}, "matchAll", 1);

const stringReplace = named(function (this: unknown, searchValue: unknown, replaceValue: unknown) {
  requireCoercible(this, "replace");
  if (searchValue !== undefined && searchValue !== null) {
    const replacer = getMethod(searchValue, Symbol.replace);
    if (replacer !== undefined) return callValue(replacer, searchValue, [this, replaceValue]);
  }
  const S = toStr(this);
  return replaceString(S, toStr(searchValue), replaceValue, false);
}, "replace", 2);

const stringReplaceAll = named(function (this: unknown, searchValue: unknown, replaceValue: unknown) {
  requireCoercible(this, "replaceAll");
  if (searchValue !== undefined && searchValue !== null) {
    if (isRegExp(searchValue)) {
      const flags = getProp(searchValue, "flags");
      requireCoercible(flags, "replaceAll");
      if (!toStr(flags).includes("g")) throw new TypeError("replaceAll must be called with a global RegExp");
    }
    const replacer = getMethod(searchValue, Symbol.replace);
    if (replacer !== undefined) return callValue(replacer, searchValue, [this, replaceValue]);
  }
  const S = toStr(this);
  return replaceString(S, toStr(searchValue), replaceValue, true);
}, "replaceAll", 2);

const stringSearch = named(function (this: unknown, regexp: unknown) {
  requireCoercible(this, "search");
  if (regexp !== undefined && regexp !== null) {
    const searcher = getMethod(regexp, Symbol.search);
    if (searcher !== undefined) return callValue(searcher, regexp, [this]);
  }
  const S = toStr(this);
  return invoke(regExpCreate(regexp, undefined), Symbol.search, [S]);
}, "search", 1);

const stringSplit = named(function (this: unknown, separator: unknown, limit: unknown) {
  requireCoercible(this, "split");
  if (separator !== undefined && separator !== null) {
    const splitter = getMethod(separator, Symbol.split);
    if (splitter !== undefined) return callValue(splitter, separator, [this, limit]);
  }
  const S = toStr(this);
  const lim = limit === undefined ? 2 ** 32 - 1 : (limit as number) >>> 0;
  const R = toStr(separator);
  if (lim === 0 || separator === undefined) return HostReflect.apply(hostSplit, S, [separator === undefined ? undefined : R, lim]);
  // Charge the pieces before V8 allocates them in one call.
  const upperBound = Math.min(lim, R.length === 0 ? S.length : Math.floor(S.length / R.length) + 1);
  const pieces = upperBound * STRING_ITEM_BYTES <= 1024 * 1024 || R.length === 0 ? upperBound : Math.min(lim, countOccurrences(S, R, lim) + 1);
  chargeMemory(pieces * STRING_ITEM_BYTES);
  ACTIVE.realm?.chargeWork(S.length);
  return HostReflect.apply(hostSplit, S, [R, lim]);
}, "split", 2);

/** Replace V8's RegExp matching for scripts (called while the realm builds its substitutes). */
export function installRegExpGuards(map: Map<unknown, unknown>, safeRegExp: Function): void {
  SAFE_REGEXP = safeRegExp;
  const proto = regexpProto as unknown as Record<PropertyKey, unknown>;
  map.set(proto.exec, safeExec);
  map.set(proto.test, safeTest);
  map.set(proto[Symbol.match], safeMatch);
  map.set(proto[Symbol.matchAll], safeMatchAll);
  map.set(proto[Symbol.replace], safeReplace);
  map.set(proto[Symbol.search], safeSearch);
  map.set(proto[Symbol.split], safeSplit);
  const sp = String.prototype as unknown as Record<string, unknown>;
  map.set(sp.match, stringMatch);
  map.set(sp.matchAll, stringMatchAll);
  map.set(sp.replace, stringReplace);
  map.set(sp.replaceAll, stringReplaceAll);
  map.set(sp.search, stringSearch);
  map.set(sp.split, stringSplit);
  map.set(Object.getPrototypeOf(/a/[Symbol.matchAll]("")), regExpStringIteratorProto);
  Object.defineProperty(safeRegExp, Symbol.species, {
    get: named(function (this: unknown) {
      return this;
    }, "get [Symbol.species]", 0),
    configurable: true,
  });
}
