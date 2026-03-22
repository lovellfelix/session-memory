import * as ts from 'typescript';
import { createHash } from 'crypto';
import { ValidationError } from './errors.js';
import { logger } from './logger.js';

// Type definitions for API specifications
export interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, Record<string, any>>;
  components?: {
    schemas?: Record<string, any>;
  };
  definitions?: Record<string, any>; // Swagger 2.0
}

export interface ParsedEndpoint {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  isDeprecated: boolean;
  parameters?: any[];
  requestBody?: any;
  responses?: Record<string, any>;
}

export interface ParsedSchema {
  name: string;
  schema: any;
}

export interface FeathersService {
  serviceName: string;
  servicePath: string;
  methods: string[];
  hooks?: {
    before?: Record<string, string[]>;
    after?: Record<string, string[]>;
    error?: Record<string, string[]>;
  };
  events?: string[];
  sourceFile?: string;
}

export class ApiParser {
  /**
   * Parse OpenAPI/Swagger specification
   */
  parseOpenApiSpec(specJson: string): {
    endpoints: ParsedEndpoint[];
    schemas: ParsedSchema[];
    title: string;
    version: string;
  } {
    try {
      const spec: OpenAPISpec = JSON.parse(specJson);
      
      // Validate spec format
      if (!spec.info || !spec.info.title || !spec.info.version) {
        throw new ValidationError('Invalid OpenAPI spec: missing info.title or info.version');
      }
      
      if (!spec.paths) {
        throw new ValidationError('Invalid OpenAPI spec: missing paths');
      }
      
      const endpoints = this.extractEndpoints(spec);
      const schemas = this.extractSchemas(spec);
      
      return {
        endpoints,
        schemas,
        title: spec.info.title,
        version: spec.info.version,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(`Failed to parse OpenAPI spec: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Extract endpoints from OpenAPI paths
   */
  private extractEndpoints(spec: OpenAPISpec): ParsedEndpoint[] {
    const endpoints: ParsedEndpoint[] = [];
    
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
      
      for (const method of methods) {
        if (pathItem[method]) {
          const operation = pathItem[method];
          
          endpoints.push({
            path,
            method: method.toUpperCase(),
            operationId: operation.operationId,
            summary: operation.summary || '',
            description: operation.description || '',
            tags: operation.tags || [],
            isDeprecated: operation.deprecated || false,
            parameters: operation.parameters,
            requestBody: operation.requestBody,
            responses: operation.responses,
          });
        }
      }
    }
    
    logger.debug(`Extracted ${endpoints.length} endpoints from OpenAPI spec`);
    return endpoints;
  }
  
  /**
   * Extract schemas from OpenAPI components or definitions
   */
  private extractSchemas(spec: OpenAPISpec): ParsedSchema[] {
    const schemas: ParsedSchema[] = [];
    
    // OpenAPI 3.x
    if (spec.components?.schemas) {
      for (const [name, schema] of Object.entries(spec.components.schemas)) {
        schemas.push({ name, schema });
      }
    }
    
    // Swagger 2.0
    if (spec.definitions) {
      for (const [name, schema] of Object.entries(spec.definitions)) {
        schemas.push({ name, schema });
      }
    }
    
    logger.debug(`Extracted ${schemas.length} schemas from OpenAPI spec`);
    return schemas;
  }
  
  /**
   * Parse FeathersJS service from TypeScript source code
   */
  parseFeathersService(sourceCode: string, sourceFile: string): FeathersService[] {
    try {
      const sourceFileNode = ts.createSourceFile(
        sourceFile,
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      
      const services: FeathersService[] = [];
      
      // Visit all nodes in the AST
      const visit = (node: ts.Node) => {
        // Detect service class declarations
        if (ts.isClassDeclaration(node) && node.name) {
          const serviceName = node.name.text;
          
          // Check if it extends a Feathers service class
          if (this.extendsFeathersService(node)) {
            const service: FeathersService = {
              serviceName,
              servicePath: this.extractServicePath(node, sourceFileNode),
              methods: this.extractServiceMethods(node),
              hooks: this.extractHooks(node, sourceFileNode),
              events: this.extractEvents(node, sourceFileNode),
              sourceFile,
            };
            
            services.push(service);
            logger.debug(`Detected FeathersJS service: ${serviceName}`);
          }
        }
        
        // Detect service registration patterns: app.use('/path', new Service())
        if (ts.isCallExpression(node)) {
          const serviceFromRegistration = this.extractServiceFromRegistration(node, sourceFileNode);
          if (serviceFromRegistration) {
            services.push({ ...serviceFromRegistration, sourceFile });
          }
        }
        
        ts.forEachChild(node, visit);
      };
      
      visit(sourceFileNode);
      
      return services;
    } catch (error) {
      logger.error('Failed to parse FeathersJS service', error as Error);
      return [];
    }
  }
  
  /**
   * Check if class extends FeathersService or similar base classes
   */
  private extendsFeathersService(node: ts.ClassDeclaration): boolean {
    if (!node.heritageClauses) return false;
    
    for (const clause of node.heritageClauses) {
      for (const type of clause.types) {
        const typeName = type.expression.getText();
        
        // Common FeathersJS service base classes
        if (
          typeName.includes('Service') ||
          typeName.includes('FeathersService') ||
          typeName === 'MemoryService' ||
          typeName === 'DatabaseService'
        ) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Extract service path from app.use() or class comments
   */
  private extractServicePath(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): string {
    const className = node.name?.text || 'UnknownService';
    
    // Default path from class name (e.g., UserService -> /users)
    const defaultPath = `/${className.replace(/Service$/i, '').toLowerCase()}s`;
    
    // Look for service path in JSDoc comments
    const jsDoc = ts.getJSDocCommentsAndTags(node);
    for (const doc of jsDoc) {
      if (ts.isJSDoc(doc)) {
        const comment = doc.comment?.toString() || '';
        const pathMatch = comment.match(/@service[Pp]ath\s+(['"`])([^'"`]+)\1/);
        if (pathMatch) {
          return pathMatch[2];
        }
      }
    }
    
    return defaultPath;
  }
  
  /**
   * Extract service methods (find, get, create, update, patch, remove)
   */
  private extractServiceMethods(node: ts.ClassDeclaration): string[] {
    const methods: string[] = [];
    const standardMethods = ['find', 'get', 'create', 'update', 'patch', 'remove'];
    
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        const methodName = member.name.getText();
        if (standardMethods.includes(methodName)) {
          methods.push(methodName);
        }
      }
    }
    
