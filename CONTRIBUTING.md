# Contributing to Orchid

Thanks for your interest in Orchid! This project is in early stages and contributions of all kinds are welcome.

## Ways to Contribute

### Feedback on the Specification
The most impactful contribution right now is reading [the spec](docs/specification.md) and telling us what's confusing, missing, or overcomplicated. Open an issue with the `spec-feedback` label.

### Use Cases
Have a real-world workflow you'd love to express in Orchid? Write it up as a `.orch` file and submit a PR to `examples/`. Even pseudocode sketches are useful — they help us find gaps in the language.

### Runtime Implementations
The reference interpreter is being prepared for release, but we'd love to see implementations in other languages. If you're building one, open an issue so we can coordinate and avoid duplicate effort.

### Tooling
Syntax highlighting, linters, formatters, LSP servers, playground environments — all welcome. See the EBNF grammar in §15 of the spec for the formal syntax.

## Submitting Changes

1. Fork the repo and create a branch from `main`.
2. If you're changing the spec, explain the rationale in your PR description.
3. If you're adding examples, make sure they include the `@orchid 0.1` header and a descriptive `@name`.
4. Open a pull request.

## Spec Change Process

The specification is versioned (`@orchid 0.1`). Changes to the spec follow this process:

- **Minor clarifications and typo fixes** — Submit a PR directly.
- **New features or syntax changes** — Open an issue first to discuss. Include a motivating use case and a proposed syntax. Breaking changes require broad consensus before merging.
- **EBNF grammar changes** — Must accompany any syntax change. The grammar is the source of truth.

## Style Guide for Examples

```orchid
@orchid 0.1
@name "Descriptive Name"
@description "What this example demonstrates"

# Use section comments (##) to label logical phases
## Phase 1: Data Collection
sources := Search("topic")

## Phase 2: Analysis
analysis := CoT(sources)
```

- Include `@orchid` and `@name` headers in every example.
- Use `##` section comments to label logical phases.
- Keep examples focused — one concept or workflow per file.
- Add inline comments for non-obvious operations.

## Code of Conduct

Be respectful, constructive, and assume good faith. We're building something new and there are no dumb questions.

## Questions?

Open an issue with the `question` label or start a discussion in the Discussions tab.
