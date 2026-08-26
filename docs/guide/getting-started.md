# Getting started

```bash
git clone https://github.com/YunYouJun/craft-hub.git
cd craft-hub
pnpm install
pnpm dev
```

New projects are untrusted. Add a project, inspect its commands and skills, preview a command, then explicitly trust the project before running it.

The bundled MCP adapter also supports `add_project`, `list_workspaces`, `create_workspace`, and `add_workspace_member`. These tools call the Craft Hub runtime instead of editing state files directly. Adding a project or workspace member never changes project trust, and no project code runs during registration.

Project registration is machine-local. Workspace manifests are portable YAML files under `~/.craft-hub/workspaces/`, while absolute paths and local bindings remain in the operating-system Craft Hub data directory.

For browser-only development, run `pnpm dev:web`.
