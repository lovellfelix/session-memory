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

[[ $# -ge 1 ]] || die "usage: $0 <export.json|export.json.age|export.json.enc> [--overwrite] [--session-id ID] [--db PATH]"

file_path="$1"
shift

have node || die "node not found"
[[ -f "$file_path" ]] || die "file not found: $file_path"

tmp=""
cleanup() {
  [[ -n "$tmp" ]] && rm -f "$tmp" || true
}
trap cleanup EXIT

input_path="$file_path"
case "$file_path" in
  *.age)
    have age || die "age not found (required to decrypt .age)"
    tmp="$(mktemp -t session-memory-import.XXXXXX.json)"
    age -d -i "${AGE_IDENTITY_FILE:-$HOME/.config/age/keys.txt}" -o "$tmp" "$file_path"
    input_path="$tmp"
    ;;
  *.enc)
    [[ -n "${SESSION_MEMORY_PASSPHRASE:-}" ]] || die "SESSION_MEMORY_PASSPHRASE is required to decrypt .enc"
    have openssl || die "openssl not found (required to decrypt .enc)"
    tmp="$(mktemp -t session-memory-import.XXXXXX.json)"
    openssl enc -d -aes-256-gcm -pbkdf2 -iter 100000 \
      -pass "env:SESSION_MEMORY_PASSPHRASE" \
      -in "$file_path" -out "$tmp"
    input_path="$tmp"
    ;;
esac

node "$script_dir/import-session-memory.mjs" --db "$db_path" --file "$input_path" "$@"
