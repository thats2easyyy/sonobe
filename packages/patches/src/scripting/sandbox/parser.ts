/**
 * Recursive-descent parser for script sources: strict-mode ES2023 modules (no imports), or an
 * Origami-style file body that returns its patch. Arrow parameters and destructuring assignments
 * use the usual cover grammar: expressions are parsed first and reinterpreted as patterns.
 */

import type * as A from "./ast.ts";
import { Lexer, ScriptSyntaxError, type Token } from "./lexer.ts";

export { ScriptSyntaxError };

/** Message for `import`, `export ... from`, and dynamic `import()`. */
export const ONE_FILE_MESSAGE = "Scripts are one file. Paste the code you need into this file.";
/** Message for `await` at the top level of a script. */
export const TOP_LEVEL_AWAIT_MESSAGE = "Use await inside evaluate or a callback.";

const MAX_NESTING = 300;

const RESERVED: ReadonlySet<string> = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw",
  "true", "try", "typeof", "var", "void", "while", "with", "yield", "let", "static", "implements", "interface", "package", "private",
  "protected", "public", "await",
]);

const ASSIGN_OPS: ReadonlySet<string> = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??="]);

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "|": 4,
  "^": 5,
  "&": 6,
  "==": 7,
  "!=": 7,
  "===": 7,
  "!==": 7,
  "<": 8,
  ">": 8,
  "<=": 8,
  ">=": 8,
  instanceof: 8,
  in: 8,
  "<<": 9,
  ">>": 9,
  ">>>": 9,
  "+": 10,
  "-": 10,
  "*": 11,
  "/": 11,
  "%": 11,
  "**": 12,
};

interface FnContext {
  async: boolean;
  generator: boolean;
  arrow: boolean;
  /** `super.x` is allowed (methods, accessors, constructors, field initializers). */
  superProperty: boolean;
  /** `super()` is allowed (derived constructors). */
  superCall: boolean;
  /** `return` is allowed. */
  canReturn: boolean;
  /** Inside a class field initializer or static block, where `await` and `arguments` aren't allowed. */
  fieldInit: boolean;
  labels: { name: string; loop: boolean }[];
  loops: number;
  switches: number;
}

export interface ParseOptions {
  kind?: A.Program["kind"];
}

/** Parse a script. Throws ScriptSyntaxError with a 1-based line and column. */
export function parseScript(source: string, options: ParseOptions = {}): A.Program {
  return new Parser(source).parseProgram(options.kind ?? "module");
}

class Parser {
  private readonly lexer: Lexer;
  private tok: Token;
  private peeked: Token | null = null;
  private prevEnd = 0;
  private fn: FnContext;
  private readonly fnStack: FnContext[] = [];
  private depth = 0;
  private readonly coverInits = new Set<A.Property>();
  private readonly parenthesized = new WeakSet<object>();

  constructor(source: string) {
    this.lexer = new Lexer(source);
    this.tok = this.lexer.next();
    this.fn = this.newFn({ canReturn: false });
  }

  // ---- tokens -------------------------------------------------------------------

  private newFn(overrides: Partial<FnContext>): FnContext {
    return { async: false, generator: false, arrow: false, superProperty: false, superCall: false, canReturn: true, fieldInit: false, labels: [], loops: 0, switches: 0, ...overrides };
  }

  private advance(): Token {
    const previous = this.tok;
    this.prevEnd = previous.end;
    this.tok = this.peeked ?? this.lexer.next();
    this.peeked = null;
    return previous;
  }

  private peek(): Token {
    this.peeked ??= this.lexer.next();
    return this.peeked;
  }

  private is(value: string): boolean {
    return this.tok.type === "punct" && this.tok.value === value;
  }

  private isName(value: string): boolean {
    return this.tok.type === "name" && this.tok.value === value && !this.tok.escaped;
  }

  private eat(value: string): boolean {
    if (!this.is(value)) return false;
    this.advance();
    return true;
  }

  private expect(value: string): Token {
    if (!this.is(value)) this.unexpected(`Expected "${value}"`);
    return this.advance();
  }

  private expectName(value: string): void {
    if (!this.isName(value)) this.unexpected(`Expected "${value}"`);
    this.advance();
  }

  private error(message: string, offset: number = this.tok.start): never {
    return this.lexer.error(message, offset);
  }

  private unexpected(expected?: string, token: Token = this.tok): never {
    const what = token.type === "eof" ? "the end of the script" : `"${this.lexer.src.slice(token.start, Math.min(token.end, token.start + 30))}"`;
    return this.error(expected ? `${expected} but found ${what}.` : `Unexpected ${what}.`, token.start);
  }

  private consumeSemicolon(): void {
    if (this.eat(";")) return;
    if (this.is("}") || this.tok.type === "eof" || this.tok.nl) return;
    this.unexpected('Expected ";"');
  }

  private node<T extends A.Node>(start: number, fields: Omit<T, "start" | "end">): T {
    return { ...fields, start, end: this.prevEnd } as T;
  }

  private nest(): void {
    if (++this.depth > MAX_NESTING) this.error("The script is nested too deeply to run.");
  }

  private withFn<T>(fn: FnContext, parse: () => T): T {
    this.fnStack.push(this.fn);
    this.fn = fn;
    try {
      return parse();
    } finally {
      this.fn = this.fnStack.pop()!;
    }
  }

  private get topLevel(): boolean {
    return this.fnStack.length === 0;
  }

  // ---- program and statements -----------------------------------------------------

  parseProgram(kind: A.Program["kind"]): A.Program {
    const start = this.tok.start;
    const body: A.Statement[] = [];
    const parse = () => {
      while (this.tok.type !== "eof") body.push(this.parseStatement("top", kind));
    };
    if (kind === "function") this.withFn(this.newFn({}), parse);
    else parse();
    const first = this.coverInits.values().next().value;
    if (first) this.error("Invalid shorthand property initializer. Use : instead of = in object literals.", first.start);
    return { type: "Program", body, kind, start, end: this.tok.end };
  }

  private parseStatement(context: "top" | "block" | "sub", kind: A.Program["kind"] = "module"): A.Statement {
    this.nest();
    try {
      return this.parseStatementInner(context, kind);
    } finally {
      this.depth--;
    }
  }

