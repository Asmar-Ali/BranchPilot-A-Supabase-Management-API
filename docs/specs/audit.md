# `audit` spec

Records an append-only, allowlisted trail of what callers and BranchPilot did against
Supabase on their behalf, for later inspection alongside a correlation ID.

## Behaviors

### Record an audit event

- **Trigger:** an internal call to `AuditService.record()` from another module (`oauth`,
  `branches`) after a state-changing attempt.
- **Expected result:** inserts one row into `audit_events` with `actor_sub`, `action`,
  `target_type`, an optional `target_id`, `outcome` (`success` | `failure`), the
  triggering `correlation_id`, an optional upstream HTTP status, and a `metadata` JSON
  object. Rows are never updated or deleted by application code.
- **Errors:** a database failure while recording propagates to the caller; audit writes
  are not best-effort/fire-and-forget, since a silently dropped audit event would
  undermine the reason the module exists.
- **Edge cases:** `metadata` values that look like an opaque credential (a long
  token/JWT-shaped string) are replaced with `"[redacted]"` before the row is written,
  even if a caller mistakenly passes one through — metadata must only ever carry short,
  human-meaningful values (names, refs, keys), never secrets.
- **Tests:** `test/unit/audit.service.spec.ts`, `test/unit/sanitize-metadata.spec.ts`.

### Events currently written

| Action | Module | Outcome | Trigger |
| --- | --- | --- | --- |
| `oauth.connection.created` | `oauth` | success | OAuth callback completes |
| `oauth.connection.revoked` | `oauth` | success | Disconnect completes |
| `oauth.state.invalid` | `oauth` | failure | Callback state is missing, expired, or replayed (actor is unattributable, so `actor_sub` is `"unknown"`) |
| `oauth.connection.revocation_failed` | `oauth` | failure | Upstream revocation fails with a `4xx` |
| `oauth.connection.revocation_pending` | `oauth` | failure | Upstream revocation fails transiently |
| `branch.created` | `branches` | success | Create succeeds directly, or reconciliation confirms an ambiguous create |
| `branch.deleted` | `branches` | success | Delete succeeds |
| `branch.create.idempotency_conflict` | `branches` | failure | Idempotency key reused with a different request body |
| `branch.create.failed` | `branches` | failure | Create fails with a non-ambiguous upstream error |
| `branch.create.outcome_unknown` | `branches` | failure | Reconciliation cannot confirm an ambiguous create |

- **Tests:** `test/unit/oauth-connection.service.spec.ts`,
  `test/unit/branches.service.spec.ts`,
  `test/integration/oauth-connection.persistence.spec.ts`,
  `test/integration/branch-operations.persistence.spec.ts`,
  `test/e2e/oauth.e2e-spec.ts`, `test/e2e/branches.e2e-spec.ts`.

## Out of scope

A public API for callers to read their own audit history, refresh-attempt audit events
(refresh failures are currently only visible via the `SUPABASE_TOKEN_REFRESH_FAILED` /
`SUPABASE_REAUTH_REQUIRED` error responses and OTel spans, not `audit_events` rows),
retention/archival policy, and export to an external SIEM.
