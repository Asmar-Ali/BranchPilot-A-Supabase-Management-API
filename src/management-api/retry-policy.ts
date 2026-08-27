export type RequestMethod = 'DELETE' | 'GET' | 'POST'

export interface RetryDecisionInput {
  readonly attempt: number
  readonly method: RequestMethod
  readonly networkFailure?: boolean
  readonly status?: number
}

const MAX_GET_ATTEMPTS = 3
const MAX_RETRY_DELAY_MS = 2_000

/** Determines retry eligibility only; HTTP execution remains in the client adapter. */
export class RetryPolicy {
  public nextDelayMs(input: RetryDecisionInput): number | undefined {
    const retryableGetFailure =
      input.method === 'GET' && (input.networkFailure === true || (input.status ?? 0) >= 500)

    if (!retryableGetFailure || input.attempt >= MAX_GET_ATTEMPTS) {
      return undefined
    }

    const upperBound = Math.min(250 * 2 ** (input.attempt - 1), MAX_RETRY_DELAY_MS)
    return Math.floor(Math.random() * (upperBound + 1))
  }

  public retryAfterSeconds(header: string | null): number | undefined {
    if (header === null || !/^\d+$/.test(header.trim())) {
      return undefined
    }

    return Math.min(Number(header), 60)
  }
}
