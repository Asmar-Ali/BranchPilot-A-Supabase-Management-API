# `database` spec

Owns BranchPilot's PostgreSQL connection pool and the append-only migration history that
creates its local persistence schema.

## Behaviors

### Parameterized database access

- **Trigger:** a module injects the global `DATABASE` token and calls `query` with SQL text
  and optional positional values.
- **Expected result:** the query runs through the shared PostgreSQL pool and returns the
  typed `pg` result. The database module exports no raw pool or connection token.
- **Errors:** PostgreSQL query and connection errors propagate to the calling application
  service; controllers must not issue SQL directly.
- **Edge cases:** closing the Nest application closes the pool, so no idle database sockets
  keep the process alive.
- **Tests:** `test/unit/database.service.spec.ts`.

### Schema migrations

- **Trigger:** `npm run db:migrate` after PostgreSQL is running.
- **Expected result:** SQL migration files run in filename order, each in its own
  transaction, and are recorded with a SHA-256 checksum in `schema_migrations`.
- **Errors:** an applied migration with a changed checksum stops the run; a failed migration
  rolls back its transaction and is not recorded.
- **Edge cases:** rerunning against the same database skips already-recorded migrations with
  matching checksums. The initial migration creates OAuth transactions, Supabase
  connections, branch operations, and audit events without foreign keys to a future local
  user table.
- **Tests:** `test/unit/migration-runner.spec.ts`; run `npm run db:migrate` twice against
  the local Compose database to verify the full PostgreSQL path.

## Out of scope

Repository methods, domain-specific SQL, readiness checks, and automatic schema rollback.
