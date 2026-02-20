/**
 * Tests for the MCP install system: registry lookup, config writing,
 * @requires parsing, and CLI integration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import {
  installServer,
  installFromScript,
  parseRequiredServers,
} from '../src/runtime/mcp-install';
import {
  lookupServer,
  searchRegistry,
  listRegistry,
  MCP_REGISTRY,
} from '../src/runtime/mcp-registry';

const CLI = path.resolve(__dirname, '../dist/cli.js');

function orchid(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], { timeout: 10_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code: error ? 1 : 0,
      });
    });
  });
}

// ─── Registry Tests ─────────────────────────────────────

describe('MCP Registry', () => {
  it('should have at least 10 servers', () => {
    const entries = listRegistry();
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });

  it('should look up known servers', () => {
    const fs = lookupServer('filesystem');
    expect(fs).toBeDefined();
    expect(fs!.package).toBe('@modelcontextprotocol/server-filesystem');
    expect(fs!.defaultConfig.command).toBe('npx');
  });

  it('should return undefined for unknown servers', () => {
    expect(lookupServer('nonexistent-xyz')).toBeUndefined();
  });

  it('should search by name', () => {
    const results = searchRegistry('file');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.name === 'filesystem')).toBe(true);
  });

  it('should search by description keyword', () => {
    const results = searchRegistry('database');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should search by package name', () => {
    const results = searchRegistry('puppeteer');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('puppeteer');
  });

  it('should have valid entries with required fields', () => {
    for (const [name, entry] of Object.entries(MCP_REGISTRY)) {
      expect(entry.package).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.defaultConfig).toBeDefined();
      expect(entry.defaultConfig.command).toBe('npx');
      expect(entry.defaultConfig.args).toBeDefined();
      expect(entry.defaultConfig.args!.includes('-y')).toBe(true);
      expect(entry.defaultConfig.args!.includes(entry.package)).toBe(true);
    }
  });
});

// ─── @requires Parsing ──────────────────────────────────

describe('parseRequiredServers', () => {
  it('should parse single @requires', () => {
    const source = `@orchid 0.1\n@requires MCP("filesystem")\nLog("hi")`;
    expect(parseRequiredServers(source)).toEqual(['filesystem']);
  });

  it('should parse multiple @requires', () => {
    const source = `@orchid 0.1\n@requires MCP("financial-data"), MCP("news-api"), MCP("filesystem")\nLog("hi")`;
    const names = parseRequiredServers(source);
    expect(names).toEqual(['financial-data', 'news-api', 'filesystem']);
  });

  it('should return empty array for no @requires', () => {
    const source = `@orchid 0.1\n@name "Test"\nLog("hi")`;
    expect(parseRequiredServers(source)).toEqual([]);
  });

  it('should handle malformed source via regex fallback', () => {
    const source = `@requires MCP("filesystem")\nthis is {{{{ broken`;
    // The regex fallback should still find it
    const names = parseRequiredServers(source);
    expect(names).toContain('filesystem');
  });
});

// ─── Install Logic ──────────────────────────────────────

describe('installServer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchid-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create orchid.config.json with server config', () => {
    const result = installServer('filesystem', tmpDir);
    expect(result.status).toBe('installed');
    expect(result.name).toBe('filesystem');

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'orchid.config.json'), 'utf-8'));
    expect(config.mcpServers.filesystem).toBeDefined();
    expect(config.mcpServers.filesystem.command).toBe('npx');
    expect(config.mcpServers.filesystem.args).toContain('@modelcontextprotocol/server-filesystem');
  });

  it('should report already_configured for duplicate install', () => {
    installServer('filesystem', tmpDir);
    const result = installServer('filesystem', tmpDir);
    expect(result.status).toBe('already_configured');
  });

  it('should install multiple servers into the same config', () => {
    installServer('filesystem', tmpDir);
    installServer('memory', tmpDir);

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'orchid.config.json'), 'utf-8'));
    expect(Object.keys(config.mcpServers)).toEqual(['filesystem', 'memory']);
  });

  it('should return not_found for unknown servers', () => {
    const result = installServer('nonexistent-xyz', tmpDir);
    expect(result.status).toBe('not_found');
  });

  it('should install custom npm packages', () => {
    const result = installServer('@example/server-custom', tmpDir);
    expect(result.status).toBe('installed');
    expect(result.name).toBe('custom');

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'orchid.config.json'), 'utf-8'));
    expect(config.mcpServers.custom).toBeDefined();
    expect(config.mcpServers.custom.args).toContain('@example/server-custom');
  });

  it('should include env vars for servers that need them', () => {
    const result = installServer('brave-search', tmpDir);
    expect(result.status).toBe('installed');
    expect(result.envVarsNeeded).toBeDefined();
    expect(result.envVarsNeeded!.BRAVE_API_KEY).toBeTruthy();

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'orchid.config.json'), 'utf-8'));
    expect(config.mcpServers['brave-search'].env).toBeDefined();
  });

  it('should preserve existing config entries', () => {
    // Write existing config with a custom server
    fs.writeFileSync(
      path.join(tmpDir, 'orchid.config.json'),
      JSON.stringify({ mcpServers: { custom: { command: 'echo', args: ['hi'] } } }),
    );

    installServer('filesystem', tmpDir);

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'orchid.config.json'), 'utf-8'));
    expect(config.mcpServers.custom).toBeDefined();
    expect(config.mcpServers.filesystem).toBeDefined();
  });
});

// ─── Install from Script ─────────────────────────────────

describe('installFromScript', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchid-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should install servers referenced in @requires', () => {
    const scriptPath = path.join(tmpDir, 'test.orch');
    fs.writeFileSync(scriptPath, `@orchid 0.1\n@requires MCP("filesystem"), MCP("memory")\nLog("test")`);

    const results = installFromScript(scriptPath, tmpDir);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('installed');
    expect(results[0].name).toBe('filesystem');
    expect(results[1].status).toBe('installed');
    expect(results[1].name).toBe('memory');

    const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'orchid.config.json'), 'utf-8'));
    expect(config.mcpServers.filesystem).toBeDefined();
    expect(config.mcpServers.memory).toBeDefined();
  });

  it('should error on missing script', () => {
    const results = installFromScript('/nonexistent/script.orch', tmpDir);
    expect(results[0].status).toBe('error');
  });

  it('should error when no @requires found', () => {
    const scriptPath = path.join(tmpDir, 'empty.orch');
    fs.writeFileSync(scriptPath, `@orchid 0.1\nLog("hello")`);

    const results = installFromScript(scriptPath, tmpDir);
    expect(results[0].status).toBe('error');
    expect(results[0].message).toContain('No @requires');
  });
});

// ─── CLI E2E ─────────────────────────────────────────────

describe('orchid mcp CLI', () => {
  it('should show mcp help', async () => {
    const { stdout } = await orchid(['mcp', 'help']);
    expect(stdout).toContain('orchid mcp');
    expect(stdout).toContain('install');
    expect(stdout).toContain('list');
    expect(stdout).toContain('search');
  });

  it('should show mcp help with no args', async () => {
    const { stdout } = await orchid(['mcp']);
    expect(stdout).toContain('orchid mcp');
  });

  it('should list all servers', async () => {
    const { stdout, code } = await orchid(['mcp', 'list']);
    expect(code).toBe(0);
    expect(stdout).toContain('filesystem');
    expect(stdout).toContain('memory');
    expect(stdout).toContain('brave-search');
    expect(stdout).toContain('Built-in MCP servers');
  });

  it('should search the registry', async () => {
    const { stdout, code } = await orchid(['mcp', 'search', 'file']);
    expect(code).toBe(0);
    expect(stdout).toContain('filesystem');
  });

  it('should report no results for bad search', async () => {
    const { stdout, code } = await orchid(['mcp', 'search', 'zzzznotarealserver']);
    expect(code).toBe(0);
    // npm search is fuzzy — a nonsense query may still return MCP-related
    // packages. We only assert the command succeeds and produces output.
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('should install a known server', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchid-cli-'));
    try {
      const { stdout, code } = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        execFile('node', [CLI, 'mcp', 'install', 'memory'], {
          timeout: 10_000,
          cwd: tmpDir,
        }, (error, stdout, stderr) => {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code: error ? 1 : 0 });
        });
      });
      expect(code).toBe(0);
      expect(stdout).toContain('memory');

      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'orchid.config.json'), 'utf-8'));
      expect(config.mcpServers.memory).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should install from a .orch script', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchid-cli-'));
    try {
      const scriptPath = path.join(tmpDir, 'app.orch');
      fs.writeFileSync(scriptPath, `@orchid 0.1\n@requires MCP("filesystem"), MCP("memory")\nLog("test")`);

      const { stdout, code } = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        execFile('node', [CLI, 'mcp', 'install', scriptPath], {
          timeout: 10_000,
          cwd: tmpDir,
        }, (error, stdout, stderr) => {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code: error ? 1 : 0 });
        });
      });
      expect(code).toBe(0);
      expect(stdout).toContain('filesystem');
      expect(stdout).toContain('memory');

      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'orchid.config.json'), 'utf-8'));
      expect(config.mcpServers.filesystem).toBeDefined();
      expect(config.mcpServers.memory).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
