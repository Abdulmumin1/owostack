---
"owostack": minor
"@owostack/types": minor
---

Redesign credit-backed check and track responses to return a canonical `credits` object instead of loose top-level credit fields.

The new shape distinguishes between `credit_system` and `prepaid` balances, includes plan balance details consistently, and aligns direct credit-system feature checks with child features resolved through a credit pool.
