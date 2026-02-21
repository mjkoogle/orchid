# Orchid: AI Orchestration Language

### A Cognitive Choreography Language for LLM Agent Orchestration

**Version:** 0.1.0
**Author:** Mike Koogle
**Status:** RFC

---

## Abstract

As AI agents become more capable and autonomous, we lack a human-readable, machine-executable language for orchestrating their behavior. Orchid is a lightweight, composable syntax that bridges natural language and procedural execution, enabling reliable agent workflows while remaining intuitive for humans to write and read.

Orchid is not a general-purpose programming language. It is a **cognitive choreography language**, designed to express *how an agent should think*, not just what it should compute. Traditional languages operate on data. Orchid operates on reasoning.

---

## At a Glance

Before diving into the full specification, here's what Orchid looks like in practice. This script researches a topic, verifies its findings, and produces a confidence-gated report - in 12 lines:

```orchid
@orchid 0.1
@name "Quick Research Brief"

sources := fork:
    academic: Search("quantum computing breakthroughs 2024")
    industry: Search("quantum computing commercial applications")

vetted := CoVe(sources)                           # verify claims against evidence
analysis := CoT(vetted)<deep>                      # chain-of-thought reasoning

if Confidence(analysis) > 0.7:
    Formal(analysis)<cite>                         # high confidence → rigorous report
else:
    ELI5(analysis) + Explain("uncertainty areas")  # low confidence → be transparent
```

Read it aloud. You don't need to be a programmer to understand what this agent will do: search two source categories in parallel, fact-check the results, think deeply about them, then choose an output format based on how confident it is. That's the point.

Orchid is not about controlling an LLM's API. It's about describing *how an agent should reason*.

---

## Design Principles

1. **Human-first readability.** A non-programmer should be able to read an Orchid file and understand the agent's intent.
2. **Implicit intelligence.** The agent is assumed to be capable. Orchid directs cognition, not micromanages it.
3. **Composability over complexity.** Small, orthogonal primitives that combine predictably.
4. **Graceful degradation.** Partial success is better than total failure. Confidence-aware execution is native.
5. **Transparency by default.** Reasoning is traceable unless explicitly suppressed.

---

## 1. Core Syntax

### 1.1 Sequential Execution

Line order implies execution order. Each line completes before the next begins.

```orchid
Search("quantum computing 2024")
CoT("analyze trends")
CoVe
ELI5
```

When an operation is invoked without arguments, it operates on the implicit context: the accumulated output of all preceding operations in the current scope.

### 1.2 Comments

```orchid
# Single-line comment

## Section heading (rendered in Trace output)

# Comments inside blocks are preserved in execution traces
```

### 1.3 String Interpolation

Variables are interpolated into strings with the `$` prefix. Braces are optional for simple names, required for expressions.

```orchid
name := "NVIDIA"
Search("$name quarterly earnings")
Search("${name} vs ${competitor} market share")
```

### 1.4 Implicit Context (`_`)

The underscore `_` refers to the output of the most recent operation, similar to `$?` in a shell. This is what operations receive when called with no arguments.

```orchid
Search("renewable energy trends")
CoT("summarize key findings from: $_")   # explicit reference
CoVe                                      # implicit: operates on _
ELI5                                      # implicit: operates on _
```

---

## 2. Variables and Assignment

### 2.1 The Walrus Operator

Orchid uses `:=` for assignment, borrowed from Python's walrus operator. This signals that assignment is a naming of an agent output, not a traditional variable store.

```orchid
results := Search("climate policy 2024")
summary := CoT("summarize $results")
report  := Formal(summary)
```

### 2.2 Destructuring

Fork operations and multi-return operations can be destructured.

```orchid
[tech, policy, market] := fork[3]:
    Search("battery technology")
    Search("energy policy")
    Search("EV market trends")
```

### 2.3 Collections

```orchid
sources := ["arxiv", "pubmed", "semantic_scholar"]
weights := {relevance: 0.7, recency: 0.3}
```

---

## 3. Blocks and Scope

### 3.1 Atomic Blocks

Triple hash marks (`###`) define atomic execution blocks. Everything inside executes as a single, uninterruptible train of thought with full context maintained. If any unhandled error occurs inside, the entire block rolls back.

Variables assigned inside an atomic block **are visible after the block closes**. The block controls execution atomicity, not variable scope. Think of it as a transaction: either all assignments commit or none do.

```orchid
###
sources := Search("renewable energy 2024")
vetted := CoVe(sources)
analysis := CoT("identify key trends in $vetted")
###

# analysis, vetted, and sources are all available here
report := Formal(analysis)
Save(report)
```

#### When to use atomic blocks:

**1. Coherent reasoning chains.** Outside a block, the runtime may checkpoint, yield, or interleave with other tasks. Inside, it won't.

```orchid
###
raw := Search("CRISPR clinical trials 2024")
claims := Extract(raw, schema="trial_name, phase, outcome")
verified := CoVe(claims)
gaps := Critique(verified)
supplemental := Search("$gaps")
final := Synthesize(verified + supplemental)
###

# 'final' was produced in one coherent pass.
if Confidence(final) > 0.7:
    report := Formal(final)<cite>
else:
    report := ELI5(final) + Explain("uncertainty")

fs:Write("crispr_report.md", report)
```

**2. All-or-nothing side effects.** If a block fails partway through, nothing leaks out.

```orchid
###
data := api:Fetch("/users")<timeout=10s>
transformed := CoT("normalize $data to schema v2")
db:Write("users_v2", transformed)
db:Delete("users_v1")
###
# If db:Delete fails, db:Write also rolls back.
# 'data' and 'transformed' are NOT available here on failure.

Log("migration completed successfully")
```

**3. Isolating speculative reasoning.** Wrap exploratory work so failure doesn't pollute the outer context.

```orchid
baseline := CoT("standard market analysis of $ticker")

try:
    ###
    alt_data := Search("$ticker Reddit sentiment")<best_effort>
    alt_signal := CoT("extract trading signals from $alt_data")<tentative>
    validated := CoVe(alt_signal)
    ###
    enriched := baseline + validated
except:
    enriched := baseline

report := Formal(enriched)
```

**4. Scoping private scratch work.** Tag intermediate steps `<private>` to keep them out of traces while exporting only the final result.

```orchid
###
brainstorm := Creative("approaches to $problem")<private>
ranked := Prioritize(brainstorm, criteria="feasibility")<private>
top_3 := Extract(ranked, schema="top 3 approaches")
###

# Only top_3 matters outside.
proposal := Formal(top_3)
slack:Send("#engineering", proposal)
```

