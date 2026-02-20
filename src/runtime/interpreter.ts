import * as fs from 'fs';
import * as path from 'path';
import * as AST from '../parser/ast';
import { Lexer } from '../lexer/lexer';
import { Parser } from '../parser/parser';
import { Environment } from './environment';
import {
  OrchidValue,
  orchidString,
  orchidNumber,
  orchidBoolean,
  orchidNull,
  orchidList,
  orchidDict,
  isTruthy,
  valueToString,
  valuesEqual,
} from './values';
import { OrchidProvider, TagInfo } from './provider';
import { BUILTIN_MACROS, META_OPERATIONS } from './builtins';
import { MCPManager } from './mcp-manager';
import { OrchidPlugin, PluginContext } from './plugin';

/** Sentinel thrown to implement return statements. */
class ReturnSignal {
  constructor(public value: OrchidValue) {}
}

/** Sentinel thrown to implement break statements. */
class BreakSignal {}

/** Orchid runtime error types from the spec. */
export class OrchidError extends Error {
  constructor(
    public errorType: string,
    message: string,
    public position?: AST.Position,
  ) {
    super(`${errorType}: ${message}`);
    this.name = 'OrchidError';
  }
}

export interface InterpreterOptions {
  provider: OrchidProvider;
  trace?: boolean;
  /** Optional MCP manager for real tool connections. */
  mcpManager?: MCPManager;
  /** Directory for resolving relative import paths. Defaults to cwd. */
  scriptDir?: string;
}

/**
 * A loaded Plugin module. Two variants:
 * - 'js': A JS/TS module implementing OrchidPlugin (skill-like capability extensions)
 * - 'orch': An .orch file with exported agents/macros (convenience for simple plugins)
 */
type PluginModule =
  | { kind: 'js'; plugin: OrchidPlugin }
  | { kind: 'orch'; interpreter: Interpreter; macros: Map<string, AST.MacroDef>; agents: Map<string, AST.AgentDef>; env: Environment };

export class Interpreter {
  private provider: OrchidProvider;
  private mcpManager?: MCPManager;
  private globalEnv: Environment;
  private implicitContext: OrchidValue = orchidNull();
  private checkpoints: Map<string, { env: Map<string, OrchidValue>; context: OrchidValue }> = new Map();
  private eventHandlers: Map<string, { variable: string; body: AST.Node[]; env: Environment }[]> = new Map();
  private eventBuffer: Map<string, OrchidValue[]> = new Map();
  private listenResolvers: ((event: OrchidValue) => void)[] = [];
  private namespaces: Map<string, string> = new Map(); // alias -> name
  private startTime = Date.now();
  private traceEnabled: boolean;
  private traceLog: string[] = [];
  private macros: Map<string, AST.MacroDef> = new Map();
  private agents: Map<string, AST.AgentDef> = new Map();
  private scriptDir: string;
  private importCache: Map<string, Environment> = new Map();
  private importStack: Set<string> = new Set(); // tracks in-progress imports for cycle detection
  private plugins: Map<string, PluginModule> = new Map(); // alias -> loaded plugin

  constructor(options: InterpreterOptions) {
    this.provider = options.provider;
    this.mcpManager = options.mcpManager;
    this.globalEnv = new Environment();
    this.traceEnabled = options.trace ?? false;
    this.scriptDir = options.scriptDir ?? process.cwd();
  }

  async run(program: AST.Program): Promise<OrchidValue> {
    this.startTime = Date.now();

    // Process metadata
    for (const meta of program.metadata) {
      await this.processMetadata(meta);
    }

    // Execute body
    let result: OrchidValue = orchidNull();
    for (const stmt of program.body) {
      result = await this.execute(stmt, this.globalEnv);
    }

    return result;
  }

  /**
   * Shut down the interpreter and clean up all resources.
   *
   * Calls teardown() on all loaded JS plugins, giving them a chance to
   * close connections, flush buffers, and release resources. This should
   * be called when the interpreter is no longer needed (e.g., after script
   * execution completes or on process exit).
   */
  async shutdown(): Promise<void> {
    const errors: Error[] = [];

    for (const [alias, plugin] of this.plugins) {
      if (plugin.kind === 'js' && plugin.plugin.teardown) {
        try {
          await plugin.plugin.teardown();
          if (this.traceEnabled) {
            this.trace(`Plugin "${alias}" teardown complete.`);
          }
        } catch (e: any) {
          errors.push(new Error(`Plugin "${alias}" teardown failed: ${e.message}`));
          if (this.traceEnabled) {
            this.trace(`Plugin "${alias}" teardown failed: ${e.message}`);
          }
        }
      }
    }

    // Clear plugin references
    this.plugins.clear();

    // If any teardowns failed, log but don't throw — cleanup should be best-effort
    if (errors.length > 0 && this.traceEnabled) {
      this.trace(`${errors.length} plugin teardown(s) failed during shutdown.`);
    }
  }

  private async processMetadata(meta: AST.Metadata): Promise<void> {
    switch (meta.directive) {
      case 'orchid':
        // Version check — just log for now
        if (this.traceEnabled) {
          this.trace(`Orchid spec version: ${this.nodeToInputString(meta.value)}`);
        }
        break;
      case 'name':
        if (this.traceEnabled) {
          this.trace(`Script: ${this.nodeToInputString(meta.value)}`);
        }
        break;
      case 'requires':
        await this.validateRequires(meta);
        break;
      default:
        // Store as metadata
        break;
    }
  }

  /**
   * Validate @requires metadata directives.
   *
   * @requires MCP("filesystem") checks that the MCP server is configured.
   * @requires Plugin("sentiment") checks that the plugin file is available.
   * @requires MCP("a"), Plugin("b") validates a list of requirements.
   */
  private async validateRequires(meta: AST.Metadata): Promise<void> {
    const nodes = meta.value.type === 'ListLiteral' ? meta.value.elements : [meta.value];

    for (const node of nodes) {
      if (node.type !== 'Operation') continue;

      if (node.name === 'MCP') {
        const serverName = node.args.length > 0 ? this.nodeToInputString(node.args[0].value) : '';
        const available = this.mcpManager
          ? (this.mcpManager.isConfigured(serverName) || this.mcpManager.hasServer(serverName))
          : false;
        if (!available) {
          throw new OrchidError(
            'ToolNotFound',
            `Script requires MCP server "${serverName}" but it is not configured. ` +
            `Run: orchid mcp install ${serverName}`,
            meta.position,
          );
        }
        if (this.traceEnabled) {
          this.trace(`@requires MCP("${serverName}") — OK (configured)`);
        }
      }

      if (node.name === 'Plugin') {
        const pluginName = node.args.length > 0 ? this.nodeToInputString(node.args[0].value) : '';
        const rawName = pluginName.replace(/@[^@]+$/, '');
        const available = this.plugins.has(rawName) || this.resolvePluginPath(rawName) !== null;
        if (!available) {
          throw new OrchidError(
            'ToolNotFound',
            `Script requires plugin "${pluginName}" but it is not available.`,
            meta.position,
          );
        }
        if (this.traceEnabled) {
          this.trace(`@requires Plugin("${pluginName}") — OK (available)`);
        }
      }
    }
  }

  // ─── Statement Execution ───────────────────────────────

