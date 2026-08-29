import './observability/tracing'

import { Logger as NestLogger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Logger as PinoLogger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { configureHttpApplication } from './common/http/configure-http-application'
import { APP_CONFIG } from './config/config.module'
import { type Environment, EnvironmentValidationError } from './config/env.schema'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  const config = app.get<Environment>(APP_CONFIG)

  app.useLogger(app.get(PinoLogger))
  configureHttpApplication(app, config)
  app.enableShutdownHooks()
  await app.listen(config.PORT)

  NestLogger.log(`BranchPilot API is listening on port ${config.PORT}`, 'Bootstrap')
}

void bootstrap().catch((error: unknown) => {
  if (error instanceof EnvironmentValidationError) {
    NestLogger.error(error.message, 'Bootstrap')
  } else {
    NestLogger.error('BranchPilot API failed to start', 'Bootstrap')
  }

  process.exitCode = 1
})
