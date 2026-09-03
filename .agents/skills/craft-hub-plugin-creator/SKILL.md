---
name: craft-hub-plugin-creator
description: Create, validate, locally test, or pack declarative Craft Hub Marketplace Plugins. Use for Craft Hub plugin scaffolding and Manifest authoring; Host Plugins and Codex plugins use different contracts.
---

# Craft Hub Marketplace Plugin creator

Use Craft Hub's CLI as the implementation and the repository runtime Schema as the contract. Read [`docs/guide/plugin-authoring.md`](../../../docs/guide/plugin-authoring.md) before creating a plugin. Read [`docs/guide/plugin-marketplace.md`](../../../docs/guide/plugin-marketplace.md) when the request uses advanced contribution, permission, dependency, or Catalog fields.

## Route the request

- **Create:** obtain an explicit scoped package name, display name, and license. Never infer identity, Publisher, or licensing from Git or npm state. Select any requested `commands`, `skills`, and `projectTemplates`, then call `craft-hub plugin:init` with `--non-interactive` and the corresponding `--with-*` options. The target must be absent or empty.
- **Validate or diagnose:** call `craft-hub plugin:validate <path>`. Report every failing invariant. Modify the package only when the user asked to create, fix, or update it; validation requests remain read-only.
- **Test locally:** validate first and resolve the plugin directory to an absolute path. Show that path and obtain explicit confirmation immediately before `craft-hub plugin:link`. State the matching `plugin:unlink <package>` recovery command. Refresh an existing confirmed link with `plugin:refresh` after edits.
- **Pack:** require an explicit Publisher, then call `craft-hub plugin:pack <path> --publisher <id>`. Review the emitted tarball path, SHA-512 integrity, and Catalog Entry draft. Leave npm publication, Catalog modification, and Catalog signing to a separately authorized workflow.

Inside this repository, invoke the source CLI with `pnpm --filter craft-hub exec tsx src/cli.ts <command>`. For an installed package, invoke `craft-hub <command>`.

## Completion

A created plugin is complete when `plugin:validate` succeeds and every requested contribution appears in its npm pack file list. A packed plugin is complete when both new artifacts exist in the selected output directory and the Catalog Entry integrity matches the actual tarball. Keep the generated placeholders visible to the user; they require domain-specific authoring before publication.