  async execute(node: AST.Node, env: Environment): Promise<OrchidValue> {
    switch (node.type) {
      case 'Assignment':
        return this.executeAssignment(node, env);
      case 'PlusAssignment':
        return this.executePlusAssignment(node, env);
      case 'Operation':
        return this.executeOperation(node, env);
      case 'NamespacedOperation':
        return this.executeNamespacedOperation(node, env);
      case 'IfStatement':
        return this.executeIf(node, env);
      case 'ForStatement':
        return this.executeFor(node, env);
      case 'WhileStatement':
        return this.executeWhile(node, env);
      case 'UntilStatement':
        return this.executeUntil(node, env);
      case 'TryStatement':
        return this.executeTry(node, env);
      case 'AssertStatement':
        return this.executeAssert(node, env);
      case 'RequireStatement':
        return this.executeRequire(node, env);
      case 'AtomicBlock':
        return this.executeAtomicBlock(node, env);
      case 'ForkExpression':
        return this.executeFork(node, env);
      case 'AgentDef':
        return this.executeAgentDef(node, env);
      case 'MacroDef':
        return this.executeMacroDef(node, env);
      case 'ReturnStatement':
        return this.executeReturn(node, env);
      case 'BreakStatement':
        throw new BreakSignal();
      case 'EmitStatement':
        return this.executeEmit(node, env);
      case 'OnStatement':
        return this.executeOn(node, env);
      case 'UseStatement':
        return this.executeUse(node);
      case 'ImportStatement':
        return this.executeImport(node);
      case 'PermissionsBlock':
        return orchidNull(); // Permissions are declarative, not executed
      case 'SectionComment':
        if (this.traceEnabled) {
          this.trace(`## ${node.text}`);
        }
        return orchidNull();

      // Expressions
      case 'PipeExpression':
        return this.executePipeExpr(node, env);
      case 'MergeExpression':
        return this.executeMerge(node, env);
      case 'AlternativeExpression':
        return this.executeAlternative(node, env);
      case 'ComparisonExpression':
        return this.executeComparison(node, env);
      case 'LogicalExpression':
        return this.executeLogical(node, env);
      case 'UnaryExpression':
        return this.executeUnary(node, env);
      case 'ArithmeticExpression':
        return this.executeArithmetic(node, env);
      case 'InExpression':
        return this.executeInExpr(node, env);
      case 'MemberExpression':
        return this.executeMemberExpr(node, env);

      // Literals
      case 'StringLiteral':
        return orchidString(node.value);
      case 'InterpolatedString':
        return this.executeInterpolatedString(node, env);
      case 'NumberLiteral':
        return orchidNumber(node.value, node.suffix);
      case 'BooleanLiteral':
        return orchidBoolean(node.value);
      case 'NullLiteral':
        return orchidNull();
      case 'ListLiteral':
        return this.executeListLiteral(node, env);
      case 'DictLiteral':
        return this.executeDictLiteral(node, env);
      case 'Identifier':
        return env.get(node.name);
      case 'ImplicitContext':
        return this.implicitContext;
      case 'ListenExpression':
        return this.executeListen();
      case 'StreamExpression':
        return this.executeStream(node, env);

      default:
        throw new OrchidError('RuntimeError', `Unknown node type: ${(node as any).type}`, (node as any).position);
    }
  }

  private async evaluate(node: AST.Node, env: Environment): Promise<OrchidValue> {
    return this.execute(node, env);
  }

  // ─── Assignment ────────────────────────────────────────

  private async executeAssignment(node: AST.Assignment, env: Environment): Promise<OrchidValue> {
    const value = await this.evaluate(node.value, env);

    if (Array.isArray(node.target)) {
      // Destructuring
      if (value.kind !== 'list') {
        throw new OrchidError('TypeError', 'Cannot destructure non-list value', node.position);
      }
      const targets = node.target;
      for (let i = 0; i < targets.length; i++) {
        const v = i < value.elements.length ? value.elements[i] : orchidNull();
        env.set(targets[i].name, v);
      }
    } else {
      env.set(node.target.name, value);
    }

    this.implicitContext = value;
    return value;
  }

  private async executePlusAssignment(node: AST.PlusAssignment, env: Environment): Promise<OrchidValue> {
    const existing = env.get(node.target.name);
    const addition = await this.evaluate(node.value, env);
    const result = this.mergeValues(existing, addition);
    env.assign(node.target.name, result);
    this.implicitContext = result;
    return result;
  }

  // ─── Operations ────────────────────────────────────────

  private async executeOperation(node: AST.Operation, env: Environment): Promise<OrchidValue> {
    const name = node.name;
    const tags = await this.resolveTags(node.tags, env);

    // Check for user-defined macros/agents first
    if (this.macros.has(name)) {
      return this.callMacro(this.macros.get(name)!, node.args, tags, env);
    }
    if (this.agents.has(name)) {
      return this.callAgent(this.agents.get(name)!, node.args, tags, env);
    }

    // Check for callable in environment
    const envValue = env.get(name);
    if (envValue.kind === 'callable') {
      return this.callCallable(envValue, node.args, tags, env);
    }

    // Built-in operations
    if (name === 'Search') {
      const input = await this.resolveArgs(node.args, env);
      const query = input.length > 0 ? valueToString(input[0]) : valueToString(this.implicitContext);
      const result = await this.withTimeout(
        this.provider.search(query, tags),
        tags, node.position,
      );
      this.implicitContext = result;
      return result;
    }

    if (name === 'Confidence') {
      const input = await this.resolveArgs(node.args, env);
      const scope = input.length > 0 ? valueToString(input[0]) : undefined;
      const conf = await this.provider.confidence(scope);
      return orchidNumber(conf);
    }

    if (name === 'Checkpoint') {
      const input = await this.resolveArgs(node.args, env);
      const label = input.length > 0 ? valueToString(input[0]) : 'default';
      this.checkpoints.set(label, {
        env: env.getOwnBindings(),
        context: this.implicitContext,
      });
      if (this.traceEnabled) this.trace(`Checkpoint saved: ${label}`);
      return orchidNull();
    }

    if (name === 'Rollback') {
      const input = await this.resolveArgs(node.args, env);
      const target = input.length > 0 ? valueToString(input[0]) : 'default';
      const cp = this.checkpoints.get(target);
      if (!cp) {
        throw new OrchidError('RuntimeError', `No checkpoint found: ${target}`, node.position);
      }
      for (const [k, v] of cp.env) {
        env.set(k, v);
      }
      this.implicitContext = cp.context;
      if (this.traceEnabled) this.trace(`Rolled back to: ${target}`);
      return orchidNull();
    }

    if (name === 'Trace') {
      const depth = node.args.length > 0
        ? valueToString(await this.evaluate(node.args[0].value, env))
        : 'full';
      console.log(`[Trace (${depth})]:`);
      for (const entry of this.traceLog) {
        console.log(`  ${entry}`);
      }
      return orchidString(this.traceLog.join('\n'));
    }

    if (name === 'Cost') {
      return orchidString(`[Cost: estimated tokens used in session]`);
    }

    if (name === 'Elapsed') {
      const elapsed = Date.now() - this.startTime;
      return orchidString(`${elapsed}ms`);
    }

    if (name === 'Log') {
      const input = await this.resolveArgs(node.args, env);
      const msg = input.map(valueToString).join(' ');
      console.log(`[Log] ${msg}`);
      return orchidNull();
    }

    if (name === 'Error') {
      const input = await this.resolveArgs(node.args, env);
      const msg = input.length > 0 ? valueToString(input[0]) : 'Unknown error';
      throw new OrchidError('UserError', msg, node.position);
    }

    if (name === 'Save') {
      const input = await this.resolveArgs(node.args, env);
      const content = input.length > 0 ? valueToString(input[0]) : valueToString(this.implicitContext);
      console.log(`[Save]: ${content.slice(0, 100)}...`);
      return orchidNull();
    }

    if (name === 'len') {
      const input = await this.resolveArgs(node.args, env);
      const val = input.length > 0 ? input[0] : this.implicitContext;
      if (val.kind === 'list') return orchidNumber(val.elements.length);
      if (val.kind === 'string') return orchidNumber(val.value.length);
      if (val.kind === 'dict') return orchidNumber(val.entries.size);
      return orchidNumber(0);
    }

    if (name === 'Discover') {
      const input = await this.resolveArgs(node.args, env);
      const pattern = input.length > 0 ? valueToString(input[0]) : '*';
      return this.executeDiscover(pattern);
    }

    // Generic built-in reasoning macros — delegate to provider
    if (BUILTIN_MACROS.has(name)) {
      const input = await this.resolveArgs(node.args, env);
      const inputStr = input.length > 0
        ? valueToString(input[0])
        : valueToString(this.implicitContext);

      // Build context from keyword args
      const context: Record<string, string> = {};
      for (const arg of node.args) {
        if (arg.name && arg.name !== '_count') {
          context[arg.name] = valueToString(await this.evaluate(arg.value, env));
        }
      }

      // Handle _count for Brainstorm[n], Debate[n], etc.
      const countArg = node.args.find(a => a.name === '_count');
      if (countArg) {
        const countVal = await this.evaluate(countArg.value, env);
        context['_count'] = valueToString(countVal);
      }

      const result = await this.withTimeout(
        this.provider.execute(name, inputStr, context, tags),
        tags, node.position,
      );
      this.implicitContext = result;
      return result;
    }

    // Unknown operation — try calling as a generic operation
    const input = await this.resolveArgs(node.args, env);
    const inputStr = input.length > 0
      ? valueToString(input[0])
      : valueToString(this.implicitContext);
    const result = await this.withTimeout(
      this.provider.execute(name, inputStr, {}, tags),
      tags, node.position,
    );
    this.implicitContext = result;
    return result;
  }

