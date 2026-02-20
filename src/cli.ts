#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from './lexer/lexer';
import { Parser } from './parser/parser';
import { Interpreter } from './runtime/interpreter';
import { ConsoleProvider, OrchidProvider } from './runtime/provider';
import { ClaudeProvider } from './runtime/claude-provider';
import { SandboxProvider } from './runtime/sandbox-provider';
import { MCPManager } from './runtime/mcp-manager';
import { loadConfigForScript } from './runtime/config';
import { valueToString, OrchidValue } from './runtime/values';
import {
  installServer,
  installFromScript,
  parseRequiredServers,
} from './runtime/mcp-install';
import { listRegistry, searchRegistry } from './runtime/mcp-registry';
import {
  searchNpm,
  fetchCatalog,
  saveCache,
  loadCache,
  searchCache,
  deriveServerName,
  NpmPackageResult,
} from './runtime/mcp-remote-registry';
import {
  TerminalStatusReporter,
  SilentStatusReporter,
  StatusReporter,
} from './runtime/status';

const USAGE = `
orchid - The Orchid Language Runtime v0.1.0

Usage:
  orchid <file.orch>          Run an Orchid script
  orchid --parse <file.orch>  Parse and print AST
  orchid --lex <file.orch>    Tokenize and print tokens
  orchid mcp install <name>   Install an MCP server into orchid.config.json
  orchid mcp install <file>   Install all MCP servers required by a script
  orchid mcp list             List built-in MCP servers
  orchid mcp search <query>   Search built-in registry + npm for MCP servers
  orchid mcp update           Fetch latest MCP server catalog from npm
  orchid --help               Show this help message

Provider Options:
  --provider console          Use console provider (default, no API calls)
  --provider claude           Use Claude API provider (requires ANTHROPIC_API_KEY)
  --model <model-id>          Claude model to use (default: claude-sonnet-4-5-20250929)
  --max-tokens <n>            Max tokens per LLM response (default: 16384)
  --sandbox                   Enable sandbox mode (rate limiting + prompt sanitization)
  --max-requests <n>          Max API requests in sandbox mode (default: 50)

Other Options:
  --trace    Enable execution tracing
  --quiet    Suppress status spinner (for piping / CI)
  --parse    Parse only (print AST as JSON)
  --lex      Tokenize only (print token stream)
  --config <path>             Path to orchid.config.json (auto-detected by default)

MCP Configuration:
  Create an orchid.config.json in your project directory to configure MCP servers.
  See orchid.config.example.json for the format.

  Quick setup:
    orchid mcp install filesystem    Install a known server
    orchid mcp install script.orch   Install all servers a script needs
    orchid mcp list                  See all available servers

Examples:
  orchid examples/hello_world.orch
  orchid --provider claude examples/deep_research.orch
  orchid --provider claude --sandbox examples/hello_world.orch
  orchid --trace examples/financial_analysis.orch
  orchid --parse examples/deep_research.orch
  orchid mcp install filesystem brave-search
  orchid mcp install examples/financial_analysis.orch

Environment Variables:
  ANTHROPIC_API_KEY    API key for Claude provider
  ORCHID_MODEL         Default model (overridden by --model)
  ORCHID_SANDBOX       Set to "1" to enable sandbox mode by default
`;

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function createProvider(args: string[]): OrchidProvider {
  const providerName = getArg(args, '--provider') || 'console';
  const model = getArg(args, '--model') || process.env.ORCHID_MODEL;
  const maxTokens = getArg(args, '--max-tokens');
  const sandboxMode = args.includes('--sandbox') || process.env.ORCHID_SANDBOX === '1';
  const maxRequests = getArg(args, '--max-requests');

  let provider: OrchidProvider;

  switch (providerName) {
    case 'claude': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.error('Error: ANTHROPIC_API_KEY environment variable is required for Claude provider.');
        console.error('Set it with: export ANTHROPIC_API_KEY=your-key-here');
        process.exit(1);
      }
      provider = new ClaudeProvider({
        apiKey,
        model,
        maxTokens: maxTokens ? parseInt(maxTokens) : undefined,
      });
      break;
    }
    case 'console':
      provider = new ConsoleProvider();
      break;
    default:
      console.error(`Error: Unknown provider "${providerName}". Use "console" or "claude".`);
      process.exit(1);
  }

  if (sandboxMode) {
    provider = new SandboxProvider(provider, {
      maxRequestsPerSession: maxRequests ? parseInt(maxRequests) : undefined,
    });
    console.log('[sandbox] Sandbox mode enabled — rate limiting and prompt sanitization active.');
  }

  return provider;
}

