import { NestFactory } from '@nestjs/core'

import { AppConfigModule, APP_CONFIG } from '../src/config/config.module'
import type { Environment } from '../src/config/env.schema'
import { createDatabasePool } from '../src/database/database.pool'
import { runMigrations } from '../src/database/migrations/migration-runner'

async function migrate(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppConfigModule, { logger: false })
  const config = app.get<Environment>(APP_CONFIG)
  const pool = createDatabasePool(config.DATABASE_URL)

  try {
    await runMigrations(pool)
  } finally {
    await pool.end()
    await app.close()
  }
}

void migrate().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration failure'
  console.error(`Database migration failed: ${message}`)
  process.exitCode = 1
})
