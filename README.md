# BranchPilot

BranchPilot is a production-minded NestJS control plane for managing Supabase preview branches through delegated OAuth access. It is designed as a focused API-engineering portfolio project: a developer connects their Supabase account, browses accessible projects, creates a data-less preview branch, monitors it, cleans it up, and can inspect every operation through audit events and traces.

The project deliberately prioritizes reliable API behaviour over a large dashboard. Its core signals are scoped OAuth, stable public API contracts, safe mutation handling, PostgreSQL-backed auditability, and observability.

See [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for the ordered build plan and acceptance checks.

## Why this project

This project maps directly to the Supabase API Engineer role:

- TypeScript and NestJS API design.
- Supabase Management API and OAuth application integration.
- Organization/project access and offset-based project pagination.
- Database preview branch creation and monitoring.
- Token refresh, revocation, request validation, retries, and API error design.
- PostgreSQL, Docker Compose, OpenTelemetry, OpenAPI, automated testing, and CI.

It is intentionally not a generic CRUD application and not a broad proxy for every Management API endpoint.

## Product journey

1. A developer signs in to BranchPilot using Supabase Auth.
2. They connect their Supabase account through OAuth 2.0 with PKCE.
3. BranchPilot securely stores the delegated credentials.
4. They list accessible organizations and page through an organization's projects.
5. They create an ephemeral, data-less branch for a focused change.
6. They observe the branch state until it becomes ready or fails.
7. They delete the branch safely when finished.
8. They inspect correlated audit events and traces.
9. They can disconnect, revoking the OAuth grant and removing local credentials.

## Scope decisions

### Management API behaviour

- `GET /v1/organizations` returns an array upstream; BranchPilot will not invent pagination for it.
- `GET /v1/organizations/{slug}/projects` uses upstream offset-based pagination with `limit` and `offset`.
- Branch operations use the Management API's environment scopes: `environment:read` and `environment:write`.
- The OAuth application is configured with least-privilege scopes: `organizations:read`, `projects:read`, `environment:read`, and `environment:write`.
- OAuth scopes are configured on the OAuth application. Passing `scope` during authorization is deprecated.

### Authentication boundaries

There are two independent trust boundaries:

1. `@supabase/server/adapters/nestjs` authenticates callers of BranchPilot with a Supabase user JWT.
2. Supabase Management OAuth authorizes BranchPilot to act on behalf of that caller against `api.supabase.com`.

The application must never conflate a caller's BranchPilot session with their Management API tokens.

## Architecture

```text
Caller
  │ Supabase user JWT
  ▼
NestJS API
  ├── Identity module ───── @supabase/server NestJS guard
  ├── OAuth module ──────── PKCE, state, token vault, refresh, revoke
  ├── Catalog module ────── organizations and projects
  ├── Branches module ───── create, observe, delete, idempotency
  ├── Management client ─── Zod validation, retry, error translation
  ├── Audit module ──────── append-only PostgreSQL events
  └── Observability ─────── correlation IDs, metrics, OTel spans
             │
             ├──────────── api.supabase.com
             └──────────── PostgreSQL
```

This remains a modular NestJS monolith. Background workers, Kafka, microservices, and a broad frontend are intentionally deferred because they do not improve the central API-engineering story in the first release.

## Module boundaries

```text
src/
  identity/          # Inbound Supabase JWT authentication
  oauth/             # Authorization code + PKCE flow and token lifecycle
  management-api/    # Narrow typed Management API client
  organizations/     # Organization listing
  projects/          # Paginated project listing
  branches/          # Branch lifecycle and idempotency
  audit/             # Append-only audit events
  observability/     # OTel, metrics, logs, correlation IDs
  common/
    errors/          # Problem Details contract and exception filter
    http/            # Retry, timeout, and request helpers
    validation/      # Zod schemas and pipes
  database/
    migrations/
test/
  unit/
  integration/
  e2e/
openapi/
docs/
  adr/
  threat-model.md
```

The Management API client will use native `fetch`, with an injectable base URL and Zod-validated upstream responses. This keeps the dependency surface small and makes contract drift, retries, instrumentation, and error translation explicit.

## Public API

| Endpoint | Purpose |
| --- | --- |
| `GET /health/live` | Process health |
| `GET /health/ready` | PostgreSQL and configuration readiness |
| `POST /v1/integrations/supabase/authorize` | Generate PKCE/state and return authorization URL |
| `GET /v1/integrations/supabase/callback` | Validate state and exchange authorization code |
| `GET /v1/integrations/supabase` | Safe connection status; never returns tokens |
| `DELETE /v1/integrations/supabase` | Revoke OAuth authorization and disconnect |
| `GET /v1/organizations` | List accessible organizations |
| `GET /v1/organizations/:slug/projects?limit=20&offset=0` | List projects with offset pagination |
| `GET /v1/projects/:ref/branches` | List database branches |
| `POST /v1/projects/:ref/branches` | Create a preview branch |
| `GET /v1/projects/:ref/branches/:name` | Get normalized branch status |
| `DELETE /v1/branches/:branchRef` | Delete a preview branch |
| `GET /v1/audit-events?limit=50&cursor=...` | Cursor-paginated local audit history |

Branch creation requires an `Idempotency-Key` header. It defaults to an ephemeral and data-less branch:

```json
{
  "persistent": false,
  "withData": false
}
```

## OAuth and token lifecycle

The OAuth module is a first-class security boundary.

- Generate cryptographically random `state` and PKCE verifiers.
- Store only a hash of `state`.
- Make each OAuth transaction short-lived and single-use.
- Encrypt access tokens, refresh tokens, and stored verifiers with AES-256-GCM.
- Keep encryption keys outside PostgreSQL.
- Refresh proactively shortly before expiry.
- Coordinate concurrent refreshes with a per-connection single-flight mechanism and optimistic token versioning.
- On an upstream `401`, refresh once and replay the request once.
- If refresh fails with an invalid grant, mark the connection revoked, erase usable credentials, and return `SUPABASE_REAUTH_REQUIRED`.
- Revoke through Supabase's OAuth revocation endpoint before clearing local credentials. A transient revocation failure becomes `revocation_pending` and can be retried.
- Never log, trace, or audit tokens, codes, client secrets, or PKCE verifiers.

Production follow-up: replace the local encryption key with KMS-backed envelope encryption and scheduled key rotation.

## PostgreSQL data model

Use explicit SQL migrations and parameterized repository queries.

### `oauth_transactions`

- `state_hash bytea primary key`
- `actor_sub text`
- `code_verifier_ciphertext bytea`
- `organization_slug text null`
- `expires_at timestamptz`
- `consumed_at timestamptz null`

### `supabase_connections`

- `id uuid primary key`
- `actor_sub text unique`
- `status text` (`connected`, `refreshing`, `revoked`, `revocation_pending`)
- encrypted access and refresh token fields
- `access_token_expires_at timestamptz`
- `token_version integer`
- `key_version integer`
- `last_refreshed_at timestamptz`
- `revoked_at timestamptz null`

### `branch_operations`

- `id uuid primary key`
- `actor_sub text`
- `project_ref text`
- `branch_name text`
- `upstream_branch_ref text null`
- `upstream_status text null`
- `state text`
- `idempotency_key text`
- `request_hash text`
- creation and update timestamps

Use a unique index on `(actor_sub, idempotency_key)`. Reusing a key with the same request returns the original result; reusing it with a changed request returns `409 IDEMPOTENCY_KEY_REUSED`.

### `audit_events`

- `id uuid primary key`
- `occurred_at timestamptz`
- `actor_sub text`
- `action text`
- `target_type text`
- `target_id text null`
- `outcome text`
- `correlation_id uuid`
- `upstream_status integer null`
- `metadata jsonb`

Index `(actor_sub, occurred_at desc)` and `correlation_id`. Audit metadata is allowlisted and secret-free.

## Error contract and reliability policy

All API failures use `application/problem+json` with a stable machine-readable code.

```json
{
  "type": "https://branchpilot.dev/problems/upstream-rate-limited",
  "title": "Supabase API rate limit exceeded",
  "status": 429,
  "code": "SUPABASE_RATE_LIMITED",
  "correlationId": "8fd8c2c4-...",
  "retryable": true,
  "retryAfterSeconds": 8
}
```

| Upstream condition | BranchPilot behaviour |
| --- | --- |
| `401` | Refresh once and replay once; failed refresh becomes `409 SUPABASE_REAUTH_REQUIRED` |
| `403` | Never retry; return `403 SUPABASE_SCOPE_INSUFFICIENT` |
| `429` | Honor a bounded `Retry-After`, otherwise return normalized `429` |
| `5xx` or network failure on GET | Up to three attempts using exponential backoff and full jitter |
| Ambiguous failure on branch POST | Do not blindly retry; reconcile by project and branch name |
| Invalid upstream Zod contract | Return `502 UPSTREAM_CONTRACT_INVALID` and record a sanitized trace event |

Blindly retrying branch creation can create duplicate resources. Local idempotency keys plus reconciliation make mutations safe under ambiguous failures.

## Security and observability

- Validate configuration, inbound bodies and query parameters, and upstream responses with Zod.
- Use a strict CORS allowlist; never use wildcard origins with credentials.
- Apply per-user rate limits, with a stricter mutation bucket for branch operations.
- Accept a valid incoming correlation ID or generate a UUID.
- Return it as `X-Correlation-Id` and include it in logs, traces, and audit events.
- Create OpenTelemetry spans for OAuth exchange, token refresh, outbound Management API calls, branch creation, and status observation.
- Track request duration, upstream latency, retry count, refresh outcomes, rate-limit rejections, and branch state transitions.
- Do not use organization slugs or project references as metrics labels, to avoid sensitive high-cardinality data.

The first release can use NestJS's in-memory throttling storage and document its single-replica limitation. Redis-backed distributed rate limits are a production follow-up.

## Testing

Use Vitest and Supertest. See [docs/testing-strategy.md](./docs/testing-strategy.md) for
the full unit/integration/e2e plan, the per-module test matrix, and how testing plugs
into the development cycle, and [docs/specs/](./docs/specs/README.md) for the feature
spec convention that tests are written against.

High-value test coverage includes:

- PKCE generation, state expiry, and state replay rejection.
- Token encryption and secret redaction.
- Concurrent refresh requests producing one upstream refresh.
- `401` refresh-and-replay occurring only once.
- `403` never being retried.
- `429` handling `Retry-After` correctly.
- Bounded GET retries for network and `5xx` failures.
- Branch POST reconciliation after ambiguous failure.
- Idempotency replay and idempotency conflict behaviour.
- Zod validation of all upstream responses.
- Correlation IDs on all errors.
- Audit metadata containing no token-shaped data.
- Supertest end-to-end flow against PostgreSQL and a stub Management API.

Add a raw Node import smoke test for `@supabase/server/adapters/nestjs` and pin a tested package version.

## Local development and CI

### Running the project

1. Copy the environment template and fill in the required values (at minimum
   `TOKEN_ENCRYPTION_KEY_BASE64`, a base64-encoded 32-byte value; add the Supabase OAuth
   and management values to exercise those flows):

   ```sh
   cp .env.example .env
   ```

2. Start PostgreSQL and Jaeger:

   ```sh
   docker compose up -d
   ```

3. Apply database migrations:

   ```sh
   npm run db:migrate
   ```

4. Start the dev server:

   ```sh
   npm run dev
   ```

   This watches `src/main.ts` with `tsx` and listens on `PORT` from `.env` (default
   `3000`).

Once running:

- API: `http://localhost:3000`
- Jaeger UI (traces): `http://localhost:16686`
- Health check: `GET /health/live`

Other useful commands:

```sh
npm test                  # unit tests, no Docker required
npm run test:integration  # requires Postgres running (step 2)
npm run test:e2e          # requires Postgres running (step 2)
npm run typecheck
npm run lint
npm run build
```

### PostgreSQL

The database is exposed only on `127.0.0.1:5432` and persists in the
`branchpilot-postgres-data` Docker volume. `.env` (including any local database or OAuth
credentials) is ignored by Git and must never be committed. Re-running `npm run db:migrate`
is safe; it skips migrations that were already applied without modification.

Docker Compose starts:

- BranchPilot API
- PostgreSQL
- A deterministic Management API stub for local development and demos
- An OpenTelemetry-compatible trace viewer such as Jaeger

GitHub Actions runs:

1. Formatting and linting.
2. Strict TypeScript compilation.
3. Unit tests.
4. PostgreSQL integration tests.
5. Supertest end-to-end tests.
6. OpenAPI generation and drift detection.
7. Docker image build.
8. Dependency and container vulnerability checks.

The generated `openapi/openapi.json` is committed and CI fails if controller changes cause specification drift.

## Delivery plan

### Phase 1: Foundation

Create the NestJS skeleton, strict TypeScript configuration, validated environment configuration, PostgreSQL migrations, health endpoints, error contract, correlation IDs, and Docker Compose.

### Phase 2: Identity and OAuth

Implement inbound `@supabase/server` authentication, OAuth authorization code flow with PKCE, encrypted storage, token refresh coordination, and revocation handling.

### Phase 3: Management API client

Add organizations, paginated projects, Zod contracts, timeouts, retry policy, and error normalization.

### Phase 4: Branch lifecycle

Implement branch listing, creation, monitoring, deletion, idempotency, reconciliation, and audit events.

### Phase 5: Quality and presentation

Finish OpenTelemetry, rate limits, tests, OpenAPI, ADRs, threat model, CI, deterministic stub mode, and the recorded demo.

Target: 7–10 focused working days.

## Two-minute demo

1. Explain the problem and show the module architecture.
2. Connect through OAuth with PKCE.
3. List organizations and a page of projects.
4. Create a data-less preview branch with an idempotency key.
5. Poll its normalized status.
6. Show the matching audit event and trace using one correlation ID.
7. Disconnect and demonstrate the stable reauthorization-required response.

Maintain a deterministic stubbed version of this flow so a reviewer can run it without personal credentials.

## Non-goals for v1

- A substantial web dashboard.
- Project or organization creation.
- Branch merge or production deployment workflows.
- Kafka, background workers, and microservices.
- Arbitrary Management API proxying.
- Storing database passwords or project API keys.
- PAT support in the primary user workflow.

## Reference material

- [Supabase Management API](https://supabase.com/docs/reference/api/getting-started)
- [Build a Supabase OAuth integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration)
- [OAuth application scopes](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)
- [Supabase Branching](https://supabase.com/docs/guides/deployment/branching)
- [Supabase server NestJS adapter](https://github.com/supabase/server/blob/main/docs/adapters/nestjs.md)
