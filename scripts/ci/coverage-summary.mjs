// Print coverage/coverage-summary.json as a Markdown table (for $GITHUB_STEP_SUMMARY).
// Usage: node scripts/ci/coverage-summary.mjs [path] >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from "node:fs";

const summary = JSON.parse(readFileSync(process.argv[2] ?? "coverage/coverage-summary.json", "utf8"));
const metrics = ["lines", "statements", "functions", "branches"];
const row = (name, m) => `| ${name} | ${metrics.map((k) => `${m[k].pct.toFixed(1)}%`).join(" | ")} |`;

const byArea = new Map();
for (const [file, m] of Object.entries(summary)) {
  if (file === "total") continue;
  const area = file.replace(/\\/g, "/").replace(/.*\/src\//, "src/").split("/").slice(0, 2).join("/");
  const acc = byArea.get(area) ?? Object.fromEntries(metrics.map((k) => [k, { covered: 0, total: 0 }]));
  for (const k of metrics) {
    acc[k].covered += m[k].covered;
    acc[k].total += m[k].total;
  }
  byArea.set(area, acc);
}

const lines = [
  "### Test coverage",
  "",
  `| Area | ${metrics.join(" | ")} |`,
  `|---|${metrics.map(() => "---:").join("|")}|`,
  row("**Total**", summary.total),
];
for (const [area, acc] of [...byArea].sort(([a], [b]) => a.localeCompare(b))) {
  const pct = Object.fromEntries(metrics.map((k) => [k, { pct: acc[k].total ? (100 * acc[k].covered) / acc[k].total : 100 }]));
  lines.push(row(area, pct));
}
console.log(lines.join("\n"));
