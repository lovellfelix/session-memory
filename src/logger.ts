export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static instance: Logger;
  private level: LogLevel;

  private constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  static getInstance(level?: LogLevel): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(level);
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, context?: any): void {
    if (this.level <= LogLevel.DEBUG) {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [DEBUG] ${message}`, context ? JSON.stringify(context, null, 2) : '');
    }
  }

  info(message: string, context?: any): void {
    if (this.level <= LogLevel.INFO) {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [INFO] ${message}`, context ? JSON.stringify(context, null, 2) : '');
    }
  }

  warn(message: string, context?: any): void {
    if (this.level <= LogLevel.WARN) {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [WARN] ${message}`, context ? JSON.stringify(context, null, 2) : '');
    }
  }

  error(message: string, error: Error, context?: any): void {
    if (this.level <= LogLevel.ERROR) {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [ERROR] ${message}`, {
        error: error.message,
        stack: error.stack,
        context
      });
    }
  }

  logToolCall(toolName: string, params: any, duration: number, success: boolean): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [TOOL] ${toolName}`, {
      params,
      duration: `${duration}ms`,
      success
    });
  }
}

export const logger = Logger.getInstance();
