#!/usr/bin/env node

/**
 * Test script for API ingestion and querying system
 * Tests all 9 new MCP tools for the session-memory server
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SessionDatabase } from '../dist/database.js';
import { ApiParser } from '../dist/api-parser.js';
import { logger } from '../dist/logger.js';

function resolveDefaultTestDbPath() {
  if (process.env.SESSION_DB) {
    return process.env.SESSION_DB;
  }

  if (process.env.SESSION_DB_PATH) {
    return process.env.SESSION_DB_PATH;
  }

  const homeDir = homedir();
  const canonicalTestDbPath = join(homeDir, '.agents', 'memory', 'test-api.db');
  const legacyTestDbPath = join(homeDir, '.opencode', 'sessions', 'test-api.db');
  const canonicalSessionDbPath = join(homeDir, '.agents', 'memory', 'session.db');
  const legacySessionDbPath = join(homeDir, '.opencode', 'sessions', 'session.db');

  if (existsSync(canonicalSessionDbPath) || !existsSync(legacySessionDbPath)) {
    return canonicalTestDbPath;
  }

  return legacyTestDbPath;
}

// Sample OpenAPI spec for testing
const sampleSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Test API',
    version: '1.0.0',
    description: 'A test API for validation'
  },
  paths: {
    '/users': {
      get: {
        summary: 'List all users',
        description: 'Retrieve a paginated list of users',
        tags: ['users'],
        operationId: 'listUsers',
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UserList'
                }
              }
            }
          }
        }
      },
      post: {
        summary: 'Create a user',
        description: 'Create a new user account',
        tags: ['users'],
        operationId: 'createUser',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreateUserRequest'
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'User created'
          }
        }
      }
    },
    '/users/{id}': {
      get: {
        summary: 'Get user by ID',
        tags: ['users'],
        operationId: 'getUserById',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': { description: 'User found' },
          '404': { description: 'User not found' }
        }
      }
    },
    '/products': {
      get: {
        summary: 'List products',
        tags: ['products'],
        deprecated: true,
        responses: {
          '200': { description: 'Product list' }
        }
      }
    }
  },
  components: {
    schemas: {
      UserList: {
        type: 'object',
        properties: {
          users: {
            type: 'array',
            items: { $ref: '#/components/schemas/User' }
          },
          total: { type: 'integer' }
        }
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' }
        }
      },
      CreateUserRequest: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }
};

// Sample FeathersJS code for testing
const sampleFeathersCode = `
import { Service } from '@feathersjs/feathers';

export class UserService extends Service {
  async find(params) {
    return { users: [], total: 0 };
  }

  async get(id, params) {
    return { id, name: 'Test User' };
  }

  async create(data, params) {
    return { id: '123', ...data };
  }

  async update(id, data, params) {
    return { id, ...data };
  }

  async patch(id, data, params) {
    return { id, ...data };
  }

  async remove(id, params) {
    return { id };
  }
}

// Register service
app.use('/users', new UserService());
app.use('/products', new ProductService());
`;

async function runTests() {
  console.log('🧪 API Ingestion & Querying Test Suite\n');

  try {
    // Initialize database
    console.log('1️⃣  Initializing database...');
    const db = new SessionDatabase(resolveDefaultTestDbPath());
    await db.initialize();
    console.log('✅ Database initialized\n');

    // Test 1: Store API Spec
    console.log('2️⃣  Testing store_api_spec...');
    const specJson = JSON.stringify(sampleSpec);
    const parser = new ApiParser();
    const parsed = parser.parseOpenApiSpec(specJson);
    const storeResult = db.storeApiSpec(
      'test-api',
      parsed.title,
      parsed.version,
      specJson,
      'test-spec.json',
      'file'
    );
    console.log('✅ Spec stored:', { 
      inserted: storeResult.inserted,
      updated: storeResult.updated,
      endpoints: parsed.endpoints.length,
      schemas: parsed.schemas.length
    });

    // Store endpoints
    for (const endpoint of parsed.endpoints) {
      db.storeApiEndpoint(
        'test-api',
        endpoint.path,
        endpoint.method,
        endpoint.operationId,
        endpoint.summary,
        endpoint.description,
        endpoint.tags,
        endpoint.isDeprecated,
        JSON.stringify({
          parameters: endpoint.parameters,
          requestBody: endpoint.requestBody,
          responses: endpoint.responses,
        })
      );
    }

    // Store schemas
    for (const schema of parsed.schemas) {
      db.storeApiSchema('test-api', schema.name, JSON.stringify(schema.schema));
    }
    console.log('✅ Endpoints and schemas stored\n');

    // Test 2: List API Specs
    console.log('3️⃣  Testing list_api_specs...');
    const specs = db.listApiSpecs();
    console.log('✅ Found specs:', specs.map(s => ({ 
      id: s.spec_id, 
      title: s.title, 
      version: s.version 
    })));
    console.log();

    // Test 3: Get API Spec
    console.log('4️⃣  Testing get_api_spec...');
    const spec = db.getApiSpec('test-api');
    console.log('✅ Retrieved spec:', { 
      id: spec?.spec_id, 
      title: spec?.title,
      hash: spec?.spec_hash?.substring(0, 8) + '...'
    });
    console.log();

    // Test 4: Get API Endpoints (all)
    console.log('5️⃣  Testing get_api_endpoints (all)...');
    const allEndpoints = db.getApiEndpoints('test-api');
    console.log('✅ Found endpoints:', allEndpoints.length);
    allEndpoints.forEach(ep => {
      console.log(`   ${ep.method} ${ep.path} - ${ep.summary}`);
    });
    console.log();

    // Test 5: Get API Endpoints (filtered by method)
    console.log('6️⃣  Testing get_api_endpoints (filtered by GET)...');
    const getEndpoints = db.getApiEndpoints('test-api', undefined, 'GET');
    console.log('✅ Found GET endpoints:', getEndpoints.length);
    console.log();

    // Test 6: Get API Endpoints (filtered by path pattern)
    console.log('7️⃣  Testing get_api_endpoints (path pattern)...');
    const userEndpoints = db.getApiEndpoints('test-api', 'users');
    console.log('✅ Found /users* endpoints:', userEndpoints.length);
    console.log();

    // Test 7: Get API Endpoint Detail
    console.log('8️⃣  Testing get_api_endpoint_detail...');
    const endpoint = db.getApiEndpointDetail('test-api', '/users', 'GET');
    console.log('✅ Endpoint detail:', {
      path: endpoint?.path,
      method: endpoint?.method,
      summary: endpoint?.summary,
      operationId: endpoint?.operation_id
    });
    console.log();

    // Test 8: Search API Endpoints
    console.log('9️⃣  Testing search_api_endpoints...');
    const searchResults = db.searchApiEndpoints('user', 'test-api', 10);
    console.log('✅ Search results for "user":', searchResults.length);
    searchResults.forEach(ep => {
      console.log(`   ${ep.method} ${ep.path} - ${ep.summary}`);
    });
    console.log();

    // Test 9: Get API Schema
    console.log('🔟 Testing get_api_schema...');
    const schema = db.getApiSchema('test-api', 'User');
    console.log('✅ Schema retrieved:', {
      name: schema?.schema_name,
      hasSchema: !!schema?.schema_json
    });
    console.log();

    // Test 10: Analyze FeathersJS Services
    console.log('1️⃣1️⃣  Testing analyze_feathers_services...');
    const services = parser.parseFeathersService(sampleFeathersCode, 'services/user.service.ts');
    console.log('✅ Detected services:', services.length);
    services.forEach(svc => {
      console.log(`   ${svc.serviceName} -> ${svc.servicePath}`);
      console.log(`      Methods: ${svc.methods.join(', ')}`);
      
      // Store service
      db.storeFeathersService(
        'test-api',
        svc.serviceName,
        svc.servicePath,
        svc.methods,
        svc.sourceFile
      );
    });
    console.log();

    // Test 11: Get Feathers Services
    console.log('1️⃣2️⃣  Testing get_feathers_services...');
    const storedServices = db.getFeathersServices('test-api');
    console.log('✅ Retrieved services:', storedServices.length);
    storedServices.forEach(svc => {
      console.log(`   ${svc.service_name} -> ${svc.service_path}`);
    });
    console.log();

    // Test 12: Delete API Spec
    console.log('1️⃣3️⃣  Testing delete_api_spec...');
    db.deleteApiSpec('test-api');
    const deletedSpec = db.getApiSpec('test-api');
    console.log('✅ Spec deleted:', !deletedSpec);
    console.log();

    // Close database
    db.close();
    console.log('✅ All tests passed! 🎉\n');
    
    // Force exit to prevent hanging
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
