import { Injectable, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../shared/redis/redis.service';
import { FirebaseService } from '../../shared/firebase/firebase.service';
import { LoggerService } from '../../shared/logger/logger.service';

export interface HealthStatus {
  status: 'ok' | 'error' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  dependencies?: {
    [key: string]: {
      status: 'ok' | 'error';
      responseTime?: number;
      error?: string;
    };
  };
}

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly firebaseService: FirebaseService,
    private readonly logger: LoggerService,
  ) {}

  async getBasicHealth() {
    const health: HealthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      environment: this.configService.get<string>('NODE_ENV', 'development'),
    };

    return {
      success: true,
      statusCode: HttpStatus.OK,
      message: 'Service is healthy',
      data: health,
    };
  }

  async getDetailedHealth() {
    const startTime = Date.now();
    
    try {
      const dependencies = await this.checkDependencies();
      const overallStatus = this.determineOverallStatus(dependencies);
      
      const health: HealthStatus = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: Date.now() - this.startTime,
        version: process.env.npm_package_version || '1.0.0',
        environment: this.configService.get<string>('NODE_ENV', 'development'),
        dependencies,
      };

      const responseTime = Date.now() - startTime;
      
      this.logger.info('Health check completed', 'HealthService', {
        status: overallStatus,
        responseTime,
        dependencies: Object.keys(dependencies).reduce((acc, key) => {
          acc[key] = dependencies[key].status;
          return acc;
        }, {} as Record<string, string>),
      });

      const statusCode = overallStatus === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
      
      return {
        success: overallStatus === 'ok',
        statusCode,
        message: overallStatus === 'ok' ? 'All systems operational' : 'Some dependencies are unhealthy',
        data: health,
      };
    } catch (error) {
      this.logger.error('Health check failed', error.stack, 'HealthService');
      
      return {
        success: false,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Health check failed',
        data: {
          status: 'error',
          timestamp: new Date().toISOString(),
          uptime: Date.now() - this.startTime,
          version: process.env.npm_package_version || '1.0.0',
          environment: this.configService.get<string>('NODE_ENV', 'development'),
          error: error.message,
        },
      };
    }
  }

  async getReadinessCheck() {
    try {
      const dependencies = await this.checkDependencies();
      const criticalDeps = ['redis', 'firebase'];
      
      const isReady = criticalDeps.every(
        dep => dependencies[dep] && dependencies[dep].status === 'ok'
      );

      if (isReady) {
        return {
          success: true,
          statusCode: HttpStatus.OK,
          message: 'Service is ready',
          data: { ready: true, timestamp: new Date().toISOString() },
        };
      } else {
        return {
          success: false,
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Service is not ready',
          data: { ready: false, timestamp: new Date().toISOString(), dependencies },
        };
      }
    } catch (error) {
      this.logger.error('Readiness check failed', error.stack, 'HealthService');
      return {
        success: false,
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Readiness check failed',
        data: { ready: false, timestamp: new Date().toISOString(), error: error.message },
      };
    }
  }

  async getLivenessCheck() {
    // Basic liveness check - if this method runs, the service is alive
    return {
      success: true,
      statusCode: HttpStatus.OK,
      message: 'Service is alive',
      data: {
        alive: true,
        timestamp: new Date().toISOString(),
        uptime: Date.now() - this.startTime,
      },
    };
  }

  private async checkDependencies() {
    const checks = [
      this.checkRedis(),
      this.checkFirebase(),
      this.checkGoogleMaps(),
    ];

    const [redis, firebase, maps] = await Promise.allSettled(checks);

    return {
      redis: this.getCheckResult(redis),
      firebase: this.getCheckResult(firebase),
      maps: this.getCheckResult(maps),
    };
  }

  private async checkRedis() {
    const startTime = Date.now();
    try {
      const client = this.redisService.getClient();
      await client.set('health:check', 'ok', 'EX', 10);
      const result = await client.get('health:check');
      const responseTime = Date.now() - startTime;
      
      if (result === 'ok') {
        return { status: 'ok' as const, responseTime };
      } else {
        return { status: 'error' as const, responseTime, error: 'Unexpected response from Redis' };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return { status: 'error' as const, responseTime, error: error.message };
    }
  }

  private async checkFirebase() {
    const startTime = Date.now();
    try {
      // Simple test to check if Firestore is accessible
      const testRef = this.firebaseService.firestore
        .collection('health')
        .doc('test');
      
      await testRef.get();
      const responseTime = Date.now() - startTime;
      return { status: 'ok' as const, responseTime };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return { status: 'error' as const, responseTime, error: error.message };
    }
  }

  private async checkGoogleMaps() {
    const startTime = Date.now();
    try {
      // We'll assume Google Maps is healthy if we have the API key
      const mapsApiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
      const responseTime = Date.now() - startTime;
      
      if (mapsApiKey) {
        return { status: 'ok' as const, responseTime };
      } else {
        return { status: 'error' as const, responseTime, error: 'Google Maps API key not configured' };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return { status: 'error' as const, responseTime, error: error.message };
    }
  }

  private getCheckResult(result: PromiseSettledResult<any>) {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        status: 'error' as const,
        responseTime: 0,
        error: result.reason?.message || 'Unknown error',
      };
    }
  }

  private determineOverallStatus(dependencies: Record<string, any>): 'ok' | 'error' | 'degraded' {
    const statuses = Object.values(dependencies).map(dep => dep.status);
    
    if (statuses.every(status => status === 'ok')) {
      return 'ok';
    } else if (statuses.includes('error')) {
      // Check if critical dependencies are down
      const criticalDown = dependencies.redis?.status === 'error' || 
                          dependencies.firebase?.status === 'error';
      return criticalDown ? 'error' : 'degraded';
    } else {
      return 'degraded';
    }
  }
}