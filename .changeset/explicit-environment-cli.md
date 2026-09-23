---
"owosk": minor
---

Explicit environment, `--json`, and stable exit codes.

- `--mode sandbox|live` (or `OWOSTACK_MODE`) replaces the sandbox-by-default behaviour. With no flag the mode is inferred from an environment-scoped key; a legacy key with no mode exits `2` with instructions. A mode that contradicts the key's scope is refused before any request. `--prod` remains as a deprecated alias for `--mode live`.
- `--mode`, `--key`, `--config` and `--json` are now documented on every API-facing subcommand (`sync`, `diff`, `pull`, `validate`) instead of `--prod` living only at the top level.
- `--json` prints exactly one JSON document on stdout — no spinner frames, colours or prompts (`sync --json` requires `--yes` or `--dry-run`). Errors are JSON too.
- Stable exit codes: `0` ok, `1` failed, `2` usage/config error, `3` drift (`diff --exit-code`).
- `owosk connect` stores a sandbox key and a live key (`~/.owostack/config.json` → `keys.sandbox` / `keys.live`); commands pick the one for the selected mode.
- `OWOSTACK_API_URL` now overrides the host for whichever mode is selected (previously it only applied to live).
