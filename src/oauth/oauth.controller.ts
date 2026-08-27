import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { SupabaseCtx, withSupabase } from '@supabase/server/adapters/nestjs'
import type { SupabaseContext } from '@supabase/server'
import type { IncomingHttpHeaders } from 'node:http'

import { correlationIdFor } from '../common/http/correlation-id'
import { AppError } from '../common/errors/app-error'
import { OAuthConnectionService } from './oauth-connection.service'

interface CorrelatedRequest {
  correlationId?: unknown
  headers?: IncomingHttpHeaders
}

const organizationSlugPattern = /^[a-z0-9-]{1,64}$/

@Controller('v1/integrations/supabase')
export class OAuthController {
  public constructor(
    @Inject(OAuthConnectionService) private readonly oauthConnections: OAuthConnectionService,
  ) {}

  @Post('authorize')
  @UseGuards(withSupabase({ auth: 'user' }))
  public authorize(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
    @Query('organization_slug') organizationSlug?: string,
  ): Promise<{ authorizationUrl: string }> {
    if (userClaims === null || userClaims === undefined) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        retryable: false,
        status: 401,
        title: 'Authentication is required',
        type: 'https://branchpilot.dev/problems/unauthorized',
      })
    }
    if (organizationSlug !== undefined && !organizationSlugPattern.test(organizationSlug)) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        retryable: false,
        status: 400,
        title: 'Request validation failed',
        type: 'https://branchpilot.dev/problems/validation-failed',
      })
    }
    return this.oauthConnections.startAuthorization({
      actorSub: userClaims.id,
      organizationSlug,
    })
  }

  @Get('callback')
  public async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: CorrelatedRequest,
  ): Promise<{ status: 'connected' }> {
    if (code === undefined || state === undefined || code.length === 0 || state.length === 0) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        retryable: false,
        status: 400,
        title: 'Request validation failed',
        type: 'https://branchpilot.dev/problems/validation-failed',
      })
    }
    await this.oauthConnections.completeAuthorization({
      code,
      correlationId: correlationIdFor(request),
      state,
    })
    return { status: 'connected' }
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(withSupabase({ auth: 'user' }))
  public async disconnect(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
    @Req() request: CorrelatedRequest,
  ): Promise<void> {
    if (userClaims === null || userClaims === undefined) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        retryable: false,
        status: 401,
        title: 'Authentication is required',
        type: 'https://branchpilot.dev/problems/unauthorized',
      })
    }
    await this.oauthConnections.disconnect(userClaims.id, correlationIdFor(request))
  }
}