  private async executeNamespacedOperation(node: AST.NamespacedOperation, env: Environment): Promise<OrchidValue> {
    const tags = await this.resolveTags(node.tags, env);

    // Route to loaded Plugin if the namespace matches
    const plugin = this.plugins.get(node.namespace);
    if (plugin) {
      return this.dispatchPluginCall(plugin, node, env);
    }

    const args: Record<string, OrchidValue> = {};
    for (const arg of node.args) {
      const val = await this.evaluate(arg.value, env);
      args[arg.name || `arg${Object.keys(args).length}`] = val;
    }

    // Route to MCPManager if the namespace is a connected MCP server
    if (this.mcpManager?.hasServer(node.namespace)) {
      const result = await this.mcpManager.callTool(node.namespace, node.name, args);
      this.implicitContext = result;
      return result;
    }

    // Auto-connect to configured MCP server on first use
    if (this.mcpManager?.isConfigured(node.namespace)) {
      if (this.traceEnabled) this.trace(`Auto-connecting MCP server: ${node.namespace}`);
      await this.mcpManager.connect(node.namespace);
      const result = await this.mcpManager.callTool(node.namespace, node.name, args);
      this.implicitContext = result;
      return result;
    }

    // Fallback to provider for non-MCP namespaces
    const result = await this.provider.toolCall(node.namespace, node.name, args, tags);
    this.implicitContext = result;
    return result;
  }

  /**
   * Dispatch a namespace:Operation() call to a loaded Plugin module.
   * Routes to either a JS plugin operation or an .orch plugin agent/macro.
   */
  private async dispatchPluginCall(
    plugin: PluginModule,
    node: AST.NamespacedOperation,
    callerEnv: Environment,
  ): Promise<OrchidValue> {
    const opName = node.name;

    // ── JS/TS plugin: call the named operation function ──
    if (plugin.kind === 'js') {
      const operation = plugin.plugin.operations[opName];
      if (!operation) {
        throw new OrchidError(
          'ToolNotFound',
          `Plugin "${node.namespace}" has no operation "${opName}"`,
          node.position,
        );
      }

      // Resolve arguments into a dict for the operation
      const args: Record<string, OrchidValue> = {};
      for (const arg of node.args) {
        const val = await this.evaluate(arg.value, callerEnv);
        args[arg.name || `arg${Object.keys(args).length}`] = val;
      }

      const tags = await this.resolveTags(node.tags, callerEnv);
      const ctx = this.makePluginContext(tags);
      const result = await operation(args, ctx);
      this.implicitContext = result;
      return result;
    }

    // ── .orch plugin: dispatch to agent, macro, or callable ──
    const resolvedTags = await this.resolveTags(node.tags, callerEnv);

    if (plugin.agents.has(opName)) {
      const result = await plugin.interpreter.callAgent(
        plugin.agents.get(opName)!,
        node.args,
        resolvedTags,
        callerEnv,
      );
      this.implicitContext = result;
      return result;
    }

    if (plugin.macros.has(opName)) {
      const result = await plugin.interpreter.callMacro(
        plugin.macros.get(opName)!,
        node.args,
        resolvedTags,
        callerEnv,
      );
      this.implicitContext = result;
      return result;
    }

    const binding = plugin.env.get(opName);
    if (binding.kind === 'callable') {
      const result = await plugin.interpreter.callCallable(
        binding,
        node.args,
        resolvedTags,
        callerEnv,
      );
      this.implicitContext = result;
      return result;
    }

    throw new OrchidError(
      'ToolNotFound',
      `Plugin "${node.namespace}" has no operation "${opName}"`,
      node.position,
    );
  }

  // ─── Control Flow ──────────────────────────────────────

  private async executeIf(node: AST.IfStatement, env: Environment): Promise<OrchidValue> {
    const condition = await this.evaluate(node.condition, env);
    if (isTruthy(condition)) {
      return this.executeBlock(node.body, env);
    }

    for (const elif of node.elifs) {
      const elifCond = await this.evaluate(elif.condition, env);
      if (isTruthy(elifCond)) {
        return this.executeBlock(elif.body, env);
      }
    }

    if (node.elseBody) {
      return this.executeBlock(node.elseBody, env);
    }

    return orchidNull();
  }

  private async executeFor(node: AST.ForStatement, env: Environment): Promise<OrchidValue> {
    const iterable = await this.evaluate(node.iterable, env);
    let result: OrchidValue = orchidNull();

    if (iterable.kind !== 'list') {
      throw new OrchidError('TypeError', 'Cannot iterate over non-list value', node.position);
    }

    const loopEnv = env.child();
    for (const element of iterable.elements) {
      loopEnv.set(node.variable, element);
      try {
        result = await this.executeBlock(node.body, loopEnv);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        throw e;
      }
    }

    return result;
  }

  private async executeWhile(node: AST.WhileStatement, env: Environment): Promise<OrchidValue> {
    let result: OrchidValue = orchidNull();
    const maxIterations = 1000; // Safety limit
    let iterations = 0;

    while (iterations < maxIterations) {
      const condition = await this.evaluate(node.condition, env);
      if (!isTruthy(condition)) break;
      try {
        result = await this.executeBlock(node.body, env);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        throw e;
      }
      iterations++;
    }

    if (iterations >= maxIterations) {
      throw new OrchidError('RuntimeError', 'While loop exceeded maximum iterations (1000)', node.position);
    }

    return result;
  }

  private async executeUntil(node: AST.UntilStatement, env: Environment): Promise<OrchidValue> {
    let result: OrchidValue = orchidNull();
    const retryTag = node.tags.find(t => t.name === 'retry');
    const maxRetries = retryTag?.value
      ? (await this.evaluate(retryTag.value, env) as any).value || 10
      : 10;
    let iterations = 0;

    while (iterations < maxRetries) {
      try {
        result = await this.executeBlock(node.body, env);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        throw e;
      }
      const condition = await this.evaluate(node.condition, env);
      if (isTruthy(condition)) break;
      iterations++;
    }

    if (iterations >= maxRetries) {
      const fallbackTag = node.tags.find(t => t.name === 'fallback');
      if (fallbackTag?.value) {
        return this.evaluate(fallbackTag.value, env);
      }
      const bestEffort = node.tags.find(t => t.name === 'best_effort');
      if (bestEffort) {
        return result;
      }
      throw new OrchidError('ValidationError', `Until loop exhausted after ${maxRetries} iterations`, node.position);
    }

    return result;
  }

  private async executeTry(node: AST.TryStatement, env: Environment): Promise<OrchidValue> {
    try {
      return await this.executeBlock(node.body, env);
    } catch (e) {
      if (e instanceof ReturnSignal) throw e; // Don't catch returns

      for (const except of node.excepts) {
        if (!except.errorType || (e instanceof OrchidError && e.errorType === except.errorType) || except.errorType === undefined) {
          return this.executeBlock(except.body, env);
        }
      }

      // No matching handler, re-throw unless there's a generic except
      if (node.excepts.length > 0 && !node.excepts[node.excepts.length - 1].errorType) {
        return this.executeBlock(node.excepts[node.excepts.length - 1].body, env);
      }

      throw e;
    } finally {
      if (node.finallyBody) {
        await this.executeBlock(node.finallyBody, env);
      }
    }
  }

