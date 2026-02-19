/**
 * MCPManager - Manages MCP server connections for the Orchid runtime.
 *
 * Handles the lifecycle of MCP server connections:
 * - Connecting to servers via stdio (subprocess) or HTTP transport
 * - Discovering available tools on each server
 * - Routing tool calls to the correct server
 * - Mapping between OrchidValue and MCP tool arguments/results
 * - Graceful cleanup on shutdown
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  OrchidValue,
  orchidString,
  orchidList,
  orchidDict,
  orchidNumber,
  orchidBoolean,
  orchidNull,
  valueToString,
} from './values';

// ─── Configuration Types ────────────────────────────────

export interface MCPServerConfig {
  /** Transport type. Defaults to 'stdio'. */
  transport?: 'stdio' | 'http';

  /** Command to spawn for stdio transport. */
  command?: string;

  /** Arguments for the stdio command. */
  args?: string[];

  /** Environment variables for the stdio subprocess. */
  env?: Record<string, string>;

  /** Working directory for the stdio subprocess. */
  cwd?: string;

  /** URL for HTTP transport. */
  url?: string;

  /** HTTP headers for HTTP transport. */
  headers?: Record<string, string>;
}

export interface OrchidConfig {
  /** MCP server configurations keyed by server name. */
  mcpServers?: Record<string, MCPServerConfig>;
}

interface ConnectedServer {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: Map<string, MCPToolInfo>;
  config: MCPServerConfig;
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ─── MCPManager ─────────────────────────────────────────

export class MCPManager {
  private servers: Map<string, ConnectedServer> = new Map();
  private config: OrchidConfig;
  private traceEnabled: boolean;
  private traceLog: string[] = [];

  constructor(config: OrchidConfig = {}, options?: { trace?: boolean }) {
    this.config = config;
    this.traceEnabled = options?.trace ?? false;
  }

  /**
   * Connect to a named MCP server.
   * Looks up the server config from orchid.config.json, connects,
   * and discovers available tools.
   */
  async connect(name: string): Promise<void> {
    if (this.servers.has(name)) {
      this.trace(`MCP server "${name}" already connected`);
      return;
    }

    const serverConfig = this.config.mcpServers?.[name];
    if (!serverConfig) {
      throw new MCPError(
        `No MCP server configuration found for "${name}". ` +
        `Add it to orchid.config.json under "mcpServers".`,
      );
    }

    const transportType = serverConfig.transport || 'stdio';

    if (transportType === 'stdio') {
      await this.connectStdio(name, serverConfig);
    } else if (transportType === 'http') {
      await this.connectHttp(name, serverConfig);
    } else {
      throw new MCPError(`Unknown transport type "${transportType}" for MCP server "${name}".`);
    }
  }

  /**
   * Check if a namespace corresponds to a connected MCP server.
   */
  hasServer(namespace: string): boolean {
    return this.servers.has(namespace);
  }

  /**
   * Check if a server is configured (but not necessarily connected yet).
   */
  isConfigured(name: string): boolean {
    return this.config.mcpServers?.[name] !== undefined;
  }

