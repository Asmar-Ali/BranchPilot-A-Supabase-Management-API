import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Pool, PoolClient } from 'pg'

import {
  defaultMigrationsDirectory,
  loadMigrations,
  runMigrations,
} from '../../src/database/migrations/migration-runner'

describe('migration runner', () => {
  it('loads the initial schema migration with a stable checksum', async () => {
    const migrations = await loadMigrations(defaultMigrationsDirectory())

    expect(migrations).toHaveLength(1)
    expect(migrations[0]?.id).toBe('001_initial_schema.sql')
    expect(migrations[0]?.checksum).toBe(
      createHash('sha256')
        .update(migrations[0]?.sql ?? '')
        .digest('hex'),
    )
  })

  it('loads multiple migrations in filename order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'branchpilot-migrations-'))

    try {
      await writeFile(join(directory, '002_second.sql'), 'SELECT 2;')
      await writeFile(join(directory, '001_first.sql'), 'SELECT 1;')
      await writeFile(join(directory, 'not-a-migration.txt'), 'ignored')

      const migrations = await loadMigrations(directory)

      expect(migrations.map((migration) => migration.id)).toEqual([
        '001_first.sql',
        '002_second.sql',
      ])
    } finally {
      await rm(directory, { recursive: true })
    }
  })

  it('records a new migration and skips it when rerun', async () => {
    const applied: Array<{ checksum: string; id: string }> = []
    const client = {
      query: vi.fn(async (query: string | { text: string; values: string[] }) => {
        if (typeof query === 'string' && query.includes('SELECT id, checksum')) {
          return { rows: applied }
        }

        if (typeof query !== 'string' && query.text.includes('INSERT INTO schema_migrations')) {
          const [id, checksum] = query.values

          if (id === undefined || checksum === undefined) {
            throw new Error('Migration insert must include an id and checksum')
          }

          applied.push({ checksum, id })
        }

        return { rows: [] }
      }),
      release: vi.fn(),
    } as unknown as PoolClient
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool

    await runMigrations(pool, defaultMigrationsDirectory())
    await runMigrations(pool, defaultMigrationsDirectory())

    expect(applied).toHaveLength(1)
    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(2)
  })

  it('stops the run when an applied migration has changed on disk', async () => {
    const client = {
      query: vi.fn(async (query: string | { text: string }) => {
        const text = typeof query === 'string' ? query : query.text

        if (text.includes('SELECT id, checksum')) {
          return { rows: [{ checksum: 'stale-checksum', id: '001_initial_schema.sql' }] }
        }

        return { rows: [] }
      }),
      release: vi.fn(),
    } as unknown as PoolClient
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool

    await expect(runMigrations(pool, defaultMigrationsDirectory())).rejects.toThrow(
      'Migration 001_initial_schema.sql has changed after it was applied',
    )
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back and rethrows when a migration statement fails', async () => {
    const client = {
      query: vi.fn(async (query: string | { text: string }) => {
        const text = typeof query === 'string' ? query : query.text

        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [] }
        }

        if (text.includes('schema_migrations')) {
          return { rows: [] }
        }

        // Anything else is the migration file's own SQL body; simulate it failing.
        throw new Error('syntax error in migration')
      }),
      release: vi.fn(),
    } as unknown as PoolClient
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool

    await expect(runMigrations(pool, defaultMigrationsDirectory())).rejects.toThrow(
      'syntax error in migration',
    )
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })
})
