import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { Pool, QueryResultRow } from 'pg'

export interface Migration {
  readonly checksum: string
  readonly id: string
  readonly sql: string
}

interface AppliedMigration extends QueryResultRow {
  readonly checksum: string
  readonly id: string
}

const migrationFilePattern = /^\d+_[a-z0-9_]+\.sql$/

export function defaultMigrationsDirectory(): string {
  return resolve(process.cwd(), 'src/database/migrations')
}

export async function loadMigrations(
  directory = defaultMigrationsDirectory(),
): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const filenames = entries
    .filter((entry) => entry.isFile() && migrationFilePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  return Promise.all(
    filenames.map(async (id) => {
      const sql = await readFile(resolve(directory, id), 'utf8')

      return {
        checksum: createHash('sha256').update(sql).digest('hex'),
        id,
        sql,
      }
    }),
  )
}

export async function runMigrations(
  pool: Pool,
  directory = defaultMigrationsDirectory(),
): Promise<void> {
  const migrations = await loadMigrations(directory)
  const client = await pool.connect()

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const appliedResult = await client.query<AppliedMigration>(
      'SELECT id, checksum FROM schema_migrations',
    )
    const applied = new Map(
      appliedResult.rows.map((migration) => [migration.id, migration.checksum]),
    )

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.id)

      if (existingChecksum !== undefined) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Migration ${migration.id} has changed after it was applied`)
        }

        continue
      }

      await client.query('BEGIN')

      try {
        await client.query(migration.sql)
        await client.query({
          text: 'INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)',
          values: [migration.id, migration.checksum],
        })
        await client.query('COMMIT')
      } catch (error: unknown) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    client.release()
  }
}
