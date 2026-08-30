# Plugin marketplace

Craft Hub has two deliberately separate extension models:

- A **Host Plugin** is trusted code explicitly loaded by an embedding application. Loading it executes JavaScript.
- A **Marketplace Plugin** is a declarative package installed from a Plugin Catalog. Craft Hub reads `package.json#craftHub` without importing package code.

Codex plugins use another manifest and are not Craft Hub Marketplace Plugins.

## Marketplace sources

A Distribution may provide `builtin` or `managed` Marketplace Sources. Users may also preview and add HTTPS `user` sources. Each source resolves to one versioned Plugin Catalog and may select an npm registry.

Catalog URLs and redirects must use HTTPS without embedded credentials. Craft Hub limits Catalog responses to 1 MiB, requires a JSON content type, and validates the complete document before it changes local state.

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
  "projectFiles": [],
  "permissions": ["commands"],
  "contributes": {
    "commands": [],
    "commandPresets": [],
    "commandTemplates": [],
    "skills": [],
    "projectTemplates": []
  }
}
```

`slug`, `links`, `icon`, `maintainers`, `permissionReasons`, and `localizations` are additive discovery metadata. A maintainer may use a stable Distribution-defined `handle`, an HTTPS profile URL, or both. Permission-reason keys must name declared permissions.

## Catalog contract

A Plugin Catalog lists immutable package versions. Every entry includes the exact package, version, SHA-512 SRI integrity, Publisher, permission set, categories, and lifecycle status. It may copy discovery metadata from the package Manifest and add:

- `requires`: a SemVer range for compatible Craft Hub versions.
- `status`: `active`, `deprecated`, or `blocked`.
- `statusReason`: required for deprecated and blocked versions.
- `replacement`: an optional Marketplace Plugin package recommended instead.

Catalog permission reasons and permissions must match the installed package Manifest. Craft Hub refuses installation when integrity, identity, permissions, permission reasons, or the compatible version range does not match.

## Lifecycle

- **active**: recommended and installable.
- **deprecated**: still installable, but consumers receive migration guidance from `statusReason` and `replacement`.
- **blocked**: cannot be installed and is deactivated when that exact installed version remains listed as blocked.

Catalog maintainers should retain blocked version entries so clients can enforce precise revocation.

## Installation safety

Craft Hub installs immutable npm versions with lifecycle scripts disabled and without development dependencies. Declarative packages cannot declare runtime or optional dependencies, and contributed file paths must remain inside the package. Plugin installation and Project Trust remain independent: commands discovered from an installed plugin still require explicit trust for the selected Project.
