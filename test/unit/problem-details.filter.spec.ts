import type { ArgumentsHost } from '@nestjs/common'
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'

import { AppError } from '../../src/common/errors/app-error'
import { ProblemDetailsFilter } from '../../src/common/errors/problem-details.filter'

interface RecordedResponse {
  body?: unknown
  contentType?: string
  headers: Record<string, string>
  statusCode?: number
}

function createHost(request: Record<string, unknown>): {
  host: ArgumentsHost
  response: RecordedResponse
} {
  const response: RecordedResponse = { headers: {} }
  const responseApi = {
    send(body: unknown) {
      response.body = body
    },
    setHeader(name: string, value: string) {
      response.headers[name] = value
      return responseApi
    },
    status(statusCode: number) {
      response.statusCode = statusCode
      return responseApi
    },
    type(contentType: string) {
      response.contentType = contentType
      return responseApi
    },
  }

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => responseApi,
    }),
  } as unknown as ArgumentsHost

  return { host, response }
}

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter()
  const correlationId = '6ca180bf-e2d4-4d61-8efd-e4580a7554c9'

  it('spreads AppError extensions into the response', () => {
    const { host, response } = createHost({ correlationId })

    filter.catch(
      new AppError({
        code: 'IDEMPOTENCY_KEY_REUSED',
        extensions: { retryAfterSeconds: 8 },
        retryable: true,
        status: 409,
        title: 'Idempotency key reused with a different request',
        type: 'https://branchpilot.dev/problems/idempotency-key-reused',
      }),
      host,
    )

    expect(response.statusCode).toBe(409)
    expect(response.contentType).toBe('application/problem+json')
    expect(response.headers['X-Correlation-Id']).toBe(correlationId)
    expect(response.body).toEqual({
      code: 'IDEMPOTENCY_KEY_REUSED',
      correlationId,
      retryAfterSeconds: 8,
      retryable: true,
      status: 409,
      title: 'Idempotency key reused with a different request',
      type: 'https://branchpilot.dev/problems/idempotency-key-reused',
    })
  })

  it('maps a ThrottlerException to a stable rate-limited problem', () => {
    const { host, response } = createHost({ correlationId })

    filter.catch(new ThrottlerException(), host)

    expect(response.statusCode).toBe(429)
    expect(response.body).toMatchObject({
      code: 'RATE_LIMITED',
      correlationId,
      retryable: true,
    })
  })

  it('maps a generic, non-HTTP exception to a sanitized internal-server-error problem', () => {
    const { host, response } = createHost({ correlationId })

    filter.catch(new Error('a stack trace nobody outside the process should see'), host)

    expect(response.statusCode).toBe(500)
    expect(response.body).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      correlationId,
      retryable: false,
      status: 500,
      title: 'Internal server error',
      type: 'https://branchpilot.dev/problems/internal-server-error',
    })
  })

  it.each([
    [new BadRequestException(), HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', false],
    [new UnauthorizedException(), HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', false],
    [new ForbiddenException(), HttpStatus.FORBIDDEN, 'FORBIDDEN', false],
    [new NotFoundException(), HttpStatus.NOT_FOUND, 'NOT_FOUND', false],
  ])('maps %p to code %s', (exception, status, code, retryable) => {
    const { host, response } = createHost({ correlationId })

    filter.catch(exception, host)

    expect(response.statusCode).toBe(status)
    expect(response.body).toMatchObject({ code, correlationId, retryable })
  })

  it('falls back to a non-retryable HTTP_ERROR for an unmapped 4xx HttpException', () => {
    const { host, response } = createHost({ correlationId })

    filter.catch(new HttpException('Conflict', HttpStatus.CONFLICT), host)

    expect(response.statusCode).toBe(409)
    expect(response.body).toMatchObject({ code: 'HTTP_ERROR', retryable: false })
  })

  it('marks an unmapped 5xx HttpException as retryable', () => {
    const { host, response } = createHost({ correlationId })

    filter.catch(new HttpException('Bad Gateway', HttpStatus.BAD_GATEWAY), host)

    expect(response.statusCode).toBe(502)
    expect(response.body).toMatchObject({ code: 'HTTP_ERROR', retryable: true })
  })
})
