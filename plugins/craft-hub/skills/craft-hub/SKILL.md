---
name: craft-hub
description: Use Craft Hub to register or discover local projects, resolve portable workspaces, initialize project configuration, inspect capabilities, preview commands, or inspect run status from Codex.
---

# Craft Hub

Treat Craft Hub as the source of truth for project registration, workspaces, Craft Hub execution authorization, command previews, and run records. Codex remains responsible for its own workspace access, sandbox, approvals, and file changes.

For project requests:

1. Resolve existing projects with `list_projects`. When the user supplies an exact absolute local path that is not registered, use `add_project` and report whether Craft Hub execution is authorized.
2. Resolve existing workspaces with `list_workspaces`. When the prompt names a Workspace ID, select that exact workspace before inspecting its members. Create a workspace only when requested, then use `add_workspace_member` with registered project and workspace IDs.
3. For project configuration initialization, call `init_project_config` in `preview` mode first. Apply only when the user authorized file creation, using the unchanged revision from that preview. Applying through Craft Hub requires Craft Hub execution authorization for the project.
4. Inspect capabilities with `list_capabilities`.
5. Preview a command before proposing execution. For a command with `inputs`, resolve required values from the request or project defaults and pass them to `preview_command`. Use the returned command, arguments, working directory, required environment, and execution-authorization state verbatim.
6. Render `render_craft_hub_panel` only when a compact visual summary helps the user choose or review structured information.

Use Craft Hub tools for registration, workspace changes, and project config initialization so the runtime validates paths, revisions, and state boundaries. Registration, discovery, Workspace management, and opening a project in Codex do not require Craft Hub execution authorization. Running commands, starting background agent tasks, starting project MCP servers, and writing project configuration through Craft Hub do require it.

Keep Codex as the agent client. Craft Hub supplies project context and controlled invocations; conversation, code review, and agent execution remain in Codex.
