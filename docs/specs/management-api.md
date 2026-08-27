# `management-api` spec

Provides the small, typed outbound surface used to call Supabase's Management API with a
caller's delegated OAuth connection.

## Behaviors

### Delegated requests and response contracts

- **Trigger:** a catalog or branch application service calls one of the Management API client
  methods with an actor and correlation ID.
- **Expected result:** the client obtains a usable delegated access token, sends it only as a
  Bearer authorization header, forwards `X-Correlation-Id`, enforces a ten-second timeout,
  and validates every successful JSON response with Zod before returning it.
- **Errors:** malformed successful responses return `502 UPSTREAM_CONTRACT_INVALID`; `403`
  returns `SUPABASE_SCOPE_INSUFFICIENT`; `404` returns `SUPABASE_RESOURCE_NOT_FOUND`; `429`
  returns retryable `SUPABASE_RATE_LIMITED` and includes a bounded `retryAfterSeconds` when
  Supabase supplied one.
- **Edge cases:** tokens and upstream response bodies are never included in domain errors.
- **Tests:** `test/unit/fetch-management-api.client.spec.ts`.

### Retry and reauthorization policy

- **Trigger:** an outbound Management API request receives a failure.
- **Expected result:** a `401` forces one OAuth refresh and replays the same request once.
  Network failures and `5xx` responses retry only safe `GET` requests, at most three total
  attempts, with exponential full-jitter backoff. Mutations are never automatically retried.
- **Errors:** exhausted retryable failures return retryable `503 SUPABASE_UPSTREAM_UNAVAILABLE`.
- **Edge cases:** `Retry-After` values above 60 seconds are clamped; invalid HTTP-date values
  are not trusted as retry delays.
- **Tests:** `test/unit/retry-policy.spec.ts`, `test/unit/fetch-management-api.client.spec.ts`.

## Out of scope

Audit persistence, OpenTelemetry span export, and ambiguous branch-create reconciliation.
