import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

import { DatabaseAuditService } from '../../src/audit/audit.service'
import { BranchesService, type CreateBranchInput } from '../../src/branches/branches.service'
import { AppError } from '../../src/common/errors/app-error'
import { DatabaseService } from '../../src/database/database.service'
import type { ManagementApiClient, ManagementBranch } from '../../src/management-api/management-api.tokens'
import { createTestDatabasePool, migrateTestDatabase, truncateTables } from '../support/database'

const context = { actorSub: 'user-1', correlationId: randomUUID() } as const
const createInput: CreateBranchInput = {
  branchName: 'feature-1',
  idempotencyKey: 'key-1',
  persistent: false,
  projectRef: 'project-1',
  withData: false,
}

function fakeManagementApi(overrides: Partial<ManagementApiClient> = {}): ManagementApiClient {
  return {
    createBranch: vi
      .fn()
      .mockResolvedValue({ name: 'feature-1', ref: 'ref-1', status: 'ACTIVE_HEALTHY' } satisfies ManagementBranch),
    deleteBranch: vi.fn(),
    getBranch: vi.fn(),
    listBranches: vi.fn().mockResolvedValue([]),
    listOrganizations: vi.fn(),
    listProjects: vi.fn(),
    ...overrides,
  } as unknown as ManagementApiClient
}

describe('BranchesService branch_operations persistence', () => {
  let pool: Pool
  let database: DatabaseService
  let audit: DatabaseAuditService

  beforeAll(async () => {
    pool = createTestDatabasePool()
    await migrateTestDatabase(pool)
    database = new DatabaseService(pool)
    audit = new DatabaseAuditService(database)
  })

  afterEach(async () => {
    await truncateTables(pool, ['branch_operations', 'audit_events'])
  })

  afterAll(async () => {
    await pool.end()
  })

  it('enforces one operation row per (actor_sub, idempotency_key) via the unique constraint', async () => {
    const service = new BranchesService(database, fakeManagementApi(), audit)

    await service.create(context, createInput)

    const rows = await pool.query<{ idempotency_key: string; state: string }>(
      'SELECT idempotency_key, state FROM branch_operations WHERE actor_sub = $1',
      ['user-1'],
    )
    expect(rows.rows).toEqual([{ idempotency_key: 'key-1', state: 'succeeded' }])
  })

  it('replays the stored result for a matching request without a second insert', async () => {
    const managementApi = fakeManagementApi()
    const service = new BranchesService(database, managementApi, audit)

    const first = await service.create(context, createInput)
    const second = await service.create(context, createInput)

    expect(first).toEqual(second)
    expect(vi.mocked(managementApi.createBranch)).toHaveBeenCalledOnce()
    const rows = await pool.query('SELECT id FROM branch_operations WHERE actor_sub = $1', [
      'user-1',
    ])
    expect(rows.rows).toHaveLength(1)
  })

  it('rejects a replayed idempotency key whose request hash differs', async () => {
    const service = new BranchesService(database, fakeManagementApi(), audit)

    await service.create(context, createInput)

    await expect(
      service.create(context, { ...createInput, branchName: 'feature-2' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 } satisfies Partial<AppError>)
  })

  it('persists an unknown state after an ambiguous failure, then resolves it on reconciliation', async () => {
    const managementApi = fakeManagementApi({
      createBranch: vi.fn().mockRejectedValue(
        new AppError({
          code: 'SUPABASE_UPSTREAM_UNAVAILABLE',
          retryable: true,
          status: 503,
          title: 'Supabase API is temporarily unavailable',
          type: 'https://branchpilot.dev/problems/supabase-upstream-unavailable',
        }),
      ),
      listBranches: vi.fn().mockResolvedValue([]),
    })
    const service = new BranchesService(database, managementApi, audit)

    await expect(service.create(context, createInput)).rejects.toMatchObject({
      code: 'BRANCH_CREATE_OUTCOME_UNKNOWN',
    } satisfies Partial<AppError>)

    const pending = await pool.query<{ state: string }>(
      'SELECT state FROM branch_operations WHERE actor_sub = $1',
      ['user-1'],
    )
    expect(pending.rows).toEqual([{ state: 'unknown' }])

    vi.mocked(managementApi.listBranches).mockResolvedValue([
      { name: 'feature-1', ref: 'ref-1', status: 'ACTIVE_HEALTHY' },
    ])

    await expect(service.create(context, createInput)).resolves.toEqual({
      name: 'feature-1',
      ref: 'ref-1',
      status: 'ready',
    })
    const resolved = await pool.query<{ state: string; upstream_branch_ref: string | null }>(
      'SELECT state, upstream_branch_ref FROM branch_operations WHERE actor_sub = $1',
      ['user-1'],
    )
    expect(resolved.rows).toEqual([{ state: 'succeeded', upstream_branch_ref: 'ref-1' }])
  })

  it('writes an append-only audit event for a successful create', async () => {
    const service = new BranchesService(database, fakeManagementApi(), audit)

    await service.create(context, createInput)

    const events = await pool.query<{ action: string; target_id: string }>(
      'SELECT action, target_id FROM audit_events WHERE actor_sub = $1',
      ['user-1'],
    )
    expect(events.rows).toEqual([{ action: 'branch.created', target_id: 'ref-1' }])
  })
})