### 3.2 Indentation

Python-style indentation defines structural relationships within control flow and nested operations.

```orchid
if Confidence() > 0.8:
    output := Formal(analysis)
    Save(output)
else:
    Search("additional sources")<urgent>
    Refine(analysis)
```

---

## 4. Operators

### 4.0 Operator Reference

#### Composition Operators

| Operator | Name        | Description                                          | Example                             |
|----------|-------------|------------------------------------------------------|-------------------------------------|
| `:=`     | Assign      | Assign operation output to a name                    | `x := Search("topic")`             |
| `+=`     | Append      | Merge a value into an existing variable              | `report += Creative("new angle")`   |
| `+`      | Add / Merge | Numeric addition; context-aware merge for strings, lists, dicts | `full := research + analysis` |
| `\|`     | Alternative | Try left; on failure or low confidence, try right    | `result := Search(a) \| Search(b)` |
| `>>`     | Pipe        | Pass left output as right input                      | `Search("topic") >> CoT >> ELI5`   |

#### Arithmetic Operators

| Operator | Name        | Description                                          | Example                             |
|----------|-------------|------------------------------------------------------|-------------------------------------|
| `*`      | Multiply    | Numeric multiplication; string concatenation         | `area := width * height`           |
| `/`      | Divide      | Numeric division; literal string removal             | `clean := raw / "unwanted text"`   |
| `-`      | Subtract    | Numeric subtraction; semantic string subtraction (LLM) | `trimmed := report - "methodology"` |

#### Comparison Operators

| Operator | Name                | Description                              | Example                       |
|----------|---------------------|------------------------------------------|-------------------------------|
| `==`     | Equal               | Test equality                            | `if status == "ready":`       |
| `!=`     | Not Equal           | Test inequality                          | `if error != null:`           |
| `>`      | Greater Than        | Numeric comparison                       | `if Confidence() > 0.8:`     |
| `<`      | Less Than           | Numeric comparison                       | `if score < threshold:`      |
| `>=`     | Greater or Equal    | Numeric comparison                       | `if count >= 10:`            |
| `<=`     | Less or Equal       | Numeric comparison                       | `if risk <= 0.3:`            |

#### Logical Operators

| Operator | Name  | Description                                    | Example                              |
|----------|-------|------------------------------------------------|--------------------------------------|
| `and`    | And   | Short-circuit logical AND                      | `if ready and valid:`                |
| `or`     | Or    | Short-circuit logical OR                       | `if cached or available:`            |
| `not`    | Not   | Logical negation                               | `if not done:`                       |

#### Containment Operator

| Operator | Name  | Description                                    | Example                              |
|----------|-------|------------------------------------------------|--------------------------------------|
| `in`     | In    | Test membership in list, string, or dict       | `if "postgres" in available:`        |

### 4.1 Add / Merge Semantics

The `+` operator has dual behavior depending on operand types. For numbers, it performs standard arithmetic addition. For all other types, it performs context-aware merging:

- **Numbers:** arithmetic addition (`3 + 4` → `7`)
- **Strings:** merge with paragraph separator (`a + b` → `"a\n\nb"`)
- **Lists:** concatenation (`[1,2] + [3,4]` → `[1,2,3,4]`)
- **Dicts:** merge (right overwrites duplicate keys)

Exact merge behavior for strings is implementation-defined; runtimes should document their strategy.

```orchid
market := CoT("market analysis")
technical := CoT("technical analysis")
report := market + technical   # Agent synthesizes both perspectives
total := subtotal + tax         # Arithmetic addition
```

### 4.2 Alternative Semantics

The `|` operator provides fallback chains. Each alternative is tried left-to-right until one succeeds or meets the confidence threshold.

```orchid
data := API:Fetch(url) | Cache:Load(key) | Search("$query")<best_effort>
```

### 4.3 Arithmetic String Semantics

The `*`, `/`, and `-` operators have dual behavior depending on operand types.

**Multiply (`*`):** For numbers, standard multiplication. For strings, direct concatenation (no separator). Use `*` when you want literal joining; use `+` when you want the agent to synthesize.

```orchid
greeting := "Hello, " * name    # "Hello, Alice"
area := width * height           # 50
```

**Divide (`/`):** For numbers, standard division. For strings, literal removal — all occurrences of the right operand are removed from the left.

```orchid
clean := "the quick the fox" / "the "   # "quick fox"
half := total / 2                        # 50.0
```

**Subtract (`-`):** For numbers, standard subtraction. For strings, semantic subtraction — the LLM rewrites the left operand with the concepts/content described by the right operand removed, preserving coherence and flow.

```orchid
accessible := technical_report - "jargon and acronyms"
concise := draft - "redundant examples"
count := total - used
```

### 4.4 Operator Precedence

From lowest to highest precedence:

1. `>>` (pipe)
2. `|` (alternative)
3. `or` (logical or)
4. `and` (logical and)
5. `not` (logical not)
6. `==`, `!=`, `>`, `<`, `>=`, `<=` (comparison)
7. `in` (containment)
8. `+` (merge)
9. `*`, `/`, `-` (arithmetic)
10. Unary `-` (negation)

---

## 5. Reasoning Macros

Reasoning macros are named cognitive operations that shape *how the agent reasons*. Unlike functions that transform data, macros encode reusable patterns of thought.

### 5.1 Analysis Macros

| Macro              | Signature                     | Description                                             |
|--------------------|-------------------------------|---------------------------------------------------------|
| `CoT`              | `CoT(prompt?)`                | Chain-of-thought. Step-by-step deliberation.            |
| `CoVe`             | `CoVe(claim?)`                | Chain of Verification. Fact-check against evidence.     |
| `Decompose`        | `Decompose(problem)`          | Break a problem into enumerated sub-problems.           |
| `Classify`         | `Classify(input, categories)` | Categorize input into predefined categories.            |
| `Extract`          | `Extract(source, schema)`     | Pull structured data from unstructured input.           |
| `Compare`          | `Compare(a, b, criteria?)`    | Structured comparison across dimensions.                |
| `Timeline`         | `Timeline(events)`            | Temporal reasoning. Order, sequence, identify causality.|
| `Spatial`          | `Spatial(context)`            | Geographic or visual-spatial reasoning.                 |
| `Quantify`         | `Quantify(claim)`             | Attach numbers, ranges, or magnitudes to claims.        |

### 5.2 Critique Macros

