# Changelog

## [Unreleased]

### Fixed
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
