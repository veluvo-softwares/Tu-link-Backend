import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CachedLocation } from '../interfaces/location.interface';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.configService.get('redis.host'),
      port: this.configService.get('redis.port'),
      password: this.configService.get('redis.password'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on('connect', () => {
      console.log('Redis client connected');
    });

    this.client.on('error', (err) => {
      console.error('Redis client error:', err);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  // Sequence number management
  async getNextSequence(journeyId: string): Promise<number> {
    const key = `journey:${journeyId}:seq`;
    return await this.client.incr(key);
  }

  async getLastAcknowledgedSequence(participantId: string): Promise<number> {
    const key = `participant:${participantId}:lastSeq`;
    const result = await this.client.get(key);
    return result ? parseInt(result, 10) : 0;
  }

  async setLastAcknowledgedSequence(
    participantId: string,
    sequenceNumber: number,
  ): Promise<void> {
    const key = `participant:${participantId}:lastSeq`;
    await this.client.set(key, sequenceNumber.toString());
  }

  // Connection state management
  async setConnectionStatus(
    participantId: string,
    connected: boolean,
  ): Promise<void> {
    const key = `participant:${participantId}:connected`;
    await this.client.set(key, connected ? '1' : '0');
  }

  async isConnected(participantId: string): Promise<boolean> {
    const key = `participant:${participantId}:connected`;
    const result = await this.client.get(key);
    return result === '1';
  }

  async setLastHeartbeat(participantId: string): Promise<void> {
    const key = `participant:${participantId}:lastHeartbeat`;
    await this.client.set(key, Date.now().toString());
  }

  async getLastHeartbeat(participantId: string): Promise<number | null> {
    const key = `participant:${participantId}:lastHeartbeat`;
    const result = await this.client.get(key);
    return result ? parseInt(result, 10) : null;
  }

  async setSocketId(participantId: string, socketId: string): Promise<void> {
    const key = `participant:${participantId}:socketId`;
    await this.client.set(key, socketId);
  }

  async getSocketId(participantId: string): Promise<string | null> {
    const key = `participant:${participantId}:socketId`;
    return await this.client.get(key);
  }

  // Journey management
  async addActiveJourney(journeyId: string): Promise<void> {
    await this.client.sadd('journey:active', journeyId);
  }

  async removeActiveJourney(journeyId: string): Promise<void> {
    await this.client.srem('journey:active', journeyId);
  }

  async getActiveJourneys(): Promise<string[]> {
    return await this.client.smembers('journey:active');
  }

  async setJourneyLeader(journeyId: string, leaderId: string): Promise<void> {
    const key = `journey:${journeyId}:leader`;
    await this.client.set(key, leaderId);
  }

  async getJourneyLeader(journeyId: string): Promise<string | null> {
    const key = `journey:${journeyId}:leader`;
    return await this.client.get(key);
  }

  async addJourneyParticipant(
    journeyId: string,
    participantId: string,
  ): Promise<void> {
    const key = `journey:${journeyId}:participants`;
    await this.client.sadd(key, participantId);
  }

  async removeJourneyParticipant(
    journeyId: string,
    participantId: string,
  ): Promise<void> {
    const key = `journey:${journeyId}:participants`;
    await this.client.srem(key, participantId);
  }

  async getJourneyParticipants(journeyId: string): Promise<string[]> {
    const key = `journey:${journeyId}:participants`;
    return await this.client.smembers(key);
  }

  // Location caching
  async cacheLocation(
    journeyId: string,
    participantId: string,
    location: CachedLocation,
  ): Promise<void> {
    const key = `journey:${journeyId}:location:${participantId}`;
    await this.client.setex(key, 300, JSON.stringify(location)); // 5 minutes TTL
  }

  async getCachedLocation(
    journeyId: string,
    participantId: string,
  ): Promise<CachedLocation | null> {
    const key = `journey:${journeyId}:location:${participantId}`;
    const result = await this.client.get(key);
    return result ? (JSON.parse(result) as CachedLocation) : null;
  }

  // WebSocket room management
  async addSocketToRoom(journeyId: string, socketId: string): Promise<void> {
    const key = `ws:room:${journeyId}`;
    await this.client.sadd(key, socketId);
  }

  async removeSocketFromRoom(
    journeyId: string,
    socketId: string,
  ): Promise<void> {
    const key = `ws:room:${journeyId}`;
    await this.client.srem(key, socketId);
  }

  async getRoomSockets(journeyId: string): Promise<string[]> {
    const key = `ws:room:${journeyId}`;
    return await this.client.smembers(key);
  }

  async setSocketUser(socketId: string, userId: string): Promise<void> {
    const key = `ws:socket:${socketId}:user`;
    await this.client.set(key, userId);
  }

  async getSocketUser(socketId: string): Promise<string | null> {
    const key = `ws:socket:${socketId}:user`;
    return await this.client.get(key);
  }

  async deleteSocketUser(socketId: string): Promise<void> {
    const key = `ws:socket:${socketId}:user`;
    await this.client.del(key);
  }

  // Pending delivery management for acknowledgments
  async addPendingDelivery(
    journeyId: string,
    participantId: string,
    update: any,
  ): Promise<void> {
    const key = `pending:${journeyId}:${participantId}`;
    await this.client.lpush(key, JSON.stringify(update));
    await this.client.expire(key, 3600); // 1 hour TTL
  }

  async getPendingDeliveries(
    journeyId: string,
    participantId: string,
  ): Promise<any[]> {
    const key = `pending:${journeyId}:${participantId}`;
    const results = await this.client.lrange(key, 0, -1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return results.map((item) => JSON.parse(item));
  }

  async removePendingDelivery(
    journeyId: string,
    participantId: string,
  ): Promise<void> {
    const key = `pending:${journeyId}:${participantId}`;
    await this.client.del(key);
  }

  // Rate limiting
  async checkRateLimit(
    key: string,
    limit: number,
    window: number,
  ): Promise<boolean> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, window);
    }
    return count <= limit;
  }

  // Cleanup utilities
  async clearJourneyCache(journeyId: string): Promise<void> {
    const keys = await this.client.keys(`journey:${journeyId}:*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}
