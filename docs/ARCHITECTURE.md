# Architecture

How the Orchid runtime works, from source text to final output.

## Pipeline

```
                    ┌─────────────────────────────────────────────────┐
                    │                  orchid CLI                      │
                    │   cli.ts — flags, provider selection, MCP setup  │
                    └──────────────────┬──────────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────────┐
                    │               Lexer (lexer.ts)                   │
                    │   Source string → Token[]                        │
                    │   Handles: keywords, operators, strings,         │
                    │   interpolation, indentation, tags               │
                    └──────────────────┬──────────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────────┐
                    │              Parser (parser.ts)                   │
                    │   Token[] → AST.Program                          │
                    │   Recursive descent, no separate grammar file.   │
                    │   Handles: metadata, operations, control flow,   │
                    │   fork, agents, macros, namespaced calls, etc.   │
                    └──────────────────┬──────────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────────┐
                    │           Interpreter (interpreter.ts)            │
                    │   Walks AST nodes, manages environments,         │
                    │   dispatches to providers and MCP servers.        │
                    │                                                  │
                    │   Key responsibilities:                          │
                    │   • Variable binding and scoping                 │
                    │   • Control flow (if/while/for/until/try)        │
                    │   • fork → Promise.all for parallel execution    │
                    │   • Macro/agent definition and calling           │
                    │   • Import resolution and cycle detection        │
                    │   • Plugin lifecycle management                  │
                    │   • Event system (emit/on/listen)                │
                    │   • Checkpoints and rollback                     │
                    └───┬──────────────┬──────────────┬───────────────┘
                        │              │              │
            ┌───────────▼──┐  ┌───────▼───────┐  ┌──▼──────────┐
            │   Provider    │  │  MCPManager   │  │   Plugins   │
            │               │  │               │  │             │
            │ execute()     │  │ callTool()    │  │ setup()     │
            │ search()      │  │ connect()     │  │ teardown()  │
            │ confidence()  │  │ disconnect()  │  │ operations  │
            │ toolCall()    │  │               │  │             │
            └───────────────┘  └───────────────┘  └─────────────┘
```

## Source Map

### Lexer (`src/lexer/`)

| File | Lines | Purpose |
|------|-------|---------|
| `tokens.ts` | ~80 | Token type enum and Token interface |
| `lexer.ts` | ~550 | Tokenizer: handles string interpolation, indent tracking, all operators |

The lexer is the simplest layer. It converts source text into a flat array of tokens. String interpolation (`$var` and `${expr}`) is handled at the lexer level by emitting `STRING_INTERP_START`, inner tokens, and `STRING_INTERP_END`.

### Parser (`src/parser/`)

| File | Lines | Purpose |
|------|-------|---------|
| `ast.ts` | ~250 | All AST node type definitions (TypeScript interfaces) |
| `parser.ts` | ~1200 | Recursive descent parser with Pratt precedence for expressions |

Key AST nodes: `Program`, `Operation`, `NamespacedOperation`, `Assignment`, `ForkExpression`, `IfStatement`, `WhileLoop`, `ForLoop`, `UntilLoop`, `TryStatement`, `MacroDef`, `AgentDef`, `ImportStatement`.

The parser produces a fully-typed AST — no intermediate representation. Dict keys must be bare identifiers (`{name: "val"}`), not strings.

### Runtime (`src/runtime/`)

| File | Lines | Purpose |
|------|-------|---------|
| `interpreter.ts` | ~1900 | Core execution engine — AST walker |
| `environment.ts` | ~80 | Scoped variable bindings (lexical scoping with parent chains) |
| `values.ts` | ~120 | `OrchidValue` union type: string, number, boolean, null, list, dict, callable |
| `builtins.ts` | ~150 | Set of 30+ built-in macro names + descriptions |
| `provider.ts` | ~150 | `OrchidProvider` interface + `ConsoleProvider` (testing) |
| `claude-provider.ts` | ~450 | Anthropic Claude API provider with per-operation system prompts |
| `sandbox-provider.ts` | ~200 | Rate limiting, prompt sanitization wrapper |
| `mcp-manager.ts` | ~300 | MCP server lifecycle: connect, discover tools, call tools, disconnect |
| `mcp-registry.ts` | ~185 | Built-in catalog of 12 well-known MCP servers |
| `mcp-remote-registry.ts` | ~200 | npm search + local cache for discovering MCP packages |
| `mcp-install.ts` | ~200 | Auto-install MCP servers from registry or from `@requires` in scripts |
| `config.ts` | ~100 | Load and merge orchid.config.json files |
| `plugin.ts` | ~80 | Plugin interface (setup, teardown, operations) |
| `status.ts` | ~100 | Terminal spinner for progress feedback |

