#!/usr/bin/env node

// Quick MCP integration check script
import { SessionDatabase } from './dist/database.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.SESSION_DB || join(process.env.HOME || '', '.opencode', 'sessions', 'session.db');

console.log('🔍 MCP Session Memory Integration Check\n');
console.log(`📁 Database: ${DB_PATH}`);

try {
  const db = new SessionDatabase(DB_PATH);
  
  // Health check
  const isHealthy = db.isHealthy();
  console.log(`\n✅ Database Health: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
  
  if (!isHealthy) {
    console.log('❌ Database is not accessible. Check permissions and paths.');
    process.exit(1);
  }

  // Get stats
  const stats = db.getStats();
  console.log('\n📊 Current Storage:');
  console.log(`   Session Contexts: ${stats.sessionContexts.count}`);
  console.log(`   User Preferences: ${stats.userPreferences.count}`);
  console.log(`   Project Conventions: ${stats.projectConventions.count}`);
  console.log(`   Interactions: ${stats.interactions.count}`);

  // Recent activity
  const activity = db.getRecentActivity(3);
  
  if (activity.interactions.length > 0) {
    console.log('\n💬 Recent Interactions:');
    activity.interactions.forEach(int => {
      const time = new Date(int.created_at).toLocaleString();
      console.log(`   ${int.role} (${int.session_id}): ${time}`);
    });
  }

  if (activity.preferences.length > 0) {
    console.log('\n⚙️  Recent Preferences:');
    activity.preferences.forEach(pref => {
      console.log(`   ${pref.preference_key} = ${pref.preference_value} (confidence: ${pref.confidence})`);
    });
  }

  // Test write operations
  console.log('\n🧪 Testing Write Operations...');
  
  const testId = `check-${Date.now()}`;
  
  // Test preference
  db.trackPreference(testId, 'test', 'integration_check', 'success', 1.0);
  const testPrefs = db.getPreferences(testId);
  const prefWorking = testPrefs.length === 1;
  console.log(`   User Preferences: ${prefWorking ? '✅ WORKING' : '❌ FAILED'}`);
  
  // Test interaction
  db.storeInteraction(testId, 'system', 'Integration check message');
  const testInteractions = db.getInteractionHistory(testId);
  const interactionWorking = testInteractions.length === 1;
  console.log(`   Interactions: ${interactionWorking ? '✅ WORKING' : '❌ FAILED'}`);
  
  // Test context
  db.storeContext(testId, 'test', 'check', 'integration test passed');
  const testContexts = db.retrieveContext(testId);
  const contextWorking = testContexts.length === 1;
  console.log(`   Session Contexts: ${contextWorking ? '✅ WORKING' : '❌ FAILED'}`);

  console.log('\n🎯 Integration Status:');
  if (prefWorking && interactionWorking && contextWorking) {
    console.log('   ✅ ALL SYSTEMS OPERATIONAL');
    console.log('   ✅ Your MCP server is properly recording interactions and preferences');
  } else {
    console.log('   ⚠️  Some systems may need attention');
  }

  console.log('\n📝 Usage Tips:');
  console.log('   • Agents should automatically call MCP tools during workflows');
  console.log('   • Check Claude Desktop MCP configuration if tools aren\'t available');
  console.log('   • Monitor this database for activity during agent usage');
  console.log('   • Use the dashboard (ENABLE_DASHBOARD=true) for visual monitoring');

  db.close();

} catch (error) {
  console.error('❌ Integration check failed:', error.message);
  console.log('\n🔧 Troubleshooting:');
  console.log('   • Ensure the database directory exists: ~/.opencode/sessions/');
  console.log('   • Check file permissions for the database');
  console.log('   • Verify the MCP server is built: npm run build');
  console.log('   • Check Claude Desktop configuration');
  process.exit(1);
}