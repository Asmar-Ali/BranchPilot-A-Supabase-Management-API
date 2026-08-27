# Testing strategy

This is the concrete testing plan for BranchPilot: what gets tested at which layer, what
tools run it, and how testing plugs into the day-to-day development cycle. It expands on
the "Testing" section in the README and the per-step "Done when" checks in
[IMPLEMENTATION_GUIDE.md](../IMPLEMENTATION_GUIDE.md).

Every behavior change also updates a spec under [`docs/specs/`](./specs/README.md) — see
that folder's README for the spec convention, and the `feature-spec-and-tests` skill for
the workflow that ties spec updates to test updates.

## The three layers

| Layer | Directory | Runner | What it proves |
| --- | --- | --- | --- |
| Unit | `test/unit/` | `npm test` (`vitest.config.mts`) | A single class/function is correct in isolation. |
| Integration | `test/integration/` | `npm run test:integration` (`vitest.integration.config.mts`) | Real collaborators (Postgres, the Management API stub) are wired correctly. |
| End-to-end | `test/e2e/` | `npm run test:e2e` (`vitest.e2e.config.mts`) | A caller hitting the real HTTP surface gets the contract we promise. |

### Unit tests

Scope: one class or pure function, every collaborator faked or mocked. No network, no
filesystem, no real Postgres, no real timers (use `vi.useFakeTimers()` for anything
expiry/backoff-related). These should be the majority of tests and run in well under a
second total.

Good unit-test subjects in this codebase:

- PKCE verifier/challenge generation, state hashing, state expiry/replay rejection.
- Token encryption/decryption (AES-256-GCM) and secret redaction helpers.
- The `RetryPolicy` decision table: `401` refresh-once-replay-once, `403` never retried,
  `429` honoring a bounded `Retry-After`, GET `5xx`/network backoff with jitter capped at
  three attempts, POST branch creation never blindly retried.
- Branch status normalization (`pending | ready | failed | inactive | unknown`).
- Idempotency key/request-hash comparison logic (same key + same request vs. same key +
  different request).
- Audit metadata allowlisting (asserts token-shaped fields never survive it).
- Zod schemas for requests and upstream responses, including malformed-payload rejection.
- `AppError` → Problem Details mapping.
- Env schema validation (already started in `test/unit/env.schema.spec.ts`) — extend with
  a malformed encryption key and a missing `DATABASE_URL` case, asserting the error is
  secret-free.
- Correlation ID acceptance (valid UUID passthrough vs. generated fallback).
- Metrics label allowlist function (asserts org slugs/project refs never become labels).

### Integration tests

Scope: two or more real collaborators wired together within the process, with only the
true external boundary (the live Supabase Management API) replaced. Use a real ephemeral
Postgres (Testcontainers) and the deterministic Management API stub described below. This
layer exists to catch wiring bugs unit tests can't see: SQL that doesn't match the schema,
constraint violations, transaction boundaries, DI wiring, module bootstrapping.

Good integration-test subjects:

- `oauth_transactions` / `supabase_connections` persistence: refresh updates the right
  row, `token_version` compare-and-swap rejects a stale write, revoke clears encrypted
  fields.
- `branch_operations` unique constraint on `(actor_sub, idempotency_key)`: replay returns
  the original row, a changed request hash produces `409 IDEMPOTENCY_KEY_REUSED`.