  private async executeAssert(node: AST.AssertStatement, env: Environment): Promise<OrchidValue> {
    const condition = await this.evaluate(node.condition, env);
    if (!isTruthy(condition)) {
      throw new OrchidError(
        'ValidationError',
        node.message || 'Assertion failed',
        node.position,
      );
    }
    return orchidNull();
  }

  private async executeRequire(node: AST.RequireStatement, env: Environment): Promise<OrchidValue> {
    // Special handling for require MCP("name") and require Plugin("name")
    if (node.condition.type === 'Operation') {
      const opName = node.condition.name;

      if (opName === 'MCP') {
        const args = await this.resolveArgs(node.condition.args, env);
        const serverName = args.length > 0 ? valueToString(args[0]) : '';
        const available = this.mcpManager
          ? (this.mcpManager.isConfigured(serverName) || this.mcpManager.hasServer(serverName))
          : false;
        if (!available) {
          throw new OrchidError(
            'ToolNotFound',
            node.message || `Required MCP server "${serverName}" is not configured`,
            node.position,
          );
        }
        return orchidNull();
      }

      if (opName === 'Plugin') {
        const args = await this.resolveArgs(node.condition.args, env);
        const pluginName = args.length > 0 ? valueToString(args[0]) : '';
        const loaded = this.plugins.has(pluginName);
        const available = loaded || this.resolvePluginPath(pluginName.replace(/@[^@]+$/, '')) !== null;
        if (!available) {
          throw new OrchidError(
            'ToolNotFound',
            node.message || `Required plugin "${pluginName}" is not available`,
            node.position,
          );
        }
        return orchidNull();
      }
    }

    // General require: evaluate condition as boolean
    const condition = await this.evaluate(node.condition, env);
    if (!isTruthy(condition)) {
      throw new OrchidError(
        'PermissionDenied',
        node.message || 'Requirement not met',
        node.position,
      );
    }
    return orchidNull();
  }

  // ─── Blocks ────────────────────────────────────────────

  private async executeAtomicBlock(node: AST.AtomicBlock, env: Environment): Promise<OrchidValue> {
    // Atomic blocks execute in an isolated child environment.
    // On success, bindings commit to parent. On failure, everything rolls back.
    const atomicEnv = env.child();
    const savedContext = this.implicitContext;

    // Snapshot event state for rollback
    const savedEventBuffer = this.snapshotEventBuffer();
    const savedCheckpoints = new Map(this.checkpoints);
    const savedEventHandlers = this.snapshotEventHandlers();
    const savedListenResolvers = [...this.listenResolvers];

    try {
      let result: OrchidValue = orchidNull();
      for (const stmt of node.body) {
        result = await this.execute(stmt, atomicEnv);
      }
      // Commit all bindings to parent scope
      atomicEnv.commitToParent();
      return result;
    } catch (e) {
      if (e instanceof ReturnSignal) {
        // Returns propagate even from atomic blocks, but bindings still commit
        atomicEnv.commitToParent();
        throw e;
      }
      // Full rollback: restore all interpreter state
      this.implicitContext = savedContext;
      this.eventBuffer = savedEventBuffer;
      this.checkpoints = savedCheckpoints;
      this.eventHandlers = savedEventHandlers;
      this.listenResolvers = savedListenResolvers;

      if (this.traceEnabled) {
        this.trace(`Atomic block rolled back: ${e instanceof Error ? e.message : String(e)}`);
      }

      throw e;
    }
  }

  /** Deep-copy the event buffer for atomic block rollback. */
  private snapshotEventBuffer(): Map<string, OrchidValue[]> {
    const snapshot = new Map<string, OrchidValue[]>();
    for (const [key, values] of this.eventBuffer) {
      snapshot.set(key, [...values]);
    }
    return snapshot;
  }

  /** Deep-copy the event handlers map for atomic block rollback. */
  private snapshotEventHandlers(): Map<string, { variable: string; body: AST.Node[]; env: Environment }[]> {
    const snapshot = new Map<string, { variable: string; body: AST.Node[]; env: Environment }[]>();
    for (const [key, handlers] of this.eventHandlers) {
      snapshot.set(key, [...handlers]);
    }
    return snapshot;
  }

  private async executeFork(node: AST.ForkExpression, env: Environment): Promise<OrchidValue> {
    // Snapshot the parent implicit context so each branch starts with the
    // same state and doesn't observe another branch's intermediate results.
    const parentContext = this.implicitContext;

    // Fork for-loop
    if (node.forLoop) {
      const iterable = await this.evaluate(node.forLoop.iterable, env);
      if (iterable.kind !== 'list') {
        throw new OrchidError('TypeError', 'Cannot iterate over non-list in fork', node.position);
      }
      const results = await Promise.all(
        iterable.elements.map(async (element) => {
          const forkEnv = env.child();
          forkEnv.set(node.forLoop!.variable, element);
          return this.executeForkBranch(node.forLoop!.body, forkEnv, parentContext);
        })
      );
      const result = orchidList(results);
      this.implicitContext = result;
      return result;
    }

    // Named or unnamed branches
    const isNamed = node.branches.some(b => b.name);

    if (isNamed) {
      // Named fork → returns dict
      const entries = new Map<string, OrchidValue>();
      const results = await Promise.all(
        node.branches.map(async (branch) => {
          const forkEnv = env.child();
          const value = await this.executeForkBranch(branch.body, forkEnv, parentContext);
          return { name: branch.name!, value };
        })
      );
      for (const r of results) {
        entries.set(r.name, r.value);
      }
      const result = orchidDict(entries);
      this.implicitContext = result;
      return result;
    }

    // Unnamed fork → returns list
    const results = await Promise.all(
      node.branches.map(async (branch) => {
        const forkEnv = env.child();
        return this.executeForkBranch(branch.body, forkEnv, parentContext);
      })
    );
    const result = orchidList(results);
    this.implicitContext = result;
    return result;
  }

  /**
   * Execute a single fork branch with an isolated implicit context.
   *
   * Each branch starts with a snapshot of the parent's implicit context
   * and restores its own local context before each statement. This prevents
   * branches from observing each other's intermediate state when they
   * interleave at async yield points under Promise.all.
   */
  private async executeForkBranch(
    body: AST.Node[],
    env: Environment,
    parentContext: OrchidValue,
  ): Promise<OrchidValue> {
    let localContext = parentContext;
    let result: OrchidValue = orchidNull();

    for (const stmt of body) {
      // Restore this branch's local context before each statement,
      // in case another branch modified this.implicitContext.
      this.implicitContext = localContext;
      result = await this.execute(stmt, env);
      // Capture the context after the statement completes.
      localContext = this.implicitContext;
    }

    return result;
  }

  // ─── Definitions ───────────────────────────────────────

  private async executeAgentDef(node: AST.AgentDef, env: Environment): Promise<OrchidValue> {
    this.agents.set(node.name, node);
    const callable: OrchidValue = {
      kind: 'callable',
      name: node.name,
      params: node.params.map(p => ({
        name: p.name,
        defaultValue: undefined, // Resolved at call time
      })),
      body: node.body,
      tags: [],
      closure: env,
      isAgent: true,
    };
    env.set(node.name, callable);
    return orchidNull();
  }

  private async executeMacroDef(node: AST.MacroDef, env: Environment): Promise<OrchidValue> {
    this.macros.set(node.name, node);
    const callable: OrchidValue = {
      kind: 'callable',
      name: node.name,
      params: node.params.map(p => ({
        name: p.name,
        defaultValue: undefined,
      })),
      body: node.body,
      tags: node.tags.map(t => ({ name: t.name, value: undefined })),
      closure: env,
      isAgent: false,
    };
    env.set(node.name, callable);
    return orchidNull();
  }

