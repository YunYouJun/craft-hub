# Project configuration

Configuration is optional. Add `.craft-hub/project.jsonc` only when a repository needs metadata or wants to hide discovered capabilities. JSONC accepts strict JSON while allowing comments and trailing commas, which keeps generated output deterministic and hand edits readable.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/project-v1.schema.json",
  "version": 1,
  "project": {
    "name": "Craft Hub",
    "icon": "./icon.svg",
    "color": "purple"
  },
  "defaults": {
    "agent": "codex"
  },
  "capabilities": {
    "hidden": [],
    "descriptions": {
      "package.json:dev": {
        "default": "Start the local development environment.",
        "zh-CN": "启动本地开发环境。"
      }
    }
  },
  "packages": {
    "apps/web": {
      "description": {
        "default": "Craft Hub web workbench.",
        "zh-CN": "Craft Hub Web 工作台。"
      }
    }
  }
}
```

## Format and schema

JSONC is the only project configuration format. It keeps JSON's explicit data model and mature editor tooling while allowing comments and trailing commas. YAML is not accepted for project metadata; YAML would still require a JSON Schema for completion and validation, while adding a second parser and a less predictable programmatic-editing surface.

The Zod v4 `projectConfigSchema` is the single source of truth. Craft Hub uses it directly for offline runtime validation, infers the public TypeScript types with `z.infer`, and generates the checked-in Draft 2020-12 schema at `packages/craft-hub/schema/project-v1.schema.json`. Run `pnpm schema:project` after changing the Zod model; `pnpm schema:project:check` rejects generated-schema drift.

The versioned GitHub Raw URL is the public identity used by editors and third-party tools until Craft Hub has a dedicated schema domain. The npm package also ships the same file at `craft-hub/schema/project-v1.schema.json`; Craft Hub runtime validation never downloads the public URL.

Core objects reject unknown fields so typos fail early. Third-party data belongs under `extensions.<provider>` and remains opaque to Craft Hub:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/project-v1.schema.json",
  "version": 1,
  "extensions": {
    "com.example.release": {
      "channel": "preview"
    }
  }
}
```

The file must contain an explicit `version`. Adding optional fields does not change the version; breaking structure or semantics requires a new versioned schema and a deterministic migration. Craft Hub updates JSONC through minimal AST edits and atomically replaces the file, preserving comments, formatting, extension data, and unrelated fields that are valid under the schema.

Project configuration is normally committed to Git. Never store tokens, passwords, credentials, machine paths, or other secrets in it; declare required environment-variable names or provider references instead.

## Invalid configuration

An invalid or unreadable project configuration does not remove the registered project or block other projects from loading. Craft Hub keeps the project's existing machine-local name, trust, and ordering, then shows a project-scoped diagnostic with the file location and validation message. The desktop action opens `.craft-hub/project.jsonc` at the reported line in the configured editor.

Craft Hub never repairs or overwrites an invalid file automatically. Correct it in the editor and refresh; the diagnostic disappears after the file validates. A successful empty Project Catalog and a failed catalog request are distinct states, so a runtime error is shown explicitly instead of appearing as a new empty installation.

## MCP initialization

Agents may initialize the optional file with the MCP `init_project_config` tool. `preview` returns the exact proposed JSONC and a content revision without writing. `apply` requires Craft Hub execution authorization for the project and the unchanged revision returned by preview.

Initialization only creates a missing `.craft-hub/project.jsonc`. The generated `$schema` URL enables editor completion and validation. If the file already exists, Craft Hub validates and returns its current content without rewriting it.

Hidden entries may be a capability name, capability id, or a source-qualified name such as `package.json:release`.

Package metadata uses the project-relative package directory as its stable key; the root package is `.`. A configured package description overrides a missing or less useful `package.json` description in Craft Hub without modifying the package manifest.

