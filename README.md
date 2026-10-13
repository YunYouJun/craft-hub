# Craft Hub

Craft Hub is a personal software and development-environment workbench. Its direction is to bring software setup, everyday tool access, environment checks and reviewed configuration migration into one place. The current alpha provides a personal overview, local tool inspection, project capabilities, tool handoff and configuration review; selected software installation and the machine-setup workflow are planned.

Use Orca or your preferred coding workbench for daily coding, agent sessions, worktrees, terminals, and code review. Use Raycast for quick actions and installed extension commands. Craft Hub's proposed home will present machine readiness and setup workflows, with existing project and provider views available alongside them. Workstation remains the configuration-management backend; its selected software installation interfaces still need to be added. Basic local tool inspection works independently of Workstation. The shared runtime discovers repository commands, validates execution, and exposes capabilities through the CLI, local API, and MCP.

> Early alpha. The `craft-hub` CLI is published on npm under the `next` tag; APIs and persisted formats may still change before the first stable release.

## What works

- Start at the personal overview (`/overview`) with commonly used projects, tools, and connected work items
- Add, edit, remove, and group HTTPS tool destinations, with optional Raycast or Orca application launch presets on macOS
- Prepare a work-item or project handoff, select the target project explicitly, review the text, and copy it for your external tool
- Pin commonly used projects locally and open their existing project workbench
- Enter installed plugin navigation and integration views from the overview
- Browse the Workstation software catalog in **Software center** (`/software`), review selected missing-app installations, follow persistent per-item progress, retry unfinished items and open detected macOS apps
- Inspect Git, Node.js, pnpm, fnm, Homebrew and Workstation in **Local environment** (`/environment`), with version, path, probe status and search locations; the backend's bundled Node is reported separately
- Preview real provider work items through configured, read-only `work-items.list` actions
- Register and switch between local projects
- Register projects and organize portable workspaces from the Craft Hub MCP adapter
- Discover root and pnpm workspace `package.json` scripts, Makefile targets, and Taskfile tasks
- Keep Personal and Git-backed Team workspaces in isolated Owner Scopes with fast navigation switching
- Discover project-local skills from `.agents`, `.claude`, and `.codex`
- Preview command, arguments, working directory, and required environment
- Trust a project explicitly before running anything
- Capture stdout, stderr, exit status, and run records
- Review host, configuration, Marketplace, plugin, and integration problems in one diagnostics workbench
- Use the same runtime from the CLI, web workbench, and Electron shell
- Connect your own agent with scoped, revocable read access from **Settings → Agent connection**; see the [connection guide](docs/guide/agent-connection.md)
- Review work items and provider-defined status transitions through installed Host extensions
- Review configuration changes and integration diagnostics in focused browser views

## Product scope

The product direction is a machine-oriented workbench: observe the installed state, choose desired software and configuration, review changes, prepare the machine, and open the tools used for daily work. Craft Hub owns presentation and orchestration; Workstation owns configuration interpretation, plans, writes, backups and synchronization, while existing package managers own software installation. The [machine workbench roadmap](docs/design/machine-workbench-direction.md) distinguishes delivered capabilities from proposed ones. The current UI still uses the project/work-item overview; the new machine-readiness home is not implemented yet.

Existing local project organization, capability discovery, structured command execution, integration providers and configuration review remain available during this refinement. Specific external systems are supplied by optional Host extensions; the community package supplies their contracts and shared UI.

Tool destinations keep a required HTTPS website fallback. In the macOS desktop, explicit application presets launch Raycast or Orca; Raycast can also target a configured command deeplink copied from an installed command. This first version rejects deeplink parameters and arbitrary protocols. The browser uses websites, and the desktop reports website fallback if the application cannot be launched. Launching a tool does not transmit this handoff context or prove it was received; a configured Raycast command may perform its own actions.

