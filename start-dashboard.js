#!/usr/bin/env node

import { createWebServer } from "./dist/web-server.js"
import { SessionDatabase } from "./dist/database.js"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// Default configuration
const DEFAULT_PORT = 3001
const DEFAULT_HOST = "localhost"

function resolveDefaultDbPath() {
  if (process.env.SESSION_DB) {
    return process.env.SESSION_DB
  }

  if (process.env.SESSION_DB_PATH) {
    return process.env.SESSION_DB_PATH
  }

  const canonicalDbPath = join(homedir(), ".agents", "memory", "session.db")
  const legacyDbPath = join(homedir(), ".opencode", "sessions", "session.db")

  if (existsSync(canonicalDbPath)) {
    return canonicalDbPath
  }

  if (existsSync(legacyDbPath)) {
    return legacyDbPath
  }

  return canonicalDbPath
}

// Environment variable configuration
const config = {
  port: parseInt(process.env.DASHBOARD_PORT || process.env.PORT || DEFAULT_PORT.toString()),
  host: process.env.DASHBOARD_HOST || process.env.HOST || DEFAULT_HOST,
  dbPath: resolveDefaultDbPath(),
  apiToken: process.env.MCP_DASHBOARD_TOKEN,
  enableCors: process.env.ENABLE_CORS !== "false",
  logLevel: process.env.LOG_LEVEL || "info",
  openBrowser: process.env.OPEN_BROWSER === "true",
}

// Validate port range
if (config.port < 1 || config.port > 65535) {
  console.error(`❌ Invalid port: ${config.port} (must be between 1-65535)`)
  process.exit(1)
}

// Server instance reference for graceful shutdown
let server = null
let database = null
let isShuttingDown = false

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log("⚠️  Shutdown already in progress...")
    return
  }

  isShuttingDown = true
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)

  try {
    // Close server connections
    if (server) {
      console.log("🔌 Closing server connections...")
      await server.close()
      console.log("✅ Server connections closed")
    }

    // Close database connections
    if (database) {
      console.log("💾 Closing database connections...")
      database.close()
      console.log("✅ Database connections closed")
    }

    console.log("👋 Dashboard shutdown complete")
    process.exit(0)
  } catch (error) {
    console.error("❌ Error during shutdown:", error.message)
    process.exit(1)
  }
}

// Health check helper
async function performHealthCheck() {
  try {
    const response = await fetch(`http://${config.host}:${config.port}/api/health/ready`)
    if (response.ok) {
      const data = await response.json()
      return data.ready === true
    }
    return false
  } catch {
    return false
  }
}

// Open browser helper - uses execFile to prevent command injection
async function openBrowser(url) {
  const { execFile } = await import("child_process")

  // Validate URL to prevent command injection
  try {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol)) {
      console.log("ℹ️  Skipping browser open: invalid URL protocol")
      return
    }
  } catch {
    console.log("ℹ️  Skipping browser open: invalid URL")
    return
  }

  const platform = process.platform

  // Use execFile with arguments array (safe from shell injection)
  const commands = {
    darwin: { cmd: "open", args: [url] },
    win32: { cmd: "cmd", args: ["/c", "start", "", url] },
    linux: { cmd: "xdg-open", args: [url] },
  }

  const { cmd, args } = commands[platform] || commands.linux

  execFile(cmd, args, error => {
    if (error) {
      console.log(`ℹ️  Could not auto-open browser: ${error.message}`)
    }
  })
}

async function startDashboard() {
  try {
    console.log("🚀 Starting Session Memory Dashboard...")
    console.log("")

    // Display configuration
    console.log("📋 Configuration:")
    console.log(`   • Host: ${config.host}`)
    console.log(`   • Port: ${config.port}`)
    console.log(`   • Database: ${config.dbPath}`)
    console.log(
      `   • Authentication: ${config.apiToken ? "✅ Enabled" : "⚠️  Disabled (set MCP_DASHBOARD_TOKEN to enable)"}`
    )
    console.log(`   • CORS: ${config.enableCors ? "Enabled" : "Disabled"}`)
    console.log("")

    // Check database exists
    if (!existsSync(config.dbPath)) {
      console.log(`⚠️  Database not found at ${config.dbPath}`)
      console.log("   Creating new database...")
    }

    // Initialize database
    database = new SessionDatabase(config.dbPath)
    await database.initialize()
    console.log("✅ Database initialized")

    // Create and start web server
    server = await createWebServer({
      port: config.port,
      host: config.host,
      database,
      apiToken: config.apiToken,
    })

    console.log("")
    console.log("┌─────────────────────────────────────────────────┐")
    console.log("│  ✅ Dashboard is ready!                         │")
    console.log("├─────────────────────────────────────────────────┤")
    console.log(`│  🌐 URL: http://${config.host}:${config.port.toString().padEnd(28)} │`)
    console.log(`│  📡 API: http://${config.host}:${config.port}/api/*`.padEnd(50) + " │")
    console.log("├─────────────────────────────────────────────────┤")
    console.log("│  Press Ctrl+C to stop the server               │")
    console.log("└─────────────────────────────────────────────────┘")
    console.log("")

    // Perform readiness check
    console.log("🔍 Performing health check...")
    const isReady = await performHealthCheck()
    if (isReady) {
      console.log("✅ Health check passed - dashboard is ready")
    } else {
      console.log("⚠️  Health check failed - dashboard may not be fully ready")
    }
    console.log("")

    // Auto-open browser if requested
    if (config.openBrowser) {
      console.log("🌐 Opening dashboard in browser...")
      await openBrowser(`http://${config.host}:${config.port}`)
    }

    // Register shutdown handlers
    process.on("SIGINT", () => gracefulShutdown("SIGINT"))
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
    process.on("SIGHUP", () => gracefulShutdown("SIGHUP"))

    // Handle uncaught errors
    process.on("uncaughtException", error => {
      console.error("❌ Uncaught exception:", error)
      gracefulShutdown("uncaughtException")
    })

    process.on("unhandledRejection", (reason, promise) => {
      console.error("❌ Unhandled rejection at:", promise, "reason:", reason)
      gracefulShutdown("unhandledRejection")
    })
  } catch (error) {
    console.error("")
    console.error("❌ Failed to start dashboard")
    console.error("")

    if (error.code === "EADDRINUSE") {
      console.error(`Port ${config.port} is already in use.`)
      console.error("")
      console.error("Solutions:")
      console.error(`  1. Use a different port: DASHBOARD_PORT=3002 npm run dashboard`)
      console.error(`  2. Stop the process using port ${config.port}`)
      console.error(`  3. Find the process: lsof -ti:${config.port} | xargs kill`)
    } else if (error.code === "EACCES") {
      console.error(`Permission denied to bind to port ${config.port}.`)
      console.error("")
      console.error("Solutions:")
      console.error("  1. Use a port above 1024: DASHBOARD_PORT=3001 npm run dashboard")
      console.error("  2. Run with elevated privileges (not recommended)")
    } else {
      console.error("Error details:", error.message)
      if (error.stack) {
        console.error("")
        console.error("Stack trace:")
        console.error(error.stack)
      }
    }

    console.error("")
    process.exit(1)
  }
}

// Start the dashboard
startDashboard()
