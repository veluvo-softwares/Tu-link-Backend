import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  public db: NodePgDatabase<typeof schema>;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      host: this.configService.get<string>('database.host'),
      port: this.configService.get<number>('database.port'),
      user: this.configService.get<string>('database.user'),
      password: this.configService.get<string>('database.password'),
      database: this.configService.get<string>('database.database'),
      max: this.configService.get<number>('database.poolMax'),
    });

    this.db = drizzle(this.pool, { schema });

    try {
      await this.pool.query('SELECT 1');
      console.log('✅ Postgres connected');
    } catch (err) {
      console.log('❌ Postgres connection failed', err);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
