# Workstation configuration Host Plugin

Package: `@craft-hub/craft-hub-plugin-workstation`; view: **开发环境**.

This trusted local adapter invokes the versioned workstation configuration API. It contains no configuration parsing, merging, backup, recovery or Git implementation. The desktop bundles it; a standalone browser service can explicitly load `dist/index.mjs` with `craft-hub ui --host-plugin`.

Build the matching workstation CLI first and set `CRAFT_HUB_WORKSTATION_COMMAND` to its executable when needed. The plugin cannot make an older workstation CLI support the new protocol. No npm publication or Marketplace linking is needed for the Host Plugin.

See the [English guide](../../docs/guide/workstation-configuration.md), [中文指南](../../docs/zh/guide/workstation-configuration.md), and [execution/acceptance log](../../docs/plans/workstation-configuration.md).
