---
name: feature-spec-and-tests
description: Use when changing or adding observable behavior in BranchPilot's src/ code — a new endpoint, a changed validation rule, a new error/status case, edited retry/refresh/reconciliation logic, a DB schema/constraint change, a changed audit event or response envelope. Before/alongside the code change, update the matching feature spec under docs/specs/ and add or update tests at the right layer per docs/testing-strategy.md. Skip for pure formatting, comment-only, dependency-bump, or no-behavior-change refactors.
---

# Feature spec + tests workflow

BranchPilot keeps `docs/specs/` as the source of truth for what the system does. No
behavior change lands without both a spec update and test coverage — a passing build is
not "done" on its own.

## When this applies

Applies to any change under `src/**` that adds, removes, or changes observable behavior:
a new endpoint, a new validation rule, a new error/status case, changed
retry/refresh/reconciliation logic, a changed DB schema/constraint, a changed audit event
shape, a changed response envelope.

Does not apply to: pure formatting/lint fixes, comment-only edits, dependency bumps,
renames or refactors with no behavior change. If unsure whether a change is
behavior-affecting, err toward treating it as one.

## Steps

1. **Identify the owning module** — `identity`, `oauth`, `management-api`,
   `organizations`, `projects`, `branches`, `audit`, `observability`, `common/errors`,
   `common/http`, `common/validation`, `database`, `config`, or `health` — using the
   README's "Module boundaries" section.

2. **Update the spec first.** Open (or create from `docs/specs/TEMPLATE.md`)
   `docs/specs/<module>.md` and describe the new/changed behavior: trigger, expected
   result, errors, edge cases. Edit in place — a spec describes current behavior, not a
   changelog. Do this before or in the same turn as the code change, not after.

3. **Implement the code change.**

4. **Add or update tests** at the layer(s) `docs/testing-strategy.md`'s per-module matrix
   calls for:
   - Pure logic/decision tables → unit (`test/unit/`).
   - Behavior depending on real Postgres or the Management API stub → integration
     (`test/integration/`).
   - Full request/response contract including auth guard, validation pipe, and error
     envelope → e2e (`test/e2e/`).
   Most behavior changes need at least a unit test plus one e2e assertion; add an
   integration test whenever Postgres or stub wiring is part of what changed.

5. **Run the affected test command(s)** — `npm test`, `npm run test:integration`,
   `npm run test:e2e` — and confirm they pass.

6. If the change alters a documented public API response/error shape, note in the PR
   description that `openapi/openapi.json` regeneration is pending until that tooling
   exists (Phase 5) — this does not excuse skipping the spec/test update.

## Definition of done

- [ ] `docs/specs/<module>.md` reflects the new behavior.
- [ ] Tests exist at the right layer(s), and demonstrably fail without the change and
      pass with it.
- [ ] `npm run lint`, `npm run typecheck`, and the relevant test command(s) pass.

This mirrors IMPLEMENTATION_GUIDE.md's per-step "Done when" checks: the spec and tests
are how "done" gets verified, for every phase — not just the ones already implemented.
