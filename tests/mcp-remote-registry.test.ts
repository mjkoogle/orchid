/**
 * Tests for the MCP remote registry: npm search, caching, and server name derivation.
 *
 * Note: Live npm API tests are skipped by default since they require network access.
 * Run with NPM_REGISTRY_TESTS=1 to enable them.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import {
  saveCache,
  loadCache,
  searchCache,
  deriveServerName,
  NpmPackageResult,
} from '../src/runtime/mcp-remote-registry';

const CLI = path.resolve(__dirname, '../dist/cli.js');

function orchid(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], { timeout: 15_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code: error ? 1 : 0,
      });
    });
  });
}

// ─── Server Name Derivation ─────────────────────────────

describe('deriveServerName', () => {
  it('should strip @scope/ prefix', () => {
    expect(deriveServerName('@modelcontextprotocol/server-filesystem')).toBe('filesystem');
  });

  it('should strip server- prefix', () => {
    expect(deriveServerName('server-postgres')).toBe('postgres');
  });

  it('should strip mcp-server- prefix', () => {
    expect(deriveServerName('mcp-server-github')).toBe('github');
  });

  it('should strip -mcp-server suffix', () => {
    expect(deriveServerName('custom-mcp-server')).toBe('custom');
  });

  it('should strip -mcp suffix', () => {
    expect(deriveServerName('stripe-mcp')).toBe('stripe');
  });

  it('should handle combined scope and prefix', () => {
    expect(deriveServerName('@acme/server-billing')).toBe('billing');
  });

  it('should leave plain names alone', () => {
    expect(deriveServerName('my-custom-tool')).toBe('my-custom-tool');
  });
});

// ─── Cache ──────────────────────────────────────────────

describe('Cache', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchid-cache-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const samplePackages: NpmPackageResult[] = [
    {
      name: '@modelcontextprotocol/server-filesystem',
      description: 'MCP server for filesystem access',
      version: '1.0.0',
      keywords: ['mcp', 'server', 'filesystem'],
      weeklyDownloads: 5000,
    },
    {
      name: 'custom-mcp-server',
      description: 'A custom MCP server for testing',
      version: '0.1.0',
      keywords: ['mcp', 'server'],
      weeklyDownloads: 100,
    },
    {
      name: '@acme/mcp-server-billing',
      description: 'MCP server for billing operations',
      version: '2.0.0',
      keywords: ['mcp', 'billing'],
      weeklyDownloads: 800,
    },
  ];

  it('should save and load cache', () => {
    saveCache(samplePackages, tmpDir);
    const loaded = loadCache(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!).toHaveLength(3);
    expect(loaded![0].name).toBe('@modelcontextprotocol/server-filesystem');
  });

  it('should return null for nonexistent cache', () => {
    const empty = path.join(tmpDir, 'nope');
    fs.mkdirSync(empty);
    expect(loadCache(empty)).toBeNull();
  });

  it('should return null for corrupt cache', () => {
    const cacheFile = path.join(tmpDir, '.orchid-mcp-cache.json');
    fs.writeFileSync(cacheFile, 'not json!!!');
    expect(loadCache(tmpDir)).toBeNull();
  });
});

// ─── Cache Search ───────────────────────────────────────

describe('searchCache', () => {
  const packages: NpmPackageResult[] = [
    {
      name: '@modelcontextprotocol/server-filesystem',
      description: 'MCP server for filesystem access',
      version: '1.0.0',
      keywords: ['mcp', 'filesystem'],
      weeklyDownloads: 5000,
    },
    {
      name: '@modelcontextprotocol/server-postgres',
      description: 'MCP server for PostgreSQL databases',
      version: '1.0.0',
      keywords: ['mcp', 'database', 'postgres'],
      weeklyDownloads: 3000,
    },
    {
      name: 'stripe-mcp',
      description: 'MCP server for Stripe payments',
      version: '0.5.0',
      keywords: ['mcp', 'stripe', 'payments'],
      weeklyDownloads: 1500,
    },
  ];

  it('should search by name', () => {
    const results = searchCache('filesystem', packages);
    expect(results).toHaveLength(1);
    expect(results[0].name).toContain('filesystem');
  });

  it('should search by description', () => {
    const results = searchCache('database', packages);
    expect(results).toHaveLength(1);
    expect(results[0].name).toContain('postgres');
  });

  it('should search by keyword', () => {
    const results = searchCache('payments', packages);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('stripe-mcp');
  });

  it('should be case insensitive', () => {
    const results = searchCache('FILESYSTEM', packages);
    expect(results).toHaveLength(1);
  });

  it('should return empty for no matches', () => {
    const results = searchCache('nonexistent', packages);
    expect(results).toHaveLength(0);
  });

  it('should return multiple matches', () => {
    const results = searchCache('mcp', packages);
    expect(results).toHaveLength(3);
  });
});

// ─── CLI E2E ─────────────────────────────────────────────

describe('orchid mcp CLI (remote features)', () => {
  it('should show update command in help', async () => {
    const { stdout } = await orchid(['mcp', 'help']);
    expect(stdout).toContain('update');
    expect(stdout).toContain('search');
  });

  it('should handle update gracefully when network unavailable', async () => {
    const { stdout, code } = await orchid(['mcp', 'update']);
    // In CI/sandboxed environments, this may succeed with 0 results or fail gracefully
    expect(stdout).toContain('Fetching');
  });

  it('should search built-in registry even without network', async () => {
    const { stdout, code } = await orchid(['mcp', 'search', 'filesystem']);
    expect(code).toBe(0);
    expect(stdout).toContain('filesystem');
    expect(stdout).toContain('Built-in');
  });

  it('should show npm hint in list output', async () => {
    const { stdout, code } = await orchid(['mcp', 'list']);
    expect(code).toBe(0);
    // Should mention npm or update
    expect(stdout).toMatch(/npm|update/i);
  });
});

// ─── Live npm Tests (opt-in) ────────────────────────────

const LIVE_TESTS = process.env.NPM_REGISTRY_TESTS === '1';

(LIVE_TESTS ? describe : describe.skip)('Live npm search', () => {
  // These tests require actual network access to registry.npmjs.org

  it('should find official MCP server packages', async () => {
    const { searchNpm } = await import('../src/runtime/mcp-remote-registry');
    const results = await searchNpm('filesystem');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.name.includes('filesystem'))).toBe(true);
  });

  it('should fetch catalog with multiple pages', async () => {
    const { fetchCatalog } = await import('../src/runtime/mcp-remote-registry');
    const packages = await fetchCatalog(2);
    expect(packages.length).toBeGreaterThan(10);
  });
});
