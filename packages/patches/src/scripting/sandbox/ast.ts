/** Syntax tree for the script sandbox: an ESTree-shaped subset with source offsets. */

interface Base {
  start: number;
  end: number;
}

export interface Identifier extends Base {
  type: "Identifier";
  name: string;
}

export interface PrivateIdentifier extends Base {
  type: "PrivateIdentifier";
  name: string;
}

export interface Literal extends Base {
  type: "Literal";
  value: string | number | boolean | null | bigint;
}

export interface RegExpLiteral extends Base {
  type: "RegExpLiteral";
  pattern: string;
  flags: string;
}

export interface TemplateElement {
  cooked: string | undefined;
  raw: string;
}

export interface TemplateLiteral extends Base {
  type: "TemplateLiteral";
  quasis: TemplateElement[];
  expressions: Expression[];
}

export interface TaggedTemplateExpression extends Base {
  type: "TaggedTemplateExpression";
  tag: Expression;
  quasi: TemplateLiteral;
}

export interface SpreadElement extends Base {
  type: "SpreadElement";
  argument: Expression;
}

export interface ArrayExpression extends Base {
  type: "ArrayExpression";
  elements: (Expression | SpreadElement | null)[];
}

export interface Property extends Base {
  type: "Property";
  key: Expression | PrivateIdentifier;
  computed: boolean;
  value: Expression;
  kind: "init" | "get" | "set";
  method: boolean;
  shorthand: boolean;
  /** `{ a = 1 }` written in an object literal: only valid when it turns into a pattern. */
  coverInitializer?: Expression;
}

export interface ObjectExpression extends Base {
  type: "ObjectExpression";
  properties: (Property | SpreadElement)[];
}

export interface FunctionNode extends Base {
  id: Identifier | null;
  params: Pattern[];
  body: BlockStatement | Expression;
  async: boolean;
  generator: boolean;
  /** Arrow function with an expression body. */
  expression: boolean;
}

export interface FunctionExpression extends FunctionNode {
  type: "FunctionExpression";
  body: BlockStatement;
}

export interface ArrowFunctionExpression extends FunctionNode {
  type: "ArrowFunctionExpression";
}

export interface FunctionDeclaration extends FunctionNode {
  type: "FunctionDeclaration";
  id: Identifier;
  body: BlockStatement;
}

export interface MethodDefinition extends Base {
  type: "MethodDefinition";
  key: Expression | PrivateIdentifier;
  computed: boolean;
  kind: "constructor" | "method" | "get" | "set";
  static: boolean;
  value: FunctionExpression;
}

export interface PropertyDefinition extends Base {
  type: "PropertyDefinition";
  key: Expression | PrivateIdentifier;
  computed: boolean;
  static: boolean;
  value: Expression | null;
}

export interface StaticBlock extends Base {
  type: "StaticBlock";
  body: Statement[];
}

export interface ClassNode extends Base {
  id: Identifier | null;
  superClass: Expression | null;
  body: (MethodDefinition | PropertyDefinition | StaticBlock)[];
}

export interface ClassExpression extends ClassNode {
  type: "ClassExpression";
}

export interface ClassDeclaration extends ClassNode {
  type: "ClassDeclaration";
  id: Identifier;
}

export interface UnaryExpression extends Base {
  type: "UnaryExpression";
  operator: "-" | "+" | "!" | "~" | "typeof" | "void" | "delete";
  argument: Expression;
}

export interface UpdateExpression extends Base {
  type: "UpdateExpression";
  operator: "++" | "--";
  prefix: boolean;
  argument: Expression;
}

export interface BinaryExpression extends Base {
  type: "BinaryExpression";
  operator: string;
  left: Expression | PrivateIdentifier;
  right: Expression;
}

export interface LogicalExpression extends Base {
  type: "LogicalExpression";
  operator: "||" | "&&" | "??";
  left: Expression;
  right: Expression;
}

export interface AssignmentExpression extends Base {
  type: "AssignmentExpression";
  operator: string;
  left: Pattern;
  right: Expression;
}

