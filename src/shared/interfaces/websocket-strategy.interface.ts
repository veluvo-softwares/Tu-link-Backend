import { LocationUpdate } from './location.interface';

export type LocationStrategy = 'REALTIME' | 'BATCHED' | 'POLLING';

export interface StrategyResponse {
  sequenceNumber: number;
  strategy: LocationStrategy;
  nextBroadcast?: number;
  pollEndpoint?: string;
  recommendedInterval?: number;
}

export interface BatchData {
  updates: LocationUpdate[];
  timeout: NodeJS.Timeout | null;
  createdAt: number;
  participantCount: number;
}

export interface StrategyConfig {
  smallJourneyThreshold: number;
  mediumJourneyThreshold: number;
  batchIntervalMs: number;
  pollingIntervalMs: number;
  maxBatchSize: number;
  maxBatchDelayMs: number;
}

export interface PerformanceMetrics {
  journeyId: string;
  strategy: LocationStrategy;
  avgLatency: number;
  messageCount: number;
  errorRate: number;
  lastMeasured: number;
}
