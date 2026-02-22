import { ConfidenceTracker } from '../src/runtime/confidence';

describe('ConfidenceTracker', () => {
  let tracker: ConfidenceTracker;

  beforeEach(() => {
    tracker = new ConfidenceTracker(Date.now());
  });

  describe('blend()', () => {
    it('should blend provider and runtime scores', () => {
      const result = tracker.blend(0.8);
      // 0.50 * 0.8 + 0.50 * 0.7 (baseline) = 0.75
      expect(result).toBeCloseTo(0.75, 1);
    });

    it('should return value between 0 and 1', () => {
      const result = tracker.blend(1.0);
      expect(result).toBeGreaterThanOrEqual(0.0);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it('should handle provider confidence of 0', () => {
      const result = tracker.blend(0.0);
      // 0.50 * 0.0 + 0.50 * 0.7 = 0.35
      expect(result).toBeCloseTo(0.35, 1);
    });
  });

  describe('retry signals', () => {
    it('should reduce confidence when retries are recorded', () => {
      const before = tracker.blend(0.8);
      tracker.recordAssignment('x');
      tracker.recordRetry('x');
      tracker.recordRetry('x');
      tracker.recordRetry('x');
      const after = tracker.blend(0.8, 'x');
      expect(after).toBeLessThan(before);
    });
  });

  describe('error signals', () => {
    it('should reduce confidence when errors are recorded', () => {
      const before = tracker.blend(0.8);
      tracker.recordAssignment('x');
      tracker.recordError('x');
      tracker.recordError('x');
      const after = tracker.blend(0.8, 'x');
      expect(after).toBeLessThan(before);
    });
  });

  describe('source signals', () => {
    it('should increase confidence with more sources', () => {
      tracker.recordAssignment('x');
      const withNoSources = tracker.blend(0.5, 'x');
      tracker.recordSource('x');
      tracker.recordSource('x');
      tracker.recordSource('x');
      const withSources = tracker.blend(0.5, 'x');
      expect(withSources).toBeGreaterThan(withNoSources);
    });
  });

  describe('CoVe verification', () => {
    it('should boost confidence when verified', () => {
      tracker.recordAssignment('x');
      const before = tracker.blend(0.6, 'x');
      tracker.recordCoVeVerification('x');
      const after = tracker.blend(0.6, 'x');
      expect(after).toBeGreaterThan(before);
    });
  });

  describe('fork agreement', () => {
    it('should boost confidence with high agreement', () => {
      tracker.recordAssignment('x');
      const before = tracker.blend(0.6, 'x');
      tracker.recordForkAgreement(0.95, 'x');
      const after = tracker.blend(0.6, 'x');
      expect(after).toBeGreaterThan(before);
    });

    it('should reduce confidence with low agreement', () => {
      tracker.recordAssignment('x');
      const before = tracker.blend(0.6, 'x');
      tracker.recordForkAgreement(0.2, 'x');
      const after = tracker.blend(0.6, 'x');
      expect(after).toBeLessThan(before);
    });
  });

  describe('operation depth', () => {
    it('should gradually reduce confidence with deep chaining', () => {
      tracker.recordAssignment('x');
      const shallow = tracker.blend(0.8, 'x');
      for (let i = 0; i < 10; i++) {
        tracker.recordOperationStep('x');
      }
      const deep = tracker.blend(0.8, 'x');
      expect(deep).toBeLessThan(shallow);
    });
  });

  describe('per-variable tracking', () => {
    it('should track signals independently per variable', () => {
      tracker.recordAssignment('clean');
      tracker.recordAssignment('dirty');
      // Add errors only to 'dirty'
      tracker.recordError('dirty');
      tracker.recordError('dirty');
      tracker.recordError('dirty');

      const cleanConf = tracker.blend(0.8, 'clean');
      const dirtyConf = tracker.blend(0.8, 'dirty');
      expect(cleanConf).toBeGreaterThan(dirtyConf);
    });

    it('should fall back to global signals for unknown variables', () => {
      const globalConf = tracker.blend(0.8);
      const unknownConf = tracker.blend(0.8, 'nonexistent');
      expect(unknownConf).toBe(globalConf);
    });
  });

  describe('getSignals()', () => {
    it('should return a copy of signals', () => {
      tracker.recordAssignment('x');
      tracker.recordSource('x');
      tracker.recordRetry('x');
      const signals = tracker.getSignals('x');
      expect(signals.sourceCount).toBe(1);
      expect(signals.retryCount).toBe(1);
      expect(signals.errorCount).toBe(0);
      expect(signals.coveVerified).toBe(false);

      // Modifying the copy should not affect the tracker
      signals.sourceCount = 99;
      expect(tracker.getSignals('x').sourceCount).toBe(1);
    });
  });

  describe('combined signals', () => {
    it('should handle multiple positive signals stacking', () => {
      tracker.recordAssignment('x');
      tracker.recordSource('x');
      tracker.recordSource('x');
      tracker.recordSource('x');
      tracker.recordCoVeVerification('x');
      tracker.recordForkAgreement(0.95, 'x');
      const boosted = tracker.blend(0.8, 'x');
      // Should be notably higher than default
      expect(boosted).toBeGreaterThan(0.75);
    });

    it('should handle multiple negative signals stacking', () => {
      tracker.recordAssignment('x');
      tracker.recordRetry('x');
      tracker.recordRetry('x');
      tracker.recordError('x');
      tracker.recordError('x');
      tracker.recordForkAgreement(0.1, 'x');
      for (let i = 0; i < 8; i++) tracker.recordOperationStep('x');
      const degraded = tracker.blend(0.5, 'x');
      // Should be notably lower
      expect(degraded).toBeLessThan(0.35);
    });
  });
});
