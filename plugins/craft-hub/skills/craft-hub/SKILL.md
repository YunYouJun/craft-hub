---
name: craft-hub
description: Use Craft Hub to register or discover local projects, organize portable workspaces, initialize project configuration, inspect capabilities, preview commands, or inspect run status from Codex.
---

# Craft Hub

Treat Craft Hub as the source of truth for project registration, workspaces, trust, command previews, and run records.

For project requests:

1. Resolve existing projects with `list_projects`. When the user supplies an exact absolute local path that is not registered, use `add_project` and report its returned trust state.
2. Resolve existing workspaces with `list_workspaces`. Create one only when requested, then use `add_workspace_member` with registered project and workspace IDs.
3. For project configuration initialization, call `init_project_config` in `preview` mode first. Apply only when the user authorized file creation, using the unchanged revision from that preview. An untrusted project must be trusted in Craft Hub before apply can succeed.
4. Inspect capabilities with `list_capabilities`.
5. Preview a command before proposing execution. Use the returned command, arguments, working directory, required environment, and trust state verbatim.
6. Render `render_craft_hub_panel` only when a compact visual summary helps the user choose or review structured information.

Use Craft Hub tools for registration, workspace changes, and project config initialization so the runtime validates paths, revisions, and state boundaries. Newly registered projects remain untrusted; adding a project or workspace member does not authorize trust, configuration writes, or execution.

Keep Codex as the agent client. Craft Hub supplies project context and controlled invocations; conversation, code review, and agent execution remain in Codex.