  private parseStatementInner(context: "top" | "block" | "sub", kind: A.Program["kind"]): A.Statement {
    const t = this.tok;
    const start = t.start;
    if (t.type === "punct") {
      if (t.value === "{") return this.parseBlock();
      if (t.value === ";") {
        this.advance();
        return this.node<A.EmptyStatement>(start, { type: "EmptyStatement" });
      }
    }
    if (t.type === "name" && !t.escaped) {
      switch (t.value) {
        case "var":
        case "let":
        case "const": {
          if (context === "sub" && t.value !== "var") this.error(`A ${t.value} declaration can't be the body of a statement. Wrap it in { }.`);
          const decl = this.parseVariableDeclaration(false);
          this.consumeSemicolon();
          decl.end = this.prevEnd;
          return decl;
        }
        case "function":
          if (context === "sub") this.error("Declare functions at the top of a block. Wrap this one in { }.");
          return this.parseFunction("FunctionDeclaration", false, start) as A.FunctionDeclaration;
        case "async":
          if (this.peek().type === "name" && this.peek().value === "function" && !this.peek().nl) {
            if (context === "sub") this.error("Declare functions at the top of a block. Wrap this one in { }.");
            this.advance();
            return this.parseFunction("FunctionDeclaration", true, start) as A.FunctionDeclaration;
          }
          break;
        case "class":
          if (context === "sub") this.error("Declare classes at the top of a block. Wrap this one in { }.");
          return this.parseClass("ClassDeclaration") as A.ClassDeclaration;
        case "if":
          return this.parseIf();
        case "for":
          return this.parseFor();
        case "while": {
          this.advance();
          const test = this.parseParenExpression();
          const body = this.parseLoopBody();
          return this.node<A.WhileStatement>(start, { type: "WhileStatement", test, body });
        }
        case "do": {
          this.advance();
          const body = this.parseLoopBody();
          this.expectName("while");
          const test = this.parseParenExpression();
          this.eat(";");
          return this.node<A.DoWhileStatement>(start, { type: "DoWhileStatement", test, body });
        }
        case "return": {
          if (!this.fn.canReturn || this.fn.fieldInit) this.error(this.topLevel ? "return only works inside a function." : "return isn't allowed here.");
          this.advance();
          let argument: A.Expression | null = null;
          if (!this.is(";") && !this.is("}") && this.tok.type !== "eof" && !this.tok.nl) argument = this.parseExpression();
          this.consumeSemicolon();
          return this.node<A.ReturnStatement>(start, { type: "ReturnStatement", argument });
        }
        case "break":
        case "continue":
          return this.parseBreakContinue(t.value);
        case "throw": {
          this.advance();
          if (this.tok.nl) this.error("Put the value to throw on the same line as throw.");
          const argument = this.parseExpression();
          this.consumeSemicolon();
          return this.node<A.ThrowStatement>(start, { type: "ThrowStatement", argument });
        }
        case "try":
          return this.parseTry();
        case "switch":
          return this.parseSwitch();
        case "debugger":
          this.advance();
          this.consumeSemicolon();
          return this.node<A.DebuggerStatement>(start, { type: "DebuggerStatement" });
        case "with":
          this.error("with statements aren't allowed in scripts.");
        // falls through (unreachable)
        case "import":
          if (!(this.peek().type === "punct" && (this.peek().value === "(" || this.peek().value === "."))) this.error(ONE_FILE_MESSAGE);
          break;
        case "export":
          if (context !== "top" || kind !== "module") this.error(kind === "function" ? "Origami-style scripts can't use export. Return the patch instead." : "export only works at the top level of a script.");
          return this.parseExport();
        default:
          if (this.peek().type === "punct" && this.peek().value === ":" && !RESERVED.has(t.value)) return this.parseLabeled();
      }
    }
    const expression = this.parseExpression();
    this.consumeSemicolon();
    return this.node<A.ExpressionStatement>(start, { type: "ExpressionStatement", expression });
  }

  private parseBlock(): A.BlockStatement {
    const start = this.tok.start;
    this.expect("{");
    const body: A.Statement[] = [];
    while (!this.is("}")) {
      if (this.tok.type === "eof") this.unexpected('Expected "}"');
      body.push(this.parseStatement("block"));
    }
    this.advance();
    return this.node<A.BlockStatement>(start, { type: "BlockStatement", body });
  }

  private parseParenExpression(): A.Expression {
    this.expect("(");
    const expr = this.parseExpression();
    this.expect(")");
    return expr;
  }

  private parseLoopBody(): A.Statement {
    this.fn.loops++;
    try {
      return this.parseStatement("sub");
    } finally {
      this.fn.loops--;
    }
  }

  private parseIf(): A.IfStatement {
    const start = this.advance().start;
    const test = this.parseParenExpression();
    const consequent = this.parseStatement("sub");
    let alternate: A.Statement | null = null;
    if (this.isName("else")) {
      this.advance();
      alternate = this.parseStatement("sub");
    }
    return this.node<A.IfStatement>(start, { type: "IfStatement", test, consequent, alternate });
  }

  private parseFor(): A.Statement {
    const start = this.advance().start;
    let isAwait = false;
    if (this.isName("await")) {
      if (!this.fn.async) this.error(this.topLevel ? TOP_LEVEL_AWAIT_MESSAGE : "for await only works inside async functions.");
      this.advance();
      isAwait = true;
    }
    this.expect("(");
    let init: A.VariableDeclaration | A.Expression | null = null;
    if (!this.is(";")) {
      if (this.isName("var") || this.isName("let") || this.isName("const")) init = this.parseVariableDeclaration(true);
      else init = this.parseExpression(true);
    }
    if (init && (this.isName("of") || this.isName("in"))) {
      const of = this.isName("of");
      this.advance();
      let left: A.VariableDeclaration | A.Pattern;
      if (init.type === "VariableDeclaration") {
        if (init.declarations.length !== 1 || init.declarations[0]!.init) this.error(`A for-${of ? "of" : "in"} loop declares exactly one variable, without a value.`, init.start);
        left = init;
      } else left = this.toPattern(init, false);
      const right = of ? this.parseAssign(false) : this.parseExpression();
      this.expect(")");
      const body = this.parseLoopBody();
      if (of) return this.node<A.ForOfStatement>(start, { type: "ForOfStatement", left, right, body, await: isAwait });
      if (isAwait) this.error("for await only works with of.", start);
      return this.node<A.ForInStatement>(start, { type: "ForInStatement", left, right, body });
    }
    if (isAwait) this.error("for await only works with of.", start);
    if (init?.type === "VariableDeclaration") {
      for (const d of init.declarations) if (!d.init && (init.kind === "const" || d.id.type !== "Identifier")) this.error("This declaration needs a value.", d.start);
    }
    this.expect(";");
    const test = this.is(";") ? null : this.parseExpression();
    this.expect(";");
    const update = this.is(")") ? null : this.parseExpression();
    this.expect(")");
    const body = this.parseLoopBody();
    return this.node<A.ForStatement>(start, { type: "ForStatement", init, test, update, body });
  }

  private parseBreakContinue(keyword: "break" | "continue"): A.Statement {
    const start = this.advance().start;
    let label: string | null = null;
    if (this.tok.type === "name" && !this.tok.nl && !RESERVED.has(this.tok.value)) {
      label = this.advance().value;
      const found = this.fn.labels.find((l) => l.name === label);
      if (!found) this.error(`There's no label "${label}" around this ${keyword}.`, start);
      if (keyword === "continue" && !found.loop) this.error(`continue ${label} needs "${label}" to label a loop.`, start);
    } else if (keyword === "break" ? this.fn.loops === 0 && this.fn.switches === 0 : this.fn.loops === 0) {
      this.error(`${keyword} only works inside a loop${keyword === "break" ? " or switch" : ""}.`, start);
    }
    this.consumeSemicolon();
    return keyword === "break"
      ? this.node<A.BreakStatement>(start, { type: "BreakStatement", label })
      : this.node<A.ContinueStatement>(start, { type: "ContinueStatement", label });
  }

