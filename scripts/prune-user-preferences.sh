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
user_id="default"
apply_changes=false
auto_confirm=false

for arg in "$@"; do
  case "$arg" in
    --apply)
      apply_changes=true
      ;;
    --yes)
      auto_confirm=true
      ;;
    --dry-run)
      apply_changes=false
      ;;
    -h|--help)
      echo "Usage: $0 [user_id] [--dry-run] [--apply] [--yes]"
      echo ""
      echo "Safe by default: --dry-run is the default behavior."
      echo "Use --apply to delete non-keep preference keys."
      echo "Use --yes with --apply for non-interactive confirmation."
      exit 0
      ;;
    --*)
      echo "error: unknown option: $arg" >&2
      exit 1
      ;;
    *)
      user_id="$arg"
      ;;
  esac
done

have node || { echo "error: node not found" >&2; exit 1; }

[[ -f "$db_path" ]] || { echo "error: database not found: $db_path" >&2; exit 1; }

timestamp="$(date +%Y%m%d%H%M%S)"
backup_dir="${SESSION_MEMORY_BACKUP_DIR:-$HOME/.agents/memory/backups}"
mkdir -p "$backup_dir"

backup_path="$backup_dir/session.db.backup-prune-$timestamp"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
report_path="$backup_dir/prune-report-$timestamp.json"

if [[ "$apply_changes" == false ]]; then
  echo "DRY RUN: no preferences will be deleted"
  node "$script_dir/prune-user-preferences.mjs" --db "$db_path" --user "$user_id" --report "$report_path" --dry-run
  echo "ok: prune preview report: $report_path"
  echo "Run with --apply to perform deletion."
  exit 0
fi

if [[ "$auto_confirm" == false ]]; then
  if [[ -t 0 ]]; then
    echo "About to prune user_preferences for user '$user_id' in: $db_path"
    read -r -p "Type 'apply' to continue: " response
    [[ "$response" == "apply" ]] || { echo "Canceled."; exit 1; }
  else
    echo "error: --apply in non-interactive mode requires --yes" >&2
    exit 1
  fi
fi

cp "$db_path" "$backup_path"
echo "ok: backup created: $backup_path"

node "$script_dir/prune-user-preferences.mjs" --db "$db_path" --user "$user_id" --report "$report_path"

echo "ok: prune report: $report_path"

"$script_dir/health-check-db.sh" >/dev/null
echo "ok: health check passed"
