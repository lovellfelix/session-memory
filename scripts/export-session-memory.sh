#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_db_path="$HOME/.agents/memory/session.db"
legacy_db_path="$HOME/.opencode/sessions/session.db"

if [[ -n "${SESSION_DB:-}" ]]; then
  db_path="$SESSION_DB"
elif [[ -f "$default_db_path" ]]; then
  db_path="$default_db_path"
elif [[ -f "$legacy_db_path" ]]; then
  db_path="$legacy_db_path"
else
  db_path="$default_db_path"
fi

out_dir="${SESSION_MEMORY_EXPORT_DIR:-$HOME/.agents/memory/exports}"
timestamp="$(date +%Y%m%d%H%M%S)"
out_path="$out_dir/session-memory-export-$timestamp.json"

mkdir -p "$out_dir"

[[ -f "$db_path" ]] || die "database not found: $db_path"
have node || die "node not found"

tmp_path="${out_path}.tmp"

node "$script_dir/export-session-memory.mjs" --db "$db_path" "$@" >"$tmp_path"
mv "$tmp_path" "$out_path"

encrypted_path=""
encryption_mode="${SESSION_MEMORY_ENCRYPTION_MODE:-}"
if [[ -n "$encryption_mode" ]]; then
  case "$encryption_mode" in
    age)
      [[ -n "${AGE_RECIPIENT:-}" ]] || die "AGE_RECIPIENT is required for age encryption"
      have age || die "age not found (install age or set SESSION_MEMORY_ENCRYPTION_MODE=)"
      encrypted_path="${out_path}.age"
      age -r "$AGE_RECIPIENT" -o "$encrypted_path" "$out_path"
      rm -f "$out_path"
      ;;
    openssl)
      [[ -n "${SESSION_MEMORY_PASSPHRASE:-}" ]] || die "SESSION_MEMORY_PASSPHRASE is required for openssl encryption"
      have openssl || die "openssl not found (or set SESSION_MEMORY_ENCRYPTION_MODE=)"
      encrypted_path="${out_path}.enc"
      openssl enc -aes-256-gcm -salt -pbkdf2 -iter 100000 \
        -pass "env:SESSION_MEMORY_PASSPHRASE" \
        -in "$out_path" -out "$encrypted_path"
      rm -f "$out_path"
      ;;
    *)
      die "unknown SESSION_MEMORY_ENCRYPTION_MODE: $encryption_mode (expected: age|openssl)"
      ;;
  esac
fi

final_path="${encrypted_path:-$out_path}"

if [[ -n "${SESSION_MEMORY_EXPORT_S3_URI:-}" ]]; then
  if have aws; then
    aws s3 cp "$final_path" "${SESSION_MEMORY_EXPORT_S3_URI%/}/$(basename "$final_path")" >/dev/null
  else
    echo "warning: aws cli not found; skipping S3 upload" >&2
  fi
fi

echo "ok: export created: $final_path"
