/**
 * MCP Server Registry
 *
 * Maps well-known MCP server names to their npm packages and default
 * configurations. Used by `orchid mcp install` to auto-configure servers.
 */

import { MCPServerConfig } from './mcp-manager';

export interface RegistryEntry {
  /** npm package name */
  package: string;
  /** Human-readable description */
  description: string;
  /** Default server config (command/args/env placeholders) */
  defaultConfig: MCPServerConfig;
  /** Environment variables the server needs (with descriptions) */
  envVars?: Record<string, string>;
}

/**
 * Built-in registry of well-known MCP servers.
 *
 * This is a curated list — not exhaustive. Users can always configure
 * servers manually in orchid.config.json for unlisted packages.
 */
export const MCP_REGISTRY: Record<string, RegistryEntry> = {
  'filesystem': {
    package: '@modelcontextprotocol/server-filesystem',
    description: 'Read, write, and manage files on the local filesystem',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    },
  },
  'brave-search': {
    package: '@modelcontextprotocol/server-brave-search',
    description: 'Web search via the Brave Search API',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' },
    },
    envVars: {
      BRAVE_API_KEY: 'Brave Search API key (https://brave.com/search/api/)',
    },
  },
  'github': {
    package: '@modelcontextprotocol/server-github',
    description: 'Interact with GitHub repositories, issues, and pull requests',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
    envVars: {
      GITHUB_PERSONAL_ACCESS_TOKEN: 'GitHub personal access token',
    },
  },
  'memory': {
    package: '@modelcontextprotocol/server-memory',
    description: 'Persistent key-value memory store for agents',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  },
  'postgres': {
    package: '@modelcontextprotocol/server-postgres',
    description: 'Query and manage PostgreSQL databases',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: { POSTGRES_CONNECTION_STRING: '' },
    },
    envVars: {
      POSTGRES_CONNECTION_STRING: 'PostgreSQL connection string (e.g. postgresql://user:pass@localhost/db)',
    },
  },
  'sqlite': {
    package: '@modelcontextprotocol/server-sqlite',
    description: 'Query and manage SQLite databases',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite'],
    },
  },
  'puppeteer': {
    package: '@modelcontextprotocol/server-puppeteer',
    description: 'Browser automation via Puppeteer (screenshots, navigation, interaction)',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
  'fetch': {
    package: '@modelcontextprotocol/server-fetch',
    description: 'Fetch and extract content from web URLs',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
    },
  },
  'slack': {
    package: '@modelcontextprotocol/server-slack',
    description: 'Read and send messages in Slack workspaces',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: { SLACK_BOT_TOKEN: '' },
    },
    envVars: {
      SLACK_BOT_TOKEN: 'Slack Bot OAuth token (xoxb-...)',
    },
  },
  'google-maps': {
    package: '@modelcontextprotocol/server-google-maps',
    description: 'Geocoding, directions, and place search via Google Maps',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-google-maps'],
      env: { GOOGLE_MAPS_API_KEY: '' },
    },
    envVars: {
      GOOGLE_MAPS_API_KEY: 'Google Maps API key',
    },
  },
  'sequential-thinking': {
    package: '@modelcontextprotocol/server-sequential-thinking',
    description: 'Dynamic problem-solving through structured sequential thinking',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
  },
  'everything': {
    package: '@modelcontextprotocol/server-everything',
    description: 'MCP test server that exercises all protocol features',
    defaultConfig: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    },
  },
};

/**
 * Look up a server by name. Returns undefined if not in registry.
 */
export function lookupServer(name: string): RegistryEntry | undefined {
  return MCP_REGISTRY[name];
}

/**
 * Search the registry by keyword (matches name, package, or description).
 */
export function searchRegistry(query: string): { name: string; entry: RegistryEntry }[] {
  const q = query.toLowerCase();
  return Object.entries(MCP_REGISTRY)
    .filter(([name, entry]) =>
      name.includes(q) ||
      entry.package.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q),
    )
    .map(([name, entry]) => ({ name, entry }));
}

/**
 * List all servers in the registry.
 */
export function listRegistry(): { name: string; entry: RegistryEntry }[] {
  return Object.entries(MCP_REGISTRY)
    .map(([name, entry]) => ({ name, entry }));
}
