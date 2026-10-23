// evaluations/automation-v2/runner.ts
/**
 * Benchmark scenario runner for Revyme Automation v2.
 */

import { performance } from 'node:perf_hooks';
import type { Snapshot, OperationContext } from '../../packages/automation-core/src/contracts';
import { createOperationContext } from '../../packages/automation-core/src/session';
import { MetricsCollector, type EvaluationMetricResult } from './metrics';
import { validateGeneratedSource } from './validate';

export interface ScenarioDefinition {
  id: string;
  name: string;
  run: (snapshot: Snapshot, context: OperationContext) => Promise<{ changesCount: number; targetFiles: string[] }>;
}

export class EvaluationRunner {
  private metrics = new MetricsCollector();

  async executeScenario(scenario: ScenarioDefinition, initialSnapshot: Snapshot): Promise<EvaluationMetricResult> {
    const context = createOperationContext();
    const start = performance.now();
    const errors: string[] = [];
    let changesCount = 0;
    let targetFiles: string[] = [];
    let oraclePass = true;

    try {
      const outcome = await scenario.run(initialSnapshot, context);
      changesCount = outcome.changesCount;
      targetFiles = outcome.targetFiles;

      for (const filePath of targetFiles) {
        const content = initialSnapshot.files.get(filePath);
        if (content) {
          const report = validateGeneratedSource(filePath, content);
          if (!report.valid) {
            oraclePass = false;
            errors.push(...report.invariantViolations);
          }
        }
      }
    } catch (err: any) {
      errors.push(`Scenario runtime error: ${err.message}`);
      oraclePass = false;
    }

    const durationMs = performance.now() - start;
    const result: EvaluationMetricResult = {
      scenarioId: scenario.id,
      durationMs,
      operationsExecuted: 1,
      changesProduced: changesCount,
      oraclePass,
      errors,
    };

    this.metrics.record(result);
    return result;
  }

  getMetrics(): MetricsCollector {
    return this.metrics;
  }
}
