import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { convertTimestamps } from '../utils/date.utils';

/**
 * Interceptor that automatically converts all Firestore Timestamps to ISO 8601 strings
 * This ensures consistent date formatting across all API responses
 */
@Injectable()
export class TimestampConversionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => {
        // Convert all Firestore Timestamps in the response data to ISO 8601 strings
        return convertTimestamps(data);
      }),
    );
  }
}
