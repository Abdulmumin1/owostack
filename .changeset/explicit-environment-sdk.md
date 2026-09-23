---
"owostack": minor
"@owostack/types": minor
---

No more silent production default.

- `new Owostack({ secretKey })` resolves its environment from `apiUrl`, then `mode`, then the key prefix (`owo_sk_test_…` → sandbox, `owo_sk_live_…` → live). When none of those determine it — a legacy `owo_sk_…` key with no `mode` — the client still constructs, but the first request throws `OwostackError` with code `config_error` instead of talking to `api.owostack.com`. A `mode` that contradicts a scoped key is also a `config_error`.
- New `owo.mode` and `owo.apiUrl` getters, plus exported helpers `inferModeFromSecretKey`, `resolveEnvironment`, `apiUrlForMode`, `OWOSTACK_HOSTS`.
- `OwostackConfig.environments` is now declared (per-environment hosts used by the CLI).

**Migration:** if you use a legacy key without `mode`, add `mode: "sandbox"` or `mode: "live"` — or rotate to an environment-scoped key from the dashboard.
