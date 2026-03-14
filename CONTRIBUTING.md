# Contributing

This repository is primarily maintained by the author. External contributions are not the main goal, but well-scoped fixes, docs improvements, and bug reports are still useful.

## Before Opening a PR

1. Install dependencies with `pnpm install`.
2. Run the relevant workspace commands for the area you changed.
3. Update docs when behavior or public APIs change.
4. Do not commit secrets, `.env` files, or local Wrangler state.

## Useful Commands

```bash
pnpm build
pnpm test
pnpm api:test
pnpm api:dev
pnpm docs:dev
pnpm --filter owostack-dashboard dev
pnpm --filter owostack-marketing dev
```

## Project Structure

- `apps/api`: Cloudflare Workers API. This app uses two databases:
  - D1 for core platform data such as users and organizations.
  - Business database for billing data such as invoices, payments, and plans.
- `apps/dashboard`: Internal dashboard for managing billing entities.
- `apps/docs`: Product documentation site.
- `apps/marketing`: Marketing site.
- `packages/*`: Shared SDKs, adapters, analytics, CLI, and types.

## Change Expectations

- Keep changes modular and testable.
- Prefer small PRs with a clear reason for the change.
- Keep styling consistent with the existing shared app styles.
- If a package is publicly consumed, update its README and changeset when needed.

## Reporting Issues

If you find a security issue, avoid posting sensitive details in a public issue.
