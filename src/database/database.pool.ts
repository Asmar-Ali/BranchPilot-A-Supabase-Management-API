import { Pool } from 'pg'

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({
    application_name: 'branchpilot',
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  })
}
