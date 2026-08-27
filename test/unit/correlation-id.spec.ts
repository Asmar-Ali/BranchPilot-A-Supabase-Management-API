import {
  CORRELATION_ID_HEADER,
  correlationIdFor,
  isCorrelationId,
} from '../../src/common/http/correlation-id'

describe('correlation IDs', () => {
  it('preserves a valid incoming UUID', () => {
    const correlationId = '6ca180bf-e2d4-4d61-8efd-e4580a7554c9'
    const request: { correlationId?: string; headers: Record<string, string> } = {
      headers: { 'x-correlation-id': correlationId },
    }

    expect(correlationIdFor(request)).toBe(correlationId)
    expect(request.correlationId).toBe(correlationId)
  })

  it('replaces an invalid incoming value with one generated UUID', () => {
    const request = { headers: { 'x-correlation-id': 'not-a-uuid' } }

    const correlationId = correlationIdFor(request)

    expect(correlationId).not.toBe('not-a-uuid')
    expect(isCorrelationId(correlationId)).toBe(true)
    expect(correlationIdFor(request)).toBe(correlationId)
  })

  it('uses the documented response header name', () => {
    expect(CORRELATION_ID_HEADER).toBe('X-Correlation-Id')
  })
})
