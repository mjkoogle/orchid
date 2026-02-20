/**
 * Configuration loader for Orchid.
 *
 * Loads orchid.config.json from the working directory or a specified path.
 * Provides MCP server configurations and other runtime settings.
 */

import * as fs from 'fs';
import * as path from 'path';
import { OrchidConfig } from './mcp-manager';

const CONFIG_FILENAMES = ['orchid.config.json', '.orchidrc.json'];

/**
 * Load Orchid configuration from the filesystem.
 *
 * Search order:
 * 1. Explicit path (if provided)
 * 2. orchid.config.json in cwd
 * 3. .orchidrc.json in cwd
 *
 * Returns empty config if no file is found (not an error).
 */
export function loadConfig(explicitPath?: string): OrchidConfig {
  if (explicitPath) {
    return readConfigFile(explicitPath);
  }

  const cwd = process.cwd();

  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      return readConfigFile(filePath);
    }
  }

  // No config file found — return empty config
  return {};
}

/**
 * Load config specifically relative to a script file's directory.
 * Useful when running `orchid path/to/script.orch` from a different cwd.
 */
export function loadConfigForScript(scriptPath: string): OrchidConfig {
  const scriptDir = path.dirname(path.resolve(scriptPath));

  // First check the script's directory
  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.join(scriptDir, filename);
    if (fs.existsSync(filePath)) {
      return readConfigFile(filePath);
    }
  }

  // Then fall back to cwd
  return loadConfig();
}

function readConfigFile(filePath: string): OrchidConfig {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content) as OrchidConfig;
    validateConfig(config, filePath);
    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate config structure. Throws on invalid config.
 */
function validateConfig(config: OrchidConfig, filePath: string): void {
  if (config.mcpServers && typeof config.mcpServers !== 'object') {
    throw new Error(`Invalid "mcpServers" in ${filePath}: must be an object`);
  }

  if (config.mcpServers) {
    for (const [name, server] of Object.entries(config.mcpServers)) {
      if (typeof server !== 'object' || server === null) {
        throw new Error(`Invalid MCP server config "${name}" in ${filePath}: must be an object`);
      }

      const transport = server.transport || 'stdio';
      if (transport === 'stdio' && !server.command) {
        throw new Error(
          `MCP server "${name}" in ${filePath} uses stdio transport but has no "command" specified`,
        );
      }
      if (transport === 'http' && !server.url) {
        throw new Error(
          `MCP server "${name}" in ${filePath} uses http transport but has no "url" specified`,
        );
      }
    }
  }
}
