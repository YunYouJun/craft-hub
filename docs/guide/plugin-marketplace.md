# Plugin marketplace

Craft Hub has two deliberately separate extension models:

- A **Host Plugin** is trusted code explicitly loaded by an embedding application. Loading it executes JavaScript.
- A **Marketplace Plugin** is a declarative package installed from a Plugin Catalog. Craft Hub reads `package.json#craftHub` without importing package code.

Codex plugins use another manifest and are not Craft Hub Marketplace Plugins.

For the supported scaffolding, validation, local-link, and packing workflow, see [Author a Marketplace Plugin](./plugin-authoring.md).

## Marketplace sources

A Distribution may provide `builtin` or `managed` Marketplace Sources. Users may also preview and add HTTPS `user` sources. Each source resolves to one versioned Plugin Catalog and may select an npm registry.

Catalog URLs and redirects must use HTTPS without embedded credentials. Craft Hub limits Catalog responses to 1 MiB, requires a JSON content type, and validates the complete document before it changes local state.

Source ownership and Publisher Verification are independent. A source imported by a user remains removable even when its Publisher is verified; only a Distribution can provide a `managed` source.

## Publisher Verification

A host may provision URL-pinned Ed25519 Trust Policies through `distribution.marketplaceTrustPolicies`. The policy is trusted configuration and must not come from a Desktop Link or marketplace import request:

```json
{
  "id": "example-catalog-2026",
  "organization": "Example Enterprise",
  "catalogUrl": "https://plugins.example.com/catalog.json",
  "signatureUrl": "https://plugins.example.com/catalog.json.sig",
  "algorithm": "ed25519",
  "publicKeySpki": "BASE64URL_DER_SUBJECT_PUBLIC_KEY_INFO"
}
```

The Catalog publisher signs the exact `catalog.json` response bytes. It may return the base64url signature in `x-craft-hub-signature` with its policy ID in `x-craft-hub-key-id`, or publish a static sidecar at `catalog.json.sig`:

```json
{
  "schemaVersion": 1,
  "keyId": "example-catalog-2026",
  "signature": "BASE64URL_ED25519_SIGNATURE"
}
```

For a URL covered by a Trust Policy, Craft Hub fails closed when the signature is missing, uses a different key, or does not match the fetched bytes. URLs without a provisioned policy remain ordinary user-added sources. The private signing key belongs in the publisher's deployment secret store and never in Craft Hub configuration or an import link.

## Manifest contract

A Marketplace Plugin publishes a version-one declaration under `package.json#craftHub`:

```json
{
  "schemaVersion": 1,
  "id": "@acme/craft-hub-plugin-example",
  "displayName": "Example tools",
  "description": "Adds declarative project commands.",
  "slug": "example-tools",
  "links": {
    "documentation": "https://docs.example.com/plugins/example-tools",
    "repository": "https://github.com/acme/example-tools",
    "feedback": "https://github.com/acme/example-tools/issues"
  },
  "maintainers": [
    { "name": "Example team", "url": "https://example.com/team" }
  ],
  "permissionReasons": {
    "commands": "Runs the commands declared by this package."
  },
  "localizations": {
    "zh-CN": {
      "displayName": "示例工具",
      "description": "提供声明式项目命令。",
      "permissionReasons": {
        "commands": "运行此包声明的命令。"
      }
    }
  },
  "craftHub": { "minVersion": "0.0.1-alpha.0" },
  "includesPlugins": [
    { "package": "@acme/craft-hub-plugin-toolkit", "version": "^1.0.0" }
  ],
  "requiresPlugins": [
    { "package": "@acme/craft-hub-plugin-shared", "version": "^1.0.0" }
  ],
  "projectFiles": [],
  "permissions": ["commands"],
  "contributes": {
    "commands": [],
    "commandPresets": [],
    "commandTemplates": [],
    "packageQuickActions": [],
    "packageLinks": [],
    "skills": [],
    "projectTemplates": [],
    "integrations": []
  }
}
```

`slug`, `links`, `icon`, `maintainers`, `permissionReasons`, and `localizations` are additive discovery metadata. A maintainer may use a stable Distribution-defined `handle`, an HTTPS profile URL, or both. Permission-reason keys must name declared permissions.

`includesPlugins` declares an Extension Pack: the listed Marketplace Plugins are installed from the same source in one reviewed operation, then remain independently manageable. Removing the pack does not remove its included plugins.

`requiresPlugins` declares hard plugin dependencies from the same source. Each relation uses a package name and SemVer range. A package cannot be self-referenced, duplicated, or present in both lists; npm `dependencies` remain forbidden.

`packageQuickActions` lets a declarative plugin recognize workspace packages by bounded file markers and place discovered capabilities in that package's overview. A selector may be a capability ID, an unambiguous capability name, or `source:name`. This makes cross-plugin composition possible: if the referenced skill or command is not discovered, the action is omitted and the package keeps its normal command shortcuts. Package matching requires the `read-project-files` permission.

```json
{
  "id": "widget-actions",
  "package": {
    "allFiles": ["package.json"],
    "anyFiles": ["widget.config.ts", "widget.config.js"]
  },
  "capabilities": ["codex-skill:Widget assistant", "dev", "build"]
}
```

