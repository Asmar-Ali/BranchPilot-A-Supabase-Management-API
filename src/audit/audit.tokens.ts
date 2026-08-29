export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE')

export type AuditOutcome = 'failure' | 'success'

export type AuditMetadataValue = boolean | number | string

export interface AuditEvent {
  readonly actorSub: string
  readonly action: string
  readonly correlationId: string
  readonly metadata?: Readonly<Record<string, AuditMetadataValue>>
  readonly outcome: AuditOutcome
  readonly targetId?: string
  readonly targetType: string
  readonly upstreamStatus?: number
}

export interface AuditService {
  record(event: AuditEvent): Promise<void>
}
