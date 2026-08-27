import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { APP_CONFIG } from './config/config.module'
import { type Environment, EnvironmentValidationError } from './config/env.schema'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  const config = app.get<Environment>(APP_CONFIG)

  app.enableShutdownHooks()
  await app.listen(config.PORT)

  Logger.log(`BranchPilot API is listening on port ${config.PORT}`, 'Bootstrap')
}

void bootstrap().catch((error: unknown) => {
  if (error instanceof EnvironmentValidationError) {
    Logger.error(error.message, 'Bootstrap')
  } else {
    Logger.error('BranchPilot API failed to start', 'Bootstrap')
  }

  process.exitCode = 1
})