Prepare a handoff from a provider item or a local project. Choose the project, add an objective, review and copy the context, then paste it in the external workbench. Craft Hub does not infer local project bindings from provider metadata, automatically inject prompts, or maintain a second work-item database. Home preferences stay in the operating-system settings directory under `workbench.home`; project pins are machine-local, and portable export currently excludes this setting.

Work-item previews use installed providers and their declared read actions. They are views of the connected source, not a separate task database. Provider-defined writes and status transitions remain in the existing integration views with their validation and confirmation.

General agent orchestration, session management, worktree lifecycle, interactive terminal hosting, and repository merge/review interfaces are outside the new product scope. The command runner still needs output, cancellation, and any supported command input. Workspace and configuration Git persistence remains part of Craft Hub's own data management.

The [machine workbench decision](docs/adr/0011-focus-on-machine-setup-and-environment.md) sets the current product priority. The [earlier direction and implementation backlog](docs/design/workbench-direction.md) records the personal overview, tool handoff and host experiments. The [integration-layer decision](docs/adr/0009-focus-on-project-capabilities-and-integrations.md) records the dependency-aware removal sequence for redundant coding features. The [workbench selection research](docs/research/agent-workbench-selection.md) compares external tools; using Craft Hub does not require any one of them.

## Develop

Requires Node.js 22.18+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

For the browser workbench without Electron:

```bash
pnpm dev:web
```

`pnpm dev` starts the runtime watcher, Vite renderer, local API, and Electron shell. `pnpm dev:web` starts the local API and Vite renderer. Both commands prefer `http://127.0.0.1:5173` and report the actual URL when that port is occupied.

### Development inspector

Vite DevTools is enabled only during development. Press **Shift + Alt + D** (**⇧⌥D** on macOS) to reveal the dock, or open `/__devtools/` on the reported Vite URL. Authenticate with the code printed in the development terminal when prompted, then select **Craft Hub Inspector**.

The `craft-hub` Devframe provides a read-only view of registered projects and their trust state, discovered commands and skills, workbench diagnostics, and the latest 30 run records. The official dock group exposes **Projects / Diagnostics / Runs** as child tabs sharing one live iframe; switching tabs preserves the selected project and filter. Use **Refresh** to fetch current data and select a project to inspect its capabilities. The inspector defaults to Simplified Chinese, offers an English switch, and remembers its own language preference in browser storage. Its content and dock child titles switch together; the upstream Vite DevTools shell keeps its own language. Runtime diagnostic messages and project-defined text retain their original content. It reads the existing runtime at `http://127.0.0.1:4318`; starting Vite alone displays an unavailable-runtime message until the local API starts.

The inspector registers through the public `createPluginFromDevframe()` adapter and reuses the workbench logo. Each child dock attaches the official `attachDevToolsFrameNav()` adapter through a dock client script, so navigation also works when a saved child tab mounts before the hidden anchor. Its development-only HTML entry at `/__craft-hub/` loads Vue source through Vite, so it needs no separate client build. The panel does not execute commands, modify trust, expose agent tools, or ship in production builds.

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
```

### macOS releases

Release tags (`v*`) build separate Apple Silicon (`arm64`) and Intel (`x64`) apps, sign and notarize them, then attach both ZIP files to the GitHub Release.

[Download Craft Hub for macOS](https://craft-hub.yunyoujun.cn/download) from the documentation site. Apple silicon is the recommended alpha build; Intel support is experimental.

Configure the required Developer ID certificate and App Store Connect API key once with:

```bash
./scripts/setup-macos-signing.sh
```

To make unsigned packages locally for testing:

```bash
pnpm run build:mac
```

To rebuild only the current Mac architecture, replace the installed app in `/Applications`, and open it:

```bash
pnpm run reinstall:mac
```

Set `CRAFT_HUB_DESKTOP_INSTALL_DIR` to install into a different application directory.

The lower-level `package:mac` script packages existing build output and is used by the release workflow.

An optional macOS Tauri trial reuses the Web UI and ships its own Node backend. Run `pnpm build:tauri` to build it or `pnpm dev:tauri` after building the Web UI. It uses separate trial data and excludes the embedded Codex SDK/CLI; it does not yet replace the Electron distribution's extensions, cloud, updates, or agent connections. See the [trial guide](./apps/tauri/README.md) and [distribution measurements](./docs/design/workbench-direction.md#2026-10-09瘦身与-tauri-验证实现).

## CLI

```bash
pnpm dlx craft-hub@next app .

