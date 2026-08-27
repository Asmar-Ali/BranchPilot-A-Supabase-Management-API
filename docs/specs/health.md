# `health` spec

Reports process liveness and readiness so orchestrators and CI can tell whether
BranchPilot is safe to route traffic to.

## Behaviors

### Liveness

- **Trigger:** `GET /health/live`.
- **Expected result:** `200 { "status": "ok" }` whenever the Node process is running and
  able to handle HTTP requests. Does not check any dependency.
- **Errors:** none — this endpoint never fails while the process itself can respond.
- **Edge cases:** must stay public (no auth guard) so orchestrators without a caller
  identity can still probe it.
- **Tests:** `test/unit/health.service.spec.ts` (`HealthService.live()`),
  `test/e2e/health.e2e-spec.ts` (`GET /health/live`).

### Readiness

- **Trigger:** `GET /health/ready`.
- **Expected result:** `200 { "status": "ok" }` when PostgreSQL is reachable and required
  runtime configuration validated successfully at startup.
- **Errors:** non-`200` when PostgreSQL is unreachable, or when required configuration
  failed validation at startup (the process should not have stayed up in the latter
  case, but readiness must still reflect it defensively).
- **Edge cases:** must not leak connection strings, credentials, or other secret-shaped
  values in the response body on failure.
- **Tests:** `test/unit/health.service.spec.ts` covers reachable and unreachable database
  behavior. Add `test/integration/health.readiness.spec.ts` against real Postgres (both
  reachable and intentionally unreachable) when the Docker daemon is available.

## Out of scope

- Deep dependency checks beyond PostgreSQL connectivity (e.g. reachability of
  `api.supabase.com`) — the Management API is an external, per-caller dependency, not a
  process-wide readiness signal.
