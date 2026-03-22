#!/usr/bin/env bash
#
# Test script for database repair functionality
# Creates corrupted test databases and validates repair strategies
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR="$HOME/.opencode/sessions/test"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Setup test environment
setup() {
    log_info "Setting up test environment..."
    
    # Create test directory
    mkdir -p "$TEST_DIR"
    
    # Build TypeScript if needed
    if [[ ! -f "$PROJECT_ROOT/dist/index.js" ]]; then
        log_info "Building TypeScript..."
        cd "$PROJECT_ROOT"
        npm run build >/dev/null 2>&1 || {
            log_error "Build failed"
            exit 1
        }
    fi
    
    log_success "Test environment ready"
}

# Cleanup test environment
cleanup() {
    log_info "Cleaning up test environment..."
    rm -rf "$TEST_DIR"
    log_success "Cleanup complete"
}

# Create a valid test database
create_valid_database() {
    local db_path="$1"
    
    log_info "Creating valid test database at $db_path"
    
    # Use Node.js to create a valid database
    node -e "
    import initSqlJs from 'sql.js';
    import { writeFileSync } from 'fs';
    import { fileURLToPath } from 'url';
    import { dirname, join } from 'path';
    
    const __dirname = dirname(fileURLToPath(import.meta.url));
    
    (async () => {
        const wasmPath = join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
        const SQL = await initSqlJs({
            locateFile: (file) => file === 'sql-wasm.wasm' ? wasmPath : file
        });
        
        const db = new SQL.Database();
        
        // Create basic schema
        db.exec(\`
            CREATE TABLE user_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                preference_key TEXT NOT NULL,
                preference_value TEXT NOT NULL,
                confidence REAL DEFAULT 1.0,
                occurrences INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            INSERT INTO user_preferences (user_id, preference_key, preference_value)
            VALUES ('test-user', 'test-key', 'test-value');
        \`);
        
        const data = db.export();
        writeFileSync('$db_path', data);
        db.close();
        
        console.log('Valid database created');
    })();
    " >/dev/null 2>&1
}

# Simulate WAL corruption by creating a large WAL file
simulate_wal_corruption() {
    local db_path="$1"
    
    log_info "Simulating WAL corruption..."
    
    # Create a larger WAL file with random data
    dd if=/dev/urandom of="${db_path}-wal" bs=1024 count=512 2>/dev/null
    
    # Create an empty SHM file
    touch "${db_path}-shm"
    
    log_success "WAL corruption simulated"
}

# Test 1: Repair valid database (should succeed quickly)
test_repair_valid_database() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local test_db="$TEST_DIR/valid.db"
    
    log_info "Test 1: Repair valid database"
    
    create_valid_database "$test_db"
    
    # Run repair
    if node "$PROJECT_ROOT/dist/scripts/repair-database.js" "$test_db" 2>&1 | grep -q "SUCCESS"; then
        log_success "Valid database repaired successfully"
    else
        log_error "Valid database repair failed"
    fi
}

# Test 2: Repair database with WAL file
test_repair_with_wal() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local test_db="$TEST_DIR/with-wal.db"
    
    log_info "Test 2: Repair database with WAL file"
    
    create_valid_database "$test_db"
    simulate_wal_corruption "$test_db"
    
    # Run repair
    if node "$PROJECT_ROOT/dist/scripts/repair-database.js" "$test_db" 2>&1 | grep -q "SUCCESS"; then
        log_success "Database with WAL repaired successfully"
        
        # Verify WAL file was removed
        if [[ ! -f "${test_db}-wal" ]]; then
            log_success "WAL file cleaned up"
        else
            log_warning "WAL file still exists after repair"
        fi
    else
        log_error "Database with WAL repair failed"
    fi
}

# Test 3: Repair corrupted database (full recreation)
test_repair_corrupted_database() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local test_db="$TEST_DIR/corrupted.db"
    
    log_info "Test 3: Repair corrupted database"
    
    # Create a corrupted database (invalid SQLite header)
    echo "NOT A VALID SQLITE DATABASE FILE" > "$test_db"
    
    # Run repair
    if node "$PROJECT_ROOT/dist/scripts/repair-database.js" "$test_db" 2>&1 | grep -q "SUCCESS"; then
        log_success "Corrupted database recreated successfully"
        
        # Verify the database is now valid
        if node -e "
            import initSqlJs from 'sql.js';
            import { readFileSync } from 'fs';
            import { fileURLToPath } from 'url';
            import { dirname, join } from 'path';
            
            const __dirname = dirname(fileURLToPath(import.meta.url));
            
            (async () => {
                const wasmPath = join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
                const SQL = await initSqlJs({
                    locateFile: (file) => file === 'sql-wasm.wasm' ? wasmPath : file
                });
                
                const buffer = readFileSync('$test_db');
                const db = new SQL.Database(buffer);
                
                // Try to query a table
                db.exec('SELECT COUNT(*) FROM user_preferences');
                db.close();
                
                console.log('Database is valid');
            })();
        " >/dev/null 2>&1; then
            log_success "Recreated database is valid"
        else
            log_error "Recreated database is invalid"
        fi
    else
        log_error "Corrupted database repair failed"
    fi
}

# Test 4: Verify backup creation
test_backup_creation() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local test_db="$TEST_DIR/backup-test.db"
    
    log_info "Test 4: Verify backup creation"
    
    create_valid_database "$test_db"
    
    # Run repair
    node "$PROJECT_ROOT/dist/scripts/repair-database.js" "$test_db" >/dev/null 2>&1
    
    # Check if backup was created
    if ls "${test_db}.backup."* 1>/dev/null 2>&1; then
        log_success "Backup file created"
        
        # Verify backup is valid
        local backup_file=$(ls "${test_db}.backup."* | head -1)
        if [[ -f "$backup_file" && -s "$backup_file" ]]; then
            log_success "Backup file is non-empty"
        else
            log_error "Backup file is empty"
        fi
    else
        log_error "No backup file created"
    fi
}

# Test 5: Verify schema recreation
test_schema_recreation() {
    TESTS_RUN=$((TESTS_RUN + 1))
    local test_db="$TEST_DIR/schema-test.db"
    
    log_info "Test 5: Verify schema recreation"
    
    # Create corrupted database
    echo "CORRUPTED" > "$test_db"
    
    # Run repair
    node "$PROJECT_ROOT/dist/scripts/repair-database.js" "$test_db" >/dev/null 2>&1
    
    # Check if all critical tables exist
    if node -e "
        import initSqlJs from 'sql.js';
        import { readFileSync } from 'fs';
        import { fileURLToPath } from 'url';
        import { dirname, join } from 'path';
        
        const __dirname = dirname(fileURLToPath(import.meta.url));
        
        (async () => {
            const wasmPath = join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
            const SQL = await initSqlJs({
                locateFile: (file) => file === 'sql-wasm.wasm' ? wasmPath : file
            });
            
            const buffer = readFileSync('$test_db');
            const db = new SQL.Database(buffer);
            
            const tables = ['session_contexts', 'user_preferences', 'project_conventions', 'interactions', 'tasks'];
            const result = db.exec(\`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name IN (\${tables.map(t => \"'\" + t + \"'\").join(',')})
            \`);
            
            if (result[0]?.values?.length === 5) {
                console.log('All tables exist');
                process.exit(0);
            } else {
                console.error('Missing tables');
                process.exit(1);
            }
        })();
    " >/dev/null 2>&1; then
        log_success "All critical tables created"
    else
        log_error "Missing critical tables"
    fi
}

# Main test runner
main() {
    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Database Repair Test Suite"
    echo "═══════════════════════════════════════════════════════"
    echo ""
    
    setup
    
    test_repair_valid_database
    test_repair_with_wal
    test_repair_corrupted_database
    test_backup_creation
    test_schema_recreation
    
    cleanup
    
    # Print summary
    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Test Summary"
    echo "═══════════════════════════════════════════════════════"
    echo ""
    echo "Total tests: $TESTS_RUN"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
    echo ""
    
    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}✓ All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

# Handle script arguments
case "${1:-run}" in
    run)
        main
        ;;
    clean)
        cleanup
        ;;
    *)
        echo "Usage: $0 [run|clean]"
        exit 1
        ;;
esac
