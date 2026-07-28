import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import { fcmTokens } from '../schema';

export interface AddFcmTokenInput {
  userId: string;
  token: string;
  platform?: string;
  deviceId?: string;
}

@Injectable()
export class FcmTokenRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  // Replaces FieldValue.arrayUnion on the user doc. Returns true when a new
  // token row was inserted (false when it already existed).
  async add(input: AddFcmTokenInput): Promise<boolean> {
    const rows = await this.db
      .insert(fcmTokens)
      .values({
        userId: input.userId,
        token: input.token,
        platform: input.platform ?? 'unknown',
        deviceId: input.deviceId,
      })
      .onConflictDoNothing({ target: [fcmTokens.userId, fcmTokens.token] })
      .returning({ id: fcmTokens.id });
    return rows.length > 0;
  }

  async getTokens(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ token: fcmTokens.token })
      .from(fcmTokens)
      .where(eq(fcmTokens.userId, userId));
    return rows.map((r) => r.token);
  }

  async countForUser(userId: string): Promise<number> {
    return (await this.getTokens(userId)).length;
  }

  async remove(userId: string, token: string): Promise<void> {
    await this.db
      .delete(fcmTokens)
      .where(and(eq(fcmTokens.userId, userId), eq(fcmTokens.token, token)));
  }

  // Cross-user cleanup of invalid tokens — one statement replaces the batched
  // array-contains-any scan + per-user array rewrite.
  async removeTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db.delete(fcmTokens).where(inArray(fcmTokens.token, tokens));
  }
}
