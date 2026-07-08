import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export const COVERAGE_MARKER = "<!-- penmark-coverage-report -->";

const METRICS = [
  ["Statements", "statements"],
  ["Branches", "branches"],
  ["Functions", "functions"],
  ["Lines", "lines"],
];

function formatPct(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : "n/a";
}

export function formatCoverageReport(summary) {
  const total = summary?.total ?? {};
  const rows = METRICS.map(([label, key]) => `| ${label} | ${formatPct(total[key]?.pct)} |`);

  return [
    COVERAGE_MARKER,
    "### Coverage",
    "",
    "| Metric | Coverage |",
    "| --- | ---: |",
    ...rows,
    "",
    "Full HTML coverage details are uploaded as the `coverage-report` workflow artifact.",
    "",
  ].join("\n");
}

export function readCoverageSummary(summaryPath) {
  return JSON.parse(fs.readFileSync(summaryPath, "utf8"));
}

function main() {
  const summaryPath = process.argv[2] ?? "coverage/coverage-summary.json";
  const summary = readCoverageSummary(summaryPath);
  process.stdout.write(formatCoverageReport(summary));
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}
