# Quickstart

Get Orchid running in under 5 minutes.

## 1. Install

```bash
git clone https://github.com/your-org/orchid.git
cd orchid
npm install
npm run build
```

## 2. Run Your First Script

```bash
node dist/cli.js examples/hello_world.orch
```

This uses the **console provider** — it prints what each operation *would* do without making any API calls. Great for learning the syntax.

You'll see output like:

```
  ✔ Search complete
  ✔ CoVe done
  ✔ CoT done
  ✔ Confidence: 0.75
  ✔ Formal done

=> [Formal result: processed "..."]
```

## 3. Use Claude (Real LLM)

Set your Anthropic API key and switch to the Claude provider:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node dist/cli.js --provider claude examples/hello_world.orch
```

Now reasoning macros call the Claude API. You'll see real analysis, real chain-of-thought reasoning, and real confidence-gated output.

## 4. Connect MCP Tools

MCP (Model Context Protocol) servers give your scripts access to filesystems, databases, web search, GitHub, and more.

### Quick setup: filesystem server

```bash
# Install the filesystem server config
node dist/cli.js mcp install filesystem

# Run a script that uses it
node dist/cli.js --provider claude examples/fs_test.orch
```

The `mcp install` command writes the server configuration to `orchid.config.json`. You can also install multiple servers at once:

```bash
node dist/cli.js mcp install filesystem memory brave-search
```

Or install everything a script needs:

```bash
node dist/cli.js mcp install examples/financial_analysis.orch
```

### See available servers

```bash
# Built-in registry (12 servers)
node dist/cli.js mcp list

# Search npm for community servers
node dist/cli.js mcp search database
```

## 5. Write Your Own Script

Create `my_script.orch`:

```orchid
@orchid 0.1
@name "My First Script"

# Search for a topic
data := Search("your topic here")

# Think about it
analysis := CoT(data)<deep>

# Critique your own work
gaps := Critique(analysis)

# Refine with the feedback
Refine(analysis + gaps)
```

Run it:

```bash
node dist/cli.js --provider claude my_script.orch
```

## 6. Key Flags

| Flag | What it does |
|------|-------------|
| `--provider claude` | Use real LLM (default is `console` — no API calls) |
| `--trace` | Show execution timeline |
| `--quiet` | Hide the status spinner |
| `--max-tokens 32768` | Allow longer responses (default: 16384) |
| `--parse` | Check syntax without executing |

## Examples by Complexity

| Start here | Then try | Advanced |
|------------|----------|----------|
| [`hello_world.orch`](examples/hello_world.orch) | [`fs_test.orch`](examples/fs_test.orch) | [`deep_research.orch`](examples/deep_research.orch) |
| Search + reason + present | Read files + analyze + write | Agents, fork loops, self-critique |
| No MCP needed | Needs `filesystem` | No MCP needed |
| | [`adaptive_tutor.orch`](examples/adaptive_tutor.orch) | [`threat_model.orch`](examples/threat_model.orch) |
| | Assessment + teaching + memory | STRIDE analysis with parallel fork |
| | Needs `memory` | Needs `filesystem` |

## Next Steps

- Read the [full specification](docs/specification.md) for the complete language reference
- Browse [examples/](examples/) for real-world patterns
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the runtime works
- Check [CONTRIBUTING.md](CONTRIBUTING.md) to get involved
