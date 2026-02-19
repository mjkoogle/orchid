import { MCPManager, MCPError, OrchidConfig } from '../src/runtime/mcp-manager';
import { orchidString, orchidNumber, orchidList, orchidDict, orchidNull, orchidBoolean } from '../src/runtime/values';

// Mock the MCP SDK modules
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      listTools: jest.fn().mockResolvedValue({
        tools: [
          { name: 'search', description: 'Search papers', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
          { name: 'fetch', description: 'Fetch a document', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
        ],
      }),
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Mock MCP result' }],
        isError: false,
      }),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  return {
    StdioClientTransport: jest.fn().mockImplementation(() => ({})),
  };
});

// Suppress console.log during tests
const originalLog = console.log;
beforeAll(() => { console.log = jest.fn(); });
afterAll(() => { console.log = originalLog; });

describe('MCPManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const testConfig: OrchidConfig = {
    mcpServers: {
      'arxiv': {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'arxiv-mcp-server'],
      },
      'filesystem': {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
    },
  };

  describe('connect()', () => {
    it('should connect to a configured MCP server', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      expect(manager.hasServer('arxiv')).toBe(true);
    });

    it('should discover tools on connection', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      const tools = manager.getTools('arxiv');
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('search');
      expect(tools[1].name).toBe('fetch');
    });

    it('should throw for unconfigured server', async () => {
      const manager = new MCPManager(testConfig);

      await expect(manager.connect('unknown'))
        .rejects.toThrow(/No MCP server configuration found/);
    });

    it('should be idempotent (no error on double connect)', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');
      await manager.connect('arxiv'); // Should not throw

      expect(manager.hasServer('arxiv')).toBe(true);
    });

    it('should throw for stdio without command', async () => {
      const config: OrchidConfig = {
        mcpServers: {
          'broken': { transport: 'stdio' },
        },
      };
      const manager = new MCPManager(config);

      await expect(manager.connect('broken'))
        .rejects.toThrow(/no "command" specified/);
    });

    it('should throw for http transport with missing url', async () => {
      const config: OrchidConfig = {
        mcpServers: {
          'remote': { transport: 'http' },
        },
      };
      const manager = new MCPManager(config);

      await expect(manager.connect('remote'))
        .rejects.toThrow(/no "url" specified/);
    });

    it('should accept http transport with valid url', async () => {
      const config: OrchidConfig = {
        mcpServers: {
          'remote': { transport: 'http', url: 'http://127.0.0.1:1/mcp' },
        },
      };
      const manager = new MCPManager(config);

      // StreamableHTTPClientTransport uses lazy connection, so connect()
      // may resolve even if the server isn't reachable. The important thing
      // is that it doesn't throw "not yet supported" anymore.
      try {
        await manager.connect('remote');
        // If it connected (lazy), clean up
        await manager.disconnect('remote');
      } catch (e: any) {
        // Connection failure is acceptable here — we just verify it's not
        // the old "not yet supported" error
        expect(e.message).not.toMatch(/not yet supported/);
      }
    });
  });

  describe('hasServer()', () => {
    it('should return false for unconnected server', () => {
      const manager = new MCPManager(testConfig);
      expect(manager.hasServer('arxiv')).toBe(false);
    });

    it('should return true after connection', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');
      expect(manager.hasServer('arxiv')).toBe(true);
    });
  });

  describe('isConfigured()', () => {
    it('should return true for configured servers', () => {
      const manager = new MCPManager(testConfig);
      expect(manager.isConfigured('arxiv')).toBe(true);
      expect(manager.isConfigured('filesystem')).toBe(true);
    });

    it('should return false for unconfigured servers', () => {
      const manager = new MCPManager(testConfig);
      expect(manager.isConfigured('unknown')).toBe(false);
    });
  });

  describe('callTool()', () => {
    it('should call a tool on a connected server', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      const result = await manager.callTool('arxiv', 'search', {
        query: orchidString('transformer attention'),
      });

      expect(result.kind).toBe('string');
      if (result.kind === 'string') {
        expect(result.value).toBe('Mock MCP result');
      }
    });

    it('should throw for unconnected server', async () => {
      const manager = new MCPManager(testConfig);

      await expect(manager.callTool('arxiv', 'search', {}))
        .rejects.toThrow(/not connected/);
    });

    it('should throw for unknown tool', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      await expect(manager.callTool('arxiv', 'nonexistent', {}))
        .rejects.toThrow(/not found on MCP server/);
    });

    it('should convert OrchidValue args to JSON', async () => {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      await manager.callTool('arxiv', 'search', {
        query: orchidString('test query'),
        limit: orchidNumber(10),
        verbose: orchidBoolean(true),
      });

      // Verify the mocked callTool was called with plain JSON args
      const clientInstance = Client.mock.results[0].value;
      expect(clientInstance.callTool).toHaveBeenCalledWith({
        name: 'search',
        arguments: {
          query: 'test query',
          limit: 10,
          verbose: true,
        },
      });
    });

    it('should handle list and dict args', async () => {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      const entries = new Map([['key', orchidString('value')]]);
      await manager.callTool('arxiv', 'search', {
        tags: orchidList([orchidString('a'), orchidString('b')]),
        options: orchidDict(entries),
      });

      const clientInstance = Client.mock.results[0].value;
      expect(clientInstance.callTool).toHaveBeenCalledWith({
        name: 'search',
        arguments: {
          tags: ['a', 'b'],
          options: { key: 'value' },
        },
      });
    });

    it('should handle MCP tool errors', async () => {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      // Override callTool to return an error
      const clientInstance = Client.mock.results[0].value;
      clientInstance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Rate limit exceeded' }],
        isError: true,
      });

      await expect(manager.callTool('arxiv', 'search', {}))
        .rejects.toThrow(/MCP tool error.*Rate limit exceeded/);
    });

    it('should parse JSON text results into OrchidValues', async () => {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      // Return JSON as text
      const clientInstance = Client.mock.results[0].value;
      clientInstance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"title": "Paper", "year": 2024}' }],
        isError: false,
      });

      const result = await manager.callTool('arxiv', 'search', {});

      expect(result.kind).toBe('dict');
      if (result.kind === 'dict') {
        expect(result.entries.get('title')).toEqual(orchidString('Paper'));
        expect(result.entries.get('year')).toEqual(orchidNumber(2024));
      }
    });

    it('should handle multiple text blocks as list', async () => {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      const clientInstance = Client.mock.results[0].value;
      clientInstance.callTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Result 1' },
          { type: 'text', text: 'Result 2' },
        ],
        isError: false,
      });

      const result = await manager.callTool('arxiv', 'search', {});

      expect(result.kind).toBe('list');
      if (result.kind === 'list') {
        expect(result.elements).toHaveLength(2);
      }
    });

    it('should handle empty results', async () => {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      const clientInstance = Client.mock.results[0].value;
      clientInstance.callTool.mockResolvedValueOnce({
        content: [],
        isError: false,
      });

      const result = await manager.callTool('arxiv', 'search', {});
      expect(result.kind).toBe('null');
    });

    it('should prefer structured content over text', async () => {
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');

      const clientInstance = Client.mock.results[0].value;
      clientInstance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ignored' }],
        structuredContent: { data: [1, 2, 3] },
        isError: false,
      });

      const result = await manager.callTool('arxiv', 'search', {});
      expect(result.kind).toBe('dict');
    });
  });

  describe('getConnectedServers()', () => {
    it('should list all connected servers', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');
      await manager.connect('filesystem');

      const servers = manager.getConnectedServers();
      expect(servers).toContain('arxiv');
      expect(servers).toContain('filesystem');
      expect(servers).toHaveLength(2);
    });
  });

  describe('disconnect()', () => {
    it('should disconnect a specific server', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');
      expect(manager.hasServer('arxiv')).toBe(true);

      await manager.disconnect('arxiv');
      expect(manager.hasServer('arxiv')).toBe(false);
    });

    it('should be safe to call on unconnected server', async () => {
      const manager = new MCPManager(testConfig);
      await manager.disconnect('arxiv'); // Should not throw
    });
  });

  describe('disconnectAll()', () => {
    it('should disconnect all connected servers', async () => {
      const manager = new MCPManager(testConfig);
      await manager.connect('arxiv');
      await manager.connect('filesystem');

      await manager.disconnectAll();

      expect(manager.hasServer('arxiv')).toBe(false);
      expect(manager.hasServer('filesystem')).toBe(false);
    });
  });

  describe('with trace enabled', () => {
    it('should log connection events', async () => {
      const manager = new MCPManager(testConfig, { trace: true });
      await manager.connect('arxiv');

      // Trace output goes to console.log which is mocked
      expect(console.log).toHaveBeenCalled();
    });
  });
});
