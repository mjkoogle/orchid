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

const USAGE = `
orchid - The Orchid Language Runtime v0.1.0

Usage:
  orchid <file.orch>          Run an Orchid script
  orchid --parse <file.orch>  Parse and print AST
  orchid --lex <file.orch>    Tokenize and print tokens
  orchid --help               Show this help message

Provider Options:
  --provider console          Use console provider (default, no API calls)
  --provider claude           Use Claude API provider (requires ANTHROPIC_API_KEY)
  --model <model-id>          Claude model to use (default: claude-sonnet-4-5-20250929)
  --sandbox                   Enable sandbox mode (rate limiting + prompt sanitization)
  --max-requests <n>          Max API requests in sandbox mode (default: 50)

Other Options:
  --trace    Enable execution tracing
  --parse    Parse only (print AST as JSON)
  --lex      Tokenize only (print token stream)
  --config <path>             Path to orchid.config.json (auto-detected by default)

MCP Configuration:
  Create an orchid.config.json in your project directory to configure MCP servers.
  See orchid.config.example.json for the format.

Examples:
  orchid examples/hello_world.orch
  orchid --provider claude examples/deep_research.orch
  orchid --provider claude --sandbox examples/hello_world.orch
  orchid --trace examples/financial_analysis.orch
  orchid --parse examples/deep_research.orch

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const flags = new Set(args.filter(a => a.startsWith('--')));
  // Files are args that don't start with -- and aren't values for flags
  const flagsWithValues = new Set(['--provider', '--model', '--max-requests', '--config']);
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

  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser();
    const ast = parser.parse(tokens);
    const provider = createProvider(args);
    const traceEnabled = flags.has('--trace');

    // Load MCP configuration
    const config = loadConfigForScript(filePath);
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      mcpManager = new MCPManager(config, { trace: traceEnabled });
      if (traceEnabled) {
        const serverNames = Object.keys(config.mcpServers).join(', ');
        console.log(`  [mcp] Config loaded: ${serverNames}`);
      }
    }

    const interpreter = new Interpreter({
      provider,
      trace: traceEnabled,
      mcpManager,
      scriptDir: path.dirname(filePath),
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
    // Always clean up MCP connections
    if (mcpManager) {
      await mcpManager.disconnectAll();
    }
  }
}

main();
