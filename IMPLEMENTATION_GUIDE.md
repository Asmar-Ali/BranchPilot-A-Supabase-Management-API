# BranchPilot implementation guide

This guide turns the architecture in the README into a buildable sequence. Work through it in order. Each step has a small, observable definition of done so the project remains usable throughout development.

## Guiding rule

Build one complete vertical slice before starting the next one. For example, do not build every database table before proving that health checks, errors, logging, and tests work.

## 0. Lock the first-release boundaries

Before writing code, record these decisions in `docs/adr/001-v1-scope.md`:

- One NestJS API service, using Express.
- PostgreSQL as the only required data service.
- Vitest and Supertest for testing.
- Native `fetch` for a narrow Management API client.
- Zod at every external boundary.
- No web dashboard beyond Swagger UI and a tiny optional demo page.
- No PAT workflow, project creation, project secrets, branch merge, or background queue in v1.

Create the following GitHub issues or local checklist items:

1. Platform foundation.
2. Inbound authentication.
3. OAuth connection lifecycle.
4. Management API client.
5. Organizations and projects.
6. Branch lifecycle.
7. Audit and observability.
8. Tests, OpenAPI, Docker, and CI.

**Done when:** the scope is written down and every later feature can be judged against it.

## 1. Bootstrap the service

Use Node.js LTS and pnpm. The repository currently has only placeholder TypeScript files, so it is safe to replace them as the NestJS application is introduced.

Create a standard NestJS application layout at the repository root. Add these initial runtime dependencies:

```text
@nestjs/common
@nestjs/core
@nestjs/platform-express
@nestjs/config
@nestjs/swagger
@supabase/server
@nestjs/throttler
zod
pg
nestjs-pino
pino-http
@opentelemetry/api
@opentelemetry/sdk-node
@opentelemetry/auto-instrumentations-node
@opentelemetry/exporter-trace-otlp-proto
@prometheus-io/client
```

Add development dependencies for TypeScript, ESLint, Prettier, Vitest, Supertest, Nest testing helpers, and a PostgreSQL test strategy such as Testcontainers.

Create these scripts in `package.json`:

```json
{
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "lint": "eslint . --max-warnings=0",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "openapi:generate": "tsx scripts/generate-openapi.ts",
    "smoke:server-adapter": "node scripts/smoke-supabase-server-adapter.mjs"
  }
}
```

Use strict TypeScript settings. Do not allow `any`, suppressions, or untyped environment access.

**Done when:** `pnpm build`, `pnpm lint`, `pnpm typecheck`, and a single passing health test all work locally.

## 2. Add configuration validation first

Create `src/config/env.schema.ts` using Zod. Parse environment variables once during application startup and inject a typed configuration object into modules.

Start with this `.env.example`:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://branchpilot:branchpilot@localhost:5432/branchpilot

# Protects encrypted OAuth tokens. Use a base64-encoded 32-byte value.
TOKEN_ENCRYPTION_KEY_BASE64=

# BranchPilot's OAuth application registration at Supabase.
SUPABASE_MANAGEMENT_OAUTH_CLIENT_ID=
SUPABASE_MANAGEMENT_OAUTH_CLIENT_SECRET=
SUPABASE_MANAGEMENT_OAUTH_REDIRECT_URI=http://localhost:3000/v1/integrations/supabase/callback

# Used by @supabase/server to verify BranchPilot callers.
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_JWKS_URL=

# Public browser origins only; comma-separated.
CORS_ALLOWED_ORIGINS=http://localhost:3000

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Use `SUPABASE_JWKS` instead of `SUPABASE_JWKS_URL` when local development needs an inline JWK set. The `@supabase/server` adapter's user-authentication mode requires one of these JWT verification sources; `SUPABASE_URL` is always required. [Environment variables](https://github.com/supabase/server/blob/main/docs/environment-variables.md)

Fail startup if required variables are invalid. Mask values in configuration error logs.

**Done when:** missing `DATABASE_URL` or a malformed encryption key prevents startup with a clear, secret-free error.

## 3. Establish PostgreSQL and migrations

Create `docker-compose.yml` with PostgreSQL 16 and a persistent named volume. Keep credentials local-only and document that `.env` is never committed.

Use SQL migrations, either through a small migration runner or `node-pg-migrate`. Add a database module that exposes only a pooled, parameterized query interface. Avoid putting SQL directly in controllers.

Create the first migration with:

- `oauth_transactions`
- `supabase_connections`
- `branch_operations`
- `audit_events`

