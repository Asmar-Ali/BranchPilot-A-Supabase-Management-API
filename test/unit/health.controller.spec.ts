import { HealthController } from '../../src/health/health.controller'
import type { HealthService } from '../../src/health/health.service'

describe('HealthController', () => {
  it('delegates liveness checks to HealthService', () => {
    const healthService: HealthService = {
      live: vi.fn().mockReturnValue({ status: 'ok' }),
    }
    const controller = new HealthController(healthService)

    expect(controller.live()).toEqual({ status: 'ok' })
    expect(healthService.live).toHaveBeenCalledOnce()
  })
})
