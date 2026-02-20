import { Token, TokenType, KEYWORDS } from './tokens';

export class Lexer {
  private source: string;
  private tokens: Token[] = [];
  private pos = 0;
  private line = 1;
  private column = 1;
  private indentStack: number[] = [0];
  private atLineStart = true;
  private parenDepth = 0;
  private bracketDepth = 0;
  private braceDepth = 0;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.indentStack = [0];
    this.atLineStart = true;

    while (this.pos < this.source.length) {
      if (this.atLineStart) {
        this.handleIndentation();
        this.atLineStart = false;
      }

      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];

      // Skip blank lines / trailing whitespace
      if (ch === ' ' || ch === '\t') {
        this.advance();
        continue;
      }

      if (ch === '\n') {
        this.handleNewline();
        continue;
      }

      if (ch === '\r') {
        this.advance();
        if (this.pos < this.source.length && this.source[this.pos] === '\n') {
          this.advance();
        }
        this.handleNewlineToken();
        continue;
      }

      // Comments
      if (ch === '#') {
        this.readComment();
        continue;
      }

      // Strings
      if (ch === '"') {
        if (this.source.slice(this.pos, this.pos + 3) === '"""') {
          this.readDocstring();
        } else {
          this.readString('"');
        }
        continue;
      }
      if (ch === "'") {
        this.readString("'");
        continue;
      }

      // Numbers
      if (this.isDigit(ch) || (ch === '.' && this.pos + 1 < this.source.length && this.isDigit(this.source[this.pos + 1]))) {
        this.readNumber();
        continue;
      }

      // Identifiers and keywords
      if (this.isAlpha(ch) || ch === '_') {
        this.readIdentifier();
        continue;
      }

