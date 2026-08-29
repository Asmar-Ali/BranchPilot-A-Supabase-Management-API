import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { SupabaseCtx, withSupabase } from '@supabase/server/adapters/nestjs'
import type { SupabaseContext } from '@supabase/server'
import type { IncomingHttpHeaders } from 'node:http'
import { z } from 'zod'

import { AppError } from '../common/errors/app-error'
import { correlationIdFor } from '../common/http/correlation-id'
import type { BranchView } from './branches.service'
import { BranchesService } from './branches.service'

interface CorrelatedRequest {
  correlationId?: unknown
  headers?: IncomingHttpHeaders
}

const refSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const branchNameSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)
const createBranchBodySchema = z
  .object({
    name: branchNameSchema,
    persistent: z.boolean().default(false),
    withData: z.boolean().default(false),
  })
  .strict()

const validationError = (): AppError =>
  new AppError({
    code: 'VALIDATION_FAILED',
    retryable: false,
    status: 400,
    title: 'Request validation failed',
    type: 'https://branchpilot.dev/problems/validation-failed',
  })

function requireUserClaims(userClaims: SupabaseContext['userClaims']): NonNullable<
  SupabaseContext['userClaims']
> {
  if (userClaims === null || userClaims === undefined) {
    throw new InternalServerErrorException('Verified user claims are unavailable')
  }
  return userClaims
}

@Controller()
@UseGuards(withSupabase({ auth: 'user' }))
export class BranchesController {
  public constructor(@Inject(BranchesService) private readonly branches: BranchesService) {}

  @Get('v1/projects/:ref/branches')
  public async list(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
    @Param('ref') rawRef: string,
    @Req() request: CorrelatedRequest,
  ): Promise<readonly BranchView[]> {
    const actor = requireUserClaims(userClaims)
    const ref = refSchema.safeParse(rawRef)
    if (!ref.success) throw validationError()

    return this.branches.list(
      { actorSub: actor.id, correlationId: correlationIdFor(request) },
      ref.data,
    )
  }

  @Get('v1/projects/:ref/branches/:name')
  public async get(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
    @Param('ref') rawRef: string,
    @Param('name') rawName: string,
    @Req() request: CorrelatedRequest,
  ): Promise<BranchView> {
    const actor = requireUserClaims(userClaims)
    const ref = refSchema.safeParse(rawRef)
    const name = branchNameSchema.safeParse(rawName)
    if (!ref.success || !name.success) throw validationError()

    return this.branches.get(
      { actorSub: actor.id, correlationId: correlationIdFor(request) },
      { branchName: name.data, projectRef: ref.data },
    )
  }

  @Post('v1/projects/:ref/branches')
  public async create(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
    @Param('ref') rawRef: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() rawBody: unknown,
    @Req() request: CorrelatedRequest,
  ): Promise<BranchView> {
    const actor = requireUserClaims(userClaims)
    const ref = refSchema.safeParse(rawRef)
    const body = createBranchBodySchema.safeParse(rawBody)
    if (!ref.success || !body.success || idempotencyKey === undefined || idempotencyKey.length === 0) {
      throw validationError()
    }

    return this.branches.create(
      { actorSub: actor.id, correlationId: correlationIdFor(request) },
      {
        branchName: body.data.name,
        idempotencyKey,
        persistent: body.data.persistent,
        projectRef: ref.data,
        withData: body.data.withData,
      },
    )
  }

  @Delete('v1/branches/:branchRef')
  @HttpCode(204)
  public async delete(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
    @Param('branchRef') rawBranchRef: string,
    @Req() request: CorrelatedRequest,
  ): Promise<void> {
    const actor = requireUserClaims(userClaims)
    const branchRef = refSchema.safeParse(rawBranchRef)
    if (!branchRef.success) throw validationError()

    return this.branches.delete(
      { actorSub: actor.id, correlationId: correlationIdFor(request) },
      branchRef.data,
    )
  }
}
