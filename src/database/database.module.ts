import { Module } from '@nestjs/common'

import { APP_CONFIG } from '../config/config.module'
import type { Environment } from '../config/env.schema'
import { createDatabasePool } from './database.pool'
import { DatabaseService } from './database.service'
import { DATABASE, DATABASE_POOL } from './database.tokens'

@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: (config: Environment) => createDatabasePool(config.DATABASE_URL),
      inject: [APP_CONFIG],
    },
    DatabaseService,
    {
      provide: DATABASE,
      useExisting: DatabaseService,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
