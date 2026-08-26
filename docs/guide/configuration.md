# Project configuration

Configuration is optional. Add `.craft-hub/project.yaml` only when a repository needs metadata or wants to hide discovered capabilities.

```yaml
version: 1
project:
  name: Craft Hub
  icon: ./icon.svg
  color: purple
defaults:
  agent: codex
capabilities:
  hidden: []
  descriptions:
    package.json:dev:
      default: Start the local development environment.
      zh-CN: 启动本地开发环境。
```

## MCP initialization

Agents may initialize the optional file with the MCP `init_project_config` tool. `preview` returns the exact proposed YAML and a content revision without writing. `apply` requires the project to be trusted and the unchanged revision returned by preview.

Initialization only creates a missing `.craft-hub/project.yaml`. If the file already exists, Craft Hub returns its current content and leaves it byte-for-byte unchanged, including comments and downstream fields.

Hidden entries may be a capability name, capability id, or a source-qualified name such as `package.json:release`.

## Portable workspaces

Cross-project relationships belong to the user rather than to any member repository. Craft Hub stores one versioned manifest per workspace in `~/.craft-hub/workspaces/`; `CRAFT_HUB_CONFIG_DIR` overrides this portable configuration directory.

```yaml
schemaVersion: 1
id: craft-hub
name: Craft Hub
primaryProject: craft-hub
members:
  - project: craft-hub
    pinned: true
  - project: dotfiles
```

The member keys, order, pins, and primary project are portable and suitable for a private dotfiles repository. Absolute paths, trust, local bindings, active selection, run history, credentials, and Codex thread IDs remain in the operating-system data directory and must not be synced. On a new device unresolved members stay visible until they are bound to a local registered project; binding never transfers trust.

Project icons may use a repository-relative SVG or PNG path, `emoji:<character>`, or one of the built-ins `builtin:folder`, `builtin:hub`, `builtin:skill`, and `builtin:terminal`. File paths are resolved inside the project directory; invalid or escaping paths fall back to the folder icon and produce a non-blocking warning. `color` is optional and accepts `blue`, `cyan`, `green`, `orange`, `pink`, `purple`, `red`, or `yellow`. Accent colors identify projects without changing trust or execution status colors.

Descriptions use the same keys and are shown below command names in the capability list. A description may be a legacy string or a locale map using BCP 47 language tags. Craft Hub tries the active locale, its parent tags, and `default` in that order. Source-qualified keys are recommended when commands from different sources share a name.

## Global user settings

User preferences are separate from project configuration. Craft Hub stores strict JSON in the operating-system data directory:

- macOS: `~/Library/Application Support/Craft Hub/settings.json`
- Windows: `%APPDATA%/Craft Hub/settings.json`
- Linux: `$XDG_DATA_HOME/craft-hub/settings.json`, or `~/.local/share/craft-hub/settings.json`

`CRAFT_HUB_DATA_DIR` overrides the data directory. The generated `settings.schema.json` sits beside the settings file, so editors can validate the file offline.

```json
{
  "$schema": "./settings.schema.json",
  "workbench.locale": "en",
  "workbench.theme": "system"
}
```

The Settings dialog can open this file in the desktop app and import or export portable JSON. Minimal exports include explicitly changed values; full snapshots include every effective, non-sensitive setting. Project trust, registered projects, run history, usernames, and machine paths are never exported. Replace imports create a backup and retain the five most recent backups.

Pinned commands and skills are direct, machine-local workbench state. Their mixed order is stored in `workspace-state.json` beside the other Craft Hub data and is intentionally excluded from settings import and export.

Run logs are machine-local and may contain commands, paths, or terminal output. Unpinned completed runs are retained for 30 days with a 500 MB total limit. Persisted output is capped at 10 MB per run; active and pinned records are excluded from automatic cleanup.

The CLI exposes the same runtime behavior:

```sh
craft-hub settings:get
craft-hub settings:set workbench.locale zh-CN
craft-hub settings:set workbench.theme dark
craft-hub settings:export settings.json --mode minimal
craft-hub settings:import settings.json --dry-run --json
craft-hub settings:import settings.json --replace
```

Unknown core keys are rejected to catch typos. Keys under `extensions.<extension-id>.*` are preserved for forward compatibility but remain inactive until extension setting registration is supported.
