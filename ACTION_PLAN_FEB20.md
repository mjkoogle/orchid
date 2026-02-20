# Action Plan — Feb 20, 2026

Roadmap to get Orchid from "working reference implementation" to "tool researchers actually reach for."

---

## Tier 1 — Unblock Adoption

- [ ] **Publish to npm.** `npm publish` so `npx orchid-lang examples/hello_world.orch` works for anyone. Package.json is already configured (`orchid-lang`, `bin.orchid`, types). Need to verify name availability, add `files` field, test with `npm pack`.

- [ ] **VS Code extension.** TextMate grammar derived from the EBNF for syntax highlighting, bracket matching, comment toggling. Publish to VS Code marketplace. Makes `.orch` files feel like a real language instead of plain text.

- [ ] **GitHub Actions CI.** Workflow running `npm test` + `npm run lint` on push/PR. Signals the project is serious and protects against regressions from contributors.

## Tier 2 — Make Researchers Care

- [ ] **Web playground.** Browser page where someone pastes `.orch` and runs it with console provider (no API key). Lexer/parser/interpreter are pure JS — minimal shimming needed. "Try it in 30 seconds" moment.

- [ ] **More providers.** OpenAI provider and Ollama/local provider. Provider interface is clean (~4 methods). Each implementation is ~200 lines. Triples potential user base.

- [ ] **Research-grade examples.** Multi-paper literature synthesis, experiment design pipelines, dataset annotation workflows, ablation study orchestration. Scripts that would take 200 lines of Python but 30 lines of Orchid.

## Tier 3 — Build Momentum

- [ ] **Write it up.** Blog post or short paper: "Orchid: A Cognitive Choreography Language for LLM Agents." Post to arXiv, Hacker News, AI engineering subreddits. Spec is already paper-quality.

- [ ] **Tag GitHub release.** `v0.1.0` with release notes. Set up CHANGELOG.md.

- [ ] **Streaming responses.** Stream tokens during long reasoning chains so the tool feels alive. Prevents researchers from closing the terminal during multi-minute pipelines.

---

*Priority order: npm publish → VS Code extension → CI → playground → providers → examples → writeup → release → streaming.*
