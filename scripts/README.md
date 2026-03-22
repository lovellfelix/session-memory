# Database Repair Scripts

Toolkit for repairing corrupted MCP session-memory databases.

## Quick Start

### Repair Corrupted Database
```bash
node dist/scripts/repair-database.js ~/.agents/memory/session.db
```

Default path resolution order: `SESSION_DB` / `SESSION_DB_PATH` → `~/.agents/memory/session.db` → legacy `~/.opencode/sessions/session.db`.

### Verify Database Health
```bash
./scripts/verify-repair.sh
```

### View Before/After Comparison
```bash
./scripts/repair-report.sh
```

## Scripts

### 1. repair-database.ts
**Purpose**: Repair corrupted SQLite databases  
**Language**: TypeScript  
**Location**: `scripts/repair-database.ts`

**Recovery Strategies** (in order):
1. **WAL Checkpoint** - Merge uncommitted write-ahead log transactions
2. **Integrity Check** - Verify database health
3. **Export/Import** - Extract recoverable data and reimport
4. **Full Recreation** - Create fresh database with schema

**Usage**:
```bash
# Repair default database
node dist/scripts/repair-database.js

# Repair specific database
node dist/scripts/repair-database.js /path/to/database.db
```

**Output**:
- Creates timestamped backup automatically
- Reports recovery strategy used
- Shows row counts of recovered data
- Exits with code 0 (success) or 1 (failure)

### 2. verify-repair.sh
**Purpose**: Verify database health after repair  
**Language**: Bash  
**Location**: `scripts/verify-repair.sh`

**Checks**:
- ✓ File exists
- ✓ SQLite integrity check passes
- ✓ All critical tables present (5/5)
- ✓ Tables are queryable
- ✓ WAL file cleaned
- ✓ Row counts for all tables

**Usage**:
```bash
# Verify default database
./scripts/verify-repair.sh

# Verify specific database
./scripts/verify-repair.sh /path/to/database.db
```

### 3. repair-report.sh
**Purpose**: Generate before/after comparison report  
**Language**: Bash  
**Location**: `scripts/repair-report.sh`

**Shows**:
- Before state (from backup)
- After state (repaired)
- Data loss analysis
- Recovery summary
- File locations

**Usage**:
```bash
./scripts/repair-report.sh
```

### 4. test-repair.sh
**Purpose**: Test suite for repair functionality  
**Language**: Bash  
**Location**: `scripts/test-repair.sh`

**Tests**:
1. Repair valid database
2. Repair database with WAL file
3. Repair corrupted database
4. Verify backup creation
5. Verify schema recreation

**Usage**:
```bash
# Run all tests
./scripts/test-repair.sh

# Clean test artifacts
./scripts/test-repair.sh clean
```

## Common Issues

### Issue: "database disk image is malformed"
**Cause**: Corrupted database or uncommitted WAL transactions  
**Solution**: Run repair script (WAL checkpoint usually fixes this)

### Issue: Large WAL file (>1MB)
**Cause**: Many uncommitted transactions or checkpoint not running  
**Solution**: Run repair script to force checkpoint

### Issue: "Database locked"
**Cause**: Another process is using the database  
**Solution**: Stop all MCP processes and retry

## Recovery Examples

### Example 1: Successful WAL Checkpoint
```
✓ Backup created: session.db.backup.2026-01-27T04-34-27
✓ WAL checkpoint: SUCCESS (recovered 503KB)
✓ Integrity check: PASSED
✓ Database repaired successfully

Recovered data:
  - 4 preferences
  - 2 conventions
  - 23 interactions
  - 0 contexts
  - 3 tasks
```

### Example 2: Full Recreation (Severe Corruption)
```
✓ Backup created: session.db.backup.2026-01-27T04-40-15
✗ WAL checkpoint: FAILED
✗ Integrity check: FAILED - database disk image is malformed
✓ Fresh database created with schema
✓ Database repaired successfully

Recovered data:
  - 0 preferences (data lost)
  - 0 conventions (data lost)
  - 0 interactions (data lost)
  - 0 contexts (data lost)
  - 0 tasks (data lost)
```

## Backup Management

### Automatic Backups
Every repair creates timestamped backups:
```
session.db.backup.YYYY-MM-DDTHH-MM-SS
session.db.backup.YYYY-MM-DDTHH-MM-SS-wal
session.db.backup.YYYY-MM-DDTHH-MM-SS-shm
```

### Manual Cleanup
```bash
# Remove old backups (keep last 3)
cd ~/.agents/memory
ls -t session.db.backup.* | tail -n +4 | xargs rm -f
```

### Restore from Backup
```bash
# Stop MCP server first
cp ~/.agents/memory/session.db.backup.YYYY-MM-DDTHH-MM-SS \
   ~/.agents/memory/session.db

# Verify restored database
./scripts/verify-repair.sh
```

## Development

### Build Scripts
```bash
# Build repair script
npx tsc scripts/repair-database.ts \
  --outDir dist/scripts \
  --module NodeNext \
  --moduleResolution NodeNext \
  --target ES2022 \
  --esModuleInterop

# Build entire project (includes repair script)
npm run build
```

### Dependencies
- **sql.js**: SQLite compiled to WebAssembly
- **TypeScript**: Compilation
- **Node.js**: Runtime (≥18.0.0)

### Testing
```bash
# Run test suite
./scripts/test-repair.sh

# Manual test
node dist/scripts/repair-database.js ~/.agents/memory/test.db
```

## Architecture

### Repair Flow
```
1. Backup Database
   ├─ session.db → session.db.backup.TIMESTAMP
   ├─ session.db-wal → backup-wal
   └─ session.db-shm → backup-shm

2. WAL Checkpoint
   ├─ Load database + WAL
   ├─ Force checkpoint (merge transactions)
   ├─ Export merged database
   └─ Remove old WAL/SHM files

3. Integrity Check
   ├─ PRAGMA integrity_check
   ├─ If OK: Success
   └─ If FAIL: Continue to next strategy

4. Export/Import (if needed)
   ├─ Extract all recoverable rows
   ├─ Create fresh database
   ├─ Import recovered data
   └─ Verify import

5. Fresh Recreation (last resort)
   ├─ Create new database
   ├─ Apply schema
   └─ Verify schema
```

### Error Handling
- Graceful fallback through recovery strategies
- Never deletes original without backup
- Detailed logging at each step
- Clear success/failure reporting

## Monitoring

### Health Check Script
```bash
#!/usr/bin/env bash
# Add to cron: 0 0 * * 0 (weekly)

DB_PATH="${SESSION_DB:-${SESSION_DB_PATH:-$HOME/.agents/memory/session.db}}"

# Check integrity
if ! sqlite3 "$DB_PATH" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  echo "WARNING: Database corruption detected"
  # Auto-repair
  node dist/scripts/repair-database.js "$DB_PATH"
fi

# Check WAL size
WAL_SIZE=$(stat -f%z "${DB_PATH}-wal" 2>/dev/null || echo "0")
if [[ $WAL_SIZE -gt 1048576 ]]; then
  echo "WARNING: Large WAL file (${WAL_SIZE} bytes)"
  # Force checkpoint
  sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(FULL);"
fi
```

## See Also

- **DATABASE_REPAIR_REPORT.md** - Detailed repair results for actual corruption fix
- **AGENTS.md** - MCP integration documentation
- **README.md** - Main project documentation
