import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export class MCPError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = false,
    public context?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends MCPError {
  constructor(message: string, context?: any) {
    super(message, 'NOT_FOUND', true, context);
  }
}

export class PermissionDeniedError extends MCPError {
  constructor(message: string, context?: any) {
    super(message, 'PERMISSION_DENIED', false, context);
  }
}

export class DatabaseError extends MCPError {
  constructor(message: string, context?: any, recoverable: boolean = false) {
    super(message, 'DATABASE_ERROR', recoverable, context);
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, context?: any) {
    super(message, 'VALIDATION_ERROR', true, context);
  }
}

export class SchemaError extends MCPError {
  constructor(message: string, context?: any) {
    super(message, 'SCHEMA_ERROR', false, context);
  }
}

export class MigrationError extends MCPError {
  constructor(message: string, context?: any) {
    super(message, 'MIGRATION_ERROR', false, context);
  }
}

export class ConfigError extends MCPError {
  constructor(message: string, context?: any) {
    super(message, 'CONFIG_ERROR', true, context);
  }
}

export type ToolResponse = CallToolResult;

export function handleError(error: Error, context?: any): ToolResponse {
  console.error('[MCP Error]', {
    type: error.constructor.name,
    message: error.message,
    context,
    stack: error.stack
  });

  const base = {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      kind: 'unexpected',
      message: error.message,
      recoverable: false,
      details: context,
    }
  };

  if (error instanceof MCPError) {
    base.error.code = error.code;
    base.error.recoverable = error.recoverable;
    base.error.details = error.context ?? context;

    switch (error.code) {
      case 'VALIDATION_ERROR':
        base.error.kind = 'validation';
        break;
      case 'DATABASE_ERROR':
        base.error.kind = 'database';
        break;
      case 'SCHEMA_ERROR':
        base.error.kind = 'schema';
        break;
      case 'MIGRATION_ERROR':
        base.error.kind = 'migration';
        break;
      case 'NOT_FOUND':
        base.error.kind = 'not_found';
        break;
      case 'PERMISSION_DENIED':
        base.error.kind = 'permission_denied';
        break;
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(base, null, 2) }],
    isError: true,
  };
}
