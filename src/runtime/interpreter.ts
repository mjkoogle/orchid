import * as AST from '../parser/ast';
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
}

export class Interpreter {
  private provider: OrchidProvider;
  private globalEnv: Environment;
  private implicitContext: OrchidValue = orchidNull();
  private checkpoints: Map<string, { env: Map<string, OrchidValue>; context: OrchidValue }> = new Map();
  private eventHandlers: Map<string, { variable: string; body: AST.Node[]; env: Environment }[]> = new Map();
  private eventBuffer: Map<string, OrchidValue[]> = new Map();
  private namespaces: Map<string, string> = new Map(); // alias -> name
  private startTime = Date.now();
  private traceEnabled: boolean;
  private traceLog: string[] = [];
  private macros: Map<string, AST.MacroDef> = new Map();
  private agents: Map<string, AST.AgentDef> = new Map();

  constructor(options: InterpreterOptions) {
    this.provider = options.provider;
    this.globalEnv = new Environment();
    this.traceEnabled = options.trace ?? false;
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
        // Validate requirements would check provider capabilities
        break;
      default:
        // Store as metadata
        break;
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
        return orchidNull(); // Placeholder — requires interactive runtime
      case 'StreamExpression':
        return this.evaluate(node.source, env);

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
    const tags = this.resolveTags(node.tags, env);

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
      const result = await this.provider.search(query, tags);
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
      const available = Array.from(this.namespaces.keys());
      return orchidList(available.map(n => orchidString(n)));
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

      const result = await this.provider.execute(name, inputStr, context, tags);
      this.implicitContext = result;
      return result;
    }

    // Unknown operation — try calling as a generic operation
    const input = await this.resolveArgs(node.args, env);
    const inputStr = input.length > 0
      ? valueToString(input[0])
      : valueToString(this.implicitContext);
    const result = await this.provider.execute(name, inputStr, {}, tags);
    this.implicitContext = result;
    return result;
  }

  private async executeNamespacedOperation(node: AST.NamespacedOperation, env: Environment): Promise<OrchidValue> {
    const tags = this.resolveTags(node.tags, env);
    const args: Record<string, OrchidValue> = {};
    for (const arg of node.args) {
      const val = await this.evaluate(arg.value, env);
      args[arg.name || `arg${Object.keys(args).length}`] = val;
    }

    const result = await this.provider.toolCall(node.namespace, node.name, args, tags);
    this.implicitContext = result;
    return result;
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
    // On success, bindings commit to parent. On failure, nothing leaks out.
    const atomicEnv = env.child();
    const savedContext = this.implicitContext;

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
      // Rollback: restore context, don't commit bindings
      this.implicitContext = savedContext;
      throw e;
    }
  }

  private async executeFork(node: AST.ForkExpression, env: Environment): Promise<OrchidValue> {
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
          let result: OrchidValue = orchidNull();
          for (const stmt of node.forLoop!.body) {
            result = await this.execute(stmt, forkEnv);
          }
          return result;
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
          let result: OrchidValue = orchidNull();
          for (const stmt of branch.body) {
            result = await this.execute(stmt, forkEnv);
          }
          return { name: branch.name!, value: result };
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
        let result: OrchidValue = orchidNull();
        for (const stmt of branch.body) {
          result = await this.execute(stmt, forkEnv);
        }
        return result;
      })
    );
    const result = orchidList(results);
    this.implicitContext = result;
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

  // ─── Use / Import ──────────────────────────────────────

  private async executeUse(node: AST.UseStatement): Promise<OrchidValue> {
    const alias = node.alias || node.name.replace(/-/g, '_');
    this.namespaces.set(alias, node.name);
    if (this.traceEnabled) {
      this.trace(`Loaded ${node.kind}: ${node.name} as ${alias}`);
    }
    return orchidNull();
  }

  private async executeImport(node: AST.ImportStatement): Promise<OrchidValue> {
    if (this.traceEnabled) {
      this.trace(`Import: ${node.path}${node.alias ? ` as ${node.alias}` : ''}`);
    }
    // Actual file-level import would require a module loader
    return orchidNull();
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

  private resolveTags(tags: AST.Tag[], env: Environment): TagInfo[] {
    return tags.map(t => ({
      name: t.name,
      value: undefined, // Tag values resolved lazily if needed
    }));
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
}
