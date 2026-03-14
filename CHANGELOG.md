# Changelog

## [Unreleased]

### Fixed

- **Dashboard**: Fixed environment state hydration from server-side data
  - Active environment now properly loads from organization metadata on page load
  - Prevents environment state mismatch between server and client
  - Added `hydrateEnvironment()` helper to sync environment and project ID atomically
  - Ensures correct API endpoint selection on initial render

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
