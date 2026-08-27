# `<module-name>` spec

One-sentence summary of what this module is responsible for.

## Behaviors

### `<short behavior name>`

- **Trigger:** what request/call/condition starts this.
- **Expected result:** what the caller/system observes on success.
- **Errors:** every distinct failure mode and the response/state it produces.
- **Edge cases:** boundary conditions worth calling out explicitly (empty input,
  concurrent calls, retries, expiry, etc.).
- **Tests:** which test file(s)/layer(s) this behavior is covered by.

<!-- Repeat the "Behaviors" subsection per distinct behavior the module exposes. -->

## Out of scope

Anything explicitly *not* handled by this module, if it's likely to be assumed
otherwise (link to the README's "Non-goals" section if it's a project-wide non-goal
rather than a module-specific one).
