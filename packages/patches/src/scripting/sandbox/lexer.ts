/**
 * JavaScript lexer shared by the sandbox parser and the static script header reader. Tokens carry
 * source offsets and a line-break flag for automatic semicolon insertion; `position` turns an offset
 * into a 1-based line and column.
 */

export type TokenType = "name" | "privateName" | "num" | "string" | "template" | "regex" | "punct" | "eof";

export interface Token {
  type: TokenType;
  /** Identifier or punctuator text, a string's cooked value, or the raw source of a number or regex. */
  value: string;
  start: number;
  end: number;
  /** A line break separates this token from the previous one. */
  nl: boolean;
  /** num: the value (a bigint for literals ending in `n`). */
  number?: number | bigint;
  /** regex: pattern and flags. */
  regex?: { pattern: string; flags: string };
  /** template chunk: cooked text (undefined when an escape is invalid), raw text, and whether it ends the literal. */
  cooked?: string | undefined;
  raw?: string;
  tail?: boolean;
  /** name: written with a unicode escape, so it never acts as a keyword. */
  escaped?: boolean;
  /** tokenize(): a template literal token that contained `${...}` substitutions. */
  hasSubstitutions?: boolean;
}

/** A syntax problem with a 1-based line and column. */
export class ScriptSyntaxError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = "SyntaxError";
    this.line = line;
    this.column = column;
  }
}

const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>",
  "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "?", ":", "=", ".", "@",
];

const PUNCT_BY_FIRST = new Map<string, string[]>();
for (const p of PUNCTUATORS) {
  const list = PUNCT_BY_FIRST.get(p[0]!) ?? [];
  list.push(p);
  PUNCT_BY_FIRST.set(p[0]!, list);
}
for (const list of PUNCT_BY_FIRST.values()) list.sort((a, b) => b.length - a.length);

const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$‌‍]/u;

const isLineTerminator = (c: number) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isHex = (c: number) => isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);

function isIdStart(cp: number): boolean {
  if (cp < 128) return (cp >= 97 && cp <= 122) || (cp >= 65 && cp <= 90) || cp === 36 || cp === 95;
  return ID_START.test(String.fromCodePoint(cp));
}

function isIdContinue(cp: number): boolean {
  if (cp < 128) return (cp >= 97 && cp <= 122) || (cp >= 65 && cp <= 90) || isDigit(cp) || cp === 36 || cp === 95;
  return ID_CONTINUE.test(String.fromCodePoint(cp));
}

function isWhitespace(c: number): boolean {
  return c === 9 || c === 11 || c === 12 || c === 32 || c === 0xa0 || c === 0xfeff || (c > 127 && /\s/.test(String.fromCharCode(c)) && !isLineTerminator(c));
}

export class Lexer {
  readonly src: string;
  pos = 0;
  private lineStarts: number[] | null = null;

  constructor(src: string) {
    this.src = src;
    if (src.startsWith("#!")) {
      let i = 2;
      while (i < src.length && !isLineTerminator(src.charCodeAt(i))) i++;
      this.pos = i;
    }
  }

