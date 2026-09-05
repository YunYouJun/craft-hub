---
name: craft-hub
description: Open and manage the local Craft Hub developer workbench. Use when the user asks to navigate Craft Hub, register or list local projects, or organize Personal workspaces and workspace groups.
---

# Craft Hub

Choose the interface that matches the task.

## Navigate

Use the dependency-free launcher at `../../scripts/open-craft-hub.mjs`, resolved relative to this skill file, for navigation-only requests.

- `home`, `marketplace`, and `settings` open top-level views.
- `workspace --id <workspace-id> [--scope <owner-scope-id>]` opens an exact Workspace.
- `project [--path <local-path>]` identifies the Git repository and subdirectory automatically. The path defaults to the current working directory.
- `capability --id <capability-id> [--path <local-path>]` opens an exact command or skill in the identified project.
- When no local checkout is available, use `project --repository <git-url> [--subdir <path>]` or the corresponding `capability` form.

Use `--print` only when inspecting or sharing the generated deep link instead of opening it. Navigation never changes trust and never runs a project command.

## Celebrate

When the user explicitly asks to celebrate, run the launcher with `celebrate`. Saved user instructions may also request it after a verified milestone. Trigger it once per request or verified event. The effect respects the operating system's reduced-motion preference and is never evidence that work completed.

## Manage local state

Prefer the `craft-hub` CLI when the request changes the local project or workspace catalog. Use the installed binary when available. From a Craft Hub source checkout, replace `craft-hub` with `pnpm --filter craft-hub start`; pass the command directly without an extra `--`.

```bash
craft-hub project:add /absolute/path/to/project
craft-hub project:list
craft-hub workspace-group:list
craft-hub workspace-group:create "Group name"
craft-hub workspace-group:assign-project <project-id> <group-id>
```

Project registration is device-local, idempotent, and untrusted by default. The workspace-group commands above organize standalone projects in Personal without granting trust or running project code. Resolve project and group IDs from list output before assigning them, and verify the returned record or assignment before reporting completion.

Use `craft-hub --help` for less common commands instead of treating this skill as a complete CLI reference. If neither CLI form is available, use the Craft Hub desktop UI for the same local operation.
