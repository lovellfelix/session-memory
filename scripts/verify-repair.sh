#!/usr/bin/env bash
#
# Simple verification script for database repair
# Checks that the repaired database is healthy
#

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

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

DB_PATH="${1:-$(resolve_db_path)}"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Database Health Verification"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Database: $DB_PATH"
echo ""

# Check 1: File exists
echo -n "✓ File exists: "
if [[ -f "$DB_PATH" ]]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Check 2: SQLite integrity
echo -n "✓ Integrity check: "
if sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>&1 | grep -q "^ok$"; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>&1 | head -10
    exit 1
fi

# Check 3: Tables exist
echo -n "✓ Critical tables: "
TABLE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('session_contexts', 'user_preferences', 'project_conventions', 'interactions', 'tasks');" 2>/dev/null)
if [[ "$TABLE_COUNT" == "5" ]]; then
    echo -e "${GREEN}PASS (5/5)${NC}"
else
    echo -e "${RED}FAIL ($TABLE_COUNT/5)${NC}"
    exit 1
fi

# Check 4: Tables are queryable
echo -n "✓ Tables queryable: "
ERRORS=0
for table in session_contexts user_preferences project_conventions interactions tasks; do
    if ! sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM $table LIMIT 1;" >/dev/null 2>&1; then
        echo -e "${RED}FAIL${NC}"
        echo "  Error querying $table"
        ERRORS=1
    fi
done

if [[ $ERRORS -eq 0 ]]; then
    echo -e "${GREEN}PASS${NC}"
else
    exit 1
fi

# Check 5: WAL file size
WAL_PATH="${DB_PATH}-wal"
if [[ -f "$WAL_PATH" ]]; then
    WAL_SIZE=$(stat -f%z "$WAL_PATH" 2>/dev/null || stat -c%s "$WAL_PATH" 2>/dev/null)
    echo -n "✓ WAL file: "
    if [[ $WAL_SIZE -lt 1024 ]]; then
        echo -e "${GREEN}Clean (${WAL_SIZE} bytes)${NC}"
    else
        echo -e "${BLUE}${WAL_SIZE} bytes (acceptable)${NC}"
    fi
else
    echo "✓ WAL file: Not present (clean)"
fi

# Print row counts
echo ""
echo "Data summary:"
sqlite3 "$DB_PATH" "
    SELECT '  Preferences: ' || COUNT(*) FROM user_preferences
    UNION ALL
    SELECT '  Conventions: ' || COUNT(*) FROM project_conventions
    UNION ALL
    SELECT '  Interactions: ' || COUNT(*) FROM interactions
    UNION ALL
    SELECT '  Contexts: ' || COUNT(*) FROM session_contexts
    UNION ALL
    SELECT '  Tasks: ' || COUNT(*) FROM tasks;
" 2>/dev/null

echo ""
echo -e "${GREEN}✓ Database is healthy${NC}"
echo ""