`packageLinks` places a user-initiated HTTPS destination beside those actions. The plugin declares bounded package-relative config files and a property key; Craft Hub reads only a quoted string literal (up to 256 characters) from a regular file no larger than 64 KiB, resolves symlinks before enforcing the package boundary, URL-encodes the value, and substitutes it into the single `{value}` placeholder. Computed values are ignored. Package links also require `read-project-files`.

```json
{
  "id": "widget-console",
  "title": { "default": "Widget console", "zh-CN": "组件控制台" },
  "package": {
    "allFiles": ["package.json"],
    "anyFiles": ["widget.config.ts", "widget.config.js"]
  },
  "urlTemplate": "https://widgets.example.com/console/{value}",
  "value": {
    "files": ["widget.config.ts", "widget.config.js"],
    "key": "appId"
  }
}
```

Command presets may extend a `select` input through `optionSources`. A `package-json-array` source reads a bounded JSON array from the matching package and requires `read-project-files`. A `user-setting` source reads one exact `extensions.<plugin>.<setting>` key and requires the separately disclosed `read-user-settings` permission. Static options remain first, duplicate values are removed, malformed or missing sources are ignored, and neither source executes project code.

Command templates and presets use the same input protocol as project configuration. A `text` or
`select` input may set `argumentStyle` to `positional` and omit `flag`; Craft Hub then appends its
validated value as one argv entry in declaration order. This remains structured execution and never
enables shell interpolation.

```json
{
  "inputs": {
    "account": {
      "type": "select",
      "flag": "--account",
      "default": "default",
      "options": [{ "value": "default", "omitArgument": true }]
    }
  },
  "optionSources": {
    "account": {
      "type": "user-setting",
      "key": "extensions.example-widget.accounts"
    }
  }
}
```

## Catalog contract

A Plugin Catalog lists immutable package versions. Every entry includes the exact package, version, SHA-512 SRI integrity, Publisher, permission set, categories, and lifecycle status. It may copy discovery metadata from the package Manifest and add:

- `requires`: a SemVer range for compatible Craft Hub versions.
- `status`: `active`, `deprecated`, or `blocked`.
- `statusReason`: required for deprecated and blocked versions.
- `replacement`: an optional Marketplace Plugin package recommended instead.
- `includesPlugins`: the Extension Pack member list copied from the Manifest.
- `requiresPlugins`: the package dependency list copied from the Manifest.

Catalog permission reasons, permissions, and plugin dependencies must match the installed package Manifest. Craft Hub refuses installation when integrity, identity, permissions, permission reasons, plugin dependencies, or the compatible version range does not match.

## Lifecycle

- **active**: recommended and installable.
- **deprecated**: still installable, but consumers receive migration guidance from `statusReason` and `replacement`.
- **blocked**: cannot be installed and is deactivated when that exact installed version remains listed as blocked.

Catalog maintainers should retain blocked version entries so clients can enforce precise revocation.

## Local plugins

Craft Hub can load the same declarative package format directly from an absolute local directory in both development and production builds. Use the **Installed → Load local plugin** form, or run `craft-hub plugin:link /absolute/path/to/plugin`. A linked plugin is marked **Local**, persists across restarts, and overrides a same-name Marketplace installation without modifying it. Manifest edits are picked up when the plugin list or capabilities refresh; `craft-hub plugin:refresh <package>` forces a refresh. Use `craft-hub plugin:unlink <package>` to remove the override and restore any installed Marketplace version.

Local linking is an explicit trust action and does not provide Catalog integrity or publisher verification. Package identity, manifest schema, minimum Craft Hub version, file containment, lifecycle-script, and runtime-dependency restrictions are still validated. Invalid local changes keep the plugin visible with an error and prevent its contributions from activating until repaired.

## Installation safety

Before confirmation, Craft Hub recursively resolves the root plugin and its same-source included and required plugin closure, rejects missing versions, incompatible Craft Hub versions, conflicting constraints, blocked packages, and cycles, and returns a dependency-first install plan with combined permissions. One confirmed request installs new members and dependencies, re-enables compatible disabled plugins, and leaves already-active versions unchanged. After installation, Extension Pack members can be enabled, disabled, updated, or removed independently.

When the local server starts, Craft Hub refreshes Marketplace Sources used by enabled installed plugins and automatically installs the newest active, compatible version when every package in the resulting plan is already installed from the same source with exactly the same permissions. The previous version remains available for rollback. Updates that add permissions or introduce a new dependency are never approved automatically; the Marketplace shows them as manual updates so the complete plan and combined permissions can be reviewed first. The same safe update check is available through `GET /api/plugins/updates` and can be applied with `POST /api/plugins/updates`.

Craft Hub installs immutable npm versions with lifecycle scripts disabled and without development dependencies. Declarative packages cannot declare runtime or optional npm dependencies, and contributed file paths must remain inside the package. Plugin installation and Project Trust remain independent: commands discovered from an installed plugin still require explicit trust for the selected Project.
