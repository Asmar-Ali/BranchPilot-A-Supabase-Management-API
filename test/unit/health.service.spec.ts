import { HealthService } from '../../src/health/health.service'
import type { Database } from '../../src/database/database.service'

describe('HealthService', () => {
  it('reports that the process is alive', () => {
    const database: Database = {
      ping: vi.fn(),
      query: vi.fn(),
    }
    const service = new HealthService(database)

    expect(service.live()).toEqual({ status: 'ok' })
  })

  it('reports ready when PostgreSQL responds', async () => {
    const database: Database = {
      ping: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
    }
    const service = new HealthService(database)

    await expect(service.ready()).resolves.toEqual({ status: 'ok' })
    expect(database.ping).toHaveBeenCalledOnce()
  })

  it('returns a safe retryable error when PostgreSQL is unavailable', async () => {
    const database: Database = {
      ping: vi.fn().mockRejectedValue(new Error('connection details must remain private')),
      query: vi.fn(),
    }
    const service = new HealthService(database)

    await expect(service.ready()).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      retryable: true,
      status: 503,
    })
  })
})
