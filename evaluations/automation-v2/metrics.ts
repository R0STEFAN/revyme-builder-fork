// evaluations/automation-v2/metrics.ts
/**
 * Metrics tracking, aggregation, and threshold validation for automation benchmarks.
 */

export interface EvaluationMetricResult {
  scenarioId: string;
  durationMs: number;
  operationsExecuted: number;
  changesProduced: number;
  oraclePass: boolean;
  errors: string[];
}

export interface AggregatedMetrics {
  totalScenarios: number;
  passedScenarios: number;
  passRatePercent: number;
  meanDurationMs: number;
  p95DurationMs: number;
  totalOperations: number;
  totalChanges: number;
  oraclePassRatePercent: number;
}

export class MetricsCollector {
  private results: EvaluationMetricResult[] = [];

  record(res: EvaluationMetricResult): void {
    this.results.push(res);
  }

  getResults(): EvaluationMetricResult[] {
    return [...this.results];
  }

  aggregate(): AggregatedMetrics {
    const total = this.results.length;
    if (total === 0) {
      return {
        totalScenarios: 0,
        passedScenarios: 0,
        passRatePercent: 100,
        meanDurationMs: 0,
        p95DurationMs: 0,
        totalOperations: 0,
        totalChanges: 0,
        oraclePassRatePercent: 100,
      };
    }

    const passed = this.results.filter((r) => r.errors.length === 0).length;
    const oraclePassed = this.results.filter((r) => r.oraclePass).length;
    const durations = this.results.map((r) => r.durationMs).sort((a, b) => a - b);
    const totalDuration = durations.reduce((acc, v) => acc + v, 0);

    const p95Idx = Math.min(Math.floor(total * 0.95), total - 1);

    return {
      totalScenarios: total,
      passedScenarios: passed,
      passRatePercent: (passed / total) * 100,
      meanDurationMs: totalDuration / total,
      p95DurationMs: durations[p95Idx] ?? 0,
      totalOperations: this.results.reduce((acc, r) => acc + r.operationsExecuted, 0),
      totalChanges: this.results.reduce((acc, r) => acc + r.changesProduced, 0),
      oraclePassRatePercent: (oraclePassed / total) * 100,
    };
  }
}
