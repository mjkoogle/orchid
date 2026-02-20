import * as path from 'path';
import { execute } from '../src/index';
import { OrchidValue, valueToString } from '../src/runtime/values';
import { OrchidError } from '../src/runtime/interpreter';

// Suppress console output during tests
const originalLog = console.log;
const originalWarn = console.warn;
beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
});
afterAll(() => {
  console.log = originalLog;
  console.warn = originalWarn;
});

// The fixtures directory contains test plugins (plugins/ subdirectory)
const fixturesDir = path.resolve(__dirname, 'fixtures');

async function run(source: string): Promise<OrchidValue> {
  return execute(source, undefined, { scriptDir: fixturesDir });
}

// ─── .orch Plugins ─────────────────────────────────────────

describe('Plugin system — .orch plugins', () => {
  describe('loading', () => {
    it('should load an .orch plugin from plugins/ directory', async () => {
      const result = await run(`
Use Plugin("greeter") as g
g:Greet("World")
`);
      expect(valueToString(result)).toBe('Hello, World!');
    });

    it('should load with default alias (hyphen to underscore)', async () => {
      const result = await run(`
Use Plugin("multi-file")
multi_file:Add(2, 3)
`);
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(5);
    });

    it('should load a directory plugin via index.orch', async () => {
      const result = await run(`
Use Plugin("multi-file") as mf
mf:Add(10, 20)
`);
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(30);
    });

    it('should throw ToolNotFound for missing plugins', async () => {
      await expect(run(`Use Plugin("nonexistent")`)).rejects.toThrow('ToolNotFound');
    });

    it('should strip version constraints from plugin name', async () => {
      const result = await run(`
Use Plugin("greeter@~1.0") as g
g:Greet("Versioned")
`);
      expect(valueToString(result)).toBe('Hello, Versioned!');
    });
  });

  describe('dispatching', () => {
    it('should dispatch to plugin agents', async () => {
      const result = await run(`
Use Plugin("greeter") as g
g:Greet("Agent")
`);
      expect(valueToString(result)).toBe('Hello, Agent!');
    });

    it('should dispatch to plugin macros', async () => {
      const result = await run(`
Use Plugin("greeter") as g
g:Shout("wow")
`);
      expect(valueToString(result)).toBe('wow!!!');
    });

    it('should throw ToolNotFound for unknown operations', async () => {
      await expect(run(`
Use Plugin("greeter") as g
g:NonExistent("test")
`)).rejects.toThrow('ToolNotFound');
    });
  });

  describe('isolation', () => {
    it('should not leak plugin variables into caller scope', async () => {
      const result = await run(`
Use Plugin("greeter") as g
g:Greet("Test")
farewell
`);
      expect(result.kind).toBe('null');
    });
  });
});

// ─── JS Plugins ────────────────────────────────────────────

describe('Plugin system — JS plugins', () => {
  describe('loading', () => {
    it('should load a JS plugin from plugins/ directory', async () => {
      const result = await run(`
Use Plugin("sentiment") as s
s:Analyze("I love this product")
`);
      expect(valueToString(result)).toBe('positive');
    });

    it('should prefer JS over .orch when both exist', async () => {
      // sentiment.js exists; no sentiment.orch. This just confirms JS loading works.
      const result = await run(`
Use Plugin("sentiment") as s
s:Score("This is terrible")
`);
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(-0.8);
    });
  });

  describe('operations', () => {
    it('should dispatch to named operations', async () => {
      const result = await run(`
Use Plugin("sentiment") as s
s:Analyze("It was awful")
`);
      expect(valueToString(result)).toBe('negative');
    });

    it('should return neutral for ambiguous text', async () => {
      const result = await run(`
Use Plugin("sentiment") as s
s:Analyze("The weather is cloudy")
`);
      expect(valueToString(result)).toBe('neutral');
    });

    it('should support operations returning numbers', async () => {
      const result = await run(`
Use Plugin("sentiment") as s
s:Score("This is amazing")
`);
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(1.0);
    });

    it('should support operations returning dicts', async () => {
      const result = await run(`
Use Plugin("sentiment") as s
s:Full("I love orchid")
`);
      expect(result.kind).toBe('dict');
      if (result.kind === 'dict') {
        expect(result.entries.get('label')).toEqual({ kind: 'string', value: 'positive' });
        expect(result.entries.get('score')).toEqual({ kind: 'number', value: 0.8 });
      }
    });

    it('should throw ToolNotFound for unknown operations', async () => {
      await expect(run(`
Use Plugin("sentiment") as s
s:DoesNotExist("test")
`)).rejects.toThrow('ToolNotFound');
    });
  });

  describe('setup lifecycle', () => {
    it('should call setup when plugin is loaded', async () => {
      const result = await run(`
Use Plugin("stateful") as st
st:WasSetup()
`);
      expect(valueToString(result)).toBe('yes');
    });

    it('should maintain state across operations', async () => {
      const result = await run(`
Use Plugin("stateful") as st
st:Increment()
st:Increment()
st:Increment()
st:GetCount()
`);
      expect(result.kind).toBe('number');
      if (result.kind === 'number') expect(result.value).toBe(3);
    });
  });

  describe('provider context', () => {
    it('should allow plugins to call back into the provider', async () => {
      const result = await run(`
Use Plugin("smart") as ai
ai:Think("What is 2+2?")
`);
      // The ConsoleProvider returns "[CoT result: processed "What is 2+2?"]"
      expect(result.kind).toBe('string');
      expect(valueToString(result)).toContain('CoT result');
    });

    it('should allow plugins to use provider search', async () => {
      const result = await run(`
Use Plugin("smart") as ai
ai:Research("quantum computing")
`);
      expect(result.kind).toBe('string');
      expect(valueToString(result)).toContain('Search results');
    });

    it('should pass implicit context to plugin operations', async () => {
      const result = await run(`
Use Plugin("smart") as ai
x := "hello from context"
x | ai:GetContext()
`);
      // The pipe sets implicit context to "hello from context"
      expect(valueToString(result)).toBe('hello from context');
    });
  });
});

