import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPr, field, section } from "../../scripts/ci/check-pr-rules.mjs";

const MIGRATION = "supabase/migrations/20261022000017_perf_indexes.sql";
const template = readFileSync(".github/pull_request_template.md", "utf8");

describe("PR rules: rollback plan for migrations", () => {
  it("is not required when no migration changes", () => {
    expect(checkPr({ files: ["src/app/page.tsx", "docs/x.md"], body: "" })).toMatchObject({ required: false, ok: true });
  });

  it("fails without a Rollback plan section", () => {
    const r = checkPr({ files: [MIGRATION], body: "## Summary\nAdds indexes." });
    expect(r).toMatchObject({ required: true, ok: false });
    expect(r.problems[0]).toMatch(/no "## Rollback plan" section/);
  });

  it("fails on the untouched template (placeholders and comments don't count)", () => {
    const r = checkPr({ files: [MIGRATION], body: template });
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(2);
  });

  it("fails when Database is a non-answer", () => {
    const body = "## Rollback plan\n- **Code:** Vercel Instant Rollback\n- **Database:** N/A\n- **Data:** none";
    expect(checkPr({ files: [MIGRATION], body }).problems).toEqual([expect.stringMatching(/Database/)]);
  });

  it("passes with a filled plan, including multi-line SQL and CRLF bodies", () => {
    const body = [
      "## Summary", "Indexes.", "",
      "## Rollback plan", "<!-- guidance -->",
      "- **Code:** Vercel Instant Rollback to the previous deployment",
      "- **Database:** not required (indexes only). If needed:", "  `drop index if exists public.mps_club_idx;`",
      "- **Data:** no data changes", "- **Point of no return:** none", "",
      "## Reviewer notes", "-",
    ].join("\r\n");
    expect(checkPr({ files: [MIGRATION, "src/x.ts"], body })).toMatchObject({ required: true, ok: true, problems: [] });
    expect(field(section(body, "Rollback plan"), "Database")).toContain("drop index if exists");
  });

  it("accepts 'forward-fix only' with a reason", () => {
    const body = "## Rollback plan\n- **Code:** git revert the merge commit\n- **Database:** forward-fix only: the new column is nullable and unused by old code";
    expect(checkPr({ files: [MIGRATION], body }).ok).toBe(true);
  });
});
