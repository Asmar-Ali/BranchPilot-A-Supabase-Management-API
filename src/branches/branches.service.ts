import { Inject, Injectable } from '@nestjs/common'
import type { QueryResultRow } from 'pg'

import { AUDIT_SERVICE, type AuditService } from '../audit/audit.tokens'
import { AppError } from '../common/errors/app-error'
import { DATABASE } from '../database/database.tokens'
import type { Database } from '../database/database.service'
import {
  MANAGEMENT_API_CLIENT,
  type ManagementApiClient,
  type ManagementApiRequestContext,
  type ManagementBranch,
} from '../management-api/management-api.tokens'
import { withSpan } from '../observability/tracer'
import { normalizeBranchStatus, type NormalizedBranchStatus } from './branch-status'
import { hashCreateBranchRequest } from './idempotency'

export interface BranchView {
  readonly name: string
  readonly ref: string
  readonly status: NormalizedBranchStatus
}

export interface CreateBranchInput {
  readonly branchName: string
  readonly idempotencyKey: string
  readonly persistent: boolean
  readonly projectRef: string
  readonly withData: boolean
}

interface BranchOperationRow extends QueryResultRow {
  readonly id: string
  readonly request_hash: string
  readonly state: string
  readonly upstream_branch_ref: string | null
  readonly upstream_status: string | null
}

const problem = (name: string): string => `https://branchpilot.dev/problems/${name}`

function toBranchView(branch: ManagementBranch): BranchView {
  return { name: branch.name, ref: branch.ref, status: normalizeBranchStatus(branch.status) }
}

