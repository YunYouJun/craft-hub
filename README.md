# Craft Hub

Craft Hub is a local, cross-project developer workbench. Its Project Palette discovers the commands and agent skills already present in each repository, lets you inspect exactly what will run, and keeps execution behind an explicit project trust boundary.

> Early alpha. Packages are private until the first usable release is ready.

## What works

- Register and switch between local projects
- Register projects and organize portable workspaces from the Craft Hub MCP adapter
- Discover root and pnpm workspace `package.json` scripts, Makefile targets, and Taskfile tasks
- Keep Personal and Git-backed Team workspaces in isolated Owner Scopes with fast navigation switching
- Discover project-local skills from `.agents`, `.claude`, and `.codex`
- Preview command, arguments, working directory, and required environment
- Trust a project explicitly before running anything
- Capture stdout, stderr, exit status, and run records
- Use the same runtime from the CLI, web workbench, and Electron shell

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

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
```

### macOS releases

Release tags (`v*`) build separate Apple Silicon (`arm64`) and Intel (`x64`) apps, sign and notarize them, then attach both ZIP files to the GitHub Release.

Configure the required Developer ID certificate and App Store Connect API key once with:

```bash
./scripts/setup-macos-signing.sh
```

To make unsigned packages locally for testing:

```bash
pnpm build
pnpm run package:mac
```

## CLI

```bash
craft-hub app .
craft-hub app /absolute/path/to/project --no-open
pnpm --filter craft-hub start -- project:add /absolute/path/to/project
pnpm --filter craft-hub start -- project:list
pnpm --filter craft-hub start -- workspace:import /absolute/path/to/workspaces
pnpm --filter craft-hub start -- list <project-id>
pnpm --filter craft-hub start -- project:trust <project-id>
pnpm --filter craft-hub start -- run <project-id> <capability-id> --yes
```

`craft-hub app [path]` registers the directory as untrusted, starts the workbench on a random available port, selects that project, and opens the system browser. The path defaults to the current directory; pass `--no-open` to print the URL without opening it or `--port <port>` to choose a fixed port.

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
- `packages/craft-hub` — runtime, local API, and CLI
- `examples/sample-project` — discovery and execution fixture
- `docs/design` — accepted visual concepts

## Downstream distributions

Community discovery, trust, execution, and storage remain in this repository. A downstream distribution contributes branding and capabilities through the plugin seam:

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

### Marketplace plugins

Marketplace plugins are declarative packages listed by a Plugin Catalog. Craft Hub installs immutable versions with lifecycle scripts disabled, validates their SHA-512 integrity and permission disclosure, and never imports package code. See the [plugin marketplace contract](./docs/guide/plugin-marketplace.md).

## Roadmap

- Next: add real “Use with Agent” adapters and richer streamed run controls.
- Later: add VS Code integration and automatic desktop updates.
- Future: bring the reusable parts of [Stardew](https://github.com/YunYouJun/stardew) into Craft Hub as a Workflow Studio for visually composing project capabilities and local resource-processing workflows.
  - Extract a data-only workflow definition, validation, and execution model instead of merging the legacy Electron runtime directly.
  - Run workflows through Craft Hub's existing project trust, execution validation, cancellation, output streaming, and run history.
  - Adapt useful Stardew nodes such as FFmpeg, Sharp, Playwright, and asset-processing tools into explicitly installed Craft Hub plugins.
  - Reuse the visual flow editor in the web workbench while keeping local operations behind the shared runtime.

The Workflow Studio is a post-alpha direction, not part of the first public release. The public runtime will remain independent of any editor or agent vendor.

MIT © YunYouJun
