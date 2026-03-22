#!/bin/bash
# rollback-database.sh - Database-only rollback procedure

set -euo pipefail

DB_PATH="$HOME/.opencode/sessions/session.db"
BACKUP_DIR="$HOME/.opencode/sessions/backups"

echo "🔄 Database rollback procedure..."

# List available backups
echo "Available backups:"
ls -lh "$BACKUP_DIR"

# Prompt for backup selection
read -p "Enter backup filename: " BACKUP_FILE

if [ ! -f "$BACKUP_DIR/$BACKUP_FILE" ]; then
  echo "❌ Backup not found: $BACKUP_DIR/$BACKUP_FILE"
  exit 1
fi

# Backup current database first
cp "$DB_PATH" "$DB_PATH.pre-rollback-$(date +%Y%m%d-%H%M)"

# Restore selected backup
cp "$BACKUP_DIR/$BACKUP_FILE" "$DB_PATH"

echo "✅ Database rolled back to: $BACKUP_FILE"
echo "   Current database backed up with .pre-rollback suffix"
