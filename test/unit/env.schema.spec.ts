import { Buffer } from 'node:buffer'

import { EnvironmentValidationError, validateEnvironment } from '../../src/config/env.schema'

const validEnvironment = (): Record<string, string> => ({
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgres://branchpilot:branchpilot@localhost:5432/branchpilot',
  TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32).toString('base64'),
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID: 'client-id',
  SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET: 'client-secret',
  SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI: 'http://localhost:3000/v1/integrations/supabase/callback',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_JWKS_URL: 'https://example.supabase.co/.well-known/jwks.json',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://app.example.com',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
})

describe('validateEnvironment', () => {
  it('returns a typed configuration object with parsed values', () => {
    const configuration = validateEnvironment(validEnvironment())

    expect(configuration.PORT).toBe(3001)
    expect(configuration.CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
    ])
  })

  it('rejects a missing database URL without exposing any secret values', () => {
    const environment = validEnvironment()
    const databasePassword = 'database-password-that-must-not-appear-in-logs'
    environment.SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET = databasePassword
    delete environment.DATABASE_URL

    expect(() => validateEnvironment(environment)).toThrow(EnvironmentValidationError)
    expect(() => validateEnvironment(environment)).toThrow('DATABASE_URL')
    expect(() => validateEnvironment(environment)).not.toThrow(databasePassword)
  })

  it('rejects encryption keys that do not decode to 32 bytes', () => {
    const environment = validEnvironment()
    environment.TOKEN_ENCRYPTION_KEY_BASE64 = Buffer.alloc(31).toString('base64')

    expect(() => validateEnvironment(environment)).toThrow('base64-encoded 32-byte value')
  })

  it('requires a Supabase JWT verification source', () => {
    const environment = validEnvironment()
    delete environment.SUPABASE_JWKS_URL

    expect(() => validateEnvironment(environment)).toThrow(
      'SUPABASE_JWKS or SUPABASE_JWKS_URL is required',
    )
  })

  it('accepts an inline SUPABASE_JWKS in place of SUPABASE_JWKS_URL', () => {
    const environment = validEnvironment()
    delete environment.SUPABASE_JWKS_URL
    environment.SUPABASE_JWKS = JSON.stringify({ keys: [] })

    expect(() => validateEnvironment(environment)).not.toThrow()
  })

  it('treats an empty SUPABASE_JWKS_URL as absent rather than an empty string', () => {
    const environment = validEnvironment()
    environment.SUPABASE_JWKS_URL = '   '

    expect(() => validateEnvironment(environment)).toThrow(
      'SUPABASE_JWKS or SUPABASE_JWKS_URL is required',
    )
  })

  it('rejects a SUPABASE_JWKS value that is not valid JSON', () => {
    const environment = validEnvironment()
    delete environment.SUPABASE_JWKS_URL
    environment.SUPABASE_JWKS = 'not-json'

    expect(() => validateEnvironment(environment)).toThrow('SUPABASE_JWKS must be valid JSON')
  })

  it('rejects a SUPABASE_JWKS value that is not a JSON Web Key Set', () => {
    const environment = validEnvironment()
    delete environment.SUPABASE_JWKS_URL
    environment.SUPABASE_JWKS = JSON.stringify({ notKeys: [] })

    expect(() => validateEnvironment(environment)).toThrow(
      'SUPABASE_JWKS must be a JSON Web Key Set',
    )
  })

  it('rejects a DATABASE_URL that does not use the postgres protocol', () => {
    const environment = validEnvironment()
    environment.DATABASE_URL = 'mysql://branchpilot:branchpilot@localhost:3306/branchpilot'

    expect(() => validateEnvironment(environment)).toThrow(
      'DATABASE_URL must use the postgres or postgresql protocol',
    )
  })

  it('rejects an invalid SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI', () => {
    const environment = validEnvironment()
    environment.SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI = 'not-a-url'

    expect(() => validateEnvironment(environment)).toThrow(
      'SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI must be a valid URL',
    )
  })

  it('rejects an invalid SUPABASE_URL', () => {
    const environment = validEnvironment()
    environment.SUPABASE_URL = 'not-a-url'

    expect(() => validateEnvironment(environment)).toThrow('SUPABASE_URL must be a valid URL')
  })

  it('rejects a NODE_ENV outside the allowed enum', () => {
    const environment = validEnvironment()
    environment.NODE_ENV = 'staging'

    expect(() => validateEnvironment(environment)).toThrow()
  })

  it('rejects a PORT outside the valid range', () => {
    const environment = validEnvironment()
    environment.PORT = '70000'

    expect(() => validateEnvironment(environment)).toThrow()
  })

  it('applies defaults for NODE_ENV, PORT, CORS_ALLOWED_ORIGINS, and the OTel endpoint when omitted', () => {
    const environment = validEnvironment()
    delete environment.NODE_ENV
    delete environment.PORT
    delete environment.CORS_ALLOWED_ORIGINS
    delete environment.OTEL_EXPORTER_OTLP_ENDPOINT

    const configuration = validateEnvironment(environment)

    expect(configuration.NODE_ENV).toBe('development')
    expect(configuration.PORT).toBe(3000)
    expect(configuration.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3000'])
    expect(configuration.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://localhost:4318')
  })

  it('rejects a CORS origin using a non-http(s) protocol', () => {
    const environment = validEnvironment()
    environment.CORS_ALLOWED_ORIGINS = 'ftp://example.com'

    expect(() => validateEnvironment(environment)).toThrow(
      'CORS_ALLOWED_ORIGINS must contain only http(s) origins',
    )
  })

  it('rejects a CORS origin that includes a path', () => {
    const environment = validEnvironment()
    environment.CORS_ALLOWED_ORIGINS = 'http://example.com/callback'

    expect(() => validateEnvironment(environment)).toThrow(
      'CORS_ALLOWED_ORIGINS must contain only http(s) origins',
    )
  })
})
