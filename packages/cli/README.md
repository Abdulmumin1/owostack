# owosk

The primary tool for managing your Owostack billing configuration from the terminal. Use it to synchronize your local catalog, validate your configuration, and manage your billing infrastructure.

## Installation

Install the CLI globally:

```bash
npm install -g owosk
```

Or use it directly with npx:

```bash
npx owosk --help
```

## Commands

### `init`

Initialize a new Owostack project with a default configuration file (`owo.config.ts` or `owo.config.js`). JavaScript configs use ESM `import`/`export` syntax.

```bash
npx owosk init
```

### `sync`

Push your local catalog configuration to the Owostack cloud.

```bash
npx owosk sync
```

### `pull`

Pull existing plans and features from the cloud into your local configuration.

```bash
npx owosk pull
```

### `diff`

Preview changes by comparing your local configuration with the cloud.

```bash
npx owosk diff
```

### `validate`

Check your local configuration for errors without applying changes.

```bash
npx owosk validate
```

### `connect`

Authenticate and connect your local environment to an organization.

```bash
npx owosk connect
```

## Features

- **Declarative Catalog**: Manage your billing structure as code.
- **Idempotent Sync**: Safely push changes without duplicating resources.
- **Validation**: Catch configuration errors before they hit production.
- **Cloud Synchronization**: Keep your local and cloud environments in sync.

## Documentation

For full command references and guides, visit [docs.owostack.com/cli](https://docs.owostack.com/cli).

## License

Apache-2.0
