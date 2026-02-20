<p align="center">
  <h1 align="center">🌸 Orchid</h1>
  <p align="center"><strong>A cognitive choreography language for LLM agent orchestration</strong></p>
  <p align="center">
    <a href="QUICKSTART.md">Quickstart</a> · <a href="docs/specification.md">Specification</a> · <a href="examples/">Examples</a> · <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</p>

---

Orchid is a lightweight, composable language for describing *how AI agents should think* - not just what they should compute. It bridges the gap between natural language prompts and procedural code, giving you human-readable scripts that are machine-executable.

```orchid
@orchid 0.1
@name "Quick Research Brief"

sources := fork:
    academic: Search("quantum computing breakthroughs 2024")
    industry: Search("quantum computing commercial applications")

vetted := CoVe(sources)                            # verify claims against evidence
analysis := CoT(vetted)<deep>                      # chain-of-thought reasoning

if Confidence(analysis) > 0.7:
    Formal(analysis)<cite>                         # high confidence → rigorous report
else:
    ELI5(analysis) + Explain("uncertainty areas")  # low confidence → be transparent
```

Read it aloud. You don't need to be a programmer to understand what this agent will do.

## Getting Started

### Install from npm
```bash
npm install -g orchid-lang
orchid examples/hello_world.orch
```
### From source
```bash
git clone https://github.com/mjkoogle/orchid.git
cd orchid && npm install && npm run build
node dist/cli.js examples/hello_world.orch
```

See the [Quickstart guide](QUICKSTART.md) for MCP setup and more.

## Why Orchid?

**The problem:** We're orchestrating increasingly sophisticated AI agents using either raw prompts (fragile, non-composable) or general-purpose programming languages (verbose, obscures intent). A product manager can't review a LangChain pipeline. A researcher can't reproduce a prompt chain from a Python script.

**The approach:** Orchid treats reasoning as a first-class primitive. Instead of writing code *about* API calls, you write scripts *about* cognition - with named reasoning strategies, confidence-aware control flow, and parallel execution built into the syntax.

| Feature | Orchid | Python + LangChain | YAML Configs | DSPy |
|---|---|---|---|---|
| Human-readable | ✓ | ✗ | ~ | ✗ |
| Reasoning as primitives | ✓ | ✗ | ✗ | ~ |
| Native confidence handling | ✓ | ✗ | ✗ | ✗ |
| Composable agents | ✓ | ~ | ✗ | ~ |
| Parallel execution | ✓ | ~ | ✗ | ✗ |
| No programming required | ✓ | ✗ | ~ | ✗ |
| Tool integration (MCP) | ✓ | ~ | ~ | ✗ |
| Formal grammar | ✓ | N/A | ✓ | ✗ |

## Key Concepts

### Reasoning Macros
Named cognitive operations that shape *how* an agent thinks. Not functions that transform data - patterns of thought.

```orchid
CoT("analyze market trends")          # chain-of-thought deliberation
CoVe(claims)                          # chain-of-verification fact-checking
RedTeam(plan)                         # adversarial analysis
ELI5(report)                          # simplify for general audience
Debate[3]("should we expand to EU?")  # 3-perspective argumentation
```

### Confidence-Aware Control Flow
Agent operations don't just succeed or fail - they exist on a spectrum. Orchid makes uncertainty a native concept.

```orchid
while Confidence() < 0.7:
    Search("additional evidence")<append>
    Refine(analysis)
```

### Parallel Execution
Fork operations run concurrently and collect results.

```orchid
data := fork:
    market: Search("EV market data")
    tech: Search("battery R&D breakthroughs")
    policy: Search("EV policy incentives")

report := Consensus(data)
```

### Tags (Behavior Modifiers)
Fine-grained control over how operations execute, without changing what they do.

```orchid
Search("topic")<deep, retry=3, timeout=30s>
CoT("sensitive analysis")<private, verbose>
Validate(output, criteria="complete")<retry=5, fallback=draft>
```

### MCP Tool Integration
First-class integration with the Model Context Protocol for external tool access. Use real MCP servers for filesystem, databases, web search, GitHub, and more.

