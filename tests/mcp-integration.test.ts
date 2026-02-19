/**
 * MCP Integration Test
 *
 * Spawns a real MCP server (tests/fixtures/echo-mcp-server.js) via stdio
 * and validates the full round-trip through MCPManager:
 *   config → connect → tool discovery → call → result deserialization
 *
 * Run with:
 *   npm test -- --testPathPattern=mcp-integration
 *
 * Skipped by default in CI. Set MCP_INTEGRATION=1 to enable.
 */

import * as path from 'path';
import { MCPManager, OrchidConfig, MCPError } from '../src/runtime/mcp-manager';
import { orchidString, orchidNumber, valueToString } from '../src/runtime/values';

const SKIP = !process.env.MCP_INTEGRATION;
const describeIntegration = SKIP ? describe.skip : describe;

const SERVER_PATH = path.resolve(__dirname, 'fixtures/echo-mcp-server.js');

const config: OrchidConfig = {
  mcpServers: {
    echo: {
      transport: 'stdio',
      command: 'node',
      args: [SERVER_PATH],
    },
  },
};

describeIntegration('MCP Integration (live server)', () => {
  let manager: MCPManager;

  beforeAll(async () => {
    manager = new MCPManager(config, { trace: true });
    await manager.connect('echo');
  }, 15_000); // Server startup can be slow

  afterAll(async () => {
    await manager.disconnectAll();
  }, 10_000);

  it('should connect and discover tools', () => {
    expect(manager.hasServer('echo')).toBe(true);

    const tools = manager.getTools('echo');
    const toolNames = tools.map(t => t.name).sort();

    expect(toolNames).toContain('echo');
    expect(toolNames).toContain('add');
    expect(toolNames).toContain('get_object');
    expect(toolNames).toContain('fail');
  });

  it('should have tool descriptions', () => {
    const tools = manager.getTools('echo');
    const echoTool = tools.find(t => t.name === 'echo');

    expect(echoTool).toBeDefined();
    expect(echoTool!.description).toBe('Echo back the input text');
  });

  it('should have tool input schemas', () => {
    const tools = manager.getTools('echo');
    const addTool = tools.find(t => t.name === 'add');

    expect(addTool).toBeDefined();
    expect(addTool!.inputSchema).toBeDefined();
    // The schema should describe the 'a' and 'b' parameters
    const schema = addTool!.inputSchema as any;
    expect(schema.properties).toBeDefined();
  });

  describe('echo tool', () => {
    it('should echo text back', async () => {
      const result = await manager.callTool('echo', 'echo', {
        text: orchidString('Hello from Orchid!'),
      });

      expect(result.kind).toBe('string');
      expect(valueToString(result)).toBe('Hello from Orchid!');
    });

    it('should handle special characters', async () => {
      const result = await manager.callTool('echo', 'echo', {
        text: orchidString('line1\nline2\ttab "quotes" & <xml>'),
      });

      expect(result.kind).toBe('string');
      expect(valueToString(result)).toBe('line1\nline2\ttab "quotes" & <xml>');
    });

    it('should handle empty string', async () => {
      const result = await manager.callTool('echo', 'echo', {
        text: orchidString(''),
      });

      expect(result.kind).toBe('string');
      expect(valueToString(result)).toBe('');
    });

    it('should handle unicode', async () => {
      const result = await manager.callTool('echo', 'echo', {
        text: orchidString('Orchid speaks: 日本語, العربية, 🌺'),
      });

      expect(result.kind).toBe('string');
      expect(valueToString(result)).toContain('🌺');
    });
  });

  describe('add tool', () => {
    it('should add two positive numbers', async () => {
      const result = await manager.callTool('echo', 'add', {
        a: orchidNumber(17),
        b: orchidNumber(25),
      });

      // Result comes back as text "42", which is a plain string
      expect(valueToString(result)).toBe('42');
    });

    it('should handle negative numbers', async () => {
      const result = await manager.callTool('echo', 'add', {
        a: orchidNumber(-10),
        b: orchidNumber(3),
      });

      expect(valueToString(result)).toBe('-7');
    });

    it('should handle floating point', async () => {
      const result = await manager.callTool('echo', 'add', {
        a: orchidNumber(1.5),
        b: orchidNumber(2.7),
      });

      const num = parseFloat(valueToString(result));
      expect(num).toBeCloseTo(4.2);
    });
  });

  describe('get_object tool', () => {
    it('should return parsed JSON as OrchidDict', async () => {
      const result = await manager.callTool('echo', 'get_object', {
        key: orchidString('test_key'),
      });

      // The JSON text response should be auto-parsed into an OrchidDict
      expect(result.kind).toBe('dict');

      if (result.kind === 'dict') {
        const keyVal = result.entries.get('key');
        expect(keyVal).toBeDefined();
        expect(keyVal!.kind).toBe('string');
        expect(valueToString(keyVal!)).toBe('test_key');

        const items = result.entries.get('items');
        expect(items).toBeDefined();
        expect(items!.kind).toBe('list');

        const count = result.entries.get('count');
        expect(count).toBeDefined();
        expect(count!.kind).toBe('number');
        if (count!.kind === 'number') {
          expect(count!.value).toBe(3);
        }

        const nested = result.entries.get('nested');
        expect(nested).toBeDefined();
        expect(nested!.kind).toBe('dict');
        if (nested!.kind === 'dict') {
          const ok = nested!.entries.get('ok');
          expect(ok).toBeDefined();
          expect(ok!.kind).toBe('boolean');
        }
      }
    });
  });

  describe('fail tool', () => {
    it('should throw MCPError for tool errors', async () => {
      await expect(
        manager.callTool('echo', 'fail', {
          message: orchidString('something went wrong'),
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should include the error message', async () => {
      await expect(
        manager.callTool('echo', 'fail', {
          message: orchidString('something went wrong'),
        }),
      ).rejects.toThrow(/something went wrong/);
    });
  });

  describe('error cases', () => {
    it('should throw for nonexistent tool', async () => {
      await expect(
        manager.callTool('echo', 'nonexistent_tool', {}),
      ).rejects.toThrow(/not found on MCP server/);
    });

    it('should throw for unconnected server', async () => {
      await expect(
        manager.callTool('unconnected', 'echo', {}),
      ).rejects.toThrow(/not connected/);
    });
  });

  describe('reconnect', () => {
    it('should handle disconnect and reconnect', async () => {
      // Disconnect
      await manager.disconnect('echo');
      expect(manager.hasServer('echo')).toBe(false);

      // Reconnect
      await manager.connect('echo');
      expect(manager.hasServer('echo')).toBe(true);

      // Should work again
      const result = await manager.callTool('echo', 'echo', {
        text: orchidString('back online'),
      });
      expect(valueToString(result)).toBe('back online');
    }, 15_000);
  });
});

// Guard test so Jest doesn't report "no tests" when skipping
describe('MCP Integration (skip guard)', () => {
  it('should be run with MCP_INTEGRATION=1', () => {
    if (SKIP) {
      console.log('Skipping MCP integration tests. Set MCP_INTEGRATION=1 to run.');
    }
    expect(true).toBe(true);
  });
});
