import { z } from 'zod'

const requiredString = (name: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `${name} is required` })

const optionalString = (schema: z.ZodString) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
    schema.optional(),
  )

const postgresUrl = requiredString('DATABASE_URL')
  .url({ error: 'DATABASE_URL must be a valid URL' })
  .refine(
    (value) => {
      const protocol = new URL(value).protocol
      return protocol === 'postgres:' || protocol === 'postgresql:'
    },
    { error: 'DATABASE_URL must use the postgres or postgresql protocol' },
  )

const encryptionKey = requiredString('TOKEN_ENCRYPTION_KEY_BASE64').superRefine(
  (value, context) => {
    const isBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)

    if (!isBase64 || Buffer.from(value, 'base64').byteLength !== 32) {
      context.addIssue({
        code: 'custom',
        message: 'TOKEN_ENCRYPTION_KEY_BASE64 must be a base64-encoded 32-byte value',
      })
    }
  },
)

const inlineJwks = optionalString(z.string().trim().min(1)).superRefine((value, context) => {
  if (value === undefined) {
    return
  }

  try {
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('keys' in parsed) ||
      !Array.isArray(parsed.keys)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'SUPABASE_JWKS must be a JSON Web Key Set',
      })
    }
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'SUPABASE_JWKS must be valid JSON',
    })
  }
})

const corsAllowedOrigins = z
  .string()
  .trim()
  .min(1, { error: 'CORS_ALLOWED_ORIGINS must contain at least one origin' })
  .default('http://localhost:3000')
  .transform((value, context) => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)

    if (origins.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'CORS_ALLOWED_ORIGINS must contain at least one origin',
      })
      return z.NEVER
    }

    for (const origin of origins) {
      try {
        const parsed = new URL(origin)
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
          throw new Error('not an origin')
        }
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'CORS_ALLOWED_ORIGINS must contain only http(s) origins',
        })
        return z.NEVER
      }
    }

    return origins
  })

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: postgresUrl,
    TOKEN_ENCRYPTION_KEY_BASE64: encryptionKey,
    SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID: requiredString('SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID'),
    SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET: requiredString(
      'SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET',
    ),
    SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI: requiredString(
      'SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI',
    ).url({ error: 'SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI must be a valid URL' }),
    SUPABASE_URL: requiredString('SUPABASE_URL').url({ error: 'SUPABASE_URL must be a valid URL' }),
    SUPABASE_PUBLISHABLE_KEY: requiredString('SUPABASE_PUBLISHABLE_KEY'),
    SUPABASE_SECRET_KEY: requiredString('SUPABASE_SECRET_KEY'),
    SUPABASE_JWKS_URL: optionalString(
      z.string().trim().url({ error: 'SUPABASE_JWKS_URL must be a valid URL' }),
    ),
    SUPABASE_JWKS: inlineJwks,
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
    OTEL_EXPORTER_OTLP_ENDPOINT: z
      .string()
      .trim()
      .url({ error: 'OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL' })
      .default('http://localhost:4318'),
  })
  .superRefine((environment, context) => {
    if (environment.SUPABASE_JWKS_URL === undefined && environment.SUPABASE_JWKS === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_JWKS'],
        message: 'SUPABASE_JWKS or SUPABASE_JWKS_URL is required',
      })
    }
  })

export type Environment = z.output<typeof environmentSchema>

export class EnvironmentValidationError extends Error {
  public constructor(issues: readonly z.core.$ZodIssue[]) {
    super(
      `Invalid environment configuration: ${issues
        .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
        .join('; ')}`,
    )
    this.name = 'EnvironmentValidationError'
  }
}

export function validateEnvironment(environment: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(environment)

  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues)
  }

  return result.data
}
