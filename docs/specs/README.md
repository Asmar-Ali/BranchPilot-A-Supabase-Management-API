# Feature specs

A feature spec is a living, per-module description of *observable behavior*: what a
caller can do, what they get back, and what happens when things go wrong. It is not an
ADR (those record architecture decisions and why they were made — see `docs/adr/`) and
it is not API reference docs (that's what `openapi/openapi.json` is for). A spec is the
thing a test gets written against.

## Why this exists

Tests without a spec drift: it becomes unclear whether a test encodes an intentional
behavior or an accident of the current implementation. A spec pins down intent first, so
a test failure has an unambiguous answer to "is the test wrong or is the code wrong?"

## Convention

- One file per module, named after the module directory: `docs/specs/oauth.md`,
  `docs/specs/branches.md`, `docs/specs/audit.md`, etc. — matching the layout in the
  README's "Module boundaries" section.
- Start new specs from [`TEMPLATE.md`](./TEMPLATE.md).
- A spec is edited in place, not appended to. It describes current behavior, not a
  history of changes — git history is the changelog.
- Keep it short and behavioral: inputs, outputs, error cases, edge cases. Skip
  implementation detail that belongs in code comments or an ADR instead.
- Every entry in a spec's "Behaviors" section should map to at least one test named
  clearly enough to find it (see [`docs/testing-strategy.md`](../testing-strategy.md) for
  which layer a given behavior belongs at).

## Workflow

Specs are updated as part of making a behavior change, not as a separate documentation
pass afterward: spec update → test update → implementation, in that order, for every
change that alters what the system does.

See [`docs/specs/health.md`](./health.md) for a populated example, written against the
module that's actually implemented today.
