# Orchid Language Reference (for LLMs)

You are writing scripts in **Orchid**, a cognitive choreography language for LLM agent orchestration. Orchid describes *how an agent should think*, not just what to compute. Each reasoning macro (like `CoT`, `ELI5`, `RedTeam`) is an instruction to an LLM to perform a specific style of reasoning.

## Grammar (EBNF)

```ebnf
program        ::= header? statement*
header         ::= metadata+
metadata       ::= '@' IDENTIFIER value NEWLINE

statement      ::= assignment | operation | control | atomic_block
                  | agent_def | macro_def | comment

assignment     ::= (IDENTIFIER | destructure) ':=' expression
destructure    ::= '[' IDENTIFIER (',' IDENTIFIER)* ']'

expression     ::= operation | IDENTIFIER | literal | expression operator expression
                 | expression '[' expression ']'
operation      ::= IDENTIFIER '(' args? ')' tags?
               |   IDENTIFIER tags?
               |   IDENTIFIER '[' INTEGER ']' '(' args? ')' tags?

args           ::= arg (',' arg)*
arg            ::= expression | IDENTIFIER '=' expression

tags           ::= '<' tag (',' tag)* '>'
tag            ::= IDENTIFIER ('=' value)? | '$' IDENTIFIER

operator       ::= '+' | '-' | '*' | '/' | '|' | '>>' | '==' | '!=' | '>' | '<' | '>=' | '<=' | 'and' | 'or' | 'not' | 'in'

atomic_block   ::= '###' NEWLINE statement* '###'

control        ::= if_stmt | for_stmt | while_stmt | until_stmt
                 | try_stmt | assert_stmt

if_stmt        ::= 'if' expression ':' suite ('elif' expression ':' suite)* ('else' ':' suite)?
for_stmt       ::= 'for' IDENTIFIER 'in' expression ':' suite
while_stmt     ::= 'while' expression ':' suite
until_stmt     ::= 'until' expression ':' suite
try_stmt       ::= 'try' ':' suite ('except' IDENTIFIER? ':' suite)* ('finally' ':' suite)?
assert_stmt    ::= 'assert' expression (',' STRING)?

suite          ::= NEWLINE INDENT statement+ DEDENT

fork_expr      ::= 'fork' ('[' INTEGER ']')? ':' NEWLINE INDENT fork_body DEDENT
fork_body      ::= statement+
               |   (IDENTIFIER ':' statement NEWLINE)+
               |   for_stmt

agent_def      ::= 'agent' IDENTIFIER '(' params? ')' ':' suite
macro_def      ::= 'macro' IDENTIFIER '(' params? ')' tags? ':' suite

literal        ::= STRING | NUMBER | BOOLEAN | list | dict
list           ::= '[' (expression (',' expression)*)? ']'
dict           ::= '{' (IDENTIFIER ':' expression (',' IDENTIFIER ':' expression)*)? '}'

params         ::= param (',' param)*
param          ::= IDENTIFIER ('=' expression)?

comment        ::= '#' TEXT NEWLINE
section        ::= '##' TEXT NEWLINE
```

## Syntax Rules

- **Assignment** uses `:=` (walrus operator): `x := CoT("think about this")`
- **Indentation** is meaningful (Python-style, 4 spaces)
- **String interpolation** with `$`: `"Hello $name"` or `"Hello ${name}"`
- **Implicit context** `_`: the result of the most recent operation. Operations called with no arguments receive `_` automatically.
- **Index access**: `list[0]`, `dict["key"]`, `string[0]` (negative indices supported: `list[-1]`)
- **Comments**: `#` for single-line, `##` for section headings
- **Files** must start with `@orchid 0.1`

## Operators

