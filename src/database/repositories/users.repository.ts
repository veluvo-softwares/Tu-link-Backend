import { Injectable } from '@nestjs/common';
import { eq, ilike, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database.service';
import { users } from '../schema';

export type UserRow = typeof users.$inferSelect;

export interface CreateUserInput {
  id: string; // Firebase UID (invariant A)
  email: string;
  displayName: string;
  phoneNumber?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  isGuest?: boolean;
}

export interface UpdateUserInput {
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
}

export interface UserSearchResult {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
}

// Escapes LIKE/ILIKE wildcards so user input is matched literally.
const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

@Injectable()
export class UsersRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.db;
  }

  async create(input: CreateUserInput): Promise<UserRow> {
    const [row] = await this.db
      .insert(users)
      .values({
        id: input.id,
        email: input.email,
        displayName: input.displayName,
        phoneNumber: input.phoneNumber,
        emailVerified: input.emailVerified ?? false,
        phoneVerified: input.phoneVerified ?? false,
        isGuest: input.isGuest ?? false,
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  // Always bumps updated_at (replaces FieldValue.serverTimestamp()).
  async update(id: string, patch: UpdateUserInput): Promise<UserRow | null> {
    const [row] = await this.db
      .update(users)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning();
    return row ?? null;
  }

  async setLastLogout(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ lastLogout: sql`now()` })
      .where(eq(users.id, id));
  }

  // Replaces the Firestore  prefix trick + in-memory substring filter
  // with a case-insensitive substring match over name and email (plan §6).
  async search(query: string, limit: number): Promise<UserSearchResult[]> {
    const pattern = `%${escapeLike(query.trim())}%`;
    const rows = await this.db
      .select({
        uid: users.id,
        email: users.email,
        displayName: users.displayName,
        phoneNumber: users.phoneNumber,
      })
      .from(users)
      .where(or(ilike(users.displayName, pattern), ilike(users.email, pattern)))
      .limit(limit);

    return rows.map((r) => ({
      uid: r.uid,
      email: r.email,
      displayName: r.displayName,
      phoneNumber: r.phoneNumber ?? undefined,
    }));
  }
}