Use the schema in the README. Add foreign keys only after creating a local `app_users` table; otherwise use `actor_sub` as the stable identity key during the first slice.

Add these basic safety constraints:

- One connection per `actor_sub`.
- A non-null idempotency key on branch operations.
- Unique `(actor_sub, idempotency_key)` on branch operations.
- An allowed-value check for connection status.
- Indexes on audit event actor/time and correlation ID.

**Done when:** `docker compose up -d postgres` followed by the migration command creates the schema from scratch and can be run again safely.

## 4. Build HTTP conventions before feature endpoints

Implement these global pieces before OAuth or branch logic:

### Correlation IDs

- Accept `X-Correlation-Id` only if it is a UUID.
- Otherwise generate `crypto.randomUUID()`.
- Put it on the request context, response header, Pino logs, audit events, and OpenTelemetry spans.

### Error envelope

Create a global Nest exception filter that emits `application/problem+json`:

```json
{
  "type": "https://branchpilot.dev/problems/validation-failed",
  "title": "Request validation failed",
  "status": 400,
  "code": "VALIDATION_FAILED",
  "correlationId": "a UUID",
  "retryable": false
}
```

Define an `AppError` class with `status`, `code`, `title`, `retryable`, and safe extension fields. Controllers must throw domain errors, not raw HTTP exceptions.

### CORS and rate limits

- Enable CORS from the typed allowlist only.
- Enable credentials only if a browser workflow needs them.
- Allow `Authorization`, `Content-Type`, `Idempotency-Key`, and `X-Correlation-Id` headers.
- Start with a general per-user/IP read limit and a much lower write limit for branch mutations.

### Health endpoints

- `GET /health/live` confirms the process is alive.
- `GET /health/ready` tests database connectivity and validates required runtime configuration.

**Done when:** an invalid request, a rate-limited request, and an unhandled exception all return the same stable error shape with a correlation ID.

## 5. Add inbound caller authentication

Use the NestJS adapter only on protected controller routes:

```ts
@UseGuards(withSupabase({ auth: 'user' }))
```

Use `@SupabaseCtx('userClaims')` to obtain the caller's stable `sub` claim. The OAuth callback and health endpoints remain public because the callback identifies the initiating caller through a one-time stored OAuth state.

