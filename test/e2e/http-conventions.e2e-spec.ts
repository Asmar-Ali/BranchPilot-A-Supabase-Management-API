import type { INestApplication } from '@nestjs/common'
import { Controller, Get } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/app.module'
import { AppError } from '../../src/common/errors/app-error'
import { configureHttpApplication } from '../../src/common/http/configure-http-application'
import { APP_CONFIG } from '../../src/config/config.module'
import type { Environment } from '../../src/config/env.schema'

@Controller('test-http-conventions')
class HttpConventionsTestController {
  @Get('error')
  public error(): never {
    throw new Error('sensitive implementation detail')
  }

  @Get('validation-error')
  public validationError(): never {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      retryable: false,
      status: 400,
      title: 'Request validation failed',
      type: 'https://branchpilot.dev/problems/validation-failed',
    })
  }

  @Get('limited')
  @Throttle({
    default: { limit: 1, ttl: 60_000 },
    write: { limit: 100, ttl: 60_000 },
  })
  public limited(): { status: 'ok' } {
    return { status: 'ok' }
  }
}

describe('HTTP conventions', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HttpConventionsTestController],
      imports: [AppModule],
    }).compile()

    app = moduleRef.createNestApplication()
    configureHttpApplication(app, app.get<Environment>(APP_CONFIG))
    await app.init()
  })

  afterAll(async () => {
    if (app !== undefined) {
      await app.close()
    }
  })

  it('returns a stable Problem Details response with the caller correlation ID', async () => {
    const correlationId = '6ca180bf-e2d4-4d61-8efd-e4580a7554c9'
    const response = await request(app.getHttpServer())
      .get('/test-http-conventions/error')
      .set('X-Correlation-Id', correlationId)
      .expect('Content-Type', /application\/problem\+json/)
      .expect(500)

    expect(response.headers['x-correlation-id']).toBe(correlationId)
    expect(response.body).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      correlationId,
      retryable: false,
      status: 500,
      title: 'Internal server error',
      type: 'https://branchpilot.dev/problems/internal-server-error',
    })
    expect(response.text).not.toContain('sensitive implementation detail')
  })

  it('generates a correlation ID when the caller provides an invalid one', async () => {
    const response = await request(app.getHttpServer())
      .get('/test-http-conventions/validation-error')
      .set('X-Correlation-Id', 'invalid')
      .expect(400)

    expect(response.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(response.headers['x-correlation-id']).not.toBe('invalid')
    expect(response.body.code).toBe('VALIDATION_FAILED')
  })

  it('uses the same problem shape when a route is rate limited', async () => {
    await request(app.getHttpServer()).get('/test-http-conventions/limited').expect(200)

    const response = await request(app.getHttpServer())
      .get('/test-http-conventions/limited')
      .expect('Content-Type', /application\/problem\+json/)
      .expect(429)

    expect(response.body).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      status: 429,
      title: 'Request rate limit exceeded',
      type: 'https://branchpilot.dev/problems/rate-limited',
    })
    expect(response.body.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('allows preflight requests from configured origins and exposes the correlation header', async () => {
    const response = await request(app.getHttpServer())
      .options('/health/live')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204)

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(response.headers['access-control-expose-headers']).toContain('X-Correlation-Id')
  })
})
