export { Lexer } from './lexer/lexer';
export { Token, TokenType } from './lexer/tokens';
export { Parser } from './parser/parser';
export * as AST from './parser/ast';
export { Interpreter, InterpreterOptions, OrchidError } from './runtime/interpreter';
export { Environment } from './runtime/environment';
export {
  OrchidValue,
  OrchidString,
  OrchidNumber,
  OrchidBoolean,
  OrchidNull,
  OrchidList,
  OrchidDict,
  orchidString,
  orchidNumber,
  orchidBoolean,
  orchidNull,
  orchidList,
  orchidDict,
  isTruthy,
  valueToString,
  valuesEqual,
} from './runtime/values';
export { OrchidProvider, ConsoleProvider, TagInfo } from './runtime/provider';
export { ClaudeProvider, ClaudeProviderOptions } from './runtime/claude-provider';
export { SandboxProvider, SandboxLimits, SandboxUsage, SandboxError } from './runtime/sandbox-provider';
export { MCPManager, MCPServerConfig, OrchidConfig, MCPToolInfo, MCPError } from './runtime/mcp-manager';
export { loadConfig, loadConfigForScript } from './runtime/config';
export { BUILTIN_MACROS, META_OPERATIONS, describeBuiltin } from './runtime/builtins';
export { MCP_REGISTRY, lookupServer, searchRegistry, listRegistry, RegistryEntry } from './runtime/mcp-registry';
export { installServer, installFromScript, parseRequiredServers, InstallResult } from './runtime/mcp-install';
export { searchNpm, fetchCatalog, saveCache, loadCache, searchCache, deriveServerName, NpmPackageResult } from './runtime/mcp-remote-registry';
export { OrchidPlugin, PluginOperation, PluginContext } from './runtime/plugin';

import { Lexer } from './lexer/lexer';
import { Parser } from './parser/parser';
import { Interpreter } from './runtime/interpreter';
import { OrchidProvider, ConsoleProvider } from './runtime/provider';
import { OrchidValue } from './runtime/values';

/**
 * Parse an Orchid source string into an AST.
 */
export function parse(source: string) {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser();
  return parser.parse(tokens);
}

/**
 * Execute an Orchid source string with an optional provider.
 */
export async function execute(
  source: string,
  provider?: OrchidProvider,
  options?: { trace?: boolean; scriptDir?: string },
): Promise<OrchidValue> {
  const ast = parse(source);
  const interpreter = new Interpreter({
    provider: provider || new ConsoleProvider(),
    trace: options?.trace,
    scriptDir: options?.scriptDir,
  });
  return interpreter.run(ast);
}
