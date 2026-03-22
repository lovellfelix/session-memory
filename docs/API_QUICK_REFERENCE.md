# API System Quick Reference

## 🚀 Quick Start

```typescript
import {
  store_api_spec,
  get_api_endpoints,
  search_api_endpoints,
  get_api_schema,
  get_api_endpoint_detail,
  list_api_specs,
} from '../../../tool/mcp.js';

// 1. Store an OpenAPI spec
await store_api_spec({
  spec_id: 'my-api',
  spec_json: JSON.stringify(openApiSpec)
});

// 2. Query endpoints
const endpoints = await get_api_endpoints({
  spec_id: 'my-api',
  method: 'GET'
});

// 3. Search for functionality
const results = await search_api_endpoints({
  query: 'user authentication',
  spec_id: 'my-api'
});

// 4. Get schema definitions
const schema = await get_api_schema({
  spec_id: 'my-api',
  schema_name: 'User'
});
```

## 📋 API Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `store_api_spec` | Store OpenAPI/Swagger spec | `spec_id`, `spec_json` |
| `list_api_specs` | List all stored specs | None |
| `get_api_endpoints` | Query endpoints with filters | `spec_id`, `path_pattern`, `method`, `tag`, `limit` |
| `get_api_endpoint_detail` | Get specific endpoint details | `spec_id`, `path`, `method` |
| `search_api_endpoints` | Full-text search endpoints | `query`, `spec_id`, `limit` |
| `get_api_schema` | Get schema definition | `spec_id`, `schema_name` |
| `delete_api_spec` | Delete spec and related data | `spec_id` |

## 🔍 Common Queries

### List All Endpoints for an API
```typescript
await get_api_endpoints({ spec_id: 'my-api' });
```

### Find All POST Endpoints
```typescript
await get_api_endpoints({ 
  spec_id: 'my-api', 
  method: 'POST' 
});
```

### Search for User-Related Endpoints
```typescript
await search_api_endpoints({ 
  query: 'user',
  spec_id: 'my-api'
});
```

### Get Specific Endpoint Details
```typescript
await get_api_endpoint_detail({
  spec_id: 'my-api',
  path: '/users/{id}',
  method: 'GET'
});
```

### Find Endpoints by Path Pattern
```typescript
await get_api_endpoints({
  spec_id: 'my-api',
  path_pattern: 'users'  // Matches /users, /users/{id}, etc.
});
```

### Get All Schemas for an API
```typescript
// Get the spec first
const specs = await list_api_specs({});
const specData = JSON.parse(spec.spec_json);

// List all schema names
const schemaNames = Object.keys(specData.components?.schemas || {});

// Fetch each schema
for (const name of schemaNames) {
  const schema = await get_api_schema({ 
    spec_id: 'my-api',
    schema_name: name
  });
  console.log(schema);
}
```

## 🧪 Testing

Run the test suite:
```bash
cd mcp-servers/session-memory
npm run build
node scripts/test-api-system.mjs
```

## 📖 Full Documentation

See [API_INGESTION.md](./API_INGESTION.md) for:
- Complete tool reference
- Database schema
- Usage examples
- Performance considerations
- Testing guide

## 🎯 Use Cases

1. **API Documentation Generation** - Extract all endpoints and generate docs
2. **API Client Generation** - Use schemas to generate TypeScript types
3. **API Testing** - Query endpoints for automated test generation
4. **API Discovery** - Search across multiple specs for functionality
5. **API Versioning** - Track changes with MD5 hash detection
6. **FeathersJS Analysis** - Document microservices architecture
7. **API Compliance** - Check for deprecated endpoints
8. **Integration Testing** - Validate service contracts
