import type { QueryResultRow } from 'pg'

import type { AuditEvent, AuditService } from '../../src/audit/audit.tokens'
import { AppError } from '../../src/common/errors/app-error'
import { BranchesService, type CreateBranchInput } from '../../src/branches/branches.service'
import type { Database } from '../../src/database/database.service'
import type { ManagementApiClient, ManagementBranch } from '../../src/management-api/management-api.tokens'

interface FakeOperation extends QueryResultRow {
  actor_sub: string
  id: string
  idempotency_key: string
  request_hash: string
  state: string
  upstream_branch_ref: string | null
  upstream_status: string | null
}

function fakeAudit(): AuditService & { readonly events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    record: vi.fn(async (event: AuditEvent) => {
      events.push(event)
    }),
  }
}

function createFakeDatabase(): {
  database: Database
  operations: FakeOperation[]
} {
  const operations: FakeOperation[] = []
  let nextId = 1

  const database = {
    ping: vi.fn(),
    query: vi.fn(
      async ({ text, values = [] }: { text: string; values?: readonly unknown[] }) => {
        if (text.includes('INSERT INTO branch_operations')) {
          const [actorSub, , , idempotencyKey, requestHash] = values as string[]
          const exists = operations.some(
            (op) => op.actor_sub === actorSub && op.idempotency_key === idempotencyKey,
          )
          if (exists) return { rowCount: 0, rows: [] }

          const row: FakeOperation = {
            actor_sub: actorSub!,
            id: `op-${nextId++}`,
            idempotency_key: idempotencyKey!,
            request_hash: requestHash!,
            state: 'pending',
            upstream_branch_ref: null,
            upstream_status: null,
          }
          operations.push(row)
          return { rowCount: 1, rows: [row] }
        }

        if (text.includes('SELECT id, request_hash, state, upstream_branch_ref, upstream_status')) {
          const [actorSub, idempotencyKey] = values as string[]
          const row = operations.find(
            (op) => op.actor_sub === actorSub && op.idempotency_key === idempotencyKey,
          )
          return { rowCount: row === undefined ? 0 : 1, rows: row === undefined ? [] : [row] }
        }

        if (text.includes("SET state = 'succeeded'")) {
          const [upstreamBranchRef, upstreamStatus, operationId] = values as string[]
          const row = operations.find((op) => op.id === operationId)
          if (row !== undefined) {
            row.state = 'succeeded'
            row.upstream_branch_ref = upstreamBranchRef!
            row.upstream_status = upstreamStatus!
          }
          return { rowCount: row === undefined ? 0 : 1, rows: [] }
        }

        if (text.includes('UPDATE branch_operations SET state = $1')) {
          const [state, operationId] = values as string[]
          const row = operations.find((op) => op.id === operationId)
          if (row !== undefined) row.state = state!
          return { rowCount: row === undefined ? 0 : 1, rows: [] }
        }

        throw new Error(`Unhandled query in fake database: ${text}`)
      },
    ),
  } as unknown as Database

  return { database, operations }
}

const context = { actorSub: 'user-1', correlationId: 'corr-1' } as const
const createInput: CreateBranchInput = {
  branchName: 'feature-1',
  idempotencyKey: 'key-1',
  persistent: false,
  projectRef: 'project-1',
  withData: false,
}

