// packages/automation-core/src/ingestion/report.ts
import type { Issue, Normalization } from '../contracts';

export class IngestionReporter {
  private normalizations: Normalization[] = [];
  private issues: Issue[] = [];

  recordNormalization(rule: string, target: string, before: string, after: string): void {
    this.normalizations.push({ rule, target, before, after });
  }

  recordIssue(
    code: string,
    path: Array<string | number>,
    message: string,
    source?: { file: string; line: number }
  ): void {
    this.issues.push({ code, path, message, source });
  }

  getNormalizations(): Normalization[] {
    return [...this.normalizations];
  }

  getIssues(): Issue[] {
    return [...this.issues];
  }

  hasFatalIssues(): boolean {
    return this.issues.length > 0;
  }

  clear(): void {
    this.normalizations = [];
    this.issues = [];
  }
}
