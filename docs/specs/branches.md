# `branches` spec

Lists, creates, and deletes Supabase preview branches through the caller's delegated
Management API connection, with idempotent creation and reconciliation of ambiguous
outcomes.

## Behaviors

### List and observe branches

- **Trigger:** authenticated `GET /v1/projects/:ref/branches` or
  `GET /v1/projects/:ref/branches/:name`.
- **Expected result:** returns each branch's `name`, `ref`, and a normalized `status` drawn
  from `pending | ready | failed | inactive | unknown`.
- **Errors:** an invalid `ref`/`name` returns `400 VALIDATION_FAILED`; upstream failures are
  surfaced as the `management-api` client's normalized errors (e.g. `404
  SUPABASE_RESOURCE_NOT_FOUND`).
- **Edge cases:** the raw upstream status is never returned publicly; normalization defaults
  an unrecognized upstream value to `unknown` rather than failing the request.
- **Tests:** `test/unit/branch-status.spec.ts`, `test/unit/branches.controller.spec.ts`.

### Create a branch

- **Trigger:** authenticated `POST /v1/projects/:ref/branches` with a required
  `Idempotency-Key` header and a JSON body `{ name, persistent?, withData? }`.
- **Expected result:** `persistent` and `withData` default to `false`. A new `Idempotency-Key`
  creates a `branch_operations` row, calls the Management API, stores the resulting branch
  identity and status, writes `branch.created`, and returns the created branch. Replaying the
  same key with an identical request body returns the original result without a second
  upstream call.
- **Errors:** a missing `Idempotency-Key` or invalid body returns `400 VALIDATION_FAILED`;
  reusing a key with a different request body returns `409 IDEMPOTENCY_KEY_REUSED` and
  writes a `branch.create.idempotency_conflict` audit event (see [`audit`](./audit.md)); a
  non-ambiguous upstream failure marks the operation `failed` and writes
  `branch.create.failed` before rethrowing the `management-api` client's normalized error.
- **Edge cases (ambiguous outcome):** if the create request fails in a way that leaves the
  upstream outcome unknown (the `management-api` client's retryable
  `SUPABASE_UPSTREAM_UNAVAILABLE`, which covers both network failures and exhausted `5xx`
  retries), the operation is never blindly retried. It is marked `unknown`, then reconciled by
  listing the project's branches and matching the requested name. A match resolves the
  operation as succeeded and writes `branch.created`; no match writes
  `branch.create.outcome_unknown` and returns a retryable `503
  BRANCH_CREATE_OUTCOME_UNKNOWN`. A subsequent replay with the same idempotency key
  re-attempts (rather than duplicates) an operation left `pending`, `unknown`, or `failed`.
- **Tests:** `test/unit/idempotency.spec.ts`, `test/unit/branches.service.spec.ts`,
  `test/unit/branches.controller.spec.ts`,
  `test/integration/branch-operations.persistence.spec.ts`, `test/e2e/branches.e2e-spec.ts`.

### Delete a branch

- **Trigger:** authenticated `DELETE /v1/branches/:branchRef`.
- **Expected result:** deletes the branch through the Management API and writes
  `branch.deleted`; returns `204`.
- **Errors:** upstream failures are the `management-api` client's normalized errors.
- **Edge cases:** ownership is enforced by the upstream Management API through the caller's
  own delegated OAuth token, the same trust model already used for organizations and
  projects — BranchPilot does not maintain a separate local ownership ledger for branches
  that predate an operation row.
- **Tests:** `test/unit/branches.service.spec.ts`, `test/unit/branches.controller.spec.ts`,
  `test/e2e/branches.e2e-spec.ts`.

## Out of scope

Background reconciliation polling, branch merge, project/branch secrets, and a public branch
list/detail cache.
