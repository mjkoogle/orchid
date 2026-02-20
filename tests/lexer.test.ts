import { Lexer } from '../src/lexer/lexer';
import { TokenType } from '../src/lexer/tokens';

describe('Lexer', () => {
  function tokenize(source: string) {
    return new Lexer(source).tokenize();
  }

  function tokenTypes(source: string) {
    return tokenize(source).map(t => t.type);
  }

  function tokenValues(source: string) {
    return tokenize(source)
      .filter(t => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF)
      .map(t => ({ type: t.type, value: t.value }));
  }

  describe('basic tokens', () => {
    it('should tokenize an empty source', () => {
      const types = tokenTypes('');
      expect(types).toEqual([TokenType.EOF]);
    });

    it('should tokenize identifiers', () => {
      const tokens = tokenValues('hello world');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'hello' },
        { type: TokenType.IDENTIFIER, value: 'world' },
      ]);
    });

    it('should tokenize keywords', () => {
      const tokens = tokenValues('if else for while');
      expect(tokens).toEqual([
        { type: TokenType.IF, value: 'if' },
        { type: TokenType.ELSE, value: 'else' },
        { type: TokenType.FOR, value: 'for' },
        { type: TokenType.WHILE, value: 'while' },
      ]);
    });

    it('should tokenize numbers', () => {
      const tokens = tokenValues('42 3.14 10s');
      expect(tokens).toEqual([
        { type: TokenType.NUMBER, value: '42' },
        { type: TokenType.NUMBER, value: '3.14' },
        { type: TokenType.NUMBER, value: '10s' },
      ]);
    });

    it('should tokenize strings', () => {
      const tokens = tokenValues('"hello world"');
      expect(tokens).toEqual([
        { type: TokenType.STRING, value: 'hello world' },
      ]);
    });

    it('should tokenize booleans and null', () => {
      const tokens = tokenValues('true false null');
      expect(tokens).toEqual([
        { type: TokenType.BOOLEAN, value: 'true' },
        { type: TokenType.BOOLEAN, value: 'false' },
        { type: TokenType.NULL, value: 'null' },
      ]);
    });
  });

  describe('operators', () => {
    it('should tokenize walrus operator', () => {
      const tokens = tokenValues('x := 5');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'x' },
        { type: TokenType.WALRUS, value: ':=' },
        { type: TokenType.NUMBER, value: '5' },
      ]);
    });

    it('should tokenize pipe operators', () => {
      const tokens = tokenValues('a >> b | c');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'a' },
        { type: TokenType.PIPE_PIPE, value: '>>' },
        { type: TokenType.IDENTIFIER, value: 'b' },
        { type: TokenType.PIPE, value: '|' },
        { type: TokenType.IDENTIFIER, value: 'c' },
      ]);
    });

    it('should tokenize comparison operators', () => {
      const tokens = tokenValues('a > b >= c < d <= e == f != g');
      expect(tokens.map(t => t.type)).toEqual([
        TokenType.IDENTIFIER, TokenType.GT, TokenType.IDENTIFIER,
        TokenType.GTE, TokenType.IDENTIFIER, TokenType.LT,
        TokenType.IDENTIFIER, TokenType.LTE, TokenType.IDENTIFIER,
        TokenType.EQ, TokenType.IDENTIFIER, TokenType.NEQ,
        TokenType.IDENTIFIER,
      ]);
    });

    it('should tokenize plus-equals', () => {
      const tokens = tokenValues('x += 1');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'x' },
        { type: TokenType.PLUS_EQ, value: '+=' },
        { type: TokenType.NUMBER, value: '1' },
      ]);
    });
  });

  describe('delimiters and punctuation', () => {
    it('should tokenize brackets and braces', () => {
      const tokens = tokenValues('()[]{}');
      expect(tokens.map(t => t.type)).toEqual([
        TokenType.LPAREN, TokenType.RPAREN,
        TokenType.LBRACKET, TokenType.RBRACKET,
        TokenType.LBRACE, TokenType.RBRACE,
      ]);
    });

    it('should tokenize colons and commas', () => {
      const tokens = tokenValues('a: b, c');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'a' },
        { type: TokenType.COLON, value: ':' },
        { type: TokenType.IDENTIFIER, value: 'b' },
        { type: TokenType.COMMA, value: ',' },
        { type: TokenType.IDENTIFIER, value: 'c' },
      ]);
    });
  });

  describe('comments', () => {
    it('should skip single-line comments', () => {
      const tokens = tokenValues('x := 5 # this is a comment');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'x' },
        { type: TokenType.WALRUS, value: ':=' },
        { type: TokenType.NUMBER, value: '5' },
      ]);
    });

    it('should keep section comments', () => {
      const tokens = tokenValues('## Phase 1');
      expect(tokens).toEqual([
        { type: TokenType.SECTION_COMMENT, value: 'Phase 1' },
      ]);
    });

    it('should tokenize triple hash as atomic block delimiter', () => {
      const tokens = tokenValues('###');
      expect(tokens).toEqual([
        { type: TokenType.TRIPLE_HASH, value: '###' },
      ]);
    });
  });

  describe('indentation', () => {
    it('should emit INDENT and DEDENT tokens', () => {
      const source = 'if true:\n    x := 1\ny := 2';
      const types = tokenTypes(source);
      expect(types).toContain(TokenType.INDENT);
      expect(types).toContain(TokenType.DEDENT);
    });

    it('should handle nested indentation', () => {
      const source = 'if true:\n    if false:\n        x := 1\n    y := 2\nz := 3';
      const types = tokenTypes(source);
      const indents = types.filter(t => t === TokenType.INDENT).length;
      const dedents = types.filter(t => t === TokenType.DEDENT).length;
      expect(indents).toBe(2);
      expect(dedents).toBe(2);
    });
  });

  describe('strings', () => {
    it('should handle escape sequences', () => {
      const tokens = tokenValues('"hello\\nworld"');
      expect(tokens[0].value).toBe('hello\nworld');
    });

    it('should handle string interpolation markers', () => {
      const tokens = tokenValues('"$name is here"');
      expect(tokens[0].value).toBe('$name is here');
    });

    it('should tokenize docstrings', () => {
      const tokens = tokenValues('"""This is a docstring"""');
      expect(tokens[0].type).toBe(TokenType.DOCSTRING);
      expect(tokens[0].value).toBe('This is a docstring');
    });
  });

  describe('metadata', () => {
    it('should tokenize @ directives', () => {
      const tokens = tokenValues('@orchid 0.1');
      expect(tokens).toEqual([
        { type: TokenType.AT, value: '@' },
        { type: TokenType.IDENTIFIER, value: 'orchid' },
        { type: TokenType.NUMBER, value: '0.1' },
      ]);
    });
  });

  describe('complex expressions', () => {
    it('should tokenize a function call with tags', () => {
      const tokens = tokenValues('Search("topic")<deep>');
      expect(tokens.map(t => t.type)).toEqual([
        TokenType.IDENTIFIER,
        TokenType.LPAREN,
        TokenType.STRING,
        TokenType.RPAREN,
        TokenType.LT,
        TokenType.IDENTIFIER,
        TokenType.GT,
      ]);
    });

    it('should tokenize namespaced operations', () => {
      const tokens = tokenValues('fs:Read("/data.csv")');
      expect(tokens.map(t => t.type)).toEqual([
        TokenType.IDENTIFIER,
        TokenType.COLON,
        TokenType.IDENTIFIER,
        TokenType.LPAREN,
        TokenType.STRING,
        TokenType.RPAREN,
      ]);
    });

    it('should suppress newlines inside parentheses', () => {
      const source = 'foo(\n  1,\n  2\n)';
      const types = tokenTypes(source);
      expect(types.filter(t => t === TokenType.NEWLINE).length).toBe(0);
    });
  });
});
