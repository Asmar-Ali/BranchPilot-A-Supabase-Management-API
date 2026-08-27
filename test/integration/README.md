# Integration tests

Tests here wire together two or more real collaborators — a real ephemeral PostgreSQL
instance (Testcontainers) and/or the deterministic Management API stub — with only the
true external boundary (the live Supabase Management API) faked. See
[`docs/testing-strategy.md`](../../docs/testing-strategy.md) for the full strategy and
the per-module matrix of what belongs at this layer versus unit or e2e.

`oauth-connection.persistence.spec.ts` is the first test here: it runs migrations
against a real Postgres (`DATABASE_URL`, matching `docker-compose.yml`/CI's service
container) in `beforeAll` and truncates the OAuth tables in `afterEach`. A
PostgreSQL-backed `health.readiness.spec.ts` covering reachable and intentionally
unreachable databases is still outstanding.

Naming convention: `<module>.<behavior>.spec.ts`, e.g.
`oauth-connection.refresh-persists-token-version.spec.ts`.
