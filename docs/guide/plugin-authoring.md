---
title: Author a Marketplace Plugin
description: Create, validate, pack, and locally test a declarative Craft Hub Marketplace Plugin.
---

# Author a Marketplace Plugin

Craft Hub Marketplace Plugins are data-only npm packages. Craft Hub reads `package.json#craftHub`, validates every contribution, and never imports package JavaScript. Use a Host Plugin instead only when an embedding application must load trusted executable code.

The [plugin marketplace contract](./plugin-marketplace.md) defines every Manifest and Catalog field. The runtime's exported `pluginManifestV1Schema` remains the source of truth while the API is in alpha.

## Create a package

Interactive initialization asks for the package identity, display name, license, and contribution types:

```bash
craft-hub plugin:init ./my-plugin
```

Agents and CI should use the deterministic form:

```bash
craft-hub plugin:init ./my-plugin \
  --non-interactive \
  --package @example/craft-hub-plugin-tools \
  --display-name "Example tools" \
  --license MIT \
  --with-command \
  --with-skill \
  --with-project-template
```

The target directory must be absent or empty. Initialization never overwrites existing content. Package names must use a scoped `craft-hub-plugin-*` or `plugin-*` name. Identity and licensing values must be supplied by the author rather than inferred from Git or npm credentials.

The first authoring workflow scaffolds three contribution types:

- `commands`: structured `command` plus `args`; shell interpolation is unavailable and Project Trust is still required before execution.
- `skills`: package-relative Agent Skill files with a stable `id`. New plugins should declare it explicitly; legacy v1 entries without an ID retain their path-derived identifier. They are installed once and activated per project; an optional bounded `activation` expression enables automatic matching.
- `projectTemplates`: package-relative template directories.

Edit the generated placeholders before publishing. Add advanced contribution types directly against the Marketplace contract until they gain dedicated scaffolds.

### Declare Skill activation

A Skill without `activation` is manual-only. This is the recommended default for general-purpose Skills. For a framework- or tool-specific Skill, declare the project facts that make it relevant:

```json
{
  "id": "widget-assistant",
  "path": "skills/widget-assistant/SKILL.md",
  "activation": {
    "all": [
      { "dependency": "@example/widget" },
      { "any": [{ "file": "widget.config.ts" }, { "file": "widget.config.js" }] }
    ]
  }
}
```

Matchers support `file`, `dependency`, `packageManager`, `all`, `any`, and `not`. They are evaluated only at the project root and pnpm packages already discovered by Craft Hub. Automatic matching requires the plugin's `read-project-files` permission. It remains read-only and never executes plugin or project code.

### Add native work-item status transitions

A Host Plugin may implement `workItems.transitions` and `workItems.updateStatus`, while a Marketplace Plugin declares matching `work-items.transitions` and `work-items.update-status` actions. When the same integration renders entities from `work-items.get`, `work-items.search`, or `work-items.list`, Craft Hub adds the generic status control automatically.

The renderer sends the entity's scalar `metadata` back with its `itemId`, title, and current status. The transition result supplies the provider-native target statuses and any required field names. Every update remains a `remote-write`: Craft Hub shows a confirmation dialog, rejects an unconfirmed invocation, and exposes the reviewed decision to the trusted Provider as `context.confirmed`.

## Validate

Validation is read-only:

```bash
craft-hub plugin:validate ./my-plugin
```

It checks npm identity and versioning, the current Manifest Schema, permission relationships, package-relative paths, forbidden runtime dependencies and lifecycle install scripts, minimum Craft Hub compatibility, and the files that npm would include in the tarball. The command runs `npm pack --dry-run --ignore-scripts`; plugin scripts are not executed.

## Test locally

First validate the package. Then review its absolute path before explicitly linking it:

```bash
craft-hub plugin:link /absolute/path/to/my-plugin
craft-hub plugin:refresh @example/craft-hub-plugin-tools
```

The link persists in the operating-system Craft Hub data directory and overrides an installed Marketplace version with the same package name. Remove the override when testing is complete:

```bash
craft-hub plugin:unlink @example/craft-hub-plugin-tools
```

## Pack and prepare a Catalog Entry

Publisher identity must be explicit:

```bash
craft-hub plugin:pack ./my-plugin --publisher example
```

After validation, Craft Hub packs with scripts disabled, computes the actual SHA-512 integrity, and writes the tarball plus a validated Catalog Entry draft to `dist/`. Existing artifacts are never overwritten. The command prints absolute paths for review; it does not publish npm packages or modify a Plugin Catalog.

The Catalog maintainer remains responsible for reviewing Publisher identity, categories, compatibility, permissions, and the immutable version before merging the entry into a source. Publishing and Catalog signing stay outside this authoring command.

## Working example

[`examples/marketplace-plugin`](https://github.com/YunYouJun/craft-hub/tree/main/examples/marketplace-plugin) is the executable reference package used by repository tests. Keep authored packages free of runtime dependencies, optional dependencies, and npm install lifecycle scripts.
