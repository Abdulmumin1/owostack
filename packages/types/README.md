# @owostack/types

Shared TypeScript types for the Owostack billing infrastructure. This package provides the type definitions used across the Owostack ecosystem, including the Core SDK, CLI, and API.

## Installation

```bash
npm install @owostack/types
```

## Features

- **Core Configuration**: Types for SDK initialization and environment settings.
- **API Parameters & Results**: Request and response types for all Owostack endpoints (attach, check, track, etc.).
- **Catalog Definitions**: Types for declarative plan and feature configuration.
- **Database Models**: Interfaces for customers, subscriptions, entitlements, and usage records.
- **Shared Constants**: Type unions for currencies, billing intervals, and reset periods.

## Usage

You generally do not need to install this package directly if you are using `owostack`, as it is included as a dependency. However, it can be useful for shared utility functions or when building custom integrations.

```ts
import type {
  OwostackConfig,
  AttachParams,
  CheckResult,
} from "@owostack/types";
```

## License

Apache-2.0
