import { Global, Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'

import { ProblemDetailsFilter } from '../errors/problem-details.filter'
import { correlationIdFor, CORRELATION_ID_HEADER } from './correlation-id'
import { ActorOrIpThrottlerGuard } from './throttler.guard'

@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        customProps: (request) => ({ correlationId: correlationIdFor(request) }),
        genReqId: (request, response) => {
          const correlationId = correlationIdFor(request)
          response.setHeader(CORRELATION_ID_HEADER, correlationId)
          return correlationId
        },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          remove: true,
        },
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        { limit: 100, name: 'default', ttl: 60_000 },
        {
          limit: 10,
          name: 'write',
          skipIf: (context) => {
            const request = context.switchToHttp().getRequest<{ method?: unknown }>()
            const method = request.method
            return (
              typeof method !== 'string' || !['DELETE', 'PATCH', 'POST', 'PUT'].includes(method)
            )
          },
          ttl: 60_000,
        },
      ],
    }),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ProblemDetailsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ActorOrIpThrottlerGuard,
    },
  ],
})
export class HttpConventionsModule {}
