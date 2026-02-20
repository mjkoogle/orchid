# Orchid Language for VS Code

Syntax highlighting and language support for [Orchid](https://github.com/mjkoogle/orchid), the cognitive choreography language for LLM agent orchestration.

## Features

- Syntax highlighting for all Orchid constructs
- Distinct coloring for reasoning macro categories (analysis, critique, synthesis, communication, generative)
- Highlighting for meta operations, MCP tool calls, tags, string interpolation
- Auto-closing pairs and bracket matching
- Indentation rules for Orchid's Python-like block structure
- Code folding

## Install

### From source (development)

```bash
cd editors/vscode
npm install -g @vscode/vsce
vsce package
code --install-extension orchid-lang-0.1.0.vsix
```

### Manual (symlink)

```bash
ln -s $(pwd)/editors/vscode ~/.vscode/extensions/orchid-lang
```

Then reload VS Code.

## Syntax Categories

| Category | Scope | Examples |
|----------|-------|---------|
| Reasoning macros | `entity.name.function.reasoning.*` | `CoT`, `RedTeam`, `ELI5`, `Debate` |
| Meta operations | `support.function.meta` | `Confidence`, `Checkpoint`, `Trace` |
| Utility builtins | `support.function.builtin` | `Log`, `Error`, `len` |
| Keywords | `keyword.control.*` | `if`, `fork`, `agent`, `import` |
| MCP/Plugin calls | `entity.name.namespace` + `entity.name.function.tool` | `filesystem:read_text_file` |
| Tags | `meta.tag` | `<deep>`, `<retry=3>` |
| Metadata | `keyword.control.directive` | `@orchid`, `@name`, `@requires` |
| String interpolation | `variable.other.interpolated` | `$var`, `${expr}` |
