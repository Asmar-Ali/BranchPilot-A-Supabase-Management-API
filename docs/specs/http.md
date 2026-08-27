# `common/http` spec

Provides the cross-cutting HTTP contract applied before feature controllers are added.

## Behaviors

### Correlation IDs and CORS

- **Trigger:** every HTTP request.
- **Expected result:** a valid incoming `X-Correlation-Id` UUID is preserved; otherwise a
  UUID is generated, returned in the response header, and attached to Pino request logs.
  CORS accepts only origins from the validated configuration and permits the authentication,
  content, idempotency, and correlation headers.
- **Errors:** invalid incoming correlation IDs are replaced rather than rejected.
- **Edge cases:** no credentials are enabled because there is no browser-cookie workflow in
  v1. Health endpoints remain public and skip rate limiting.
- **Tests:** `test/unit/correlation-id.spec.ts`, `test/e2e/http-conventions.e2e-spec.ts`.

### Problem Details and rate limits

- **Trigger:** an `AppError`, Nest HTTP exception, unexpected exception, or exhausted rate
  limit.
- **Expected result:** the response has `application/problem+json` with stable `type`,
  `title`, `status`, `code`, `correlationId`, and `retryable` fields. General traffic is
  limited per authenticated actor when one is present, otherwise by IP; mutating methods use
  a lower limit.
- **Errors:** unexpected errors are sanitized to `500 INTERNAL_SERVER_ERROR`; no raw error
  messages, stack traces, or request data are returned.
- **Edge cases:** rate-limit responses retain the same correlation ID and problem shape as
  application failures.
- **Tests:** `test/e2e/http-conventions.e2e-spec.ts`.

## Out of scope

Distributed rate-limit storage, trace exporting, and audit-event persistence; those land
with their respective modules.