| Macro              | Signature                     | Description                                             |
|--------------------|-------------------------------|---------------------------------------------------------|
| `Critique`         | `Critique(work)`              | Self-criticism. Identify weaknesses, gaps, errors.      |
| `RedTeam`          | `RedTeam(plan)`               | Adversarial analysis. Find failure modes.               |
| `Steelman`         | `Steelman(argument)`          | Construct the strongest version of an argument.         |
| `DevilsAdvocate`   | `DevilsAdvocate(position)`    | Argue against a position regardless of agreement.       |
| `Counterfactual`   | `Counterfactual(scenario)`    | What-if analysis. Explore alternate outcomes.           |
| `Validate`         | `Validate(output, criteria)`  | Check output against explicit acceptance criteria.      |

### 5.3 Synthesis Macros

| Macro              | Signature                     | Description                                             |
|--------------------|-------------------------------|---------------------------------------------------------|
| `Refine`           | `Refine(draft, n?)`           | Iterative improvement. Optional pass count.             |
| `Consensus`        | `Consensus(perspectives)`     | Find common ground across multiple perspectives.        |
| `Debate`           | `Debate[n](proposition)`      | n-viewpoint argumentation. Generate and resolve.        |
| `Synthesize`       | `Synthesize(sources)`         | Combine disparate information into unified output.      |
| `Reconcile`        | `Reconcile(conflicts)`        | Resolve contradictions between sources or analyses.     |
| `Prioritize`       | `Prioritize(items, criteria)` | Rank items by importance given criteria.                |

### 5.4 Communication Macros

| Macro              | Signature                     | Description                                             |
|--------------------|-------------------------------|---------------------------------------------------------|
| `ELI5`             | `ELI5(content)`               | Simplify for general audience. Remove jargon.           |
| `Formal`           | `Formal(content)`             | Technical, rigorous mode. Precise terminology.          |
| `Analogize`        | `Analogize(concept, domain?)` | Explain via comparison. Optional target domain.         |
| `Socratic`         | `Socratic(topic)`             | Question-based exploration. Generate probing questions. |
| `Narrate`          | `Narrate(data)`               | Transform data/analysis into narrative form.            |
| `Translate`        | `Translate(content, audience)`| Adapt content for a specific audience.                  |

### 5.5 Generative Macros

| Macro              | Signature                     | Description                                             |
|--------------------|-------------------------------|---------------------------------------------------------|
| `Creative`         | `Creative(prompt)`            | Divergent thinking. Novel ideas without constraints.    |
| `Brainstorm`       | `Brainstorm[n](topic)`        | Generate n distinct ideas. Quantity over quality.       |
| `Abstract`         | `Abstract(specifics)`         | Extract general principles from specific instances.     |
| `Ground`           | `Ground(abstraction)`         | Connect abstract concepts to concrete examples.         |
| `Reframe`          | `Reframe(problem)`            | Approach from a fundamentally different angle.          |

### 5.6 Custom Macro Definition

Macros extend the standard library with reusable, parameterized cognitive patterns. Tags can be applied at **definition time** (defaults for every invocation) or at **call site** (per-invocation override).

Tag resolution rules:
- Call-site tags from different categories than definition tags are **additive**. A macro defined `<pure>` and called `<private>` gets both.
- Call-site tags that conflict with definition tags **override**. A macro defined `<deep>` and called `<quick>` runs as `<quick>`. The caller knows their context best.
- Definition tags not contradicted by the call site are **inherited**.

```orchid
# Definition-time tags set defaults
macro ThreatModel(system)<pure>:
    surface := Decompose("attack surface of $system")
    threats := RedTeam(surface)
    ranked := Prioritize(threats, criteria="likelihood * impact")
    mitigations := CoT("mitigation strategies for $ranked")
    return Formal(mitigations)

# Call-site tags augment definition-time tags
result := ThreatModel(spec)                # inherits <pure>
result := ThreatModel(spec)<deep>          # adds <deep>, keeps <pure>
result := ThreatModel(spec)<quick, private> # quick pass, suppress from logs
```

```orchid
# Private scratch work macro: never logged by default
macro Spitball(problem)<private, tentative>:
    ideas := Brainstorm[10](problem)
    filtered := Prioritize(ideas, criteria="novelty * feasibility")
    return Extract(filtered, schema="top 3 ideas")

# Caller can override privacy
keeper := Spitball("how to reduce API latency")<verbose>
```

---

## 6. Tags (Behavior Modifiers)

Tags modify the execution behavior of any operation. They are appended inline using angle brackets.

```orchid
Operation("args")<tag>
Operation("args")<tag1, tag2>
```

### 6.1 Execution Tags

| Tag              | Description                                                              |
|------------------|--------------------------------------------------------------------------|
| `<urgent>`       | Prioritize speed over thoroughness. Skip non-essential verification.     |
| `<quick>`        | Abbreviated reasoning. Concise result, no deep analysis.                 |
| `<deep>`         | Exhaustive analysis. Explore edge cases, consider multiple framings.     |
| `<best_effort>`  | Accept partial or degraded results rather than failing.                  |
| `<tentative>`    | Low confidence acceptable. Mark output as provisional.                   |
| `<strict>`       | Zero tolerance for ambiguity. Fail rather than assume.                   |

### 6.2 Reliability Tags

| Tag              | Description                                                              |
|------------------|--------------------------------------------------------------------------|
| `<retry>`        | Retry on failure. `<retry=3>` for max attempts, `<retry=3, backoff>`.   |
| `<timeout=Ns>`   | Abort and return partial results after N seconds.                        |
| `<pure>`         | No side effects. Safe to re-execute; runtime may cache and deduplicate.  |
| `<cached>`       | Use cached results if available and fresh.                               |
| `<fallback=X>`   | On failure, substitute value X.                                          |

### 6.3 Output Tags

| Tag              | Description                                                              |
|------------------|--------------------------------------------------------------------------|
| `<private>`      | Suppress from logs, traces, and persisted output.                        |
| `<silent>`       | Execute without emitting visible output. Side effects still apply.       |
| `<verbose>`      | Include full reasoning trace in output, not just the conclusion.         |
| `<raw>`          | Return unprocessed output. Skip default formatting/summarization.        |
| `<cite>`         | Require source attribution for all claims.                               |

### 6.4 Composition Tags

| Tag              | Description                                                              |
|------------------|--------------------------------------------------------------------------|
| `<append>`       | Add to existing context rather than replacing it.                        |
| `<isolated>`     | Execute without access to surrounding context. Clean-room reasoning.     |
| `<frozen>`       | Lock this output. Downstream operations cannot modify it.                |

---

## 7. Control Flow

### 7.1 Conditionals

