#!/bin/bash
# restore-backup.sh - Restore database from backup
set -euo pipefail

DB_PATH="$HOME/.opencode/sessions/session.db"
BACKUP_DIR="$HOME/.opencode/sessions/backups"

die() {
    echo "❌ Error: $1" >&2
    exit 1
}

usage() {
    echo "Usage: $0 [BACKUP_FILE]"
    echo ""
    echo "Restore the session database from a backup file."
    echo ""
    echo "Options:"
    echo "  BACKUP_FILE  Specific backup file to restore (optional)"
    echo "               If not specified, lists available backups"
    echo ""
    echo "Examples:"
    echo "  $0                           # List available backups"
    echo "  $0 session.db.backup-20260118  # Restore specific backup"
    echo "  $0 latest                    # Restore most recent backup"
    echo ""
    exit 0
}

list_backups() {
    echo "📂 Available backups in $BACKUP_DIR:"
    echo ""
    
    if [[ ! -d "$BACKUP_DIR" ]]; then
        die "Backup directory does not exist: $BACKUP_DIR"
    fi
    
    # List uncompressed backups
    echo "Recent (uncompressed):"
    local count=0
    for backup in "$BACKUP_DIR"/session.db.backup-*; do
        if [[ -f "$backup" && ! "$backup" =~ \.gz$ ]]; then
            size=$(du -h "$backup" | cut -f1)
            date_part=$(basename "$backup" | sed 's/session.db.backup-//')
            echo "  $(basename "$backup") ($size) - $date_part"
            ((count++)) || true
        fi
    done
    
    if [[ $count -eq 0 ]]; then
        echo "  (none)"
    fi
    
    echo ""
    echo "Archived (compressed):"
    count=0
    for backup in "$BACKUP_DIR"/session.db.backup-*.gz; do
        if [[ -f "$backup" ]]; then
            size=$(du -h "$backup" | cut -f1)
            date_part=$(basename "$backup" | sed 's/session.db.backup-//' | sed 's/\.gz$//')
            echo "  $(basename "$backup") ($size) - $date_part"
            ((count++)) || true
        fi
    done
    
    if [[ $count -eq 0 ]]; then
        echo "  (none)"
    fi
    
    echo ""
    echo "To restore: $0 <backup_filename>"
}

get_latest_backup() {
    # Find most recent uncompressed backup first
    local latest
    latest=$(ls -t "$BACKUP_DIR"/session.db.backup-* 2>/dev/null | grep -v '\.gz$' | head -1 || true)
    
    if [[ -z "$latest" ]]; then
        # Fall back to most recent compressed backup
        latest=$(ls -t "$BACKUP_DIR"/session.db.backup-*.gz 2>/dev/null | head -1 || true)
    fi
    
    if [[ -z "$latest" ]]; then
        die "No backups found in $BACKUP_DIR"
    fi
    
    echo "$latest"
}

restore_backup() {
    local backup_file="$1"
    local is_compressed=false
    
    # Handle 'latest' keyword
    if [[ "$backup_file" == "latest" ]]; then
        backup_file=$(get_latest_backup)
        echo "📍 Latest backup: $(basename "$backup_file")"
    fi
    
    # Resolve full path if just filename given
    if [[ ! "$backup_file" =~ ^/ ]]; then
        backup_file="$BACKUP_DIR/$backup_file"
    fi
    
    # Check if file exists
    if [[ ! -f "$backup_file" ]]; then
        die "Backup file not found: $backup_file"
    fi
    
    # Check if compressed
    if [[ "$backup_file" =~ \.gz$ ]]; then
        is_compressed=true
    fi
    
    # Confirm restoration
    echo ""
    echo "⚠️  Warning: This will replace the current database!"
    echo ""
    echo "Current database: $DB_PATH"
    echo "Backup to restore: $backup_file"
    echo ""
    read -p "Are you sure you want to continue? [y/N] " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi
    
    # Create safety backup of current database
    if [[ -f "$DB_PATH" ]]; then
        local safety_backup="${DB_PATH}.pre-restore-$(date +%Y%m%d%H%M%S)"
        echo "📦 Creating safety backup: $(basename "$safety_backup")"
        cp "$DB_PATH" "$safety_backup"
    fi
    
    # Stop any running MCP server (graceful shutdown)
    echo "🛑 Note: Stop the MCP server before restoring for data integrity"
    
    # Restore the backup
    if [[ "$is_compressed" == true ]]; then
        echo "📂 Decompressing and restoring..."
        gunzip -c "$backup_file" > "$DB_PATH"
    else
        echo "📂 Restoring backup..."
        cp "$backup_file" "$DB_PATH"
    fi
    
    # Verify restored database
    if command -v sqlite3 &> /dev/null; then
        echo "🔍 Verifying restored database..."
        if sqlite3 "$DB_PATH" "PRAGMA integrity_check;" | grep -q "ok"; then
            echo "✅ Database integrity check passed"
        else
            echo "⚠️  Warning: Database integrity check returned issues"
        fi
        
        # Show some stats
        echo ""
        echo "📊 Restored database stats:"
        sqlite3 "$DB_PATH" "SELECT 'Session contexts: ' || COUNT(*) FROM session_context;"
        sqlite3 "$DB_PATH" "SELECT 'User preferences: ' || COUNT(*) FROM user_preferences;"
        sqlite3 "$DB_PATH" "SELECT 'Project conventions: ' || COUNT(*) FROM project_conventions;"
        sqlite3 "$DB_PATH" "SELECT 'Interactions: ' || COUNT(*) FROM interactions;"
    fi
    
    echo ""
    echo "✅ Restore completed successfully!"
    echo ""
    echo "Note: Restart the MCP server to use the restored database."
}

# Main
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
fi

if [[ -z "${1:-}" ]]; then
    list_backups
else
    restore_backup "$1"
fi
