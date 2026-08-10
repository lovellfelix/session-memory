#!/usr/bin/env bash
# MCP Servers Setup Script
# Installs dependencies and builds the active MCP servers
# Run after: git clone + stow (or as part of bootstrap.sh)
#
# Usage:
#   ./setup.sh          # Build MCP servers
#   ./setup.sh --link   # Build and create global npm links (optional)
#   ./setup.sh --check  # Check if servers are ready (for CI/scripts)
#   ./setup.sh --clean  # Clean build artifacts and reinstall
#   ./setup.sh --status # Show versions, paths, and database sizes

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Auto-switch to .nvmrc version if nvm is available
    if [[ -f "$SCRIPT_DIR/.nvmrc" ]]; then
        # Set NVM_DIR if not already set (common locations)
        if [[ -z "${NVM_DIR:-}" ]]; then
            if [[ -s "$HOME/.config/nvm/nvm.sh" ]]; then
                export NVM_DIR="$HOME/.config/nvm"
            elif [[ -s "$HOME/.nvm/nvm.sh" ]]; then
                export NVM_DIR="$HOME/.nvm"
            fi
        fi
        
        # Load and use nvm if available
        if [[ -n "${NVM_DIR:-}" ]] && [[ -s "$NVM_DIR/nvm.sh" ]]; then
            # shellcheck disable=SC1091
            source "$NVM_DIR/nvm.sh"
            log_info "Using Node version from .nvmrc: $(cat "$SCRIPT_DIR/.nvmrc")"
            nvm use &>/dev/null || log_warn "nvm use failed, continuing with current Node"
        fi
    fi
    
    if ! command -v node &>/dev/null; then
        log_error "Node.js is not installed. Please install Node.js >= 18.0.0"
        log_info "  macOS: brew install node"
        log_info "  Linux: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
        exit 1
    fi
    
    local node_version
    node_version=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$node_version" -lt 18 ]]; then
        log_error "Node.js version must be >= 18.0.0 (found: $(node -v))"
        exit 1
    fi
    
    if ! command -v npm &>/dev/null; then
        log_error "npm is not installed"
        exit 1
    fi
    
    # Check for native build tools (used by optional native dependencies)
    if [[ "$(uname)" == "Darwin" ]]; then
        if ! xcode-select -p &>/dev/null; then
            log_warn "Xcode Command Line Tools not installed. Native modules may fail."
            log_info "  Run: xcode-select --install"
        fi
    elif [[ "$(uname)" == "Linux" ]]; then
        if ! command -v make &>/dev/null || ! command -v g++ &>/dev/null; then
            log_warn "Build tools (make, g++) not found. Native modules may fail."
            log_info "  Ubuntu/Debian: sudo apt-get install build-essential"
            log_info "  Fedora: sudo dnf groupinstall 'Development Tools'"
        fi
    fi
    
    log_success "Prerequisites satisfied (Node.js $(node -v), npm $(npm -v))"
}

check_server_ready() {
    local server_name="$1"
    local server_dir="$SCRIPT_DIR"
    
    if [[ ! -f "$server_dir/dist/index.js" ]]; then
        return 1
    fi
    
    if [[ ! -d "$server_dir/node_modules" ]]; then
        return 1
    fi
    
    # If optional native modules exist, verify they can load.
    if [[ -d "$server_dir/node_modules/better-sqlite3" ]]; then
        if ! node -e "require('$server_dir/node_modules/better-sqlite3')" 2>/dev/null; then
            return 1
        fi
    fi
    
    return 0
}

setup_server() {
    local server_name="$1"
    local force_clean="${2:-false}"
    local server_dir="$SCRIPT_DIR"
    
    if [[ ! -d "$server_dir" ]]; then
        log_warn "Server directory not found: $server_dir"
        return 1
    fi
    
    if [[ ! -f "$server_dir/package.json" ]]; then
        log_warn "No package.json found in $server_dir"
        return 1
    fi
    
    log_info "Setting up $server_name..."
    
    cd "$server_dir"
    
    # Clean if forced or if native modules might be stale
    if [[ "$force_clean" == "true" ]] || [[ -d "node_modules" && ! -f "node_modules/.package-lock.json" ]]; then
        log_info "  Cleaning previous installation..."
        rm -rf node_modules dist
    fi
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]] || [[ "package.json" -nt "node_modules/.package-lock.json" ]] 2>/dev/null; then
        log_info "  Installing dependencies..."
        if ! npm install --prefer-offline 2>&1 | while read -r line; do echo "    $line"; done; then
            log_error "  Failed to install dependencies for $server_name"
            return 1
        fi
        
        # Rebuild optional native modules only when present
        if [[ -d "node_modules/better-sqlite3" ]]; then
            log_info "  Rebuilding optional native modules..."
            if ! npm rebuild better-sqlite3 2>&1 | while read -r line; do echo "    $line"; done; then
                log_warn "  Optional native module rebuild had issues (may still work)"
            fi
        fi
    else
        log_info "  Dependencies up to date"
    fi
    
    # Build TypeScript if needed
    if [[ ! -f "dist/index.js" ]] || find src -name "*.ts" -newer dist/index.js 2>/dev/null | grep -q .; then
        log_info "  Building TypeScript..."
        if ! npm run build 2>&1 | while read -r line; do echo "    $line"; done; then
            log_error "  Failed to build $server_name"
            return 1
        fi
    else
        log_info "  Build up to date"
    fi
    
    # Verify build output
    if [[ ! -f "dist/index.js" ]]; then
        log_error "  Build output not found: dist/index.js"
        return 1
    fi
    
    # Make the entry point executable
    chmod +x "dist/index.js"
    
    log_success "$server_name setup complete"
    return 0
}