```orchid
if Confidence() > 0.8:
    Formal(analysis)
elif Confidence() > 0.5:
    ELI5(analysis) + Explain("uncertainty areas")
else:
    Debate[2]("competing interpretations")
```

### 7.2 Loops

```orchid
# Standard for loop
for source in ["arxiv", "pubmed", "ieee"]:
    results := Search("$query site:$source")
    Validate(results)

# While loop with condition
while Confidence() < 0.7:
    Search("additional evidence")<append>
    Refine(analysis)

# Until loop: goal-directed iteration
until Validate(output, criteria="complete and cited"):
    gaps := Critique(output)
    Search("$gaps")<append>
    output := Refine(output)
```

### 7.3 Parallel Execution (Fork)

Fork executes multiple operations concurrently and collects results.

```orchid
# Basic fork: returns ordered array
results := fork[3]:
    Search("battery technology 2024")
    Search("charging infrastructure")
    Search("consumer EV sentiment")

synthesis := Consensus(results)
```

```orchid
# Named fork: returns named map
data := fork:
    market: Search("EV market data")
    tech: Search("battery R&D breakthroughs")
    policy: Search("EV policy incentives")

report := CoT("correlate $data.market with $data.policy")
```

### 7.4 Error Handling

```orchid
try:
    data := API:Fetch(endpoint)
    analysis := CoT(data)
except Timeout:
    data := Cache:Load("last_known")<best_effort>
    analysis := CoT(data) + Explain("using cached data")
except DataUnavailable:
    analysis := CoT("work with available context only")<tentative>
finally:
    Log("analysis_attempt", status=Confidence())
```

### 7.5 Guard Clauses

```orchid
# Assert halts execution if condition is false
assert Confidence() > 0.3, "Insufficient confidence to proceed"
assert len(sources) > 0, "No sources found"

# Require ensures a capability is available before proceeding
require MCP("database"), "Database connection required"
```

---

## 8. Meta Operations

Meta operations provide introspection and control over execution.

| Operation           | Signature                        | Description                                              |
|---------------------|----------------------------------|----------------------------------------------------------|
| `Explain`           | `Explain(step)`                  | Justify reasoning for a specific step or decision.       |
| `Confidence`        | `Confidence(scope?)`             | Self-assess certainty (0.0-1.0). Optional scope.        |
| `Benchmark`         | `Benchmark(output, metric)`      | Evaluate output quality against named criteria.          |
| `Trace`             | `Trace(depth?)`                  | Emit execution history. Depth controls granularity.      |
| `Checkpoint`        | `Checkpoint(label?)`             | Save current agent state for potential rollback.         |
| `Rollback`          | `Rollback(target)`               | Revert to a checkpoint by label or step count.           |
| `Reflect`           | `Reflect(process)`               | Meta-cognitive review of the agent's own approach.       |
| `Cost`              | `Cost()`                         | Report estimated token/compute cost so far.              |
| `Elapsed`           | `Elapsed()`                      | Wall-clock time since execution began.                   |

```orchid
Checkpoint("pre_analysis")

analysis := CoT("complex multi-factor analysis")<deep>

if Benchmark(analysis, "completeness") < 0.6:
    Rollback("pre_analysis")
    Search("additional context")<append>
    analysis := CoT("retry with broader context")<deep>

Explain(analysis)
```

### 8.0.1 Reflect in Practice

`Reflect` performs meta-cognitive review: the agent evaluates its *own reasoning process*, not just the output. This produces structured self-assessment that can feed back into the workflow.

```orchid
# First pass at a recommendation
analysis := CoT("evaluate $candidate for the role")<deep>

# Agent reflects on its own reasoning
review := Reflect(analysis)
# Reflect output is structured:
#   - approach_taken: "Weighted technical skills heavily, underweighted culture fit"
#   - blind_spots: ["No consideration of team dynamics", "Assumed remote-only"]
#   - confidence_drivers: ["Strong resume match", "Weak on behavioral signals"]
#   - suggested_improvements: ["Interview for collaboration style", "Check references"]

# Use reflection to improve the analysis
if review.blind_spots:
    supplemental := Search("$review.blind_spots")<deep>
    analysis := Refine(analysis + supplemental)
```

`Reflect` differs from `Critique` in an important way: `Critique` evaluates the *quality of an output*. `Reflect` evaluates the *quality of the reasoning that produced it*. Use `Critique` to ask "is this good?" and `Reflect` to ask "did I think about this the right way?"

### 8.1 How Confidence Works

Orchid uses a hybrid confidence model. The agent proposes a confidence score based on its own assessment, and the runtime adjusts that score using observable signals.

**Agent-side signals** (subjective):
- How well the agent feels it understood the query
- Whether it had to guess, infer, or hedge
- Self-assessed completeness of its response

**Runtime-side signals** (objective):
- Source count and diversity (more independent sources = higher confidence)
- CoVe pass rate (how many claims survived verification)
- Fork branch agreement (did parallel analyses converge or diverge?)
- Data freshness (cached results degrade confidence over time)
- Error history (retries and fallbacks in the current scope lower confidence)

The final `Confidence()` value is a weighted blend. Runtimes must document their weighting strategy. When called with a scope argument, e.g. `Confidence(analysis)`, only signals relevant to that specific variable are considered.

```orchid
# Confidence is useful but imprecise. Treat it as a heuristic, not a guarantee.
# Design scripts to degrade gracefully across the full 0.0-1.0 range.
if Confidence() > 0.8:
    Formal(analysis)
elif Confidence() > 0.4:
    ELI5(analysis) + Explain("areas of uncertainty")
else:
    # Low confidence: seek more input rather than guessing
    Creative("what additional data would help")
```

---

## 9. MCP and Plugin Integration

Orchid has two mechanisms for extending functionality beyond the core language:

- **MCP** — connects to external tool servers that speak the Model Context Protocol. These are running processes (databases, APIs, file systems) that provide tools over a transport layer. Think of MCP as *infrastructure integration*.
- **Plugin** — runtime capability extensions that register named operations. Plugins are like skills: they run in-process, have access to the LLM provider, and expose operations through the `namespace:Operation()` interface. Think of Plugins as *skills that extend what Orchid can do*.

The key differences between the three extension mechanisms:

| Mechanism | What it is | Syntax | Scope |
|-----------|-----------|--------|-------|
| `import`  | Orchid code reuse | `import path as name` | Merges definitions into current scope |
| `Use MCP` | External tool server | `Use MCP("name")` | Namespaced, runs out-of-process |
| `Use Plugin` | Runtime capability | `Use Plugin("name")` | Namespaced, runs in-process with provider access |

### 9.1 Importing MCP Servers