describe('BranchesService', () => {
  describe('list', () => {
    it('normalizes each branch status', async () => {
      const { database } = createFakeDatabase()
      const managementApi = {
        listBranches: vi.fn().mockResolvedValue([
          { name: 'main', ref: 'ref-main', status: 'ACTIVE_HEALTHY' },
          { name: 'wip', ref: 'ref-wip', status: 'RUNNING_MIGRATIONS' },
        ] satisfies ManagementBranch[]),
      } as unknown as ManagementApiClient
      const service = new BranchesService(database, managementApi, fakeAudit())

      await expect(service.list(context, 'project-1')).resolves.toEqual([
        { name: 'main', ref: 'ref-main', status: 'ready' },
        { name: 'wip', ref: 'ref-wip', status: 'pending' },
      ])
    })
  })

  describe('get', () => {
    it('normalizes a single branch status', async () => {
      const { database } = createFakeDatabase()
      const managementApi = {
        getBranch: vi
          .fn()
          .mockResolvedValue({ name: 'main', ref: 'ref-main', status: 'REMOVED' } satisfies ManagementBranch),
      } as unknown as ManagementApiClient
      const service = new BranchesService(database, managementApi, fakeAudit())

      await expect(
        service.get(context, { branchName: 'main', projectRef: 'project-1' }),
      ).resolves.toEqual({ name: 'main', ref: 'ref-main', status: 'inactive' })
    })
  })

  describe('create', () => {
    it('creates a branch, persists the result, and writes an audit event', async () => {
      const { database, operations } = createFakeDatabase()
      const managementApi = {
        createBranch: vi
          .fn()
          .mockResolvedValue({ name: 'feature-1', ref: 'ref-1', status: 'CREATING_PROJECT' } satisfies ManagementBranch),
      } as unknown as ManagementApiClient
      const audit = fakeAudit()
      const service = new BranchesService(database, managementApi, audit)

      await expect(service.create(context, createInput)).resolves.toEqual({
        name: 'feature-1',
        ref: 'ref-1',
        status: 'pending',
      })
      expect(managementApi.createBranch).toHaveBeenCalledWith(context, 'project-1', {
        name: 'feature-1',
        persistent: false,
        withData: false,
      })
      expect(operations[0]).toMatchObject({ state: 'succeeded', upstream_branch_ref: 'ref-1' })
      expect(audit.events).toEqual([
        {
          actorSub: 'user-1',
          action: 'branch.created',
          correlationId: 'corr-1',
          outcome: 'success',
          targetId: 'ref-1',
          targetType: 'branch',
        },
      ])
    })

    it('replays a succeeded operation for the same idempotency key without a second upstream call', async () => {
      const { database } = createFakeDatabase()
      const managementApi = {
        createBranch: vi
          .fn()
          .mockResolvedValue({ name: 'feature-1', ref: 'ref-1', status: 'ACTIVE_HEALTHY' } satisfies ManagementBranch),
      } as unknown as ManagementApiClient
      const service = new BranchesService(database, managementApi, fakeAudit())

      const first = await service.create(context, createInput)
      const second = await service.create(context, createInput)

      expect(first).toEqual(second)
      expect(managementApi.createBranch).toHaveBeenCalledOnce()
    })

    it('rejects a reused idempotency key with a different request and writes a security audit event', async () => {
      const { database } = createFakeDatabase()
      const managementApi = {
        createBranch: vi
          .fn()
          .mockResolvedValue({ name: 'feature-1', ref: 'ref-1', status: 'ACTIVE_HEALTHY' } satisfies ManagementBranch),
      } as unknown as ManagementApiClient
      const audit = fakeAudit()
      const service = new BranchesService(database, managementApi, audit)

      await service.create(context, createInput)

      await expect(
        service.create(context, { ...createInput, branchName: 'feature-2' }),
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        status: 409,
      } satisfies Partial<AppError>)
      expect(managementApi.createBranch).toHaveBeenCalledOnce()
      expect(audit.events).toContainEqual({
        actorSub: 'user-1',
        action: 'branch.create.idempotency_conflict',
        correlationId: 'corr-1',
        outcome: 'failure',
        targetId: 'feature-2',
        targetType: 'branch',
      })
    })

    it('reconciles an ambiguous failure by matching the branch name upstream', async () => {
      const { database, operations } = createFakeDatabase()
      const managementApi = {
        createBranch: vi.fn().mockRejectedValue(
          new AppError({
            code: 'SUPABASE_UPSTREAM_UNAVAILABLE',
            retryable: true,
            status: 503,
            title: 'Supabase API is temporarily unavailable',
            type: 'https://branchpilot.dev/problems/supabase-upstream-unavailable',
          }),
        ),
        listBranches: vi
          .fn()
          .mockResolvedValue([
            { name: 'feature-1', ref: 'ref-1', status: 'ACTIVE_HEALTHY' },
          ] satisfies ManagementBranch[]),
      } as unknown as ManagementApiClient
      const audit = fakeAudit()
      const service = new BranchesService(database, managementApi, audit)

      await expect(service.create(context, createInput)).resolves.toEqual({
        name: 'feature-1',
        ref: 'ref-1',
        status: 'ready',
      })
      expect(operations[0]).toMatchObject({ state: 'succeeded', upstream_branch_ref: 'ref-1' })
      expect(audit.events).toEqual([
        {
          actorSub: 'user-1',
          action: 'branch.created',
          correlationId: 'corr-1',
          outcome: 'success',
          targetId: 'ref-1',
          targetType: 'branch',
        },
      ])
    })

    it('returns a retryable unknown outcome when reconciliation finds no match, and writes an audit event', async () => {
      const { database, operations } = createFakeDatabase()
      const managementApi = {
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
      } as unknown as ManagementApiClient
      const audit = fakeAudit()
      const service = new BranchesService(database, managementApi, audit)

      await expect(service.create(context, createInput)).rejects.toMatchObject({
        code: 'BRANCH_CREATE_OUTCOME_UNKNOWN',
        retryable: true,
        status: 503,
      } satisfies Partial<AppError>)
      expect(operations[0]).toMatchObject({ state: 'unknown' })
      expect(audit.events).toEqual([
        {
          actorSub: 'user-1',
          action: 'branch.create.outcome_unknown',
          correlationId: 'corr-1',
          outcome: 'failure',
          targetId: 'feature-1',
          targetType: 'branch',
        },
      ])
    })

    it('marks the operation failed, writes a failure audit event, and rethrows a non-ambiguous upstream error', async () => {
      const { database, operations } = createFakeDatabase()
      const managementApi = {
        createBranch: vi.fn().mockRejectedValue(
          new AppError({
            code: 'SUPABASE_SCOPE_INSUFFICIENT',
            retryable: false,
            status: 403,
            title: 'Supabase authorization lacks the required scope',
            type: 'https://branchpilot.dev/problems/supabase-scope-insufficient',
          }),
        ),
      } as unknown as ManagementApiClient
      const audit = fakeAudit()
      const service = new BranchesService(database, managementApi, audit)

      await expect(service.create(context, createInput)).rejects.toMatchObject({
        code: 'SUPABASE_SCOPE_INSUFFICIENT',
        status: 403,
      } satisfies Partial<AppError>)
      expect(operations[0]).toMatchObject({ state: 'failed' })
      expect(audit.events).toEqual([
        {
          actorSub: 'user-1',
          action: 'branch.create.failed',
          correlationId: 'corr-1',
          outcome: 'failure',
          targetId: 'feature-1',
          targetType: 'branch',
        },
      ])
    })

    it('re-attempts an operation left unknown by a prior ambiguous failure', async () => {
      const { database, operations } = createFakeDatabase()
      const managementApi = {
        createBranch: vi
          .fn()
          .mockRejectedValueOnce(
            new AppError({
              code: 'SUPABASE_UPSTREAM_UNAVAILABLE',
              retryable: true,
              status: 503,
              title: 'Supabase API is temporarily unavailable',
              type: 'https://branchpilot.dev/problems/supabase-upstream-unavailable',
            }),
          )
          .mockResolvedValueOnce({
            name: 'feature-1',
            ref: 'ref-1',
            status: 'ACTIVE_HEALTHY',
          } satisfies ManagementBranch),
        listBranches: vi.fn().mockResolvedValue([]),
      } as unknown as ManagementApiClient
      const service = new BranchesService(database, managementApi, fakeAudit())

      await expect(service.create(context, createInput)).rejects.toMatchObject({
        code: 'BRANCH_CREATE_OUTCOME_UNKNOWN',
      } satisfies Partial<AppError>)
      expect(operations[0]).toMatchObject({ state: 'unknown' })

      await expect(service.create(context, createInput)).resolves.toEqual({
        name: 'feature-1',
        ref: 'ref-1',
        status: 'ready',
      })
      expect(managementApi.createBranch).toHaveBeenCalledTimes(2)
    })
  })

  describe('delete', () => {
    it('deletes the branch upstream and writes an audit event', async () => {
      const { database } = createFakeDatabase()
      const managementApi = {
        deleteBranch: vi.fn().mockResolvedValue(undefined),
      } as unknown as ManagementApiClient
      const audit = fakeAudit()
      const service = new BranchesService(database, managementApi, audit)

      await service.delete(context, 'ref-1')

      expect(managementApi.deleteBranch).toHaveBeenCalledWith(context, 'ref-1')
      expect(audit.events).toEqual([
        {
          actorSub: 'user-1',
          action: 'branch.deleted',
          correlationId: 'corr-1',
          outcome: 'success',
          targetId: 'ref-1',
          targetType: 'branch',
        },
      ])
    })
  })
})
