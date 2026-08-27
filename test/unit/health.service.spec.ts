import { HealthService } from '../../src/health/health.service'

describe('HealthService', () => {
  it('reports that the process is alive', () => {
    const service = new HealthService()

    expect(service.live()).toEqual({ status: 'ok' })
  })
})
