import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FORMATIONS } from "../../src/engine/common/types";
import { FORMATION_SLOTS } from "../../src/engine/lineup/formations";
import { freshDb } from "../support/db";

describe("SQL <-> TypeScript parity", () => {
  let pool: Pool;
  beforeAll(() => { pool = freshDb("touchline_it_parity"); });
  afterAll(async () => pool.end());
  it("formation slots are identical", async () => {
    for (const f of FORMATIONS) {
      const r = await pool.query(`select public.formation_slots($1) s`, [f]);
      expect(r.rows[0].s).toEqual(FORMATION_SLOTS[f]);
    }
  });
});

describe("security invariants", () => {
  let pool: Pool;
  beforeAll(() => { pool = freshDb("touchline_it_security"); });
  afterAll(async () => pool.end());

  it("every public table has RLS enabled and no client write grants", async () => {
    const noRls = await pool.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(noRls.rows).toEqual([]);
    const writes = await pool.query(
      `select table_name, privilege_type, grantee from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
          and not (table_name = 'profiles' and privilege_type = 'UPDATE')`);
    expect(writes.rows).toEqual([]);
  });

  it("anon can execute no public function", async () => {
    const r = await pool.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') and p.prokind = 'f'
`);
    expect(r.rows.map((x) => x.proname)).toEqual([]);
  });

  it("server-only commands are not executable by authenticated users", async () => {
    for (const fn of ["create_game_tx(uuid, jsonb)", "begin_matchday(uuid, integer)", "finalize_fixture(uuid, jsonb)", "complete_matchday(uuid, integer, jsonb)", "end_season(uuid, jsonb)", "_ledger(uuid, uuid, text, bigint, text, text, integer, integer)", "_execute_transfer(uuid)"]) {
      const r = await pool.query(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') ok`);
      expect([fn, r.rows[0].ok]).toEqual([fn, false]);
    }
  });
});
