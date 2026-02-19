import { Token, TokenType } from '../lexer/tokens';
import * as AST from './ast';

export class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  parse(tokens: Token[]): AST.Program {
    this.tokens = tokens;
    this.pos = 0;

    const metadata: AST.Metadata[] = [];
    const body: AST.Node[] = [];

    this.skipNewlines();

    // Parse metadata header
    while (this.check(TokenType.AT)) {
      metadata.push(this.parseMetadata());
      this.skipNewlines();
    }

    // Parse body
    while (!this.check(TokenType.EOF)) {
      this.skipNewlines();
      if (this.check(TokenType.EOF)) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }

    return {
      type: 'Program',
      metadata,
      body,
      position: { line: 1, column: 1 },
    };
  }

  // ─── Metadata ──────────────────────────────────────────

  private parseMetadata(): AST.Metadata {
    const pos = this.position();
    this.expect(TokenType.AT);
    const directive = this.expect(TokenType.IDENTIFIER).value;
    let value: AST.Node;

    if (directive === 'requires') {
      // @requires can have comma-separated MCP/Plugin calls
      const items: AST.Node[] = [];
      items.push(this.parseExpression());
      while (this.match(TokenType.COMMA)) {
        items.push(this.parseExpression());
      }
      if (items.length === 1) {
        value = items[0];
      } else {
        value = { type: 'ListLiteral', elements: items, position: pos };
      }
    } else {
      value = this.parseExpression();
    }

    this.skipNewlines();
    return { type: 'Metadata', directive, value, position: pos };
  }

  // ─── Statements ────────────────────────────────────────

  private parseStatement(): AST.Node | null {
    this.skipNewlines();
    if (this.check(TokenType.EOF)) return null;

    const tok = this.peek();

    // Section comments
    if (tok.type === TokenType.SECTION_COMMENT) {
      return this.parseSectionComment();
    }

    // Atomic blocks
    if (tok.type === TokenType.TRIPLE_HASH) {
      return this.parseAtomicBlock();
    }

    // Control flow
    if (tok.type === TokenType.IF) return this.parseIfStatement();
    if (tok.type === TokenType.FOR) return this.parseForStatement();
    if (tok.type === TokenType.WHILE) return this.parseWhileStatement();
    if (tok.type === TokenType.UNTIL) return this.parseUntilStatement();
    if (tok.type === TokenType.TRY) return this.parseTryStatement();
    if (tok.type === TokenType.ASSERT) return this.parseAssertStatement();
    if (tok.type === TokenType.REQUIRE) return this.parseRequireStatement();

    // Definitions
    if (tok.type === TokenType.AGENT) return this.parseAgentDef();
    if (tok.type === TokenType.MACRO) return this.parseMacroDef();
    if (tok.type === TokenType.IMPORT) return this.parseImportStatement();
    if (tok.type === TokenType.USE) return this.parseUseStatement();

    // Events
    if (tok.type === TokenType.EMIT) return this.parseEmitStatement();
    if (tok.type === TokenType.ON) return this.parseOnStatement();

    // Return
    if (tok.type === TokenType.RETURN) return this.parseReturnStatement();

    // Break
    if (tok.type === TokenType.BREAK) return this.parseBreakStatement();

    // Permissions block
    if (tok.type === TokenType.PERMISSIONS) return this.parsePermissionsBlock();

    // Assignment or expression
    return this.parseAssignmentOrExpression();
  }

  private parseSectionComment(): AST.SectionComment {
    const tok = this.advance();
    return {
      type: 'SectionComment',
      text: tok.value,
      position: { line: tok.line, column: tok.column },
    };
  }

  private parseAtomicBlock(): AST.AtomicBlock {
    const pos = this.position();
    this.expect(TokenType.TRIPLE_HASH);
    this.skipNewlines();

    const body: AST.Node[] = [];
    while (!this.check(TokenType.TRIPLE_HASH) && !this.check(TokenType.EOF)) {
      this.skipNewlines();
      if (this.check(TokenType.TRIPLE_HASH)) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }

    this.expect(TokenType.TRIPLE_HASH);
    this.skipNewlines();
    return { type: 'AtomicBlock', body, position: pos };
  }

  // ─── Control Flow ──────────────────────────────────────

  private parseIfStatement(): AST.IfStatement {
    const pos = this.position();
    this.expect(TokenType.IF);
    const condition = this.parseExpression();
    this.expect(TokenType.COLON);
    const body = this.parseBlock();

    const elifs: { condition: AST.Node; body: AST.Node[] }[] = [];
    while (this.check(TokenType.ELIF)) {
      this.advance();
      const elifCondition = this.parseExpression();
      this.expect(TokenType.COLON);
      const elifBody = this.parseBlock();
      elifs.push({ condition: elifCondition, body: elifBody });
    }

    let elseBody: AST.Node[] | undefined;
    if (this.check(TokenType.ELSE)) {
      this.advance();
      this.expect(TokenType.COLON);
      elseBody = this.parseBlock();
    }

    return { type: 'IfStatement', condition, body, elifs, elseBody, position: pos };
  }

  private parseForStatement(): AST.ForStatement {
    const pos = this.position();
    this.expect(TokenType.FOR);
    const variable = this.expect(TokenType.IDENTIFIER).value;
    this.expect(TokenType.IN);
    const iterable = this.parseExpression();
    this.expect(TokenType.COLON);
    const body = this.parseBlock();
    return { type: 'ForStatement', variable, iterable, body, position: pos };
  }

  private parseWhileStatement(): AST.WhileStatement {
    const pos = this.position();
    this.expect(TokenType.WHILE);
    const condition = this.parseExpression();
    this.expect(TokenType.COLON);
    const body = this.parseBlock();
    return { type: 'WhileStatement', condition, body, position: pos };
  }

  private parseUntilStatement(): AST.UntilStatement {
    const pos = this.position();
    this.expect(TokenType.UNTIL);
    const condition = this.parseExpression();
    const tags = this.parseTags();
    this.expect(TokenType.COLON);
    const body = this.parseBlock();
    return { type: 'UntilStatement', condition, tags, body, position: pos };
  }

  private parseTryStatement(): AST.TryStatement {
    const pos = this.position();
    this.expect(TokenType.TRY);
    this.expect(TokenType.COLON);
    const body = this.parseBlock();

    const excepts: { errorType?: string; body: AST.Node[] }[] = [];
    while (this.check(TokenType.EXCEPT)) {
      this.advance();
      let errorType: string | undefined;
      if (this.check(TokenType.IDENTIFIER)) {
        errorType = this.advance().value;
      }
      this.expect(TokenType.COLON);
      const exceptBody = this.parseBlock();
      excepts.push({ errorType, body: exceptBody });
    }

    let finallyBody: AST.Node[] | undefined;
    if (this.check(TokenType.FINALLY)) {
      this.advance();
      this.expect(TokenType.COLON);
      finallyBody = this.parseBlock();
    }

    return { type: 'TryStatement', body, excepts, finallyBody, position: pos };
  }

  private parseAssertStatement(): AST.AssertStatement {
    const pos = this.position();
    this.expect(TokenType.ASSERT);
    const condition = this.parseExpression();
    let message: string | undefined;
    if (this.match(TokenType.COMMA)) {
      message = this.expect(TokenType.STRING).value;
    }
    return { type: 'AssertStatement', condition, message, position: pos };
  }

  private parseRequireStatement(): AST.RequireStatement {
    const pos = this.position();
    this.expect(TokenType.REQUIRE);
    const condition = this.parseExpression();
    let message: string | undefined;
    if (this.match(TokenType.COMMA)) {
      message = this.expect(TokenType.STRING).value;
    }
    return { type: 'RequireStatement', condition, message, position: pos };
  }

  // ─── Definitions ───────────────────────────────────────

  private parseAgentDef(): AST.AgentDef {
    const pos = this.position();
    this.expect(TokenType.AGENT);
    const name = this.expect(TokenType.IDENTIFIER).value;
    this.expect(TokenType.LPAREN);
    const params = this.parseParams();
    this.expect(TokenType.RPAREN);
    this.expect(TokenType.COLON);

    this.skipNewlines();
    this.expect(TokenType.INDENT);

    let docstring: string | undefined;
    if (this.check(TokenType.DOCSTRING)) {
      docstring = this.advance().value;
      this.skipNewlines();
    }

    let permissions: AST.PermissionsBlock | undefined;
    if (this.check(TokenType.PERMISSIONS)) {
      permissions = this.parsePermissionsBlock() as AST.PermissionsBlock;
      this.skipNewlines();
    }

    const body: AST.Node[] = [];
    while (!this.check(TokenType.DEDENT) && !this.check(TokenType.EOF)) {
      this.skipNewlines();
      if (this.check(TokenType.DEDENT)) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    if (this.check(TokenType.DEDENT)) this.advance();

    return { type: 'AgentDef', name, params, docstring, permissions, body, position: pos };
  }

  private parseMacroDef(): AST.MacroDef {
    const pos = this.position();
    this.expect(TokenType.MACRO);
    const name = this.expect(TokenType.IDENTIFIER).value;
    this.expect(TokenType.LPAREN);
    const params = this.parseParams();
    this.expect(TokenType.RPAREN);
    const tags = this.parseTags();
    this.expect(TokenType.COLON);

    this.skipNewlines();
    this.expect(TokenType.INDENT);

    let docstring: string | undefined;
    if (this.check(TokenType.DOCSTRING)) {
      docstring = this.advance().value;
      this.skipNewlines();
    }

    const body: AST.Node[] = [];
    while (!this.check(TokenType.DEDENT) && !this.check(TokenType.EOF)) {
      this.skipNewlines();
      if (this.check(TokenType.DEDENT)) break;
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }
    if (this.check(TokenType.DEDENT)) this.advance();

    return { type: 'MacroDef', name, params, tags, docstring, body, position: pos };
  }

  private parseParams(): AST.Parameter[] {
    const params: AST.Parameter[] = [];
    if (this.check(TokenType.RPAREN)) return params;

    params.push(this.parseParam());
    while (this.match(TokenType.COMMA)) {
      params.push(this.parseParam());
    }
    return params;
  }

  private parseParam(): AST.Parameter {
    const name = this.expect(TokenType.IDENTIFIER).value;
    let defaultValue: AST.Node | undefined;
    if (this.match(TokenType.EQUALS)) {
      defaultValue = this.parseExpression();
    }
    return { name, defaultValue };
  }

  private parsePermissionsBlock(): AST.PermissionsBlock {
    const pos = this.position();
    this.expect(TokenType.PERMISSIONS);
    this.expect(TokenType.COLON);
    this.skipNewlines();
    this.expect(TokenType.INDENT);

    const permissions: { namespace: string; actions: string[] }[] = [];
    while (!this.check(TokenType.DEDENT) && !this.check(TokenType.EOF)) {
      this.skipNewlines();
      if (this.check(TokenType.DEDENT)) break;
      const ns = this.expect(TokenType.IDENTIFIER).value;
      this.expect(TokenType.COLON);
      this.expect(TokenType.LBRACKET);
      const actions: string[] = [];
      if (!this.check(TokenType.RBRACKET)) {
        actions.push(this.expect(TokenType.IDENTIFIER).value);
        while (this.match(TokenType.COMMA)) {
          actions.push(this.expect(TokenType.IDENTIFIER).value);
        }
      }
      this.expect(TokenType.RBRACKET);
      permissions.push({ namespace: ns, actions });
      this.skipNewlines();
    }
    if (this.check(TokenType.DEDENT)) this.advance();

    return { type: 'PermissionsBlock', permissions, position: pos };
  }

  private parseImportStatement(): AST.ImportStatement {
    const pos = this.position();
    this.expect(TokenType.IMPORT);
    // Path can be a series of identifiers separated by / and .
    let path = this.expect(TokenType.IDENTIFIER).value;
    while (this.match(TokenType.DOT)) {
      path += '.' + this.expect(TokenType.IDENTIFIER).value;
    }
    // Handle path separators: check for / via IDENTIFIER patterns
    // Actually the path might contain / which isn't a token. Let's handle it differently.
    // For now, accept dot-separated or a string path
    if (path.endsWith('.orch')) {
      // already good
    }

    let alias: string | undefined;
    if (this.check(TokenType.AS)) {
      this.advance();
      alias = this.expect(TokenType.IDENTIFIER).value;
    }

    return { type: 'ImportStatement', path, alias, position: pos };
  }

  private parseUseStatement(): AST.UseStatement {
    const pos = this.position();
    this.expect(TokenType.USE);
    let kind: 'MCP' | 'Plugin';
    if (this.check(TokenType.MCP)) {
      kind = 'MCP';
      this.advance();
    } else if (this.check(TokenType.PLUGIN)) {
      kind = 'Plugin';
      this.advance();
    } else {
      throw this.error('Expected MCP or Plugin');
    }
    this.expect(TokenType.LPAREN);
    const name = this.expect(TokenType.STRING).value;
    this.expect(TokenType.RPAREN);
    let alias: string | undefined;
    if (this.check(TokenType.AS)) {
      this.advance();
      alias = this.expect(TokenType.IDENTIFIER).value;
    }
    return { type: 'UseStatement', kind, name, alias, position: pos };
  }

  // ─── Events ────────────────────────────────────────────

  private parseEmitStatement(): AST.EmitStatement {
    const pos = this.position();
    this.expect(TokenType.EMIT);
    const event = this.expect(TokenType.IDENTIFIER).value;
    let payload: AST.Node | undefined;
    if (this.match(TokenType.LPAREN)) {
      if (!this.check(TokenType.RPAREN)) {
        payload = this.parseExpression();
      }
      this.expect(TokenType.RPAREN);
    }
    return { type: 'EmitStatement', event, payload, position: pos };
  }

  private parseOnStatement(): AST.OnStatement {
    const pos = this.position();
    this.expect(TokenType.ON);
    const event = this.expect(TokenType.IDENTIFIER).value;
    this.expect(TokenType.AS);
    const variable = this.expect(TokenType.IDENTIFIER).value;
    this.expect(TokenType.COLON);
    const body = this.parseBlock();
    return { type: 'OnStatement', event, variable, body, position: pos };
  }

  private parseReturnStatement(): AST.ReturnStatement {
    const pos = this.position();
    this.expect(TokenType.RETURN);
    let value: AST.Node | undefined;
    if (!this.check(TokenType.NEWLINE) && !this.check(TokenType.EOF) && !this.check(TokenType.DEDENT)) {
      value = this.parseExpression();
    }
    return { type: 'ReturnStatement', value, position: pos };
  }

  private parseBreakStatement(): AST.BreakStatement {
    const pos = this.position();
    this.expect(TokenType.BREAK);
    return { type: 'BreakStatement', position: pos };
  }

  // ─── Assignment or Expression ──────────────────────────

  private parseAssignmentOrExpression(): AST.Node {
    const pos = this.position();

    // Check for destructuring assignment: [a, b, c] :=
    if (this.check(TokenType.LBRACKET)) {
      const savedPos = this.pos;
      try {
        const targets = this.parseDestructure();
        if (this.match(TokenType.WALRUS)) {
          const value = this.parseExpression();
          return { type: 'Assignment', target: targets, value, position: pos };
        }
      } catch {
        // not a destructuring, fall through
      }
      this.pos = savedPos;
    }

    // Check for simple assignment: identifier :=
    if (this.check(TokenType.IDENTIFIER)) {
      const savedPos = this.pos;
      const name = this.advance().value;

      if (this.match(TokenType.WALRUS)) {
        const value = this.parseExpression();
        const target: AST.Identifier = { type: 'Identifier', name, position: pos };
        return { type: 'Assignment', target, value, position: pos };
      }

      if (this.match(TokenType.PLUS_EQ)) {
        const value = this.parseExpression();
        const target: AST.Identifier = { type: 'Identifier', name, position: pos };
        return { type: 'PlusAssignment', target, value, position: pos };
      }

      // Not an assignment, backtrack and parse as expression
      this.pos = savedPos;
    }

    // Check for _attempts := style (underscore-prefixed assignments)
    if (this.check(TokenType.UNDERSCORE)) {
      const savedPos = this.pos;
      this.advance();
      if (this.check(TokenType.IDENTIFIER)) {
        const rest = this.advance().value;
        const name = '_' + rest;
        if (this.match(TokenType.WALRUS)) {
          const value = this.parseExpression();
          const target: AST.Identifier = { type: 'Identifier', name, position: pos };
          return { type: 'Assignment', target, value, position: pos };
        }
        if (this.match(TokenType.PLUS_EQ)) {
          const value = this.parseExpression();
          const target: AST.Identifier = { type: 'Identifier', name, position: pos };
          return { type: 'PlusAssignment', target, value, position: pos };
        }
      }
      this.pos = savedPos;
    }

    return this.parseExpression();
  }

  private parseDestructure(): AST.Identifier[] {
    this.expect(TokenType.LBRACKET);
    const ids: AST.Identifier[] = [];
    ids.push({
      type: 'Identifier',
      name: this.expect(TokenType.IDENTIFIER).value,
      position: this.position(),
    });
    while (this.match(TokenType.COMMA)) {
      ids.push({
        type: 'Identifier',
        name: this.expect(TokenType.IDENTIFIER).value,
        position: this.position(),
      });
    }
    this.expect(TokenType.RBRACKET);
    return ids;
  }

  // ─── Expressions ───────────────────────────────────────

  private parseExpression(): AST.Node {
    return this.parsePipe();
  }

  private parsePipe(): AST.Node {
    let left = this.parseAlternative();
    while (this.match(TokenType.PIPE_PIPE)) {
      const right = this.parseAlternative();
      left = {
        type: 'PipeExpression',
        left,
        right,
        position: left.position,
      };
    }
    return left;
  }

  private parseAlternative(): AST.Node {
    let left = this.parseLogicalOr();
    while (this.match(TokenType.PIPE)) {
      const right = this.parseLogicalOr();
      left = {
        type: 'AlternativeExpression',
        left,
        right,
        position: left.position,
      };
    }
    return left;
  }

  private parseLogicalOr(): AST.Node {
    let left = this.parseLogicalAnd();
    while (this.check(TokenType.OR)) {
      this.advance();
      const right = this.parseLogicalAnd();
      left = {
        type: 'LogicalExpression',
        operator: 'or',
        left,
        right,
        position: left.position,
      };
    }
    return left;
  }

  private parseLogicalAnd(): AST.Node {
    let left = this.parseNot();
    while (this.check(TokenType.AND)) {
      this.advance();
      const right = this.parseNot();
      left = {
        type: 'LogicalExpression',
        operator: 'and',
        left,
        right,
        position: left.position,
      };
    }
    return left;
  }

  private parseNot(): AST.Node {
    if (this.check(TokenType.NOT)) {
      const pos = this.position();
      this.advance();
      const operand = this.parseNot();
      return { type: 'UnaryExpression', operator: 'not', operand, position: pos };
    }
    return this.parseComparison();
  }

  private parseComparison(): AST.Node {
    let left = this.parseIn();
    while (
      this.check(TokenType.GT) ||
      this.check(TokenType.LT) ||
      this.check(TokenType.GTE) ||
      this.check(TokenType.LTE) ||
      this.check(TokenType.EQ) ||
      this.check(TokenType.NEQ)
    ) {
      const op = this.advance().value as '>' | '<' | '>=' | '<=' | '==' | '!=';
      const right = this.parseIn();
      left = {
        type: 'ComparisonExpression',
        operator: op,
        left,
        right,
        position: left.position,
      };
    }
    return left;
  }

  private parseIn(): AST.Node {
    let left = this.parseMerge();
    if (this.check(TokenType.IN)) {
      this.advance();
      const right = this.parseMerge();
      left = {
        type: 'InExpression',
        left,
        right,
        position: left.position,
      };
    }
    return left;
  }

  private parseMerge(): AST.Node {
    let left = this.parseAddition();
    while (this.check(TokenType.PLUS) && !this.isAssignmentContext()) {
      // Distinguish between merge (+) and arithmetic (+)
      // Merge applies when both sides are operation results / identifiers
      const savedPos = this.pos;
      this.advance();
      const right = this.parseAddition();
      left = {
        type: 'MergeExpression',
        left,
        right,
        position: left.position,
      };
    }
    return left;
  }

  private isAssignmentContext(): boolean {
    // Look ahead past the + to see if there's a := coming
    return false;
  }

  private parseAddition(): AST.Node {
    let left = this.parseUnary();

    while (this.check(TokenType.STAR) || this.check(TokenType.MINUS)) {
      const op = this.advance().value as '*' | '-';
      const right = this.parseUnary();
      left = {
        type: 'ArithmeticExpression',
        operator: op,
        left,
        right,
        position: left.position,
      };
    }
    return left;
  }

  private parseUnary(): AST.Node {
    if (this.check(TokenType.MINUS)) {
      const pos = this.position();
      this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryExpression', operator: '-', operand, position: pos };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): AST.Node {
    let node = this.parsePrimary();

    // Handle member access (dot notation), call syntax, and tags
    while (true) {
      if (this.check(TokenType.DOT)) {
        this.advance();
        const prop = this.expect(TokenType.IDENTIFIER).value;
        node = {
          type: 'MemberExpression',
          object: node,
          property: prop,
          position: node.position,
        };
      } else if (this.check(TokenType.LPAREN) && node.type === 'Identifier') {
        // Function call
        node = this.parseCallExpression(node as AST.Identifier);
      } else if (this.check(TokenType.LPAREN) && node.type === 'MemberExpression') {
        // Namespaced call like ns:Func() - already handled, or member.method()
        break;
      } else {
        break;
      }
    }

    return node;
  }

  private parseCallExpression(callee: AST.Identifier): AST.Node {
    const pos = callee.position;
    this.expect(TokenType.LPAREN);
    const args = this.parseArgList();
    this.expect(TokenType.RPAREN);
    const tags = this.parseTags();

    return {
      type: 'Operation',
      name: callee.name,
      args,
      tags,
      position: pos,
    };
  }

  private parsePrimary(): AST.Node {
    const tok = this.peek();

    // Fork expression
    if (tok.type === TokenType.FORK) {
      return this.parseForkExpression();
    }

    // Listen expression
    if (tok.type === TokenType.LISTEN) {
      const pos = this.position();
      this.advance();
      this.expect(TokenType.LPAREN);
      this.expect(TokenType.RPAREN);
      return { type: 'ListenExpression', position: pos };
    }

    // Stream expression
    if (tok.type === TokenType.STREAM) {
      const pos = this.position();
      this.advance();
      this.expect(TokenType.LPAREN);
      const source = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return { type: 'StreamExpression', source, position: pos };
    }

    // Implicit context
    if (tok.type === TokenType.UNDERSCORE) {
      this.advance();
      return { type: 'ImplicitContext', position: { line: tok.line, column: tok.column } };
    }

    // String literals (with interpolation support)
    if (tok.type === TokenType.STRING) {
      return this.parseStringLiteral();
    }

    // Docstring
    if (tok.type === TokenType.DOCSTRING) {
      this.advance();
      return {
        type: 'StringLiteral',
        value: tok.value,
        position: { line: tok.line, column: tok.column },
      };
    }

    // Number literal
    if (tok.type === TokenType.NUMBER) {
      return this.parseNumberLiteral();
    }

    // Boolean literal
    if (tok.type === TokenType.BOOLEAN) {
      this.advance();
      return {
        type: 'BooleanLiteral',
        value: tok.value === 'true',
        position: { line: tok.line, column: tok.column },
      };
    }

    // Null literal
    if (tok.type === TokenType.NULL) {
      this.advance();
      return { type: 'NullLiteral', position: { line: tok.line, column: tok.column } };
    }

    // List literal or destructure
    if (tok.type === TokenType.LBRACKET) {
      return this.parseListLiteral();
    }

    // Dict literal
    if (tok.type === TokenType.LBRACE) {
      return this.parseDictLiteral();
    }

    // Parenthesized expression
    if (tok.type === TokenType.LPAREN) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    // Dollar sign for interpolation reference
    if (tok.type === TokenType.DOLLAR) {
      return this.parseDollarExpression();
    }

    // MCP / Plugin as expression (e.g., in @requires)
    if (tok.type === TokenType.MCP || tok.type === TokenType.PLUGIN) {
      const pos = this.position();
      const name = this.advance().value;
      if (this.match(TokenType.LPAREN)) {
        const args = this.parseArgList();
        this.expect(TokenType.RPAREN);
        return { type: 'Operation', name, args, tags: [], position: pos };
      }
      return { type: 'Identifier', name, position: pos };
    }

    // Discover
    if (tok.type === TokenType.DISCOVER) {
      const pos = this.position();
      this.advance();
      this.expect(TokenType.LPAREN);
      const args = this.parseArgList();
      this.expect(TokenType.RPAREN);
      return { type: 'Operation', name: 'Discover', args, tags: [], position: pos };
    }

    // Identifier (may be operation call, namespaced op, or variable ref)
    if (tok.type === TokenType.IDENTIFIER) {
      return this.parseIdentifierExpression();
    }

    throw this.error(`Unexpected token: ${tok.type} '${tok.value}'`);
  }

  private parseIdentifierExpression(): AST.Node {
    const pos = this.position();
    const name = this.advance().value;

    // Check for namespaced operation: identifier:Operation(args)
    if (this.check(TokenType.COLON) && this.peekAhead(1)?.type === TokenType.IDENTIFIER) {
      this.advance(); // consume :
      const opName = this.advance().value;
      if (this.match(TokenType.LPAREN)) {
        const args = this.parseArgList();
        this.expect(TokenType.RPAREN);
        const tags = this.parseTags();
        return {
          type: 'NamespacedOperation',
          namespace: name,
          name: opName,
          args,
          tags,
          position: pos,
        };
      }
      // Namespaced reference without call
      return {
        type: 'NamespacedOperation',
        namespace: name,
        name: opName,
        args: [],
        tags: [],
        position: pos,
      };
    }

    // Check for function call: Identifier(args)
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const args = this.parseArgList();
      this.expect(TokenType.RPAREN);
      const tags = this.parseTags();
      return {
        type: 'Operation',
        name,
        args,
        tags,
        position: pos,
      };
    }

    // Check for bracket notation: Identifier[n]
    if (this.check(TokenType.LBRACKET)) {
      const savedPos = this.pos;
      this.advance();
      if (this.check(TokenType.NUMBER)) {
        const count = this.advance().value;
        this.expect(TokenType.RBRACKET);
        // This is like Brainstorm[10](topic) or Debate[3](prop)
        if (this.match(TokenType.LPAREN)) {
          const args = this.parseArgList();
          this.expect(TokenType.RPAREN);
          const tags = this.parseTags();
          // Encode the count as a special arg
          const countArg: AST.Argument = {
            name: '_count',
            value: {
              type: 'NumberLiteral',
              value: parseFloat(count),
              raw: count,
              position: pos,
            },
          };
          return {
            type: 'Operation',
            name,
            args: [countArg, ...args],
            tags,
            position: pos,
          };
        }
        // Just Identifier[n] without call
        return {
          type: 'Operation',
          name,
          args: [{
            name: '_count',
            value: {
              type: 'NumberLiteral',
              value: parseFloat(count),
              raw: count,
              position: pos,
            },
          }],
          tags: [],
          position: pos,
        };
      }
      // Not a count bracket, might be subscript - restore
      this.pos = savedPos;
    }

    // Check for tags on bare identifier (operation without parens, e.g., CoVe<deep>)
    const tags = this.parseTags();
    if (tags.length > 0) {
      return {
        type: 'Operation',
        name,
        args: [],
        tags,
        position: pos,
      };
    }

    // Plain identifier
    return { type: 'Identifier', name, position: pos };
  }

  private parseForkExpression(): AST.ForkExpression {
    const pos = this.position();
    this.expect(TokenType.FORK);

    let count: number | undefined;
    if (this.match(TokenType.LBRACKET)) {
      count = parseInt(this.expect(TokenType.NUMBER).value);
      this.expect(TokenType.RBRACKET);
    }

    this.expect(TokenType.COLON);
    this.skipNewlines();
    this.expect(TokenType.INDENT);

    // Check if this is a for-based fork
    if (this.check(TokenType.FOR)) {
      const forStmt = this.parseForStatement();
      if (this.check(TokenType.DEDENT)) this.advance();
      return { type: 'ForkExpression', count, branches: [], forLoop: forStmt, position: pos };
    }

    const branches: AST.ForkBranch[] = [];

    while (!this.check(TokenType.DEDENT) && !this.check(TokenType.EOF)) {
      this.skipNewlines();
      if (this.check(TokenType.DEDENT)) break;

      // Check for named branch: name: expression
      if (this.check(TokenType.IDENTIFIER) && this.peekAhead(1)?.type === TokenType.COLON) {
        const branchName = this.advance().value;
        this.advance(); // consume :
        // Parse the rest of the line as an expression/statement
        const stmt = this.parseAssignmentOrExpression();
        branches.push({ name: branchName, body: [stmt] });
      } else {
        // Unnamed branch
        const stmt = this.parseAssignmentOrExpression();
        branches.push({ body: [stmt] });
      }
      this.skipNewlines();
    }
    if (this.check(TokenType.DEDENT)) this.advance();

    return { type: 'ForkExpression', count, branches, position: pos };
  }

  private parseStringLiteral(): AST.Node {
    const tok = this.advance();
    const raw = tok.value;
    const pos = { line: tok.line, column: tok.column };

    // Check if string contains interpolation ($identifier or ${expr})
    if (raw.includes('$')) {
      return this.buildInterpolatedString(raw, pos);
    }

    return { type: 'StringLiteral', value: raw, position: pos };
  }

  private buildInterpolatedString(raw: string, pos: AST.Position): AST.Node {
    const parts: (string | AST.Node)[] = [];
    let i = 0;
    let current = '';

    while (i < raw.length) {
      if (raw[i] === '$' && i + 1 < raw.length) {
        if (raw[i + 1] === '{') {
          // ${expression}
          if (current) {
            parts.push(current);
            current = '';
          }
          i += 2; // skip ${
          let depth = 1;
          let exprStr = '';
          while (i < raw.length && depth > 0) {
            if (raw[i] === '{') depth++;
            if (raw[i] === '}') depth--;
            if (depth > 0) exprStr += raw[i];
            i++;
          }
          parts.push({
            type: 'Identifier',
            name: exprStr.trim(),
            position: pos,
          });
        } else if (raw[i + 1] === '_') {
          // $_
          if (current) {
            parts.push(current);
            current = '';
          }
          i += 2;
          parts.push({ type: 'ImplicitContext', position: pos });
        } else if (this.isAlphaChar(raw[i + 1])) {
          // $identifier
          if (current) {
            parts.push(current);
            current = '';
          }
          i++; // skip $
          let name = '';
          while (i < raw.length && (this.isAlphaChar(raw[i]) || this.isDigitChar(raw[i]) || raw[i] === '_' || raw[i] === '.')) {
            name += raw[i];
            i++;
          }
          // Handle dotted access
          if (name.includes('.')) {
            const segments = name.split('.');
            let node: AST.Node = { type: 'Identifier', name: segments[0], position: pos };
            for (let s = 1; s < segments.length; s++) {
              node = { type: 'MemberExpression', object: node, property: segments[s], position: pos };
            }
            parts.push(node);
          } else {
            parts.push({ type: 'Identifier', name, position: pos });
          }
        } else {
          current += raw[i];
          i++;
        }
      } else {
        current += raw[i];
        i++;
      }
    }
    if (current) parts.push(current);

    if (parts.length === 1 && typeof parts[0] === 'string') {
      return { type: 'StringLiteral', value: parts[0], position: pos };
    }

    return { type: 'InterpolatedString', parts, position: pos };
  }

  private isAlphaChar(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isDigitChar(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private parseNumberLiteral(): AST.NumberLiteral {
    const tok = this.advance();
    const raw = tok.value;
    // Check for suffix (e.g., 10s, 30m)
    let suffix: string | undefined;
    let numPart = raw;
    const lastChar = raw[raw.length - 1];
    if (lastChar === 's' || lastChar === 'm' || lastChar === 'h') {
      suffix = lastChar;
      numPart = raw.slice(0, -1);
    }
    return {
      type: 'NumberLiteral',
      value: parseFloat(numPart),
      suffix,
      raw,
      position: { line: tok.line, column: tok.column },
    };
  }

  private parseListLiteral(): AST.ListLiteral {
    const pos = this.position();
    this.expect(TokenType.LBRACKET);
    const elements: AST.Node[] = [];
    if (!this.check(TokenType.RBRACKET)) {
      elements.push(this.parseExpression());
      while (this.match(TokenType.COMMA)) {
        if (this.check(TokenType.RBRACKET)) break; // trailing comma
        elements.push(this.parseExpression());
      }
    }
    this.expect(TokenType.RBRACKET);
    return { type: 'ListLiteral', elements, position: pos };
  }

  private parseDictLiteral(): AST.DictLiteral {
    const pos = this.position();
    this.expect(TokenType.LBRACE);
    const entries: { key: string; value: AST.Node }[] = [];
    if (!this.check(TokenType.RBRACE)) {
      const key = this.expect(TokenType.IDENTIFIER).value;
      this.expect(TokenType.COLON);
      const value = this.parseExpression();
      entries.push({ key, value });
      while (this.match(TokenType.COMMA)) {
        if (this.check(TokenType.RBRACE)) break;
        const k = this.expect(TokenType.IDENTIFIER).value;
        this.expect(TokenType.COLON);
        const v = this.parseExpression();
        entries.push({ key: k, value: v });
      }
    }
    this.expect(TokenType.RBRACE);
    return { type: 'DictLiteral', entries, position: pos };
  }

  private parseDollarExpression(): AST.Node {
    const pos = this.position();
    this.advance(); // skip $
    if (this.check(TokenType.UNDERSCORE)) {
      this.advance();
      return { type: 'ImplicitContext', position: pos };
    }
    if (this.check(TokenType.IDENTIFIER)) {
      const name = this.advance().value;
      return { type: 'Identifier', name, position: pos };
    }
    // ${expr} - shouldn't appear at the token level, only inside strings
    throw this.error('Expected identifier after $');
  }

  // ─── Arguments ─────────────────────────────────────────

  private parseArgList(): AST.Argument[] {
    const args: AST.Argument[] = [];
    if (this.check(TokenType.RPAREN)) return args;

    args.push(this.parseArg());
    while (this.match(TokenType.COMMA)) {
      if (this.check(TokenType.RPAREN)) break;
      args.push(this.parseArg());
    }
    return args;
  }

  private parseArg(): AST.Argument {
    // Check for keyword argument: name=value
    if (this.check(TokenType.IDENTIFIER) && this.peekAhead(1)?.type === TokenType.EQUALS) {
      const name = this.advance().value;
      this.advance(); // consume =
      const value = this.parseExpression();
      return { name, value };
    }
    return { value: this.parseExpression() };
  }

  // ─── Tags ──────────────────────────────────────────────

  private parseTags(): AST.Tag[] {
    const tags: AST.Tag[] = [];
    // Tags start with < but only in tag context (not comparison)
    if (!this.check(TokenType.LT)) return tags;

    // Lookahead: is this a tag or a comparison?
    // Tags follow immediately after ) or an identifier, and contain identifier=value pairs
    const savedPos = this.pos;
    try {
      this.advance(); // consume <
      const firstTag = this.parseTag();
      tags.push(firstTag);

      while (this.match(TokenType.COMMA)) {
        tags.push(this.parseTag());
      }

      this.expect(TokenType.GT);
      return tags;
    } catch {
      this.pos = savedPos;
      return [];
    }
  }

  private parseTag(): AST.Tag {
    const pos = this.position();

    // Handle $variable tags like <$depth>
    if (this.check(TokenType.DOLLAR)) {
      this.advance();
      const name = this.expect(TokenType.IDENTIFIER).value;
      return { type: 'Tag', name: '$' + name, position: pos };
    }

    const name = this.expect(TokenType.IDENTIFIER).value;
    let value: AST.Node | undefined;
    if (this.match(TokenType.EQUALS)) {
      // Tag values are simple: a literal, identifier, or string — not full expressions
      // (to avoid confusing > tag-close with > comparison)
      value = this.parseTagValue();
    }
    return { type: 'Tag', name, value, position: pos };
  }

  private parseTagValue(): AST.Node {
    const tok = this.peek();
    if (tok.type === TokenType.NUMBER) {
      return this.parseNumberLiteral();
    }
    if (tok.type === TokenType.STRING) {
      return this.parseStringLiteral();
    }
    if (tok.type === TokenType.BOOLEAN) {
      this.advance();
      return { type: 'BooleanLiteral', value: tok.value === 'true', position: { line: tok.line, column: tok.column } };
    }
    if (tok.type === TokenType.IDENTIFIER) {
      this.advance();
      return { type: 'Identifier', name: tok.value, position: { line: tok.line, column: tok.column } };
    }
    throw this.error(`Unexpected token in tag value: ${tok.type}`);
  }

  // ─── Blocks ────────────────────────────────────────────

  private parseBlock(): AST.Node[] {
    this.skipNewlines();
    const body: AST.Node[] = [];

    if (this.match(TokenType.INDENT)) {
      while (!this.check(TokenType.DEDENT) && !this.check(TokenType.EOF)) {
        this.skipNewlines();
        if (this.check(TokenType.DEDENT)) break;
        const stmt = this.parseStatement();
        if (stmt) body.push(stmt);
      }
      if (this.check(TokenType.DEDENT)) this.advance();
    } else {
      // Single-line block
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
    }

    return body;
  }

  // ─── Helpers ───────────────────────────────────────────

  private peek(): Token {
    return this.tokens[this.pos] || { type: TokenType.EOF, value: '', line: 0, column: 0 };
  }

  private peekAhead(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType): Token {
    const tok = this.peek();
    if (tok.type !== type) {
      throw this.error(`Expected ${type} but got ${tok.type} '${tok.value}'`);
    }
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  private position(): AST.Position {
    const tok = this.peek();
    return { line: tok.line, column: tok.column };
  }

  private error(message: string): Error {
    const tok = this.peek();
    return new Error(`Parse error at line ${tok.line}, column ${tok.column}: ${message}`);
  }
}
