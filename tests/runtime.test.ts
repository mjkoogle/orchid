import { Lexer } from '../src/lexer/lexer';
import { Parser } from '../src/parser/parser';
import { Interpreter, OrchidError } from '../src/runtime/interpreter';
import { ConsoleProvider } from '../src/runtime/provider';
import { OrchidValue, valueToString } from '../src/runtime/values';
import { execute } from '../src/index';

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
});
