// PR rules enforced in CI (CONTRIBUTING.md §5): a PR that adds or changes a migration must have a filled-in
// "## Rollback plan" section, with at least the **Database:** part answered.
// CI usage: PR_BODY, BASE_SHA and HEAD_SHA in the environment → node scripts/ci/check-pr-rules.mjs
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MIGRATION = /^supabase\/migrations\/.+\.sql$/;
const PLACEHOLDER = /^(n\/?a|none|tbd|todo|-+|\.+|\?+)$/i;

/** Text of a "## Heading" section (HTML comments removed), or null if the heading is missing. */
export function section(body, heading) {
  const text = (body ?? "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  const m = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im").exec(text);
  return m ? m[1] : null;
}

/** Value of a "- **Label:** value" bullet inside a section (continuation lines included). */
export function field(sectionText, label) {
  const m = new RegExp(`\\*\\*${label}:?\\*\\*:?([\\s\\S]*?)(?=\\n\\s*[-*]\\s+\\*\\*|$)`, "i").exec(sectionText ?? "");
  return m ? m[1].trim() : "";
}

const filled = (v) => v.length >= 8 && !PLACEHOLDER.test(v.replace(/[`*_]/g, "").trim());

/** @returns {{ required: boolean, ok: boolean, problems: string[] }} */
export function checkPr({ files, body }) {
  const migrations = files.filter((f) => MIGRATION.test(f));
  if (!migrations.length) return { required: false, ok: true, problems: [] };
  const problems = [];
  const plan = section(body, "Rollback plan");
  if (plan === null) {
    problems.push('The PR description has no "## Rollback plan" section.');
  } else {
    if (!filled(field(plan, "Database"))) {
      problems.push('"Rollback plan → Database" is empty: give the SQL that undoes the migration, or "forward-fix only" and why.');
    }
    if (!filled(field(plan, "Code"))) problems.push('"Rollback plan → Code" is empty: e.g. "Vercel Instant Rollback to the previous deployment".');
  }
  return { required: true, ok: problems.length === 0, problems, migrations };
}

function main() {
  const { PR_BODY = "", BASE_SHA, HEAD_SHA, GITHUB_STEP_SUMMARY } = process.env;
  if (!BASE_SHA || !HEAD_SHA) throw new Error("BASE_SHA and HEAD_SHA are required");
  const files = execFileSync("git", ["diff", "--name-only", `${BASE_SHA}...${HEAD_SHA}`], { encoding: "utf8" }).split("\n").filter(Boolean);
  const r = checkPr({ files, body: PR_BODY });
  const summary = !r.required
    ? "No migrations changed — rollback plan not required."
    : r.ok
      ? `Migrations changed (${r.migrations.join(", ")}) — rollback plan present.`
      : [`Migrations changed (${r.migrations.join(", ")}) but the rollback plan is incomplete:`, ...r.problems.map((p) => `- ${p}`),
        "", "Edit the PR description (this check re-runs on edit). Rules and an example: CONTRIBUTING.md §5."].join("\n");
  console.log(summary);
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, `### PR rules\n\n${summary}\n`);
  for (const p of r.problems) console.log(`::error title=Rollback plan required::${p}`);
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
