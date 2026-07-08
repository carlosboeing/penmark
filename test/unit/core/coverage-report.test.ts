import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain ESM script, typed via scripts/coverage-report.mjs.d.ts
import { formatCoverageReport } from "../../../scripts/coverage-report.mjs";

describe("formatCoverageReport", () => {
  it("formats total coverage as a compact markdown table", () => {
    const report = formatCoverageReport({
      total: {
        statements: { pct: 89.74 },
        branches: { pct: 86.77 },
        functions: { pct: 92.92 },
        lines: { pct: 89.74 },
      },
    });

    expect(report).toContain("<!-- penmark-coverage-report -->");
    expect(report).toContain("### Coverage");
    expect(report).toContain("| Metric | Coverage |");
    expect(report).toContain("| Statements | 89.74% |");
    expect(report).toContain("| Branches | 86.77% |");
    expect(report).toContain("| Functions | 92.92% |");
    expect(report).toContain("| Lines | 89.74% |");
  });

  it("marks unknown totals when a metric is missing", () => {
    const report = formatCoverageReport({
      total: {
        statements: { pct: 100 },
        branches: {},
        functions: { pct: 0 },
        lines: { pct: 95.5 },
      },
    });

    expect(report).toContain("| Statements | 100.00% |");
    expect(report).toContain("| Branches | n/a |");
    expect(report).toContain("| Functions | 0.00% |");
    expect(report).toContain("| Lines | 95.50% |");
  });
});
