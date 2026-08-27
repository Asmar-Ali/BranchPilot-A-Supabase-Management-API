import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  Req,
  UseGuards,
} from '@nestjs/common'
import { SupabaseCtx, withSupabase } from '@supabase/server/adapters/nestjs'
import type { SupabaseContext } from '@supabase/server'
import type { IncomingHttpHeaders } from 'node:http'

import { correlationIdFor } from '../common/http/correlation-id'
import {
  MANAGEMENT_API_CLIENT,
  type ManagementApiClient,
  type ManagementOrganization,
} from '../management-api/management-api.tokens'

interface CorrelatedRequest {
  correlationId?: unknown
  headers?: IncomingHttpHeaders
}

@Controller('v1/organizations')
@UseGuards(withSupabase({ auth: 'user' }))
export class OrganizationsController {
  public constructor(
    @Inject(MANAGEMENT_API_CLIENT) private readonly managementApi: ManagementApiClient,
  ) {}

  @Get()
  public list(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
    @Req() request: CorrelatedRequest,
  ): Promise<readonly ManagementOrganization[]> {
    if (userClaims === null || userClaims === undefined) {
      throw new InternalServerErrorException('Verified user claims are unavailable')
    }

    return this.managementApi.listOrganizations({
      actorSub: userClaims.id,
      correlationId: correlationIdFor(request),
    })
  }
}
