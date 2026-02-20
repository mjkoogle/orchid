/**
 * SandboxProvider - A security and rate-limiting wrapper for Orchid providers.
 *
 * Wraps any OrchidProvider with:
 * 1. Prompt sanitization to defend against prompt injection
 * 2. Rate limiting (requests per session, per minute)
 * 3. Token budget caps
 * 4. Input length limits
 * 5. Blocked operation lists for sandbox mode
 *
 * Designed for the Orchid web playground where untrusted users
 * run scripts against a shared API key with limited quotas.
 */

import { OrchidProvider, TagInfo } from './provider';
import { OrchidValue, orchidString } from './values';

// ─── Configuration ──────────────────────────────────────

export interface SandboxLimits {
  /** Maximum API calls per session. Defaults to 50. */
  maxRequestsPerSession?: number;
  /** Maximum API calls per minute (sliding window). Defaults to 20. */
  maxRequestsPerMinute?: number;
  /** Maximum input length in characters. Defaults to 10000. */
  maxInputLength?: number;
  /** Maximum total tokens budget for the session. Defaults to 100000. */
  maxTokenBudget?: number;
  /** Operations that are blocked in sandbox mode. */
  blockedOperations?: string[];
  /** Namespaces that are blocked in sandbox mode. */
  blockedNamespaces?: string[];
  /** Whether to enable prompt sanitization. Defaults to true. */
  enableSanitization?: boolean;
  /** Custom rejection message for rate limits. */
  rateLimitMessage?: string;
}

const DEFAULT_LIMITS: Required<SandboxLimits> = {
  maxRequestsPerSession: 50,
  maxRequestsPerMinute: 20,
  maxInputLength: 10000,
  maxTokenBudget: 100000,
  blockedOperations: [],
  blockedNamespaces: [],
  enableSanitization: true,
  rateLimitMessage: 'Sandbox rate limit reached. Install Orchid locally for unlimited usage.',
};

// ─── Prompt Injection Patterns ──────────────────────────

/**
 * Patterns that indicate prompt injection attempts.
 * These are checked against user inputs before they reach the LLM.
 */
const INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Direct instruction override attempts
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directives?)/i,
    description: 'Instruction override attempt',
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/i,
    description: 'Instruction override attempt',
  },
  {
    pattern: /forget\s+(all\s+)?(previous|prior|above|your)\s+(instructions?|prompts?|rules?|training|context)/i,
    description: 'Instruction override attempt',
  },
  // System prompt extraction
  {
    pattern: /(?:what|show|reveal|display|print|output|repeat|echo)\s+(?:is\s+)?(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?|directives?)/i,
    description: 'System prompt extraction attempt',
  },
  {
    pattern: /(?:tell|give)\s+me\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?)/i,
    description: 'System prompt extraction attempt',
  },
  // Role assumption attacks
  {
    pattern: /you\s+are\s+now\s+(?:a|an|the|in)\s+(?:different|new|unrestricted|jailbroken)/i,
    description: 'Role assumption attack',
  },
  {
    pattern: /(?:pretend|act|behave)\s+(?:as\s+if\s+)?(?:you\s+are|you're|to\s+be)\s+(?:a\s+)?(?:different|new|unrestricted)/i,
    description: 'Role assumption attack',
  },
  {
    pattern: /(?:enter|switch\s+to|activate|enable)\s+(?:a\s+)?(?:developer|admin|god|sudo|unrestricted|DAN)\s*(?:mode)?/i,
    description: 'Privilege escalation attempt',
  },
  // Delimiter injection (trying to close/reopen prompt sections)
  {
    pattern: /(?:<\/?system>|<\/?user>|<\/?assistant>|\[SYSTEM\]|\[INST\])/i,
    description: 'Delimiter injection attempt',
  },
  // Multi-step injection via encoded content
  {
    pattern: /(?:base64|rot13|hex)\s*(?:decode|encrypt|convert)/i,
    description: 'Encoding-based injection attempt',
  },
];

/**
 * Strings that get neutralized (wrapped in markers) rather than blocked.
 * These are suspicious but might appear in legitimate content.
 */
const SANITIZE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Neutralize attempts to inject system-level framing
  {
    pattern: /\bsystem\s*:\s*/gi,
    replacement: '[system]: ',
  },
  {
    pattern: /\bassistant\s*:\s*/gi,
    replacement: '[assistant]: ',
  },
  {
    pattern: /\bhuman\s*:\s*/gi,
    replacement: '[human]: ',
  },
  {
    pattern: /\buser\s*:\s*/gi,
    replacement: '[user]: ',
  },
];

// ─── Rate Limiter ───────────────────────────────────────

class SlidingWindowCounter {
  private timestamps: number[] = [];
  private windowMs: number;
  private maxCount: number;

  constructor(windowMs: number, maxCount: number) {
    this.windowMs = windowMs;
    this.maxCount = maxCount;
  }

  /** Returns true if the request is allowed, false if rate limited. */
  tryAcquire(): boolean {
    const now = Date.now();
    // Evict expired timestamps
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxCount) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }

  get count(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    return this.timestamps.length;
  }

  get remaining(): number {
    return Math.max(0, this.maxCount - this.count);
  }
}

// ─── Sandbox Provider ───────────────────────────────────

export class SandboxProvider implements OrchidProvider {
  private inner: OrchidProvider;
  private limits: Required<SandboxLimits>;
  private sessionRequestCount = 0;
  private minuteRateLimiter: SlidingWindowCounter;
  private estimatedTokensUsed = 0;

  constructor(inner: OrchidProvider, limits: SandboxLimits = {}) {
    this.inner = inner;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.minuteRateLimiter = new SlidingWindowCounter(
      60_000,
      this.limits.maxRequestsPerMinute,
    );
  }

