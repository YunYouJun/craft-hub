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

For the desktop, set the same environment variable before starting the desktop process. The adapter is bundled; the workstation CLI remains the separate, versioned backend. Without an override, the adapter locates the `workstation` executable on PATH and common host locations, including pnpm and installed fnm Node directories on macOS. Lookup is lazy and does not execute shell initialization; the workbench can start when the CLI is missing. An older CLI without the JSON API produces an explicit connection error.

The backend uses workstation's existing public source and connected private manifest. `DOTFILES_REPO_ROOT`, `WORKSTATION_PRIVATE_MANIFEST`, `DOTFILES_HOME` and `CODEX_HOME` retain their normal meanings. Connect a private repository using the existing `workstation private connect` workflow. Credentials remain in the existing secret store or on the device.

## Review and apply

1. Open **开发环境**. Filter MCP, skills, global instructions or terminal configuration.
2. Select an item to inspect its origin, ownership, source path, local path and redacted difference. First adoption has no historical baseline. Installed/system skills and project overrides are shown separately and cannot be overwritten by global synchronization.
3. Choose **Keep local** (updates repository source), **Use source** (updates device file), **Merge** (explicit choices for every changed field or aligned text line, updates both), or **Defer**.
4. Preview the selected changes. Check each path, direction and deletion. Previewing stores a local protected plan; it does not change configuration or Git.
5. Apply the reviewed plan. Workstation rejects changed file versions and ownership manifests, backs up contents outside Git and validates safe writes. Source writes require a successful secret scan.
6. Open application/recovery history after any failure. Restore only if the files still match the plan's outputs; newer independent edits block recovery. A failed or interrupted multi-file operation remains visible with its journal.

Unmanaged user skills appear in inventory. Connect their **local** directory sources through the existing private manifest's `skills.install` entries to enable synchronization. Only configuration data belongs in the private checkout. Symlinks, hidden/system roots, Codex plugin cache and installer lock entries continue to use their original installer.

## Skills inventory and audit

The configuration page includes client, scope and managing-tool filters, provenance details, and a **Skills audit** tab. Workstation supplies the existing bounded Skills audit for Codex and shared `.agents/skills`; when a project is selected, its `.agents/skills` is inspected separately and remains read-only. These are observed files and configuration destinations, not proof that a running Agent has loaded a Skill.

The audit shows the last observation time, discovered Skill count, implicit versus explicit-only counts, duplicate names, invalid metadata, and manifest/lock/hash diagnostics. It reads the existing APM, Skills CLI and Workstation provenance records. Unknown ownership stays unknown; an arbitrary external link is not automatically attributed to another manager. Installer-owned Skills and native plugin assets remain outside configuration writes.

Original-tool entries link to the owning tool's documentation. Magpie can also be opened through its existing software-catalog action; a missing application reports an error and retains its documentation link. Opening a tool does not install it or transfer configuration ownership. No Skillshare dependency is required.

A v1 CLI that lacks the additive audit fields displays **Audit not supported**, while a failed or malformed report displays an audit error without replacing configuration review or recovery. Build the updated Workstation CLI and configure `CRAFT_HUB_WORKSTATION_COMMAND` as above to enable the report. Refresh reads new observations; the existing preview, application and guarded recovery workflows are preserved.

## CLI capabilities and diagnostics

Workstation exposes a read-only `host-json` interface for CLI/protocol versions and platform operation support. Its structured doctor shares the terminal doctor's inspection kernel and returns bounded codes, severities, messages, paths and counts, excluding configuration contents, secrets and subprocess output:

```sh
printf '%s\n' '{"version":1,"operation":"capabilities"}' | workstation host-json
printf '%s\n' '{"version":1,"operation":"doctor"}' | workstation host-json
```

The diagnostic center shows the Workstation source, CLI version, platform, check time and problems, linking back to environment configuration. Independent provider failures retain other results. Hosted workbenches skip local Workstation checks; empty, failed and skipped reports do not imply readiness.

Configuration and software controls follow negotiated operations, and the Host adapter negotiates again before actual operations. Configuration management supports macOS/Linux; Windows retains read-only operations. Automatic software installation and application opening currently require macOS. Platform support is separate from dependency readiness, which doctor and installation previews report. Windows npm/pnpm `.cmd` launchers are not discovered automatically; a trusted host can explicitly configure a Node executable with fixed CLI script arguments while retaining `shell: false`.

Legacy CLIs without negotiation retain read-only inventories and recovery history, while management controls require an upgrade. Prepared previews and loaded history remain visible. Refresh capabilities after upgrading the CLI.

## Git is a separate workflow

Review uncommitted files, unpushed commits, remote-leading counts and divergence. Counts reflect the last fetch; an absent upstream is shown as unknown. Fetch updates only the source checkout. To commit, select the declared managed files and enter a message, review, then explicitly confirm. Existing staged changes block commits. Review outgoing commit IDs and changed-line counts before publishing. Publication uses workstation's existing scan and non-forced push; divergence and remote-leading branches must be resolved first.

## Limits and recovery

Text previews preserve readable prose, comments, blank lines and formatting. Recognizable credential assignments, private keys, authentication headers and credential-bearing URLs are masked; unknown secret formats may not be detected. Structured MCP fragments retain conservative value masking. The viewer supplies line numbers and difference markers; serialized fragments can have different line positions from the original file. Display output is never used as replacement text.

MCP merge uses explicit field choices. Text merge uses explicit aligned line positions; it is not a semantic or inferred three-way merge. Syntax checks cover TOML and Zsh, while generic skills and Ghostty need user review. A missing entire declared MCP fragment is a scan error; individual server/file deletion is supported. Binary, oversized, linked and special files are blocked. Automatic installer updates, backup pruning, remote history conflict resolution and upstream setup remain outside this interface.

Multi-file writes are journaled and recoverable, not one OS transaction. Workstation locks coordinate its own processes; external editors are checked again immediately before replacement. After a crash, confirm the process has exited before manually removing a reported stale lock. Local journals can contain secrets and stay in the mode-protected workstation state directory.

This implementation was isolated from unrelated uncommitted host changes. Integrating it with a newer in-progress resource-page/Codex configuration API may require reconciling the generic integration contract. Do not replace those changes wholesale.

The integrated page uses the community host’s shared workbench header, controls and theme tokens. Downstream distributions consume the same renderer. The configuration management adapter coexists with the entity-based Codex inspector; hosted deployments deny both local configuration surfaces.
