/**
 * ClaudeProvider - An Orchid provider powered by the Anthropic Claude API.
 *
 * Maps Orchid reasoning macros to Claude API calls with operation-specific
 * system prompts that elicit the right kind of reasoning for each macro.
 */

import Anthropic from '@anthropic-ai/sdk';
import { OrchidProvider, TagInfo } from './provider';
import { OrchidValue, orchidString, orchidNumber, orchidList } from './values';
import { describeBuiltin } from './builtins';

// ─── Configuration ──────────────────────────────────────

export interface ClaudeProviderOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Model to use. Defaults to claude-sonnet-4-5-20250929. */
  model?: string;
  /** Maximum tokens per response. Defaults to 4096. */
  maxTokens?: number;
  /** Temperature for generation. Defaults to operation-specific values. */
  temperature?: number;
}

// ─── Operation → Prompt mapping ──────────────────────────

/**
 * System prompts tailored to each reasoning macro category.
 * These guide Claude to produce the specific kind of reasoning
 * that each Orchid macro represents.
 */
const OPERATION_PROMPTS: Record<string, string> = {
  // ── Analysis ──
  CoT: `You are performing Chain-of-Thought reasoning. Think step by step through the problem.
Show your reasoning process explicitly, numbering each step. Arrive at a clear conclusion.`,

  CoVe: `You are performing Chain of Verification. Your task:
1. Analyze the input and identify factual claims
2. For each claim, assess whether it can be verified
3. Flag any claims that appear unsubstantiated or incorrect
4. Provide a verified, corrected version of the input
Be rigorous. Prefer accuracy over agreement.`,

  Decompose: `You are decomposing a complex problem into sub-problems.
Break the input into distinct, manageable sub-tasks.
Return a JSON array of strings, each being one sub-problem.
Example: ["sub-problem 1", "sub-problem 2", "sub-problem 3"]
Return ONLY the JSON array, no other text.`,

  Classify: `You are classifying/categorizing the input.
Determine the most appropriate categories for the input.
Return a JSON array of category strings.
Example: ["category1", "category2"]
Return ONLY the JSON array, no other text.`,

  Extract: `You are extracting structured data from unstructured input.
Identify key entities, facts, and relationships in the input.
Present the extracted information clearly and concisely.`,

  Compare: `You are performing a structured comparison.
Analyze the input across relevant dimensions.
Identify similarities, differences, advantages, and trade-offs.
Present the comparison in a clear, balanced way.`,

  Timeline: `You are performing temporal reasoning.
Identify events, sequences, and causal chains in the input.
Order them chronologically and identify causal relationships.`,

  Spatial: `You are performing spatial/geographic reasoning.
Analyze spatial relationships, layouts, or geographic considerations in the input.`,

  Quantify: `You are attaching quantitative analysis to the input.
Identify claims that can be quantified. Provide numbers, ranges, or magnitudes.
Be explicit about confidence levels and sources of uncertainty.`,

  // ── Critique ──
  Critique: `You are a rigorous critic. Analyze the input for:
- Logical flaws or fallacies
- Missing evidence or unsupported claims
- Gaps in reasoning
- Potential biases
Be constructive but thorough. Do not hold back on identifying weaknesses.`,

  RedTeam: `You are an adversarial red-teamer. Your job is to find failure modes.
Think about how the input could go wrong, be exploited, or produce harmful outcomes.
Consider edge cases, adversarial inputs, and unintended consequences.
Be creative in identifying attack vectors and failure scenarios.`,

  Steelman: `You are constructing the strongest possible version of the argument or idea in the input.
Improve weak points, add supporting evidence, and make the case as compelling as possible.
Even if you disagree, present the most charitable and powerful interpretation.`,

  DevilsAdvocate: `You are a devil's advocate. Argue against the position presented in the input.
Construct the strongest counterarguments, regardless of your own views.
Identify the most compelling reasons someone might disagree.`,

  Counterfactual: `You are performing counterfactual analysis.
Explore "what if" scenarios. What would happen if key assumptions changed?
Identify the most impactful variables and how different values would alter outcomes.`,

  Validate: `You are validating output against acceptance criteria.
Check whether the input meets the standards implied or stated.
Be specific about what passes, what fails, and what's borderline.`,

  // ── Synthesis ──
  Refine: `You are iteratively refining the input.
Improve clarity, accuracy, and completeness while preserving the core meaning.
Make it tighter, more precise, and more effective.`,

  Consensus: `You are finding common ground across perspectives.
Identify shared principles, areas of agreement, and potential compromises.
Synthesize a position that accommodates the strongest points from each view.`,

  Debate: `You are staging a structured debate on the input topic.
Present multiple viewpoints with their strongest arguments.
Then work toward a resolution or identify irreducible disagreements.`,

  Synthesize: `You are synthesizing disparate information into a unified output.
Combine the input elements into a coherent whole.
Resolve contradictions where possible, flag them where not.`,

  Reconcile: `You are reconciling contradictions.
Identify conflicting claims or data points in the input.
Determine which are correct, or explain how seemingly contradictory points can coexist.`,

  Prioritize: `You are prioritizing items by importance.
Rank the elements in the input based on impact, urgency, or other relevant criteria.
Explain your ranking rationale.`,

  // ── Communication ──
  ELI5: `Explain the following as if to a curious five-year-old.
Use simple words, relatable analogies, and no jargon.
Make it engaging and easy to understand.`,

  Formal: `Rewrite or analyze the following using precise, technical, formal language.
Use domain-appropriate terminology. Be rigorous and unambiguous.`,

  Analogize: `Explain the input by creating a clear, illuminating analogy.
Find a comparison from everyday experience that captures the key concepts.`,

  Socratic: `Engage with the input using the Socratic method.
Generate probing questions that guide deeper understanding.
Don't provide answers directly — instead, ask questions that lead to insight.`,

  Narrate: `Transform the following data or analysis into a compelling narrative.
Make it readable and engaging while preserving accuracy.`,

  Translate: `Adapt the following content for its target audience.
Adjust vocabulary, examples, and framing to be most effective for the intended readers.`,

  // ── Generative ──
  Creative: `You are in divergent thinking mode. Be creative, bold, and unconventional.
Generate novel ideas without self-censoring. Quantity and originality over practicality.`,

  Brainstorm: `Generate distinct, diverse ideas related to the input.
Each idea should be meaningfully different from the others.
Return a JSON array of strings, each being one idea.
Example: ["idea 1", "idea 2", "idea 3"]
Return ONLY the JSON array, no other text.`,

  Abstract: `Extract general principles from the specific instance described in the input.
What broader patterns, rules, or frameworks does this example illustrate?`,

  Ground: `Connect abstract concepts in the input to concrete, specific examples.
Make the theoretical practical. Provide real-world instances and applications.`,

  Reframe: `Approach the input from a fundamentally different angle.
Challenge the framing itself. What happens if we look at this problem completely differently?`,

  // ── Operators ──
  Subtract: `You are performing semantic subtraction. Given an original text and content to remove,
produce a new version of the original with the specified content, themes, or concepts removed.
Preserve the remaining content's coherence and flow. Do not simply delete sentences —
rewrite the text so it reads naturally without the subtracted material.
If the content to remove is a concept or theme, remove all references and implications of it.
Return ONLY the resulting text, no explanation.`,

  // ── Meta ──
  Reflect: `Perform a meta-cognitive review. Analyze the reasoning approach itself:
- What assumptions are being made?
- What methodology is being used and is it appropriate?
- What blind spots might exist?
- How could the approach be improved?`,

  Explain: `Explain the reasoning behind a specific step or decision.
Be transparent about the logic, trade-offs, and alternatives considered.`,

  Summarize: `Summarize the following concisely. Capture the essential points
while minimizing length. Preserve the most important details and conclusions.`,
};

