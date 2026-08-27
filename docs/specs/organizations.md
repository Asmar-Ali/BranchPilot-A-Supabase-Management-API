# `organizations` spec

Provides the authenticated caller boundary for the future Supabase Management API
organization listing feature.

## Behaviors

### Verified caller identity

- **Trigger:** `GET /v1/organizations` with `Authorization: Bearer <JWT>`.
- **Expected result:** a JWT verified by `@supabase/server` against the configured JWKS
  source returns `200 { "actor_sub": "<verified subject>" }`. This is a temporary
  identity-only response; the Management API organization list is added in implementation
  step 7.
- **Errors:** missing, malformed, expired, or incorrectly-signed Bearer tokens return the
  standard `401 UNAUTHORIZED` Problem Details response before the controller runs.
- **Edge cases:** the stable `actor_sub` comes from `@SupabaseCtx('userClaims').id`, which
  the adapter derives from the verified JWT `sub`; the controller does not decode or parse the
  raw token. The adapter also needs `SUPABASE_PUBLISHABLE_KEY` for the caller-scoped client
  and the server-only `SUPABASE_SECRET_KEY` for its admin client. The route uses a
  controller-level guard, so health endpoints and the OAuth callback remain public.
- **Tests:** `test/e2e/organizations-auth.e2e-spec.ts`.

## Out of scope

Calling the Supabase Management API, pagination, organization authorization rules, and OAuth
connection lookup. Those are implemented in steps 6 and 7.