  /** 1-based line and column of an offset. */
  position(offset: number): { line: number; column: number } {
    if (!this.lineStarts) {
      const starts = [0];
      const s = this.src;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 13 && s.charCodeAt(i + 1) === 10) continue;
        if (isLineTerminator(c)) starts.push(i + 1);
      }
      this.lineStarts = starts;
    }
    const starts = this.lineStarts;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo]! + 1 };
  }

  error(message: string, offset: number): never {
    const { line, column } = this.position(offset);
    throw new ScriptSyntaxError(message, line, column);
  }

  /** Skip whitespace and comments; returns whether a line break was crossed. */
  private skipSpace(): boolean {
    const s = this.src;
    let nl = false;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (isLineTerminator(c)) {
        nl = true;
        this.pos++;
      } else if (c === 47 && s.charCodeAt(this.pos + 1) === 47) {
        this.pos += 2;
        while (this.pos < s.length && !isLineTerminator(s.charCodeAt(this.pos))) this.pos++;
      } else if (c === 47 && s.charCodeAt(this.pos + 1) === 42) {
        const end = s.indexOf("*/", this.pos + 2);
        if (end < 0) this.error("This comment never ends. Add */ to close it.", this.pos);
        for (let i = this.pos + 2; i < end; i++) if (isLineTerminator(s.charCodeAt(i))) nl = true;
        this.pos = end + 2;
      } else if (isWhitespace(c)) {
        this.pos++;
      } else break;
    }
    return nl;
  }

  /** Scan the next token. A `/` scans as a punctuator; the parser rescans it with {@link rescanRegex}. */
  next(): Token {
    const nl = this.skipSpace();
    const s = this.src;
    const start = this.pos;
    if (start >= s.length) return { type: "eof", value: "", start, end: start, nl };
    const c = s.charCodeAt(start);
    if (c === 96) {
      this.pos++;
      return this.readTemplateChunk(start, nl);
    }
    if (c === 34 || c === 39) return this.readString(c, start, nl);
    if (isDigit(c) || (c === 46 && isDigit(s.charCodeAt(start + 1)))) return this.readNumber(start, nl);
    if (c === 35) {
      this.pos++;
      const name = this.readIdentifierName();
      if (!name) this.error('Unexpected "#".', start);
      return { type: "privateName", value: name.name, start, end: this.pos, nl };
    }
    const cp = s.codePointAt(start)!;
    if (isIdStart(cp) || c === 92) {
      const name = this.readIdentifierName()!;
      const token: Token = { type: "name", value: name.name, start, end: this.pos, nl };
      if (name.escaped) token.escaped = true;
      return token;
    }
    const candidates = PUNCT_BY_FIRST.get(s[start]!);
    if (candidates) {
      for (const p of candidates) {
        if (!s.startsWith(p, start)) continue;
        if (p === "?." && isDigit(s.charCodeAt(start + 2))) continue;
        this.pos = start + p.length;
        return { type: "punct", value: p, start, end: this.pos, nl };
      }
    }
    this.error(`Unexpected character "${String.fromCodePoint(cp)}".`, start);
  }

  /** Rescan a `/` or `/=` token as a regular expression literal. */
  rescanRegex(token: Token): Token {
    const s = this.src;
    let i = token.start + 1;
    let inClass = false;
    for (;;) {
      if (i >= s.length || isLineTerminator(s.charCodeAt(i))) this.error("This regular expression never ends. Add a closing /.", token.start);
      const ch = s[i]!;
      if (ch === "\\") i += 2;
      else {
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        i++;
      }
    }
    const pattern = s.slice(token.start + 1, i);
    i++;
    const flagsStart = i;
    while (i < s.length && isIdContinue(s.codePointAt(i)!)) i++;
    const flags = s.slice(flagsStart, i);
    try {
      new RegExp(pattern, flags);
    } catch (err) {
      this.error(`Invalid regular expression /${pattern}/${flags}: ${err instanceof Error ? err.message.replace(/^Invalid regular expression: /, "") : String(err)}`, token.start);
    }
    this.pos = i;
    return { type: "regex", value: s.slice(token.start, i), start: token.start, end: i, nl: token.nl, regex: { pattern, flags } };
  }

  /** Continue a template literal after `${ expression }`; `closeBrace` is the `}` token. */
  continueTemplate(closeBrace: Token): Token {
    this.pos = closeBrace.end;
    return this.readTemplateChunk(closeBrace.start, false);
  }

  private readIdentifierName(): { name: string; escaped: boolean } | null {
    const s = this.src;
    let name = "";
    let escaped = false;
    let first = true;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      let cp: number;
      if (c === 92) {
        if (s[this.pos + 1] !== "u") this.error("Unexpected \\ in an identifier.", this.pos);
        const at = this.pos;
        this.pos += 2;
        cp = this.readUnicodeEscape(at);
        if (!(first ? isIdStart(cp) : isIdContinue(cp))) this.error("Invalid character escape in an identifier.", at);
        escaped = true;
      } else {
        cp = s.codePointAt(this.pos)!;
        if (!(first ? isIdStart(cp) : isIdContinue(cp))) break;
        this.pos += cp > 0xffff ? 2 : 1;
      }
      name += String.fromCodePoint(cp);
      first = false;
    }
    return name ? { name, escaped } : null;
  }

  /** After `\u`: `XXXX` or `{X...}`. */
  private readUnicodeEscape(at: number): number {
    const s = this.src;
    if (s[this.pos] === "{") {
      const end = s.indexOf("}", this.pos);
      const hex = end < 0 ? "" : s.slice(this.pos + 1, end);
      if (!/^[0-9a-fA-F]+$/.test(hex) || parseInt(hex, 16) > 0x10ffff) this.error("Invalid Unicode escape.", at);
      this.pos = end + 1;
      return parseInt(hex, 16);
    }
    const hex = s.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error("Invalid Unicode escape.", at);
    this.pos += 4;
    return parseInt(hex, 16);
  }

  private readString(quote: number, start: number, nl: boolean): Token {
    const s = this.src;
    this.pos++;
    let out = "";
    let chunk = this.pos;
    for (;;) {
      if (this.pos >= s.length) this.error("This string never ends. Add a closing quote.", start);
      const c = s.charCodeAt(this.pos);
      if (c === quote) break;
      if (c === 92) {
        out += s.slice(chunk, this.pos);
        const escaped = this.readEscape(false);
        if (escaped === undefined) this.error("Invalid escape sequence in a string.", this.pos);
        out += escaped;
        chunk = this.pos;
      } else if (c === 10 || c === 13) {
        this.error("This string never ends. Add a closing quote before the line break.", start);
      } else this.pos++;
    }
    out += s.slice(chunk, this.pos);
    this.pos++;
    return { type: "string", value: out, start, end: this.pos, nl };
  }

  /** Read an escape starting at `\`; undefined for an invalid escape (templates keep going). */
  private readEscape(inTemplate: boolean): string | undefined {
    const s = this.src;
    const at = this.pos;
    this.pos++;
    const ch = s[this.pos];
    if (ch === undefined) this.error("Unexpected end of input after \\.", at);
    this.pos++;
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "v":
        return "\v";
      case "\r":
        if (s[this.pos] === "\n") this.pos++;
        return "";
      case "\n":
      case " ":
      case " ":
        return "";
      case "x": {
        const hex = s.slice(this.pos, this.pos + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) return undefined;
        this.pos += 2;
        return String.fromCharCode(parseInt(hex, 16));
      }
      case "u": {
        const save = this.pos;
        try {
          return String.fromCodePoint(this.readUnicodeEscape(at));
        } catch (err) {
          if (!inTemplate) throw err;
          this.pos = save;
          return undefined;
        }
      }
      case "0":
        if (!isDigit(s.charCodeAt(this.pos))) return "\0";
        if (inTemplate) return undefined;
        this.error("Octal escapes aren't allowed. Use \\x or \\u escapes instead.", at);
      // falls through (unreachable)
      default:
        if (isDigit(ch.charCodeAt(0))) {
          if (inTemplate) return undefined;
          this.error("Octal escapes aren't allowed. Use \\x or \\u escapes instead.", at);
        }
        return ch;
    }
  }

  private readTemplateChunk(start: number, nl: boolean): Token {
    const s = this.src;
    let cooked: string | undefined = "";
    let chunk = this.pos;
    const rawStart = this.pos;
    for (;;) {
      if (this.pos >= s.length) this.error("This template literal never ends. Add a closing backtick.", start);
      const c = s.charCodeAt(this.pos);
      if (c === 96 || (c === 36 && s.charCodeAt(this.pos + 1) === 123)) {
        const tail = c === 96;
        if (cooked !== undefined) cooked += s.slice(chunk, this.pos);
        const raw = s.slice(rawStart, this.pos).replace(/\r\n?/g, "\n");
        this.pos += tail ? 1 : 2;
        const token: Token = { type: "template", value: raw, start, end: this.pos, nl, raw, tail };
        token.cooked = cooked === undefined ? undefined : cooked.replace(/\r\n?/g, "\n");
        return token;
      }
      if (c === 92) {
        if (cooked !== undefined) cooked += s.slice(chunk, this.pos);
        const escaped = this.readEscape(true);
        if (escaped === undefined) cooked = undefined;
        else if (cooked !== undefined) cooked += escaped;
        chunk = this.pos;
      } else this.pos++;
    }
  }

  private readNumber(start: number, nl: boolean): Token {
    const s = this.src;
    const c1 = s[start + 1]?.toLowerCase();
    let value: number | bigint;
    if (s[start] === "0" && (c1 === "x" || c1 === "o" || c1 === "b")) {
      this.pos = start + 2;
      const radix = c1 === "x" ? 16 : c1 === "o" ? 8 : 2;
      const digitsStart = this.pos;
      while (this.pos < s.length && (isHex(s.charCodeAt(this.pos)) || s[this.pos] === "_")) this.pos++;
      const digits = s.slice(digitsStart, this.pos).replace(/_/g, "");
      const valid = radix === 16 ? /^[0-9a-f]+$/i : radix === 8 ? /^[0-7]+$/ : /^[01]+$/;
      if (!valid.test(digits)) this.error("Invalid number.", start);
      if (s[this.pos] === "n") {
        this.pos++;
        value = BigInt(`0${c1}${digits}`);
      } else value = parseInt(digits, radix);
    } else {
      if (s[start] === "0" && isDigit(s.charCodeAt(start + 1))) this.error("Numbers can't start with 0. Octal literals aren't allowed; write 0o17 for octal.", start);
      this.pos = start;
      const digits = () => {
        while (this.pos < s.length && (isDigit(s.charCodeAt(this.pos)) || (s[this.pos] === "_" && isDigit(s.charCodeAt(this.pos + 1))))) this.pos++;
      };
      digits();
      let integer = true;
      if (s[this.pos] === ".") {
        integer = false;
        this.pos++;
        digits();
      }
      if (s[this.pos] === "e" || s[this.pos] === "E") {
        integer = false;
        this.pos++;
        if (s[this.pos] === "+" || s[this.pos] === "-") this.pos++;
        if (!isDigit(s.charCodeAt(this.pos))) this.error("Invalid number exponent.", start);
        digits();
      }
      const text = s.slice(start, this.pos).replace(/_/g, "");
      if (integer && s[this.pos] === "n") {
        this.pos++;
        value = BigInt(text);
      } else value = Number(text);
    }
    if (this.pos < s.length && (isIdStart(s.codePointAt(this.pos)!) || isDigit(s.charCodeAt(this.pos)))) this.error("A name can't start right after a number.", this.pos);
    return { type: "num", value: s.slice(start, this.pos), start, end: this.pos, nl, number: value };
  }
}