- `audit_events` append-only inserts and cursor pagination ordering.
- Migration runner: applying migrations to a blank database succeeds and re-running is a
  no-op (matches IMPLEMENTATION_GUIDE step 3's "Done when").
- The Management API client against the MSW/stub server: timeout via `AbortSignal.timeout`,
  Zod validation of a real HTTP response body, retry policy exercised over real requests
  rather than mocked function calls.
- Readiness check (`GET /health/ready`) against a real Postgres instance, both up and
  intentionally unreachable.

Test isolation: one Testcontainers Postgres per test file (migrated once in
`beforeAll`), tables truncated in `afterEach`. Avoid sharing a container across files —
slower but keeps failures isolated and debuggable.

### End-to-end tests

Scope: boot the real `AppModule` (as `test/e2e/health.e2e-spec.ts` already does) behind
Supertest, with Postgres and the Management API stub both running, and hit real HTTP
routes. This is the only layer that proves the auth guard, validation pipes, exception
filter, rate limiter, and correlation ID plumbing all agree with each other end to end.

Good e2e subjects:

- Protected routes reject missing/invalid bearer tokens; health endpoints stay public.
- The complete OAuth lifecycle: authorize → callback → refresh → disconnect, including
  expired-state rejection and revoked-connection behavior.
- The complete branch lifecycle: create (with `Idempotency-Key`) → observe → delete,
  including the ambiguous-timeout-then-reconcile path.
- Every documented failure mode returns the same `application/problem+json` shape with a
  `correlationId`: validation failure, rate limit, unhandled exception, upstream
  `401`/`403`/`429`/`5xx`.
- `X-Correlation-Id` is accepted when valid, generated when absent/invalid, and echoed on
  the response.
- Audit event visibility: after an action, `GET /v1/audit-events` shows an event carrying
  the same correlation ID as the triggering request.
- `@supabase/server/adapters/nestjs` raw-Node import smoke test (per IMPLEMENTATION_GUIDE
  step 5) — keep this even though it isn't a behavioral test; it guards against a real
  regression that has bitten this adapter before.

## Deterministic Management API stub

Per IMPLEMENTATION_GUIDE step 12, integration and e2e tests never talk to the real
`api.supabase.com`. Build one stub (MSW or a small local HTTP server) under
`test/fixtures/management-api-stub.ts` supporting these scenarios, selectable per test:

- Normal organizations/projects/branch responses.
- Token-expired `401`, then a successful refresh.
- Permanent `403`.
- `429` with `Retry-After`.
- Transient `503` then success.
- Ambiguous branch-creation timeout (connection drops after the request is sent).
- Revoked refresh token.

Unit tests fake the `ManagementApiClient` port directly; integration/e2e tests run
against this stub so the real fetch/retry/timeout code path is exercised.

## Coverage and quality gates

- Use `vitest`'s v8 coverage provider for the unit layer. Target ~85% statements/branches
  on `src/**` excluding `main.ts` bootstrap code — a floor, not a target to game with
  trivial tests.
- Integration and e2e layers are not coverage-gated; they exist to prove behavior, not to
  hit a number. A module can have 100% unit coverage and still be wrong at the wiring or
  contract level, which is why all three layers stay mandatory.
- No layer is optional for a module before it's considered done — see the per-module
  matrix below.

## Per-module test matrix

| Module | Unit | Integration | E2E |
| --- | --- | --- | --- |
| `config/` | Zod schema, malformed/missing env cases | — | Startup failure surfaces as a clear, secret-free error |
| `health/` | `HealthService.live()` | Readiness against real/unreachable Postgres | `GET /health/live`, `GET /health/ready` |
| `identity/` | — (thin wrapper over `@supabase/server`) | — | Guard rejects bad tokens; valid token yields `actor_sub`; adapter import smoke test |
| `oauth/` | PKCE, state hash/expiry/replay, encryption, single-flight refresh, token-version CAS | Postgres persistence of transactions/connections | Full authorize→callback→refresh→disconnect flow |
| `management-api/` | Zod contracts, `RetryPolicy` decision table | Client against the stub (timeout, retry, real parsing) | Exercised indirectly through every controller e2e test |
| `organizations/` | Pagination envelope, slug validation | — | Protected listing with a real OAuth connection |
| `projects/` | Limit clamping, offset math | — | Paginated listing against the stub |
| `branches/` | Idempotency key/hash comparison, status normalization, reconciliation matching | `branch_operations` constraints, idempotency replay/conflict | Create→observe→delete, ambiguous-timeout reconciliation |
| `audit/` | Metadata allowlisting | Append-only insert, cursor pagination ordering | Audit event correlates with triggering request |
| `observability/` | Correlation ID validation, metrics label allowlist | OTel spans via an in-memory exporter | `X-Correlation-Id` echoed on every response |
| `common/errors/` | `AppError` → Problem Details mapping | — | Identical error shape across validation/rate-limit/exception/upstream failures |
| `common/http/` | Retry/backoff/jitter timing (fake timers) | — | — |
| `common/validation/` | Zod pipes and refinements | — | — |
| `database/migrations/` | — | Fresh-apply and re-apply idempotency | — |

Build a module's tests in this order as it's implemented: unit tests for its decision
logic first (they're cheapest to write against a spec and catch the most bugs per minute),
then the integration tests once real Postgres/stub wiring exists, then the e2e test that
proves the whole slice together. This matches IMPLEMENTATION_GUIDE's "one complete
vertical slice before the next" rule — a slice isn't complete until all three layers that
apply to it exist.

## How this plugs into the development cycle

1. **Before coding a change:** update or create the relevant `docs/specs/<module>.md` (see
   [`docs/specs/README.md`](./specs/README.md)). The spec is what the tests get written
   against, not the other way around.
2. **While coding:** write the test at the lowest layer that can prove the behavior
   first (usually unit), then implement until it passes. Add the integration/e2e test
   for the same change before moving on — see the `feature-spec-and-tests` skill, which
   encodes this as a checklist so it isn't skipped under time pressure.
3. **Before pushing:** run `npm run lint`, `npm run typecheck`, `npm test`,
   `npm run test:integration`, and `npm run test:e2e` locally. All five are cheap enough
   to run on every push once Postgres/the stub are available locally via Docker Compose.
4. **CI (`.github/workflows/ci.yml`):** runs format/lint, typecheck, unit, integration
   (with a Postgres service container), and e2e on every PR, in that order — fail fast on
   the cheapest checks first. OpenAPI drift, Docker image build, and dependency/image
   vulnerability scanning are added in Phase 5 once the tooling they depend on
   (`openapi:generate`, the Docker image) exists — see IMPLEMENTATION_GUIDE step 13.
5. **PR review:** a PR that adds or changes behavior without a matching spec update or
   test at the right layer is not done, regardless of whether CI happens to pass (CI
   can't tell a missing e2e case from one that was never needed).

## What's scaffolded now vs. forward-looking

Only `config/` and `health/` are implemented today (Phase 1). This document, the
`test/integration/` directory, and `vitest.integration.config.mts` are scaffolded now so
every later phase lands its tests in the right place from the start, rather than
retrofitting structure later. `test/integration/` has no tests yet — its Vitest config
allows an empty suite (`passWithNoTests: true`) until the first Postgres-backed module
(OAuth, Phase 2) lands; flip that to `false` at the same time the first integration test
is added, matching how `test/unit/` and `test/e2e/` are already configured.
