import { Module } from '@nestjs/common'

import { DatabaseModule } from '../database/database.module'
import { OAuthConnectionService } from './oauth-connection.service'
import { OAuthController } from './oauth.controller'
import { OAUTH_HTTP_CLIENT } from './oauth.tokens'
import { SupabaseOAuthHttpClient } from './supabase-oauth-http.client'

@Module({
  imports: [DatabaseModule],
  controllers: [OAuthController],
  providers: [
    OAuthConnectionService,
    SupabaseOAuthHttpClient,
    { provide: OAUTH_HTTP_CLIENT, useExisting: SupabaseOAuthHttpClient },
  ],
  exports: [OAuthConnectionService],
})
export class OAuthModule {}