craft-hub app .
craft-hub app . --browser
craft-hub app /absolute/path/to/project --no-open
pnpm --filter craft-hub start project:add /absolute/path/to/project
pnpm --filter craft-hub start project:list
pnpm --filter craft-hub start workspace:import /absolute/path/to/workspaces
pnpm --filter craft-hub start list <project-id>
pnpm --filter craft-hub start project:trust <project-id>
pnpm --filter craft-hub start run <project-id> <capability-id> --yes
```

`craft-hub app [path]` opens the matching Project in the installed desktop client. The path defaults to the current directory. When the path cannot be represented by a Git Project Reference or the desktop protocol handler is unavailable, it falls back to a standalone browser workbench. Pass `--browser` to force that browser workbench, `--no-open` to start it without opening a browser, or `--port <port>` to choose a fixed port.

Projects are untrusted by default. Listing and inspecting capabilities never executes project code.

### pnpm workspaces

When a registered Project contains `pnpm-workspace.yaml`, Craft Hub resolves its `packages` glob and exclusion patterns and reads scripts from every matched package manifest. The Project Palette groups commands under `Project root` or their package-relative path, exposes the package name, and provides Develop, Build, Test, Quality, Preview, Deploy/Release, and Other filters.

Workspace commands run with `pnpm run <script>` from the declaring package directory. Craft Hub resolves that directory before preview or execution and rejects commands whose real path leaves the trusted Project boundary. A malformed workspace manifest blocks discovery; a malformed individual package is skipped and reported as a non-fatal discovery diagnostic in the workbench and MCP `list_capabilities` response.

VS Code `.code-workspace` files can be imported explicitly from the CLI or workbench. Craft Hub reads the JSONC `folders[].path` and optional `folders[].name` fields once, converts them into editable user-owned workspaces and a workspace group, and does not synchronize the source afterward. Existing unregistered directories remain available for explicit registration, and every newly registered project remains untrusted.

## MCP

The bundled Craft Hub MCP adapter exposes the same runtime state as the CLI and workbench. Agents can list or register local projects by absolute path, list or create portable workspaces and groups, add or resolve workspace members, and initialize optional project config through a preview/apply flow. VS Code workspace import uses the same pattern: call `preview_vscode_workspace_import` to validate documents, paths, registrations, and conflicts, then pass its revision to `import_vscode_workspaces`. Registration never executes project code and leaves every newly registered project untrusted.

Project registration and local workspace bindings stay in the operating-system Craft Hub data directory. Portable workspace manifests are written under `~/.craft-hub/workspaces/`. `init_project_config` previews the exact `.craft-hub/project.jsonc` content without writing; apply requires a trusted project and the matching preview revision, creates only a missing file, and never overwrites existing repository configuration.

## Optional project config

Zero configuration is the default. A repository may add `.craft-hub/project.jsonc`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/project-v1.schema.json",
  "version": 1,
  "project": {
    "name": "Craft Hub",
    "icon": "./icon.svg"
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
  }
}
```

Discovered commands can also declare safe form inputs under `capabilities.inputs`. Select, text,
and boolean values are validated by the runtime and appended as individual argv entries. Boolean
inputs append their flag only when enabled, preserving Craft Hub's structured execution model
without invoking a shell.

## Repository layout

- `apps/web` — Vue workbench UI
- `apps/desktop` — thin Electron host
- `apps/tauri` — optional macOS host and self-contained Node backend trial
- `packages/craft-hub` — runtime, local API, and CLI
- `examples/sample-project` — discovery and execution fixture
- `docs/design` — accepted visual concepts

## Host extensions and optional distributions

