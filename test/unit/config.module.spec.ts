import { Buffer } from 'node:buffer'

import { Test } from '@nestjs/testing'

import type { Environment } from '../../src/config/env.schema'

const validEnvironment = (): Record<string, string> => ({
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgres://branchpilot:branchpilot@localhost:5432/branchpilot',
  TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32).toString('base64'),
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID: 'client-id',
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET: 'client-secret',
  SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI: 'http://localhost:3000/v1/integrations/supabase/callback',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SECRET_KEY: 'test-secret-key',
  SUPABASE_JWKS_URL: 'https://example.supabase.co/.well-known/jwks.json',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://app.example.com',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
})

// AppConfigModule's @Module() decorator calls NestConfigModule.forRoot() once, at the
// moment the module is evaluated, reading process.env synchronously at that instant.
// vi.resetModules() + a dynamic import force a fresh evaluation per test so each test's
// process.env is the one actually validated, instead of every test sharing whatever the
// first import happened to see.
describe('AppConfigModule', () => {
  const originalEnvironment = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnvironment }
  })

  it('exposes a typed APP_CONFIG built from validated environment variables', async () => {
    Object.assign(process.env, validEnvironment())
    const { AppConfigModule, APP_CONFIG } = await import('../../src/config/config.module')

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
    }).compile()

    const config = moduleRef.get<Environment>(APP_CONFIG)

    expect(config.PORT).toBe(3001)
    expect(config.DATABASE_URL).toBe(
      'postgres://branchpilot:branchpilot@localhost:5432/branchpilot',
    )
    expect(config.CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
    ])

    await moduleRef.close()
  })

  it('fails to compile when a required variable is missing', async () => {
    const environment = validEnvironment()
    delete environment.DATABASE_URL
    process.env = { ...process.env, ...environment }
    delete process.env.DATABASE_URL

    const { AppConfigModule } = await import('../../src/config/config.module')

    await expect(
      Test.createTestingModule({ imports: [AppConfigModule] }).compile(),
    ).rejects.toThrow('DATABASE_URL')
  })
})
