# API Ingestion & Querying System

Current runtime/helper API surface:

- `store_api_spec`
- `list_api_specs`
- `get_api_endpoints`
- `get_api_endpoint_detail`
- `search_api_endpoints`
- `get_api_schema`
- `delete_api_spec`
- `ensureApiDocsTables`

## Overview

The session-memory API docs system stores OpenAPI/Swagger specs and indexes their endpoints and schemas for fast lookup.

It supports:

- spec storage with change detection
- endpoint lookup by path, method, or tag
- full-text endpoint search
- schema lookup by name
- cascading cleanup when a spec is deleted

## Typical Flow

```typescript
import {
  ensureApiDocsTables,
  store_api_spec,
  list_api_specs,
  get_api_endpoints,
  get_api_endpoint_detail,
  search_api_endpoints,
  get_api_schema,
} from '../../../tool/mcp.js'

await ensureApiDocsTables({})

await store_api_spec({
  spec_id: 'user-service-api',
  spec_json: JSON.stringify(openApiSpec),
})

const specs = await list_api_specs({})
const endpoints = await get_api_endpoints({ spec_id: 'user-service-api', method: 'GET' })
const authMatches = await search_api_endpoints({ query: 'authentication', spec_id: 'user-service-api' })
const detail = await get_api_endpoint_detail({ spec_id: 'user-service-api', path: '/users/{id}', method: 'GET' })
const schema = await get_api_schema({ spec_id: 'user-service-api', schema_name: 'User' })
```

## Tool Reference

### `ensureApiDocsTables`

Creates API docs tables if they do not exist.

```typescript
await ensureApiDocsTables({})
```

### `store_api_spec`

Stores an OpenAPI/Swagger document and indexes endpoints and schemas.

Parameters:
- `spec_id` - unique identifier
- `spec_json` - full spec as JSON string

```typescript
await store_api_spec({
  spec_id: 'user-service-api',
  spec_json: JSON.stringify(openApiSpec),
})
```

### `list_api_specs`

Lists stored specs with versions and counts.

```typescript
await list_api_specs({})
```

### `get_api_endpoints`

Queries endpoints by spec, path pattern, method, or tag.

```typescript
await get_api_endpoints({ spec_id: 'user-service-api' })
await get_api_endpoints({ spec_id: 'user-service-api', method: 'POST' })
await get_api_endpoints({ spec_id: 'user-service-api', tag: 'authentication' })
```

### `get_api_endpoint_detail`

Gets the full stored detail for one endpoint.

```typescript
await get_api_endpoint_detail({
  spec_id: 'user-service-api',
  path: '/users/{id}',
  method: 'GET',
})
```

### `search_api_endpoints`

Runs full-text search across endpoint summaries and descriptions.

```typescript
await search_api_endpoints({
  query: 'authentication login',
  spec_id: 'user-service-api',
  limit: 10,
})
```

### `get_api_schema`

Gets a schema definition by name.

```typescript
await get_api_schema({
  spec_id: 'user-service-api',
  schema_name: 'User',
})
```

### `delete_api_spec`

Deletes a spec and its indexed endpoints and schemas.

```typescript
await delete_api_spec({ spec_id: 'user-service-api' })
```

## Stored Data

- `api_specs` - original specs and metadata
- `api_endpoints` - indexed endpoint records
- `api_schemas` - indexed schema definitions
- full-text index for endpoint search

## Notes

- `store_api_spec` is the write path; there is no current `get_api_spec` helper/runtime tool.
- Older Feathers-specific ingestion examples were removed because they are not part of the active surface.
- Re-storing the same spec is safe; change detection avoids unnecessary churn.