      // Operators and punctuation
      this.readOperator();
    }

    // Emit remaining DEDENTs
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.addToken(TokenType.DEDENT, '');
    }

    this.addToken(TokenType.EOF, '');
    return this.filterTokens(this.tokens);
  }

  private handleNewline(): void {
    this.advance(); // consume \n
    this.handleNewlineToken();
  }

  private handleNewlineToken(): void {
    // Don't emit NEWLINE inside parens/brackets/braces
    if (this.parenDepth > 0 || this.bracketDepth > 0 || this.braceDepth > 0) {
      this.line++;
      this.column = 1;
      this.atLineStart = true;
      return;
    }

    // Don't emit duplicate NEWLINEs
    if (this.tokens.length > 0 && this.tokens[this.tokens.length - 1].type !== TokenType.NEWLINE) {
      this.addToken(TokenType.NEWLINE, '\\n');
    }
    this.line++;
    this.column = 1;
    this.atLineStart = true;
  }

  private handleIndentation(): void {
    if (this.parenDepth > 0 || this.bracketDepth > 0 || this.braceDepth > 0) {
      // Skip whitespace but don't process indentation inside grouping
      while (this.pos < this.source.length && (this.source[this.pos] === ' ' || this.source[this.pos] === '\t')) {
        this.advance();
      }
      return;
    }

    let indent = 0;
    while (this.pos < this.source.length && (this.source[this.pos] === ' ' || this.source[this.pos] === '\t')) {
      if (this.source[this.pos] === '\t') {
        indent += 4;
      } else {
        indent++;
      }
      this.advance();
    }

    // Skip blank lines and comment-only lines
    if (this.pos >= this.source.length || this.source[this.pos] === '\n' || this.source[this.pos] === '\r') {
      return;
    }
    if (this.source[this.pos] === '#' &&
        !(this.pos + 1 < this.source.length && this.source[this.pos + 1] === '#')) {
      return; // Don't change indent level for single-line comment-only lines
      // But DO process indentation for ## (section comments) and ### (atomic blocks)
    }

    const currentIndent = this.indentStack[this.indentStack.length - 1];

    if (indent > currentIndent) {
      this.indentStack.push(indent);
      this.addToken(TokenType.INDENT, '');
    } else if (indent < currentIndent) {
      while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1] > indent) {
        this.indentStack.pop();
        this.addToken(TokenType.DEDENT, '');
      }
    }
  }

  private readComment(): void {
    const startCol = this.column;
    // Check for ### (atomic block delimiter)
    if (this.source.slice(this.pos, this.pos + 3) === '###' &&
        (this.pos + 3 >= this.source.length || this.source[this.pos + 3] !== '#')) {
      this.advance(); this.advance(); this.advance();
      this.addTokenAt(TokenType.TRIPLE_HASH, '###', this.line, startCol);
      return;
    }
    // Check for ## (section heading)
    if (this.pos + 1 < this.source.length && this.source[this.pos + 1] === '#' &&
        (this.pos + 2 >= this.source.length || this.source[this.pos + 2] !== '#')) {
      this.advance(); this.advance();
      // Skip space
      if (this.pos < this.source.length && this.source[this.pos] === ' ') this.advance();
      let text = '';
      while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
        text += this.source[this.pos];
        this.advance();
      }
      this.addTokenAt(TokenType.SECTION_COMMENT, text.trim(), this.line, startCol);
      return;
    }
    // Regular comment
    this.advance(); // skip #
    if (this.pos < this.source.length && this.source[this.pos] === ' ') this.advance();
    let text = '';
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      text += this.source[this.pos];
      this.advance();
    }
    this.addTokenAt(TokenType.COMMENT, text.trim(), this.line, startCol);
  }

  private readDocstring(): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); this.advance(); this.advance(); // skip """
    let text = '';
    while (this.pos < this.source.length) {
      if (this.source.slice(this.pos, this.pos + 3) === '"""') {
        this.advance(); this.advance(); this.advance();
        this.addTokenAt(TokenType.DOCSTRING, text.trim(), startLine, startCol);
        return;
      }
      if (this.source[this.pos] === '\n') {
        this.line++;
        this.column = 0;
      }
      text += this.source[this.pos];
      this.advance();
    }
    throw this.error(`Unterminated docstring starting at line ${startLine}`);
  }

  private readString(quote: string): void {
    const startLine = this.line;
    const startCol = this.column;
    this.advance(); // skip opening quote
    let text = '';
    while (this.pos < this.source.length && this.source[this.pos] !== quote) {
      if (this.source[this.pos] === '\\') {
        this.advance();
        if (this.pos < this.source.length) {
          const escaped = this.source[this.pos];
          switch (escaped) {
            case 'n': text += '\n'; break;
            case 't': text += '\t'; break;
            case '\\': text += '\\'; break;
            case '"': text += '"'; break;
            case "'": text += "'"; break;
            case '$': text += '$'; break;
            default: text += '\\' + escaped;
          }
          this.advance();
        }
      } else if (this.source[this.pos] === '\n') {
        throw this.error(`Unterminated string at line ${startLine}`);
      } else {
        text += this.source[this.pos];
        this.advance();
      }
    }
    if (this.pos >= this.source.length) {
      throw this.error(`Unterminated string at line ${startLine}`);
    }
    this.advance(); // skip closing quote
    this.addTokenAt(TokenType.STRING, text, startLine, startCol);
  }

  private readNumber(): void {
    const startCol = this.column;
    let num = '';
    let hasDot = false;
    while (this.pos < this.source.length && (this.isDigit(this.source[this.pos]) || this.source[this.pos] === '.')) {
      if (this.source[this.pos] === '.') {
        if (hasDot) break;
        hasDot = true;
      }
      num += this.source[this.pos];
      this.advance();
    }
    // Handle duration suffixes like 10s, 30m
    if (this.pos < this.source.length && this.isAlpha(this.source[this.pos])) {
      const suffix = this.source[this.pos];
      if (suffix === 's' || suffix === 'm' || suffix === 'h') {
        num += suffix;
        this.advance();
      }
    }
    this.addTokenAt(TokenType.NUMBER, num, this.line, startCol);
  }

  private readIdentifier(): void {
    const startCol = this.column;
    let id = '';
    while (this.pos < this.source.length && (this.isAlphaNumeric(this.source[this.pos]) || this.source[this.pos] === '_')) {
      id += this.source[this.pos];
      this.advance();
    }

    // Check if it's a keyword
    if (id in KEYWORDS) {
      if (id === 'true' || id === 'false') {
        this.addTokenAt(TokenType.BOOLEAN, id, this.line, startCol);
      } else if (id === 'null') {
        this.addTokenAt(TokenType.NULL, id, this.line, startCol);
      } else {
        this.addTokenAt(KEYWORDS[id], id, this.line, startCol);
      }
    } else if (id === '_') {
      this.addTokenAt(TokenType.UNDERSCORE, id, this.line, startCol);
    } else {
      this.addTokenAt(TokenType.IDENTIFIER, id, this.line, startCol);
    }
  }

  private readOperator(): void {
    const ch = this.source[this.pos];
    const next = this.pos + 1 < this.source.length ? this.source[this.pos + 1] : '';
    const startCol = this.column;

    switch (ch) {
      case ':':
        if (next === '=') {
          this.advance(); this.advance();
          this.addTokenAt(TokenType.WALRUS, ':=', this.line, startCol);
        } else {
          this.advance();
          this.addTokenAt(TokenType.COLON, ':', this.line, startCol);
        }
        break;
      case '+':
        if (next === '=') {
          this.advance(); this.advance();
          this.addTokenAt(TokenType.PLUS_EQ, '+=', this.line, startCol);
        } else {
          this.advance();
          this.addTokenAt(TokenType.PLUS, '+', this.line, startCol);
        }
        break;
      case '|':
        this.advance();
        this.addTokenAt(TokenType.PIPE, '|', this.line, startCol);
        break;
      case '>':
        if (next === '>') {
          this.advance(); this.advance();
          this.addTokenAt(TokenType.PIPE_PIPE, '>>', this.line, startCol);
        } else if (next === '=') {
          this.advance(); this.advance();
          this.addTokenAt(TokenType.GTE, '>=', this.line, startCol);
        } else {
          this.advance();
          this.addTokenAt(TokenType.GT, '>', this.line, startCol);
        }
        break;
      case '<':
        if (next === '=') {
          this.advance(); this.advance();
          this.addTokenAt(TokenType.LTE, '<=', this.line, startCol);
        } else {
          this.advance();
          this.addTokenAt(TokenType.LT, '<', this.line, startCol);
        }
        break;
      case '=':
        if (next === '=') {
          this.advance(); this.advance();
          this.addTokenAt(TokenType.EQ, '==', this.line, startCol);
        } else {
          this.advance();
          this.addTokenAt(TokenType.EQUALS, '=', this.line, startCol);
        }
        break;
      case '!':
        if (next === '=') {
          this.advance(); this.advance();
          this.addTokenAt(TokenType.NEQ, '!=', this.line, startCol);
        } else {
          this.advance();
          this.addTokenAt(TokenType.NOT, '!', this.line, startCol);
        }
        break;
      case '(':
        this.advance();
        this.parenDepth++;
        this.addTokenAt(TokenType.LPAREN, '(', this.line, startCol);
        break;
      case ')':
        this.advance();
        this.parenDepth = Math.max(0, this.parenDepth - 1);
        this.addTokenAt(TokenType.RPAREN, ')', this.line, startCol);
        break;
      case '[':
        this.advance();
        this.bracketDepth++;
        this.addTokenAt(TokenType.LBRACKET, '[', this.line, startCol);
        break;
      case ']':
        this.advance();
        this.bracketDepth = Math.max(0, this.bracketDepth - 1);
        this.addTokenAt(TokenType.RBRACKET, ']', this.line, startCol);
        break;
      case '{':
        this.advance();
        this.braceDepth++;
        this.addTokenAt(TokenType.LBRACE, '{', this.line, startCol);
        break;
      case '}':
        this.advance();
        this.braceDepth = Math.max(0, this.braceDepth - 1);
        this.addTokenAt(TokenType.RBRACE, '}', this.line, startCol);
        break;
      case ',':
        this.advance();
        this.addTokenAt(TokenType.COMMA, ',', this.line, startCol);
        break;
      case '.':
        this.advance();
        this.addTokenAt(TokenType.DOT, '.', this.line, startCol);
        break;
      case '$':
        this.advance();
        this.addTokenAt(TokenType.DOLLAR, '$', this.line, startCol);
        break;
      case '@':
        this.advance();
        this.addTokenAt(TokenType.AT, '@', this.line, startCol);
        break;
      case '*':
        this.advance();
        this.addTokenAt(TokenType.STAR, '*', this.line, startCol);
        break;
      case '-':
        this.advance();
        this.addTokenAt(TokenType.MINUS, '-', this.line, startCol);
        break;
      default:
        throw this.error(`Unexpected character '${ch}'`);
    }
  }

  private advance(): void {
    this.pos++;
    this.column++;
  }

  private addToken(type: TokenType, value: string): void {
    this.tokens.push({ type, value, line: this.line, column: this.column });
  }

  private addTokenAt(type: TokenType, value: string, line: number, column: number): void {
    this.tokens.push({ type, value, line, column });
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isAlpha(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }

  private error(message: string): Error {
    return new Error(`Lexer error at line ${this.line}, column ${this.column}: ${message}`);
  }

  private filterTokens(tokens: Token[]): Token[] {
    // Remove comments from token stream (they're preserved in the array for trace output)
    // but keep section comments as they may be used in the AST
    return tokens.filter(t =>
      t.type !== TokenType.COMMENT
    );
  }
}
