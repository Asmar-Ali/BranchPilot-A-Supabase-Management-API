import { Buffer } from 'node:buffer'

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgres://branchpilot:branchpilot@localhost:5432/branchpilot',
  TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32).toString('base64'),
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID: 'test-client-id',
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET: 'test-client-secret',
  SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI: 'http://localhost:3000/v1/integrations/supabase/callback',
  SUPABASE_MANAGEMENT_API_BASE_URL: 'https://management.example.test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SECRET_KEY: 'test-secret-key',
  SUPABASE_JWKS_URL: 'https://example.supabase.co/.well-known/jwks.json',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
})