    return methods.length > 0 ? methods : standardMethods; // Default to all standard methods
  }
  
  /**
   * Extract hooks configuration from service class or setup
   */
  private extractHooks(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): FeathersService['hooks'] | undefined {
    // Look for hooks method or property
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name?.getText() === 'hooks') {
        // Try to extract hooks from method body
        return this.parseHooksFromMethod(member);
      }
      
      if (ts.isPropertyDeclaration(member) && member.name?.getText() === 'hooks') {
        // Try to extract hooks from property initializer
        if (member.initializer && ts.isObjectLiteralExpression(member.initializer)) {
          return this.parseHooksFromObject(member.initializer);
        }
      }
    }
    
    return undefined;
  }
  
  /**
   * Parse hooks from method body
   */
  private parseHooksFromMethod(method: ts.MethodDeclaration): FeathersService['hooks'] | undefined {
    // Simplified extraction - look for return statement with object literal
    const visit = (node: ts.Node): any => {
      if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
        return this.parseHooksFromObject(node.expression);
      }
      
      let result;
      ts.forEachChild(node, (child) => {
        const childResult = visit(child);
        if (childResult) result = childResult;
      });
      
      return result;
    };
    
    return visit(method);
  }
  
  /**
   * Parse hooks from object literal
   */
  private parseHooksFromObject(obj: ts.ObjectLiteralExpression): FeathersService['hooks'] | undefined {
    const hooks: Partial<Record<'before' | 'after' | 'error', Record<string, string[]>>> = {};
    
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const hookType = prop.name.text as 'before' | 'after' | 'error';
        
        if (['before', 'after', 'error'].includes(hookType) && ts.isObjectLiteralExpression(prop.initializer)) {
          const hookMap: Record<string, string[]> = {};
          
          for (const methodProp of prop.initializer.properties) {
            if (ts.isPropertyAssignment(methodProp) && ts.isIdentifier(methodProp.name)) {
              const methodName = methodProp.name.text;
              hookMap[methodName] = this.extractHookNames(methodProp.initializer);
            }
          }
          
          hooks[hookType] = hookMap;
        }
      }
    }
    
    return Object.keys(hooks).length > 0 ? hooks as FeathersService['hooks'] : undefined;
  }
  
  /**
   * Extract hook function names from array
   */
  private extractHookNames(node: ts.Expression): string[] {
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements
        .map((el) => {
          if (ts.isIdentifier(el)) return el.text;
          if (ts.isCallExpression(el) && ts.isIdentifier(el.expression)) {
            return el.expression.text;
          }
          return null;
        })
        .filter((name): name is string => name !== null);
    }
    
    return [];
  }
  
  /**
   * Extract events from service class
   */
  private extractEvents(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): string[] {
    const events: string[] = [];
    const standardEvents = ['created', 'updated', 'patched', 'removed'];
    
    // Look for custom events in JSDoc or emit calls
    const jsDoc = ts.getJSDocCommentsAndTags(node);
    for (const doc of jsDoc) {
      if (ts.isJSDoc(doc)) {
        const comment = doc.comment?.toString() || '';
        const eventMatch = comment.match(/@events?\s+(.+)/);
        if (eventMatch) {
          const customEvents = eventMatch[1].split(',').map((e) => e.trim());
          events.push(...customEvents);
        }
      }
    }
    
    // Return custom events if found, otherwise standard events
    return events.length > 0 ? events : standardEvents;
  }
  
  /**
   * Extract service from app.use() registration
   */
  private extractServiceFromRegistration(
    node: ts.CallExpression,
    sourceFile: ts.SourceFile
  ): FeathersService | null {
    // Look for app.use('/path', service) pattern
    const expression = node.expression;
    
    if (
      ts.isPropertyAccessExpression(expression) &&
      expression.name.text === 'use' &&
      node.arguments.length >= 2
    ) {
      const pathArg = node.arguments[0];
      const serviceArg = node.arguments[1];
      
      // Extract path
      let servicePath = '/unknown';
      if (ts.isStringLiteral(pathArg)) {
        servicePath = pathArg.text;
      }
      
      // Extract service name
      let serviceName = 'UnknownService';
      if (ts.isNewExpression(serviceArg) && serviceArg.expression) {
        serviceName = serviceArg.expression.getText();
      } else if (ts.isIdentifier(serviceArg)) {
        serviceName = serviceArg.text;
      }
      
      return {
        serviceName,
        servicePath,
        methods: ['find', 'get', 'create', 'update', 'patch', 'remove'],
        events: ['created', 'updated', 'patched', 'removed'],
      };
    }
    
    return null;
  }
  
  /**
   * Parse Express/Fastify routes from source code
   */
  parseExpressRoutes(sourceCode: string, sourceFile: string): ParsedEndpoint[] {
    try {
      const sourceFileNode = ts.createSourceFile(
        sourceFile,
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      
      const endpoints: ParsedEndpoint[] = [];
      
      const visit = (node: ts.Node) => {
        // Detect route definitions: app.get('/path', handler) or router.post('/path', handler)
        if (ts.isCallExpression(node)) {
          const endpoint = this.extractRouteFromCall(node);
          if (endpoint) {
            endpoints.push({ ...endpoint, isDeprecated: false });
          }
        }
        
        ts.forEachChild(node, visit);
      };
      
      visit(sourceFileNode);
      
      logger.debug(`Extracted ${endpoints.length} routes from ${sourceFile}`);
      return endpoints;
    } catch (error) {
      logger.error('Failed to parse Express/Fastify routes', error as Error);
      return [];
    }
  }
  
  /**
   * Extract route from method call (app.get, router.post, etc.)
   */
  private extractRouteFromCall(node: ts.CallExpression): Omit<ParsedEndpoint, 'isDeprecated'> | null {
    const expression = node.expression;
    
    if (ts.isPropertyAccessExpression(expression)) {
      const method = expression.name.text.toUpperCase();
      const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
      
      if (httpMethods.includes(method) && node.arguments.length >= 1) {
        const pathArg = node.arguments[0];
        
        if (ts.isStringLiteral(pathArg)) {
          return {
            path: pathArg.text,
            method,
            summary: `${method} ${pathArg.text}`,
            description: '',
            tags: [],
          };
        }
      }
    }
    
    return null;
  }
  
  /**
   * Calculate MD5 hash of spec JSON for change detection
   */
  calculateSpecHash(specJson: string): string {
    return createHash('md5').update(specJson).digest('hex');
  }
}

export const apiParser = new ApiParser();