  private parseTry(): A.TryStatement {
    const start = this.advance().start;
    const block = this.parseBlock();
    let handler: A.CatchClause | null = null;
    let finalizer: A.BlockStatement | null = null;
    if (this.isName("catch")) {
      const catchStart = this.advance().start;
      let param: A.Pattern | null = null;
      if (this.eat("(")) {
        param = this.parseBindingTarget();
        this.expect(")");
      }
      const body = this.parseBlock();
      handler = this.node<A.CatchClause>(catchStart, { type: "CatchClause", param, body });
    }
    if (this.isName("finally")) {
      this.advance();
      finalizer = this.parseBlock();
    }
    if (!handler && !finalizer) this.error("try needs a catch or finally block.", start);
    return this.node<A.TryStatement>(start, { type: "TryStatement", block, handler, finalizer });
  }

  private parseSwitch(): A.SwitchStatement {
    const start = this.advance().start;
    const discriminant = this.parseParenExpression();
    this.expect("{");
    const cases: A.SwitchCase[] = [];
    let sawDefault = false;
    this.fn.switches++;
    try {
      while (!this.eat("}")) {
        const caseStart = this.tok.start;
        let test: A.Expression | null = null;
        if (this.isName("case")) {
          this.advance();
          test = this.parseExpression();
        } else if (this.isName("default")) {
          if (sawDefault) this.error("A switch can only have one default case.");
          sawDefault = true;
          this.advance();
        } else this.unexpected('Expected "case" or "default"');
        this.expect(":");
        const consequent: A.Statement[] = [];
        while (!this.is("}") && !this.isName("case") && !this.isName("default")) {
          if (this.tok.type === "eof") this.unexpected('Expected "}"');
          consequent.push(this.parseStatement("block"));
        }
        cases.push(this.node<A.SwitchCase>(caseStart, { type: "SwitchCase", test, consequent }));
      }
    } finally {
      this.fn.switches--;
    }
    return this.node<A.SwitchStatement>(start, { type: "SwitchStatement", discriminant, cases });
  }

  private parseLabeled(): A.LabeledStatement {
    const start = this.tok.start;
    const label = this.advance().value;
    this.expect(":");
    if (this.fn.labels.some((l) => l.name === label)) this.error(`The label "${label}" is already in use.`, start);
    const loop = this.isName("for") || this.isName("while") || this.isName("do");
    this.fn.labels.push({ name: label, loop });
    try {
      const body = this.parseStatement("sub");
      return this.node<A.LabeledStatement>(start, { type: "LabeledStatement", label, body });
    } finally {
      this.fn.labels.pop();
    }
  }

  private parseExport(): A.Statement {
    const start = this.advance().start;
    if (this.isName("default")) {
      this.advance();
      let declaration: A.ExportDefaultDeclaration["declaration"];
      if (this.isName("function")) declaration = this.parseFunction("FunctionDeclaration", false, this.tok.start, true) as A.FunctionDeclaration;
      else if (this.isName("async") && this.peek().type === "name" && this.peek().value === "function" && !this.peek().nl) {
        const fnStart = this.advance().start;
        declaration = this.parseFunction("FunctionDeclaration", true, fnStart, true) as A.FunctionDeclaration;
      } else if (this.isName("class")) declaration = this.parseClass("ClassDeclaration", true) as A.ClassDeclaration;
      else {
        declaration = this.parseAssign(false);
        this.consumeSemicolon();
      }
      return this.node<A.ExportDefaultDeclaration>(start, { type: "ExportDefaultDeclaration", declaration });
    }
    if (this.is("*")) this.error(ONE_FILE_MESSAGE);
    if (this.is("{")) {
      this.advance();
      const specifiers: A.ExportSpecifier[] = [];
      while (!this.eat("}")) {
        if (this.tok.type !== "name") this.unexpected("Expected a name");
        const local = this.advance().value;
        let exported = local;
        if (this.isName("as")) {
          this.advance();
          if (this.tok.type !== "name" && this.tok.type !== "string") this.unexpected("Expected a name");
          exported = this.advance().value;
        }
        specifiers.push({ local, exported });
        if (!this.is("}")) this.expect(",");
      }
      if (this.isName("from")) this.error(ONE_FILE_MESSAGE);
      this.consumeSemicolon();
      return this.node<A.ExportNamedDeclaration>(start, { type: "ExportNamedDeclaration", declaration: null, specifiers });
    }
    let declaration: A.ExportNamedDeclaration["declaration"];
    if (this.isName("var") || this.isName("let") || this.isName("const")) {
      declaration = this.parseVariableDeclaration(false);
      this.consumeSemicolon();
      declaration.end = this.prevEnd;
    } else if (this.isName("function")) declaration = this.parseFunction("FunctionDeclaration", false, this.tok.start) as A.FunctionDeclaration;
    else if (this.isName("async") && this.peek().type === "name" && this.peek().value === "function") {
      const fnStart = this.advance().start;
      declaration = this.parseFunction("FunctionDeclaration", true, fnStart) as A.FunctionDeclaration;
    } else if (this.isName("class")) declaration = this.parseClass("ClassDeclaration") as A.ClassDeclaration;
    else this.unexpected("Expected a declaration after export");
    return this.node<A.ExportNamedDeclaration>(start, { type: "ExportNamedDeclaration", declaration, specifiers: [] });
  }

  private parseVariableDeclaration(inForHead: boolean): A.VariableDeclaration {
    const start = this.tok.start;
    const kind = this.advance().value as A.VariableDeclaration["kind"];
    const declarations: A.VariableDeclarator[] = [];
    do {
      const declStart = this.tok.start;
      const id = this.parseBindingTarget();
      let init: A.Expression | null = null;
      if (this.eat("=")) init = this.parseAssign(inForHead);
      else if (!inForHead && (kind === "const" || id.type !== "Identifier")) this.error(kind === "const" ? "A const declaration needs a value." : "A destructuring declaration needs a value.", declStart);
      declarations.push(this.node<A.VariableDeclarator>(declStart, { type: "VariableDeclarator", id, init }));
    } while (this.eat(","));
    return this.node<A.VariableDeclaration>(start, { type: "VariableDeclaration", kind, declarations });
  }

  // ---- functions and classes ------------------------------------------------------

  private parseFunction(type: "FunctionDeclaration" | "FunctionExpression", isAsync: boolean, start: number, optionalName = false): A.FunctionDeclaration | A.FunctionExpression {
    this.expectName("function");
    const generator = this.eat("*");
    let id: A.Identifier | null = null;
    if (this.tok.type === "name" && !this.is("(")) id = this.parseBindingIdentifier();
    else if (type === "FunctionDeclaration" && !optionalName) this.unexpected("Expected a function name");
    const fn = this.newFn({ async: isAsync, generator });
    const { params, body } = this.withFn(fn, () => ({ params: this.parseParams(), body: this.parseFunctionBody() }));
    return this.node<A.FunctionDeclaration | A.FunctionExpression>(start, { type, id: id as A.Identifier, params, body, async: isAsync, generator, expression: false });
  }