@Injectable()
export class BranchesService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(MANAGEMENT_API_CLIENT) private readonly managementApi: ManagementApiClient,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  public async list(
    context: ManagementApiRequestContext,
    projectRef: string,
  ): Promise<readonly BranchView[]> {
    return withSpan('branches.observe.list', async () => {
      const branches = await this.managementApi.listBranches(context, projectRef)
      return branches.map(toBranchView)
    })
  }

  public async get(
    context: ManagementApiRequestContext,
    input: { readonly branchName: string; readonly projectRef: string },
  ): Promise<BranchView> {
    return withSpan('branches.observe.get', async () => {
      const branch = await this.managementApi.getBranch(context, input)
      return toBranchView(branch)
    })
  }

  public async create(
    context: ManagementApiRequestContext,
    input: CreateBranchInput,
  ): Promise<BranchView> {
    return withSpan('branches.create', async () => {
      const requestHash = hashCreateBranchRequest(input)
      const operation = await this.insertOrGetOperation(context.actorSub, input, requestHash)

      if (operation.request_hash !== requestHash) {
        await this.audit.record({
          actorSub: context.actorSub,
          action: 'branch.create.idempotency_conflict',
          correlationId: context.correlationId,
          outcome: 'failure',
          targetId: input.branchName,
          targetType: 'branch',
        })
        throw new AppError({
          code: 'IDEMPOTENCY_KEY_REUSED',
          retryable: false,
          status: 409,
          title: 'Idempotency key was already used for a different request',
          type: problem('idempotency-key-reused'),
        })
      }

      if (
        operation.state === 'succeeded' &&
        operation.upstream_branch_ref !== null &&
        operation.upstream_status !== null
      ) {
        return {
          name: input.branchName,
          ref: operation.upstream_branch_ref,
          status: normalizeBranchStatus(operation.upstream_status),
        }
      }

      return this.performCreate(context, input, operation.id)
    })
  }

  public async delete(context: ManagementApiRequestContext, branchRef: string): Promise<void> {
    await this.managementApi.deleteBranch(context, branchRef)
    await this.audit.record({
      actorSub: context.actorSub,
      action: 'branch.deleted',
      correlationId: context.correlationId,
      outcome: 'success',
      targetId: branchRef,
      targetType: 'branch',
    })
  }

  private async insertOrGetOperation(
    actorSub: string,
    input: CreateBranchInput,
    requestHash: string,
  ): Promise<BranchOperationRow> {
    const inserted = await this.database.query<BranchOperationRow>({
      text: `INSERT INTO branch_operations (
               actor_sub, project_ref, branch_name, idempotency_key, request_hash, state
             ) VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT (actor_sub, idempotency_key) DO NOTHING
             RETURNING id, request_hash, state, upstream_branch_ref, upstream_status`,
      values: [actorSub, input.projectRef, input.branchName, input.idempotencyKey, requestHash],
    })
    const insertedRow = inserted.rows[0]
    if (insertedRow !== undefined) return insertedRow

    const existing = await this.database.query<BranchOperationRow>({
      text: `SELECT id, request_hash, state, upstream_branch_ref, upstream_status
             FROM branch_operations WHERE actor_sub = $1 AND idempotency_key = $2`,
      values: [actorSub, input.idempotencyKey],
    })
    const existingRow = existing.rows[0]
    if (existingRow === undefined) {
      throw new Error('branch_operations row disappeared after a unique-constraint conflict')
    }
    return existingRow
  }

  private async performCreate(
    context: ManagementApiRequestContext,
    input: CreateBranchInput,
    operationId: string,
  ): Promise<BranchView> {
    let branch: ManagementBranch
    try {
      branch = await this.managementApi.createBranch(context, input.projectRef, {
        name: input.branchName,
        persistent: input.persistent,
        withData: input.withData,
      })
    } catch (error) {
      if (error instanceof AppError && error.code === 'SUPABASE_UPSTREAM_UNAVAILABLE') {
        await this.setOperationState(operationId, 'unknown')
        return this.reconcile(context, input, operationId)
      }
      await this.setOperationState(operationId, 'failed')
      await this.audit.record({
        actorSub: context.actorSub,
        action: 'branch.create.failed',
        correlationId: context.correlationId,
        outcome: 'failure',
        targetId: input.branchName,
        targetType: 'branch',
      })
      throw error
    }

    await this.saveOperationResult(operationId, branch)
    await this.audit.record({
      actorSub: context.actorSub,
      action: 'branch.created',
      correlationId: context.correlationId,
      outcome: 'success',
      targetId: branch.ref,
      targetType: 'branch',
    })
    return toBranchView(branch)
  }

  private async reconcile(
    context: ManagementApiRequestContext,
    input: CreateBranchInput,
    operationId: string,
  ): Promise<BranchView> {
    const branches = await this.managementApi.listBranches(context, input.projectRef)
    const match = branches.find((branch) => branch.name === input.branchName)

    if (match !== undefined) {
      await this.saveOperationResult(operationId, match)
      await this.audit.record({
        actorSub: context.actorSub,
        action: 'branch.created',
        correlationId: context.correlationId,
        outcome: 'success',
        targetId: match.ref,
        targetType: 'branch',
      })
      return toBranchView(match)
    }

    await this.audit.record({
      actorSub: context.actorSub,
      action: 'branch.create.outcome_unknown',
      correlationId: context.correlationId,
      outcome: 'failure',
      targetId: input.branchName,
      targetType: 'branch',
    })
    throw new AppError({
      code: 'BRANCH_CREATE_OUTCOME_UNKNOWN',
      retryable: true,
      status: 503,
      title: 'Branch creation outcome could not be confirmed',
      type: problem('branch-create-outcome-unknown'),
    })
  }

  private async saveOperationResult(operationId: string, branch: ManagementBranch): Promise<void> {
    await this.database.query({
      text: `UPDATE branch_operations
             SET state = 'succeeded', upstream_branch_ref = $1, upstream_status = $2, updated_at = now()
             WHERE id = $3`,
      values: [branch.ref, branch.status, operationId],
    })
  }

  private async setOperationState(operationId: string, state: string): Promise<void> {
    await this.database.query({
      text: 'UPDATE branch_operations SET state = $1, updated_at = now() WHERE id = $2',
      values: [state, operationId],
    })
  }
}
