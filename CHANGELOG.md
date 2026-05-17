# Changelog

## [Unreleased]

### Fixed

- **Dashboard**: Fixed environment state hydration from server-side data
  - Active environment now properly loads from organization metadata on page load
  - Prevents environment state mismatch between server and client
  - Added `hydrateEnvironment()` helper to sync environment and project ID atomically
  - Ensures correct API endpoint selection on initial render
- **SDK**: Fixed credit-system child feature handles not binding when only referenced through credit systems
  - Catalog binding now includes direct plan features, direct credit system definitions, and credit-system child features discovered through plan-linked credit systems
  - Added regression coverage for both direct credit-system catalog entries and plan-linked `.credits(...)` usage
- **Demo app**: Fixed chat model pricing drift between UI and API metering
  - Moved model ids and multipliers into a shared chat model catalog
  - Server now validates model ids and uses the same price table as the frontend
- **Dashboard API**: Fixed feature PATCH updates writing a non-existent `updatedAt` column
  - Feature edits now only persist schema-backed fields
- **Dashboard API**: Fixed credit-system mapping replacement and manual override grants to avoid partial writes and duplicate logical rows
  - Credit-system create/update now validates mappings before replacing rows and uses batched writes for atomic replacement in the D1 path
  - Manual overrides now use an atomic upsert backed by a unique partial index for manual/manual_bonus logical keys

### Changed

- **Dashboard**: Improved environment state management
  - Server-side loads active environment from organization metadata
  - Client-side hydrates from server data instead of defaulting to "test"
  - Reduces unnecessary environment switches on page load
- **API**: Fixed unlimited metered features incorrectly showing as disabled in public plans API
  - Metered features with `limitValue: null` (unlimited) now correctly show `enabled: true`
  - Boolean features continue to use `limitValue !== 0` for enabled state
  - Ensures consistent feature availability representation across plan endpoints
  - Added test coverage for unlimited metered features

### Changed

- **API**: Improved feature enabled logic in `/api/v1/plans` and `/api/v1/plans/:slug` endpoints
  - Boolean features: `enabled` based on `limitValue !== 0`
  - Metered features: `enabled` always `true` (availability controlled by limit value)
  - Properly handles `limit`, `resetInterval` based on feature type