### CLI (`src/cli.ts`)

Single file (~400 lines) handling:
- Flag parsing and provider creation
- MCP subcommands (install, list, search, update)
- Script execution with error handling and cleanup

### Tests (`tests/`)

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `lexer.test.ts` | ~50 | Every token type, edge cases, string interpolation |
| `parser.test.ts` | ~70 | Every AST node type, error cases, complex nesting |
| `runtime.test.ts` | ~80 | All control flow, operations, fork, agents, macros, events |
| `claude-provider.test.ts` | ~15 | API mocking, operation-specific prompts, list parsing |
| `sandbox-provider.test.ts` | ~15 | Rate limiting, prompt injection detection |
| `mcp-manager.test.ts` | ~20 | Connection, tool discovery, tool calling |
| `mcp-integration.test.ts` | ~10 | Real MCP server tests (opt-in via MCP_INTEGRATION=1) |
| `mcp-install.test.ts` | ~20 | Auto-install from registry and scripts |
| `mcp-remote-registry.test.ts` | ~15 | npm search, caching, name derivation |
| `config.test.ts` | ~10 | Config loading, merging, path resolution |
| `plugin.test.ts` | ~10 | Plugin loading, lifecycle, operation dispatch |
| `e2e-cli.test.ts` | ~15 | Full CLI integration tests |

## Key Design Decisions

### Provider Abstraction

All LLM calls go through the `OrchidProvider` interface. The interpreter never calls Claude directly. This means:
- Tests run instantly with `ConsoleProvider` (no API calls)
- New LLM backends (OpenAI, local models) only need to implement 4 methods
- `SandboxProvider` can wrap any provider transparently

### MCP Auto-Connect

MCP servers are lazily connected on first use. If a script calls `filesystem:read_text_file(...)`, the interpreter checks:
1. Is `filesystem` already connected? → call the tool
2. Is `filesystem` configured in orchid.config.json? → connect, then call
3. Neither? → error with `orchid mcp install filesystem` guidance

### Fork Semantics

`fork` blocks run branches via `Promise.all`. Each branch gets:
- Its own child `Environment` (isolated variable scope)
- A snapshot of the parent's implicit context (`_`)
- No visibility into other branches' intermediate state

Named forks return a dict, unnamed forks return a list.

### Status Reporter

The `StatusReporter` interface decouples terminal UI from execution:
- `TerminalStatusReporter`: animated spinner on TTY, static prefix on non-TTY
- `SilentStatusReporter`: no-op (for tests, `--quiet`)
- All output goes to stderr so stdout stays clean for piping

### Error Model

Orchid errors carry a type (`RuntimeError`, `TypeError`, `ToolNotFound`, `UserError`) and source position. `try/catch/finally` blocks work as expected. The `<retry=N>` tag on operations is handled by the interpreter, not the provider.

## Data Flow Example

What happens when the interpreter encounters `CoT("analyze trends")<deep>`:

```
1. executeOperation() is called with AST.Operation node
2. Tags are resolved: [{name: "deep"}]
3. Arguments are evaluated: "analyze trends"
4. BUILTIN_MACROS.has("CoT") → true
5. status.start("CoT(...)")
6. provider.execute("CoT", "analyze trends", {}, [{name: "deep"}])
     ↓
     ClaudeProvider:
     a. buildSystemPrompt("CoT", {}, [{name: "deep"}])
        → "You are performing Chain-of-Thought reasoning..."
        → + "Be extremely thorough and detailed..." (from <deep> tag)
     b. callClaude(systemPrompt, "analyze trends", temperature=0.5)
        → client.messages.create({model, max_tokens, system, messages})
     c. Check stop_reason for truncation
     d. Return orchidString(response_text)
     ↓
7. status.succeed("CoT done")
8. implicitContext is updated
9. Result returned to caller
```

## Spec vs. Implementation

The [specification](specification.md) is an RFC that describes the *target* language design. A few features are specced but not yet implemented:

| Spec Feature | Status | Notes |
|-------------|--------|-------|
| `Use MCP("name") as alias` | Not implemented | Scripts use server names directly as namespaces (`filesystem:read_text_file`) |
| `Use Plugin("name") as alias` | Not implemented | Plugins are loaded via `import` with `.js` files |
| `require` statement | Not implemented | `@requires MCP("name")` metadata is validated instead |
| `assert` statement | Not implemented | Use `if` + `Error()` as a workaround |
| `permissions` block | Not implemented | Planned for sandbox hardening |
| Cross-process events | Not implemented | Events are process-local only |

Everything else in the spec (reasoning macros, fork, control flow, agents, macros, tags, events, checkpoints, error handling, imports) is fully implemented and tested.
