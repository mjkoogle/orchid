import * as path from 'path';
import { Lexer } from '../src/lexer/lexer';
import { Parser } from '../src/parser/parser';
import { Interpreter, OrchidError } from '../src/runtime/interpreter';
import { ConsoleProvider } from '../src/runtime/provider';
import { OrchidValue, valueToString } from '../src/runtime/values';
import { execute } from '../src/index';

const fixturesDir = path.resolve(__dirname, 'fixtures');

// Suppress console.log during tests
const originalLog = console.log;
beforeAll(() => { console.log = jest.fn(); });
afterAll(() => { console.log = originalLog; });

describe('Runtime', () => {
  async function run(source: string): Promise<OrchidValue> {
    return execute(source);
  }

  describe('variable binding', () => {
    it('should bind and retrieve variables', async () => {
      const result = await run('x := 42');
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(42);
    });

    it('should bind string values', async () => {
      const result = await run('name := "hello"');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('hello');
    });

    it('should bind boolean values', async () => {
      const result = await run('flag := true');
      expect(result.kind).toBe('boolean');
      if (result.kind === 'boolean') expect(result.value).toBe(true);
    });

    it('should bind list values', async () => {
      const result = await run('items := ["a", "b", "c"]');
      expect(result.kind).toBe('list');
      if (result.kind === 'list') expect(result.elements).toHaveLength(3);
    });

    it('should bind dict values', async () => {
      const result = await run('config := {key: "value"}');
      expect(result.kind).toBe('dict');
    });
  });

  describe('string interpolation', () => {
    it('should interpolate variables in strings', async () => {
      const result = await run('name := "world"\ngreeting := "hello $name"');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('hello world');
    });

    it('should handle strings without interpolation', async () => {
      const result = await run('msg := "no interpolation"');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('no interpolation');
    });
  });

  describe('operations', () => {
    it('should execute Search operation', async () => {
      const result = await run('Search("test query")');
      expect(result.kind).toBe('string');
      expect(valueToString(result)).toContain('Search');
    });

    it('should execute operation and bind result', async () => {
      const result = await run('x := Search("topic")');
      expect(result.kind).toBe('string');
    });

    it('should execute Confidence operation', async () => {
      const result = await run('c := Confidence()');
      expect(result.kind).toBe('number');
      if (result.kind === 'number') {
        expect(result.value).toBeGreaterThanOrEqual(0);
        expect(result.value).toBeLessThanOrEqual(1);
      }
    });

    it('should execute len() builtin', async () => {
      const result = await run('items := ["a", "b", "c"]\nn := len(items)');
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(3);
    });
  });

  describe('control flow', () => {
    it('should execute if statement (true branch)', async () => {
      const result = await run('x := 10\nif x > 5:\n    y := "big"');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('big');
    });

    it('should execute if statement (false branch)', async () => {
      const result = await run('x := 1\nif x > 5:\n    y := "big"\nelse:\n    y := "small"');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('small');
    });

    it('should execute for loop', async () => {
      const result = await run('items := ["a", "b", "c"]\nfor item in items:\n    Log(item)');
      // For loop returns the last result
      expect(result.kind).toBeDefined();
    });

    it('should execute while loop', async () => {
      const result = await run('x := 0\nwhile x < 3:\n    x += 1');
      // Plus assignment should update x
    });

    it('should raise on assert failure', async () => {
      await expect(run('assert false, "should fail"'))
        .rejects.toThrow('should fail');
    });
  });

  describe('merge operator', () => {
    it('should merge strings', async () => {
      const result = await run('a := "hello"\nb := "world"\nc := a + b');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') {
        expect(result.value).toContain('hello');
        expect(result.value).toContain('world');
      }
    });

    it('should merge lists', async () => {
      const result = await run('a := [1, 2]\nb := [3, 4]\nc := a + b');
      expect(result.kind).toBe('list');
      if (result.kind === 'list') expect(result.elements).toHaveLength(4);
    });
  });

  describe('arithmetic operators', () => {
    it('should multiply numbers', async () => {
      const result = await run('x := 3 * 4');
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(12);
    });

    it('should divide numbers', async () => {
      const result = await run('x := 10 / 2');
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(5);
    });

    it('should subtract numbers', async () => {
      const result = await run('x := 10 - 3');
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(7);
    });

    it('should concatenate strings with *', async () => {
      const result = await run('a := "hello"\nb := " world"\nc := a * b');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('hello world');
    });

    it('should remove literal substring with /', async () => {
      const result = await run('a := "hello world"\nb := "world"\nc := a / b');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('hello ');
    });

    it('should remove all occurrences with /', async () => {
      const result = await run('a := "banana"\nb := "a"\nc := a / b');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('bnn');
    });

    it('should return original string when / target not found', async () => {
      const result = await run('a := "hello"\nb := "xyz"\nc := a / b');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('hello');
    });

    it('should semantically subtract strings with - via provider', async () => {
      const result = await run('a := "The quick brown fox"\nb := "quick brown"\nc := a - b');
      expect(result.kind).toBe('string');
    });

    it('should handle division by zero', async () => {
      const result = await run('x := 10 / 0');
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(Infinity);
    });
  });

  describe('pipe operator', () => {
    it('should chain operations with >>', async () => {
      const result = await run('Search("topic") >> CoT("analyze")');
      expect(result.kind).toBe('string');
    });
  });

  describe('alternative operator', () => {
    it('should return first successful result', async () => {
      const result = await run('x := "hello" | "fallback"');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('hello');
    });
  });

  describe('fork execution', () => {
    it('should execute named fork and return dict', async () => {
      const source = `data := fork:
    a: Search("topic a")
    b: Search("topic b")`;
      const result = await run(source);
      expect(result.kind).toBe('dict');
    });

    it('should execute unnamed fork and return list', async () => {
      const source = `results := fork[2]:
    Search("topic a")
    Search("topic b")`;
      const result = await run(source);
      expect(result.kind).toBe('list');
      if (result.kind === 'list') expect(result.elements).toHaveLength(2);
    });
  });

  describe('atomic blocks', () => {
    it('should commit bindings on success', async () => {
      const source = `###
x := 42
y := "hello"
###
z := x`;
      const result = await run(source);
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(42);
    });
  });

  describe('try/except', () => {
    it('should catch errors', async () => {
      const source = `try:
    assert false, "fail"
except:
    x := "caught"`;
      const result = await run(source);
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('caught');
    });
  });

  describe('macros and agents', () => {
    it('should define and call a macro', async () => {
      const source = `macro Double(x):
    return x + x
result := Double("hello")`;
      const result = await run(source);
      expect(result.kind).toBe('string');
      if (result.kind === 'string') {
        expect(result.value).toContain('hello');
      }
    });

    it('should define and call an agent', async () => {
      const source = `agent Greeter(name):
    return "Hello, " + name
msg := Greeter("Alice")`;
      const result = await run(source);
      expect(result.kind).toBe('string');
      if (result.kind === 'string') {
        expect(result.value).toContain('Hello');
        expect(result.value).toContain('Alice');
      }
    });

    it('should handle macro with default parameters', async () => {
      const source = `macro Greet(name, style="casual"):
    if style == "casual":
        return "Hey " + name
    else:
        return "Good day, " + name
result := Greet("Bob")`;
      const result = await run(source);
      expect(result.kind).toBe('string');
      if (result.kind === 'string') {
        expect(result.value).toContain('Hey');
        expect(result.value).toContain('Bob');
      }
    });
  });

  describe('member access', () => {
    it('should access dict properties', async () => {
      const result = await run('data := {name: "test", value: 42}\nx := data.name');
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('test');
    });
  });

  describe('comparison', () => {
    it('should compare numbers', async () => {
      const result = await run('x := 5 > 3');
      expect(result.kind).toBe('boolean');
      if (result.kind === 'boolean') expect(result.value).toBe(true);
    });

    it('should compare equality', async () => {
      const result = await run('x := "a" == "a"');
      expect(result.kind).toBe('boolean');
      if (result.kind === 'boolean') expect(result.value).toBe(true);
    });
  });

  describe('in expression', () => {
    it('should check membership in list', async () => {
      const result = await run('x := "b" in ["a", "b", "c"]');
      expect(result.kind).toBe('boolean');
      if (result.kind === 'boolean') expect(result.value).toBe(true);
    });

    it('should check non-membership', async () => {
      const result = await run('x := "d" in ["a", "b", "c"]');
      expect(result.kind).toBe('boolean');
      if (result.kind === 'boolean') expect(result.value).toBe(false);
    });
  });

  describe('events', () => {
    it('should emit and handle events', async () => {
      const source = `result := "not set"
on TestEvent as evt:
    result := "received"
emit TestEvent("payload")`;
      const result = await run(source);
      // The last statement is emit which returns null
      expect(result.kind).toBe('null');
    });
  });

  describe('metadata processing', () => {
    it('should handle full program with metadata', async () => {
      const source = `@orchid 0.1
@name "Test"

x := 42`;
      const result = await run(source);
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(42);
    });
  });

  // ─── Discover() pattern matching ──────────────────────────

  describe('Discover() pattern matching', () => {
    it('should return builtins when pattern is *', async () => {
      const result = await run('items := Discover("*")');
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        const names = result.elements.map(e => valueToString(e));
        // Should include standard builtins
        expect(names).toContain('CoT');
        expect(names).toContain('Search');
        expect(names).toContain('ELI5');
        expect(names).toContain('Confidence');
      }
    });

    it('should filter by pattern', async () => {
      const result = await run('items := Discover("Co*")');
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        const names = result.elements.map(e => valueToString(e));
        expect(names).toContain('CoT');
        expect(names).toContain('CoVe');
        // Should NOT contain unmatched builtins
        expect(names).not.toContain('ELI5');
        expect(names).not.toContain('Search');
      }
    });

    it('should return empty list for non-matching pattern', async () => {
      const result = await run('items := Discover("zzz_nonexistent_*")');
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(0);
      }
    });

    it('should default to * when called with no args', async () => {
      const result = await run('items := Discover()');
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements.length).toBeGreaterThan(0);
      }
    });

    it('should match exact names', async () => {
      const result = await run('items := Discover("CoT")');
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        const names = result.elements.map(e => valueToString(e));
        expect(names).toContain('CoT');
        expect(names).toHaveLength(1);
      }
    });
  });

  // ─── Fork parallel execution isolation ────────────────────

  describe('fork branch isolation', () => {
    it('should isolate implicit context between named fork branches', async () => {
      const source = `data := fork:
    a: Search("topic a")
    b: Search("topic b")`;
      const result = await run(source);
      expect(result.kind).toBe('dict');
      if (result.kind === 'dict') {
        const a = result.entries.get('a');
        const b = result.entries.get('b');
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        // Each branch should have its own result, not leaking from the other
        expect(valueToString(a!)).toContain('topic a');
        expect(valueToString(b!)).toContain('topic b');
      }
    });

    it('should isolate implicit context between unnamed fork branches', async () => {
      const source = `results := fork[2]:
    Search("alpha")
    Search("beta")`;
      const result = await run(source);
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(2);
        expect(valueToString(result.elements[0])).toContain('alpha');
        expect(valueToString(result.elements[1])).toContain('beta');
      }
    });

    it('should isolate implicit context in fork for-loop', async () => {
      const source = `topics := ["x", "y", "z"]
results := fork:
    for topic in topics:
        Search(topic)`;
      const result = await run(source);
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(3);
      }
    });

    it('should set fork result as implicit context after completion', async () => {
      const source = `data := fork:
    a: Search("test1")
    b: Search("test2")
n := len(data)`;
      const result = await run(source);
      // len(data) should return the number of dict entries
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(2);
    });
  });

  // ─── Stream / listen ──────────────────────────────────────

  describe('Stream and listen', () => {
    it('listen() should consume buffered events', async () => {
      const source = `emit DataReady("payload1")
evt := listen()`;
      const result = await run(source);
      expect(result.kind).toBe('event');
      if (result.kind === 'event') {
        expect(result.name).toBe('DataReady');
        expect(valueToString(result.payload)).toBe('payload1');
      }
    });

    it('listen() should consume events in order', async () => {
      const source = `emit First("1")
emit Second("2")
evt1 := listen()
evt2 := listen()`;
      const result = await run(source);
      // Last statement result is evt2
      expect(result.kind).toBe('event');
      if (result.kind === 'event') {
        expect(result.name).toBe('Second');
      }
    });

    it('Stream() should return list as-is', async () => {
      const source = `items := ["a", "b", "c"]
result := Stream(items)`;
      const result = await run(source);
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(3);
      }
    });

    it('Stream() should collect buffered events by name', async () => {
      const source = `emit Alert("high")
emit Alert("low")
events := Stream("Alert")`;
      const result = await run(source);
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(2);
        expect(result.elements[0].kind).toBe('event');
      }
    });

    it('Stream() should return empty list for no buffered events', async () => {
      const source = `events := Stream("NoSuchEvent")`;
      const result = await run(source);
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(0);
      }
    });
  });

  // ─── Atomic block transactional rollback ──────────────────

  describe('atomic block rollback', () => {
    it('should commit bindings on success', async () => {
      const source = `###
x := 42
y := "hello"
###
z := x`;
      const result = await run(source);
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(42);
    });

    it('should roll back bindings on error', async () => {
      const source = `x := "before"
try:
    ###
    x := "inside"
    assert false, "boom"
    ###
except:
    result := x`;
      const result = await run(source);
      // x should still be "before" because the atomic block rolled back
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('before');
    });

    it('should roll back events on error', async () => {
      const source = `try:
    ###
    emit ShouldNotSurvive("data")
    assert false, "boom"
    ###
except:
    pass := true
events := Stream("ShouldNotSurvive")`;
      const result = await run(source);
      // Events emitted inside the failed atomic block should be rolled back
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(0);
      }
    });

    it('should roll back checkpoints on error', async () => {
      const source = `Checkpoint("original")
try:
    ###
    Checkpoint("atomic_cp")
    assert false, "boom"
    ###
except:
    pass := true
Rollback("original")
result := "ok"`;
      const result = await run(source);
      // Rollback to "original" should still work
      expect(result.kind).toBe('string');
      if (result.kind === 'string') expect(result.value).toBe('ok');
    });

    it('should preserve events on success', async () => {
      const source = `###
emit Survived("data")
###
events := Stream("Survived")`;
      const result = await run(source);
      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(1);
      }
    });
  });

  // ─── Tag value resolution ─────────────────────────────────

  describe('tag value resolution', () => {
    it('should resolve tag values and pass them to provider', async () => {
      // Tags with values should be resolved and visible in the result string
      const result = await run('Search("topic")<deep>');
      expect(result.kind).toBe('string');
      // ConsoleProvider includes tag names in output
      expect(valueToString(result)).toContain('Search');
    });

    it('should resolve numeric tag values in until loop', async () => {
      // Tags attach to operation calls (after closing paren)
      // The until loop reads <retry=N> from the condition's tags
      const source = `draft := "first attempt"
until Confidence()<retry=3>:
    draft := Refine(draft)`;
      const result = await run(source);
      // ConsoleProvider.confidence returns 0.75 which is truthy,
      // so the loop exits after first iteration check
      expect(result.kind).toBe('string');
    });

    it('should pass resolved tag values through to provider', async () => {
      // ConsoleProvider formats tags — with resolved values, output changes
      const result = await run('CoT("analyze this")<verbose>');
      expect(result.kind).toBe('string');
    });
  });

  // ─── Timeout via tags ─────────────────────────────────────

  describe('timeout via tags', () => {
    it('should not timeout when operation completes quickly', async () => {
      // ConsoleProvider resolves immediately, so 5000ms is plenty
      const result = await run('Search("fast query")<timeout=5000>');
      expect(result.kind).toBe('string');
    });

    it('should timeout when operation takes too long', async () => {
      // Create a provider that delays, with an abort mechanism
      let abortTimer: ReturnType<typeof setTimeout> | undefined;
      const slowProvider = new ConsoleProvider();
      slowProvider.search = async (_query, _tags) => {
        return new Promise<OrchidValue>((resolve) => {
          abortTimer = setTimeout(() => resolve({ kind: 'string', value: 'done' }), 10000);
        });
      };

      const source = 'Search("slow query")<timeout=50>';
      const ast = new Parser().parse(new Lexer(source).tokenize());
      const interpreter = new Interpreter({ provider: slowProvider });

      await expect(interpreter.run(ast)).rejects.toThrow('Timeout');
      if (abortTimer) clearTimeout(abortTimer);
      await interpreter.shutdown();
    }, 10000);

    it('should parse string timeout values', async () => {
      // "5000" as a string should also work
      const result = await run('Search("query")<timeout="5000">');
      expect(result.kind).toBe('string');
    });
  });

  // ─── require MCP/Plugin availability ──────────────────────

  describe('require MCP/Plugin', () => {
    it('should throw ToolNotFound for missing MCP server', async () => {
      await expect(run('require MCP("nonexistent_server"), "Need database"'))
        .rejects.toThrow('ToolNotFound');
    });

    it('should throw ToolNotFound for missing plugin', async () => {
      await expect(run('require Plugin("nonexistent_plugin")'))
        .rejects.toThrow('ToolNotFound');
    });

    it('should pass for available plugin', async () => {
      // The greeter plugin is in test fixtures
      const source = 'require Plugin("greeter")';
      const ast = new Parser().parse(new Lexer(source).tokenize());
      const interpreter = new Interpreter({
        provider: new ConsoleProvider(),
        scriptDir: fixturesDir,
      });
      // Should not throw
      const result = await interpreter.run(ast);
      await interpreter.shutdown();
      expect(result.kind).toBe('null');
    });

    it('should still work as general condition check', async () => {
      // require with non-MCP/Plugin condition
      const result = await run('require true, "should pass"');
      expect(result.kind).toBe('null');
    });

    it('should throw PermissionDenied for false general condition', async () => {
      await expect(run('require false, "denied"'))
        .rejects.toThrow('PermissionDenied');
    });
  });

  // ─── @requires metadata validation ────────────────────────

  describe('@requires metadata validation', () => {
    it('should throw ToolNotFound for missing required MCP server', async () => {
      const source = `@orchid 0.1
@requires MCP("nonexistent_db")

x := 42`;
      await expect(run(source)).rejects.toThrow('ToolNotFound');
    });

    it('should throw ToolNotFound for missing required plugin', async () => {
      const source = `@orchid 0.1
@requires Plugin("nonexistent_plugin")

x := 42`;
      await expect(run(source)).rejects.toThrow('ToolNotFound');
    });

    it('should pass for available required plugin', async () => {
      const source = `@orchid 0.1
@requires Plugin("greeter")

x := 42`;
      const ast = new Parser().parse(new Lexer(source).tokenize());
      const interpreter = new Interpreter({
        provider: new ConsoleProvider(),
        scriptDir: fixturesDir,
      });
      const result = await interpreter.run(ast);
      await interpreter.shutdown();
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(42);
    });
  });

  // ─── Import cycle detection ───────────────────────────────

  describe('import cycle detection', () => {
    it('should throw CyclicDependency for circular imports', async () => {
      const source = `import cycle_a`;
      const ast = new Parser().parse(new Lexer(source).tokenize());
      const interpreter = new Interpreter({
        provider: new ConsoleProvider(),
        scriptDir: fixturesDir,
      });

      await expect(interpreter.run(ast)).rejects.toThrow('CyclicDependency');
      await interpreter.shutdown();
    });
  });

  // ─── Spec error types ─────────────────────────────────────

  describe('spec error types', () => {
    it('should throw ValidationError on assert failure', async () => {
      await expect(run('assert false, "bad"')).rejects.toThrow('ValidationError');
    });

    it('should throw ToolNotFound for missing plugin operation', async () => {
      const source = `Use Plugin("greeter") as g
g:NonExistent("test")`;
      const ast = new Parser().parse(new Lexer(source).tokenize());
      const interpreter = new Interpreter({
        provider: new ConsoleProvider(),
        scriptDir: fixturesDir,
      });

      await expect(interpreter.run(ast)).rejects.toThrow('ToolNotFound');
      await interpreter.shutdown();
    });

    it('should use Timeout error type', async () => {
      let abortTimer: ReturnType<typeof setTimeout> | undefined;
      const slowProvider = new ConsoleProvider();
      slowProvider.execute = async () => {
        return new Promise<OrchidValue>((resolve) => {
          abortTimer = setTimeout(() => resolve({ kind: 'null' } as OrchidValue), 10000);
        });
      };

      const source = 'CoT("slow")<timeout=20>';
      const ast = new Parser().parse(new Lexer(source).tokenize());
      const interpreter = new Interpreter({ provider: slowProvider });

      try {
        await interpreter.run(ast);
        fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(OrchidError);
        expect(e.errorType).toBe('Timeout');
      }
      if (abortTimer) clearTimeout(abortTimer);
      await interpreter.shutdown();
    }, 10000);

    it('should use CyclicDependency error type', async () => {
      const source = `import cycle_a`;
      const ast = new Parser().parse(new Lexer(source).tokenize());
      const interpreter = new Interpreter({
        provider: new ConsoleProvider(),
        scriptDir: fixturesDir,
      });

      try {
        await interpreter.run(ast);
        fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(OrchidError);
        expect(e.errorType).toBe('CyclicDependency');
      }
      await interpreter.shutdown();
    });
  });
});
