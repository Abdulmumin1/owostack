# API Test Suite

Use these buckets when adding or moving tests:

- `test/runtime/`
  Stateful integration tests that run real application code against persisted data.
  Prefer this for workflows, billing state transitions, and any logic that depends on D1 rows or durable orchestration.
- `test/runtime/workflows/`
  Authoritative workflow coverage. Seed real subscription, plan, customer, and provider account rows and assert the resulting persisted state after the workflow runs.
- `test/runtime/routes/`
  Route integration coverage against real database state. Prefer this when handlers read or mutate multiple persisted tables and the full request/response contract matters.
- `test/helpers/`
  Generic helpers shared across route and behavior tests.
- `test/runtime/helpers/`
  Runtime-only harnesses such as the SQLite-backed D1 shim.
- `test/*.behaviour.test.ts`
  Route-level or provider-behavior coverage where the real HTTP boundary matters but full persisted runtime state is not necessary.
- `src/lib/*.test.ts`
  Small deterministic unit tests for pure library logic only.
  Do not add new database-heavy workflow tests here.

Testing rules for this repo:

- Prefer persisted state over hand-written database mocks.
- Prefer real route handlers plus real business/auth database rows over monkeypatching imported app modules.
- For workflow and billing tests, seed real rows and assert the resulting database state.
- Mock only true external boundaries that are impractical to execute locally, such as provider network calls.
- When simulating providers, keep the simulation concrete and stateful enough to reflect production expectations.
- If a suite needs alternative provider or auth behavior, add an explicit dependency seam and override it in the test instead of using `vi.mock(...)` on app modules.
- As workflow suites migrate to `test/runtime/workflows/`, delete the overlapping mock-only suite instead of keeping both copies.
- If a helper is specific to one testing style, keep it under that style's folder instead of the global helper bucket.
