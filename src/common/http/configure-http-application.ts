import type { INestApplication } from '@nestjs/common'

import type { Environment } from '../../config/env.schema'
import { CORRELATION_ID_HEADER } from './correlation-id'

export function configureHttpApplication(app: INestApplication, config: Environment): void {
  app.enableCors({
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', CORRELATION_ID_HEADER],
    credentials: false,
    exposedHeaders: [CORRELATION_ID_HEADER],
    methods: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
    origin: config.CORS_ALLOWED_ORIGINS,
  })
}
