import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

export const CORRELATION_ID_HEADER = 'X-Correlation-Id'

interface CorrelationRequest {
  correlationId?: unknown
  headers?: IncomingHttpHeaders
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function correlationIdFor(request: CorrelationRequest): string {
  if (isCorrelationId(request.correlationId)) {
    return request.correlationId
  }

  const incoming = request.headers?.['x-correlation-id']
  const correlationId = isCorrelationId(incoming) ? incoming : randomUUID()
  request.correlationId = correlationId

  return correlationId
}
