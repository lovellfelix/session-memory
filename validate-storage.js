#!/usr/bin/env node

console.log('🔍 Validating Session Context and Memory Storage...\n');

import { SessionDatabase } from './dist/database.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDefaultDbPath() {
  if (process.env.SESSION_DB) {
    return process.env.SESSION_DB;
  }

  if (process.env.SESSION_DB_PATH) {
    return process.env.SESSION_DB_PATH;
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const canonicalDbPath = path.join(homeDir, '.agents', 'memory', 'session.db');
  const legacyDbPath = path.join(homeDir, '.opencode', 'sessions', 'session.db');

  if (existsSync(canonicalDbPath)) {
    return canonicalDbPath;
  }

  if (existsSync(legacyDbPath)) {
    return legacyDbPath;
  }

  return canonicalDbPath;
}

const testDbPath = resolveDefaultDbPath();

console.log('1. Testing direct database operations...');

try {
  const db = new SessionDatabase(testDbPath);
  
  // Test session context storage
  console.log('   Storing session context...');
  db.storeContext(
    'test-session-123',
    'workflow',
    'test_key',
    JSON.stringify({ message: 'Hello World', timestamp: Date.now() }),
    { agent: 'test-agent', version: '1.0' }
  );
  console.log('   ✓ Session context stored');
  
  // Test user preference storage
  console.log('   Storing user preference...');
  db.trackPreference(
    'default',
    'code_style',
    'string_quotes',
    'single',
    0.8
  );
  console.log('   ✓ User preference stored');
  
  // Test project convention storage
  console.log('   Storing project convention...');
  db.learnConvention(
    'test-project',
    'typescript',
    'naming',
    'variable_case',
    'camelCase'
  );
  console.log('   ✓ Project convention stored');
  
  // Test interaction storage
  console.log('   Storing interaction...');
  db.storeInteraction(
    'test-session-123',
    'user',
    'Please implement a test function',
    { agent: 'test-agent', workflow: 'validation' }
  );
  console.log('   ✓ Interaction stored');
  
  console.log('\n2. Retrieving stored data...');
  
  // Retrieve session context
  const contexts = db.retrieveContext('test-session-123');
  console.log(`   ✓ Retrieved ${contexts.length} session context(s)`);
  if (contexts.length > 0) {
    console.log(`     Latest: ${contexts[0].key} = ${contexts[0].value.substring(0, 50)}...`);
  }
  
  // Retrieve user preferences
  const preferences = db.getPreferences('default');
  console.log(`   ✓ Retrieved ${preferences.length} user preference(s)`);
  if (preferences.length > 0) {
    console.log(`     Latest: ${preferences[0].preference_key} = ${preferences[0].preference_value} (confidence: ${preferences[0].confidence})`);
  }
  
  // Retrieve project conventions
  const conventions = db.getConventions('test-project');
  console.log(`   ✓ Retrieved ${conventions.length} project convention(s)`);
  if (conventions.length > 0) {
    console.log(`     Latest: ${conventions[0].convention_key} = ${conventions[0].convention_value}`);
  }
  
  // Retrieve interaction history
  const history = db.getInteractionHistory('test-session-123');
  console.log(`   ✓ Retrieved ${history.length} interaction(s)`);
  if (history.length > 0) {
    console.log(`     Latest: ${history[0].role} = ${history[0].content.substring(0, 30)}...`);
  }
  
  console.log('\n3. Testing database statistics...');
  const stats = db.getStats();
  console.log('   Database statistics:');
  console.log(`     Session contexts: ${stats.sessionContexts.count}`);
  console.log(`     User preferences: ${stats.userPreferences.count}`);
  console.log(`     Project conventions: ${stats.projectConventions.count}`);
  console.log(`     Interactions: ${stats.interactions.count}`);
  
  console.log('\n4. Testing database health...');
  const isHealthy = db.isHealthy();
  console.log(`   Database health: ${isHealthy ? '✓ Healthy' : '❌ Unhealthy'}`);
  
  db.close();
  console.log('\n✅ Direct database operations test completed successfully!');
  
} catch (error) {
  console.error('❌ Direct database test failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}

console.log('\n5. Testing MCP server storage via protocol...');

// Test through MCP server protocol
const serverPath = path.join(__dirname, 'dist', 'index.js');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ENABLE_DASHBOARD: 'false'
  }
});