  private async callMacro(
    def: AST.MacroDef,
    callArgs: AST.Argument[],
    callTags: TagInfo[],
    callerEnv: Environment,
  ): Promise<OrchidValue> {
    const macroEnv = new Environment(callerEnv);

    // Bind parameters
    const resolvedArgs = await this.resolveArgs(callArgs, callerEnv);
    const namedArgs = await this.resolveNamedArgs(callArgs, callerEnv);

    for (let i = 0; i < def.params.length; i++) {
      const param = def.params[i];
      if (namedArgs.has(param.name)) {
        macroEnv.set(param.name, namedArgs.get(param.name)!);
      } else if (i < resolvedArgs.length) {
        macroEnv.set(param.name, resolvedArgs[i]);
      } else if (param.defaultValue) {
        macroEnv.set(param.name, await this.evaluate(param.defaultValue, callerEnv));
      } else {
        macroEnv.set(param.name, orchidNull());
      }
    }

    try {
      let result: OrchidValue = orchidNull();
      for (const stmt of def.body) {
        result = await this.execute(stmt, macroEnv);
      }
      this.implicitContext = result;
      return result;
    } catch (e) {
      if (e instanceof ReturnSignal) {
        this.implicitContext = e.value;
        return e.value;
      }
      throw e;
    }
  }

  private async callAgent(
    def: AST.AgentDef,
    callArgs: AST.Argument[],
    callTags: TagInfo[],
    callerEnv: Environment,
  ): Promise<OrchidValue> {
    const agentEnv = new Environment(callerEnv);

    // Bind parameters
    const resolvedArgs = await this.resolveArgs(callArgs, callerEnv);
    const namedArgs = await this.resolveNamedArgs(callArgs, callerEnv);

    for (let i = 0; i < def.params.length; i++) {
      const param = def.params[i];
      if (namedArgs.has(param.name)) {
        agentEnv.set(param.name, namedArgs.get(param.name)!);
      } else if (i < resolvedArgs.length) {
        agentEnv.set(param.name, resolvedArgs[i]);
      } else if (param.defaultValue) {
        agentEnv.set(param.name, await this.evaluate(param.defaultValue, callerEnv));
      } else {
        agentEnv.set(param.name, orchidNull());
      }
    }

    try {
      let result: OrchidValue = orchidNull();
      for (const stmt of def.body) {
        result = await this.execute(stmt, agentEnv);
      }
      this.implicitContext = result;
      return result;
    } catch (e) {
      if (e instanceof ReturnSignal) {
        this.implicitContext = e.value;
        return e.value;
      }
      throw e;
    }
  }

  private async callCallable(
    callable: OrchidValue & { kind: 'callable' },
    callArgs: AST.Argument[],
    callTags: TagInfo[],
    callerEnv: Environment,
  ): Promise<OrchidValue> {
    if (callable.isAgent && this.agents.has(callable.name)) {
      return this.callAgent(this.agents.get(callable.name)!, callArgs, callTags, callerEnv);
    }
    if (this.macros.has(callable.name)) {
      return this.callMacro(this.macros.get(callable.name)!, callArgs, callTags, callerEnv);
    }
    // Generic callable — shouldn't normally happen
    return orchidNull();
  }

  private async executeReturn(node: AST.ReturnStatement, env: Environment): Promise<OrchidValue> {
    const value = node.value ? await this.evaluate(node.value, env) : orchidNull();
    throw new ReturnSignal(value);
  }

  // ─── Events ────────────────────────────────────────────

  private async executeEmit(node: AST.EmitStatement, env: Environment): Promise<OrchidValue> {
    const payload = node.payload ? await this.evaluate(node.payload, env) : orchidNull();
    const event: OrchidValue = { kind: 'event', name: node.event, payload };

    // If there's a pending listen() waiter, resolve it immediately
    if (this.listenResolvers.length > 0) {
      const resolver = this.listenResolvers.shift()!;
      resolver(event);
      return orchidNull();
    }

    // Dispatch to registered handlers
    const handlers = this.eventHandlers.get(node.event) || [];
    for (const handler of handlers) {
      const handlerEnv = handler.env.child();
      handlerEnv.set(handler.variable, event);
      await this.executeBlock(handler.body, handlerEnv);
    }

    // Buffer if no handlers
    if (handlers.length === 0) {
      if (!this.eventBuffer.has(node.event)) {
        this.eventBuffer.set(node.event, []);
      }
      const buf = this.eventBuffer.get(node.event)!;
      buf.push(payload);
      if (buf.length > 1000) buf.shift(); // Spec: drop oldest on overflow
    }

    return orchidNull();
  }

  private async executeOn(node: AST.OnStatement, env: Environment): Promise<OrchidValue> {
    if (!this.eventHandlers.has(node.event)) {
      this.eventHandlers.set(node.event, []);
    }
    this.eventHandlers.get(node.event)!.push({
      variable: node.variable,
      body: node.body,
      env,
    });

    // Process buffered events
    const buffered = this.eventBuffer.get(node.event) || [];
    for (const payload of buffered) {
      const handlerEnv = env.child();
      handlerEnv.set(node.variable, { kind: 'event', name: node.event, payload });
      await this.executeBlock(node.body, handlerEnv);
    }
    this.eventBuffer.delete(node.event);

    return orchidNull();
  }

  /**
   * listen() — consume the oldest buffered event across all event types.
   *
   * Per the spec (§10.5), listen() blocks until a single event is received.
   * In this synchronous runtime, we consume from the event buffer. If no
   * events are buffered, we resolve any pending listen waiters when the
   * next event is emitted.
   */
  private async executeListen(): Promise<OrchidValue> {
    // Check all event buffers for the oldest event
    for (const [eventName, buffer] of this.eventBuffer) {
      if (buffer.length > 0) {
        const payload = buffer.shift()!;
        // Clean up empty buffers
        if (buffer.length === 0) {
          this.eventBuffer.delete(eventName);
        }
        const event: OrchidValue = { kind: 'event', name: eventName, payload };
        this.implicitContext = event;
        return event;
      }
    }

    // No buffered events — wait for the next emit.
    // We create a promise that resolves when an event is emitted.
    return new Promise<OrchidValue>((resolve) => {
      this.listenResolvers.push((event: OrchidValue) => {
        this.implicitContext = event;
        resolve(event);
      });
    });
  }

  /**
   * Stream(source) — produce an iterable list of events from a source.
   *
   * Per the spec (§10.5), Stream produces an iterable of events.
   * Behavior depends on the source type:
   *   - List: returned as-is (already iterable)
   *   - String (event name): returns all buffered events for that name
   *   - Other: wraps the evaluated source in a single-element list
   */
  private async executeStream(node: AST.StreamExpression, env: Environment): Promise<OrchidValue> {
    const source = await this.evaluate(node.source, env);

    if (source.kind === 'list') {
      // Already an iterable — return as-is
      return source;
    }

    if (source.kind === 'string') {
      // Treat as event name — return buffered events for this type
      const buffered = this.eventBuffer.get(source.value) || [];
      const events = buffered.map(payload => {
        const event: OrchidValue = { kind: 'event', name: source.value, payload };
        return event;
      });
      // Consume the buffer
      this.eventBuffer.delete(source.value);
      return orchidList(events);
    }

    // Default: wrap in a single-element list
    return orchidList([source]);
  }

  // ─── Use / Import ──────────────────────────────────────

