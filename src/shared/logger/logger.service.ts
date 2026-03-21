import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: winston.Logger;

  constructor(private configService: ConfigService) {
    this.logger = this.createLogger();
  }

  private createLogger(): winston.Logger {
    const environment = this.configService.get<string>('NODE_ENV', 'development');
    const logLevel = this.configService.get<string>('LOG_LEVEL', 'info');

    const formats = [
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ];

    // Add colorization for development
    if (environment === 'development') {
      formats.push(winston.format.colorize());
      formats.push(
        winston.format.printf(({ timestamp, level, message, context, trace, ...meta }) => {
          const contextStr = context ? `[${context}] ` : '';
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          const traceStr = trace ? `\n${trace}` : '';
          return `${timestamp} ${level}: ${contextStr}${message}${metaStr}${traceStr}`;
        }),
      );
    }

    const transports: winston.transport[] = [
      // Console transport
      new winston.transports.Console({
        level: logLevel,
        format: winston.format.combine(...formats),
      }),
    ];

    // File transports for production
    if (environment === 'production') {
      transports.push(
        // Error logs
        new DailyRotateFile({
          filename: 'logs/error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxSize: '20m',
          maxFiles: '14d',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
        // Combined logs
        new DailyRotateFile({
          filename: 'logs/combined-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
      );
    }

    return winston.createLogger({
      level: logLevel,
      transports,
      defaultMeta: {
        service: 'tulink-backend',
        version: process.env.npm_package_version,
      },
    });
  }

  log(message: any, context?: string): void {
    this.info(message, context);
  }

  info(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.info(message, { context, ...meta });
  }

  error(message: string, trace?: string, context?: string, meta?: Record<string, any>): void {
    this.logger.error(message, { context, trace, ...meta });
  }

  warn(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.warn(message, { context, ...meta });
  }

  debug(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.debug(message, { context, ...meta });
  }

  verbose(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.verbose(message, { context, ...meta });
  }

  // Journey-specific logging methods
  logJourneyEvent(event: string, journeyId: string, userId: string, meta?: Record<string, any>): void {
    this.info(`Journey ${event}`, 'JourneyService', {
      event,
      journeyId,
      userId,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  logLocationUpdate(journeyId: string, userId: string, location: { lat: number; lng: number }, meta?: Record<string, any>): void {
    this.debug('Location updated', 'LocationService', {
      journeyId,
      userId,
      location,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  logAuthEvent(event: string, userId: string, meta?: Record<string, any>): void {
    this.info(`Auth ${event}`, 'AuthService', {
      event,
      userId,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  logApiRequest(method: string, path: string, userId?: string, duration?: number, statusCode?: number): void {
    this.info('API Request', 'HTTP', {
      method,
      path,
      userId,
      duration,
      statusCode,
      timestamp: new Date().toISOString(),
    });
  }

  logError(error: Error, context: string, meta?: Record<string, any>): void {
    this.error(error.message, error.stack, context, {
      name: error.name,
      ...meta,
    });
  }
}