# Development environment configuration

The trusted Host Plugin `@craft-hub/craft-hub-plugin-workstation` adds **开发环境** (Development environment) to Craft Hub. The desktop includes this adapter; browsers use the same local service. A hosted runtime rejects device configuration operations.

## Start locally

Build a workstation checkout with its v1 configuration API, then build Craft Hub. Configure the executable on the host, never through a browser-supplied command:

```sh
# In workstation
pnpm build
# In Craft Hub
pnpm build
export CRAFT_HUB_WORKSTATION_COMMAND=/absolute/path/to/workstation/packages/cli/dist/cli.js
pnpm --filter craft-hub exec tsx src/cli.ts ui \
  --host-plugin /absolute/path/to/craft-hub/packages/craft-hub-plugin-workstation/dist/index.mjs
```

For the desktop, set the same environment variable before starting the desktop process. The adapter is bundled; the workstation CLI remains the separate, versioned backend. The `workstation` executable on PATH is used when no override is set. An older CLI without the JSON API produces an explicit connection error.

The backend uses workstation's existing public source and connected private manifest. `DOTFILES_REPO_ROOT`, `WORKSTATION_PRIVATE_MANIFEST`, `DOTFILES_HOME` and `CODEX_HOME` retain their normal meanings. Connect a private repository using the existing `workstation private connect` workflow. Credentials remain in the existing secret store or on the device.

## Review and apply

1. Open **开发环境**. Filter MCP, skills, global instructions or terminal configuration.
2. Select an item to inspect its origin, ownership, source path, local path and redacted difference. First adoption has no historical baseline. Installed/system skills and project overrides are shown separately and cannot be overwritten by global synchronization.
3. Choose **Keep local** (updates repository source), **Use source** (updates device file), **Merge** (explicit choices for every changed field or aligned text line, updates both), or **Defer**.
4. Preview the selected changes. Check each path, direction and deletion. Previewing stores a local protected plan; it does not change configuration or Git.
5. Apply the reviewed plan. Workstation rejects changed file versions and ownership manifests, backs up contents outside Git and validates safe writes. Source writes require a successful secret scan.
6. Open application/recovery history after any failure. Restore only if the files still match the plan's outputs; newer independent edits block recovery. A failed or interrupted multi-file operation remains visible with its journal.

Unmanaged user skills appear in inventory. Connect their **local** directory sources through the existing private manifest's `skills.install` entries to enable synchronization. Only configuration data belongs in the private checkout. Symlinks, hidden/system roots, Codex plugin cache and installer lock entries continue to use their original installer.

## Git is a separate workflow

Review uncommitted files, unpushed commits, remote-leading counts and divergence. Counts reflect the last fetch; an absent upstream is shown as unknown. Fetch updates only the source checkout. To commit, select the declared managed files and enter a message, review, then explicitly confirm. Existing staged changes block commits. Review outgoing commit IDs and changed-line counts before publishing. Publication uses workstation's existing scan and non-forced push; divergence and remote-leading branches must be resolved first.

## Limits and recovery

Literal prose and unknown values are intentionally withheld, including in text comparisons. Safe MCP command names, enable flags, timeouts, credential-free URL hosts and secret references can be shown. `!` marks a differing aligned line and `=` a matching line. Hidden content is never treated as replacement text. Use a device-local editor for detailed confidential prose review.

MCP merge uses explicit field choices. Text merge uses explicit aligned line positions; it is not a semantic or inferred three-way merge. Syntax checks cover TOML and Zsh, while generic skills and Ghostty need user review. A missing entire declared MCP fragment is a scan error; individual server/file deletion is supported. Binary, oversized, linked and special files are blocked. Automatic installer updates, backup pruning, remote history conflict resolution and upstream setup remain outside this interface.

Multi-file writes are journaled and recoverable, not one OS transaction. Workstation locks coordinate its own processes; external editors are checked again immediately before replacement. After a crash, confirm the process has exited before manually removing a reported stale lock. Local journals can contain secrets and stay in the mode-protected workstation state directory.

This implementation was isolated from unrelated uncommitted host changes. Integrating it with a newer in-progress resource-page/Codex configuration API may require reconciling the generic integration contract. Do not replace those changes wholesale.

The integrated page uses the community host’s shared workbench header, controls and theme tokens. Downstream distributions consume the same renderer. The configuration management adapter coexists with the entity-based Codex inspector; hosted deployments deny both local configuration surfaces.
