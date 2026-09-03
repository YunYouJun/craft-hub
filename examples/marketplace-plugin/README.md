# Craft Hub Marketplace Plugin example

This package is a complete declarative plugin fixture. It contributes one structured command, one Agent Skill, and one project template without importing or executing plugin JavaScript.

From the repository root:

```bash
pnpm --filter craft-hub exec tsx src/cli.ts plugin:validate examples/marketplace-plugin
pnpm --filter craft-hub exec tsx src/cli.ts plugin:pack examples/marketplace-plugin --publisher example
```

Local linking changes Craft Hub user state, so review the absolute path before running:

```bash
pnpm --filter craft-hub exec tsx src/cli.ts plugin:link /absolute/path/to/examples/marketplace-plugin
pnpm --filter craft-hub exec tsx src/cli.ts plugin:unlink @example/craft-hub-plugin-starter
```
