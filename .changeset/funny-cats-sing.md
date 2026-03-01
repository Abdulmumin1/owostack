---
"owosk": patch
---

feat: Support for `owo.config.js` and smart initialization.

- Added support for loading configuration from `owo.config.js` (ESM and CJS).
- Updated `init` command to automatically detect TypeScript projects and generate `owo.config.ts`.
- Updated `init` command to generate `owo.config.js` with JSDoc type hints for non-TS projects.
- Updated all CLI commands to respect the configuration format.