```orchid
Use MCP("filesystem") as fs
Use MCP("postgres")
Use MCP("slack")
```

MCP servers are configured in `orchid.config.json` and connected at runtime. If a server is not configured, the runtime warns and falls back to simulated calls.

### 9.2 Plugins

Plugins are runtime capability extensions — modules that register named operations callable via `namespace:Operation()` syntax. Unlike MCP servers (external processes), plugins run in-process and have direct access to the LLM provider.

```orchid
Use Plugin("sentiment") as s
Use Plugin("web-scraper") as scraper
```

The runtime resolves plugins from:

1. A `plugins/` directory relative to the script
2. Paths listed in the `ORCHID_PLUGIN_PATH` environment variable

Plugins can be implemented in two ways:

#### JS/TS Plugins (Primary)

JS/TS plugins implement the `OrchidPlugin` interface and have full access to the runtime context, including the LLM provider. This is the primary plugin mechanism — it lets plugins leverage the provider for reasoning, search, and tool dispatch.

```typescript
// plugins/sentiment.js
const plugin = {
  name: 'sentiment',
  description: 'Sentiment analysis operations',

  // Called once when the plugin is loaded
  async setup(ctx) {
    // Initialize resources, validate config, etc.
  },

  // Called when the interpreter shuts down
  async teardown() {
    // Cleanup resources
  },

  operations: {
    async Analyze(args, ctx) {
      const text = valueToString(args.arg0);
      // Plugins can call back into the LLM provider
      return ctx.provider.execute('Classify', text, {
        categories: 'positive,negative,neutral'
      }, ctx.tags);
    },

    async Score(args, ctx) {
      const text = valueToString(args.arg0);
      return ctx.provider.execute('Quantify', text, {
        dimension: 'sentiment -1.0 to 1.0'
      }, ctx.tags);
    },
  },
};

module.exports = plugin;
```

**Plugin context** — every operation receives a `PluginContext` with:
- `provider` — the LLM provider (call reasoning operations, search, etc.)
- `implicitContext` — the current implicit context value (for pipe chains)
- `tags` — any tags attached to the invocation
- `trace(msg)` — emit a trace message

#### .orch Plugins (Convenience)

For simpler plugins that don't need provider access, `.orch` files work as a convenience. The file's exported agents and macros become the plugin's operations.

```orchid
# plugins/greeter.orch
@orchid 0.1
@name "Greeter Plugin"

agent Greet(name):
    return "Hello, $name!"

macro Shout(message):
    return "$message!!!"
```

#### Using Plugins

Both JS and .orch plugins use the same `namespace:Operation()` invocation syntax:

```orchid
Use Plugin("sentiment") as s
Use Plugin("greeter") as g

label := s:Analyze("I love this product!")
score := s:Score("The service was terrible")
greeting := g:Greet("World")
```

### 9.3 Tool Invocation

Both MCP servers and Plugins use the same `namespace:operation` syntax for invocation.

```orchid
data := fs:Read("/data/report.csv")
analysis := CoT(data)
postgres:Write("INSERT INTO reports VALUES ($analysis)")
slack:Send("#team", "Analysis complete: $analysis")
s:Analyze("The quarterly results look promising")
```

### 9.4 Tool Discovery

```orchid
available := Discover("MCP.*")

if "postgres" in available:
    results := postgres:Query("SELECT * FROM users")
else:
    Error("database_unavailable")
```

### 9.5 Dynamic Tool Loading

```orchid
if need_weather:
    Use MCP("weather-api")
    forecast := weather_api:Forecast(zip=90210)

if need_analysis:
    Use Plugin("sentiment") as s
    label := s:Analyze(text)
```

### 9.6 Tool Permissions

```orchid
# Declare required permissions upfront
permissions:
    fs: [read]
    postgres: [read, write]
    slack: [send]
```

---

## 10. Agent Composition

### 10.1 Agents vs. Macros

Both agents and macros are parameterized and callable. The distinction:

- **Macros** are pure cognitive transforms. They take input, reason over it, and return output. No side effects, no held state, no permissions. They extend the reasoning vocabulary.
- **Agents** are stateful, permissioned actors. They can hold long-running state, declare tool permissions, communicate with other agents via `emit`/`on`, and interact with external systems.

Rule of thumb: if it only thinks, it's a macro. If it acts on the world, it's an agent.

### 10.2 Agent Declaration

```orchid
agent Researcher(topic, depth="standard"):
    """Conducts structured research on a given topic."""
    permissions:
        web: [search, fetch]

    sources := fork:
        academic: Search("$topic site:arxiv.org")
        news: Search("$topic recent developments")
        technical: Search("$topic technical analysis")

    vetted := CoVe(sources)
    analysis := CoT(vetted)<$depth>

    if depth == "deep":
        analysis := RedTeam(analysis)
        analysis := Refine(analysis, n=2)

    return Formal(analysis)
```

### 10.3 Agent Invocation

```orchid
report := Researcher("quantum error correction", depth="deep")
```

### 10.4 Multi-Agent Pipelines

```orchid
agent Gatherer(topic):
    return Search(topic) >> CoVe >> Extract(_, schema="key_facts")

agent Analyst(data):
    return CoT(data) >> Critique >> Refine

agent Writer(analysis, tone):
    if tone == "technical":
        return Formal(analysis)
    else:
        return ELI5(analysis) >> Refine

# Pipeline
raw := Gatherer("CRISPR gene therapy 2024")
insights := Analyst(raw)
article := Writer(insights, tone="technical")
```

### 10.5 Agent-to-Agent Communication

Agents communicate through a lightweight event system built on four primitives:

| Primitive   | Description                                                          |
|-------------|----------------------------------------------------------------------|
| `emit`      | Broadcast a named event with a payload. Fire-and-forget.             |
| `on`        | Register a handler that runs each time a named event is received.    |
| `listen`    | Block until a single event (or external input) is received.          |
| `Stream`    | Produce an iterable of events from an external or internal source.   |

**Delivery guarantees:** At-least-once within a process. Events may be delivered more than once if the runtime retries after a handler failure. Handlers should be idempotent or use `Checkpoint` to guard against duplicate processing.

**Scope:** Events are process-local by default. All agents running in the same Orchid process can see each other's events. Cross-process eventing is not part of the core spec; runtimes may extend this via MCP or external message brokers.

**Buffering:** Events emitted while no handler is registered are buffered up to a runtime-defined limit (recommended default: 1000). Overflow drops the oldest event and increments a `DroppedEvents` counter visible via `Trace`.

