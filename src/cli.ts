#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from './lexer/lexer';
import { Parser } from './parser/parser';
import { Interpreter } from './runtime/interpreter';
import { ConsoleProvider } from './runtime/provider';
import { valueToString, OrchidValue } from './runtime/values';

const USAGE = `
orchid - The Orchid Language Runtime v0.1.0

Usage:
  orchid <file.orch>          Run an Orchid script
  orchid --parse <file.orch>  Parse and print AST
  orchid --lex <file.orch>    Tokenize and print tokens
  orchid --help               Show this help message

Options:
  --trace    Enable execution tracing
  --parse    Parse only (print AST as JSON)
  --lex      Tokenize only (print token stream)

Examples:
  orchid examples/hello_world.orch
  orchid --trace examples/financial_analysis.orch
  orchid --parse examples/deep_research.orch
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const flags = new Set(args.filter(a => a.startsWith('--')));
  const files = args.filter(a => !a.startsWith('--'));

  if (files.length === 0) {
    console.error('Error: No input file specified.');
    console.log(USAGE);
    process.exit(1);
  }

  const filePath = path.resolve(files[0]);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, 'utf-8');

  // Lex-only mode
  if (flags.has('--lex')) {
    try {
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();
      for (const tok of tokens) {
        const val = tok.value ? ` ${JSON.stringify(tok.value)}` : '';
        console.log(`${tok.line}:${tok.column}\t${tok.type}${val}`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
    return;
  }

  // Parse-only mode
  if (flags.has('--parse')) {
    try {
      const lexer = new Lexer(source);
      const tokens = lexer.tokenize();
      const parser = new Parser();
      const ast = parser.parse(tokens);
      console.log(JSON.stringify(ast, null, 2));
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
    return;
  }

  // Full execution
  try {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser();
    const ast = parser.parse(tokens);
    const provider = new ConsoleProvider();
    const interpreter = new Interpreter({
      provider,
      trace: flags.has('--trace'),
    });

    const result = await interpreter.run(ast);
    if (result.kind !== 'null') {
      console.log(`\n=> ${valueToString(result)}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    if (flags.has('--trace') && e.stack) {
      console.error(e.stack);
    }
    process.exit(1);
  }
}

main();
