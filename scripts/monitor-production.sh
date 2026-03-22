#!/bin/bash
# monitor-production.sh - Real-time production monitoring

DB_PATH="$HOME/.opencode/sessions/session.db"
LOG_FILE="/tmp/mcp-session-memory.log"

echo "📊 MCP Session-Memory Production Monitor"
echo "========================================"
echo ""

while true; do
  clear
  echo "📊 MCP Session-Memory - $(date '+%Y-%m-%d %H:%M:%S')"
  echo "========================================"
  echo ""
  
  # Recent operations (last 5 minutes)
  echo "🔄 Recent Operations (last 5 min):"
  sqlite3 "$DB_PATH" "
    SELECT 
      strftime('%H:%M:%S', timestamp) as time,
      operation,
      ROUND(duration_ms, 2) || 'ms' as duration
    FROM performance_metrics
    WHERE timestamp > datetime('now', '-5 minutes')
    ORDER BY timestamp DESC
    LIMIT 10;
  " | column -t -s '|'
  echo ""
  
  # Performance summary
  echo "⚡ Performance Summary (last hour):"
  sqlite3 "$DB_PATH" "
    SELECT 
      operation,
      COUNT(*) as calls,
      ROUND(AVG(duration_ms), 2) || 'ms' as avg,
      ROUND(MAX(duration_ms), 2) || 'ms' as max
    FROM performance_metrics
    WHERE timestamp > datetime('now', '-1 hour')
    GROUP BY operation
    ORDER BY COUNT(*) DESC
    LIMIT 5;
  " | column -t -s '|'
  echo ""
  
  # Error rate (last hour)
  ERROR_COUNT=$(grep -c '"level":"error"' "$LOG_FILE" 2>/dev/null || echo "0")
  TOTAL_COUNT=$(wc -l < "$LOG_FILE" 2>/dev/null || echo "1")
  ERROR_RATE=$(awk "BEGIN {printf \"%.2f\", ($ERROR_COUNT/$TOTAL_COUNT)*100}")
  echo "❌ Error Rate (last hour): $ERROR_RATE% ($ERROR_COUNT errors)"
  echo ""
  
  # Database stats
  echo "💾 Database Stats:"
  sqlite3 "$DB_PATH" "
    SELECT 
      'Sessions' as type, COUNT(*) as count FROM session_context
    UNION ALL
    SELECT 'Preferences', COUNT(*) FROM user_preferences
    UNION ALL
    SELECT 'Conventions', COUNT(*) FROM project_conventions
    UNION ALL
    SELECT 'Interactions', COUNT(*) FROM interaction_history;
  " | column -t -s '|'
  echo ""
  
  echo "Press Ctrl+C to exit. Refreshing every 10 seconds..."
  sleep 10
done
