/**
 * Standard API Response Structure
 * Based on REST API best practices for consistent response formatting
 */

export interface ApiResponse<T = any> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  timestamp: string;
  path: string;
}

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: {
    code: string;
    details?: any;
    stack?: string;
  };
  timestamp: string;
  path: string;
}

export interface ValidationErrorResponse extends ApiErrorResponse {
  error: {
    code: 'VALIDATION_ERROR';
    details: ValidationErrorDetail[];
  };
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
  constraint: string;
}
