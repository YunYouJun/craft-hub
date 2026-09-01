---
name: craft-hub
description: Open the local Craft Hub app from Codex and navigate directly to its home, marketplace, settings, workspace, project, or project capability views.
---

# Craft Hub

Use the dependency-free launcher at `../../scripts/open-craft-hub.mjs`, resolved relative to this skill file. Run it with Node when the user asks to open or navigate Craft Hub.

- `home`, `marketplace`, and `settings` open top-level views.
- `workspace --id <workspace-id> [--scope <owner-scope-id>]` opens an exact Workspace.
- `project [--path <local-path>]` identifies the Git repository and subdirectory automatically. The path defaults to the current working directory.
- `capability --id <capability-id> [--path <local-path>]` opens an exact command or skill in the identified project.
- When no local checkout is available, use `project --repository <git-url> [--subdir <path>]` or the corresponding `capability` form.

Use `--print` only when inspecting or sharing the generated deep link instead of opening it. Navigation never changes trust and never runs a project command.