The “Improve project descriptions” workflow audits gaps locally, then runs Codex read-only to produce structured command and package suggestions. Craft Hub changes no repository files until the user reviews the suggestions; applying them updates only the active project configuration and rejects stale proposals.

## Parameterized commands

Use `capabilities.inputs` to add form fields to a discovered command. Craft Hub renders `select`
inputs as dropdowns, `text` inputs as text fields, and `boolean` inputs as checkboxes. The runtime
validates every value and appends it as an individual argv entry instead of constructing a shell
string. Enabled boolean inputs append the flag without a value; disabled inputs append nothing.

```jsonc
{
  "capabilities": {
    "inputs": {
      "apps/widget/package.json:deploy": {
        "environment": {
          "type": "select",
          "label": "Environment",
          "options": ["dev", "staging"],
          "default": "dev",
          "flag": "--env"
        },
        "account": {
          "type": "text",
          "label": "Account",
          "pattern": "^\\d+$",
          "flag": "--account",
          "visibleWhen": { "input": "environment", "equals": "dev" },
          "requiredWhen": { "input": "environment", "equals": "dev" }
        },
        "silent": {
          "type": "boolean",
          "label": "Update without opening the page",
          "flag": "--silent"
        }
      }
    }
  }
}
```

`argumentStyle` accepts `equals` (the default, producing `--env=dev`) or `separate` (producing
`--env dev`). Select inputs require `options`; text inputs may use `pattern`; boolean inputs accept
an optional string default of `"true"` or `"false"`. Every input type accepts `default`: a select
default must match an option, a text default may be any string, and a boolean default must be
`"true"` or `"false"`. Craft Hub applies defaults to the initial form and command preview.
`visibleWhen` and `requiredWhen` provide
conditional form behavior and are enforced again by the runtime. A condition may be one object or
an array whose entries must all match. An object option may set `omitArgument: true` to remain
selectable while intentionally appending no flag, for example a “current developer” choice that
lets the underlying CLI use its authenticated user.

## Release operations

A root `release` package script is automatically treated as a guarded release operation. Use
`capabilities.operations` to attach repository policy and publication automation metadata:

```jsonc
{
  "capabilities": {
    "operations": {
      "package.json:release": {
        "kind": "release",
        "requiresCleanGit": true,
        "requiredBranch": "main",
        "workflowPath": ".github/workflows/release.yml",
        "versionInput": "release",
        "customVersionInput": "customVersion",
        "prereleaseIdInput": "prereleaseId"
      }
    }
  }
}
```

Craft Hub shows a release plan with the current version, proposed tag, branch, worktree state, and
workflow effects. Release execution requires a separate confirmation, and the runtime repeats the
preflight immediately before running the command. Provider-specific status and release triggers can
be contributed by plugins without replacing the host-owned safety checks.
When the optional input names are configured, the plan resolves `major`, `minor`, `patch`,
`prerelease`, and an exact SemVer into the target version and tag. The inputs remain ordinary safe
command inputs, so the previewed invocation and executed invocation cannot diverge.

## Skill inputs

Use `capabilities.skillInputs` to declare interactive parameters for a discovered Agent Skill. Fields support
the same `select`, `text`, localized labels, defaults, and conditional visibility as command inputs, but do not
accept `flag` or `argumentStyle`. Skill inputs do not generate command-line arguments; Craft Hub validates them
and adds them as structured data to the Codex App or Craft Hub background task request.

```jsonc
{
  "capabilities": {
    "skillInputs": {
      "agent-skill:wetools-release": {
        "app": {
          "type": "select",
          "label": "Application",
          "options": [
            { "value": "task-center", "label": "Task Center" },
            { "value": "todo", "label": "Todo" }
          ],
          "default": "task-center",
          "required": true
        },
        "version": {
          "type": "select",
          "label": "Version type",
          "options": ["patch", "minor"],
          "default": "patch"
        }
      }
    }
  }
}
```

