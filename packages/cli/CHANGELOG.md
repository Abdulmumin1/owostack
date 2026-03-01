# owosk

## 0.1.3

### Patch Changes

- 5299b4e: feat: Support for `owo.config.js` and smart initialization.
  - Added support for loading configuration from `owo.config.js` (ESM and CJS).
  - Updated `init` command to automatically detect TypeScript projects and generate `owo.config.ts`.
  - Updated `init` command to generate `owo.config.js` with JSDoc type hints for non-TS projects.
  - Updated all CLI commands to respect the configuration format.

## 0.1.2

### Patch Changes

- [#39](https://github.com/Abdulmumin1/owostack/pull/39) [`7b270cc`](https://github.com/Abdulmumin1/owostack/commit/7b270cc5e9f1b3e36c6af76d97cf8ce2a4789a78) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Rename packages to unscoped (owostack, owosk) and migrate license to Apache-2.0.

- Updated dependencies [[`7b270cc`](https://github.com/Abdulmumin1/owostack/commit/7b270cc5e9f1b3e36c6af76d97cf8ce2a4789a78)]:
  - owostack@0.1.2
  - @owostack/types@0.1.2