  private parseParams(): A.Pattern[] {
    this.expect("(");
    const params: A.Pattern[] = [];
    while (!this.is(")")) {
      if (this.is("...")) {
        const restStart = this.advance().start;
        const argument = this.parseBindingTarget();
        params.push(this.node<A.RestElement>(restStart, { type: "RestElement", argument }));
        if (!this.is(")")) this.error("A rest parameter must be the last parameter.");
        break;
      }
      params.push(this.parseBindingElement());
      if (!this.is(")")) this.expect(",");
    }
    this.advance();
    return params;
  }

  private parseFunctionBody(): A.BlockStatement {
    const start = this.tok.start;
    this.expect("{");
    const body: A.Statement[] = [];
    const saved = this.depth;
    while (!this.is("}")) {
      if (this.tok.type === "eof") this.unexpected('Expected "}"');
      body.push(this.parseStatement("block"));
    }
    this.depth = saved;
    this.advance();
    return this.node<A.BlockStatement>(start, { type: "BlockStatement", body });
  }

  private parseArrowBody(start: number, params: A.Pattern[], isAsync: boolean): A.ArrowFunctionExpression {
    if (this.tok.nl) this.error("Put => on the same line as the arrow function's parameters.");
    this.expect("=>");
    const outer = this.fn;
    const fn = this.newFn({ async: isAsync, arrow: true, superProperty: outer.superProperty, superCall: outer.superCall, fieldInit: false });
    for (const p of params) this.checkArrowParam(p);
    return this.withFn(fn, () => {
      if (this.is("{")) {
        const body = this.parseFunctionBody();
        return this.node<A.ArrowFunctionExpression>(start, { type: "ArrowFunctionExpression", id: null, params, body, async: isAsync, generator: false, expression: false });
      }
      const body = this.parseAssign(false);
      return this.node<A.ArrowFunctionExpression>(start, { type: "ArrowFunctionExpression", id: null, params, body, async: isAsync, generator: false, expression: true });
    });
  }

  private checkArrowParam(p: A.Pattern): void {
    switch (p.type) {
      case "Identifier":
        this.checkBindingName(p.name, p.start);
        return;
      case "MemberExpression":
        this.error("Arrow function parameters must be names or patterns.", p.start);
      // falls through (unreachable)
      case "AssignmentPattern":
        this.checkArrowParam(p.left);
        return;
      case "RestElement":
        this.checkArrowParam(p.argument);
        return;
      case "ArrayPattern":
        for (const e of p.elements) if (e) this.checkArrowParam(e);
        return;
      case "ObjectPattern":
        for (const prop of p.properties) this.checkArrowParam(prop.type === "RestElement" ? prop.argument : prop.value);
    }
  }

  private parseClass(type: "ClassDeclaration" | "ClassExpression", optionalName = false): A.ClassDeclaration | A.ClassExpression {
    const start = this.advance().start;
    let id: A.Identifier | null = null;
    if (this.tok.type === "name" && !this.isName("extends")) id = this.parseBindingIdentifier();
    else if (type === "ClassDeclaration" && !optionalName) this.unexpected("Expected a class name");
    let superClass: A.Expression | null = null;
    if (this.isName("extends")) {
      this.advance();
      superClass = this.parseLeftHandSide();
    }
    this.expect("{");
    const body: A.ClassNode["body"] = [];
    let sawConstructor = false;
    while (!this.eat("}")) {
      if (this.eat(";")) continue;
      if (this.tok.type === "eof") this.unexpected('Expected "}"');
      const member = this.parseClassMember(superClass !== null);
      if (member.type === "MethodDefinition" && member.kind === "constructor") {
        if (sawConstructor) this.error("A class can only have one constructor.", member.start);
        sawConstructor = true;
      }
      body.push(member);
    }
    return this.node<A.ClassDeclaration | A.ClassExpression>(start, { type, id: id as A.Identifier, superClass, body });
  }

  /** True when the current contextual keyword (get, set, static, async) is a modifier rather than a member name. */
  private modifierFollows(): boolean {
    const next = this.peek();
    if (next.type === "punct") return next.value === "[" || next.value === "*";
    return next.type === "name" || next.type === "string" || next.type === "num" || next.type === "privateName";
  }

  private parseClassMember(derived: boolean): A.MethodDefinition | A.PropertyDefinition | A.StaticBlock {
    const start = this.tok.start;
    let isStatic = false;
    if (this.isName("static")) {
      const next = this.peek();
      if (next.type === "punct" && next.value === "{") {
        this.advance();
        const body = this.withFn(this.newFn({ superProperty: true, fieldInit: true, canReturn: false }), () => this.parseBlock().body);
        return this.node<A.StaticBlock>(start, { type: "StaticBlock", body });
      }
      if (this.modifierFollows()) {
        this.advance();
        isStatic = true;
      }
    }
    let kind: "method" | "get" | "set" = "method";
    let isAsync = false;
    let generator = false;
    if (this.isName("async") && this.modifierFollows() && !this.peek().nl) {
      this.advance();
      isAsync = true;
    }
    if (this.eat("*")) generator = true;
    if (!isAsync && !generator && (this.isName("get") || this.isName("set")) && this.modifierFollows()) {
      kind = this.advance().value as "get" | "set";
    }
    const { key, computed } = this.parsePropertyKey(true);
    if (this.is("(")) {
      const isConstructor = !isStatic && !computed && key.type === "Identifier" && key.name === "constructor";
      if (isConstructor && (kind !== "method" || isAsync || generator)) this.error("The constructor can't be a getter, setter, async, or generator.", start);
      if (key.type === "PrivateIdentifier" && key.name === "constructor") this.error("#constructor isn't a valid name.", key.start);
      const value = this.parseMethod(isAsync, generator, isConstructor && derived);
      if (kind === "get" && value.params.length) this.error("A getter can't take parameters.", value.start);
      if (kind === "set" && value.params.length !== 1) this.error("A setter takes exactly one parameter.", value.start);
      return this.node<A.MethodDefinition>(start, { type: "MethodDefinition", key, computed, kind: isConstructor ? "constructor" : kind, static: isStatic, value });
    }
    if (kind !== "method" || isAsync || generator) this.unexpected('Expected "("');
    if (!computed && key.type === "Identifier" && key.name === "constructor") this.error("A class field can't be named constructor.", key.start);
    let value: A.Expression | null = null;
    if (this.eat("=")) value = this.withFn(this.newFn({ superProperty: true, fieldInit: true, canReturn: false }), () => this.parseAssign(false));
    this.consumeSemicolon();
    return this.node<A.PropertyDefinition>(start, { type: "PropertyDefinition", key, computed, static: isStatic, value });
  }

