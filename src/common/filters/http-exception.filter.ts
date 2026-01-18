import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorResponse, ValidationErrorDetail } from '../interfaces/api-response.interface';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const statusCode = this.getStatusCode(exception);
    const errorResponse = this.buildErrorResponse(exception, request, statusCode);

    // Log error details
    this.logger.error(
      `${request.method} ${request.url} - Status: ${statusCode}`,
      exception instanceof Error ? exception.stack : JSON.stringify(exception),
    );

    response.status(statusCode).json(errorResponse);
  }

  private getStatusCode(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private buildErrorResponse(
    exception: unknown,
    request: Request,
    statusCode: number,
  ): ApiErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.url;

    // Handle NestJS HttpException
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();

      // Handle validation errors
      if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
        const response = exceptionResponse as any;

        // Check if it's a validation error
        if (Array.isArray(response.message)) {
          const validationErrors: ValidationErrorDetail[] = response.message.map((msg: string) => {
            // Parse validation error messages
            const parts = msg.split(' ');
            return {
              field: parts[0] || 'unknown',
              message: msg,
              constraint: response.error || 'validation_failed',
            };
          });

          return {
            success: false,
            statusCode,
            message: 'Validation failed',
            error: {
              code: 'VALIDATION_ERROR',
              details: validationErrors,
            },
            timestamp,
            path,
          };
        }

        return {
          success: false,
          statusCode,
          message: response.message || exception.message,
          error: {
            code: this.getErrorCode(exception, response),
            details: response.error || null,
          },
          timestamp,
          path,
        };
      }

      return {
        success: false,
        statusCode,
        message: exception.message,
        error: {
          code: this.getErrorCode(exception),
        },
        timestamp,
        path,
      };
    }

    // Handle Firebase errors
    if (this.isFirebaseError(exception)) {
      const firebaseError = exception as any;
      return {
        success: false,
        statusCode,
        message: this.getFirebaseErrorMessage(firebaseError),
        error: {
          code: firebaseError.errorInfo?.code || 'FIREBASE_ERROR',
          details: firebaseError.errorInfo?.message || null,
        },
        timestamp,
        path,
      };
    }

    // Handle unknown errors
    const error = exception as Error;
    return {
      success: false,
      statusCode,
      message: error.message || 'Internal server error',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
          stack: error.stack,
        }),
      },
      timestamp,
      path,
    };
  }

  private getErrorCode(exception: HttpException, response?: any): string {
    const status = exception.getStatus();

    // Use response error code if available
    if (response?.error) {
      return response.error.toUpperCase().replace(/\s+/g, '_');
    }

    // Map HTTP status codes to error codes
    const errorCodeMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
      [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
    };

    return errorCodeMap[status] || 'UNKNOWN_ERROR';
  }

  private isFirebaseError(exception: unknown): boolean {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      'errorInfo' in exception &&
      'codePrefix' in exception
    );
  }

  private getFirebaseErrorMessage(error: any): string {
    const errorCode = error.errorInfo?.code;

    // Map Firebase error codes to user-friendly messages
    const errorMessages: Record<string, string> = {
      'auth/email-already-exists': 'Email address is already in use',
      'auth/invalid-email': 'Invalid email address',
      'auth/invalid-password': 'Password must be at least 6 characters',
      'auth/invalid-phone-number': 'Invalid phone number format. Use E.164 format (e.g., +254712345678)',
      'auth/phone-number-already-exists': 'Phone number is already in use',
      'auth/user-not-found': 'User not found',
      'auth/wrong-password': 'Invalid credentials',
      'auth/too-many-requests': 'Too many requests. Please try again later',
    };

    return errorMessages[errorCode] || error.errorInfo?.message || 'An error occurred';
  }
}
