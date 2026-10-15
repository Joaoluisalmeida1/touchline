#!/usr/bin/env bash
# Recreate a local Postgres database with the Supabase shim + all migrations (+ optional seed).
# Usage: LOCAL_PG_URL=postgres://postgres@localhost:54322 scripts/db/local-reset.sh [dbname]
set -euo pipefail
BASE="${LOCAL_PG_URL:-postgres://postgres@localhost:54322}"
DB="${1:-touchline_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
psql "$BASE/postgres" -qc "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
psql "$BASE/$DB" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/local/00_supabase_shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$BASE/$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || { echo "FAILED: $f"; exit 1; }
done
echo "ok: $BASE/$DB"