async function handleMcpCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help') {
    console.log(`
orchid mcp — Manage MCP servers

Commands:
  orchid mcp install <name...>   Install MCP servers by name
  orchid mcp install <file.orch> Install all servers required by a script
  orchid mcp list                List built-in servers
  orchid mcp search <query>      Search built-in + npm for MCP servers
  orchid mcp update              Fetch latest MCP server catalog from npm

Examples:
  orchid mcp install filesystem
  orchid mcp install filesystem brave-search memory
  orchid mcp install examples/financial_analysis.orch
  orchid mcp search database
  orchid mcp search puppeteer
  orchid mcp update
`);
    return;
  }

  if (subcommand === 'list') {
    const entries = listRegistry();
    console.log(`\nBuilt-in MCP servers (${entries.length}):\n`);
    const nameWidth = Math.max(...entries.map(e => e.name.length));
    for (const { name, entry } of entries) {
      console.log(`  ${name.padEnd(nameWidth + 2)} ${entry.description}`);
    }

    // Show cached npm count if available
    const cached = loadCache();
    if (cached) {
      console.log(`\n  + ${cached.length} more from npm (run "orchid mcp search <query>" to find them)`);
    } else {
      console.log(`\nRun "orchid mcp update" to fetch the full catalog from npm.`);
    }
    console.log(`Install with: orchid mcp install <name>`);
    return;
  }

  if (subcommand === 'update') {
    console.log('Fetching MCP server catalog from npm...');
    try {
      const packages = await fetchCatalog();
      saveCache(packages);
      console.log(`Updated: ${packages.length} MCP server packages indexed.`);
      console.log(`Run "orchid mcp search <query>" to find servers.`);
    } catch (error) {
      console.error(`Failed to fetch catalog: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    return;
  }

  if (subcommand === 'search') {
    const query = args.slice(1).join(' ');
    if (!query) {
      console.error('Usage: orchid mcp search <query>');
      process.exit(1);
    }

    // 1. Search built-in registry first
    const builtinResults = searchRegistry(query);

    // 2. Search npm (live query + local cache)
    let npmResults: NpmPackageResult[] = [];
    const builtinNames = new Set(builtinResults.map(r => r.entry.package));
    try {
      npmResults = await searchNpm(query);
      // Deduplicate: remove npm results that are already in built-in
      npmResults = npmResults.filter(pkg => !builtinNames.has(pkg.name));
    } catch {
      // Live search failed — try local cache
      const cached = loadCache();
      if (cached) {
        npmResults = searchCache(query, cached)
          .filter(pkg => !builtinNames.has(pkg.name));
      }
    }

    if (builtinResults.length === 0 && npmResults.length === 0) {
      console.log(`No MCP servers found matching "${query}".`);
      console.log(`Try "orchid mcp update" to refresh the catalog, or "orchid mcp list" to see built-in servers.`);
      return;
    }

    // Print built-in results
    if (builtinResults.length > 0) {
      console.log(`\nBuilt-in servers matching "${query}":\n`);
      const nameWidth = Math.max(...builtinResults.map(r => r.name.length));
      for (const { name, entry } of builtinResults) {
        console.log(`  ${name.padEnd(nameWidth + 2)} ${entry.description}`);
      }
    }

    // Print npm results
    if (npmResults.length > 0) {
      console.log(`\nnpm packages matching "${query}":\n`);
      const nameWidth = Math.max(...npmResults.map(r => r.name.length), 20);
      for (const pkg of npmResults) {
        const desc = pkg.description.length > 60
          ? pkg.description.slice(0, 57) + '...'
          : pkg.description;
        console.log(`  ${pkg.name.padEnd(nameWidth + 2)} ${desc}`);
      }
    }

    console.log(`\nInstall with: orchid mcp install <name>`);
    return;
  }

  if (subcommand === 'install') {
    const targets = args.slice(1);
    if (targets.length === 0) {
      console.error('Usage: orchid mcp install <name...> or orchid mcp install <file.orch>');
      process.exit(1);
    }

    // If the first target is a .orch file, install from script
    if (targets.length === 1 && targets[0].endsWith('.orch')) {
      const results = installFromScript(targets[0]);
      for (const result of results) {
        printInstallResult(result);
      }
      return;
    }

    // Otherwise install each named server
    for (const name of targets) {
      const result = installServer(name);
      printInstallResult(result);
    }
    return;
  }

  console.error(`Unknown mcp command: "${subcommand}". Run "orchid mcp help" for usage.`);
  process.exit(1);
}

function printInstallResult(result: { name: string; status: string; message: string }): void {
  const icon =
    result.status === 'installed' ? '+' :
    result.status === 'already_configured' ? '=' :
    result.status === 'not_found' ? '?' :
    '!';
  console.log(`  [${icon}] ${result.message}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  // ─── MCP Subcommands ──────────────────────────────────
  if (args[0] === 'mcp') {
    await handleMcpCommand(args.slice(1));
    return;
  }

  const flags = new Set(args.filter(a => a.startsWith('--')));
  // Files are args that don't start with -- and aren't values for flags
  const flagsWithValues = new Set(['--provider', '--model', '--max-tokens', '--max-requests', '--config']);
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (flagsWithValues.has(args[i])) i++; // Skip next arg (the value)
      continue;
    }
    files.push(args[i]);
  }

  if (files.length === 0) {
    console.error('Error: No input file specified.');
    console.log(USAGE);
    process.exit(1);
  }

  const filePath = path.resolve(files[0]);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, 'utf-8');

  // Lex-only mode
  if (flags.has('--lex')) {
    try {
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();
      for (const tok of tokens) {
        const val = tok.value ? ` ${JSON.stringify(tok.value)}` : '';
        console.log(`${tok.line}:${tok.column}\t${tok.type}${val}`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
    return;
  }

  // Parse-only mode
  if (flags.has('--parse')) {
    try {
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();
      const parser = new Parser();
      const ast = parser.parse(tokens);
      console.log(JSON.stringify(ast, null, 2));
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
    return;
  }

  // Full execution
  let mcpManager: MCPManager | undefined;
  let interpreter: Interpreter | undefined;

  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser();
    const ast = parser.parse(tokens);
    const provider = createProvider(args);
    const traceEnabled = flags.has('--trace');
    const quiet = flags.has('--quiet');

    // Create status reporter for live terminal feedback
    const status: StatusReporter = quiet
      ? new SilentStatusReporter()
      : new TerminalStatusReporter();

    // Load MCP configuration
    const config = loadConfigForScript(filePath);
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      mcpManager = new MCPManager(config, { trace: traceEnabled });
      if (traceEnabled) {
        const serverNames = Object.keys(config.mcpServers).join(', ');
        console.log(`  [mcp] Config loaded: ${serverNames}`);
      }
    }

    interpreter = new Interpreter({
      provider,
      trace: traceEnabled,
      mcpManager,
      scriptDir: path.dirname(filePath),
      status,
    });

    const result = await interpreter.run(ast);
    if (result.kind !== 'null') {
      console.log(`\n=> ${valueToString(result)}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    if (flags.has('--trace') && e.stack) {
      console.error(e.stack);
    }
    process.exit(1);
  } finally {
    // Shut down interpreter (calls plugin teardown hooks)
    if (interpreter) {
      await interpreter.shutdown();
    }
    // Always clean up MCP connections
    if (mcpManager) {
      await mcpManager.disconnectAll();
    }
  }
}

main();
