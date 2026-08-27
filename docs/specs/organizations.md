# `organizations` spec

Lists the authenticated caller's organizations through their delegated Supabase Management API
connection.

## Behaviors

### Verified caller identity

- **Trigger:** `GET /v1/organizations` with `Authorization: Bearer <JWT>`.
- **Expected result:** a JWT verified by `@supabase/server` against the configured JWKS
  source returns the caller's Management API organization array. The adapter receives the
  stable subject from `@SupabaseCtx('userClaims').id`; it never parses the raw JWT itself.
- **Errors:** missing, malformed, expired, or incorrectly-signed Bearer tokens return the
  standard `401 UNAUTHORIZED` Problem Details response before the controller runs.
- **Edge cases:** the stable `actor_sub` comes from `@SupabaseCtx('userClaims').id`, which
  the adapter derives from the verified JWT `sub`; the controller does not decode or parse the
  raw token. The adapter also needs `SUPABASE_PUBLISHABLE_KEY` for the caller-scoped client
  and the server-only `SUPABASE_SECRET_KEY` for its admin client. The route uses a
  controller-level guard, so health endpoints and the OAuth callback remain public. If the
  guard ever passes a request through without populating `userClaims` (`null`), the
  controller fails closed with `500 InternalServerErrorException` rather than returning a
  malformed identity.
- **Tests:** `test/e2e/organizations-auth.e2e-spec.ts`, `test/unit/organizations.controller.spec.ts`.

## Out of scope

Project pagination and branch lifecycle operations.