The adapter places a verified `SupabaseContext` on the Nest request and provides the `SupabaseCtx` parameter decorator. [NestJS adapter](https://github.com/supabase/server/blob/main/docs/adapters/nestjs.md)

`@supabase/server` constructs a user-scoped client and an admin client alongside the verified
context, so `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` are also required. Keep the
secret key server-side only.

Pin a tested `@supabase/server` release at or newer than `1.4.1`, which includes the raw-Node NestJS adapter import fix. Add the import smoke test to CI. [Changelog](https://github.com/supabase/server/blob/main/CHANGELOG.md)

Tests to add now:

- Protected routes reject missing or invalid bearer tokens.
- Health endpoints remain public.
- A valid user token produces the expected `actor_sub`.
- Adapter import smoke test succeeds under raw Node.

**Done when:** `GET /v1/organizations` is protected and a controller can safely identify the caller without parsing JWTs itself.

## 6. Implement OAuth connection lifecycle

Create an `OAuthConnectionService` with these responsibilities:

### Start authorization

`POST /v1/integrations/supabase/authorize`:

1. Requires a signed-in BranchPilot caller.
2. Generates random `state` and PKCE verifier.
3. Stores a hash of the state and an encrypted verifier with a 10-minute expiry.
4. Builds the Supabase authorization URL with `client_id`, `redirect_uri`, `response_type=code`, `state`, and the PKCE challenge.
5. Returns `{ authorizationUrl }`.

### Process callback

`GET /v1/integrations/supabase/callback`:

1. Reads `code` and `state`.
2. Looks up and atomically consumes the matching state record.
3. Rejects missing, expired, or already-consumed state.
4. Exchanges the authorization code at `POST https://api.supabase.com/v1/oauth/token` using Basic client authentication and the stored PKCE verifier.
5. Encrypts and saves tokens, expiry, token version, and connection state.
6. Writes `oauth.connection.created` audit event.
7. Redirects to a small success page or returns a safe JSON result for API clients.

### Refresh

Refresh before expiry and after a Management API `401`:

- Use a per-connection in-memory single-flight promise for v1.
- Persist a `token_version` and use compare-and-swap on update to prevent stale token overwrites.
- Refresh at most once for a request, then replay that outbound request once.
- On `invalid_grant`, mark the connection revoked and make reauthorization explicit.

### Disconnect

`DELETE /v1/integrations/supabase`:

- Call Supabase OAuth revocation with the refresh token.
- On success, erase encrypted token fields and mark the connection revoked.
- On a transient failure, set `revocation_pending` and return a retryable failure rather than silently losing the ability to revoke.

Supabase recommends PKCE, code/state validation, token refresh handling, and treating a failed refresh as a possible user revocation. [OAuth integration guide](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)

**Done when:** the full OAuth lifecycle works against a test server, including expired-state rejection, token refresh, and revoked-connection behaviour.

## 7. Create the narrow Management API client

Create a `ManagementApiClient` port and a `FetchManagementApiClient` adapter. The client is responsible for:

- Obtaining a usable connection token from `OAuthConnectionService`.
- Adding `Authorization: Bearer <token>`.
- Applying a per-request timeout with `AbortSignal.timeout`.
- Adding correlation metadata to logs and spans.
- Parsing success responses with Zod.
- Mapping all failures to typed upstream errors.

Implement only these upstream methods:

```text
listOrganizations()
listProjects(organizationSlug, { limit, offset })
listBranches(projectRef)
createBranch(projectRef, request)
getBranch(projectRef, branchName)
deleteBranch(branchRef)
revokeOAuthAuthorization(refreshToken)
```

Use Zod schemas for both incoming BranchPilot requests and Management API responses. A response that does not match its expected schema is a `502 UPSTREAM_CONTRACT_INVALID`, not a TypeScript cast.

### Retry policy

Implement retry decisions in one isolated `RetryPolicy` module:

| Situation | Behaviour |
| --- | --- |
| `401` | Refresh once and replay once |
| `403` | No retry; surface insufficient permission/scope |
| `429` | Respect a bounded `Retry-After`; otherwise return a retryable normalized error |
| GET network/`5xx` | At most three total attempts, exponential backoff with full jitter |
| POST branch creation | Never blindly retry after an ambiguous failure |

Do not add retries to controllers. Unit test the policy as a decision table.

**Done when:** tests prove exactly which conditions retry, how often, and that mutation requests are not duplicated.

## 8. Implement organizations and projects

Create thin protected controllers that call the client through application services:

```text
GET /v1/organizations
GET /v1/organizations/:slug/projects?limit=20&offset=0
```

Validate `slug`, `limit`, and `offset` with Zod. Enforce a maximum `limit` such as 100. Return the project page in a stable BranchPilot envelope:

```json
{
  "items": [],
  "page": {
    "limit": 20,
    "offset": 0,
    "nextOffset": 20
  }
}
```

Write an audit event for successful reads only if audit volume is acceptable; otherwise audit connection and mutation events first and record reads in traces/logs.

**Done when:** a user sees only the organizations and projects represented by their own OAuth connection; offset pagination is documented and fully tested.

## 9. Implement the branch lifecycle

Start with branch operations as request/response APIs rather than a background worker.

### List and observe

```text
GET /v1/projects/:ref/branches
GET /v1/projects/:ref/branches/:name
```

Normalize the upstream status into a small public set such as:

```text
pending | ready | failed | inactive | unknown
```

Keep the raw upstream status in the audit record or internal operation record, not as an unversioned public contract.

### Create

`POST /v1/projects/:ref/branches`:

1. Validate branch name and optional safe fields using Zod.
2. Require `Idempotency-Key`.
3. Create or retrieve the local `branch_operations` record in a transaction.
4. If the key is known and the request hash matches, return the original operation.
5. If the key is known but the request differs, return `409 IDEMPOTENCY_KEY_REUSED`.
6. Call the Management API with `persistent: false` and `with_data: false` as defaults.
7. Save branch identity and status.
8. Write audit event `branch.created`.

### Ambiguous create failures

If the request times out after being sent, the server cannot know whether Supabase created the branch. Do not retry. Mark the operation `unknown`, then reconcile with `listBranches(projectRef)` and the requested branch name. Return the resolved resource or a retryable `BRANCH_CREATE_OUTCOME_UNKNOWN` error.

### Delete

`DELETE /v1/branches/:branchRef`:

- Confirm the branch belongs to the caller's accessible project before deletion.
- Default to safe deletion semantics if the upstream API supports a delayed-delete option.
- Write audit event `branch.deleted`.

**Done when:** the complete create → observe → delete flow works against the stubbed API, and every mutation has an idempotency and audit test.

## 10. Add audit logging and OpenTelemetry

Create an append-only `AuditService`. Write events for:

- OAuth connection creation, refresh, revocation, and failure.
- Branch create, reconcile, and delete attempts/results.
- Security events such as state replay and idempotency conflict.

For every event, include the actor, target, outcome, correlation ID, safe upstream status, and allowlisted metadata. Do not store access tokens, refresh tokens, codes, secrets, or full upstream response bodies.

Initialize OpenTelemetry before NestJS creates HTTP clients. Add spans for:

- inbound HTTP request;
- OAuth authorization-code exchange;
- token refresh;
- Management API request;
- branch create and observation;
- PostgreSQL query instrumentation.

Add a Jaeger or OTLP collector service to Docker Compose. Verify one branch request can be followed from HTTP request to outbound call to audit event with a single correlation ID.

**Done when:** a screenshot of a trace and one matching audit record can be placed in the README/demo material.

## 11. Publish and test the OpenAPI contract

Use `@nestjs/swagger` for the API surface and ensure Zod DTOs/schemas are reflected in request and response documentation. Generate a deterministic JSON document at `openapi/openapi.json`.

Document:

- Bearer authentication for protected routes.
- OAuth callback as a public browser redirect.
- `Idempotency-Key` requirement for branch creation.
- Response examples, including Problem Details errors.
- Offset pagination parameters and response metadata.

Add a CI command that regenerates the spec and fails if Git has a diff.

**Done when:** Swagger UI works locally and an undocumented controller change fails CI through spec drift.

## 12. Build deterministic tests and demo mode

Do not make CI depend on a live Supabase account.

Create a Management API stub using MSW, Mock Service Worker, or a small local HTTP server. It should support scenarios for:

- normal organizations/projects/branch responses;
- a token-expired `401`, then successful refresh;
- permanent `403`;
- `429` with `Retry-After`;
- transient `503` then success;
- ambiguous branch-creation timeout;
- revoked refresh token.

Use the stub for integration and end-to-end tests. Keep one optional, manually triggered smoke workflow for a real OAuth application; it must use GitHub secrets and never print credentials.

**Done when:** a reviewer can run the complete demonstration locally without a Supabase account or any secrets.

## 13. Add Docker and GitHub Actions

Complete `docker-compose.yml` with:

- `api`
- `postgres`
- `management-api-stub`
- `jaeger` or an OpenTelemetry collector

Document one start command and one reset command. Do not make destructive reset commands the default path.

Create GitHub Actions jobs for:

1. Format check and lint.
2. Strict type check.
3. Unit tests.
4. Integration/e2e tests with PostgreSQL.
5. OpenAPI drift check.
6. `@supabase/server` adapter import smoke test.
7. Docker image build.
8. Dependency and image vulnerability scanning.

**Done when:** a pull request has a single clear quality gate and all work can be reproduced from a clean checkout.

## 14. Finish the portfolio narrative

Add these documents before recording the demo:

- `docs/adr/001-v1-scope.md`
- `docs/adr/002-token-encryption-and-refresh.md`
- `docs/adr/003-idempotency-and-retry.md`
- `docs/threat-model.md`
- `docs/demo-script.md`

The README should answer:

- What problem BranchPilot solves.
- Why inbound authentication and Management OAuth are different.
- OAuth token lifecycle and revocation behaviour.
- Pagination, error, retry, and idempotency decisions.
- Database schema and audit strategy.
- Testing and demo setup.
- Production follow-ups: KMS, Redis rate limiting, background monitoring, multi-instance token coordination, SLOs, and incident dashboards.

Record a two-minute demo only after the deterministic stubbed flow is stable:

1. Explain the architecture.
2. Start an OAuth connection.
3. List organizations and projects.
4. Create a preview branch with an idempotency key.
5. Observe status.
6. Show the trace and audit event using one correlation ID.
7. Disconnect and show a normalized reauthorization-required failure.

**Done when:** a hiring manager can understand the system and verify its quality without reading the entire codebase.

## Suggested implementation order

```text
Foundation → Database → HTTP conventions → Inbound auth
→ OAuth lifecycle → Management client → Catalog endpoints
→ Branch lifecycle → Audit/OTel → OpenAPI → Docker/CI → Demo
```

Do not start the branch endpoint before OAuth, error handling, and upstream-client tests exist. Those foundations are what make BranchPilot a credible Management API project rather than a thin API wrapper.