A Skill may be addressed by capability ID, name, or `source:name`. Prefer a stable source-qualified key such as
`agent-skill:<name>` to avoid ambiguity. The UI renders `select` inputs as dropdowns and sends the validated
selection alongside the user's free-form request. Configuration may describe data and allowed values, but must
not contain credentials or additional executable commands.

## Portable workspaces

Cross-project relationships belong to the user rather than to any member repository. Craft Hub stores one versioned manifest per workspace in `~/.craft-hub/workspaces/`; `CRAFT_HUB_CONFIG_DIR` overrides this portable configuration directory.

Every workspace and workspace group has exactly one Owner Scope. Legacy manifests without `ownerScopeId` belong to the fixed `Personal` scope. A Team manifest records its stable Team id, for example `ownerScopeId: acme`. The Team identity is independent from its Git checkout so the repository can move without changing ownership.

The workbench switches Owner Scopes as navigation state: each scope has an isolated workspace tree, project-reference bindings, standalone-project grouping, and remembered workspace selection. Registered project directories, trust, runs, and credentials remain machine-local. Team views show only projects referenced by that Team; unassigned local projects remain in Personal. The command palette can search across scopes and jumps to the selected scope before opening its workspace.

Creating a Team requires an existing local Git checkout. Craft Hub writes the Team snapshot beneath `.craft-hub/teams/<team-id>/` by default, but never fetches, commits, pushes, or stores Git credentials. Switching scopes reads local state immediately; synchronization is explicit and conflicts require choosing the local or repository snapshot.

Renaming a Team keeps its stable id and Git target, then marks the local snapshot as changed for the next explicit synchronization. Deleting a Team requires typing its exact name; Craft Hub removes that Team's local workspaces, bindings, navigation state, and sync target, switches an active deleted Team back to Personal, and leaves the shared Git snapshot untouched so it remains recoverable.

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

The member keys, order, pins, and primary project are portable and suitable for a private dotfiles repository. Absolute paths, Craft Hub execution authorizations, local bindings, active selection, run history, credentials, and Codex thread IDs remain in the operating-system data directory and must not be synced. On a new device unresolved members stay visible until they are bound to a local registered project; binding never transfers execution authorization.

Project icons may use a repository-relative SVG or PNG path, `emoji:<character>`, or one of the built-ins `builtin:folder`, `builtin:hub`, `builtin:skill`, and `builtin:terminal`. File paths are resolved inside the project directory; invalid or escaping paths fall back to the folder icon and produce a non-blocking warning. `color` is optional and accepts `blue`, `cyan`, `green`, `orange`, `pink`, `purple`, `red`, or `yellow`. Accent colors identify projects without changing execution-authorization or run-status colors.

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
  "workbench.codex": {
    "model": "gpt-5.6-sol",
    "reasoningEffort": "high"
  },
  "workbench.editor": {
    "default": "custom",
    "custom": {
      "name": "Cursor",
      "command": "cursor",
      "args": ["--reuse-window", "{path}"]
    }
  },
  "workbench.locale": "en",
  "workbench.theme": "system"
}
```

`workbench.codex` supplies optional defaults for every Codex SDK task started by Craft Hub. Omit `model`, `reasoningEffort`, or the entire setting to inherit the user's Codex configuration from `~/.codex/config.toml`. The model is a free-form Codex model ID so Craft Hub does not freeze a versioned catalog. Supported explicit effort values in the bundled SDK are `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; actual availability still depends on the selected model and account.

The project and workspace toolbar share `workbench.editor`. Built-in values are `vscode` and `cursor`; a custom editor uses a direct command plus individual arguments. Custom arguments must include `{path}`. Craft Hub substitutes that placeholder and launches the command with `shell: false`.

The Settings dialog can open this file in the desktop app and import or export portable JSON. Minimal exports include explicitly changed values; full snapshots include every effective, non-sensitive setting. Craft Hub execution authorizations, registered projects, run history, usernames, and machine paths are never exported. Replace imports create a backup and retain the five most recent backups.

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