setup_global_links() {
    log_info "Setting up global npm links (optional)..."
    
    local linked=0
    
    for server in session-memory; do
        local server_dir="$SCRIPT_DIR"
        if [[ -f "$server_dir/dist/index.js" ]]; then
            cd "$server_dir"
            if npm link 2>/dev/null; then
                log_success "  Linked: mcp-$server"
                ((linked++)) || true
            else
                log_warn "  Failed to link mcp-$server (may require sudo)"
            fi
        fi
    done
    
    if [[ $linked -gt 0 ]]; then
        log_info "Global commands available:"
        [[ -f "$SCRIPT_DIR/dist/index.js" ]] && echo "  - mcp-session-memory"
    fi
}

verify_installation() {
    log_info "Verifying installation..."
    
    local all_ok=true
    
    for server in session-memory; do
        local server_dir="$SCRIPT_DIR"
        local entry_point="$server_dir/dist/index.js"
        
        if [[ ! -f "$entry_point" ]]; then
            log_error "  $server: dist/index.js not found"
            all_ok=false
            continue
        fi
        
        # Quick syntax check
        if ! node --check "$entry_point" 2>/dev/null; then
            log_error "  $server: JavaScript syntax error"
            all_ok=false
            continue
        fi
        
        # Verify optional native modules load correctly (catches NODE_MODULE_VERSION mismatch)
        if [[ -d "$server_dir/node_modules/better-sqlite3" ]]; then
            if ! node -e "require('$server_dir/node_modules/better-sqlite3')" 2>/dev/null; then
                log_error "  $server: Native module (better-sqlite3) failed to load"
                log_info "    Try: $0 --clean"
                all_ok=false
                continue
            fi
        fi
        
        log_success "  $server: Ready"
    done
    
    if [[ "$all_ok" == "true" ]]; then
        echo ""
        log_success "MCP servers are ready to use!"
        echo ""
        log_info "Paths:"
        echo "  session-memory: ~/projects/session-memory/dist/index.js (or \$SESSION_MEMORY_ROOT if set)"
        return 0
    else
        return 1
    fi
}

format_bytes() {
    local bytes="$1"
    if [[ $bytes -ge 1073741824 ]]; then
        echo "$(echo "scale=2; $bytes / 1073741824" | bc)GB"
    elif [[ $bytes -ge 1048576 ]]; then
        echo "$(echo "scale=2; $bytes / 1048576" | bc)MB"
    elif [[ $bytes -ge 1024 ]]; then
        echo "$(echo "scale=2; $bytes / 1024" | bc)KB"
    else
        echo "${bytes}B"
    fi
}

