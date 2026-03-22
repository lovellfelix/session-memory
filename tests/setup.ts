import { config } from 'dotenv';
import { jest } from '@jest/globals';

// Load environment variables for testing
config({ path: '.env.test' });

// Global test setup
global.console = {
  ...console,
  // Suppress console.log in tests unless needed
  log: jest.fn() as typeof console.log,
  // Keep error and warn for debugging
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
  trace: console.trace,
  dir: console.dir,
  dirxml: console.dirxml,
  table: console.table,
  count: console.count,
  countReset: console.countReset,
  assert: console.assert,
  clear: console.clear,
  group: console.group,
  groupCollapsed: console.groupCollapsed,
  groupEnd: console.groupEnd,
  time: console.time,
  timeEnd: console.timeEnd,
  timeLog: console.timeLog,
  timeStamp: console.timeStamp,
  profile: console.profile,
  profileEnd: console.profileEnd,
} as Console;

// Mock process.env for consistent testing
process.env.NODE_ENV = 'test';
process.env.SESSION_ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests';