  private parsePropertyKey(allowPrivate: boolean): { key: A.Expression | A.PrivateIdentifier; computed: boolean } {
    const t = this.tok;
    const start = t.start;
    if (this.eat("[")) {
      const key = this.parseAssign(false);
      this.expect("]");
      return { key, computed: true };
    }
    if (t.type === "privateName") {
      if (!allowPrivate) this.unexpected();
      this.advance();
      return { key: this.node<A.PrivateIdentifier>(start, { type: "PrivateIdentifier", name: t.value }), computed: false };
    }
    if (t.type === "name") {
      this.advance();
      return { key: this.node<A.Identifier>(start, { type: "Identifier", name: t.value }), computed: false };
    }
    if (t.type === "string" || t.type === "num") {
      this.advance();
      const value = t.type === "string" ? t.value : t.number!;
      return { key: this.node<A.Literal>(start, { type: "Literal", value }), computed: false };
    }
    return this.unexpected("Expected a property name");
  }

  private parseMethod(isAsync: boolean, generator: boolean, superCall: boolean): A.FunctionExpression {
    const start = this.tok.start;
    const fn = this.newFn({ async: isAsync, generator, superProperty: true, superCall });
    const { params, body } = this.withFn(fn, () => ({ params: this.parseParams(), body: this.parseFunctionBody() }));
    return this.node<A.FunctionExpression>(start, { type: "FunctionExpression", id: null, params, body, async: isAsync, generator, expression: false });
  }

  // ---- patterns ---------------------------------------------------------------------

  private checkBindingName(name: string, offset: number): void {
    if (name === "eval" || name === "arguments") this.error(`"${name}" can't be used as a variable name.`, offset);
    if (RESERVED.has(name)) this.error(`"${name}" is a reserved word, so it can't be used as a name.`, offset);
  }

  private parseBindingIdentifier(): A.Identifier {
    const t = this.tok;
    if (t.type !== "name") this.unexpected("Expected a name");
    this.checkBindingName(t.value, t.start);
    this.advance();
    return this.node<A.Identifier>(t.start, { type: "Identifier", name: t.value });
  }

  private parseBindingTarget(): A.Pattern {
    if (this.is("[")) return this.parseArrayBindingPattern();
    if (this.is("{")) return this.parseObjectBindingPattern();
    return this.parseBindingIdentifier();
  }

  private parseBindingElement(): A.Pattern {
    const start = this.tok.start;
    const target = this.parseBindingTarget();
    if (!this.eat("=")) return target;
    const right = this.parseAssign(false);
    return this.node<A.AssignmentPattern>(start, { type: "AssignmentPattern", left: target, right });
  }

  private parseArrayBindingPattern(): A.ArrayPattern {
    const start = this.advance().start;
    const elements: (A.Pattern | null)[] = [];
    while (!this.is("]")) {
      if (this.eat(",")) {
        elements.push(null);
        continue;
      }
      if (this.is("...")) {
        const restStart = this.advance().start;
        const argument = this.parseBindingTarget();
        elements.push(this.node<A.RestElement>(restStart, { type: "RestElement", argument }));
        if (!this.is("]")) this.error("A rest element must be last.");
        break;
      }
      elements.push(this.parseBindingElement());
      if (!this.is("]")) this.expect(",");
    }
    this.advance();
    return this.node<A.ArrayPattern>(start, { type: "ArrayPattern", elements });
  }

  private parseObjectBindingPattern(): A.ObjectPattern {
    const start = this.advance().start;
    const properties: A.ObjectPattern["properties"] = [];
    while (!this.is("}")) {
      const propStart = this.tok.start;
      if (this.is("...")) {
        this.advance();
        const argument = this.parseBindingIdentifier();
        properties.push(this.node<A.RestElement>(propStart, { type: "RestElement", argument }));
        if (!this.is("}")) this.error("A rest element must be last.");
        break;
      }
      const keyToken = this.tok;
      const { key, computed } = this.parsePropertyKey(false);
      let value: A.Pattern;
      if (this.eat(":")) value = this.parseBindingElement();
      else {
        if (computed || keyToken.type !== "name") this.unexpected('Expected ":"');
        this.checkBindingName(keyToken.value, keyToken.start);
        const id = this.node<A.Identifier>(keyToken.start, { type: "Identifier", name: keyToken.value });
        value = id;
        if (this.eat("=")) value = this.node<A.AssignmentPattern>(keyToken.start, { type: "AssignmentPattern", left: id, right: this.parseAssign(false) });
      }
      properties.push(this.node<A.PatternProperty>(propStart, { type: "PatternProperty", key: key as A.Expression, computed, value }));
      if (!this.is("}")) this.expect(",");
    }
    this.advance();
    return this.node<A.ObjectPattern>(start, { type: "ObjectPattern", properties });
  }

  /** Reinterpret an expression as an assignment (or arrow parameter) target. */
  private toPattern(expr: A.Expression | A.SpreadElement, binding: boolean): A.Pattern {
    switch (expr.type) {
      case "Identifier":
        if (expr.name === "eval" || expr.name === "arguments") this.error(`"${expr.name}" can't be assigned to.`, expr.start);
        return expr;
      case "MemberExpression":
        if (binding) break;
        return expr;
      case "ArrayExpression": {
        if (this.parenthesized.has(expr)) break;
        const elements: (A.Pattern | null)[] = expr.elements.map((e, i) => {
          if (e === null) return null;
          if (e.type === "SpreadElement") {
            if (i !== expr.elements.length - 1) this.error("A rest element must be last.", e.start);
            return { type: "RestElement", argument: this.toPattern(e.argument, binding), start: e.start, end: e.end } satisfies A.RestElement;
          }
          return this.toPattern(e, binding);
        });
        return { type: "ArrayPattern", elements, start: expr.start, end: expr.end };
      }
      case "ObjectExpression": {
        if (this.parenthesized.has(expr)) break;
        const properties: A.ObjectPattern["properties"] = expr.properties.map((p, i) => {
          if (p.type === "SpreadElement") {
            if (i !== expr.properties.length - 1) this.error("A rest element must be last.", p.start);
            return { type: "RestElement", argument: this.toPattern(p.argument, binding), start: p.start, end: p.end } satisfies A.RestElement;
          }
          if (p.kind !== "init" || p.method) this.error("Methods can't be assignment targets.", p.start);
          let value = this.toPattern(p.value, binding);
          if (p.coverInitializer) {
            this.coverInits.delete(p);
            value = { type: "AssignmentPattern", left: value, right: p.coverInitializer, start: p.start, end: p.end };
          }
          return { type: "PatternProperty", key: p.key as A.Expression, computed: p.computed, value, start: p.start, end: p.end } satisfies A.PatternProperty;
        });
        return { type: "ObjectPattern", properties, start: expr.start, end: expr.end };
      }
      case "AssignmentExpression":
        if (expr.operator !== "=" || this.parenthesized.has(expr)) break;
        return { type: "AssignmentPattern", left: expr.left, right: expr.right, start: expr.start, end: expr.end };
      default:
        break;
    }
    return this.error(binding ? "Invalid parameter." : "Invalid assignment target.", expr.start);
  }

  private simpleTarget(expr: A.Expression): A.Identifier | A.MemberExpression {
    if (expr.type === "Identifier") {
      if (expr.name === "eval" || expr.name === "arguments") this.error(`"${expr.name}" can't be assigned to.`, expr.start);
      return expr;
    }
    if (expr.type === "MemberExpression") return expr;
    return this.error("Invalid assignment target.", expr.start);
  }

