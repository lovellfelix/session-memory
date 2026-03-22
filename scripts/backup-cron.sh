#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

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
backup_dir="${SESSION_MEMORY_BACKUP_DIR:-$HOME/.agents/memory/backups}"
backup_file="session.db.backup-$(date +%Y%m%d%H%M%S)"
backup_path="$backup_dir/$backup_file"

mkdir -p "$backup_dir"

if [[ ! -f "$db_path" ]]; then
  die "database not found: $db_path"
fi

if have sqlite3; then
  sqlite3 "$db_path" ".backup '$backup_path'"
else
  echo "warning: sqlite3 not found; using file copy fallback (WAL may be inconsistent)" >&2
  cp "$db_path" "$backup_path"
  [[ -f "${db_path}-wal" ]] && cp "${db_path}-wal" "${backup_path}-wal" || true
  [[ -f "${db_path}-shm" ]] && cp "${db_path}-shm" "${backup_path}-shm" || true
fi

encrypted_path=""
encryption_mode="${SESSION_MEMORY_ENCRYPTION_MODE:-}"
if [[ -n "$encryption_mode" ]]; then
  case "$encryption_mode" in
    age)
      [[ -n "${AGE_RECIPIENT:-}" ]] || die "AGE_RECIPIENT is required for age encryption"
      have age || die "age not found (install age or set SESSION_MEMORY_ENCRYPTION_MODE=)"
      encrypted_path="${backup_path}.age"
      age -r "$AGE_RECIPIENT" -o "$encrypted_path" "$backup_path"
      rm -f "$backup_path"
      ;;
    openssl)
      [[ -n "${SESSION_MEMORY_PASSPHRASE:-}" ]] || die "SESSION_MEMORY_PASSPHRASE is required for openssl encryption"
      have openssl || die "openssl not found (or set SESSION_MEMORY_ENCRYPTION_MODE=)"
      encrypted_path="${backup_path}.enc"
      openssl enc -aes-256-gcm -salt -pbkdf2 -iter 100000 \
        -pass "env:SESSION_MEMORY_PASSPHRASE" \
        -in "$backup_path" -out "$encrypted_path"
      rm -f "$backup_path"
      ;;
    *)
      die "unknown SESSION_MEMORY_ENCRYPTION_MODE: $encryption_mode (expected: age|openssl)"
      ;;
  esac
fi

final_path="${encrypted_path:-$backup_path}"

find "$backup_dir" -name "session.db.backup-*" -mtime +7 -type f ! -name "*.gz" -exec gzip {} \;
find "$backup_dir" -name "session.db.backup-*.gz" -mtime +90 -type f -delete

if [[ -n "${SESSION_MEMORY_S3_URI:-}" ]]; then
  if have aws; then
    aws s3 cp "$final_path" "${SESSION_MEMORY_S3_URI%/}/$(basename "$final_path")" >/dev/null
  else
    echo "warning: aws cli not found; skipping S3 upload" >&2
  fi
fi

echo "ok: backup created: $final_path"
