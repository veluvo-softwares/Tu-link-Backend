import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  wsPort: parseInt(process.env.WS_PORT || '3001', 10),
  wsCorsOrigin: process.env.WS_CORS_ORIGIN || '*',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-in-production',
  locationUpdateRateLimit: parseInt(
    process.env.LOCATION_UPDATE_RATE_LIMIT || '60',
    10,
  ),
  defaultLagThresholdMeters: parseInt(
    process.env.DEFAULT_LAG_THRESHOLD_METERS || '500',
    10,
  ),
  warningLagMeters: parseInt(process.env.WARNING_LAG_METERS || '500', 10),
  criticalLagMeters: parseInt(process.env.CRITICAL_LAG_METERS || '1000', 10),
  arrivalDistanceThresholdMeters: parseInt(
    process.env.ARRIVAL_DISTANCE_THRESHOLD_METERS || '100',
    10,
  ),
  arrivalSpeedThresholdMps: parseFloat(
    process.env.ARRIVAL_SPEED_THRESHOLD_MPS || '1.39',
  ),
  heartbeatIntervalMs: parseInt(
    process.env.HEARTBEAT_INTERVAL_MS || '4000',
    10,
  ),
  heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '7000', 10),
  maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3', 10),
  retryTimeoutMs: parseInt(process.env.RETRY_TIMEOUT_MS || '5000', 10),
}));
