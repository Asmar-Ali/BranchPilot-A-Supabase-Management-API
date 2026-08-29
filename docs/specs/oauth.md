# `oauth` spec

Connects a verified BranchPilot caller to Supabase's Management API through a delegated,
encrypted OAuth token pair.

## Behaviors

### Start authorization

- **Trigger:** authenticated `POST /v1/integrations/supabase/authorize`, optionally with a
  valid `organization_slug` query parameter.
- **Expected result:** returns an authorization URL for Supabase OAuth with a random `state`
  and PKCE S256 challenge. The state hash and encrypted verifier are stored for ten minutes.
- **Errors:** missing caller identity returns `401`; invalid organization slugs return the
  standard `400 VALIDATION_FAILED` Problem Details response.
- **Edge cases:** plaintext state and PKCE verifier are never persisted.
- **Tests:** `test/unit/oauth.controller.spec.ts`, `test/unit/oauth-connection.service.spec.ts`,
  `test/integration/oauth-connection.persistence.spec.ts`, `test/e2e/oauth.e2e-spec.ts`.

### OAuth callback and connection

- **Trigger:** public `GET /v1/integrations/supabase/callback?code=...&state=...`.
- **Expected result:** atomically consumes an unexpired state, exchanges the code with Basic
  client authentication and the decrypted verifier, encrypts the returned tokens, stores a
  connected row, emits `oauth.connection.created`, and returns `{ "status": "connected" }`.
- **Errors:** missing, expired, or replayed state returns `400 OAUTH_STATE_INVALID` and writes
  an `oauth.state.invalid` security audit event (see [`audit`](./audit.md)) — the actor is
  unattributable at that point, so the event's `actor_sub` is `"unknown"`; token
  exchange failures never expose upstream bodies or token values.
- **Edge cases:** callback authentication relies solely on one-time state, not a browser JWT.
- **Tests:** `test/unit/oauth.controller.spec.ts`, `test/unit/oauth-connection.service.spec.ts`,
  `test/integration/oauth-connection.persistence.spec.ts`, `test/e2e/oauth.e2e-spec.ts`.

### Refresh and disconnect

- **Trigger:** an expired/near-expiry connection is used, or authenticated
  `DELETE /v1/integrations/supabase` is requested.
- **Expected result:** refreshes are single-flight per caller and use a token-version compare
  and swap update. A successful disconnect revokes upstream access, clears ciphertext, marks
  the row revoked, and emits `oauth.connection.revoked`.
- **Errors:** `invalid_grant` marks a connection revoked and yields `409 SUPABASE_REAUTH_REQUIRED`.
  A permanent (`4xx`) upstream revocation failure writes `oauth.connection.revocation_failed`
  and returns non-retryable `502 SUPABASE_REVOCATION_FAILED`; a transient revocation failure
  writes `oauth.connection.revocation_pending`, leaves the connection `revocation_pending`, and
  returns retryable `503 SUPABASE_REVOCATION_PENDING`.
- **Edge cases:** rotated refresh tokens replace the stored token; an absent refresh token in a
  refresh response retains the existing encrypted token.
- **Tests:** `test/unit/oauth-connection.service.spec.ts` (single-flight refresh, token-version
  CAS, rotated/retained refresh token, revocation outcomes),
  `test/integration/oauth-connection.persistence.spec.ts` (real Postgres CAS conflict, revoke
  clears ciphertext), `test/e2e/oauth.e2e-spec.ts` (disconnect). Refresh has no public HTTP
  route yet, so it is not independently exercised end-to-end until the Management API client
  (step 7) triggers it.

## Out of scope

Management API calls and their 401 replay policy (step 7), browser success-page redirects, and
distributed refresh locks.
