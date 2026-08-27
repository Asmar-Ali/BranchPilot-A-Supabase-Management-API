# Integration tests

Tests here wire together two or more real collaborators — a real ephemeral PostgreSQL
instance (Testcontainers) and/or the deterministic Management API stub — with only the
true external boundary (the live Supabase Management API) faked. See
[`docs/testing-strategy.md`](../../docs/testing-strategy.md) for the full strategy and
the per-module matrix of what belongs at this layer versus unit or e2e.

This directory is currently empty. The first test to land here is a PostgreSQL-backed
`health.readiness.spec.ts` covering reachable and intentionally unreachable databases;
it awaits a running local Docker daemon. OAuth connection-persistence coverage follows
in Phase 2.

Naming convention: `<module>.<behavior>.spec.ts`, e.g.
`oauth-connection.refresh-persists-token-version.spec.ts`.
