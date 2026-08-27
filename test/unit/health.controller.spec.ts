import { HealthController } from '../../src/health/health.controller'
import type { HealthService } from '../../src/health/health.service'

describe('HealthController', () => {
  it('delegates liveness checks to HealthService', () => {
    const healthService: Pick<HealthService, 'live' | 'ready'> = {
      live: vi.fn().mockReturnValue({ status: 'ok' }),
      ready: vi.fn().mockResolvedValue({ status: 'ok' }),
    }
    const controller = new HealthController(healthService)

    expect(controller.live()).toEqual({ status: 'ok' })
    expect(healthService.live).toHaveBeenCalledOnce()
  })

  it('delegates readiness checks to HealthService', async () => {
    const healthService: Pick<HealthService, 'live' | 'ready'> = {
      live: vi.fn().mockReturnValue({ status: 'ok' }),
      ready: vi.fn().mockResolvedValue({ status: 'ok' }),
    }
    const controller = new HealthController(healthService)

    await expect(controller.ready()).resolves.toEqual({ status: 'ok' })
    expect(healthService.ready).toHaveBeenCalledOnce()
  })
})