**Event naming:** Event names are free-form identifiers. By convention, use PascalCase nouns (`Alert`, `DataReady`, `TaskComplete`).

```orchid
agent Monitor(feed):
    """Watches a data feed and alerts when thresholds are breached."""
    for event in Stream(feed):
        if event.severity > 0.7:
            emit Alert(event)   # Broadcast to any listening agent

agent Responder():
    """Listens for alerts and produces responses."""
    on Alert as event:
        response := CoT("triage: $event")<urgent>
        slack:Send("#incidents", response)
```

```orchid
# listen() blocks until it receives input (useful for interactive agents)
agent InteractiveHelper():
    while true:
        input := listen()
        if input == "quit":
            return
        response := CoT(input)
        emit Response(response)
```

---

## 11. Execution Model

### 11.1 Context Window

Every operation executes within an implicit **context window**: the accumulated knowledge from all prior operations in the current scope.

- Sequential operations grow the context linearly.
- Atomic blocks (`### ... ###`) maintain an isolated context that merges back on completion.
- Fork branches each receive a copy of the parent context; results merge on join.
- The `<isolated>` tag creates a clean-room context with no inherited state.

### 11.2 Execution Guarantees

| Guarantee             | Scope                                                              |
|-----------------------|--------------------------------------------------------------------|
| **Order**             | Sequential lines execute in order within a scope.                  |
| **Atomicity**         | `### ... ###` blocks complete fully or roll back entirely.         |
| **Isolation**         | Fork branches do not observe each other's intermediate states.     |
| **Purity**            | Operations tagged `<pure>` can be safely cached and retried by runtime. |
| **Graceful failure**  | `<best_effort>` operations never halt the pipeline.                |

### 11.3 Runtime Responsibilities

1. **Parsing** the Orchid source into an execution graph.
2. **Scheduling** operations (sequential, parallel, or event-driven).
3. **Context management**: maintaining, forking, and merging context windows.
4. **Tool dispatch**: routing MCP/Plugin calls to external services.
5. **Confidence tracking**: maintaining a running confidence score.
6. **Trace logging**: recording execution history unless suppressed.

---

## 12. Error Model

### 12.1 Error Types

| Error                 | Trigger                                                          |
|-----------------------|------------------------------------------------------------------|
| `Timeout`             | Operation exceeds `<timeout=Ns>` or system default.              |
| `DataUnavailable`     | External data source is unreachable or returns empty.            |
| `LowConfidence`       | Confidence drops below a required threshold.                     |
| `ValidationError`     | `Validate` or `assert` fails.                                   |
| `PermissionDenied`    | Tool invocation exceeds declared permissions.                    |
| `ToolNotFound`        | Requested MCP/Plugin is not available.                           |
| `ContextOverflow`     | Context window exceeds capacity.                                 |
| `CyclicDependency`    | Execution graph contains an unresolvable cycle.                  |

### 12.2 Error Propagation

Errors propagate up the scope chain unless caught by `try/except`. Within atomic blocks, any unhandled error triggers a full rollback.

```orchid
###
try:
    critical_operation()
except ContextOverflow:
    Summarize(_)<quick>   # Compress context and retry
    critical_operation()
###
```

### 12.3 Retry Limits and Fallback

Validation loops and retry patterns should always include an upper bound to prevent infinite execution. The `<retry=N>` tag and `<fallback=X>` tag work together for this purpose.

```orchid
# Explicit retry with fallback on exhaustion
report := Validate(draft, criteria="all claims cited")<retry=3, fallback=draft>

# The above is syntactic sugar for:
_attempts := 0
report := draft
while _attempts < 3:
    if Validate(report, criteria="all claims cited"):
        break
    report := Refine(report)
    _attempts += 1
else:
    report := draft   # fallback: use the original if we can't fix it
```

For `until` loops that use `Validate` as a termination condition, always pair with a `<retry=N>` tag or an explicit counter to guarantee termination:

```orchid
# GOOD: bounded refinement loop
until Validate(draft, criteria="complete and cited")<retry=5>:
    gaps := Critique(draft)
    Search("$gaps")<append>
    draft := Refine(draft)

# If validation hasn't passed after 5 iterations, the runtime raises
# a ValidationError which can be caught by a surrounding try/except.
```

When `<retry=N>` is exhausted:
- If `<fallback=X>` is present, the operation returns X silently.
- If `<best_effort>` is tagged, the operation returns the last attempted result with degraded confidence.
- Otherwise, a `ValidationError` is raised.

---

## 13. File Structure Conventions

### 13.1 File Extension

Orchid files use the `.orch` extension.

### 13.2 File Header (The `@` Prefix)

The `@` prefix denotes file-level metadata declarations. These must appear at the top of the file, before any executable statements. The runtime uses them for validation, documentation, and dependency resolution.

| Directive        | Required | Description                                              |
|------------------|----------|----------------------------------------------------------|
| `@orchid`           | Yes      | Orchid spec version this file targets.                      |
| `@name`          | No       | Human-readable name for the script.                      |
| `@author`        | No       | Author attribution.                                      |
| `@description`   | No       | Brief summary of what the script does.                   |
| `@requires`      | No       | MCP servers or Plugins the script depends on. Runtime should verify availability before execution. |

```orchid
@orchid 0.1
@name "Stock Analysis Pipeline"
@author "Mike"
@description "Automated financial analysis with confidence gating"
@requires MCP("financial-data"), MCP("filesystem"), Plugin("sentiment-analysis")
```

### 13.3 Imports and Composability

Orchid files can import macros and agents from other `.orch` files, enabling reusable libraries of reasoning patterns.

```orchid
import macros/threat_model.orch as ThreatModel
import agents/researcher.orch as Researcher
```

**Import resolution:** Paths are relative to the importing file. Runtimes may also support a library path (e.g., `ORCHID_PATH` environment variable) for shared macro collections.

**What can be imported:** Only top-level `macro` and `agent` definitions are exported from a file. Variables, inline operations, and metadata are private to the defining file.

```orchid
# File: lib/analysis.orch
# This file exports two macros that other scripts can import.

macro QuickScan(topic):
    """Lightweight research: search, verify, summarize."""
    raw := Search("$topic")<quick>
    vetted := CoVe(raw)
    return ELI5(vetted)

macro DeepDive(topic):
    """Thorough research with adversarial review."""
    raw := Search("$topic")<deep>
    vetted := CoVe(raw)
    analysis := CoT(vetted)<deep>
    challenged := RedTeam(analysis)
    return Formal(Reconcile(analysis + challenged))<cite>
```

