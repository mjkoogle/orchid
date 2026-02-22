export type Node =
  | Program
  | Metadata
  | Assignment
  | Operation
  | NamespacedOperation
  | ForkExpression
  | IfStatement
  | ForStatement
  | WhileStatement
  | UntilStatement
  | TryStatement
  | AssertStatement
  | RequireStatement
  | AgentDef
  | MacroDef
  | ImportStatement
  | UseStatement
  | EmitStatement
  | OnStatement
  | ReturnStatement
  | BreakStatement
  | AtomicBlock
  | PipeExpression
  | MergeExpression
  | AlternativeExpression
  | StringLiteral
  | InterpolatedString
  | NumberLiteral
  | BooleanLiteral
  | NullLiteral
  | ListLiteral
  | DictLiteral
  | Identifier
  | ImplicitContext
  | MemberExpression
  | ComparisonExpression
  | LogicalExpression
  | UnaryExpression
  | ArithmeticExpression
  | InExpression
  | SectionComment
  | PermissionsBlock
  | Tag
  | IndexExpression
  | ListenExpression
  | StreamExpression
  | PlusAssignment;

export interface Position {
  line: number;
  column: number;
}

export interface BaseNode {
  position: Position;
}

export interface Program extends BaseNode {
  type: 'Program';
  metadata: Metadata[];
  body: Node[];
}

export interface Metadata extends BaseNode {
  type: 'Metadata';
  directive: string;
  value: Node;
}

export interface Assignment extends BaseNode {
  type: 'Assignment';
  target: Identifier | Identifier[]; // Identifier for simple, array for destructuring
  value: Node;
}

export interface PlusAssignment extends BaseNode {
  type: 'PlusAssignment';
  target: Identifier;
  value: Node;
}

export interface Operation extends BaseNode {
  type: 'Operation';
  name: string;
  args: Argument[];
  tags: Tag[];
}

export interface NamespacedOperation extends BaseNode {
  type: 'NamespacedOperation';
  namespace: string;
  name: string;
  args: Argument[];
  tags: Tag[];
}

export interface Argument {
  name?: string;  // for keyword arguments
  value: Node;
}

export interface Tag extends BaseNode {
  type: 'Tag';
  name: string;
  value?: Node;
}

export interface ForkExpression extends BaseNode {
  type: 'ForkExpression';
  count?: number;
  branches: ForkBranch[];
  forLoop?: ForStatement;
}

export interface ForkBranch {
  name?: string;
  body: Node[];
}

export interface IfStatement extends BaseNode {
  type: 'IfStatement';
  condition: Node;
  body: Node[];
  elifs: { condition: Node; body: Node[] }[];
  elseBody?: Node[];
}

export interface ForStatement extends BaseNode {
  type: 'ForStatement';
  variable: string;
  iterable: Node;
  body: Node[];
}

export interface WhileStatement extends BaseNode {
  type: 'WhileStatement';
  condition: Node;
  body: Node[];
}

export interface UntilStatement extends BaseNode {
  type: 'UntilStatement';
  condition: Node;
  tags: Tag[];
  body: Node[];
}

export interface TryStatement extends BaseNode {
  type: 'TryStatement';
  body: Node[];
  excepts: { errorType?: string; body: Node[] }[];
  finallyBody?: Node[];
}

export interface AssertStatement extends BaseNode {
  type: 'AssertStatement';
  condition: Node;
  message?: string;
}

export interface RequireStatement extends BaseNode {
  type: 'RequireStatement';
  condition: Node;
  message?: string;
}

export interface AgentDef extends BaseNode {
  type: 'AgentDef';
  name: string;
  params: Parameter[];
  docstring?: string;
  permissions?: PermissionsBlock;
  body: Node[];
}

export interface MacroDef extends BaseNode {
  type: 'MacroDef';
  name: string;
  params: Parameter[];
  tags: Tag[];
  docstring?: string;
  body: Node[];
}

export interface Parameter {
  name: string;
  defaultValue?: Node;
}

export interface PermissionsBlock extends BaseNode {
  type: 'PermissionsBlock';
  permissions: { namespace: string; actions: string[] }[];
}

export interface ImportStatement extends BaseNode {
  type: 'ImportStatement';
  path: string;
  alias?: string;
}

export interface UseStatement extends BaseNode {
  type: 'UseStatement';
  kind: 'MCP' | 'Plugin';
  name: string;
  alias?: string;
}

export interface EmitStatement extends BaseNode {
  type: 'EmitStatement';
  event: string;
  payload?: Node;
}

export interface OnStatement extends BaseNode {
  type: 'OnStatement';
  event: string;
  variable: string;
  body: Node[];
}

export interface ReturnStatement extends BaseNode {
  type: 'ReturnStatement';
  value?: Node;
}

export interface BreakStatement extends BaseNode {
  type: 'BreakStatement';
}

export interface AtomicBlock extends BaseNode {
  type: 'AtomicBlock';
  body: Node[];
}

export interface PipeExpression extends BaseNode {
  type: 'PipeExpression';
  left: Node;
  right: Node;
}

export interface MergeExpression extends BaseNode {
  type: 'MergeExpression';
  left: Node;
  right: Node;
}

export interface AlternativeExpression extends BaseNode {
  type: 'AlternativeExpression';
  left: Node;
  right: Node;
}

export interface ComparisonExpression extends BaseNode {
  type: 'ComparisonExpression';
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  left: Node;
  right: Node;
}

export interface LogicalExpression extends BaseNode {
  type: 'LogicalExpression';
  operator: 'and' | 'or';
  left: Node;
  right: Node;
}

export interface UnaryExpression extends BaseNode {
  type: 'UnaryExpression';
  operator: 'not' | '-';
  operand: Node;
}

export interface ArithmeticExpression extends BaseNode {
  type: 'ArithmeticExpression';
  operator: '+' | '-' | '*' | '/';
  left: Node;
  right: Node;
}

export interface InExpression extends BaseNode {
  type: 'InExpression';
  left: Node;
  right: Node;
}

export interface StringLiteral extends BaseNode {
  type: 'StringLiteral';
  value: string;
}

export interface InterpolatedString extends BaseNode {
  type: 'InterpolatedString';
  parts: (string | Node)[];
}

export interface NumberLiteral extends BaseNode {
  type: 'NumberLiteral';
  value: number;
  suffix?: string; // e.g., 's' for seconds
  raw: string;
}

export interface BooleanLiteral extends BaseNode {
  type: 'BooleanLiteral';
  value: boolean;
}

export interface NullLiteral extends BaseNode {
  type: 'NullLiteral';
}

export interface ListLiteral extends BaseNode {
  type: 'ListLiteral';
  elements: Node[];
}

export interface DictLiteral extends BaseNode {
  type: 'DictLiteral';
  entries: { key: string; value: Node }[];
}

export interface Identifier extends BaseNode {
  type: 'Identifier';
  name: string;
}

export interface ImplicitContext extends BaseNode {
  type: 'ImplicitContext';
}

export interface MemberExpression extends BaseNode {
  type: 'MemberExpression';
  object: Node;
  property: string;
}

export interface IndexExpression extends BaseNode {
  type: 'IndexExpression';
  object: Node;
  index: Node;
}

export interface SectionComment extends BaseNode {
  type: 'SectionComment';
  text: string;
}

export interface ListenExpression extends BaseNode {
  type: 'ListenExpression';
}

export interface StreamExpression extends BaseNode {
  type: 'StreamExpression';
  source: Node;
}
