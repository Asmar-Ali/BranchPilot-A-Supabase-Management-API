import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common'
import type { Pool, QueryResult, QueryResultRow } from 'pg'

import { DATABASE_POOL } from './database.tokens'

export type DatabaseParameter = boolean | Buffer | Date | number | string | null

export interface ParameterizedQuery {
  readonly text: string
  readonly values?: readonly DatabaseParameter[]
}

export interface Database {
  query<Row extends QueryResultRow = QueryResultRow>(
    query: ParameterizedQuery,
  ): Promise<QueryResult<Row>>
  ping(): Promise<void>
}

@Injectable()
export class DatabaseService implements Database, OnApplicationShutdown {
  public constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  public query<Row extends QueryResultRow = QueryResultRow>(
    query: ParameterizedQuery,
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row, DatabaseParameter[]>({
      text: query.text,
      values: query.values === undefined ? undefined : [...query.values],
    })
  }

  public async ping(): Promise<void> {
    await this.query({ text: 'SELECT 1' })
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.pool.end()
  }
}