  private async executeUse(node: AST.UseStatement): Promise<OrchidValue> {
    // Strip version constraint from plugin names (e.g., "web-scraper@~1.3" → "web-scraper")
    const rawName = node.name.replace(/@[^@]+$/, '');
    const alias = node.alias || rawName.replace(/-/g, '_');
    this.namespaces.set(alias, rawName);

    if (node.kind === 'Plugin') {
      return this.loadPlugin(rawName, alias, node.position);
    }

    // If it's an MCP server and we have a manager, connect to it
    if (this.mcpManager) {
      try {
        await this.mcpManager.connect(node.name);
        // Also register the alias so namespace:Operation() routes correctly
        if (alias !== node.name) {
          // The MCPManager stores by the original name; we need the alias
          // to resolve too. Re-register under the alias if different.
          await this.mcpManager.connect(alias).catch(() => {
            // Alias may not be in config — that's fine, we'll use the
            // original name. Register a namespace mapping instead.
          });
        }
        if (this.traceEnabled) {
          const tools = this.mcpManager.getTools(node.name);
          this.trace(`Connected MCP server "${node.name}" as "${alias}" (${tools.length} tools)`);
        }
      } catch (error) {
        // Warn the user that this MCP server isn't configured
        console.warn(
          `[warn] MCP server "${node.name}" is not configured. Falling back to simulated calls.\n` +
          `       To install it, run: orchid mcp install ${node.name}`,
        );
        // Not a fatal error: the namespace is still registered so
        // provider.toolCall() will handle it as a simulated call
      }
    } else {
      // No MCP manager at all — no orchid.config.json
      console.warn(
        `[warn] MCP server "${node.name}" is not configured (no orchid.config.json found).\n` +
        `       To install it, run: orchid mcp install ${node.name}`,
      );
    }

    return orchidNull();
  }

  /**
   * Load a Plugin — a runtime capability extension.
   *
   * Resolution order:
   * 1. JS/TS modules: plugins/<name>.js, plugins/<name>/index.js
   * 2. .orch files:   plugins/<name>.orch, plugins/<name>/index.orch
   * 3. ORCHID_PLUGIN_PATH (same pattern in each directory)
   *
   * JS/TS plugins implement the OrchidPlugin interface and run in-process.
   * .orch plugins are parsed and executed in isolation as a convenience.
   */
  private async loadPlugin(name: string, alias: string, position?: AST.Position): Promise<OrchidValue> {
    const resolved = this.resolvePluginPath(name);
    if (!resolved) {
      throw new OrchidError(
        'ToolNotFound',
        `Plugin "${name}" not found. Searched in plugins/ directory and ORCHID_PLUGIN_PATH.`,
        position,
      );
    }

    if (resolved.endsWith('.orch')) {
      return this.loadOrchPlugin(name, alias, resolved, position);
    }

    return this.loadJsPlugin(name, alias, resolved, position);
  }

  /**
   * Load a JS/TS plugin module that exports an OrchidPlugin.
   */
  private async loadJsPlugin(name: string, alias: string, pluginPath: string, position?: AST.Position): Promise<OrchidValue> {
    let pluginExport: any;
    try {
      pluginExport = require(pluginPath);
    } catch (e: any) {
      throw new OrchidError(
        'ToolNotFound',
        `Failed to load plugin "${name}": ${e.message}`,
        position,
      );
    }

    // Support both default exports and module.exports
    const plugin: OrchidPlugin = pluginExport.default ?? pluginExport;

    if (!plugin.operations || typeof plugin.operations !== 'object') {
      throw new OrchidError(
        'ToolNotFound',
        `Plugin "${name}" does not export a valid OrchidPlugin (missing operations).`,
        position,
      );
    }

    // Call setup if provided
    if (plugin.setup) {
      const ctx = this.makePluginContext([]);
      try {
        await plugin.setup(ctx);
      } catch (e: any) {
        throw new OrchidError(
          'ToolNotFound',
          `Plugin "${name}" setup failed: ${e.message}`,
          position,
        );
      }
    }

    this.plugins.set(alias, { kind: 'js', plugin });

    if (this.traceEnabled) {
      const ops = Object.keys(plugin.operations).length;
      this.trace(`Loaded Plugin "${name}" as "${alias}" (${ops} operations) [JS]`);
    }

    return orchidNull();
  }

  /**
   * Load an .orch file as a plugin (convenience for simple plugins).
   */
  private async loadOrchPlugin(name: string, alias: string, pluginPath: string, position?: AST.Position): Promise<OrchidValue> {
    const source = fs.readFileSync(pluginPath, 'utf-8');

    let ast: AST.Program;
    try {
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();
      const parser = new Parser();
      ast = parser.parse(tokens);
    } catch (e: any) {
      throw new OrchidError(
        'ToolNotFound',
        `Failed to parse plugin "${name}": ${e.message}`,
        position,
      );
    }

    const pluginInterpreter = new Interpreter({
      provider: this.provider,
      trace: this.traceEnabled,
      mcpManager: this.mcpManager,
      scriptDir: path.dirname(pluginPath),
    });

    try {
      await pluginInterpreter.run(ast);
    } catch (e: any) {
      throw new OrchidError(
        'ToolNotFound',
        `Error loading plugin "${name}": ${e.message}`,
        position,
      );
    }

    this.plugins.set(alias, {
      kind: 'orch',
      interpreter: pluginInterpreter,
      macros: pluginInterpreter.macros,
      agents: pluginInterpreter.agents,
      env: pluginInterpreter.globalEnv,
    });

    if (this.traceEnabled) {
      const ops = pluginInterpreter.macros.size + pluginInterpreter.agents.size;
      this.trace(`Loaded Plugin "${name}" as "${alias}" (${ops} operations) [Orchid]`);
    }

    return orchidNull();
  }

  /**
   * Build a PluginContext for JS plugin operations.
   */
  private makePluginContext(tags: TagInfo[]): PluginContext {
    return {
      provider: this.provider,
      implicitContext: this.implicitContext,
      trace: (msg: string) => this.trace(msg),
      tags,
    };
  }