  // ---- expressions ----------------------------------------------------------------

  private parseExpression(noIn = false): A.Expression {
    const start = this.tok.start;
    const first = this.parseAssign(noIn);
    if (!this.is(",")) return first;
    const expressions = [first];
    while (this.eat(",")) expressions.push(this.parseAssign(noIn));
    return this.node<A.SequenceExpression>(start, { type: "SequenceExpression", expressions });
  }

  private parseAssign(noIn: boolean): A.Expression {
    this.nest();
    try {
      if (this.isName("yield") && this.fn.generator) return this.parseYield(noIn);
      const start = this.tok.start;
      const left = this.parseConditional(noIn);
      if (this.tok.type === "punct" && ASSIGN_OPS.has(this.tok.value)) {
        const operator = this.advance().value;
        const target = operator === "=" ? this.toPattern(left, false) : this.simpleTarget(left);
        const right = this.parseAssign(noIn);
        return this.node<A.AssignmentExpression>(start, { type: "AssignmentExpression", operator, left: target, right });
      }
      return left;
    } finally {
      this.depth--;
    }
  }

  private parseYield(noIn: boolean): A.YieldExpression {
    const start = this.advance().start;
    if (this.fn.fieldInit) this.error("yield isn't allowed here.", start);
    let delegate = false;
    let argument: A.Expression | null = null;
    if (!this.tok.nl) {
      delegate = this.eat("*");
      const t = this.tok;
      const ends = t.type === "eof" || (t.type === "punct" && [")", "]", "}", ",", ";", ":"].includes(t.value)) || (t.type === "name" && t.value === "in");
      if (delegate || !ends) argument = this.parseAssign(noIn);
    }
    return this.node<A.YieldExpression>(start, { type: "YieldExpression", argument, delegate });
  }

  private parseConditional(noIn: boolean): A.Expression {
    const start = this.tok.start;
    const test = this.parseBinary(0, noIn);
    if (!this.eat("?")) return test;
    const consequent = this.parseAssign(false);
    this.expect(":");
    const alternate = this.parseAssign(noIn);
    return this.node<A.ConditionalExpression>(start, { type: "ConditionalExpression", test, consequent, alternate });
  }

  private binaryOperator(noIn: boolean): string | undefined {
    const t = this.tok;
    if (t.type === "punct") return BINARY_PRECEDENCE[t.value] !== undefined ? t.value : undefined;
    if (t.type === "name" && !t.escaped && (t.value === "instanceof" || (t.value === "in" && !noIn))) return t.value;
    return undefined;
  }

  private parseBinary(minPrecedence: number, noIn: boolean): A.Expression {
    const start = this.tok.start;
    let left: A.Expression | A.PrivateIdentifier;
    if (this.tok.type === "privateName") {
      const t = this.advance();
      left = this.node<A.PrivateIdentifier>(start, { type: "PrivateIdentifier", name: t.value });
      if (!this.isName("in")) this.error(`#${t.value} can only be read from an object, like this.#${t.value}.`, start);
    } else left = this.parseUnary();
    for (;;) {
      const op = this.binaryOperator(noIn);
      if (op === undefined) break;
      const precedence = BINARY_PRECEDENCE[op]!;
      if (precedence <= minPrecedence) break;
      if (left.type === "PrivateIdentifier" && op !== "in") this.unexpected();
      this.advance();
      const right = op === "**" ? this.parseBinary(precedence - 1, noIn) : this.parseBinary(precedence, noIn);
      if (op === "??" || op === "||" || op === "&&") {
        const mixes = (e: A.Expression) => e.type === "LogicalExpression" && !this.parenthesized.has(e) && (op === "??") !== (e.operator === "??");
        if (mixes(left as A.Expression) || mixes(right)) this.error("Mixing ?? with || or && needs parentheses.", start);
        left = this.node<A.LogicalExpression>(start, { type: "LogicalExpression", operator: op, left: left as A.Expression, right });
      } else {
        if (op === "**" && left.type === "UnaryExpression" && !this.parenthesized.has(left)) this.error("Wrap the left side of ** in parentheses when it starts with an operator.", start);
        left = this.node<A.BinaryExpression>(start, { type: "BinaryExpression", operator: op, left, right });
      }
    }
    if (left.type === "PrivateIdentifier") this.unexpected();
    return left;
  }

  private parseUnary(): A.Expression {
    const t = this.tok;
    const start = t.start;
    if (t.type === "punct" && (t.value === "!" || t.value === "~" || t.value === "+" || t.value === "-")) {
      this.advance();
      const argument = this.parseUnary();
      return this.node<A.UnaryExpression>(start, { type: "UnaryExpression", operator: t.value as A.UnaryExpression["operator"], argument });
    }
    if (t.type === "punct" && (t.value === "++" || t.value === "--")) {
      this.advance();
      const argument = this.simpleTarget(this.parseUnary());
      return this.node<A.UpdateExpression>(start, { type: "UpdateExpression", operator: t.value as "++" | "--", prefix: true, argument });
    }
    if (t.type === "name" && !t.escaped) {
      if (t.value === "typeof" || t.value === "void" || t.value === "delete") {
        this.advance();
        const argument = this.parseUnary();
        if (t.value === "delete" && argument.type === "Identifier") this.error("delete only works on object properties.", start);
        if (t.value === "delete" && argument.type === "MemberExpression" && argument.property.type === "PrivateIdentifier") this.error("Private fields can't be deleted.", start);
        return this.node<A.UnaryExpression>(start, { type: "UnaryExpression", operator: t.value, argument });
      }
      if (t.value === "await") {
        if (!this.fn.async || this.fn.fieldInit) this.error(this.topLevel ? TOP_LEVEL_AWAIT_MESSAGE : "await only works inside async functions.", start);
        this.advance();
        const argument = this.parseUnary();
        return this.node<A.AwaitExpression>(start, { type: "AwaitExpression", argument });
      }
    }
    const expr = this.parseLeftHandSide();
    if (this.tok.type === "punct" && (this.tok.value === "++" || this.tok.value === "--") && !this.tok.nl) {
      const operator = this.advance().value as "++" | "--";
      return this.node<A.UpdateExpression>(start, { type: "UpdateExpression", operator, prefix: false, argument: this.simpleTarget(expr) });
    }
    return expr;
  }

  private parseArguments(): (A.Expression | A.SpreadElement)[] {
    this.expect("(");
    const args: (A.Expression | A.SpreadElement)[] = [];
    while (!this.is(")")) {
      if (this.is("...")) {
        const start = this.advance().start;
        args.push(this.node<A.SpreadElement>(start, { type: "SpreadElement", argument: this.parseAssign(false) }));
      } else args.push(this.parseAssign(false));
      if (!this.is(")")) this.expect(",");
    }
    this.advance();
    return args;
  }

