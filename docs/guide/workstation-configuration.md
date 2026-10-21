# Development environment configuration

The trusted Host Plugin `@craft-hub/craft-hub-plugin-workstation` adds **开发环境** (Development environment) to Craft Hub. The desktop includes this adapter and a prebuilt Workstation backend; browsers use the same local service. A hosted runtime rejects device configuration operations.

## Desktop installation and distribution

New macOS desktop packages carry a pinned, prebuilt Workstation backend and its production dependencies. A fresh Mac uses the existing Electron runtime for that backend, so restoring configuration does not require a terminal Node.js, npm, pnpm or a source build. An explicitly configured CLI or an installed `workstation` remains authoritative. Source development and older desktop packages retain the external CLI setup below.

**Plugins → Host extensions** lists the bundled engine as **Included with the app**, with its version and a link to environment recovery. It updates with Craft Hub. This is distinct from Marketplace Plugins, whose declarative packages do not execute code or install backend dependencies. Configuration subscriptions continue to carry software lists and configuration source references; adding a subscription does not install an executable engine or apply configuration.

The packaging script builds the exact public commit in `scripts/workstation-runtime.lock.json` on the release machine, using its pinned package manager and frozen dependency lock, then deploys production files into an unpacked application resource. It never reads a neighboring Workstation checkout or includes private configuration. To update the engine, review and change the release lock, verify its capabilities and recovery behavior, then rebuild the desktop. Release publication still follows the existing signed/notarized application workflow.

Configuration sources remain in the user's checkout. The bundled backend uses `DOTFILES_REPO_ROOT` when explicitly set, otherwise `~/repos/github.com/YunYouJun/workstation`; it never writes configuration into the application bundle. Private sources use the existing remembered private-manifest binding. If a saved profile includes public configuration, the guide connects its configuration files separately, with no build step. Project toolchains still need their own Node.js when applicable.

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

The backend uses workstation's existing public source and connected private manifest. `DOTFILES_REPO_ROOT`, `WORKSTATION_PRIVATE_MANIFEST`, `DOTFILES_HOME` and `CODEX_HOME` retain their normal meanings. Connect a private repository using the existing `workstation private connect --yes` workflow. Credentials remain in the existing secret store or on the device.

## Prepare a new Mac

Open **Development environment → My environment profile** (`/environment/setup`) on the target Mac and import the exported profile. **Prepare the target Mac** checks these stages in order:

