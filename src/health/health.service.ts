import { Injectable } from '@nestjs/common'

import { AppError } from '../common/errors/app-error'
import { DATABASE } from '../database/database.tokens'
import type { Database } from '../database/database.service'
import { Inject } from '@nestjs/common'

@Injectable()
export class HealthService {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public live(): { status: 'ok' } {
    return { status: 'ok' }
  }

  public async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.database.ping()
      return { status: 'ok' }
    } catch {
      throw new AppError({
        code: 'DATABASE_UNAVAILABLE',
        retryable: true,
        status: 503,
        title: 'Database unavailable',
        type: 'https://branchpilot.dev/problems/database-unavailable',
      })
    }
  }
}
