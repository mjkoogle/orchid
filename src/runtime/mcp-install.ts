/**
 * MCP Install — auto-configure MCP servers for Orchid scripts.
 *
 * Provides:
 *  - `installServer(name, configPath?)` — add a single server to orchid.config.json
 *  - `installFromScript(scriptPath)` — parse @requires and install all referenced MCP servers
 *  - `verifyServer(name)` — check if an npx package is available
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { OrchidConfig, MCPServerConfig } from './mcp-manager';
import { lookupServer, MCP_REGISTRY, RegistryEntry } from './mcp-registry';
import { Lexer } from '../lexer/lexer';
import { Parser } from '../parser/parser';
import * as AST from '../parser/ast';

export interface InstallResult {
  name: string;
  status: 'installed' | 'already_configured' | 'not_found' | 'error';
  message: string;
  envVarsNeeded?: Record<string, string>;
}

/**
 * Install a single MCP server into orchid.config.json.
 */
export function installServer(
  name: string,
  configDir: string = process.cwd(),
): InstallResult {
  const entry = lookupServer(name);
  if (!entry) {
    // Check if it looks like a full npm package name
    if (name.startsWith('@') || name.includes('/')) {
      return installCustomPackage(name, configDir);
    }
    return {
      name,
      status: 'not_found',
      message: `"${name}" is not in the Orchid MCP registry. Use the full npm package name to install manually, e.g.:\n  orchid mcp install @scope/server-name`,
    };
  }

  return installFromRegistry(name, entry, configDir);
}

/**
 * Parse a .orch script's @requires metadata and install all referenced MCP servers.
 */
export function installFromScript(
  scriptPath: string,
  configDir?: string,
): InstallResult[] {
  const resolved = path.resolve(scriptPath);
  if (!fs.existsSync(resolved)) {
    return [{
      name: scriptPath,
      status: 'error',
      message: `Script not found: ${resolved}`,
    }];
  }

  const source = fs.readFileSync(resolved, 'utf-8');
  const serverNames = parseRequiredServers(source);

  if (serverNames.length === 0) {
    return [{
      name: scriptPath,
      status: 'error',
      message: `No @requires MCP(...) declarations found in ${path.basename(scriptPath)}`,
    }];
  }

  const dir = configDir || path.dirname(resolved);
  return serverNames.map(name => installServer(name, dir));
}

/**
 * Parse @requires MCP("name") declarations from Orchid source code.
 * Returns the list of server names.
 */
export function parseRequiredServers(source: string): string[] {
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser();
    const ast = parser.parse(tokens);

    const names: string[] = [];
    for (const meta of ast.metadata) {
      if (meta.directive === 'requires') {
        extractMCPNames(meta.value, names);
      }
    }
    return names;
  } catch {
    // If parsing fails, try a simple regex fallback
    return parseRequiredServersRegex(source);
  }
}

function extractMCPNames(node: AST.Node, names: string[]): void {
  // MCP("name") becomes an Operation node with name="MCP" and a string arg
  if (node.type === 'Operation' && node.name === 'MCP') {
    for (const arg of node.args) {
      if (arg.value.type === 'StringLiteral') {
        names.push(arg.value.value);
      }
    }
  }
  // ListLiteral for comma-separated @requires
  if (node.type === 'ListLiteral') {
    for (const el of node.elements) {
      extractMCPNames(el, names);
    }
  }
}

function parseRequiredServersRegex(source: string): string[] {
  const names: string[] = [];
  const regex = /@requires\s+.*?MCP\("([^"]+)"\)/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

// ─── Internal Helpers ─────────────────────────────────

function installFromRegistry(
  name: string,
  entry: RegistryEntry,
  configDir: string,
): InstallResult {
  const configPath = path.join(configDir, 'orchid.config.json');
  const config = loadOrCreateConfig(configPath);

  if (config.mcpServers?.[name]) {
    return {
      name,
      status: 'already_configured',
      message: `"${name}" is already configured in orchid.config.json`,
    };
  }

  // Add the server config
  if (!config.mcpServers) {
    config.mcpServers = {};
  }
  config.mcpServers[name] = { ...entry.defaultConfig };

  // Write the config
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const envNote = entry.envVars
    ? Object.entries(entry.envVars)
        .filter(([key]) => entry.defaultConfig.env?.[key] === '')
        .map(([key, desc]) => `  ${key} — ${desc}`)
        .join('\n')
    : '';

  return {
    name,
    status: 'installed',
    message: `Installed "${name}" (${entry.package})` +
      (envNote ? `\n\nRequired environment variables:\n${envNote}` : ''),
    envVarsNeeded: entry.envVars,
  };
}

function installCustomPackage(
  packageName: string,
  configDir: string,
): InstallResult {
  // Derive a server name from the package name
  const serverName = packageName
    .replace(/^@[^/]+\//, '')     // strip scope
    .replace(/^server-/, '')       // strip server- prefix
    .replace(/^mcp-/, '');         // strip mcp- prefix

  const configPath = path.join(configDir, 'orchid.config.json');
  const config = loadOrCreateConfig(configPath);

  if (config.mcpServers?.[serverName]) {
    return {
      name: serverName,
      status: 'already_configured',
      message: `"${serverName}" is already configured in orchid.config.json`,
    };
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers[serverName] = {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', packageName],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  return {
    name: serverName,
    status: 'installed',
    message: `Installed "${serverName}" (${packageName})`,
  };
}

function loadOrCreateConfig(configPath: string): OrchidConfig {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Verify that an npx package is resolvable (optional pre-check).
 */
export function verifyPackage(packageName: string): boolean {
  try {
    execSync(`npm view ${packageName} name`, { stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}
