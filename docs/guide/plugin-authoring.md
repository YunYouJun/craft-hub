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
- `skills`: package-relative Agent Skill files.
- `projectTemplates`: package-relative template directories.

Edit the generated placeholders before publishing. Add advanced contribution types directly against the Marketplace contract until they gain dedicated scaffolds.

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
