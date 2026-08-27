import type { Pool } from 'pg'

import { createDatabasePool } from '../../src/database/database.pool'
import { runMigrations } from '../../src/database/migrations/migration-runner'

export function createTestDatabasePool(): Pool {
  return createDatabasePool(process.env.DATABASE_URL ?? '')
}

export async function migrateTestDatabase(pool: Pool): Promise<void> {
  await runMigrations(pool)
}

export async function truncateTables(pool: Pool, tables: readonly string[]): Promise<void> {
  await pool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`)
}