  /**
   * Call a tool on a connected MCP server.
   * Maps OrchidValue arguments to JSON and MCP results back to OrchidValue.
   */
  async callTool(
    namespace: string,
    operation: string,
    args: Record<string, OrchidValue>,
  ): Promise<OrchidValue> {
    const server = this.servers.get(namespace);
    if (!server) {
      throw new MCPError(
        `MCP server "${namespace}" is not connected. ` +
        `Use \`Use MCP("${namespace}")\` to connect first.`,
      );
    }

    // Check if the tool exists
    const tool = server.tools.get(operation);
    if (!tool) {
      const available = Array.from(server.tools.keys()).join(', ');
      throw new MCPError(
        `Tool "${operation}" not found on MCP server "${namespace}". ` +
        `Available tools: ${available || '(none)'}`,
      );
    }

    // Convert OrchidValue args to plain JSON
    const jsonArgs = orchidArgsToJson(args);

    this.trace(`MCP call: ${namespace}:${operation}(${JSON.stringify(jsonArgs)})`);

    try {
      const result = await server.client.callTool({
        name: operation,
        arguments: jsonArgs,
      });

      // Cast to any at the MCP boundary — the SDK's union types are complex
      // and we normalize everything into OrchidValue anyway
      const content = (result as any).content as any[] | undefined;
      const structuredContent = (result as any).structuredContent as Record<string, unknown> | undefined;

      if (result.isError) {
        const errorText = (content || [])
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('\n') || 'Unknown MCP tool error';
        throw new MCPError(`MCP tool error from ${namespace}:${operation}: ${errorText}`);
      }

      return mcpResultToOrchidValue({ content, structuredContent });
    } catch (error) {
      if (error instanceof MCPError) throw error;
      throw new MCPError(
        `Failed to call ${namespace}:${operation}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List tools available on a connected server.
   */
  getTools(namespace: string): MCPToolInfo[] {
    const server = this.servers.get(namespace);
    if (!server) return [];
    return Array.from(server.tools.values());
  }

  /**
   * List all connected server namespaces.
   */
  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Disconnect a specific server.
   */
  async disconnect(namespace: string): Promise<void> {
    const server = this.servers.get(namespace);
    if (!server) return;

    try {
      await server.client.close();
    } catch {
      // Best-effort cleanup
    }
    this.servers.delete(namespace);
    this.trace(`MCP server "${namespace}" disconnected`);
  }

  /**
   * Disconnect all servers. Call this on interpreter shutdown.
   */
  async disconnectAll(): Promise<void> {
    const namespaces = Array.from(this.servers.keys());
    await Promise.allSettled(
      namespaces.map(ns => this.disconnect(ns)),
    );
  }

  // ─── Private Methods ──────────────────────────────────

  private async connectStdio(name: string, config: MCPServerConfig): Promise<void> {
    if (!config.command) {
      throw new MCPError(
        `MCP server "${name}" is configured for stdio transport but has no "command" specified.`,
      );
    }

    this.trace(`Connecting to MCP server "${name}" via stdio: ${config.command} ${(config.args || []).join(' ')}`);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
      cwd: config.cwd,
    });

    const client = new Client(
      { name: `orchid-${name}`, version: '0.1.0' },
    );

    try {
      await client.connect(transport);
    } catch (error) {
      throw new MCPError(
        `Failed to connect to MCP server "${name}" (${config.command}): ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Discover tools
    const tools = new Map<string, MCPToolInfo>();
    try {
      const toolsResult = await client.listTools();
      for (const tool of toolsResult.tools) {
        tools.set(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
      this.trace(`MCP server "${name}": discovered ${tools.size} tools: ${Array.from(tools.keys()).join(', ')}`);
    } catch (error) {
      this.trace(`MCP server "${name}": tool discovery failed (${error instanceof Error ? error.message : String(error)}), proceeding with no tools`);
    }

    this.servers.set(name, { client, transport, tools, config });
  }

  private async connectHttp(name: string, config: MCPServerConfig): Promise<void> {
    if (!config.url) {
      throw new MCPError(
        `MCP server "${name}" is configured for HTTP transport but has no "url" specified.`,
      );
    }

    this.trace(`Connecting to MCP server "${name}" via HTTP: ${config.url}`);

    const url = new URL(config.url);
    const requestInit: RequestInit | undefined = config.headers
      ? { headers: config.headers }
      : undefined;

    const transport = new StreamableHTTPClientTransport(url, {
      requestInit,
    });

    const client = new Client(
      { name: `orchid-${name}`, version: '0.1.0' },
    );

    try {
      await client.connect(transport);
    } catch (error) {
      throw new MCPError(
        `Failed to connect to MCP server "${name}" (${config.url}): ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Discover tools
    const tools = new Map<string, MCPToolInfo>();
    try {
      const toolsResult = await client.listTools();
      for (const tool of toolsResult.tools) {
        tools.set(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as Record<string, unknown>,
        });
      }
      this.trace(`MCP server "${name}": discovered ${tools.size} tools: ${Array.from(tools.keys()).join(', ')}`);
    } catch (error) {
      this.trace(`MCP server "${name}": tool discovery failed (${error instanceof Error ? error.message : String(error)}), proceeding with no tools`);
    }

    this.servers.set(name, { client, transport, tools, config });
  }

  private trace(message: string): void {
    this.traceLog.push(`[mcp] ${message}`);
    if (this.traceEnabled) {
      console.log(`  [mcp] ${message}`);
    }
  }
}

// ─── Value Conversion ───────────────────────────────────

/**
 * Convert OrchidValue arguments to plain JSON for MCP tool calls.
 */
function orchidArgsToJson(args: Record<string, OrchidValue>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = orchidValueToJson(value);
  }
  return result;
}

function orchidValueToJson(value: OrchidValue): unknown {
  switch (value.kind) {
    case 'string': return value.value;
    case 'number': return value.value;
    case 'boolean': return value.value;
    case 'null': return null;
    case 'list': return value.elements.map(orchidValueToJson);
    case 'dict': {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value.entries) {
        obj[k] = orchidValueToJson(v);
      }
      return obj;
    }
    default: return valueToString(value);
  }
}

/**
 * Convert MCP CallToolResult to OrchidValue.
 *
 * Strategy:
 * - Single text block → OrchidString
 * - Multiple text blocks → OrchidList of strings
 * - Structured content → OrchidDict
 * - Mixed content → OrchidList
 */
function mcpResultToOrchidValue(result: { content?: unknown[]; structuredContent?: Record<string, unknown> }): OrchidValue {
  // Prefer structured content if available
  if (result.structuredContent) {
    return jsonToOrchidValue(result.structuredContent);
  }

  const content = result.content || [];

  if (content.length === 0) {
    return orchidNull();
  }

  // Extract text blocks
  const textBlocks = content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text as string);

  if (textBlocks.length === 1) {
    // Single text result — try to parse as JSON first
    try {
      const parsed = JSON.parse(textBlocks[0]);
      return jsonToOrchidValue(parsed);
    } catch {
      return orchidString(textBlocks[0]);
    }
  }

  if (textBlocks.length > 1) {
    return orchidList(textBlocks.map(t => orchidString(t)));
  }

  // Fallback: stringify all content
  return orchidString(content.map((block: any) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'image') return `[image: ${block.mimeType}]`;
    if (block.type === 'resource_link') return `[resource: ${block.uri}]`;
    return `[${block.type}]`;
  }).join('\n'));
}

/**
 * Convert arbitrary JSON to OrchidValue.
 */
function jsonToOrchidValue(value: unknown): OrchidValue {
  if (value === null || value === undefined) return orchidNull();
  if (typeof value === 'string') return orchidString(value);
  if (typeof value === 'number') return orchidNumber(value);
  if (typeof value === 'boolean') return orchidBoolean(value);
  if (Array.isArray(value)) {
    return orchidList(value.map(jsonToOrchidValue));
  }
  if (typeof value === 'object') {
    const entries = new Map<string, OrchidValue>();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      entries.set(k, jsonToOrchidValue(v));
    }
    return orchidDict(entries);
  }
  return orchidString(String(value));
}

// ─── Error Type ─────────────────────────────────────────

export class MCPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPError';
  }
}
