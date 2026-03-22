#!/bin/bash
# rollback-immediate.sh - Emergency rollback procedure

set -euo pipefail

echo "🔄 Initiating immediate rollback..."

# 1. Stop the server (if running in dashboard mode)
pkill -f "mcp-session-memory" || true

# 2. Restore database from backup
DB_PATH="$HOME/.opencode/sessions/session.db"
BACKUP_PATH="$HOME/.opencode/sessions/backups/session.db.backup-$(date +%Y%m%d)"

if [ -f "$BACKUP_PATH" ]; then
  cp "$BACKUP_PATH" "$DB_PATH"
  echo "✅ Database restored from: $BACKUP_PATH"
else
  echo "❌ No backup found: $BACKUP_PATH"
  exit 1
fi

# 3. Checkout previous git commit
git checkout HEAD~1

# 4. Rebuild previous version
npm run build

# 5. Restart services
echo "✅ Rollback complete. Restart OpenCode/Claude Desktop."
