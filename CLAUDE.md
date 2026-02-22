# CLAUDE.md — Orchid Repository Context

This file helps AI assistants (Claude, Copilot, Cursor, etc.) understand and work with the Orchid codebase effectively.

## What is Orchid?

Orchid is a **cognitive choreography language** for LLM agent orchestration. It's a domain-specific language (DSL) where reasoning is the primitive — you write scripts that describe *how an agent should think*, not just what it should compute.

**Key idea:** `CoT("analyze trends")` is not a function call that transforms data. It's an instruction to an LLM to perform chain-of-thought reasoning on the given input.

## Repository Layout

```
orchid/
├── src/
│   ├── cli.ts                          # CLI entry point (orchid command)
│   ├── index.ts                        # Library exports (parse, execute)
│   ├── lexer/
│   │   ├── lexer.ts                    # Tokenizer (source → tokens)
│   │   └── tokens.ts                   # Token type definitions
│   ├── parser/
│   │   ├── parser.ts                   # Recursive descent parser (tokens → AST)
│   │   └── ast.ts                      # AST node type definitions
│   └── runtime/
│       ├── interpreter.ts              # Main execution engine (AST → results)
│       ├── environment.ts              # Scoped variable storage
│       ├── values.ts                   # Orchid value types (string, number, list, dict, etc.)
│       ├── builtins.ts                 # Built-in macro names and descriptions
│       ├── provider.ts                 # OrchidProvider interface + ConsoleProvider
│       ├── claude-provider.ts          # Anthropic Claude API provider
│       ├── sandbox-provider.ts         # Rate-limiting security wrapper
│       ├── mcp-manager.ts             # MCP server connection management
│       ├── mcp-registry.ts            # Built-in MCP server catalog (12 servers)
│       ├── mcp-remote-registry.ts     # npm search for MCP packages
│       ├── mcp-install.ts             # Auto-install MCP servers from scripts
│       ├── confidence.ts               # Runtime confidence signal tracker
│       ├── config.ts                   # orchid.config.json loading
│       ├── plugin.ts                   # JS/TS plugin interface
│       └── status.ts                   # Terminal spinner/status display
├── tests/                              # Jest test suites (13 files, ~5000 lines)
├── examples/                           # .orch example scripts (8 files)
├── docs/
│   └── specification.md                # Full language specification with EBNF grammar
├── dist/                               # Compiled JS output (git-ignored)
├── package.json
├── tsconfig.json
└── jest.config.js
```

## Architecture Overview

The pipeline is: **Source → Lexer → Parser → Interpreter → Provider → Output**

```
.orch file
    ↓
Lexer (lexer.ts)        Tokenizes source into token stream
    ↓
Parser (parser.ts)      Recursive descent → AST nodes (ast.ts)
    ↓
Interpreter             Walks AST, manages environments, handles control flow
    ├── Provider         LLM backend (ConsoleProvider, ClaudeProvider, SandboxProvider)
    ├── MCPManager       External tool connections via Model Context Protocol
    └── Plugins          JS/TS extension modules
    ↓
OrchidValue             Result (string, number, boolean, list, dict, null, callable)
```

### Provider Pattern

The **OrchidProvider** interface decouples the interpreter from any specific LLM. All reasoning macros (CoT, ELI5, RedTeam, etc.) delegate to `provider.execute()`. This means:

- **ConsoleProvider**: Returns placeholder strings instantly (for testing/development)
- **ClaudeProvider**: Calls the Anthropic API with operation-specific system prompts
- **SandboxProvider**: Wraps any provider with rate limiting and prompt sanitization

### MCP Integration

Orchid scripts can call external tools via Model Context Protocol (MCP) servers:

```orchid
@requires MCP("filesystem")
tree := filesystem:directory_tree(path="src")
```

The runtime auto-connects to configured MCP servers on first use. Configuration lives in `orchid.config.json`. The `orchid mcp install` command auto-configures servers from a built-in registry of 12 well-known servers.

## Build & Test

```bash
npm install              # install dependencies
npm run build            # compile TypeScript → dist/
npm test                 # run all 440+ tests (Jest)
npm run lint             # type-check without emitting
```

## Running Scripts

```bash
# Console provider (instant, no API key — for development)
node dist/cli.js examples/hello_world.orch

# Claude provider (real LLM calls)
node dist/cli.js --provider claude examples/hello_world.orch

# With MCP servers (needs orchid.config.json)
node dist/cli.js --provider claude examples/threat_model.orch

# Parse-only (check syntax, print AST)
node dist/cli.js --parse examples/deep_research.orch
```

## Key CLI Flags

| Flag | Description |
|------|-------------|
| `--provider console\|claude` | LLM backend (default: console) |
| `--model <id>` | Claude model to use |
| `--max-tokens <n>` | Max tokens per LLM response (default: 16384) |
| `--sandbox` | Enable rate limiting + prompt sanitization |
| `--trace` | Enable execution tracing |
| `--quiet` | Suppress status spinner |
| `--parse` | Parse only, print AST as JSON |
| `--lex` | Tokenize only, print token stream |

## Test Suites