  private parseLeftHandSide(): A.Expression {
    const start = this.tok.start;
    let expr: A.Expression | A.Super;
    if (this.isName("new")) expr = this.parseNew();
    else if (this.isName("super")) expr = this.parseSuper();
    else expr = this.parsePrimary();
    let chained = false;
    for (;;) {
      const t = this.tok;
      if (t.type === "punct") {
        if (t.value === ".") {
          this.advance();
          expr = this.parseMemberName(start, expr, false);
          continue;
        }
        if (t.value === "?.") {
          if (expr.type === "Super") this.unexpected();
          chained = true;
          this.advance();
          if (this.is("(")) {
            const args = this.parseArguments();
            expr = this.node<A.CallExpression>(start, { type: "CallExpression", callee: expr, arguments: args, optional: true });
          } else if (this.eat("[")) {
            const property = this.parseExpression();
            this.expect("]");
            expr = this.node<A.MemberExpression>(start, { type: "MemberExpression", object: expr, property, computed: true, optional: true });
          } else expr = this.parseMemberName(start, expr, true);
          continue;
        }
        if (t.value === "[") {
          this.advance();
          const property = this.parseExpression();
          this.expect("]");
          expr = this.node<A.MemberExpression>(start, { type: "MemberExpression", object: expr, property, computed: true, optional: false });
          continue;
        }
        if (t.value === "(") {
          if (expr.type === "Super" && !this.fn.superCall) this.error("super() only works in the constructor of a class that extends another.", start);
          const args = this.parseArguments();
          expr = this.node<A.CallExpression>(start, { type: "CallExpression", callee: expr, arguments: args, optional: false });
          continue;
        }
      }
      if (t.type === "template") {
        if (chained) this.error("Tagged templates can't be used in an optional chain.");
        if (expr.type === "Super") this.unexpected();
        const quasi = this.parseTemplate(true);
        expr = this.node<A.TaggedTemplateExpression>(start, { type: "TaggedTemplateExpression", tag: expr, quasi });
        continue;
      }
      break;
    }
    if (expr.type === "Super") this.unexpected();
    return chained ? this.node<A.ChainExpression>(start, { type: "ChainExpression", expression: expr }) : expr;
  }

  private parseMemberName(start: number, object: A.Expression | A.Super, optional: boolean): A.MemberExpression {
    const t = this.tok;
    if (t.type === "privateName") {
      if (object.type === "Super") this.error("Private fields can't be read through super.", t.start);
      this.advance();
      const property = this.node<A.PrivateIdentifier>(t.start, { type: "PrivateIdentifier", name: t.value });
      return this.node<A.MemberExpression>(start, { type: "MemberExpression", object, property, computed: false, optional });
    }
    if (t.type !== "name") this.unexpected("Expected a property name");
    this.advance();
    const property = this.node<A.Identifier>(t.start, { type: "Identifier", name: t.value });
    return this.node<A.MemberExpression>(start, { type: "MemberExpression", object, property, computed: false, optional });
  }

  private parseSuper(): A.Super {
    const start = this.advance().start;
    const node = this.node<A.Super>(start, { type: "Super" });
    if (this.is("(")) {
      if (!this.fn.superCall) this.error("super() only works in the constructor of a class that extends another.", start);
      return node;
    }
    if (!this.is(".") && !this.is("[")) this.unexpected('Expected "." or "(" after super');
    if (!this.fn.superProperty) this.error("super only works inside class methods and object methods.", start);
    return node;
  }

  private parseNew(): A.Expression {
    const start = this.advance().start;
    if (this.eat(".")) {
      if (!this.isName("target")) this.unexpected('Expected "target"');
      this.advance();
      const inFunction = this.fnStack.length > 0 && [this.fn, ...this.fnStack.slice(1)].some((f) => !f.arrow);
      if (!inFunction) this.error("new.target only works inside functions.", start);
      return this.node<A.MetaProperty>(start, { type: "MetaProperty", meta: "new", property: "target" });
    }
    if (this.isName("import")) this.error(ONE_FILE_MESSAGE);
    let callee: A.Expression;
    if (this.isName("new")) callee = this.parseNew();
    else if (this.isName("super")) this.error("new super isn't allowed.");
    else callee = this.parsePrimary();
    for (;;) {
      if (this.eat(".")) {
        callee = this.parseMemberName(start, callee, false);
      } else if (this.eat("[")) {
        const property = this.parseExpression();
        this.expect("]");
        callee = this.node<A.MemberExpression>(start, { type: "MemberExpression", object: callee, property, computed: true, optional: false });
      } else if (this.tok.type === "template") {
        const quasi = this.parseTemplate(true);
        callee = this.node<A.TaggedTemplateExpression>(start, { type: "TaggedTemplateExpression", tag: callee, quasi });
      } else if (this.is("?.")) {
        this.error("Optional chains can't be used with new.");
      } else break;
    }
    const args = this.is("(") ? this.parseArguments() : [];
    return this.node<A.NewExpression>(start, { type: "NewExpression", callee, arguments: args });
  }

  private parseTemplate(tagged: boolean): A.TemplateLiteral {
    const start = this.tok.start;
    const quasis: A.TemplateElement[] = [];
    const expressions: A.Expression[] = [];
    for (;;) {
      const chunk = this.tok;
      if (chunk.type !== "template") this.unexpected("Expected template text");
      if (chunk.cooked === undefined && !tagged) this.error("Invalid escape sequence in a template literal.", chunk.start);
      quasis.push({ cooked: chunk.cooked, raw: chunk.raw ?? "" });
      if (chunk.tail) {
        this.advance();
        break;
      }
      this.advance();
      expressions.push(this.parseExpression());
      if (!this.is("}")) this.unexpected('Expected "}"');
      if (this.peeked) this.error("Unexpected token in a template literal.");
      this.prevEnd = this.tok.end;
      this.tok = this.lexer.continueTemplate(this.tok);
    }
    return this.node<A.TemplateLiteral>(start, { type: "TemplateLiteral", quasis, expressions });
  }