1. **Git and Apple developer tools**: open the [Apple installation instructions](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools/) or copy `xcode-select --install`, finish the system installer and recheck.
2. **Homebrew**: when selected software needs it, follow the [official installation instructions](https://docs.brew.sh/Installation), including the installer's terminal setup. The guide offers the installer command and the standard architecture-specific `shellenv` command. Detection only covers known host search locations.
3. **Node.js and npm**: skipped for the app-managed engine. External CLI source builds need terminal Node.js 22.18 or newer and npm 7 or later; that advanced path retains the official downloads and Homebrew instructions.
4. **Workstation**: the new desktop verifies the engine supplied by the app. No source checkout or build is needed. If verification fails, update Craft Hub and recheck. External CLI hosts retain the source-build and launcher-registration instructions; an existing source checkout is reused without pulling and an existing launcher is never overwritten.
5. **Configuration sources**: choose the source type and enter its HTTPS repository address in the guide. Complete any existing Git sign-in window or enter a Git username and access token when the page requests authentication. The adapter obtains and validates the source before Workstation remembers a private manifest. The guide automatically checks the actual inventory afterward; connecting a repository alone does not establish readiness for every selected reference. Advanced terminal instructions and `dotfiles doctor` remain available for diagnosis.

System prerequisites retain official links and copyable instructions. Configuration source connection runs from the page without copying a terminal command. A read failure displays an unconfirmed state and disables stale command copying. A connected source may still differ from the saved profile, so continue with **Check this Mac**, review installation plans and configuration differences, and apply them through their existing interfaces. Source connection does not apply configuration or grant project trust.

`GET /api/environment/setup` is local-only and read-only. The core supplies native prerequisites; the Workstation Host Plugin supplies its own tool and source instructions through `environmentSetupProviders`. Profiles remain portable references and contain no commands, authentication or checkout paths. Other operating systems remain unconfirmed by this Mac-specific guide.

## Connect a configuration source in the UI

1. Import the saved profile and finish any missing tool prerequisites. In **Connect the configuration sources**, choose **Private configuration** for a Workstation private overlay with `config/sync-manifest.json`, or **Public configuration** for the public dotfiles checkout. These are Workstation source types, independent of a Git host's repository visibility.
2. Enter a credential-free HTTPS Git repository URL and select **Connect source**. Workstation capabilities are checked before connecting. Existing Git credentials and configured credential-manager sign-in are tried first. Public repositories may need no authentication.
3. If authentication is required, enter the Git username and access token and select **Authenticate and continue**. The submitted token is used only for that attempt. This attempt disables credential-helper writes and uses a short-lived, host-scoped askpass channel; no token is written into URLs, argv, helper files, application state or portable profiles. Existing Git helpers manage their own sign-in and storage during the first attempt. Cancel or retry from the page when needed.
4. The adapter clones into its own staging directory, disables checkout hooks, submodule recursion and HTTP redirects, then asks Workstation to inspect the source. Invalid manifests or unreadable configuration are rejected before changing the private binding. Private checkouts live under the OS Craft Hub data directory; public files use the host's configured public checkout. Existing matching checkouts are reused without pulling. Different repositories and local directories are not overwritten.
5. Workstation saves the validated private binding using its existing `private connect --yes` command. The page rechecks selected references and lets you continue to configuration preview and apply. Source connection itself does not modify local configuration, commit or push source files, or change project trust.

`GET /api/environment/sources` reads transient connection progress without contacting a repository. Same-origin local JSON POST requests start a connection, answer authentication or cancel it. The generic runtime delegates through trusted `environmentSourceProviders`; repository validation and private binding remain in the Workstation adapter and CLI. Requests cannot select a command, executable, helper or checkout path. Authentication sessions expire after ten minutes, and shutdown cancels unfinished transports. Restart reads the saved source binding through Workstation; access tokens and transient progress are not persisted.

This flow currently accepts HTTPS URLs. SSH keys, SSH host verification and custom authentication remain available through the existing advanced tool workflow. An explicit `WORKSTATION_PRIVATE_MANIFEST` host override stays authoritative and must be resolved in the host configuration before the UI can change the remembered source. A Git host requiring a custom browser OAuth flow needs an existing compatible Git credential helper; the page's fallback is username plus access token.

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

## Multiple sources and backup targets

**Development environment → Sources and targets** manages existing local Git checkouts through Workstation's device-local registry. Add sources by stable ID, format and content scope. Public, personal-private and work-private content remain separate from repository visibility. The previous private binding starts unclassified; review its scope before including it in backups. Editing the registry does not apply files or grant execution trust. Checkout connection and authentication retain their existing workflows; this form registers an existing checkout.

The configuration review includes a source filter and shows the exact write-back source. Duplicate declarations require an explicit owner within the same content scope. Cross-scope ownership transfers are blocked; split declarations rather than relying on order. Disabling or removing a source never deletes its checkout. Remembered ownership prevents an inactive private source's local content from being adopted by a different audience.

Register an encrypted backup target separately. Leave its checkout empty to reserve support without creating a repository. Choose the original-application method for application-owned encrypted formats; the page offers no Workstation writes for those targets. Workstation backups select declared source files and a host environment variable name for the encryption passphrase. Private audiences cannot share one backup checkout. The form never accepts the passphrase itself.

Preview encrypted backup creation or restoration, then review and apply the returned plan. An archive changed by another device requires explicit replacement selection. Recovery first restores source files; applying those sources to the device remains a separate review. Wrong passphrases, altered archives, unknown files, stale plans and later local edits prevent silent overwrite. Recovery history retains prior versions and supports retry after interrupted restoration. Git commits and non-forced publication remain explicit in **Repository sync**.

The backend's v1 capabilities advertise these additive operations. An older CLI keeps its existing configuration workflows and disables multi-repository management until upgraded. New source registrations, backup cryptography, classification, conflicts, locks and recovery are implemented only in Workstation; the Host Plugin and web renderer pass requests and display results. Native application backups, remote Git history reconciliation, background sync and complete-machine restoration remain with their existing tools. See the [Workstation protocol and archive limits](https://github.com/YunYouJun/workstation/blob/main/docs/guide/configuration-api.md#multiple-sources-and-encrypted-backup-targets).
