import { Module } from '@nestjs/common'

import { OAuthModule } from '../oauth/oauth.module'
import { FetchManagementApiClient } from './fetch-management-api.client'
import { MANAGEMENT_API_CLIENT } from './management-api.tokens'
import { RetryPolicy } from './retry-policy'

@Module({
  imports: [OAuthModule],
  providers: [
    RetryPolicy,
    FetchManagementApiClient,
    { provide: MANAGEMENT_API_CLIENT, useExisting: FetchManagementApiClient },
  ],
  exports: [MANAGEMENT_API_CLIENT],
})
export class ManagementApiModule {}
