#!/usr/bin/env bash
set -euo pipefail

have() { command -v "$1" >/dev/null 2>&1; }

resolve_db_path() {
  local canonical_db_path="$HOME/.agents/memory/session.db"
  local legacy_db_path="$HOME/.opencode/sessions/session.db"

  if [[ -n "${SESSION_DB:-}" ]]; then
    printf '%s\n' "$SESSION_DB"
    return
  fi

  if [[ -n "${SESSION_DB_PATH:-}" ]]; then
    printf '%s\n' "$SESSION_DB_PATH"
    return
  fi

  if [[ -f "$canonical_db_path" ]]; then
    printf '%s\n' "$canonical_db_path"
    return
  fi

  if [[ -f "$legacy_db_path" ]]; then
    printf '%s\n' "$legacy_db_path"
    return
  fi

  printf '%s\n' "$canonical_db_path"
}

db_path="$(resolve_db_path)"
user_id="${1:-default}"

have node || { echo "error: node not found" >&2; exit 1; }

[[ -f "$db_path" ]] || { echo "error: database not found: $db_path" >&2; exit 1; }

timestamp="$(date +%Y%m%d%H%M%S)"
backup_dir="${SESSION_MEMORY_BACKUP_DIR:-$HOME/.agents/memory/backups}"
mkdir -p "$backup_dir"

backup_path="$backup_dir/session.db.backup-prune-$timestamp"
cp "$db_path" "$backup_path"

echo "ok: backup created: $backup_path"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
report_path="$backup_dir/prune-report-$timestamp.json"

node "$script_dir/prune-user-preferences.mjs" --db "$db_path" --user "$user_id" --report "$report_path"

echo "ok: prune report: $report_path"

"$script_dir/health-check-db.sh" >/dev/null
echo "ok: health check passed"
