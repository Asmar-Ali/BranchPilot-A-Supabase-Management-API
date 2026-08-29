import type { QueryResult, QueryResultRow } from 'pg'

import { DatabaseAuditService } from '../../src/audit/audit.service'
import type { AuditEvent } from '../../src/audit/audit.tokens'
import type { Database } from '../../src/database/database.service'

function queryResult<Row extends QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return { rowCount: rows.length, rows } as unknown as QueryResult<Row>
}

describe('DatabaseAuditService', () => {
  it('inserts an audit event with null defaults for omitted optional fields', async () => {
    const database = { ping: vi.fn(), query: vi.fn().mockResolvedValue(queryResult()) } as unknown as Database
    const service = new DatabaseAuditService(database)

    const event: AuditEvent = {
      actorSub: 'user-1',
      action: 'branch.created',
      correlationId: 'corr-1',
      outcome: 'success',
      targetId: 'ref-1',
      targetType: 'branch',
    }
    await service.record(event)

    const call = vi.mocked(database.query).mock.calls[0]?.[0]
    expect(call?.text).toContain('INSERT INTO audit_events')
    expect(call?.values).toEqual([
      'user-1',
      'branch.created',
      'branch',
      'ref-1',
      'success',
      'corr-1',
      null,
      '{}',
    ])
  })

  it('carries upstream status and metadata through when provided', async () => {
    const database = { ping: vi.fn(), query: vi.fn().mockResolvedValue(queryResult()) } as unknown as Database
    const service = new DatabaseAuditService(database)

    await service.record({
      actorSub: 'user-1',
      action: 'oauth.connection.revocation_failed',
      correlationId: 'corr-1',
      metadata: { reason: 'invalid_grant' },
      outcome: 'failure',
      targetType: 'supabase_connection',
      upstreamStatus: 400,
    })

    const call = vi.mocked(database.query).mock.calls[0]?.[0]
    expect(call?.values?.[3]).toBeNull()
    expect(call?.values?.[6]).toBe(400)
    expect(call?.values?.[7]).toBe(JSON.stringify({ reason: 'invalid_grant' }))
  })

  it('redacts token-shaped metadata values before persisting', async () => {
    const database = { ping: vi.fn(), query: vi.fn().mockResolvedValue(queryResult()) } as unknown as Database
    const service = new DatabaseAuditService(database)

    await service.record({
      actorSub: 'user-1',
      action: 'oauth.connection.created',
      correlationId: 'corr-1',
      metadata: {
        accessToken: 'sbp_' + 'a'.repeat(48),
        organizationSlug: 'acme',
      },
      outcome: 'success',
      targetType: 'supabase_connection',
    })

    const call = vi.mocked(database.query).mock.calls[0]?.[0]
    const metadata = JSON.parse(call?.values?.[7] as string) as Record<string, unknown>
    expect(metadata.accessToken).toBe('[redacted]')
    expect(metadata.organizationSlug).toBe('acme')
  })
})
