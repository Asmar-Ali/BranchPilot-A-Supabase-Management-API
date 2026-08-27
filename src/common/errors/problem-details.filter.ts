import { Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import type { ArgumentsHost } from '@nestjs/common'
import { ThrottlerException } from '@nestjs/throttler'
import type { IncomingHttpHeaders } from 'node:http'

import { correlationIdFor, CORRELATION_ID_HEADER } from '../http/correlation-id'
import { AppError } from './app-error'

interface ProblemDetails {
  readonly code: string
  readonly correlationId: string
  readonly retryable: boolean
  readonly status: number
  readonly title: string
  readonly type: string
}

interface HttpRequest {
  correlationId?: unknown
  headers?: IncomingHttpHeaders
}

interface HttpResponse {
  send(body: ProblemDetails): void
  setHeader(name: string, value: string): HttpResponse
  status(status: number): HttpResponse
  type(contentType: string): HttpResponse
}

const problemType = (name: string): string => `https://branchpilot.dev/problems/${name}`

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<HttpRequest>()
    const response = http.getResponse<HttpResponse>()
    const correlationId = correlationIdFor(request)
    const problem = this.toProblemDetails(exception, correlationId)

    response
      .status(problem.status)
      .setHeader(CORRELATION_ID_HEADER, correlationId)
      .type('application/problem+json')
      .send(problem)
  }

  private toProblemDetails(exception: unknown, correlationId: string): ProblemDetails {
    if (exception instanceof AppError) {
      return {
        ...exception.extensions,
        code: exception.code,
        correlationId,
        retryable: exception.retryable,
        status: exception.status,
        title: exception.title,
        type: exception.type,
      }
    }

    if (exception instanceof ThrottlerException) {
      return {
        code: 'RATE_LIMITED',
        correlationId,
        retryable: true,
        status: HttpStatus.TOO_MANY_REQUESTS,
        title: 'Request rate limit exceeded',
        type: problemType('rate-limited'),
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      return {
        ...this.httpExceptionDetails(status),
        correlationId,
        status,
      }
    }

    return {
      code: 'INTERNAL_SERVER_ERROR',
      correlationId,
      retryable: false,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      title: 'Internal server error',
      type: problemType('internal-server-error'),
    }
  }

  private httpExceptionDetails(status: number): Omit<ProblemDetails, 'correlationId' | 'status'> {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return {
          code: 'VALIDATION_FAILED',
          retryable: false,
          title: 'Request validation failed',
          type: problemType('validation-failed'),
        }
      case HttpStatus.UNAUTHORIZED:
        return {
          code: 'UNAUTHORIZED',
          retryable: false,
          title: 'Authentication is required',
          type: problemType('unauthorized'),
        }
      case HttpStatus.FORBIDDEN:
        return {
          code: 'FORBIDDEN',
          retryable: false,
          title: 'Access is forbidden',
          type: problemType('forbidden'),
        }
      case HttpStatus.NOT_FOUND:
        return {
          code: 'NOT_FOUND',
          retryable: false,
          title: 'Resource not found',
          type: problemType('not-found'),
        }
      default:
        return {
          code: 'HTTP_ERROR',
          retryable: status >= HttpStatus.INTERNAL_SERVER_ERROR,
          title: 'Request failed',
          type: problemType('http-error'),
        }
    }
  }
}
