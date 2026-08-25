# Craft Hub

Craft Hub is a local, cross-project developer workbench. Its Project Palette discovers the commands and agent skills already present in each repository, lets you inspect exactly what will run, and keeps execution behind an explicit project trust boundary.

> Early alpha. Packages are private until the first usable release is ready.

## What works

- Register and switch between local projects
- Discover `package.json` scripts, Makefile targets, and Taskfile tasks
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

`pnpm dev` starts the runtime watcher, Vite renderer, local API, and Electron shell. `pnpm dev:web` starts the local API and Vite renderer at `http://127.0.0.1:5173`.

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
pnpm --filter craft-hub start -- project:add /absolute/path/to/project
pnpm --filter craft-hub start -- project:list
pnpm --filter craft-hub start -- list <project-id>
pnpm --filter craft-hub start -- project:trust <project-id>
pnpm --filter craft-hub start -- run <project-id> <capability-id> --yes
```

Projects are untrusted by default. Listing and inspecting capabilities never executes project code.

## Optional project config

Zero configuration is the default. A repository may add `.craft-hub/project.yaml`:

```yaml
version: 1
project:
  name: Craft Hub
  icon: ./icon.svg
defaults:
  agent: codex
capabilities:
  hidden: []
```

## Repository layout

- `apps/web` — Vue workbench UI
- `apps/desktop` — thin Electron host
- `packages/craft-hub` — runtime, local API, and CLI
- `examples/sample-project` — discovery and execution fixture
- `docs/design` — accepted visual concepts

## Downstream distributions

Community discovery, trust, execution, and storage remain in this repository. A downstream distribution contributes branding and capabilities through the plugin seam:

```ts
import { createWoaCraftHubOptions } from '@tencent/craft-hub'
import { createCraftHub } from 'craft-hub'

const runtime = createCraftHub(createWoaCraftHubOptions())
```

Capability providers only discover structured capabilities. They cannot bypass the community runtime's project trust or execution validation.

### Plugins

A plugin is a trusted npm/workspace dependency explicitly installed by the host. It contributes capabilities while Craft Hub retains discovery validation, project trust, and command execution:

```ts
import { createCraftHub, defineCraftHubPlugin } from 'craft-hub'

const tapdPlugin = defineCraftHubPlugin({
  id: '@tencent/craft-hub-plugin-tapd',
  capabilityProviders: [tapdCapabilityProvider],
})

const runtime = createCraftHub({ plugins: [tapdPlugin] })
```

Hosts that accept package names from configuration can call `loadCraftHubPlugins(specifiers, { baseDir })`. A plugin package exports its plugin object as `default` or `plugin`. Loading executes package code, so only explicitly configured, trusted dependencies should be accepted. Broken plugins are returned as diagnostics and do not prevent healthy plugins from loading; discovery failures are available through `runtime.getPluginDiagnostics()`.

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
