---
"owostack": patch
"@owostack/types": patch
"owosk": patch
---

Add `entity()` builder for non-consumable features (seats, projects, workspaces)

- New `entity(slug, opts?)` function — defines features managed via `.add()` / `.remove()` instead of `track()`
- `EntityHandle` methods: `.add(customer, opts)`, `.remove(customer, entity)`, `.list(customer)`, `.check(customer)`
- Defaults to `reset: "never"` — entity count reflects current state, not periodic usage
- Sync payload now includes `meterType: "non_consumable"` for entity features
- CLI (`owosk pull`) now generates `entity()` for non-consumable features
- `/plans` API response now includes `meterType` on features

```ts
import { entity, plan } from "owostack";

const seats = entity("seats", { name: "Team Seats" });

// In plan config
seats.limit(5); // reset: "never" is implicit

// At runtime
await seats.add("org@acme.com", { entity: "user_123", name: "John" });
await seats.remove("org@acme.com", "user_123");
const { entities } = await seats.list("org@acme.com");
```
