import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { SupabaseCtx, withSupabase } from '@supabase/server/adapters/nestjs'
import type { SupabaseContext } from '@supabase/server'
import type { IncomingHttpHeaders } from 'node:http'
import { z } from 'zod'

import { AppError } from '../common/errors/app-error'
import { correlationIdFor } from '../common/http/correlation-id'
import type { ProjectPage } from './projects.service'
import { ProjectsService } from './projects.service'

const slugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/)
const paginationSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()

interface CorrelatedRequest {
  correlationId?: unknown
  headers?: IncomingHttpHeaders
}

const validationError = (): AppError =>
  new AppError({
    code: 'VALIDATION_FAILED',
    retryable: false,
    status: 400,
    title: 'Request validation failed',
    type: 'https://branchpilot.dev/problems/validation-failed',
  })

@Controller('v1/organizations')
@UseGuards(withSupabase({ auth: 'user' }))
export class ProjectsController {
  public constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get(':slug/projects')
  public async list(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
    @Param('slug') rawSlug: string,
    @Query() rawPagination: Record<string, unknown>,
    @Req() request: CorrelatedRequest,
  ): Promise<ProjectPage> {
    if (userClaims === null || userClaims === undefined) {
      throw new InternalServerErrorException('Verified user claims are unavailable')
    }

    const slug = slugSchema.safeParse(rawSlug)
    const pagination = paginationSchema.safeParse(rawPagination)
    if (!slug.success || !pagination.success) throw validationError()

    return this.projects.list(
      { actorSub: userClaims.id, correlationId: correlationIdFor(request) },
      { organizationSlug: slug.data, ...pagination.data },
    )
  }
}
