/**
 * ConfidenceTracker — Runtime confidence signal infrastructure.
 *
 * Implements the hybrid confidence model from Orchid spec §8.1.
 * The final Confidence() value is a weighted blend of:
 *   - Agent-side (subjective): the LLM's self-assessed confidence
 *   - Runtime-side (objective): observable signals from execution
 *
 * Runtime signals tracked per-variable:
 *   - retryCount:     how many retries were needed (more retries → lower confidence)
 *   - errorCount:     how many errors occurred during computation
 *   - sourceCount:    how many independent data sources contributed
 *   - coveVerified:   whether the value passed Chain-of-Verification
 *   - forkAgreement:  agreement ratio among parallel fork branches (0.0–1.0)
 *   - freshness:      timestamp of when the value was last computed
 *   - operationDepth: how many chained operations produced this value
 */

export interface ConfidenceSignals {
  retryCount: number;
  errorCount: number;
  sourceCount: number;
  coveVerified: boolean;
  /** Agreement ratio among fork branches. 1.0 = full agreement, 0.0 = total divergence. null = not from fork. */
  forkAgreement: number | null;
  /** Timestamp (ms) when the value was computed. */
  freshness: number;
  /** Number of chained operations that contributed to this value. */
  operationDepth: number;
}

function defaultSignals(): ConfidenceSignals {
  return {
    retryCount: 0,
    errorCount: 0,
    sourceCount: 0,
    coveVerified: false,
    forkAgreement: null,
    freshness: Date.now(),
    operationDepth: 0,
  };
}

/** Weight distribution for the hybrid blend. */
const PROVIDER_WEIGHT = 0.50;
const RUNTIME_WEIGHT = 0.50;

/**
 * Compute a runtime confidence adjustment from observable signals.
 *
 * Returns a value in [0.0, 1.0] representing the runtime's assessment.
 * This is then blended with the provider's subjective score.
 */
function computeRuntimeConfidence(signals: ConfidenceSignals, startTime: number): number {
  let score = 0.7; // Neutral baseline

  // ── Retries: each retry reduces confidence (cap at -0.3) ──
  const retryPenalty = Math.min(signals.retryCount * 0.1, 0.3);
  score -= retryPenalty;

  // ── Errors: each error reduces confidence ──
  const errorPenalty = Math.min(signals.errorCount * 0.15, 0.4);
  score -= errorPenalty;

  // ── Source diversity: more sources increase confidence ──
  if (signals.sourceCount >= 3) {
    score += 0.15;
  } else if (signals.sourceCount >= 2) {
    score += 0.08;
  } else if (signals.sourceCount === 1) {
    score += 0.03;
  }
  // 0 sources: no adjustment (the operation may not need external data)

  // ── CoVe verification: verified content gets a boost ──
  if (signals.coveVerified) {
    score += 0.15;
  }

  // ── Fork agreement: convergent parallel analysis increases confidence ──
  if (signals.forkAgreement !== null) {
    // forkAgreement is 0.0-1.0
    // High agreement (>0.8) boosts confidence, low agreement (<0.4) reduces it
    if (signals.forkAgreement > 0.8) {
      score += 0.10;
    } else if (signals.forkAgreement < 0.4) {
      score -= 0.15;
    }
  }

  // ── Freshness: stale values degrade confidence slightly ──
  const ageMs = Date.now() - signals.freshness;
  const ageSec = ageMs / 1000;
  if (ageSec > 300) {
    // Values older than 5 minutes lose some confidence
    score -= Math.min((ageSec - 300) / 3000, 0.1);
  }

  // ── Operation depth: deeply chained operations lose some confidence ──
  if (signals.operationDepth > 5) {
    score -= Math.min((signals.operationDepth - 5) * 0.03, 0.15);
  }

  // Clamp to [0.0, 1.0]
  return Math.max(0.0, Math.min(1.0, score));
}

export class ConfidenceTracker {
  /** Per-variable signal history. */
  private signals: Map<string, ConfidenceSignals> = new Map();
  /** Global (unscoped) signals for the current session. */
  private globalSignals: ConfidenceSignals = defaultSignals();
  /** The name of the variable most recently assigned. */
  private lastVariable: string | null = null;
  /** Interpreter start time for freshness calculations. */
  private startTime: number;

  constructor(startTime?: number) {
    this.startTime = startTime ?? Date.now();
  }

  // ─── Signal recording ──────────────────────────────────

  /** Record that a variable was assigned (creates or refreshes its signal entry). */
  recordAssignment(varName: string): void {
    if (!this.signals.has(varName)) {
      this.signals.set(varName, defaultSignals());
    }
    this.signals.get(varName)!.freshness = Date.now();
    this.lastVariable = varName;
  }

  /** Record that a Search or data operation contributed to a variable. */
  recordSource(varName?: string): void {
    const target = this.getTargetSignals(varName);
    target.sourceCount++;
  }

  /** Record that a retry occurred during the computation of a variable. */
  recordRetry(varName?: string): void {
    const target = this.getTargetSignals(varName);
    target.retryCount++;
    this.globalSignals.retryCount++;
  }

  /** Record that an error occurred during computation. */
  recordError(varName?: string): void {
    const target = this.getTargetSignals(varName);
    target.errorCount++;
    this.globalSignals.errorCount++;
  }

  /** Record that CoVe (Chain-of-Verification) was applied. */
  recordCoVeVerification(varName?: string): void {
    const target = this.getTargetSignals(varName);
    target.coveVerified = true;
  }

  /** Record that an operation was chained onto a variable. */
  recordOperationStep(varName?: string): void {
    const target = this.getTargetSignals(varName);
    target.operationDepth++;
  }

  /**
   * Record fork branch agreement.
   * @param agreement - ratio of branches that agree (0.0–1.0)
   * @param varName - variable being assigned from the fork
   */
  recordForkAgreement(agreement: number, varName?: string): void {
    const target = this.getTargetSignals(varName);
    target.forkAgreement = agreement;
  }

  // ─── Confidence computation ────────────────────────────

  /**
   * Compute the blended confidence score.
   *
   * @param providerConfidence - the LLM's subjective confidence (0.0–1.0)
   * @param scope - optional variable name to scope the assessment
   * @returns blended confidence (0.0–1.0)
   */
  blend(providerConfidence: number, scope?: string): number {
    const signals = scope
      ? (this.signals.get(scope) ?? this.globalSignals)
      : this.globalSignals;

    const runtimeScore = computeRuntimeConfidence(signals, this.startTime);
    const blended = (PROVIDER_WEIGHT * providerConfidence) + (RUNTIME_WEIGHT * runtimeScore);

    // Round to 2 decimal places
    return Math.round(Math.max(0.0, Math.min(1.0, blended)) * 100) / 100;
  }

  /**
   * Get the raw runtime signals for a variable (for tracing/debugging).
   */
  getSignals(varName?: string): ConfidenceSignals {
    if (varName && this.signals.has(varName)) {
      return { ...this.signals.get(varName)! };
    }
    return { ...this.globalSignals };
  }

  // ─── Helpers ───────────────────────────────────────────

  private getTargetSignals(varName?: string): ConfidenceSignals {
    const name = varName ?? this.lastVariable;
    if (name && this.signals.has(name)) {
      return this.signals.get(name)!;
    }
    return this.globalSignals;
  }
}
