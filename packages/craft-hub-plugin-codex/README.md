# craft-hub-plugin-codex

Codex configuration inspector and scoped enable controls for Craft Hub. This is a trusted **Host Plugin**, not a Codex plugin and not a data-only Marketplace Plugin.

The desktop shell includes this adapter. Open **Codex** in the workbench rail; select a project to inspect its configuration or use the global view without a project. Refresh fetches a new snapshot.

For a browser-hosted workbench, explicitly load the built module:

```sh
pnpm build
pnpm --filter craft-hub start ui --host-plugin /absolute/path/to/craft-hub/packages/craft-hub-plugin-codex/dist/index.mjs
```

Embedding hosts can import the default export from `@craft-hub/craft-hub-plugin-codex` and add it to `CraftHubRuntime({ plugins: [...] })`.

## What it shows

- Installed plugin identity and local version (falling back to advertised version when unavailable).
- Global configuration, project overrides, and the source of the effective setting.
- Project configuration ignored by Codex, including trust restrictions.
- Catalog errors and configured plugins absent from the installed catalog.

The adapter starts the local `codex app-server --stdio`, initializes it, and calls `config/read` and `plugin/installed` (`plugin/list` only as a compatibility fallback when the installed endpoint is unavailable). Config resolution, parent layers and trust decisions belong to Codex. The process starts from the user's home, inherits `CODEX_HOME`, has a 20-second deadline and a 16 MiB response limit, and is closed after every request. The adapter does not launch tasks, run MCP tools, or install plugins. Catalog queries may use Codex's remote service and normal cache behavior.

Only plugin enable booleans, selected inventory fields and configuration source paths are returned to the browser. Raw configuration, authentication data and raw server diagnostics are not returned.

This is a snapshot of configuration for **new tasks**, not the state of an already-running task. “Configured enabled” is the plugin-level setting: per-skill exclusions, MCP settings, account access and managed policy can further restrict availability. Task-specific command-line overrides are not inspected. Requires a Codex version supporting the app-server configuration and plugin APIs; errors remain visible rather than being presented as an empty installed list.

Display strings follow the workbench English / Simplified Chinese locale. Configuration source links open the configured editor in the desktop app; browser mode uses an encoded `vscode://file` link. Desktop navigation re-queries the provider and resolves the selected entity/detail, rather than accepting an arbitrary file path from the renderer.

Installed catalog display fields are cached in memory for up to 60 seconds, separately for each project/global scope (up to eight recently used scopes). Concurrent catalog reads share one request; failed or incomplete catalogs are retried. Configuration is still read from Codex on every refresh and source navigation. The first visit to a scope can still wait for the remote catalog. No configuration snapshots or credentials are cached.

On initial load or scope changes, the view shows live configuration first, with installation explicitly marked as pending. The full installed snapshot replaces it when ready. Refreshing a populated view keeps its rows visible. Preview inputs are restricted to local-read actions.

## Enable controls

Select Global or a registered project, then use the row switch. Project rows also offer Follow parent settings, which removes only the selected project's `plugins.<id>.enabled` key. Parent project settings can still apply. Ignored project layers and unsupported/symlinked sources remain non-editable. Switches appear after the complete snapshot loads.

`configuration.update` declares `local-write` and requires an explicit confirmed invocation. The adapter validates the plugin against a fresh snapshot and chooses the file from the registered scope; renderer-provided paths are ignored. Codex's user-only TOML editing API runs in a temporary isolated home, preserving comments and unrelated settings before the target file is replaced. A file revision check rejects stale updates. Saving rereads local configuration and reuses the last loaded installation metadata, without a catalog query. Installation metadata is refreshed by listing, with a one-minute cache; toggling never extends that cache TTL. A scope whose cached metadata has been evicted must be refreshed before editing. Existing Codex tasks may need to be reopened to load changed plugins.
