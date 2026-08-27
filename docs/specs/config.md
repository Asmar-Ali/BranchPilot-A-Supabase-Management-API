# `config` spec

Validates and exposes typed runtime configuration so the rest of the app never reads
`process.env` directly or starts with invalid/missing settings.

## Behaviors

### Environment validation (`validateEnvironment`)

- **Trigger:** called once at startup (via `AppConfigModule`) with the raw environment.
- **Expected result:** a typed, parsed `Environment` object — `PORT` coerced to a number,
  `CORS_ALLOWED_ORIGINS` split and validated into an array of origins, defaults applied
  for `NODE_ENV`, `PORT`, `CORS_ALLOWED_ORIGINS`, and `OTEL_EXPORTER_OTLP_ENDPOINT` when
  omitted.
- **Errors:** throws `EnvironmentValidationError` (never a raw Zod error) listing every
  invalid/missing field, and never includes any variable's *value* in the message —
  only field names and static rule descriptions. Invalid cases: missing required
  variable; `DATABASE_URL` not a valid URL or not using the `postgres`/`postgresql`
  protocol; `TOKEN_ENCRYPTION_KEY_BASE64` not base64 or not 32 bytes once decoded;
  `SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI` / `SUPABASE_URL` not a valid URL; `NODE_ENV`
  outside `development`/`test`/`production`; `PORT` outside 1–65535; neither
  `SUPABASE_JWKS_URL` nor `SUPABASE_JWKS` present; `SUPABASE_JWKS` present but not valid
  JSON or missing a `keys` array; `CORS_ALLOWED_ORIGINS` containing an origin that isn't
  a bare `http`/`https` origin (a path, query, or non-http(s) scheme is rejected).
- **Edge cases:** an empty/whitespace-only optional string (e.g. `SUPABASE_JWKS_URL=""`)
  is treated as absent, not as an empty value, before its own rule runs.
- **Tests:** `test/unit/env.schema.spec.ts`.

### Typed configuration provider (`AppConfigModule` / `APP_CONFIG`)

- **Trigger:** any module that injects the `APP_CONFIG` token.
- **Expected result:** the same validated `Environment` object, resolved once at Nest
  module compile time and shared globally (`@Global()`).
- **Errors:** module compilation itself fails (the app cannot boot) if the environment
  is invalid — there is no partially-configured running state.
- **Tests:** `test/unit/config.module.spec.ts`.

## Out of scope

- Hot-reloading configuration at runtime — BranchPilot re-reads the environment only at
  process startup.
