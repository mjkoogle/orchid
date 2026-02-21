/**
 * Registry of built-in reasoning macros from Appendix B of the spec.
 * These are available in all Orchid environments without import.
 */

export const BUILTIN_MACROS = new Set([
  // Analysis
  'CoT', 'CoVe', 'Decompose', 'Classify', 'Extract', 'Compare',
  'Timeline', 'Spatial', 'Quantify',
  // Critique
  'Critique', 'RedTeam', 'Steelman', 'DevilsAdvocate', 'Counterfactual', 'Validate',
  // Synthesis
  'Refine', 'Consensus', 'Debate', 'Synthesize', 'Reconcile', 'Prioritize',
  // Communication
  'ELI5', 'Formal', 'Analogize', 'Socratic', 'Narrate', 'Translate',
  // Generative
  'Creative', 'Brainstorm', 'Abstract', 'Ground', 'Reframe', 'Generate',
  // Meta
  'Explain', 'Confidence', 'Benchmark', 'Trace', 'Checkpoint', 'Rollback',
  'Reflect', 'Cost', 'Elapsed',
  // Utility
  'Search', 'Summarize',
  // Built-in functions
  'Log', 'Error', 'Save', 'len',
]);

/**
 * Macros that are purely meta-operations (introspection/control).
 */
export const META_OPERATIONS = new Set([
  'Confidence', 'Benchmark', 'Trace', 'Checkpoint', 'Rollback',
  'Cost', 'Elapsed', 'Explain', 'Reflect',
]);

/**
 * Returns a description of what a built-in macro does.
 */
export function describeBuiltin(name: string): string {
  const descriptions: Record<string, string> = {
    CoT: 'Chain-of-thought. Step-by-step deliberation.',
    CoVe: 'Chain of Verification. Fact-check against evidence.',
    Decompose: 'Break a problem into enumerated sub-problems.',
    Classify: 'Categorize input into predefined categories.',
    Extract: 'Pull structured data from unstructured input.',
    Compare: 'Structured comparison across dimensions.',
    Timeline: 'Temporal reasoning. Order, sequence, identify causality.',
    Spatial: 'Geographic or visual-spatial reasoning.',
    Quantify: 'Attach numbers, ranges, or magnitudes to claims.',
    Critique: 'Self-criticism. Identify weaknesses, gaps, errors.',
    RedTeam: 'Adversarial analysis. Find failure modes.',
    Steelman: 'Construct the strongest version of an argument.',
    DevilsAdvocate: 'Argue against a position regardless of agreement.',
    Counterfactual: 'What-if analysis. Explore alternate outcomes.',
    Validate: 'Check output against explicit acceptance criteria.',
    Refine: 'Iterative improvement.',
    Consensus: 'Find common ground across multiple perspectives.',
    Debate: 'Multi-viewpoint argumentation. Generate and resolve.',
    Synthesize: 'Combine disparate information into unified output.',
    Reconcile: 'Resolve contradictions between sources or analyses.',
    Prioritize: 'Rank items by importance given criteria.',
    ELI5: 'Simplify for general audience. Remove jargon.',
    Formal: 'Technical, rigorous mode. Precise terminology.',
    Analogize: 'Explain via comparison.',
    Socratic: 'Question-based exploration. Generate probing questions.',
    Narrate: 'Transform data/analysis into narrative form.',
    Translate: 'Adapt content for a specific audience.',
    Creative: 'Divergent thinking. Novel ideas without constraints.',
    Brainstorm: 'Generate distinct ideas. Quantity over quality.',
    Abstract: 'Extract general principles from specific instances.',
    Ground: 'Connect abstract concepts to concrete examples.',
    Reframe: 'Approach from a fundamentally different angle.',
    Generate: 'Generate multimedia (image, audio, video, document) or text from a prompt. Keyword: format="image"|"audio"|"video"|"document"|"text" (default).',
    Explain: 'Justify reasoning for a specific step or decision.',
    Confidence: 'Self-assess certainty (0.0-1.0).',
    Benchmark: 'Evaluate output quality against named criteria.',
    Trace: 'Emit execution history.',
    Checkpoint: 'Save current agent state for potential rollback.',
    Rollback: 'Revert to a checkpoint.',
    Reflect: "Meta-cognitive review of the agent's own approach.",
    Cost: 'Report estimated token/compute cost so far.',
    Elapsed: 'Wall-clock time since execution began.',
    Search: 'Search for information on a topic.',
    Summarize: 'Compress context into a summary.',
    Log: 'Log a message.',
    Error: 'Raise an error.',
    Save: 'Save output to storage.',
    len: 'Return the length of a collection.',
  };
  return descriptions[name] || `Built-in operation: ${name}`;
}