export interface ConditionalExpression extends Base {
  type: "ConditionalExpression";
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

export interface CallExpression extends Base {
  type: "CallExpression";
  callee: Expression | Super;
  arguments: (Expression | SpreadElement)[];
  optional: boolean;
}

export interface NewExpression extends Base {
  type: "NewExpression";
  callee: Expression;
  arguments: (Expression | SpreadElement)[];
}

export interface MemberExpression extends Base {
  type: "MemberExpression";
  object: Expression | Super;
  property: Expression | PrivateIdentifier;
  computed: boolean;
  optional: boolean;
}

export interface ChainExpression extends Base {
  type: "ChainExpression";
  expression: Expression;
}

export interface SequenceExpression extends Base {
  type: "SequenceExpression";
  expressions: Expression[];
}

export interface ThisExpression extends Base {
  type: "ThisExpression";
}

export interface Super extends Base {
  type: "Super";
}

export interface MetaProperty extends Base {
  type: "MetaProperty";
  meta: "new";
  property: "target";
}

export interface AwaitExpression extends Base {
  type: "AwaitExpression";
  argument: Expression;
}

export interface YieldExpression extends Base {
  type: "YieldExpression";
  argument: Expression | null;
  delegate: boolean;
}

export type Expression =
  | Identifier
  | Literal
  | RegExpLiteral
  | TemplateLiteral
  | TaggedTemplateExpression
  | ArrayExpression
  | ObjectExpression
  | FunctionExpression
  | ArrowFunctionExpression
  | ClassExpression
  | UnaryExpression
  | UpdateExpression
  | BinaryExpression
  | LogicalExpression
  | AssignmentExpression
  | ConditionalExpression
  | CallExpression
  | NewExpression
  | MemberExpression
  | ChainExpression
  | SequenceExpression
  | ThisExpression
  | MetaProperty
  | AwaitExpression
  | YieldExpression;

export interface AssignmentPattern extends Base {
  type: "AssignmentPattern";
  left: Pattern;
  right: Expression;
}

export interface RestElement extends Base {
  type: "RestElement";
  argument: Pattern;
}

export interface PatternProperty extends Base {
  type: "PatternProperty";
  key: Expression;
  computed: boolean;
  value: Pattern;
}

export interface ObjectPattern extends Base {
  type: "ObjectPattern";
  properties: (PatternProperty | RestElement)[];
}

export interface ArrayPattern extends Base {
  type: "ArrayPattern";
  elements: (Pattern | null)[];
}

/** Binding and assignment targets. Member expressions are only valid in assignments. */
export type Pattern = Identifier | MemberExpression | ObjectPattern | ArrayPattern | AssignmentPattern | RestElement;

export interface VariableDeclarator extends Base {
  type: "VariableDeclarator";
  id: Pattern;
  init: Expression | null;
}

export interface VariableDeclaration extends Base {
  type: "VariableDeclaration";
  kind: "var" | "let" | "const";
  declarations: VariableDeclarator[];
}

export interface ExpressionStatement extends Base {
  type: "ExpressionStatement";
  expression: Expression;
}

export interface BlockStatement extends Base {
  type: "BlockStatement";
  body: Statement[];
}

export interface EmptyStatement extends Base {
  type: "EmptyStatement";
}

export interface DebuggerStatement extends Base {
  type: "DebuggerStatement";
}

export interface IfStatement extends Base {
  type: "IfStatement";
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
}

export interface ForStatement extends Base {
  type: "ForStatement";
  init: VariableDeclaration | Expression | null;
  test: Expression | null;
  update: Expression | null;
  body: Statement;
}

export interface ForInStatement extends Base {
  type: "ForInStatement";
  left: VariableDeclaration | Pattern;
  right: Expression;
  body: Statement;
}

export interface ForOfStatement extends Base {
  type: "ForOfStatement";
  left: VariableDeclaration | Pattern;
  right: Expression;
  body: Statement;
  await: boolean;
}

export interface WhileStatement extends Base {
  type: "WhileStatement";
  test: Expression;
  body: Statement;
}

export interface DoWhileStatement extends Base {
  type: "DoWhileStatement";
  test: Expression;
  body: Statement;
}

export interface ReturnStatement extends Base {
  type: "ReturnStatement";
  argument: Expression | null;
}

export interface BreakStatement extends Base {
  type: "BreakStatement";
  label: string | null;
}

export interface ContinueStatement extends Base {
  type: "ContinueStatement";
  label: string | null;
}

export interface ThrowStatement extends Base {
  type: "ThrowStatement";
  argument: Expression;
}

export interface CatchClause extends Base {
  type: "CatchClause";
  param: Pattern | null;
  body: BlockStatement;
}

export interface TryStatement extends Base {
  type: "TryStatement";
  block: BlockStatement;
  handler: CatchClause | null;
  finalizer: BlockStatement | null;
}

export interface SwitchCase extends Base {
  type: "SwitchCase";
  test: Expression | null;
  consequent: Statement[];
}

export interface SwitchStatement extends Base {
  type: "SwitchStatement";
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface LabeledStatement extends Base {
  type: "LabeledStatement";
  label: string;
  body: Statement;
}

export interface ExportSpecifier {
  local: string;
  exported: string;
}

export interface ExportNamedDeclaration extends Base {
  type: "ExportNamedDeclaration";
  declaration: VariableDeclaration | FunctionDeclaration | ClassDeclaration | null;
  specifiers: ExportSpecifier[];
}

export interface ExportDefaultDeclaration extends Base {
  type: "ExportDefaultDeclaration";
  declaration: Expression | FunctionDeclaration | ClassDeclaration;
}

export type Statement =
  | VariableDeclaration
  | FunctionDeclaration
  | ClassDeclaration
  | ExpressionStatement
  | BlockStatement
  | EmptyStatement
  | DebuggerStatement
  | IfStatement
  | ForStatement
  | ForInStatement
  | ForOfStatement
  | WhileStatement
  | DoWhileStatement
  | ReturnStatement
  | BreakStatement
  | ContinueStatement
  | ThrowStatement
  | TryStatement
  | SwitchStatement
  | LabeledStatement
  | ExportNamedDeclaration
  | ExportDefaultDeclaration;

export interface Program extends Base {
  type: "Program";
  body: Statement[];
  /** "module": a native script. "function": an Origami-style file body that returns its patch. */
  kind: "module" | "function";
}

export type Node = Expression | Pattern | Statement | Program | PrivateIdentifier | Super | SpreadElement | Property | PatternProperty | VariableDeclarator | CatchClause | SwitchCase | MethodDefinition | PropertyDefinition | StaticBlock;
