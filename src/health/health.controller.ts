import { Controller, Get, Inject } from '@nestjs/common'

import { HealthService } from './health.service'

@Controller('health')
export class HealthController {
  public constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get('live')
  public live(): { status: 'ok' } {
    return this.healthService.live()
  }
}
