export enum TokenType {
  // Literals
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',
  IDENTIFIER = 'IDENTIFIER',

  // Operators
  WALRUS = 'WALRUS',           // :=
  PLUS = 'PLUS',               // +
  PIPE = 'PIPE',               // |
  PIPE_PIPE = 'PIPE_PIPE',     // >> (pipe operator)
  COLON = 'COLON',             // :
  DOT = 'DOT',                 // .
  COMMA = 'COMMA',             // ,
  HASH = 'HASH',               // #
  DOUBLE_HASH = 'DOUBLE_HASH', // ##
  TRIPLE_HASH = 'TRIPLE_HASH', // ###
  AT = 'AT',                   // @
  DOLLAR = 'DOLLAR',           // $
  UNDERSCORE = 'UNDERSCORE',   // _
  EQUALS = 'EQUALS',           // =
  STAR = 'STAR',               // *
  MINUS = 'MINUS',             // -
  SLASH = 'SLASH',             // /

  // Comparison
  GT = 'GT',                   // >
  LT = 'LT',                   // <
  GTE = 'GTE',                 // >=
  LTE = 'LTE',                 // <=
  EQ = 'EQ',                   // ==
  NEQ = 'NEQ',                 // !=
  PLUS_EQ = 'PLUS_EQ',        // +=

  // Delimiters
  LPAREN = 'LPAREN',           // (
  RPAREN = 'RPAREN',           // )
  LBRACKET = 'LBRACKET',       // [
  RBRACKET = 'RBRACKET',       // ]
  LBRACE = 'LBRACE',           // {
  RBRACE = 'RBRACE',           // }
  LANGLE = 'LANGLE',           // < (tag open)
  RANGLE = 'RANGLE',           // > (tag close)

  // Keywords
  IF = 'IF',
  ELIF = 'ELIF',
  ELSE = 'ELSE',
  FOR = 'FOR',
  IN = 'IN',
  WHILE = 'WHILE',
  UNTIL = 'UNTIL',
  TRY = 'TRY',
  EXCEPT = 'EXCEPT',
  FINALLY = 'FINALLY',
  ASSERT = 'ASSERT',
  REQUIRE = 'REQUIRE',
  AGENT = 'AGENT',
  MACRO = 'MACRO',
  IMPORT = 'IMPORT',
  AS = 'AS',
  USE = 'USE',
  MCP = 'MCP',
  PLUGIN = 'PLUGIN',
  DISCOVER = 'DISCOVER',
  FORK = 'FORK',
  EMIT = 'EMIT',
  ON = 'ON',
  LISTEN = 'LISTEN',
  STREAM = 'STREAM',
  RETURN = 'RETURN',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  PERMISSIONS = 'PERMISSIONS',
  BREAK = 'BREAK',

  // Structure
  NEWLINE = 'NEWLINE',
  INDENT = 'INDENT',
  DEDENT = 'DEDENT',
  EOF = 'EOF',

  // Special
  COMMENT = 'COMMENT',
  SECTION_COMMENT = 'SECTION_COMMENT',
  DOCSTRING = 'DOCSTRING',
  STRING_INTERP_START = 'STRING_INTERP_START',
  STRING_INTERP_END = 'STRING_INTERP_END',
}

export const KEYWORDS: Record<string, TokenType> = {
  'if': TokenType.IF,
  'elif': TokenType.ELIF,
  'else': TokenType.ELSE,
  'for': TokenType.FOR,
  'in': TokenType.IN,
  'while': TokenType.WHILE,
  'until': TokenType.UNTIL,
  'try': TokenType.TRY,
  'except': TokenType.EXCEPT,
  'finally': TokenType.FINALLY,
  'assert': TokenType.ASSERT,
  'require': TokenType.REQUIRE,
  'agent': TokenType.AGENT,
  'macro': TokenType.MACRO,
  'import': TokenType.IMPORT,
  'as': TokenType.AS,
  'Use': TokenType.USE,
  'MCP': TokenType.MCP,
  'Plugin': TokenType.PLUGIN,
  'Discover': TokenType.DISCOVER,
  'fork': TokenType.FORK,
  'emit': TokenType.EMIT,
  'on': TokenType.ON,
  'listen': TokenType.LISTEN,
  'Stream': TokenType.STREAM,
  'return': TokenType.RETURN,
  'and': TokenType.AND,
  'or': TokenType.OR,
  'not': TokenType.NOT,
  'true': TokenType.BOOLEAN,
  'false': TokenType.BOOLEAN,
  'null': TokenType.NULL,
  'permissions': TokenType.PERMISSIONS,
  'break': TokenType.BREAK,
};

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export interface LexerError {
  message: string;
  line: number;
  column: number;
}
