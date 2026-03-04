# owostack

## 0.1.4

### Patch Changes

- [`acf4de8`](https://github.com/Abdulmumin1/owostack/commit/acf4de8738bce69cb754970b599c2be66b916af7) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Add `entity()` builder for non-consumable features (seats, projects, workspaces)
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

- Updated dependencies [[`acf4de8`](https://github.com/Abdulmumin1/owostack/commit/acf4de8738bce69cb754970b599c2be66b916af7)]:
  - @owostack/types@0.1.4

## 0.1.2

### Patch Changes

- [#39](https://github.com/Abdulmumin1/owostack/pull/39) [`7b270cc`](https://github.com/Abdulmumin1/owostack/commit/7b270cc5e9f1b3e36c6af76d97cf8ce2a4789a78) Thanks [@Abdulmumin1](https://github.com/Abdulmumin1)! - Rename packages to unscoped (owostack, owosk) and migrate license to Apache-2.0.

- Updated dependencies [[`7b270cc`](https://github.com/Abdulmumin1/owostack/commit/7b270cc5e9f1b3e36c6af76d97cf8ce2a4789a78)]:
  - @owostack/types@0.1.2