| Op    | Name        | Meaning                                                |
|-------|-------------|--------------------------------------------------------|
| `:=`  | Assign      | Assign output to a name                                |
| `+=`  | Append      | Merge a value into an existing variable                |
| `+`   | Add/Merge   | Numeric add; semantic synthesis for strings (LLM)      |
| `-`   | Subtract    | Numeric subtract; semantic subtraction for strings     |
| `*`   | Multiply    | Numeric multiply; string concatenation                 |
| `/`   | Divide      | Numeric divide; literal string removal                 |
| `\|`  | Alternative | Try left; on failure, try right                        |
| `>>`  | Pipe        | Pass left output as right input                        |
| `==` `!=` `>` `<` `>=` `<=` | Comparison | Compare values              |
| `and` `or` `not` | Logical | Boolean logic                              |
| `in`  | Containment | Check membership                                       |

## Built-in Reasoning Macros

All macros take an optional string/context argument. Called without arguments, they operate on `_`.

**Analysis** (understand input):
- `CoT(prompt?)` - Chain-of-thought. Step-by-step deliberation.
- `CoVe(claim?)` - Chain of Verification. Fact-check against evidence.
- `Decompose(problem)` - Break into sub-problems.
- `Classify(input, categories)` - Categorize into predefined groups.
- `Extract(source, schema)` - Pull structured data from unstructured input.
- `Compare(a, b, criteria?)` - Structured comparison.
- `Timeline(events)` - Temporal reasoning and causality.
- `Spatial(context)` - Geographic/visual-spatial reasoning.
- `Quantify(claim)` - Attach numbers/ranges to claims.

**Critique** (challenge output):
- `Critique(work)` - Identify weaknesses, gaps, errors.
- `RedTeam(plan)` - Adversarial analysis. Find failure modes.
- `Steelman(argument)` - Construct the strongest version of an argument.
- `DevilsAdvocate(position)` - Argue against a position.
- `Counterfactual(scenario)` - What-if analysis.
- `Validate(output, criteria)` - Check against acceptance criteria.

**Synthesis** (combine perspectives):
- `Refine(draft, n?)` - Iterative improvement. Optional pass count.
- `Consensus(perspectives)` - Find common ground.
- `Debate[n](proposition)` - n-viewpoint argumentation.
- `Synthesize(sources)` - Combine into unified output.
- `Reconcile(conflicts)` - Resolve contradictions.
- `Prioritize(items, criteria)` - Rank by importance.

**Communication** (shape output):
- `ELI5(content)` - Simplify. Remove jargon.
- `Formal(content)` - Rigorous, precise terminology.
- `Analogize(concept, domain?)` - Explain via comparison.
- `Socratic(topic)` - Question-based exploration.
- `Narrate(data)` - Transform into narrative.
- `Translate(content, audience)` - Adapt for a specific audience.

**Generative** (create):
- `Creative(prompt)` - Divergent thinking.
- `Brainstorm[n](topic)` - Generate n distinct ideas.
- `Abstract(specifics)` - Extract general principles.
- `Ground(abstraction)` - Connect to concrete examples.
- `Reframe(problem)` - Approach from a different angle.

**Meta** (introspect):
- `Confidence(scope?)` - Self-assess certainty (0.0-1.0). Hybrid: 50% provider + 50% runtime signals.
- `Benchmark(output, metric)` - Evaluate output quality (returns 0.0-1.0).
- `Validate(output, criteria)` - Check against acceptance criteria (returns boolean).
- `Explain(step)` - Justify reasoning.
- `Reflect(process)` - Meta-cognitive review of own approach.
- `Trace(depth?)` - Emit execution history.
- `Cost()` - Token/compute cost so far.
- `Elapsed()` - Wall-clock milliseconds since execution began.
- `Checkpoint(label?)` / `Rollback(target)` - Save/restore state.

**Utility:**
- `Search(query)` - Search for information.
- `Summarize(content)` - Condense.
- `Log(message)` / `Error(message)` - Logging.
- `Save(content, path?)` - Persist output to file (or stdout if no path).

## Tags (Behavior Modifiers)

Appended to any operation with angle brackets:

