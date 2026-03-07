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