  private parsePrimary(): A.Expression {
    const t = this.tok;
    const start = t.start;
    switch (t.type) {
      case "num":
        this.advance();
        return this.node<A.Literal>(start, { type: "Literal", value: t.number! });
      case "string":
        this.advance();
        return this.node<A.Literal>(start, { type: "Literal", value: t.value });
      case "template":
        return this.parseTemplate(false);
      case "punct":
        if (t.value === "/" || t.value === "/=") {
          if (this.peeked) this.unexpected();
          const re = this.lexer.rescanRegex(t);
          this.tok = re;
          this.advance();
          return this.node<A.RegExpLiteral>(start, { type: "RegExpLiteral", pattern: re.regex!.pattern, flags: re.regex!.flags });
        }
        if (t.value === "(") return this.parseParenthesized();
        if (t.value === "[") return this.parseArrayLiteral();
        if (t.value === "{") return this.parseObjectLiteral();
        break;
      case "name": {
        if (t.escaped) break;
        switch (t.value) {
          case "this":
            this.advance();
            return this.node<A.ThisExpression>(start, { type: "ThisExpression" });
          case "null":
            this.advance();
            return this.node<A.Literal>(start, { type: "Literal", value: null });
          case "true":
          case "false":
            this.advance();
            return this.node<A.Literal>(start, { type: "Literal", value: t.value === "true" });
          case "function":
            return this.parseFunction("FunctionExpression", false, start) as A.FunctionExpression;
          case "class":
            return this.parseClass("ClassExpression") as A.ClassExpression;
          case "import":
            this.error(ONE_FILE_MESSAGE);
          // falls through (unreachable)
          case "async": {
            const next = this.peek();
            if (next.nl) break;
            if (next.type === "name" && next.value === "function") {
              this.advance();
              return this.parseFunction("FunctionExpression", true, start) as A.FunctionExpression;
            }
            if (next.type === "name" && !next.escaped && !RESERVED.has(next.value)) {
              this.advance();
              const param = this.parseBindingIdentifier();
              if (!this.is("=>")) this.unexpected('Expected "=>"');
              return this.parseArrowBody(start, [param], true);
            }
            if (next.type === "punct" && next.value === "(") {
              this.advance();
              const args = this.parseArguments();
              if (this.is("=>") && !this.tok.nl) {
                const params = args.map((a, i): A.Pattern => {
                  if (a.type !== "SpreadElement") return this.toPattern(a, true);
                  if (i !== args.length - 1) this.error("A rest parameter must be the last parameter.", a.start);
                  return { type: "RestElement", argument: this.toPattern(a.argument, true), start: a.start, end: a.end };
                });
                return this.parseArrowBody(start, params, true);
              }
              const callee = this.node<A.Identifier>(start, { type: "Identifier", name: "async" });
              return this.node<A.CallExpression>(start, { type: "CallExpression", callee, arguments: args, optional: false });
            }
            break;
          }
        }
        if (RESERVED.has(t.value)) {
          if (t.value === "await" && this.topLevel) this.error(TOP_LEVEL_AWAIT_MESSAGE);
          if (t.value === "yield" || t.value === "await" || t.value === "let" || t.value === "static") this.error(`"${t.value}" is a reserved word, so it can't be used as a name here.`);
          break;
        }
        this.advance();
        const id = this.node<A.Identifier>(start, { type: "Identifier", name: t.value });
        if (this.is("=>") && !this.tok.nl) {
          this.checkBindingName(id.name, start);
          return this.parseArrowBody(start, [id], false);
        }
        if (t.value === "arguments" && this.fn.fieldInit && !this.fnStack.some((f) => !f.arrow && !f.fieldInit)) this.error("arguments isn't available in class field initializers.", start);
        return id;
      }
      default:
        break;
    }
    return this.unexpected();
  }

  private parseParenthesized(): A.Expression {
    const start = this.advance().start;
    if (this.is(")")) {
      this.advance();
      if (!this.is("=>")) this.unexpected('Expected "=>"');
      return this.parseArrowBody(start, [], false);
    }
    const items: A.Expression[] = [];
    let rest: A.RestElement | null = null;
    let trailingComma = false;
    for (;;) {
      if (this.is("...")) {
        const restStart = this.advance().start;
        rest = this.node<A.RestElement>(restStart, { type: "RestElement", argument: this.parseBindingTarget() });
        if (!this.is(")")) this.error("A rest parameter must be the last parameter.");
        break;
      }
      items.push(this.parseAssign(false));
      if (!this.eat(",")) break;
      if (this.is(")")) {
        trailingComma = true;
        break;
      }
    }
    this.expect(")");
    if (this.is("=>") && !this.tok.nl) {
      const params: A.Pattern[] = items.map((e) => this.toPattern(e, true));
      if (rest) params.push(rest);
      return this.parseArrowBody(start, params, false);
    }
    if (rest || trailingComma) this.unexpected('Expected "=>"');
    const expr = items.length === 1 ? items[0]! : this.node<A.SequenceExpression>(start, { type: "SequenceExpression", expressions: items });
    this.parenthesized.add(expr);
    return expr;
  }

  private parseArrayLiteral(): A.ArrayExpression {
    const start = this.advance().start;
    const elements: A.ArrayExpression["elements"] = [];
    while (!this.is("]")) {
      if (this.eat(",")) {
        elements.push(null);
        continue;
      }
      if (this.is("...")) {
        const spreadStart = this.advance().start;
        elements.push(this.node<A.SpreadElement>(spreadStart, { type: "SpreadElement", argument: this.parseAssign(false) }));
      } else elements.push(this.parseAssign(false));
      if (!this.is("]")) this.expect(",");
    }
    this.advance();
    return this.node<A.ArrayExpression>(start, { type: "ArrayExpression", elements });
  }

  private parseObjectLiteral(): A.ObjectExpression {
    const start = this.advance().start;
    const properties: A.ObjectExpression["properties"] = [];
    while (!this.is("}")) {
      const propStart = this.tok.start;
      if (this.is("...")) {
        this.advance();
        properties.push(this.node<A.SpreadElement>(propStart, { type: "SpreadElement", argument: this.parseAssign(false) }));
      } else properties.push(this.parseObjectProperty());
      if (!this.is("}")) this.expect(",");
    }
    this.advance();
    return this.node<A.ObjectExpression>(start, { type: "ObjectExpression", properties });
  }

  private parseObjectProperty(): A.Property {
    const start = this.tok.start;
    let isAsync = false;
    let generator = false;
    let kind: A.Property["kind"] = "init";
    const nextIsKey = () => {
      const next = this.peek();
      return next.type === "name" || next.type === "string" || next.type === "num" || (next.type === "punct" && (next.value === "[" || next.value === "*"));
    };
    if (this.isName("async") && nextIsKey() && !this.peek().nl) {
      this.advance();
      isAsync = true;
    }
    if (this.eat("*")) generator = true;
    if (!isAsync && !generator && (this.isName("get") || this.isName("set")) && nextIsKey() && !(this.peek().type === "punct" && this.peek().value === "*")) {
      kind = this.advance().value as "get" | "set";
    }
    const keyToken = this.tok;
    const { key, computed } = this.parsePropertyKey(false);
    if (this.is("(")) {
      const value = this.parseMethod(isAsync, generator, false);
      if (kind === "get" && value.params.length) this.error("A getter can't take parameters.", value.start);
      if (kind === "set" && value.params.length !== 1) this.error("A setter takes exactly one parameter.", value.start);
      return this.node<A.Property>(start, { type: "Property", key, computed, value, kind, method: kind === "init", shorthand: false });
    }
    if (kind !== "init" || isAsync || generator) this.unexpected('Expected "("');
    if (this.eat(":")) {
      const value = this.parseAssign(false);
      return this.node<A.Property>(start, { type: "Property", key, computed, value, kind, method: false, shorthand: false });
    }
    if (computed || keyToken.type !== "name" || keyToken.escaped) this.unexpected('Expected ":"');
    if (RESERVED.has(keyToken.value)) this.error(`"${keyToken.value}" is a reserved word, so it can't be a shorthand property.`, keyToken.start);
    const value = this.node<A.Identifier>(keyToken.start, { type: "Identifier", name: keyToken.value });
    const property = this.node<A.Property>(start, { type: "Property", key, computed: false, value, kind, method: false, shorthand: true });
    if (this.is("=")) {
      this.advance();
      property.coverInitializer = this.parseAssign(false);
      property.end = this.prevEnd;
      this.coverInits.add(property);
    }
    return property;
  }
}