| Suite | What it tests |
|-------|--------------|
| `lexer.test.ts` | Tokenization of all Orchid syntax |
| `parser.test.ts` | AST generation for every language construct |
| `runtime.test.ts` | Interpreter execution of all features |
| `claude-provider.test.ts` | Claude API integration (mocked) |
| `sandbox-provider.test.ts` | Rate limiting and prompt sanitization |
| `mcp-manager.test.ts` | MCP server connection and tool calling |
| `mcp-integration.test.ts` | End-to-end MCP tests (requires MCP_INTEGRATION=1) |
| `mcp-install.test.ts` | Auto-install from scripts and registry |
| `mcp-remote-registry.test.ts` | npm search and catalog caching |
| `config.test.ts` | Config file loading and merging |
| `plugin.test.ts` | JS/TS plugin loading and lifecycle |
| `confidence.test.ts` | Runtime confidence signal tracking and blending |
| `e2e-cli.test.ts` | CLI end-to-end tests (parse, lex, execute) |

## Language Quick Reference

### Reasoning Macros (30+ built-in)

**Analysis:** `CoT`, `CoVe`, `Decompose`, `Classify`, `Extract`, `Compare`, `Timeline`, `Spatial`, `Quantify`
**Critique:** `Critique`, `RedTeam`, `Steelman`, `DevilsAdvocate`, `Counterfactual`, `Validate`
**Synthesis:** `Refine`, `Consensus`, `Debate`, `Synthesize`, `Reconcile`, `Prioritize`
**Communication:** `ELI5`, `Formal`, `Analogize`, `Socratic`, `Narrate`, `Translate`
**Generative:** `Creative`, `Brainstorm`, `Abstract`, `Ground`, `Reframe`
**Meta:** `Reflect`, `Explain`, `Summarize`, `Confidence`, `Trace`, `Cost`, `Checkpoint`, `Rollback`, `Save`

### Operators

**Composition:** `:=` (assign), `+=` (append), `|` (alternative), `>>` (pipe)
**Arithmetic:** `+` (add / semantic synthesis via LLM), `*` (multiply / string concat), `/` (divide / literal string removal), `-` (subtract / semantic string subtraction via LLM)
**Comparison:** `==`, `!=`, `>`, `<`, `>=`, `<=`
**Logical:** `and`, `or`, `not`
**Containment:** `in`

### Control Flow

```orchid
if condition:             # conditional
elif other:
else:

while condition:          # loop
    body

for item in list:         # iteration
    body

until Confidence() > 0.8: # confidence-gated loop
    body
```

### Parallel Execution

```orchid
result := fork:                        # named branches → dict
    branch_a: CoT("perspective A")
    branch_b: CoT("perspective B")

results := fork item in list:          # parallel map → list
    process(item)
```

### MCP Tool Calls

```orchid
@requires MCP("filesystem")
content := filesystem:read_text_file(path="README.md")
filesystem:write_file(path="out.md", content=result)
```

### Index Access

```orchid
items := [10, 20, 30]
first := items[0]                     # list indexing (supports negative: items[-1])
d := {name: "alice", age: 30}
val := d["name"]                      # dict key access
ch := "hello"[0]                      # string character access
```

### Bracket-Count Syntax

Some macros accept a count parameter: `Debate[3]("topic")`, `Brainstorm[10]("ideas")`. See specification.md §5.6.

### Tags (Behavior Modifiers)

```orchid
CoT("analysis")<deep>                 # thoroughness
Search("topic")<retry=3, timeout=30s>  # resilience
mode := "deep"
CoT("analysis")<$mode>                # dynamic tag resolution from variable
```

## Conventions

- Source is TypeScript, compiled to CommonJS (ES2022 target)
- All async operations use `async/await`
- Tests use Jest with `ts-jest` preset
- No external runtime dependencies beyond Anthropic SDK, MCP SDK, and Zod
- Status/progress output goes to stderr; script results go to stdout
- Dict keys in Orchid are unquoted identifiers: `{name: "value"}` not `{"name": "value"}`
- `ORCHID_PATH` env var is searched for shared import libraries (colon-separated directories)
- Agent `permissions:` blocks are enforced at runtime (namespace and action-level)
- `Save(content, path="file.txt")` writes to disk; `Save(content)` writes to stdout
- `Cost()` returns actual token count from the provider (0 for ConsoleProvider)
- `Benchmark()` returns a number (0.0–1.0); `Validate()` returns a boolean; `Elapsed()` returns milliseconds as a number
- `Confidence()` uses a hybrid model: 50% provider score + 50% runtime signals (retries, errors, sources, CoVe, fork agreement)
- `<backoff>` tag enables exponential delay between retries (e.g., `<retry=3, backoff>`)
- `list[0]`, `dict["key"]`, `string[0]` subscript access is supported (including negative indexing)
- `DataUnavailable`, `LowConfidence`, `ContextOverflow` errors are thrown at runtime

## Common Tasks

**Add a new reasoning macro:** Add its name to `BUILTIN_MACROS` in `builtins.ts`, add its system prompt to `OPERATION_PROMPTS` in `claude-provider.ts`.

**Add a new MCP server to the registry:** Add an entry to `MCP_REGISTRY` in `mcp-registry.ts`.

**Add a new CLI flag:** Register it in `flagsWithValues` (if it takes a value), add it to `USAGE` string, and wire it in `main()` — all in `cli.ts`.

**Write a new example:** Create a `.orch` file in `examples/`. Must start with `@orchid 0.1`. Verify it parses with `node dist/cli.js --parse examples/your_file.orch`.