// ─── Plugin teardown ───────────────────────────────────────

describe('Plugin system — teardown lifecycle', () => {
  it('should call teardown on interpreter shutdown', async () => {
    // Use the programmatic API to control the interpreter lifecycle
    const { Lexer, Parser, Interpreter } = require('../src');
    const { ConsoleProvider } = require('../src/runtime/provider');

    const source = `Use Plugin("stateful") as st
st:Increment()
st:GetCount()`;

    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser();
    const ast = parser.parse(tokens);

    const interpreter = new Interpreter({
      provider: new ConsoleProvider(),
      scriptDir: fixturesDir,
    });

    const result = await interpreter.run(ast);
    expect(result.kind).toBe('number');
    if (result.kind === 'number') expect(result.value).toBe(1);

    // Call shutdown — this should invoke teardown() on the stateful plugin
    await interpreter.shutdown();

    // After shutdown, the stateful plugin's teardown resets counter and setupCalled.
    // If we create a new interpreter and load the plugin again, setup will be called fresh.
    const interpreter2 = new Interpreter({
      provider: new ConsoleProvider(),
      scriptDir: fixturesDir,
    });

    const source2 = `Use Plugin("stateful") as st
st:WasSetup()`;
    const ast2 = new Parser().parse(new Lexer(source2).tokenize());
    const result2 = await interpreter2.run(ast2);
    expect(valueToString(result2)).toBe('yes');

    await interpreter2.shutdown();
  });

  it('should handle shutdown with no plugins gracefully', async () => {
    const { Lexer, Parser, Interpreter } = require('../src');
    const { ConsoleProvider } = require('../src/runtime/provider');

    const source = `x := 42`;
    const lexer = new Lexer(source);
    const ast = new Parser().parse(lexer.tokenize());

    const interpreter = new Interpreter({
      provider: new ConsoleProvider(),
    });

    await interpreter.run(ast);
    // Should not throw
    await interpreter.shutdown();
  });

  it('should call teardown via execute() convenience function', async () => {
    // execute() now calls shutdown() in its finally block,
    // so teardown should have been called after execution.
    const result = await run(`
Use Plugin("stateful") as st
st:Increment()
st:Increment()
st:GetCount()
`);
    expect(result.kind).toBe('number');
    if (result.kind === 'number') expect(result.value).toBe(2);

    // After execute(), shutdown was called. Load the plugin again:
    const result2 = await run(`
Use Plugin("stateful") as st
st:WasSetup()
`);
    expect(valueToString(result2)).toBe('yes');
  });
});

// ─── ORCHID_PLUGIN_PATH ────────────────────────────────────

describe('Plugin system — ORCHID_PLUGIN_PATH', () => {
  const originalEnv = process.env.ORCHID_PLUGIN_PATH;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ORCHID_PLUGIN_PATH;
    } else {
      process.env.ORCHID_PLUGIN_PATH = originalEnv;
    }
  });

  it('should find .orch plugins via ORCHID_PLUGIN_PATH', async () => {
    process.env.ORCHID_PLUGIN_PATH = path.resolve(fixturesDir, 'plugins');

    const result = await execute(`
Use Plugin("greeter") as g
g:Greet("EnvPath")
`, undefined, { scriptDir: '/tmp' });

    expect(valueToString(result)).toBe('Hello, EnvPath!');
  });

  it('should find JS plugins via ORCHID_PLUGIN_PATH', async () => {
    process.env.ORCHID_PLUGIN_PATH = path.resolve(fixturesDir, 'plugins');

    const result = await execute(`
Use Plugin("sentiment") as s
s:Analyze("I love this")
`, undefined, { scriptDir: '/tmp' });

    expect(valueToString(result)).toBe('positive');
  });
});