const REGEX_AFTER_NAMES: ReadonlySet<string> = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);

/**
 * Tokenize a whole source without parsing, deciding `/` by the previous token: a regex unless it
 * follows an identifier (other than a keyword that starts an expression), a number, a string, `)`,
 * or `]`. Template literals become one token each (including their substitutions).
 * With `stopOnError`, returns the tokens read before a problem instead of throwing.
 */
export function tokenize(src: string, options: { stopOnError?: boolean } = {}): { tokens: Token[]; lexer: Lexer; error?: ScriptSyntaxError } {
  const lexer = new Lexer(src);
  const tokens: Token[] = [];
  const braces: ("brace" | "template")[] = [];
  let templateStart: Token | null = null;
  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.type === "num" || prev.type === "string" || prev.type === "regex" || prev.type === "template" || prev.type === "privateName") return false;
    if (prev.type === "name") return REGEX_AFTER_NAMES.has(prev.value);
    return prev.value !== ")" && prev.value !== "]";
  };
  try {
    for (;;) {
      let token = lexer.next();
      if (token.type === "eof") break;
      if (token.type === "punct" && (token.value === "/" || token.value === "/=") && regexAllowed()) token = lexer.rescanRegex(token);
      if (token.type === "punct" && token.value === "{") braces.push("brace");
      if (token.type === "punct" && token.value === "}") {
        if (braces[braces.length - 1] === "template") {
          braces.pop();
          token = lexer.continueTemplate(token);
          if (!token.tail) braces.push("template");
          else if (templateStart && !braces.includes("template")) {
            tokens.push({ ...templateStart, end: token.end, tail: true, hasSubstitutions: true });
            templateStart = null;
          }
          continue;
        }
        braces.pop();
      }
      if (token.type === "template") {
        if (braces.includes("template")) {
          if (!token.tail) braces.push("template");
          continue;
        }
        if (!token.tail) {
          templateStart = token;
          braces.push("template");
          continue;
        }
      }
      if (braces.includes("template")) continue;
      tokens.push(token);
    }
  } catch (err) {
    if (!(err instanceof ScriptSyntaxError) || !options.stopOnError) throw err;
    return { tokens, lexer, error: err };
  }
  return { tokens, lexer };
}
