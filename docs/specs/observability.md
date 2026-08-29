# `observability` spec

Gives every request a distributed trace and structured logs, so a single correlation ID
can be followed from the inbound HTTP request through outbound calls, PostgreSQL
queries, and the matching audit event.

## Behaviors

### Distributed tracing

- **Trigger:** the process starts (`src/observability/tracing.ts` is imported as the
  first line of `src/main.ts`, before Nest, `pg`, or `fetch` are used elsewhere).
- **Expected result:** an OpenTelemetry `NodeSDK` starts with auto-instrumentation
  (inbound/outbound HTTP via `undici`, PostgreSQL queries via `pg`) and exports spans
  over OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`).
  Higher-level business spans are added explicitly around
  `oauth.authorization_code_exchange`, `oauth.token_refresh`, `branches.create`, and
  `branches.observe.*`, so a trace reads as one operation rather than a flat list of raw
  HTTP/DB calls.
- **Errors:** a span records the thrown error and is marked errored; the underlying
  operation's own error handling and response are unaffected — tracing is purely an
  observer and never changes control flow.
- **Edge cases:** the SDK starts even when no OTLP collector is reachable (exports fail
  silently in the background rather than blocking startup or requests). `SIGTERM`/`SIGINT`
  flush and shut the SDK down.
- **Tests:** none dedicated — this module has no caller-observable HTTP behavior to
  assert against; it is verified manually per the demo script (a trace and its matching
  audit event, both keyed by one correlation ID).

### Correlation IDs

- Documented under [`common/http`](./http.md); every audit event and span-worthy
  operation carries the same correlation ID as the inbound request.

## Out of scope

Metrics/Prometheus export, log-trace correlation beyond what `nestjs-pino` already
attaches, and sampling configuration (the default sampler is used).
