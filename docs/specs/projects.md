# `projects` spec

Returns offset-paginated projects for one organization through the caller's delegated
Supabase connection.

## Behaviors

### Project page

- **Trigger:** authenticated `GET /v1/organizations/:slug/projects?limit=20&offset=0`.
- **Expected result:** returns `{ items, page }`, where `page` contains the accepted `limit`,
  `offset`, and `nextOffset`. `nextOffset` is `null` when the returned page is shorter than
  the requested limit.
- **Errors:** invalid slugs, non-integer values, limits outside 1–100, negative offsets, and
  unknown query parameters return `400 VALIDATION_FAILED`. Authentication failures are handled
  by the shared inbound Supabase guard.
- **Edge cases:** query defaults are `limit=20` and `offset=0`; organization slugs are URL
  encoded before their upstream request.
- **Tests:** controller and service coverage are added with the catalog integration tests.

## Out of scope

Filtering, sorting, caching, and project creation.
