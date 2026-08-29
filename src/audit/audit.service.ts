import { Inject, Injectable } from '@nestjs/common'

import { DATABASE } from '../database/database.tokens'
import type { Database } from '../database/database.service'
import type { AuditEvent, AuditService } from './audit.tokens'
import { sanitizeMetadata } from './sanitize-metadata'

@Injectable()
export class DatabaseAuditService implements AuditService {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async record(event: AuditEvent): Promise<void> {
    await this.database.query({
      text: `INSERT INTO audit_events (
               actor_sub, action, target_type, target_id, outcome, correlation_id,
               upstream_status, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      values: [
        event.actorSub,
        event.action,
        event.targetType,
        event.targetId ?? null,
        event.outcome,
        event.correlationId,
        event.upstreamStatus ?? null,
        JSON.stringify(sanitizeMetadata(event.metadata)),
      ],
    })
  }
}