  /**
   * Resolve a plugin name to a file path by searching:
   * 1. plugins/<name>.js (JS/TS module) relative to script directory
   * 2. plugins/<name>/index.js (JS/TS directory module) relative to script directory
   * 3. plugins/<name>.orch (.orch file) relative to script directory
   * 4. plugins/<name>/index.orch (.orch directory) relative to script directory
   * 5. Same patterns in each ORCHID_PLUGIN_PATH directory
   *
   * JS/TS plugins take priority over .orch plugins when both exist.
   */
  private resolvePluginPath(name: string): string | null {
    const searchDirs: string[] = [
      path.resolve(this.scriptDir, 'plugins'),
    ];

    const pluginPath = process.env.ORCHID_PLUGIN_PATH;
    if (pluginPath) {
      for (const dir of pluginPath.split(path.delimiter)) {
        if (dir) searchDirs.push(path.resolve(dir));
      }
    }

    // For each search directory, try JS first then .orch
    for (const dir of searchDirs) {
      const candidates = [
        path.resolve(dir, `${name}.js`),
        path.resolve(dir, name, 'index.js'),
        path.resolve(dir, `${name}.orch`),
        path.resolve(dir, name, 'index.orch'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  private async executeImport(node: AST.ImportStatement): Promise<OrchidValue> {
    if (this.traceEnabled) {
      this.trace(`Import: ${node.path}${node.alias ? ` as ${node.alias}` : ''}`);
    }

    // Resolve the file path
    let importPath = node.path;
    // Convert dot-separated module path to file path (e.g. utils.helpers → utils/helpers)
    importPath = importPath.replace(/\./g, '/');
    // Add .orch extension if not present
    if (!importPath.endsWith('.orch')) {
      importPath += '.orch';
    }
    const resolved = path.resolve(this.scriptDir, importPath);

    // Check cache — avoid re-executing the same module
    if (this.importCache.has(resolved)) {
      const cachedEnv = this.importCache.get(resolved)!;
      this.mergeImportedBindings(cachedEnv, node.alias, this.globalEnv);
      return orchidNull();
    }

    // Detect circular imports
    if (this.importStack.has(resolved)) {
      const cycle = [...this.importStack, resolved].join(' → ');
      throw new OrchidError(
        'CyclicDependency',
        `Circular import detected: ${cycle}`,
        node.position,
      );
    }
    this.importStack.add(resolved);

    // Read and parse the source
    if (!fs.existsSync(resolved)) {
      this.importStack.delete(resolved);
      throw new OrchidError(
        'ImportError',
        `Module not found: ${resolved} (from import "${node.path}")`,
        node.position,
      );
    }

    const source = fs.readFileSync(resolved, 'utf-8');

    let ast: AST.Program;
    try {
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();
      const parser = new Parser();
      ast = parser.parse(tokens);
    } catch (e: any) {
      this.importStack.delete(resolved);
      throw new OrchidError(
        'ImportError',
        `Failed to parse "${node.path}": ${e.message}`,
        node.position,
      );
    }

    // Execute the imported module in an isolated environment
    const moduleInterpreter = new Interpreter({
      provider: this.provider,
      trace: this.traceEnabled,
      mcpManager: this.mcpManager,
      scriptDir: path.dirname(resolved),
    });
    // Share the import stack so nested imports can also detect cycles
    moduleInterpreter.importStack = this.importStack;

    try {
      await moduleInterpreter.run(ast);
    } catch (e: any) {
      this.importStack.delete(resolved);
      // Preserve CyclicDependency errors rather than wrapping them
      if (e instanceof OrchidError && e.errorType === 'CyclicDependency') {
        throw e;
      }
      throw new OrchidError(
        'ImportError',
        `Error executing "${node.path}": ${e.message}`,
        node.position,
      );
    }

    // Import succeeded — remove from in-progress stack
    this.importStack.delete(resolved);

    // Cache and merge the module's exported bindings
    const moduleEnv = moduleInterpreter.globalEnv;
    this.importCache.set(resolved, moduleEnv);
    this.mergeImportedBindings(moduleEnv, node.alias, this.globalEnv);

    // Also import any macros/agents defined in the module
    for (const [name, macro] of moduleInterpreter.macros) {
      const prefixed = node.alias ? `${node.alias}_${name}` : name;
      this.macros.set(prefixed, macro);
    }
    for (const [name, agent] of moduleInterpreter.agents) {
      const prefixed = node.alias ? `${node.alias}_${name}` : name;
      this.agents.set(prefixed, agent);
    }

    return orchidNull();
  }

  /**
   * Merge an imported module's top-level bindings into the target environment.
   * If alias is given, bindings are prefixed as alias_name.
   * Otherwise they're merged directly (like Python's `from x import *`).
   */
  private mergeImportedBindings(
    moduleEnv: Environment,
    alias: string | undefined,
    targetEnv: Environment,
  ): void {
    const bindings = moduleEnv.getOwnBindings();
    if (alias) {
      // Create a dict with all module bindings accessible as alias.name
      const entries = new Map<string, OrchidValue>();
      for (const [name, value] of bindings) {
        entries.set(name, value);
      }
      targetEnv.set(alias, orchidDict(entries));
    } else {
      // Merge all bindings directly
      for (const [name, value] of bindings) {
        targetEnv.set(name, value);
      }
    }
  }

  // ─── Expression Operators ──────────────────────────────

  private async executePipeExpr(node: AST.PipeExpression, env: Environment): Promise<OrchidValue> {
    const leftResult = await this.evaluate(node.left, env);
    this.implicitContext = leftResult;
    return this.evaluate(node.right, env);
  }

  private async executeMerge(node: AST.MergeExpression, env: Environment): Promise<OrchidValue> {
    const left = await this.evaluate(node.left, env);
    const right = await this.evaluate(node.right, env);
    return this.mergeValues(left, right);
  }

  private mergeValues(left: OrchidValue, right: OrchidValue): OrchidValue {
    // Number + Number → arithmetic
    if (left.kind === 'number' && right.kind === 'number') {
      return orchidNumber(left.value + right.value);
    }
    // String + String → concatenation
    if (left.kind === 'string' && right.kind === 'string') {
      return orchidString(left.value + '\n\n' + right.value);
    }
    // List + List → concatenation
    if (left.kind === 'list' && right.kind === 'list') {
      return orchidList([...left.elements, ...right.elements]);
    }
    // Dict + Dict → merge
    if (left.kind === 'dict' && right.kind === 'dict') {
      const merged = new Map(left.entries);
      for (const [k, v] of right.entries) {
        merged.set(k, v);
      }
      return orchidDict(merged);
    }
    // Mixed → synthesize as string
    return orchidString(valueToString(left) + '\n\n' + valueToString(right));
  }

  private async executeAlternative(node: AST.AlternativeExpression, env: Environment): Promise<OrchidValue> {
    try {
      const left = await this.evaluate(node.left, env);
      if (left.kind !== 'null' && isTruthy(left)) {
        return left;
      }
    } catch {
      // Left failed, try right
    }
    return this.evaluate(node.right, env);
  }

  private async executeComparison(node: AST.ComparisonExpression, env: Environment): Promise<OrchidValue> {
    const left = await this.evaluate(node.left, env);
    const right = await this.evaluate(node.right, env);

    const lNum = left.kind === 'number' ? left.value : NaN;
    const rNum = right.kind === 'number' ? right.value : NaN;

    switch (node.operator) {
      case '>': return orchidBoolean(lNum > rNum);
      case '<': return orchidBoolean(lNum < rNum);
      case '>=': return orchidBoolean(lNum >= rNum);
      case '<=': return orchidBoolean(lNum <= rNum);
      case '==': return orchidBoolean(valuesEqual(left, right));
      case '!=': return orchidBoolean(!valuesEqual(left, right));
    }
  }

  private async executeLogical(node: AST.LogicalExpression, env: Environment): Promise<OrchidValue> {
    const left = await this.evaluate(node.left, env);
    if (node.operator === 'and') {
      if (!isTruthy(left)) return left;
      return this.evaluate(node.right, env);
    } else {
      if (isTruthy(left)) return left;
      return this.evaluate(node.right, env);
    }
  }

  private async executeUnary(node: AST.UnaryExpression, env: Environment): Promise<OrchidValue> {
    const operand = await this.evaluate(node.operand, env);
    if (node.operator === 'not') {
      return orchidBoolean(!isTruthy(operand));
    }
    if (node.operator === '-') {
      if (operand.kind === 'number') {
        return orchidNumber(-operand.value);
      }
    }
    return orchidNull();
  }

  private async executeArithmetic(node: AST.ArithmeticExpression, env: Environment): Promise<OrchidValue> {
    const left = await this.evaluate(node.left, env);
    const right = await this.evaluate(node.right, env);

    if (left.kind === 'number' && right.kind === 'number') {
      switch (node.operator) {
        case '*': return orchidNumber(left.value * right.value);
        case '-': return orchidNumber(left.value - right.value);
        case '+': return orchidNumber(left.value + right.value);
      }
    }

    // String concatenation for *
    if (node.operator === '*' && left.kind === 'string' && right.kind === 'string') {
      return orchidString(valueToString(left) + valueToString(right));
    }

    return orchidNull();
  }

  private async executeInExpr(node: AST.InExpression, env: Environment): Promise<OrchidValue> {
    const left = await this.evaluate(node.left, env);
    const right = await this.evaluate(node.right, env);

    if (right.kind === 'list') {
      return orchidBoolean(right.elements.some(e => valuesEqual(left, e)));
    }
    if (right.kind === 'string' && left.kind === 'string') {
      return orchidBoolean(right.value.includes(left.value));
    }
    if (right.kind === 'dict' && left.kind === 'string') {
      return orchidBoolean(right.entries.has(left.value));
    }
    return orchidBoolean(false);
  }

  private async executeMemberExpr(node: AST.MemberExpression, env: Environment): Promise<OrchidValue> {
    const obj = await this.evaluate(node.object, env);
    if (obj.kind === 'dict') {
      return obj.entries.get(node.property) || orchidNull();
    }
    if (obj.kind === 'event') {
      if (node.property === 'name') return orchidString(obj.name);
      if (node.property === 'payload') return obj.payload;
      // Try to access payload properties
      if (obj.payload.kind === 'dict') {
        return obj.payload.entries.get(node.property) || orchidNull();
      }
    }
    if (obj.kind === 'list') {
      if (node.property === 'length') return orchidNumber(obj.elements.length);
    }
    if (obj.kind === 'string') {
      if (node.property === 'length') return orchidNumber(obj.value.length);
    }
    return orchidNull();
  }

  // ─── Literals ──────────────────────────────────────────

  private async executeInterpolatedString(node: AST.InterpolatedString, env: Environment): Promise<OrchidValue> {
    let result = '';
    for (const part of node.parts) {
      if (typeof part === 'string') {
        result += part;
      } else {
        const val = await this.evaluate(part as AST.Node, env);
        result += valueToString(val);
      }
    }
    return orchidString(result);
  }

  private async executeListLiteral(node: AST.ListLiteral, env: Environment): Promise<OrchidValue> {
    const elements: OrchidValue[] = [];
    for (const el of node.elements) {
      elements.push(await this.evaluate(el, env));
    }
    return orchidList(elements);
  }

  private async executeDictLiteral(node: AST.DictLiteral, env: Environment): Promise<OrchidValue> {
    const entries = new Map<string, OrchidValue>();
    for (const entry of node.entries) {
      entries.set(entry.key, await this.evaluate(entry.value, env));
    }
    return orchidDict(entries);
  }

  // ─── Helpers ───────────────────────────────────────────

  private async executeBlock(body: AST.Node[], env: Environment): Promise<OrchidValue> {
    let result: OrchidValue = orchidNull();
    for (const stmt of body) {
      result = await this.execute(stmt, env);
    }
    return result;
  }

  private async resolveArgs(args: AST.Argument[], env: Environment): Promise<OrchidValue[]> {
    const results: OrchidValue[] = [];
    for (const arg of args) {
      if (!arg.name || arg.name === '_count') {
        // Skip named args for positional resolution, but include _count
        if (arg.name === '_count') continue;
        results.push(await this.evaluate(arg.value, env));
      } else {
        results.push(await this.evaluate(arg.value, env));
      }
    }
    return results;
  }

  private async resolveNamedArgs(args: AST.Argument[], env: Environment): Promise<Map<string, OrchidValue>> {
    const named = new Map<string, OrchidValue>();
    for (const arg of args) {
      if (arg.name && arg.name !== '_count') {
        named.set(arg.name, await this.evaluate(arg.value, env));
      }
    }
    return named;
  }

  private async resolveTags(tags: AST.Tag[], env: Environment): Promise<TagInfo[]> {
    const resolved: TagInfo[] = [];
    for (const t of tags) {
      const info: TagInfo = { name: t.name };
      if (t.value) {
        info.value = await this.evaluate(t.value, env);
      }
      resolved.push(info);
    }
    return resolved;
  }

  private nodeToInputString(node: AST.Node): string {
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'NumberLiteral') return node.raw;
    if (node.type === 'Identifier') return node.name;
    return '';
  }

  private trace(message: string): void {
    this.traceLog.push(`[${Date.now() - this.startTime}ms] ${message}`);
    if (this.traceEnabled) {
      console.log(`  [trace] ${message}`);
    }
  }

  // ─── Timeout ────────────────────────────────────────────

  /**
   * Wrap a promise with an optional timeout from resolved tags.
   *
   * If a <timeout=N> or <timeout=Ns> tag is present, the operation is
   * raced against a timer. If the timer wins, a Timeout error is thrown.
   * Without the tag, the promise passes through unchanged.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    tags: TagInfo[],
    position?: AST.Position,
  ): Promise<T> {
    const timeoutTag = tags.find(t => t.name === 'timeout');
    if (!timeoutTag?.value) return promise;

    let ms: number;
    if (timeoutTag.value.kind === 'number') {
      // If the number has a suffix like 's', the raw value is in that unit
      ms = timeoutTag.value.value;
      if (timeoutTag.value.suffix === 's') {
        ms = timeoutTag.value.value * 1000;
      } else if (timeoutTag.value.suffix === 'm') {
        ms = timeoutTag.value.value * 60000;
      } else if (!timeoutTag.value.suffix) {
        // Bare number — treat as milliseconds
        ms = timeoutTag.value.value;
      }
    } else if (timeoutTag.value.kind === 'string') {
      // Parse "10s", "5000", "2m"
      const str = timeoutTag.value.value;
      const match = str.match(/^(\d+(?:\.\d+)?)(s|ms|m)?$/);
      if (match) {
        const n = parseFloat(match[1]);
        const unit = match[2] || 'ms';
        if (unit === 's') ms = n * 1000;
        else if (unit === 'm') ms = n * 60000;
        else ms = n;
      } else {
        return promise; // Unparseable timeout value, skip
      }
    } else {
      return promise; // Non-numeric/string timeout value, skip
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new OrchidError('Timeout', `Operation timed out after ${ms}ms`, position));
      }, ms);

      promise.then(
        (result) => { clearTimeout(timer); resolve(result); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  // ─── Discover ───────────────────────────────────────────

  /**
   * Implement Discover(pattern) — returns all available namespaces and tools
   * matching the given glob-like pattern.
   *
   * Patterns:
   *   "*"       → all registered namespaces
   *   "MCP.*"   → all MCP server namespaces
   *   "Plugin.*" → all plugin namespaces
   *   "fs.*"    → all tools under the "fs" namespace
   *   "postgres" → exact match for a namespace
   *
   * The returned list includes:
   *   - Registered namespace aliases (MCP servers and plugins)
   *   - Individual tool names in the form "namespace.tool" for MCP servers
   *   - Individual operation names in the form "namespace.operation" for plugins
   */
  private executeDiscover(pattern: string): OrchidValue {
    const candidates: string[] = [];

    // Collect all registered namespace aliases with their kinds
    for (const [alias, name] of this.namespaces) {
      candidates.push(alias);

      // Add namespaced tool names for MCP servers
      if (this.mcpManager?.hasServer(alias) || this.mcpManager?.hasServer(name)) {
        const serverName = this.mcpManager.hasServer(alias) ? alias : name;
        const tools = this.mcpManager.getTools(serverName);
        for (const tool of tools) {
          candidates.push(`${alias}.${tool.name}`);
        }
      }

      // Add namespaced operation names for plugins
      const plugin = this.plugins.get(alias);
      if (plugin) {
        if (plugin.kind === 'js') {
          for (const opName of Object.keys(plugin.plugin.operations)) {
            candidates.push(`${alias}.${opName}`);
          }
        } else {
          for (const macroName of plugin.macros.keys()) {
            candidates.push(`${alias}.${macroName}`);
          }
          for (const agentName of plugin.agents.keys()) {
            candidates.push(`${alias}.${agentName}`);
          }
        }
      }
    }

    // Also add built-in macro names
    for (const builtin of BUILTIN_MACROS) {
      candidates.push(builtin);
    }
    for (const meta of META_OPERATIONS) {
      candidates.push(meta);
    }

    // Filter by pattern
    const matched = candidates.filter(c => this.globMatch(pattern, c));
    // Deduplicate
    const unique = [...new Set(matched)];
    return orchidList(unique.map(n => orchidString(n)));
  }

  /**
   * Simple glob matching: supports '*' as wildcard for any sequence of
   * characters (except '.'), and '**' or trailing '*' to match everything
   * including dots. Matching is case-insensitive.
   *
   * Examples:
   *   globMatch("MCP.*", "MCP.filesystem") → false (MCP isn't a candidate)
   *   globMatch("fs.*", "fs.Read")         → true
   *   globMatch("*", "postgres")           → true
   *   globMatch("postgres", "postgres")    → true
   *   globMatch("fs.Re*", "fs.Read")       → true
   */
  private globMatch(pattern: string, candidate: string): boolean {
    // Convert glob pattern to regex
    let regexStr = '^';
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === '*') {
        if (i + 1 < pattern.length && pattern[i + 1] === '*') {
          regexStr += '.*'; // ** matches everything including dots
          i++; // skip second *
        } else {
          regexStr += '[^.]*'; // * matches everything except dots
        }
      } else if (ch === '?') {
        regexStr += '[^.]';
      } else if ('.+^${}()|[]\\'.includes(ch)) {
        regexStr += '\\' + ch;
      } else {
        regexStr += ch;
      }
    }
    regexStr += '$';

    try {
      const regex = new RegExp(regexStr, 'i');
      return regex.test(candidate);
    } catch {
      // If the pattern produces an invalid regex, fall back to exact match
      return pattern.toLowerCase() === candidate.toLowerCase();
    }
  }
}
