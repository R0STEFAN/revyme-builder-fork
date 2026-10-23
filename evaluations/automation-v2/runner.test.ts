// evaluations/automation-v2/runner.test.ts
import { describe, it, expect } from 'vitest';
import { createEvaluationSnapshot } from './fixtures';
import { EvaluationRunner } from './runner';

describe('Evaluations Harness: Automation v2 Benchmark Runner', () => {
  it('executes a benchmark scenario and produces validated metrics', async () => {
    const runner = new EvaluationRunner();
    const snapshot = createEvaluationSnapshot();

    const result = await runner.executeScenario(
      {
        id: 'bench-hero-tokens',
        name: 'Benchmark Hero & Token Updates',
        run: async (snap) => {
          return {
            changesCount: 1,
            targetFiles: ['app/page.client.tsx'],
          };
        },
      },
      snapshot,
    );

    expect(result.scenarioId).toBe('bench-hero-tokens');
    expect(result.oraclePass).toBe(true);
    expect(result.errors).toEqual([]);

    const aggregated = runner.getMetrics().aggregate();
    expect(aggregated.totalScenarios).toBe(1);
    expect(aggregated.passedScenarios).toBe(1);
    expect(aggregated.passRatePercent).toBe(100);
    expect(aggregated.oraclePassRatePercent).toBe(100);
  });
});
