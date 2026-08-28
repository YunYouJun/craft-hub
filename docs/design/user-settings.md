# Global user settings

Craft Hub treats settings as portable user preferences, not as project metadata or security state.

## Ownership and precedence

The runtime is the single settings authority. It stores `settings.json` in the existing operating-system Craft Hub data directory and serves the same state to the CLI, browser UI, and Electron shell.

The configuration precedence is:

1. built-in defaults
2. explicit global user settings
3. allowed project defaults from `.craft-hub/project.jsonc`
4. parameters supplied for one operation

The core settings registry includes `workbench.locale` and `workbench.theme`. Project defaults do not overlap these keys, and the ownership boundary prevents a future project file from overriding arbitrary user preferences.

Project registration, trust authorization, run history, credentials, usernames, and machine paths are state rather than settings. Settings import and export cannot modify or include them.

## File model

The editable file is strict, flat JSON with dot-separated keys and a generated offline schema:

```json
{
  "$schema": "./settings.schema.json",
  "workbench.locale": "zh-CN",
  "workbench.theme": "system"
}
```

Known core settings are validated with Zod 4. Unknown core keys are errors. Names under `extensions.<extension-id>.*` are preserved but inactive, reserving a compatible namespace without committing to a third-party registration ABI.

The file contains only explicit values. Effective defaults are applied in memory. A content-derived revision supports optimistic concurrency across UI, CLI, and manual edits. Writes are serialized and use a temporary file plus atomic rename.

External edits are watched. Valid live changes produce a `settings-change` SSE event; invalid files remain untouched while clients continue using the last valid snapshot and receive a diagnostic.

## Import and export

Exports use a versioned envelope separate from the editable file. A minimal export contains explicit values; a full export contains all effective, non-sensitive values. Both include the export mode, format version, application version, and timestamp.

Import defaults to merging. Replace import first creates a recoverable backup, retaining the five newest backups. Both modes are parsed, validated, and previewed as a diff before the user confirms an atomic write.

## Client flow

The local API provides settings reads, revisioned patches, export, import preview, import apply, and the editor schema. The existing SSE connection carries changes and re-fetches settings after reconnecting to cover missed events.

The Web UI migrates the legacy `craft-hub-locale` local-storage value only when `workbench.locale` is not explicitly set, then removes the legacy key. It does not maintain a second settings copy.
