import { Controller, Get, Inject } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import { HealthService } from './health.service'

@Controller('health')
@SkipThrottle({ default: true, write: true })
export class HealthController {
  public constructor(
    @Inject(HealthService) private readonly healthService: Pick<HealthService, 'live' | 'ready'>,
  ) {}

  @Get('live')
  public live(): { status: 'ok' } {
    return this.healthService.live()
  }

  @Get('ready')
  public ready(): Promise<{ status: 'ok' }> {
    return this.healthService.ready()
  }
}
