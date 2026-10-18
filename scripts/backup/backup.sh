#!/usr/bin/env bash
# Touchline backup with an automatic restore drill.
#
# 1. Opens a repeatable-read snapshot on the source DB and records the row count of every public table in it.
# 2. Dumps, from that same snapshot: public data (custom format), auth.users data, and the public schema (reference).
# 3. Restore drill: builds a fresh DB from supabase/migrations (scripts/db/local-reset.sh), loads the public data and
#    checks the row counts match table by table. A failure here means the backup is not restorable as-is (or prod has
#    drifted from the migrations) — the job fails and nothing is uploaded.
# 4. Bundles everything and encrypts it with age; the plaintext never leaves the machine running this.
#
# Env: BACKUP_DB_URL (source; Supabase *session* pooler, port 5432), DRILL_PG_URL (scratch server, no db name, superuser),
#      BACKUP_AGE_RECIPIENT (age public key), OUT_DIR (default backup-out). Restore steps: docs/runbook.md.
set -euo pipefail

: "${BACKUP_DB_URL:?BACKUP_DB_URL is required}"
: "${DRILL_PG_URL:?DRILL_PG_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required (age public key)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT_DIR:-backup-out}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
DRILL_DB="touchline_restore_drill"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

COUNTS_SQL="select coalesce(json_object_agg(t, n order by t), '{}') from (
  select tablename t, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', tablename), false, true, '')))[1]::text::bigint n
    from pg_tables where schemaname = 'public') x"

echo "== source: $(psql "$BACKUP_DB_URL" -qAtc 'show server_version') / client: $(pg_dump --version)"

# --- 1+2. consistent snapshot: counts and dumps see exactly the same data ---------------------------------------
coproc SNAP { psql "$BACKUP_DB_URL" -qAt -v ON_ERROR_STOP=1 2>&1; }
echo "begin isolation level repeatable read read only; select pg_export_snapshot();" >&"${SNAP[1]}"
read -r SNAPSHOT <&"${SNAP[0]}"
[[ "$SNAPSHOT" =~ ^[0-9A-F-]+$ ]] || { echo "could not export snapshot: $SNAPSHOT"; exit 1; }
echo "${COUNTS_SQL//$'\n'/ };" >&"${SNAP[1]}"
read -r SOURCE_COUNTS <&"${SNAP[0]}"
echo "$SOURCE_COUNTS" > "$WORK/counts.json"

pg_dump "$BACKUP_DB_URL" --snapshot="$SNAPSHOT" -Fc --data-only -n public -f "$WORK/public-data.dump"
pg_dump "$BACKUP_DB_URL" --snapshot="$SNAPSHOT" -Fc --data-only -t auth.users -f "$WORK/auth-users.dump"
pg_dump "$BACKUP_DB_URL" --snapshot="$SNAPSHOT" --schema-only -n public --no-owner -f "$WORK/public-schema.sql"
echo "commit;" >&"${SNAP[1]}"; exec {SNAP[1]}>&-; wait "$SNAP_PID" || true
echo "== dumped: $(du -h "$WORK/public-data.dump" | cut -f1) public data, $(du -h "$WORK/auth-users.dump" | cut -f1) auth.users"

# --- 3. restore drill ------------------------------------------------------------------------------------------
LOCAL_PG_URL="$DRILL_PG_URL" "$ROOT/scripts/db/local-reset.sh" "$DRILL_DB" >/dev/null
DRILL="$DRILL_PG_URL/$DRILL_DB"
# migrations seed a few reference rows; the backup carries the real ones
psql "$DRILL" -qv ON_ERROR_STOP=1 -c "do \$\$ declare t text; begin
  select string_agg(format('public.%I', tablename), ', ') into t from pg_tables where schemaname = 'public';
  if t is not null then execute 'truncate ' || t || ' cascade'; end if; end \$\$"
pg_restore --data-only --disable-triggers --no-owner --exit-on-error -d "$DRILL" "$WORK/public-data.dump"
pg_restore --list "$WORK/auth-users.dump" >/dev/null # archive integrity (the drill DB's auth schema is a stub)
RESTORED_COUNTS="$(psql "$DRILL" -qAtc "${COUNTS_SQL//$'\n'/ }")"
node -e '
  const [src, dst] = process.argv.slice(1).map((s) => JSON.parse(s));
  const bad = [];
  for (const [t, n] of Object.entries(src)) if (dst[t] !== n) bad.push(`${t}: source ${n}, restored ${dst[t] ?? "missing table"}`);
  for (const t of Object.keys(dst)) if (!(t in src)) bad.push(`${t}: in migrations but not in production (drift)`);
  const rows = Object.values(src).reduce((a, b) => a + b, 0);
  if (bad.length) { console.error("Restore drill FAILED:\n  " + bad.join("\n  ")); process.exit(1); }
  console.log(`== restore drill OK: ${Object.keys(src).length} tables, ${rows} rows match`);
' "$SOURCE_COUNTS" "$RESTORED_COUNTS"
psql "$DRILL_PG_URL/postgres" -qc "drop database if exists $DRILL_DB with (force)"

# --- 4. bundle + encrypt ---------------------------------------------------------------------------------------
cat > "$WORK/README.txt" <<EOF
Touchline backup $STAMP — restore steps: docs/runbook.md ("Restaurar de um backup").
public-data.dump   pg_dump -Fc --data-only -n public   (restore after the schema is created by supabase/migrations)
auth-users.dump    pg_dump -Fc --data-only -t auth.users
public-schema.sql  schema at backup time (reference / drift check)
counts.json        row count per public table at backup time
EOF
BUNDLE="$OUT/touchline-backup-$STAMP.tar.gz.age"
tar -C "$WORK" -czf - README.txt counts.json public-data.dump auth-users.dump public-schema.sql | age -r "$BACKUP_AGE_RECIPIENT" -o "$BUNDLE"
echo "== encrypted bundle: $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
