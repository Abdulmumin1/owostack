---
"@owostack/types": minor
"owostack": minor
---

Environment-aware check/track responses.

- `CheckResult` and `TrackResult` now include `environment: "sandbox" | "live"` (the environment that served the request, also echoed in the `X-Owostack-Environment` response header) and an explicit `unlimited: boolean` alongside `limit: null`.
- `ResponseDetails.plan` carries the slug of the plan granting access, next to `planName`.
- New `OwostackEnvironment` type export.