/** Operations that return JSON arrays (parsed into OrchidList) */
const LIST_OPERATIONS = new Set(['Decompose', 'Brainstorm', 'Classify']);

/** Tag-to-prompt modifiers */
const TAG_MODIFIERS: Record<string, string> = {
  deep: 'Be extremely thorough and detailed in your analysis. Leave no stone unturned.',
  brief: 'Be as concise as possible. Only the essential points.',
  creative: 'Push for unconventional, creative approaches. Prioritize novelty.',
  formal: 'Use formal, academic language and rigorous structure.',
  casual: 'Use conversational, accessible language.',
  structured: 'Organize your response with clear headers, bullets, or numbered lists.',
  evidence: 'Support every claim with specific evidence or reasoning.',
  practical: 'Focus on actionable, implementable insights.',
  contrarian: 'Challenge conventional wisdom. Look for counterintuitive truths.',
};

// ─── Provider Implementation ──────────────────────────────

export class ClaudeProvider implements OrchidProvider {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private defaultTemperature?: number;
  private conversationHistory: Array<{ role: string; content: string }> = [];
  private totalTokensUsed = 0;

  constructor(options: ClaudeProviderOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
    });
    this.model = options.model || 'claude-sonnet-4-5-20250929';
    this.maxTokens = options.maxTokens || 16384;
    this.defaultTemperature = options.temperature;
  }

  async execute(
    operation: string,
    input: string,
    context: Record<string, string>,
    tags: TagInfo[],
  ): Promise<OrchidValue> {
    const systemPrompt = this.buildSystemPrompt(operation, context, tags);
    const userMessage = this.buildUserMessage(input, context);
    const temperature = this.getTemperature(operation, tags);

    const response = await this.callClaude(systemPrompt, userMessage, temperature);

    // Track conversation for context-aware follow-up operations
    this.conversationHistory.push(
      { role: 'user', content: `[${operation}] ${userMessage}` },
      { role: 'assistant', content: response },
    );
    // Keep history bounded
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-16);
    }

    // Parse list operations that return JSON arrays
    if (LIST_OPERATIONS.has(operation)) {
      return this.parseListResponse(response, operation, context);
    }

    return orchidString(response);
  }

  async search(query: string, tags: TagInfo[]): Promise<OrchidValue> {
    const systemPrompt = `You are a knowledgeable research assistant. The user needs information about a topic.
Provide a comprehensive, well-organized summary of what you know about the query.
Include key facts, relevant context, and different perspectives where applicable.
Be clear about the limits of your knowledge and any uncertainty.
${this.buildTagModifiers(tags)}`;

    const response = await this.callClaude(systemPrompt, query, 0.3);

    this.conversationHistory.push(
      { role: 'user', content: `[Search] ${query}` },
      { role: 'assistant', content: response },
    );

    return orchidString(response);
  }

  async confidence(scope?: string): Promise<number> {
    if (this.conversationHistory.length === 0) {
      return 0.5; // No prior context to assess
    }

    const recentContext = this.conversationHistory.slice(-4)
      .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
      .join('\n\n');

    const systemPrompt = `You are assessing the confidence level of a prior reasoning output.
Consider: factual accuracy, logical soundness, completeness, and potential for error.
Respond with ONLY a single number between 0.0 and 1.0.
- 0.0-0.3: Low confidence (speculation, uncertain, potentially wrong)
- 0.3-0.6: Medium confidence (plausible but with notable gaps or uncertainty)
- 0.6-0.8: Good confidence (well-reasoned, likely correct, minor uncertainties)
- 0.8-1.0: High confidence (strong evidence, clear logic, very likely correct)
Return ONLY the number, nothing else.`;

    const userMessage = scope
      ? `Assess confidence for: ${scope}\n\nRecent context:\n${recentContext}`
      : `Assess confidence for the most recent output:\n\n${recentContext}`;

    const response = await this.callClaude(systemPrompt, userMessage, 0.0);

    const parsed = parseFloat(response.trim());
    if (isNaN(parsed) || parsed < 0 || parsed > 1) {
      return 0.5; // Fallback
    }
    return Math.round(parsed * 100) / 100;
  }

  async toolCall(
    namespace: string,
    operation: string,
    args: Record<string, OrchidValue>,
    tags: TagInfo[],
  ): Promise<OrchidValue> {
    // For now, tool calls are simulated through Claude's reasoning.
    // Real MCP integration will replace this with actual tool transport.
    const argsDescription = Object.entries(args)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ');

    const systemPrompt = `You are simulating a tool call to ${namespace}:${operation}.
The user wants to call this tool with the given arguments.
Since the actual tool is not connected, provide the most helpful response you can
based on your knowledge. Be clear that this is a simulated response.
${this.buildTagModifiers(tags)}`;

    const response = await this.callClaude(
      systemPrompt,
      `Tool: ${namespace}:${operation}(${argsDescription})`,
      0.3,
    );

    return orchidString(response);
  }

  /** Returns total tokens consumed across all API calls this session. */
  getTokensUsed(): number {
    return this.totalTokensUsed;
  }

  /** Resets the conversation history (e.g., between scripts). */
  resetHistory(): void {
    this.conversationHistory = [];
  }

  // ─── Private Helpers ──────────────────────────────────────

  private async callClaude(
    systemPrompt: string,
    userMessage: string,
    temperature: number,
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Track token usage
    if (response.usage) {
      this.totalTokensUsed += response.usage.input_tokens + response.usage.output_tokens;
    }

    // Warn on truncation
    if (response.stop_reason === 'max_tokens') {
      console.warn(
        `[warn] Response truncated — hit ${this.maxTokens} token limit. ` +
        `Use --max-tokens to increase (e.g. --max-tokens 32768).`,
      );
    }

    // Extract text from response
    const textBlock = response.content.find(block => block.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  private buildSystemPrompt(
    operation: string,
    context: Record<string, string>,
    tags: TagInfo[],
  ): string {
    // Start with the operation-specific prompt, or a generic one
    let prompt = OPERATION_PROMPTS[operation]
      || `You are performing the "${operation}" reasoning operation: ${describeBuiltin(operation)}`;

    // Apply tag modifiers
    const tagMods = this.buildTagModifiers(tags);
    if (tagMods) {
      prompt += `\n\nAdditional instructions:\n${tagMods}`;
    }

    return prompt;
  }

  private buildUserMessage(input: string, context: Record<string, string>): string {
    let message = input;

    // Append relevant context as structured information
    const contextEntries = Object.entries(context).filter(([k]) => k !== '_count');
    if (contextEntries.length > 0) {
      message += '\n\nAdditional context:';
      for (const [key, value] of contextEntries) {
        message += `\n- ${key}: ${value}`;
      }
    }

    return message;
  }

  private buildTagModifiers(tags: TagInfo[]): string {
    const modifiers: string[] = [];
    for (const tag of tags) {
      if (TAG_MODIFIERS[tag.name]) {
        modifiers.push(TAG_MODIFIERS[tag.name]);
      }
    }
    return modifiers.join('\n');
  }

  private getTemperature(operation: string, tags: TagInfo[]): number {
    if (this.defaultTemperature !== undefined) return this.defaultTemperature;

    // Creative operations get higher temperature
    const creativeOps = new Set(['Creative', 'Brainstorm', 'Reframe', 'Analogize']);
    if (creativeOps.has(operation)) return 0.9;
    if (tags.some(t => t.name === 'creative')) return 0.9;

    // Analytical operations get lower temperature
    const analyticalOps = new Set(['CoVe', 'Validate', 'Extract', 'Classify', 'Quantify']);
    if (analyticalOps.has(operation)) return 0.2;

    // Default moderate temperature
    return 0.5;
  }

  private parseListResponse(
    response: string,
    operation: string,
    context: Record<string, string>,
  ): OrchidValue {
    const requestedCount = context['_count'] ? parseInt(context['_count']) : undefined;

    // Try to parse as JSON array
    try {
      // Extract JSON array from response (it might have surrounding text)
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const items: unknown[] = JSON.parse(match[0]);
        const elements = items.map(item =>
          orchidString(typeof item === 'string' ? item : JSON.stringify(item)),
        );
        return orchidList(requestedCount ? elements.slice(0, requestedCount) : elements);
      }
    } catch {
      // JSON parsing failed — fall back to line splitting
    }

    // Fallback: split by newlines, stripping bullet markers
    const lines = response
      .split('\n')
      .map(line => line.replace(/^[\s]*[-*\d.)\]]+[\s.)\]]*/, '').trim())
      .filter(line => line.length > 0);

    const elements = lines.map(line => orchidString(line));
    return orchidList(requestedCount ? elements.slice(0, requestedCount) : elements);
  }
}
