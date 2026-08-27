# Integration tests

Tests here wire together two or more real collaborators — a real ephemeral PostgreSQL
instance (Testcontainers) and/or the deterministic Management API stub — with only the
true external boundary (the live Supabase Management API) faked. See
[`docs/testing-strategy.md`](../../docs/testing-strategy.md) for the full strategy and
the per-module matrix of what belongs at this layer versus unit or e2e.

This directory is currently empty: only `config/` and `health/` are implemented
(Phase 1), and neither has Postgres/stub-dependent behavior yet. The first tests to land
here will cover the `oauth/` module's connection persistence once Phase 2 starts.

Naming convention: `<module>.<behavior>.spec.ts`, e.g.
`oauth-connection.refresh-persists-token-version.spec.ts`.
