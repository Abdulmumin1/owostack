---
"owosk": patch
---

Fix JavaScript config generation and loading in the CLI.

- Generate `owo.config.js` as ESM with `import` and `export` syntax.
- Stop emitting CommonJS `require()` and `module.exports` in generated JavaScript configs.
- Reject `.cjs` config targets and keep `.js`/`.ts` as the supported defaults.
- Improve config loading so CLI commands can resolve `owostack` consistently in local workspace usage.
- Update CLI docs and loader examples to match the ESM `owo.config.js` format.