```orchid
CoT("analysis")<deep>                  # exhaustive analysis
Search("topic")<retry=3, timeout=30s>  # retry on failure
CoT("query")<retry=3, backoff>         # exponential delay between retries
Validate(x)<strict>                    # zero tolerance for ambiguity
CoT("scratch work")<private>           # suppress from output
mode := "deep"
CoT("analysis")<$mode>                 # dynamic tag from variable
```

Common tags: `<deep>`, `<quick>`, `<urgent>`, `<best_effort>`, `<tentative>`, `<strict>`, `<retry=N>`, `<backoff>`, `<timeout=Ns>`, `<fallback=X>`, `<cached>`, `<pure>`, `<private>`, `<verbose>`, `<cite>`, `<append>`, `<isolated>`, `<frozen>`

Dynamic tags: Use `<$var>` to resolve a tag name from a variable at runtime.

## Parallel Execution (Fork)

```orchid
# Named branches -> dict
data := fork:
    market: Search("EV market data")
    tech: Search("battery R&D")
    policy: Search("EV policy")

# Parallel map -> list
results := fork:
    for item in items:
        CoT("analyze $item")
```

## Examples

### Minimal Script
```orchid
@orchid 0.1
@name "Hello World"

results := Search("latest breakthroughs in fusion energy")
vetted := CoVe(results)
analysis := CoT("summarize key developments in $vetted")

if Confidence(analysis) > 0.7:
    Formal(analysis)
else:
    ELI5(analysis)
```

### Research with Self-Critique
```orchid
@orchid 0.1
@name "Deep Research"

agent DeepResearch(question):
    sub_questions := Decompose(question)

    findings := fork:
        for q in sub_questions:
            Search("$q") >> CoVe >> Extract(_, schema="claims_with_evidence")

    draft := Synthesize(findings)
    holes := Critique(draft)

    until Validate(draft, criteria="all sub-questions addressed")<retry=5>:
        supplemental := Search("$holes")<deep>
        draft := Refine(draft + supplemental)
        holes := Critique(draft)

    return Formal(draft)<cite>

report := DeepResearch("What are the barriers to room-temperature superconductors?")
```

### Multi-Angle Analysis
```orchid
@orchid 0.1
@name "Stock Analysis"

data := fork:
    prices: Search("NVDA stock price trends 90 days")
    news: Search("NVIDIA recent news sentiment")
    filings: Search("NVIDIA SEC filings key metrics")

analysis := Consensus(data)
weaknesses := RedTeam(analysis)
refined := Reconcile(analysis + weaknesses)

if Confidence() > 0.8:
    Formal(refined)<cite>
elif Confidence() > 0.5:
    ELI5(refined) + Explain("uncertainty areas")
else:
    Debate[3]("bull vs bear vs neutral case")
```

### Custom Macro
```orchid
@orchid 0.1
@name "Threat Model"

macro ThreatModel(system)<pure>:
    surface := Decompose("attack surface of $system")
    threats := fork:
        spoofing: RedTeam("spoofing attacks on $surface")
        tampering: RedTeam("tampering attacks on $surface")
        info_leak: RedTeam("information disclosure in $surface")
        dos: RedTeam("denial of service on $surface")
        priv_esc: RedTeam("privilege escalation in $surface")
    ranked := Prioritize(Synthesize(threats), criteria="likelihood * impact")
    mitigations := CoT("concrete mitigations for top threats in $ranked")
    return Formal(ranked + mitigations)

report := ThreatModel("a REST API with JWT auth and PostgreSQL backend")
```

## Key Patterns

1. **Search -> Verify -> Reason -> Present**: `Search() >> CoVe >> CoT >> Formal`
2. **Confidence gating**: `if Confidence() > 0.7: Formal(_) else: ELI5(_)`
3. **Iterative refinement**: `until Validate(draft)<retry=5>: draft := Refine(draft + Critique(draft))`
4. **Multi-perspective**: `fork` with named branches, then `Consensus()` or `Synthesize()`
5. **Adversarial review**: `RedTeam(analysis)` then `Reconcile(analysis + weaknesses)`
6. **Pipe chains**: `Search("topic") >> CoVe >> CoT >> Formal`
