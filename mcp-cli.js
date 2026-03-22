#!/usr/bin/env node

// Simple CLI tool to interact with MCP Session Memory server
import { SessionDatabase } from './dist/database.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveDefaultDbPath() {
  if (process.env.SESSION_DB) {
    return process.env.SESSION_DB;
  }

  if (process.env.SESSION_DB_PATH) {
    return process.env.SESSION_DB_PATH;
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const canonicalDbPath = join(homeDir, '.agents', 'memory', 'session.db');
  const legacyDbPath = join(homeDir, '.opencode', 'sessions', 'session.db');

  if (existsSync(canonicalDbPath)) {
    return canonicalDbPath;
  }

  if (existsSync(legacyDbPath)) {
    return legacyDbPath;
  }

  return canonicalDbPath;
}

const DB_PATH = resolveDefaultDbPath();

function showHelp() {
  console.log(`
🔧 MCP Session Memory CLI

Usage: node mcp-cli.js <command> [options]

Commands:
  stats                    Show database statistics
  recent [limit]           Show recent activity (default: 5)
  health                   Check database health
  add-pref <user> <cat> <key> <value> [conf]
  add-interaction <session> <role> <content>
  add-context <session> <type> <key> <value>
  search <term>           Search across all data

Examples:
  node mcp-cli.js stats
  node mcp-cli.js recent 10
  node mcp-cli.js add-pref default code_style string_quotes double 0.9
  node mcp-cli.js add-interaction my-session user "Help me write tests"
  node mcp-cli.js add-context my-session workflow feature_name "user auth"
  node mcp-cli.js search authentication

Environment Variables:
  SESSION_DB / SESSION_DB_PATH   Path to database file
                                 (default: ~/.agents/memory/session.db; legacy fallback: ~/.opencode/sessions/session.db)
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  try {
    const db = new SessionDatabase(DB_PATH);

    switch (command) {
      case 'stats':
        const stats = db.getStats();
        console.log('📊 Database Statistics:');
        console.log(`   Session Contexts: ${stats.sessionContexts.count}`);
        console.log(`   User Preferences: ${stats.userPreferences.count}`);
        console.log(`   Project Conventions: ${stats.projectConventions.count}`);
        console.log(`   Interactions: ${stats.interactions.count}`);
        break;

      case 'recent':
        const limit = parseInt(args[1]) || 5;
        const activity = db.getRecentActivity(limit);
        
        console.log(`🕐 Recent Activity (Last ${limit} items per category):\n`);
        
        if (activity.interactions.length > 0) {
          console.log('💬 Interactions:');
          activity.interactions.forEach(int => {
            const time = new Date(int.created_at).toLocaleString();
            console.log(`   ${int.role} (${int.session_id}) - ${time}`);
          });
        }
        
        if (activity.preferences.length > 0) {
          console.log('\n⚙️  Preferences:');
          activity.preferences.forEach(pref => {
            const time = new Date(pref.updated_at).toLocaleString();
            console.log(`   ${pref.preference_key} = ${pref.preference_value} (${pref.user_id}, confidence: ${pref.confidence}) - ${time}`);
          });
        }
        
        if (activity.contexts.length > 0) {
          console.log('\n📝 Contexts:');
          activity.contexts.forEach(ctx => {
            const time = new Date(ctx.updated_at).toLocaleString();
            console.log(`   ${ctx.context_type}/${ctx.key} = ${ctx.value} (${ctx.session_id}) - ${time}`);
          });
        }
        break;

      case 'health':
        const isHealthy = db.isHealthy();
        console.log(`🏥 Database Health: ${isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
        break;

      case 'add-pref':
        if (args.length < 5) {
          console.error('❌ Missing required arguments for add-pref');
          console.log('Usage: add-pref <user> <category> <key> <value> [confidence]');
          process.exit(1);
        }
        const [, , user, category, key, value, confidence] = args;
        db.trackPreference(user, category, key, value, parseFloat(confidence) || 1.0);
        console.log(`✅ Added preference: ${key} = ${value} for user ${user}`);
        break;

      case 'add-interaction':
        if (args.length < 4) {
          console.error('❌ Missing required arguments for add-interaction');
          console.log('Usage: add-interaction <session> <role> <content>');
          process.exit(1);
        }
        const [, , session, role, ...contentParts] = args;
        const content = contentParts.join(' ');
        db.storeInteraction(session, role, content);
        console.log(`✅ Added interaction: ${role} message in session ${session}`);
        break;

      case 'add-context':
        if (args.length < 6) {
          console.error('❌ Missing required arguments for add-context');
          console.log('Usage: add-context <session> <type> <key> <value>');
          process.exit(1);
        }
        const [, , ctxSession, type, ctxKey, ...valueParts] = args;
        const ctxValue = valueParts.join(' ');
        db.storeContext(ctxSession, type, ctxKey, ctxValue);
        console.log(`✅ Added context: ${type}/${ctxKey} = ${ctxValue}`);
        break;

      case 'search':
        if (args.length < 2) {
          console.error('❌ Missing search term');
          console.log('Usage: search <term>');
          process.exit(1);
        }
        const searchTerm = args[1];
        console.log(`🔍 Searching for "${searchTerm}":\n`);
        
        // Search in preferences
        const prefs = db.getPreferences('default'); // Search all users would need modification
        const matchingPrefs = prefs.filter(p => 
          p.preference_key.includes(searchTerm) || 
          p.preference_value.includes(searchTerm) ||
          p.category.includes(searchTerm)
        );
        
        if (matchingPrefs.length > 0) {
          console.log('📋 Matching Preferences:');
          matchingPrefs.forEach(p => {
            console.log(`   ${p.preference_key} = ${p.preference_value} (${p.category}, confidence: ${p.confidence})`);
          });
        }
        
        // Search in contexts
        const contexts = db.retrieveContext(); // Get all contexts
        const matchingContexts = contexts.filter(c =>
          c.key.includes(searchTerm) ||
          c.value.includes(searchTerm) ||
          c.context_type.includes(searchTerm) ||
          c.session_id.includes(searchTerm)
        );
        
        if (matchingContexts.length > 0) {
          console.log('\n📝 Matching Contexts:');
          matchingContexts.forEach(c => {
            console.log(`   ${c.session_id}/${c.context_type}/${c.key} = ${c.value.substring(0, 100)}${c.value.length > 100 ? '...' : ''}`);
          });
        }
        
        if (matchingPrefs.length === 0 && matchingContexts.length === 0) {
          console.log('   No matches found');
        }
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log('Use "help" to see available commands');
        process.exit(1);
    }

    db.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
