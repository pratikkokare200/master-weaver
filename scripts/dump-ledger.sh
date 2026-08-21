#!/usr/bin/env sh
# =============================================================================================
# dump-ledger.sh — capture the local ledger as a restorable, self-verifying SQL file.
#
#     sh scripts/dump-ledger.sh                       # -> .scratch/ledger-<utc>.sql
#     OUT=my-dump.sql sh scripts/dump-ledger.sh
#
# Data only. The schema comes from supabase/migrations, which is the only place it is allowed to
# come from — a dump carrying its own DDL is a second, silently diverging source of truth for a
# schema every other environment was built from.
#
# ONE pg_dump invocation, deliberately. Six separate ones would be six separate snapshots, and the
# worker writes a run every fifteen minutes: a dump torn across a run insert can hold a `runs` row
# whose `job_id` points at a job captured before that job existed. One call is one snapshot, and
# pg_dump orders the tables so the foreign keys resolve as they load.
# =============================================================================================
set -eu

CONTAINER="${DB_CONTAINER:-supabase_db_Master_Weaver}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
OUT="${OUT:-.scratch/ledger-$(date -u +%Y%m%dT%H%M%SZ).sql}"

# The six tables of the ledger, and only those. Everything else in the database belongs to Supabase
# — auth, storage, realtime — and already exists on the destination.
TABLES="-t public.collectors -t public.golden_baselines -t public.jobs -t public.runs -t public.healing_episodes -t public.healing_attempts"

mkdir -p "$(dirname "$OUT")"

# pg_dump from INSIDE the container, so the client version always matches the server version. A
# server newer than the client is the one direction pg_dump refuses outright, and it refuses after
# connecting rather than before.
docker exec "$CONTAINER" pg_dump \
  -U "$DB_USER" -d "$DB_NAME" \
  --data-only \
  --no-owner --no-privileges \
  $TABLES > "$OUT"

# ---------------------------------------------------------------------------------------------
# The assertion, appended so the check travels with the file and runs on the destination rather
# than depending on someone remembering to count rows afterwards. Under a --single-transaction
# restore a failed assertion rolls the whole load back: a wrong restore leaves nothing behind.
#
# The expected counts are read out of the dump itself — COPY text format escapes newlines inside
# values, so one line is exactly one row — rather than from a second query against a database that
# has kept running. Counting separately would race the cron and fail a dump that was perfectly good.
#
# Exact equality, not "at least". Restoring onto an already-seeded database would otherwise report
# success while holding a duplicate collector.
#
# Schema-qualified, because pg_dump opens the file by setting search_path to '' — a deliberate
# hardening against a schema shadowing a table name, and it holds for everything that follows in
# the same session, this block included.
# ---------------------------------------------------------------------------------------------
awk '
  /^COPY public\.[a-z_]+ /            { split($2, p, "."); table = p[2]; n = 0; next }
  table && /^\\.$/                   { count[table] = n; order[++k] = table; table = ""; next }
  table                               { n++ }
  END {
    print "";
    print "-- Written by scripts/dump-ledger.sh. Counted from the COPY blocks above, so it";
    print "-- describes this file rather than the database this file came from.";
    print "do $$ declare n bigint; begin";
    for (i = 1; i <= k; i++) {
      t = order[i];
      printf "  select count(*) into n from public.%s;\n", t;
      printf "  if n <> %d then raise exception '\''%s: expected %d rows, found %%'\'', n; end if;\n", count[t], t, count[t];
    }
    print "  raise notice '\''ledger restored: row counts match the dump'\'';";
    print "end $$;";
  }
' "$OUT" >> "$OUT.assert"
cat "$OUT.assert" >> "$OUT"
rm -f "$OUT.assert"

echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
awk '/^COPY public\.[a-z_]+ /{split($2,p,"."); t=p[2]; n=0; next} t && /^\\.$/{printf "  %-18s %d\n", t, n; t=""; next} t{n++}' "$OUT"

# A dump taken while the queue has work in it carries that work to the destination, where a fresh
# worker picks it up and spends credits re-running it. Said at capture time rather than left to be
# discovered on the invoice.
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c "
  select 'WARNING: ' || count(*) || ' job(s) captured in a non-terminal state — see docs/MIGRATION.md step 6'
    from jobs where state in ('PENDING', 'CLAIMED') having count(*) > 0"