```orchid
@requires MCP("filesystem")

tree := filesystem:directory_tree(path="src")
pkg := filesystem:read_text_file(path="package.json")
analysis := CoT("describe this project:\n$tree\n$pkg")
filesystem:write_file(path="/tmp/summary.md", content=analysis)
```

Install servers with one command:

```bash
node dist/cli.js mcp install filesystem brave-search memory github
```

## Examples

| Example | MCP Servers | Description |
|---|---|---|
| [`hello_world.orch`](examples/hello_world.orch) | none | Minimal: search, verify, reason, present |
| [`deep_research.orch`](examples/deep_research.orch) | none | Research agent with fork loops, self-critique, iterative refinement |
| [`fs_test.orch`](examples/fs_test.orch) | filesystem | Read project files, analyze codebase, write summary |
| [`threat_model.orch`](examples/threat_model.orch) | filesystem | STRIDE threat modeling from actual source code |
| [`financial_analysis.orch`](examples/financial_analysis.orch) | brave-search, filesystem | Live news search, multi-angle stock analysis, adversarial review |
| [`adaptive_tutor.orch`](examples/adaptive_tutor.orch) | memory | Assess understanding, build lesson plan, persist to knowledge graph |
| [`code_review.orch`](examples/code_review.orch) | github | Fetch PR, multi-angle review (correctness, security, design, testing) |

## Project Structure

```
orchid/
├── src/
│   ├── cli.ts                     # CLI entry point
│   ├── index.ts                   # Library exports
│   ├── lexer/                     # Tokenizer
│   ├── parser/                    # Recursive descent parser → AST
│   └── runtime/
│       ├── interpreter.ts         # Core execution engine
│       ├── claude-provider.ts     # Anthropic Claude LLM backend
│       ├── mcp-manager.ts         # MCP server connections
│       ├── mcp-registry.ts        # Built-in server catalog (12 servers)
│       └── ...                    # Environment, values, config, plugins, etc.
├── tests/                         # 12 test suites, 319+ tests
├── examples/                      # 7 runnable .orch scripts
├── docs/
│   ├── specification.md           # Full language spec with EBNF grammar
│   └── ARCHITECTURE.md            # Runtime architecture and data flow
├── QUICKSTART.md                  # 5-minute setup guide
├── CLAUDE.md                      # LLM context for AI assistants
├── CONTRIBUTING.md
└── LICENSE
```

## Specification

The complete language specification lives at [`docs/specification.md`](docs/specification.md). It covers:

- Core syntax, variables, and operators
- 30+ reasoning macros (analysis, critique, synthesis, communication, generative)
- Control flow including parallel fork/join
- Tag system for behavior modification
- Meta operations (confidence, checkpoints, reflection)
- MCP and plugin integration
- Agent composition and multi-agent pipelines
- Error model with retry/fallback semantics
- Formal EBNF grammar

## Status

Orchid v0.1.0 — the language design is stabilizing and the **reference interpreter is fully functional**.

**What works today:**
- Complete lexer, parser, and runtime interpreter
- 30+ reasoning macros powered by Claude API
- MCP tool integration with 12 built-in servers (filesystem, GitHub, Brave Search, memory, etc.)
- Parallel fork execution, confidence-gated control flow, agents and macros
- Sandbox mode with rate limiting and prompt sanitization
- Plugin system for JS/TS extensions
- npm registry search for discovering MCP servers
- Live terminal status spinner during execution
- 319+ tests across 12 test suites

**What's coming:** VS Code syntax highlighting, streaming responses, runtime benchmarks, more providers.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. The most valuable contributions right now:

- **Feedback on the spec** - Does the syntax make sense? What's confusing?
- **Real-world use cases** - What workflows would you write in Orchid?
- **New providers** - OpenAI, local models, etc.
- **Tooling** - Syntax highlighting, linters, formatters

## License

[MIT](LICENSE)

---

*Orchid is an open specification. Contributions, feedback, and implementations are welcome.*
