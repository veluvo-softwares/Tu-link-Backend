import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse();

    return next.handle().pipe(
      map((data) => {
        // If data is already in our response format, return as is
        if (data && typeof data === 'object' && 'success' in data && 'statusCode' in data) {
          return data;
        }

        // Get the status code from the response
        const statusCode = response.statusCode;

        // Build standardized success response
        return {
          success: true,
          statusCode,
          message: this.getSuccessMessage(request.method, statusCode),
          data,
        };
      }),
    );
  }

  private getSuccessMessage(method: string, statusCode: number): string {
    // Map HTTP methods and status codes to user-friendly messages
    if (statusCode === 201) {
      return 'Resource created successfully';
    }

    if (statusCode === 204) {
      return 'Resource deleted successfully';
    }

    const methodMessages: Record<string, string> = {
      GET: 'Data retrieved successfully',
      POST: 'Operation completed successfully',
      PUT: 'Resource updated successfully',
      PATCH: 'Resource updated successfully',
      DELETE: 'Resource deleted successfully',
    };

    return methodMessages[method] || 'Request completed successfully';
  }
}
