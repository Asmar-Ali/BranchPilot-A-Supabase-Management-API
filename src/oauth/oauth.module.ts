import { Module } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module'
import { DatabaseModule } from '../database/database.module'
import { OAuthConnectionService } from './oauth-connection.service'
import { OAuthController } from './oauth.controller'
import { OAUTH_HTTP_CLIENT } from './oauth.tokens'
import { SupabaseOAuthHttpClient } from './supabase-oauth-http.client'

@Module({
  imports: [AuditModule, DatabaseModule],
  controllers: [OAuthController],
  providers: [
    OAuthConnectionService,
    SupabaseOAuthHttpClient,
    { provide: OAUTH_HTTP_CLIENT, useExisting: SupabaseOAuthHttpClient },
  ],
  exports: [OAuthConnectionService],
})
export class OAuthModule {}
