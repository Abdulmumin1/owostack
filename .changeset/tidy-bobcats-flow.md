---
"owosk": patch
---

Fix `--prod` CLI commands to resolve the live API URL correctly.

Production commands now prefer `OWOSTACK_API_LIVE_URL`, then `environments.live`, and otherwise default to `https://api.owostack.com` instead of falling back to sandbox. `sync --prod` also no longer reuses the generic `apiUrl` config field.