show_status() {
    echo ""
    echo "========================================"
    echo "  MCP Servers Status"
    echo "========================================"
    echo ""
    
    # System info
    log_info "System"
    echo "  Node.js:    $(node -v 2>/dev/null || echo 'not installed')"
    echo "  npm:        $(npm -v 2>/dev/null || echo 'not installed')"
    echo "  Platform:   $(uname -s) $(uname -m)"
    echo ""
    
    # Server status
    for server in session-memory; do
        local server_dir="$SCRIPT_DIR"
        local status_icon="❌"
        local status_text="Not ready"
        
        if check_server_ready "$server" 2>/dev/null; then
            status_icon="✅"
            status_text="Ready"
        fi
        
        log_info "$server $status_icon $status_text"
        
        # Entry point path
        local entry_point="$server_dir/dist/index.js"
        if [[ -f "$entry_point" ]]; then
            echo "  Entry:      $entry_point"
            local mtime
            mtime=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$entry_point" 2>/dev/null || \
                    stat -c "%y" "$entry_point" 2>/dev/null | cut -d. -f1 || echo "unknown")
            echo "  Built:      $mtime"
        else
            echo "  Entry:      (not built)"
        fi
        
        # Package version
        if [[ -f "$server_dir/package.json" ]]; then
            local version
            version=$(grep '"version"' "$server_dir/package.json" | head -1 | sed 's/.*": *"//' | sed 's/".*//')
            echo "  Version:    ${version:-unknown}"
        fi
        
        # node_modules status
        if [[ -d "$server_dir/node_modules" ]]; then
            local nm_size
            nm_size=$(du -sk "$server_dir/node_modules" 2>/dev/null | cut -f1)
            echo "  Modules:    $(format_bytes $((nm_size * 1024)))"
        else
            echo "  Modules:    (not installed)"
        fi
        
        # Native module status
        if [[ -d "$server_dir/node_modules/better-sqlite3" ]]; then
            if node -e "require('$server_dir/node_modules/better-sqlite3')" 2>/dev/null; then
                echo "  SQLite:     Native module OK"
            else
                echo "  SQLite:     Optional native module BROKEN (run --clean)"
            fi
        fi
        
        echo ""
    done
    
    # Database info
    log_info "Databases"
    
    local canonical_session_db="$HOME/.agents/memory/session.db"
    local legacy_session_db="$HOME/.opencode/sessions/session.db"
    local session_db="$canonical_session_db"
    if [[ ! -f "$session_db" && -f "$legacy_session_db" ]]; then
        session_db="$legacy_session_db"
    fi
    if [[ -f "$session_db" ]]; then
        local db_size
        db_size=$(stat -f%z "$session_db" 2>/dev/null || stat -c%s "$session_db" 2>/dev/null || echo "0")
        echo "  session-memory: $(format_bytes "$db_size")"
        echo "    Path: $session_db"
    else
        echo "  session-memory: (not created)"
        echo "    Path: $session_db"
    fi
    
    local vault_dir="$HOME/knowledgebase"
    if [[ -d "$vault_dir" ]]; then
        local note_count
        note_count=$(find "$vault_dir" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
        echo "  Work notes:     $note_count markdown files"
        echo "    Path: $vault_dir"
    else
        echo "  Work notes:     (vault not found)"
        echo "    Path: $vault_dir"
    fi
    
    echo ""
    echo "========================================"
}

show_help() {
    echo "MCP Servers Setup Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  (none)     Build MCP servers (install deps, compile TypeScript)"
    echo "  --check    Check if servers are ready (exit 0 if ready, 1 if not)"
    echo "  --clean    Clean build artifacts and reinstall from scratch"
    echo "  --status   Show versions, paths, and database sizes"
    echo "  --link     Build and create global npm links (optional)"
    echo "  --help     Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0              # Standard setup for fresh clone"
    echo "  $0 --check      # Verify servers are ready"
    echo "  $0 --clean      # Force clean rebuild"
    echo "  $0 --status     # Show system status"
}

main() {
    local mode="build"
    local force_clean=false
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --check)
                mode="check"
                shift
                ;;
            --clean)
                force_clean=true
                shift
                ;;
            --status)
                mode="status"
                shift
                ;;
            --link)
                mode="link"
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Check mode - just verify servers are ready
    if [[ "$mode" == "check" ]]; then
        local all_ready=true
        for server in session-memory; do
            if ! check_server_ready "$server"; then
                all_ready=false
            fi
        done
        if [[ "$all_ready" == "true" ]]; then
            log_success "All MCP servers are ready"
            exit 0
        else
            log_warn "MCP servers need setup. Run: $0"
            exit 1
        fi
    fi
    
    # Status mode - show versions, paths, db sizes
    if [[ "$mode" == "status" ]]; then
        show_status
        exit 0
    fi
    
    echo ""
    echo "========================================"
    echo "  MCP Servers Setup"
    echo "========================================"
    echo ""
    
    check_prerequisites
    
    local success=0
    local failed=0
    
    for server in session-memory; do
        if setup_server "$server" "$force_clean"; then
            ((success++)) || true
        else
            ((failed++)) || true
        fi
        echo ""
    done
    
    # Setup global links if requested
    if [[ "$mode" == "link" ]]; then
        setup_global_links
        echo ""
    fi
    
    echo "========================================"
    if [[ $failed -eq 0 ]]; then
        verify_installation
    else
        log_warn "$success succeeded, $failed failed"
        exit 1
    fi
    echo "========================================"
    echo ""
    
    if [[ "$mode" != "link" ]]; then
        log_info "Note: Global npm links are optional. OpenCode uses direct paths."
    fi
}

main "$@"
