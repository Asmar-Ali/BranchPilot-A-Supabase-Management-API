import type { Pool, QueryResult } from 'pg'

import { DatabaseService } from '../../src/database/database.service'

describe('DatabaseService', () => {
  it('forwards SQL and positional values through its pool', async () => {
    const result: QueryResult = {
      command: 'SELECT',
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [{ value: 1 }],
    }
    const pool = {
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(result),
    } as unknown as Pool
    const database = new DatabaseService(pool)

    await expect(database.query({ text: 'SELECT $1::int AS value', values: [1] })).resolves.toEqual(
      result,
    )
    expect(pool.query).toHaveBeenCalledWith({
      text: 'SELECT $1::int AS value',
      values: [1],
    })
  })

  it('closes the pool when Nest shuts down', async () => {
    const pool = {
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool
    const database = new DatabaseService(pool)

    await database.onApplicationShutdown()

    expect(pool.end).toHaveBeenCalledOnce()
  })

  it('checks connectivity with a minimal query', async () => {
    const pool = {
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({}),
    } as unknown as Pool
    const database = new DatabaseService(pool)

    await database.ping()

    expect(pool.query).toHaveBeenCalledWith({ text: 'SELECT 1', values: undefined })
  })
})
