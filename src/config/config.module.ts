import { Global, Module } from '@nestjs/common'
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config'

import { type Environment, validateEnvironment } from './env.schema'

export const APP_CONFIG = Symbol('APP_CONFIG')

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      skipProcessEnv: true,
      validate: validateEnvironment,
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (configService: ConfigService<Environment, true>): Environment => ({
        NODE_ENV: configService.getOrThrow('NODE_ENV', { infer: true }),
        PORT: configService.getOrThrow('PORT', { infer: true }),
        DATABASE_URL: configService.getOrThrow('DATABASE_URL', { infer: true }),
        TOKEN_ENCRYPTION_KEY_BASE64: configService.getOrThrow('TOKEN_ENCRYPTION_KEY_BASE64', {
          infer: true,
        }),
        SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID: configService.getOrThrow(
          'SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID',
          { infer: true },
        ),
        SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET: configService.getOrThrow(
          'SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET',
          { infer: true },
        ),
        SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI: configService.getOrThrow(
          'SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI',
          { infer: true },
        ),
        SUPABASE_MANAGEMENT_API_BASE_URL: configService.getOrThrow(
          'SUPABASE_MANAGEMENT_API_BASE_URL',
          { infer: true },
        ),
        SUPABASE_URL: configService.getOrThrow('SUPABASE_URL', { infer: true }),
        SUPABASE_PUBLISHABLE_KEY: configService.getOrThrow('SUPABASE_PUBLISHABLE_KEY', {
          infer: true,
        }),
        SUPABASE_SECRET_KEY: configService.getOrThrow('SUPABASE_SECRET_KEY', { infer: true }),
        SUPABASE_JWKS_URL: configService.get('SUPABASE_JWKS_URL', { infer: true }),
        SUPABASE_JWKS: configService.get('SUPABASE_JWKS', { infer: true }),
        CORS_ALLOWED_ORIGINS: configService.getOrThrow('CORS_ALLOWED_ORIGINS', { infer: true }),
        OTEL_EXPORTER_OTLP_ENDPOINT: configService.getOrThrow('OTEL_EXPORTER_OTLP_ENDPOINT', {
          infer: true,
        }),
      }),
      inject: [ConfigService],
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