```orchid
# File: reports/weekly.orch
# Imports and uses the library above.

@orchid 0.1
@name "Weekly Tech Brief"
@requires MCP("filesystem")

import lib/analysis.orch as analysis
Use MCP("filesystem") as fs

topics := ["AI regulation", "quantum computing", "semiconductor supply chain"]

briefs := fork:
    for topic in topics:
        analysis:DeepDive(topic)

report := Synthesize(briefs)
fs:Write("reports/weekly_brief.md", Formal(report))
```

**Namespace scoping:** Imported names are accessed via their alias (`analysis:DeepDive`). This prevents collisions when importing from multiple libraries.

---

## 14. Complete Examples

### 14.1 Financial Analysis Pipeline

```orchid
@orchid 0.1
@name "NVDA Deep Dive"
@requires MCP("financial-data"), MCP("news-api"), MCP("filesystem")

Use MCP("financial-data") as fin
Use MCP("news-api") as news
Use MCP("filesystem") as fs

###
# Phase 1: Data Collection
try:
    prices := fin:Historical("NVDA", days=90)
except DataUnavailable:
    prices := fin:Historical("NVDA", days=30)<best_effort>

headlines := news:Search("NVIDIA semiconductor AI chips")
filings := news:Search("NVIDIA SEC filing 10-K 10-Q")

# Phase 2: Multi-Angle Analysis
trends := CoT("analyze price patterns and momentum in $prices")
sentiment := CoT("analyze market sentiment from $headlines")
fundamentals := CoT("extract key financial metrics from $filings")

# Phase 3: Synthesis
combined := trends + sentiment + fundamentals
analysis := Consensus(combined)

# Phase 4: Adversarial Review
weaknesses := RedTeam(analysis)
refined := Reconcile(analysis + weaknesses)

# Phase 5: Confidence-Gated Output
confidence := Confidence()

if confidence > 0.8:
    thesis := Formal(refined)
elif confidence > 0.5:
    thesis := ELI5(refined) + Explain("key uncertainty areas")
else:
    thesis := Debate[3]("bull case vs bear case vs neutral")
    thesis += Creative("what additional data would resolve uncertainty")

fs:Write("analysis/nvda_report.md", thesis)<private>
###
```

### 14.2 Research Agent with Iterative Refinement

```orchid
@orchid 0.1
@name "Deep Research Agent"

agent DeepResearch(question):
    ## Decompose
    sub_questions := Decompose(question)

    ## Investigate each sub-question in parallel
    findings := fork:
        for q in sub_questions:
            Search("$q") >> CoVe >> Extract(_, schema="claims_with_evidence")

    ## Synthesize and critique
    draft := Synthesize(findings)
    holes := Critique(draft)

    ## Fill gaps
    until Validate(draft, criteria="all sub-questions addressed"):
        supplemental := Search("$holes")<deep>
        draft := Refine(draft + supplemental)
        holes := Critique(draft)

    ## Final output
    Steelman(draft)
    return Formal(draft)<cite>

# Run it
report := DeepResearch("What are the technical barriers to room-temperature superconductors?")
```

### 14.3 Threat Modeling Workflow

```orchid
@orchid 0.1
@name "Threat Model Generator"
@requires MCP("filesystem")

Use MCP("filesystem") as fs

macro ThreatModel(system_description):
    ## Map the attack surface
    components := Decompose("components and interfaces of $system_description")
    surface := CoT("identify entry points and trust boundaries in $components")

    ## Generate threats (STRIDE-based)
    threats := fork:
        spoofing: RedTeam("spoofing attacks against $surface")
        tampering: RedTeam("tampering attacks against $surface")
        repudiation: RedTeam("repudiation risks in $surface")
        info_disc: RedTeam("information disclosure in $surface")
        dos: RedTeam("denial of service against $surface")
        priv_esc: RedTeam("privilege escalation in $surface")

    ## Assess and prioritize
    all_threats := Synthesize(threats)
    ranked := Prioritize(all_threats, criteria="likelihood * impact")

    ## Generate mitigations
    mitigations := CoT("concrete mitigations for top 10 threats in $ranked")
    mitigations := Validate(mitigations, criteria="each threat has at least one mitigation")

    return Formal(ranked + mitigations)

# Run against a system
spec := fs:Read("docs/architecture.md")
report := ThreatModel(spec)
fs:Write("security/threat_model.md", report)
```

### 14.4 Interactive Tutoring Agent

```orchid
@orchid 0.1
@name "Adaptive Tutor"

agent Tutor(subject, student_level="intermediate"):
    ## Assess starting point
    assessment := Socratic("$subject fundamentals")

    ## Adapt to student
    until student_signals_done:
        question := listen()

        understanding := Classify(question, [
            "conceptual_confusion",
            "wants_deeper_detail",
            "needs_analogy",
            "ready_to_advance"
        ])

        if understanding == "conceptual_confusion":
            ELI5(question) >> Analogize(_, domain="everyday life")
        elif understanding == "wants_deeper_detail":
            CoT(question)<deep> >> Formal(_)
        elif understanding == "needs_analogy":
            Analogize(question)
            Ground(_)
        elif understanding == "ready_to_advance":
            next_topic := CoT("what should $student_level learn next about $subject")
            Socratic(next_topic)
```

---

## 15. Grammar (EBNF)

