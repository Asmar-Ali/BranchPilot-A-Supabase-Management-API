import { Controller, Get, InternalServerErrorException, UseGuards } from '@nestjs/common'
import { SupabaseCtx, withSupabase } from '@supabase/server/adapters/nestjs'
import type { SupabaseContext } from '@supabase/server'

interface OrganizationIdentityResponse {
  readonly actor_sub: string
}

@Controller('v1/organizations')
@UseGuards(withSupabase({ auth: 'user' }))
export class OrganizationsController {
  @Get()
  public list(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
  ): OrganizationIdentityResponse {
    if (userClaims === null || userClaims === undefined) {
      throw new InternalServerErrorException('Verified user claims are unavailable')
    }

    // @supabase/server derives `id` directly from the verified JWT `sub` claim.
    return { actor_sub: userClaims.id }
  }
}