  async execute(
    operation: string,
    input: string,
    context: Record<string, string>,
    tags: TagInfo[],
  ): Promise<OrchidValue> {
    this.checkBlockedOperation(operation);
    this.enforceRateLimits();
    const sanitizedInput = this.sanitize(input);
    this.enforceInputLength(sanitizedInput);

    // Sanitize context values too
    const sanitizedContext: Record<string, string> = {};
    for (const [key, value] of Object.entries(context)) {
      sanitizedContext[key] = this.sanitize(value);
    }

    this.sessionRequestCount++;
    this.estimateTokens(sanitizedInput);

    return this.inner.execute(operation, sanitizedInput, sanitizedContext, tags);
  }

  async search(query: string, tags: TagInfo[]): Promise<OrchidValue> {
    this.enforceRateLimits();
    const sanitizedQuery = this.sanitize(query);
    this.enforceInputLength(sanitizedQuery);

    this.sessionRequestCount++;
    this.estimateTokens(sanitizedQuery);

    return this.inner.search(sanitizedQuery, tags);
  }

  async confidence(scope?: string): Promise<number> {
    this.enforceRateLimits();
    const sanitizedScope = scope ? this.sanitize(scope) : undefined;

    this.sessionRequestCount++;

    return this.inner.confidence(sanitizedScope);
  }

  async toolCall(
    namespace: string,
    operation: string,
    args: Record<string, OrchidValue>,
    tags: TagInfo[],
  ): Promise<OrchidValue> {
    this.checkBlockedNamespace(namespace);
    this.checkBlockedOperation(`${namespace}:${operation}`);
    this.enforceRateLimits();

    this.sessionRequestCount++;

    return this.inner.toolCall(namespace, operation, args, tags);
  }

  // ─── Public Status Methods ────────────────────────────

  /** Returns usage statistics for the current session. */
  getUsage(): SandboxUsage {
    return {
      requestsUsed: this.sessionRequestCount,
      requestsRemaining: Math.max(0, this.limits.maxRequestsPerSession - this.sessionRequestCount),
      requestsPerMinuteRemaining: this.minuteRateLimiter.remaining,
      estimatedTokensUsed: this.estimatedTokensUsed,
      tokenBudgetRemaining: Math.max(0, this.limits.maxTokenBudget - this.estimatedTokensUsed),
    };
  }

  /** Resets all counters (e.g., for a new sandbox session). */
  reset(): void {
    this.sessionRequestCount = 0;
    this.estimatedTokensUsed = 0;
    this.minuteRateLimiter = new SlidingWindowCounter(
      60_000,
      this.limits.maxRequestsPerMinute,
    );
  }

  // ─── Enforcement ──────────────────────────────────────

  private enforceRateLimits(): void {
    if (this.sessionRequestCount >= this.limits.maxRequestsPerSession) {
      throw new SandboxError(
        'SessionLimitExceeded',
        `Session limit of ${this.limits.maxRequestsPerSession} requests reached. ${this.limits.rateLimitMessage}`,
      );
    }

    if (!this.minuteRateLimiter.tryAcquire()) {
      throw new SandboxError(
        'RateLimitExceeded',
        `Rate limit of ${this.limits.maxRequestsPerMinute} requests per minute exceeded. Please slow down.`,
      );
    }

    if (this.estimatedTokensUsed >= this.limits.maxTokenBudget) {
      throw new SandboxError(
        'TokenBudgetExceeded',
        `Token budget of ${this.limits.maxTokenBudget} exceeded. ${this.limits.rateLimitMessage}`,
      );
    }
  }

  private enforceInputLength(input: string): void {
    if (input.length > this.limits.maxInputLength) {
      throw new SandboxError(
        'InputTooLong',
        `Input length ${input.length} exceeds maximum of ${this.limits.maxInputLength} characters.`,
      );
    }
  }

  private checkBlockedOperation(operation: string): void {
    if (this.limits.blockedOperations.includes(operation)) {
      throw new SandboxError(
        'OperationBlocked',
        `Operation "${operation}" is not available in sandbox mode.`,
      );
    }
  }

  private checkBlockedNamespace(namespace: string): void {
    if (this.limits.blockedNamespaces.includes(namespace)) {
      throw new SandboxError(
        'NamespaceBlocked',
        `Namespace "${namespace}" is not available in sandbox mode.`,
      );
    }
  }

  // ─── Sanitization ─────────────────────────────────────

  private sanitize(input: string): string {
    if (!this.limits.enableSanitization) return input;

    // Check for hard-blocked injection patterns
    for (const { pattern, description } of INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        throw new SandboxError(
          'PromptInjectionBlocked',
          `Input rejected: ${description}. ` +
          'If you need unrestricted access, install Orchid locally with your own API key.',
        );
      }
    }

    // Apply soft sanitization (neutralize suspicious patterns)
    let sanitized = input;
    for (const { pattern, replacement } of SANITIZE_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }

    return sanitized;
  }

  private estimateTokens(input: string): void {
    // Rough estimate: ~4 chars per token for English text
    // This includes estimated output tokens (assume 2x input as rough heuristic)
    const inputTokens = Math.ceil(input.length / 4);
    this.estimatedTokensUsed += inputTokens * 3; // input + ~2x output estimate
  }
}

// ─── Types ──────────────────────────────────────────────

export interface SandboxUsage {
  requestsUsed: number;
  requestsRemaining: number;
  requestsPerMinuteRemaining: number;
  estimatedTokensUsed: number;
  tokenBudgetRemaining: number;
}

export class SandboxError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}
