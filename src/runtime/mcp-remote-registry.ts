/**
 * MCP Remote Registry — live search for MCP servers via npm.
 *
 * Queries the npm registry to discover MCP server packages beyond
 * the built-in static list. Works like `apt update` + `apt search`:
 *
 *   orchid mcp search <query>   — search built-in + npm live
 *   orchid mcp update           — refresh the local cache from npm
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';
const CACHE_FILENAME = '.orchid-mcp-cache.json';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface NpmPackageResult {
  name: string;
  description: string;
  version: string;
  keywords: string[];
  /** Weekly download count — used as a quality signal */
  weeklyDownloads: number;
}

interface CacheData {
  updatedAt: string;
  packages: NpmPackageResult[];
}

/**
 * Search npm for MCP server packages matching a query.
 * Combines "mcp server" with the user's query for relevance.
 */
export async function searchNpm(query: string, limit: number = 20): Promise<NpmPackageResult[]> {
  const searchText = `mcp server ${query}`;
  const url = `${NPM_SEARCH_URL}?text=${encodeURIComponent(searchText)}&size=${limit}`;

  const raw = await httpGet(url);
  const data = JSON.parse(raw);

  if (!data.objects || !Array.isArray(data.objects)) {
    return [];
  }

  return data.objects
    .map((obj: any) => ({
      name: obj.package?.name ?? '',
      description: obj.package?.description ?? '',
      version: obj.package?.version ?? '0.0.0',
      keywords: obj.package?.keywords ?? [],
      weeklyDownloads: obj.downloads?.weekly ?? 0,
    }))
    .filter((pkg: NpmPackageResult) => isMcpServer(pkg));
}

/**
 * Fetch the full catalog of MCP server packages from npm.
 * Used by `orchid mcp update` to populate the local cache.
 */
export async function fetchCatalog(maxPages: number = 5): Promise<NpmPackageResult[]> {
  const allPackages: NpmPackageResult[] = [];
  const pageSize = 50;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const url = `${NPM_SEARCH_URL}?text=mcp+server&size=${pageSize}&from=${offset}`;

    try {
      const raw = await httpGet(url);
      const data = JSON.parse(raw);

      if (!data.objects || data.objects.length === 0) break;

      for (const obj of data.objects) {
        const pkg: NpmPackageResult = {
          name: obj.package?.name ?? '',
          description: obj.package?.description ?? '',
          version: obj.package?.version ?? '0.0.0',
          keywords: obj.package?.keywords ?? [],
          weeklyDownloads: obj.downloads?.weekly ?? 0,
        };
        if (isMcpServer(pkg)) {
          allPackages.push(pkg);
        }
      }
    } catch {
      break; // Network error — return what we have
    }
  }

  return allPackages;
}

/**
 * Save the catalog to the local cache file.
 */
export function saveCache(packages: NpmPackageResult[], cacheDir: string = getCacheDir()): void {
  const cacheFile = path.join(cacheDir, CACHE_FILENAME);
  const data: CacheData = {
    updatedAt: new Date().toISOString(),
    packages,
  };

  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Load the local cache if it exists and is fresh enough.
 */
export function loadCache(cacheDir: string = getCacheDir()): NpmPackageResult[] | null {
  const cacheFile = path.join(cacheDir, CACHE_FILENAME);

  if (!fs.existsSync(cacheFile)) return null;

  try {
    const raw = fs.readFileSync(cacheFile, 'utf-8');
    const data: CacheData = JSON.parse(raw);

    const age = Date.now() - new Date(data.updatedAt).getTime();
    if (age > CACHE_MAX_AGE_MS) return null; // Stale

    return data.packages;
  } catch {
    return null;
  }
}

/**
 * Search cached packages by name, description, or keywords.
 */
export function searchCache(query: string, packages: NpmPackageResult[]): NpmPackageResult[] {
  const q = query.toLowerCase();
  return packages.filter(pkg =>
    pkg.name.toLowerCase().includes(q) ||
    pkg.description.toLowerCase().includes(q) ||
    pkg.keywords.some(k => k.toLowerCase().includes(q)),
  );
}

/**
 * Derive a short server name from an npm package name.
 * e.g. "@modelcontextprotocol/server-filesystem" → "filesystem"
 *      "my-mcp-server" → "my-mcp-server"
 */
export function deriveServerName(packageName: string): string {
  return packageName
    .replace(/^@[^/]+\//, '')        // strip scope
    .replace(/^server-/, '')          // strip server- prefix
    .replace(/^mcp-server-/, '')      // strip mcp-server- prefix
    .replace(/-mcp-server$/, '')      // strip -mcp-server suffix
    .replace(/-mcp$/, '');            // strip -mcp suffix
}

// ─── Internal ─────────────────────────────────────────

function getCacheDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return path.join(home, '.orchid');
}

/**
 * Heuristic: is this npm package likely an MCP server?
 */
function isMcpServer(pkg: NpmPackageResult): boolean {
  const name = pkg.name.toLowerCase();
  const desc = (pkg.description || '').toLowerCase();
  const keywords = pkg.keywords.map(k => k.toLowerCase());

  // Positive signals
  if (name.includes('mcp') && (name.includes('server') || desc.includes('mcp server'))) return true;
  if (keywords.includes('mcp') && keywords.includes('server')) return true;
  if (name.startsWith('@modelcontextprotocol/server-')) return true;
  if (desc.includes('model context protocol') && desc.includes('server')) return true;
  if (desc.includes('mcp server')) return true;

  return false;
}

/**
 * Simple HTTPS GET that returns body as a string.
 */
function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}
