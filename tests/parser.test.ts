import { Lexer } from '../src/lexer/lexer';
import { Parser } from '../src/parser/parser';
import * as AST from '../src/parser/ast';

describe('Parser', () => {
  function parse(source: string): AST.Program {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser();
    return parser.parse(tokens);
  }

  describe('metadata', () => {
    it('should parse @orchid directive', () => {
      const ast = parse('@orchid 0.1');
      expect(ast.metadata).toHaveLength(1);
      expect(ast.metadata[0].directive).toBe('orchid');
    });

    it('should parse @name directive', () => {
      const ast = parse('@name "My Script"');
      expect(ast.metadata).toHaveLength(1);
      expect(ast.metadata[0].directive).toBe('name');
      const val = ast.metadata[0].value as AST.StringLiteral;
      expect(val.type).toBe('StringLiteral');
      expect(val.value).toBe('My Script');
    });

    it('should parse multiple metadata directives', () => {
      const ast = parse('@orchid 0.1\n@name "Test"\n@author "Alice"');
      expect(ast.metadata).toHaveLength(3);
    });
  });

  describe('assignments', () => {
    it('should parse simple assignment', () => {
      const ast = parse('x := 42');
      expect(ast.body).toHaveLength(1);
      const stmt = ast.body[0] as AST.Assignment;
      expect(stmt.type).toBe('Assignment');
      expect((stmt.target as AST.Identifier).name).toBe('x');
      expect((stmt.value as AST.NumberLiteral).value).toBe(42);
    });

    it('should parse string assignment', () => {
      const ast = parse('name := "hello"');
      const stmt = ast.body[0] as AST.Assignment;
      expect((stmt.value as AST.StringLiteral).value).toBe('hello');
    });

    it('should parse assignment to operation result', () => {
      const ast = parse('results := Search("quantum")');
      const stmt = ast.body[0] as AST.Assignment;
      expect(stmt.type).toBe('Assignment');
      const op = stmt.value as AST.Operation;
      expect(op.type).toBe('Operation');
      expect(op.name).toBe('Search');
    });

    it('should parse destructuring assignment', () => {
      const ast = parse('[a, b, c] := results');
      const stmt = ast.body[0] as AST.Assignment;
      expect(Array.isArray(stmt.target)).toBe(true);
      expect((stmt.target as AST.Identifier[])).toHaveLength(3);
    });
  });

  describe('operations', () => {
    it('should parse simple operation call', () => {
      const ast = parse('Search("topic")');
      const op = ast.body[0] as AST.Operation;
      expect(op.type).toBe('Operation');
      expect(op.name).toBe('Search');
      expect(op.args).toHaveLength(1);
    });

    it('should parse operation with tags', () => {
      const ast = parse('Search("topic")<deep>');
      const op = ast.body[0] as AST.Operation;
      expect(op.tags).toHaveLength(1);
      expect(op.tags[0].name).toBe('deep');
    });

    it('should parse operation with multiple tags', () => {
      const ast = parse('Search("topic")<deep, retry=3>');
      const op = ast.body[0] as AST.Operation;
      expect(op.tags).toHaveLength(2);
      expect(op.tags[0].name).toBe('deep');
      expect(op.tags[1].name).toBe('retry');
    });

    it('should parse operation with keyword arguments', () => {
      const ast = parse('Extract(data, schema="key_facts")');
      const op = ast.body[0] as AST.Operation;
      expect(op.args).toHaveLength(2);
      expect(op.args[1].name).toBe('schema');
    });

    it('should parse namespaced operation', () => {
      const ast = parse('fs:Read("/data.csv")');
      const op = ast.body[0] as AST.NamespacedOperation;
      expect(op.type).toBe('NamespacedOperation');
      expect(op.namespace).toBe('fs');
      expect(op.name).toBe('Read');
    });

    it('should parse bare operation (no args)', () => {
      const ast = parse('CoVe');
      const op = ast.body[0] as AST.Identifier;
      // Without parens, it's an identifier reference
      expect(op.type).toBe('Identifier');
      expect(op.name).toBe('CoVe');
    });

    it('should parse bracket notation like Brainstorm[10]', () => {
      const ast = parse('Brainstorm[10]("ideas")');
      const op = ast.body[0] as AST.Operation;
      expect(op.name).toBe('Brainstorm');
      const countArg = op.args.find(a => a.name === '_count');
      expect(countArg).toBeDefined();
    });
  });

  describe('control flow', () => {
    it('should parse if statement', () => {
      const ast = parse('if x > 5:\n    y := 1');
      const stmt = ast.body[0] as AST.IfStatement;
      expect(stmt.type).toBe('IfStatement');
      expect(stmt.body).toHaveLength(1);
    });

    it('should parse if/elif/else', () => {
      const source = 'if x > 0.8:\n    a := 1\nelif x > 0.5:\n    b := 2\nelse:\n    c := 3';
      const ast = parse(source);
      const stmt = ast.body[0] as AST.IfStatement;
      expect(stmt.type).toBe('IfStatement');
      expect(stmt.elifs).toHaveLength(1);
      expect(stmt.elseBody).toBeDefined();
    });

    it('should parse for loop', () => {
      const ast = parse('for item in items:\n    process(item)');
      const stmt = ast.body[0] as AST.ForStatement;
      expect(stmt.type).toBe('ForStatement');
      expect(stmt.variable).toBe('item');
    });

    it('should parse while loop', () => {
      const ast = parse('while running:\n    step()');
      const stmt = ast.body[0] as AST.WhileStatement;
      expect(stmt.type).toBe('WhileStatement');
    });

    it('should parse until loop', () => {
      const ast = parse('until done:\n    refine()');
      const stmt = ast.body[0] as AST.UntilStatement;
      expect(stmt.type).toBe('UntilStatement');
    });

    it('should parse try/except/finally', () => {
      const source = 'try:\n    risky()\nexcept Timeout:\n    fallback()\nfinally:\n    cleanup()';
      const ast = parse(source);
      const stmt = ast.body[0] as AST.TryStatement;
      expect(stmt.type).toBe('TryStatement');
      expect(stmt.excepts).toHaveLength(1);
      expect(stmt.excepts[0].errorType).toBe('Timeout');
      expect(stmt.finallyBody).toBeDefined();
    });
  });

  describe('fork expressions', () => {
    it('should parse named fork', () => {
      const source = 'data := fork:\n    market: Search("market")\n    tech: Search("tech")';
      const ast = parse(source);
      const assign = ast.body[0] as AST.Assignment;
      const fork = assign.value as AST.ForkExpression;
      expect(fork.type).toBe('ForkExpression');
      expect(fork.branches).toHaveLength(2);
      expect(fork.branches[0].name).toBe('market');
      expect(fork.branches[1].name).toBe('tech');
    });

    it('should parse fork with count', () => {
      const source = 'results := fork[3]:\n    Search("a")\n    Search("b")\n    Search("c")';
      const ast = parse(source);
      const assign = ast.body[0] as AST.Assignment;
      const fork = assign.value as AST.ForkExpression;
      expect(fork.count).toBe(3);
      expect(fork.branches).toHaveLength(3);
    });
  });

  describe('expressions', () => {
    it('should parse pipe expression', () => {
      const ast = parse('Search("topic") >> CoT("analyze")');
      const expr = ast.body[0] as AST.PipeExpression;
      expect(expr.type).toBe('PipeExpression');
    });

    it('should parse alternative expression', () => {
      const ast = parse('Search("a") | Search("b")');
      const expr = ast.body[0] as AST.AlternativeExpression;
      expect(expr.type).toBe('AlternativeExpression');
    });

    it('should parse merge expression', () => {
      const ast = parse('a + b');
      const expr = ast.body[0] as AST.MergeExpression;
      expect(expr.type).toBe('MergeExpression');
    });

    it('should parse comparison expressions', () => {
      const ast = parse('x > 0.5');
      const expr = ast.body[0] as AST.ComparisonExpression;
      expect(expr.type).toBe('ComparisonExpression');
      expect(expr.operator).toBe('>');
    });

    it('should parse in expression', () => {
      const ast = parse('"postgres" in available');
      const expr = ast.body[0] as AST.InExpression;
      expect(expr.type).toBe('InExpression');
    });

    it('should parse member access', () => {
      const ast = parse('data.market');
      const expr = ast.body[0] as AST.MemberExpression;
      expect(expr.type).toBe('MemberExpression');
      expect(expr.property).toBe('market');
    });

    it('should parse list literal', () => {
      const ast = parse('items := ["a", "b", "c"]');
      const assign = ast.body[0] as AST.Assignment;
      const list = assign.value as AST.ListLiteral;
      expect(list.type).toBe('ListLiteral');
      expect(list.elements).toHaveLength(3);
    });

    it('should parse dict literal', () => {
      const ast = parse('config := {key: "value", num: 42}');
      const assign = ast.body[0] as AST.Assignment;
      const dict = assign.value as AST.DictLiteral;
      expect(dict.type).toBe('DictLiteral');
      expect(dict.entries).toHaveLength(2);
    });
  });

  describe('definitions', () => {
    it('should parse macro definition', () => {
      const source = 'macro Analyze(topic):\n    result := CoT(topic)\n    return result';
      const ast = parse(source);
      const def = ast.body[0] as AST.MacroDef;
      expect(def.type).toBe('MacroDef');
      expect(def.name).toBe('Analyze');
      expect(def.params).toHaveLength(1);
      expect(def.body).toHaveLength(2);
    });

    it('should parse macro with tags', () => {
      const source = 'macro Fast(x)<quick>:\n    return x';
      const ast = parse(source);
      const def = ast.body[0] as AST.MacroDef;
      expect(def.tags).toHaveLength(1);
      expect(def.tags[0].name).toBe('quick');
    });

    it('should parse agent definition', () => {
      const source = 'agent Researcher(topic):\n    result := Search(topic)\n    return result';
      const ast = parse(source);
      const def = ast.body[0] as AST.AgentDef;
      expect(def.type).toBe('AgentDef');
      expect(def.name).toBe('Researcher');
    });

    it('should parse agent with docstring', () => {
      const source = 'agent Bot(x):\n    """A helpful bot."""\n    return x';
      const ast = parse(source);
      const def = ast.body[0] as AST.AgentDef;
      expect(def.docstring).toBe('A helpful bot.');
    });
  });

  describe('statements', () => {
    it('should parse assert statement', () => {
      const ast = parse('assert x > 0, "Must be positive"');
      const stmt = ast.body[0] as AST.AssertStatement;
      expect(stmt.type).toBe('AssertStatement');
      expect(stmt.message).toBe('Must be positive');
    });

    it('should parse return statement', () => {
      const ast = parse('return result');
      const stmt = ast.body[0] as AST.ReturnStatement;
      expect(stmt.type).toBe('ReturnStatement');
    });

    it('should parse emit statement', () => {
      const ast = parse('emit Alert(event)');
      const stmt = ast.body[0] as AST.EmitStatement;
      expect(stmt.type).toBe('EmitStatement');
      expect(stmt.event).toBe('Alert');
    });

    it('should parse Use statement', () => {
      const ast = parse('Use MCP("filesystem") as fs');
      const stmt = ast.body[0] as AST.UseStatement;
      expect(stmt.type).toBe('UseStatement');
      expect(stmt.kind).toBe('MCP');
      expect(stmt.name).toBe('filesystem');
      expect(stmt.alias).toBe('fs');
    });

    it('should parse atomic block', () => {
      const source = '###\nx := 1\ny := 2\n###';
      const ast = parse(source);
      const block = ast.body[0] as AST.AtomicBlock;
      expect(block.type).toBe('AtomicBlock');
      expect(block.body).toHaveLength(2);
    });
  });

  describe('string interpolation', () => {
    it('should parse simple interpolation', () => {
      const ast = parse('x := "$name is here"');
      const assign = ast.body[0] as AST.Assignment;
      const str = assign.value as AST.InterpolatedString;
      expect(str.type).toBe('InterpolatedString');
    });

    it('should parse non-interpolated strings', () => {
      const ast = parse('x := "no vars here"');
      const assign = ast.body[0] as AST.Assignment;
      const str = assign.value as AST.StringLiteral;
      expect(str.type).toBe('StringLiteral');
      expect(str.value).toBe('no vars here');
    });
  });

  describe('complete programs', () => {
    it('should parse hello_world example structure', () => {
      const source = `@orchid 0.1
@name "Test Script"

results := Search("test topic")
vetted := CoVe(results)
analysis := CoT(vetted)

if Confidence(analysis) > 0.7:
    Formal(analysis)
else:
    ELI5(analysis)`;
      const ast = parse(source);
      expect(ast.metadata).toHaveLength(2);
      expect(ast.body.length).toBeGreaterThan(0);
    });
  });
});