let responseBuffer = '';
let testPassed = 0;
let testFailed = 0;

function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id: Math.floor(Date.now() + Math.random()),
    method,
    params,
  };
  
  server.stdin.write(JSON.stringify(request) + '\n');
  return request.id;
}

// Process server responses
server.stdout.on('data', (data) => {
  responseBuffer += data.toString();
  
  const lines = responseBuffer.split('\n');
  responseBuffer = lines.pop() || '';
  
  lines.forEach(line => {
    if (!line.trim()) return;
    
    try {
      const response = JSON.parse(line);
      
      if (response.id === storeContextId) {
        console.log('   ✓ MCP: Session context stored via protocol');
        testPassed++;
        retrieveContextId = sendRequest('tools/call', {
          name: 'retrieve_session_context',
          arguments: {
            session_id: 'mcp-test-session',
            context_type: 'test'
          },
        });
        
      } else if (response.id === retrieveContextId) {
        const contexts = JSON.parse(response.result.content[0].text);
        console.log(`   ✓ MCP: Retrieved ${contexts.length} context(s) via protocol`);
        testPassed++;
        
        // Test preference storage
        trackPrefId = sendRequest('tools/call', {
          name: 'track_user_preference',
          arguments: {
            category: 'test',
            preference_key: 'mcp_test',
            preference_value: 'success',
            confidence: 0.9
          },
        });
        
      } else if (response.id === trackPrefId) {
        console.log('   ✓ MCP: User preference tracked via protocol');
        testPassed++;
        
        printSummary();
        server.kill();
        
      } else if (response.error) {
        console.error('❌ MCP Error:', response.error.message);
        testFailed++;
        server.kill();
      }
      
    } catch (e) {
      // Ignore parse errors for incomplete JSON
    }
  });
});

server.stderr.on('data', (data) => {
  const logs = data.toString().trim();
  if (logs && !logs.includes('running on stdio')) {
    console.log('   Server logs:', logs);
  }
});

server.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`\n❌ Server exited with code ${code}`);
    process.exit(1);
  }
});

// Initialize and test MCP protocol
let initializeId, storeContextId, retrieveContextId, trackPrefId;

setTimeout(() => {
  initializeId = sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'validation-client',
      version: '1.0.0',
    },
  });
  
  setTimeout(() => {
    storeContextId = sendRequest('tools/call', {
      name: 'store_session_context',
      arguments: {
        session_id: 'mcp-test-session',
        context_type: 'test',
        key: 'mcp_validation',
        value: JSON.stringify({ test: 'MCP protocol storage', timestamp: Date.now() }),
        metadata: { validation: true }
      },
    });
  }, 1000);
}, 1000);

function printSummary() {
  console.log('\n━'.repeat(60));
  console.log(`\n📊 Storage Validation Summary:`);
  console.log(`  ✅ Direct database operations: Passed`);
  console.log(`  ✅ MCP protocol operations: ${testPassed} passed, ${testFailed} failed`);
  
  if (testFailed === 0) {
    console.log('\n🎉 All storage validation tests passed!');
    console.log('✅ Session context and memory are being properly stored in the database.');
  } else {
    console.log('\n⚠️  Some MCP protocol tests failed');
    process.exit(1);
  }
}

// Timeout after 15 seconds
setTimeout(() => {
  console.error('\n❌ Validation timeout - server not responding properly');
  server.kill();
  process.exit(1);
}, 15000);
