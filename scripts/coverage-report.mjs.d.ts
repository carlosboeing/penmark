export const COVERAGE_MARKER: string;

export interface CoverageMetric {
  pct?: number;
}

export interface CoverageSummary {
  total?: {
    statements?: CoverageMetric;
    branches?: CoverageMetric;
    functions?: CoverageMetric;
    lines?: CoverageMetric;
  };
}

export function formatCoverageReport(summary: CoverageSummary): string;
export function readCoverageSummary(summaryPath: string): CoverageSummary;
