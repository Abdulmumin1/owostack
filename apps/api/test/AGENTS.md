# API Test Suite

This is how the current `apps/api` test system works.

## Main idea

Most important coverage now lives under `test/runtime/`.

- Runtime tests execute real route handlers or workflow classes.
- They use persisted state instead of hand-written DB mocks.
- They still simulate true external boundaries, such as payment providers or the usage ledger, but those simulations are concrete and stateful.

## The main buckets

- `test/runtime/routes/`
  The primary place for route tests that touch real tables and multiple pieces of application logic.
- `test/runtime/webhooks/`
  The primary place for webhook state-transition tests where real subscriptions, plans, and customers need to be seeded and mutated across multiple webhook deliveries.
- `test/runtime/workflows/`
  The primary place for billing and workflow state-transition tests.
- `test/runtime/adapters/`
  Shared adapter contract coverage driven from the real provider registry. This is where we verify every registered adapter satisfies the same required interface and optional capability contracts.
- `test/runtime/helpers/`
  Shared runtime harnesses: SQLite-backed D1, business DB setup, provider simulators, usage-ledger simulators, and workflow seed helpers.
- `test/*.behaviour.test.ts`
  Request/response or provider-behavior edge coverage where full persisted runtime state is not necessary. Provider files here should focus on quirks that are genuinely provider-specific and not already enforced by the shared adapter contract suite.
- `src/lib/*.test.ts`
  Small deterministic unit tests for pure library logic only.

## How runtime tests run

Runtime tests use an in-memory SQLite database that behaves like D1.

- `test/runtime/helpers/sqlite-d1.ts` applies the real repo migrations.
- `test/runtime/helpers/business-db.ts` creates a real Drizzle DB on top of that D1 shim.
- Route tests build a real Hono app through `test/helpers/route-harness.ts`.
- Workflow tests instantiate the real workflow entrypoint and run it through `runWorkflow(...)`.

The test usually follows this pattern:

1. Create the runtime DB.
2. Seed real rows: organization, customer, plan, provider account, payment method, billing run, and so on.
3. Inject only the external seams that must be simulated, such as provider adapters.
4. Execute the real route or workflow.
5. Assert on persisted state, response bodies, and recorded provider operations.

## External boundaries

We do not want broad `vi.mock(...)` coverage for app modules.

- Prefer dependency seams over module monkeypatching.
- Prefer a concrete provider simulator over loose spies.
- Prefer asserting database state over asserting internal calls.
- If a mock-only suite is replaced by a runtime suite, delete the old one instead of keeping both.

## Useful commands

- `pnpm --filter owostack-api test`
  Run the full API test suite.
- `pnpm --filter owostack-api test:runtime`
  Run all runtime-backed integration tests.
- `pnpm --filter owostack-api test:runtime:adapters`
  Run the shared registered-adapter contract suite.
- `pnpm --filter owostack-api test:runtime:webhooks`
  Run runtime-backed webhook state-transition tests.
- `pnpm --filter owostack-api test:runtime:workflows`
  Run only runtime workflow tests.

## Rule of thumb

If a test depends on real rows, billing state, provider account selection, workflow environment, or multi-step route behavior, it belongs in `test/runtime/`.
