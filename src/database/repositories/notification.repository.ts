import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { NotificationType } from '../../types/notification.type';
import { DatabaseService } from '../database.service';
import { notifications } from '../schema';

export type NotificationRecord = typeof notifications.$inferSelect;

export interface CreateNotificationInput {
  journeyId: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

@Injectable()
export class NotificationRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        journeyId: input.journeyId,
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
      })
      .returning();
    return row;
  }

  // Replaces collectionGroup('notifications').where('recipientId','==',u).
  async findByRecipient(
    userId: string,
    limit: number,
  ): Promise<NotificationRecord[]> {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  // Direct keyed UPDATE scoped by recipient (replaces the 1000-doc scan +
  // in-memory find). Returns false when nothing matched → caller throws 404.
  async markAsRead(notificationId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .update(notifications)
      .set({ read: true, readAt: sql`now()` })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientId, userId),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  async delete(notificationId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientId, userId),
        ),
      )
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, userId),
          eq(notifications.read, false),
        ),
      );
    return row?.value ?? 0;
  }
}