Craft Hub is one application. Private capabilities can be installed as trusted Host extensions alongside their declarative Marketplace plugins; they do not require a second application or a separate workbench build. Desktop and the local browser workbench (`craft-hub ui`, `craft-hub app --browser`, and `pnpm dev:web`) load the same enabled, previously approved extensions from the Craft Hub data directory.

Discovery, trust, execution, and storage remain in this repository. A downstream distribution is an optional packaging choice for hosts that need different branding or provisioned defaults:

```ts
import { createDistributionOptions } from '@acme/craft-hub-distribution'
import { createCraftHub } from 'craft-hub'

const runtime = createCraftHub(createDistributionOptions())
```

Capability providers only discover structured capabilities. They cannot bypass the community runtime's project trust or execution validation.

### Host plugins

A plugin is a trusted npm/workspace dependency explicitly installed by the host. It contributes capabilities while Craft Hub retains discovery validation, project trust, and command execution:

```ts
import { createCraftHub, defineCraftHubPlugin } from 'craft-hub'

const issuePlugin = defineCraftHubPlugin({
  id: '@acme/craft-hub-plugin-issues',
  capabilityProviders: [issueCapabilityProvider],
})

const runtime = createCraftHub({ plugins: [issuePlugin] })
```

Hosts that accept package names from configuration can call `loadCraftHubPlugins(specifiers, { baseDir })`. A plugin package exports its plugin object as `default` or `plugin`. Loading executes package code, so only explicitly configured, trusted dependencies should be accepted. Broken plugins are returned as diagnostics and do not prevent healthy plugins from loading; discovery failures are available through `runtime.getPluginDiagnostics()`.

Desktop distributions may list those reviewed modules in the top-level `hostPlugins` array of their distribution manifest. Package names and safe paths relative to the manifest are supported; network URLs and paths outside the distribution directory are rejected. The Community desktop loads these adapters into the same runtime and UI, so downstream products do not need to fork the workbench shell.

For the ordinary application, install that manifest from Marketplace → **Host extensions** once. Local workbench startups restore only its saved, approved module list; Marketplace installation alone never authorizes executable code. A missing or broken Host extension remains visible in diagnostics. See [installation and removal](./docs/guide/plugin-authoring.md#installing-local-host-extensions).

### Marketplace plugins

Marketplace plugins are declarative packages listed by a Plugin Catalog. Craft Hub installs immutable versions with lifecycle scripts disabled, validates their SHA-512 integrity and permission disclosure, and never imports package code. Extension packs use same-source `includesPlugins` to install a reviewed set whose members remain independently manageable; `requiresPlugins` is reserved for hard dependencies. See the [plugin marketplace contract](./docs/guide/plugin-marketplace.md).

## Roadmap

- Improve the personal overview from real use: useful project pins, editable tool groups, provider work-item previews, and clear unavailable-provider states.
- Keep shortcuts and project choices in runtime settings. Define portability for tool links separately from machine-local project identifiers before adding home synchronization.
- Decouple work-item and skill handoff from the internal agent task manager. Prepare reviewable context and support copy/export plus independently validated external launch adapters; current tool cards only open websites.
- Migrate or retire the agent execution and remote-delivery paths once their callers and persisted-task recovery have a replacement. Generic background-task creation has been removed from the workspace dashboard; existing Codex handoff and historical task access remain during migration.
- Keep improving structured command review, provider-native business actions, configuration review, and diagnostics when real workflows justify the work.
- Evaluate the optional desktop shell against the personal overview and required integration workflows; preserve browser and CLI access and user data when changing packaging.

Workflow Studio, a general agent workspace, and broad editor integrations are deferred without a delivery commitment. New features should identify a recurring workflow that existing tools and a small adapter cannot already serve. The public runtime remains independent of any editor or agent vendor.

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md) to set up a development environment and submit changes. Please report vulnerabilities through GitHub's private vulnerability reporting flow as described in [SECURITY.md](./SECURITY.md), not through a public issue.

MIT © YunYouJun
