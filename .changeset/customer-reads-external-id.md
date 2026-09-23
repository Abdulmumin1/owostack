---
"@owostack/types": minor
"owostack": minor
---

Customer reads accept the same identifier you write with.

- `GET /customers/{id}` and `GET /customers/{id}/usage/history` now resolve your external customer ID (the `customer` value passed to `track`/`check`) and the customer's email, not only the internal UUID. Ambiguous matches return `409`.
- New `GET /customers` list/search endpoint with `limit`, `offset`, `search`, `email` and `externalId` filters, exposed as `owo.customer.list()`.
- New `owo.customer.get(customer)`.
- `CustomerResult` now includes `externalId`, and `createdAt`/`updatedAt` are typed as the Unix millisecond numbers the API actually returns (they were typed as ISO strings).
- New types: `CustomerListParams`, `CustomerListResult`, `CustomerSummary`.
