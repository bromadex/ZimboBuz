#!/usr/bin/env bash
# Applies supabase/migrations to a real Supabase database, in filename order,
# each in its own transaction, recording each one in
# supabase_migrations.schema_migrations (the table the Supabase CLI uses, so
# the CLI and Supabase's GitHub integration agree with this script later).
#
#   SUPABASE_DB_URL=postgresql://... supabase/deploy/migrate.sh check   # list what would run
#   SUPABASE_DB_URL=postgresql://... supabase/deploy/migrate.sh apply   # run it
#
# Prints "pending=<n>" as its last line.
set -euo pipefail

MODE="${1:-check}"
DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
export PGCONNECT_TIMEOUT=20
PSQL=(psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

"${PSQL[@]}" -c "
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text);"

applied="$("${PSQL[@]}" -At -c "select version from supabase_migrations.schema_migrations order by version")"
newest_applied="$(printf '%s\n' "$applied" | tail -n 1)"

# Every recorded migration must still exist here: a missing one means the
# database and the repository have gone different ways.
for v in $applied; do
  if ! compgen -G "$DIR/${v}_*.sql" > /dev/null; then
    echo "::error::The database has migration $v, which is not in supabase/migrations. Stopping." >&2
    exit 1
  fi
done

pending=()
for f in "$DIR"/*.sql; do
  base="$(basename "$f" .sql)"
  version="${base%%_*}"
  if ! printf '%s\n' "$applied" | grep -qx "$version"; then
    if [[ -n "$newest_applied" && "$version" < "$newest_applied" ]]; then
      echo "::error::Migration $base is older than $newest_applied, which is already applied. Rename it with a newer timestamp." >&2
      exit 1
    fi
    pending+=("$f")
  fi
done

echo "Applied already: $(printf '%s\n' "$applied" | grep -c . || true)"
echo "Waiting: ${#pending[@]}"
for f in "${pending[@]}"; do echo "  - $(basename "$f")"; done

if [[ "$MODE" == "apply" ]]; then
  for f in "${pending[@]}"; do
    base="$(basename "$f" .sql)"
    version="${base%%_*}"
    name="${base#*_}"
    record="$(mktemp)"
    printf "insert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" "$version" "$name" > "$record"
    echo "Applying $base"
    # The migration and its record succeed or fail together.
    "${PSQL[@]}" --single-transaction -f "$f" -f "$record"
    rm -f "$record"
  done
  echo "pending=0"
else
  echo "pending=${#pending[@]}"
fi
