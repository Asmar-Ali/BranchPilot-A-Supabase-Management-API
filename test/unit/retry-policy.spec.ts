import { RetryPolicy } from '../../src/management-api/retry-policy'

describe('RetryPolicy', () => {
  const policy = new RetryPolicy()

  it.each([
    ['GET network failure', { attempt: 1, method: 'GET' as const, networkFailure: true }, true],
    ['GET 503', { attempt: 2, method: 'GET' as const, status: 503 }, true],
    ['GET after three attempts', { attempt: 3, method: 'GET' as const, status: 503 }, false],
    ['GET 403', { attempt: 1, method: 'GET' as const, status: 403 }, false],
    ['POST 503', { attempt: 1, method: 'POST' as const, status: 503 }, false],
    [
      'DELETE network failure',
      { attempt: 1, method: 'DELETE' as const, networkFailure: true },
      false,
    ],
  ])('retries only retryable GET failures: %s', (_name, input, shouldRetry) => {
    const delay = policy.nextDelayMs(input)

    expect(delay === undefined).toBe(!shouldRetry)
    if (delay !== undefined) expect(delay).toBeGreaterThanOrEqual(0)
  })

  it('parses and bounds Retry-After seconds', () => {
    expect(policy.retryAfterSeconds('8')).toBe(8)
    expect(policy.retryAfterSeconds('90')).toBe(60)
    expect(policy.retryAfterSeconds('Wed, 21 Oct 2015 07:28:00 GMT')).toBeUndefined()
  })
})