```ebnf
program        ::= header? statement*
header         ::= metadata+
metadata       ::= '@' IDENTIFIER value NEWLINE

statement      ::= assignment | operation | control | atomic_block
                  | agent_def | macro_def | import_stmt | use_stmt
                  | emit_stmt | on_stmt | comment

assignment     ::= (IDENTIFIER | destructure) ':=' expression
                 | IDENTIFIER '+=' expression
destructure    ::= '[' IDENTIFIER (',' IDENTIFIER)* ']'

expression     ::= pipe_expr
pipe_expr      ::= alt_expr ('>>' alt_expr)*
alt_expr       ::= or_expr ('|' or_expr)*
or_expr        ::= and_expr ('or' and_expr)*
and_expr       ::= not_expr ('and' not_expr)*
not_expr       ::= 'not' not_expr | cmp_expr
cmp_expr       ::= in_expr (cmp_op in_expr)?
cmp_op         ::= '==' | '!=' | '>' | '<' | '>=' | '<='
in_expr        ::= merge_expr ('in' merge_expr)?
merge_expr     ::= arith_expr ('+' arith_expr)*
arith_expr     ::= unary_expr (('*' | '/' | '-') unary_expr)*
unary_expr     ::= '-' unary_expr | postfix_expr
postfix_expr   ::= primary ('.' IDENTIFIER | '(' args? ')' | '[' expression ']')*
primary        ::= operation | IDENTIFIER | literal | '(' expression ')'
                 | listen_expr | stream_expr

operation      ::= IDENTIFIER '(' args? ')' tags?
               |   IDENTIFIER tags?
               |   namespace ':' IDENTIFIER '(' args? ')' tags?

args           ::= arg (',' arg)*
arg            ::= expression | IDENTIFIER '=' expression

tags           ::= '<' tag (',' tag)* '>'
tag            ::= IDENTIFIER ('=' value)?

atomic_block   ::= '###' NEWLINE statement* '###'

control        ::= if_stmt | for_stmt | while_stmt | until_stmt
               |   try_stmt | assert_stmt | require_stmt

if_stmt        ::= 'if' expression ':' suite ('elif' expression ':' suite)* ('else' ':' suite)?
for_stmt       ::= 'for' IDENTIFIER 'in' expression ':' suite
while_stmt     ::= 'while' expression ':' suite
until_stmt     ::= 'until' expression ':' suite
try_stmt       ::= 'try' ':' suite ('except' IDENTIFIER ':' suite)* ('finally' ':' suite)?

assert_stmt    ::= 'assert' expression (',' STRING)?
require_stmt   ::= 'require' expression (',' STRING)?

emit_stmt      ::= 'emit' IDENTIFIER '(' expression? ')'
on_stmt        ::= 'on' IDENTIFIER 'as' IDENTIFIER ':' suite
listen_expr    ::= 'listen' '(' ')'
stream_expr    ::= 'Stream' '(' expression ')'

suite          ::= NEWLINE INDENT statement+ DEDENT

agent_def      ::= 'agent' IDENTIFIER '(' params? ')' ':' docstring? permissions? suite
macro_def      ::= 'macro' IDENTIFIER '(' params? ')' tags? ':' suite

permissions    ::= 'permissions' ':' NEWLINE INDENT perm_line+ DEDENT
perm_line      ::= IDENTIFIER ':' list NEWLINE

import_stmt    ::= 'import' path ('as' IDENTIFIER)?
use_stmt       ::= 'Use' ('MCP' | 'Plugin') '(' STRING ')' ('as' IDENTIFIER)?

fork_expr      ::= 'fork' ('[' INTEGER ']')? ':' NEWLINE INDENT fork_body DEDENT
fork_body      ::= statement+
               |   (IDENTIFIER ':' statement NEWLINE)+
               |   for_stmt

literal        ::= STRING | NUMBER | BOOLEAN | collection
collection     ::= list | dict
list           ::= '[' (expression (',' expression)*)? ']'
dict           ::= '{' (IDENTIFIER ':' expression (',' IDENTIFIER ':' expression)*)? '}'

comment        ::= '#' TEXT NEWLINE
section        ::= '##' TEXT NEWLINE

namespace      ::= IDENTIFIER
params         ::= param (',' param)*
param          ::= IDENTIFIER ('=' expression)?
docstring      ::= '"""' TEXT '"""'
```

---

## 16. Design Rationale

### Why not Python / YAML / JSON?

- **Python** buries cognitive intent in API plumbing. `response = llm.chat("think step by step...")` is code about an API call, not a description of reasoning.
- **YAML/JSON** have no flow control, no composition, and collapse at scale. They describe configuration, not cognition.
- **Prompt chaining frameworks** (LangChain, etc.) are libraries in host languages. They require programming environments and aren't readable by non-developers.

Orchid targets the gap: expressive enough for complex agent workflows, readable enough for a product manager to review.

### Why Reasoning Macros?

LLMs produce very different output depending on how they're prompted to think. "Analyze this" vs. "think step by step" vs. "what would a critic say" yield structurally different results. Reasoning macros give these cognitive strategies names, making the *how* of reasoning explicit and reproducible.

### Why Confidence as a Primitive?

Traditional programming assumes operations succeed or fail. Agent operations exist on a spectrum: a search might return relevant but inconclusive results; an analysis might be sound but built on incomplete data. Confidence-aware control flow lets scripts adapt to uncertainty instead of ignoring it.

---

## Future Considerations

Areas for exploration in future spec versions:

- **Structural type system.** Currently untyped. Lightweight types could catch errors early but may hurt readability. Deferred intentionally.
- **Cross-process events.** The event system (§10.5) is process-local. Distributed eventing via MCP or external brokers is a natural extension but needs its own spec.
- **Merge strategies.** The `+` operator is intentionally implementation-defined. If real-world usage reveals a need for explicit merge hints, a future version could introduce `+<synthesize>` vs. `+<concat>` syntax.
- **Confidence calibration.** The hybrid model (§8.1) leaves weighting to the runtime. Benchmarking across runtimes could produce recommended defaults.

---

## Appendix A: Reserved Words

```
if, elif, else, for, in, while, until, try, except, finally,
assert, require, agent, macro, import, as, Use, MCP,
Plugin, Discover, fork, emit, on, listen, Stream, return, and, or, not,
true, false, null, permissions
```

## Appendix B: Standard Library Macros

The following macros are available in all Orchid environments without import:

**Analysis:** CoT, CoVe, Decompose, Classify, Extract, Compare, Timeline, Spatial, Quantify
**Critique:** Critique, RedTeam, Steelman, DevilsAdvocate, Counterfactual, Validate
**Synthesis:** Refine, Consensus, Debate, Synthesize, Reconcile, Prioritize
**Communication:** ELI5, Formal, Analogize, Socratic, Narrate, Translate
**Generative:** Creative, Brainstorm, Abstract, Ground, Reframe
**Meta:** Explain, Confidence, Benchmark, Trace, Checkpoint, Rollback, Reflect, Cost, Elapsed

## Appendix C: Comparison with Existing Approaches

| Feature                    | Orchid  | Python + LangChain | YAML Configs | DSPy    |
|----------------------------|---------|---------------------|--------------|---------|
| Human-readable             | ✓       | ✗                   | ~            | ✗       |
| Reasoning as primitives    | ✓       | ✗                   | ✗            | ~       |
| Native confidence handling | ✓       | ✗                   | ✗            | ✗       |
| Composable agents          | ✓       | ~                   | ✗            | ~       |
| Parallel execution         | ✓       | ~                   | ✗            | ✗       |
| No programming required    | ✓       | ✗                   | ~            | ✗       |
| Tool integration (MCP)     | ✓       | ~                   | ~            | ✗       |
| Formal grammar             | ✓       | N/A                 | ✓            | ✗       |

---

*Orchid is an open specification. Contributions, feedback, and implementations are welcome.*
