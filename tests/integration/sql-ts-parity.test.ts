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
