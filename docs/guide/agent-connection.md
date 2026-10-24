# Connect your agent

Open **Settings → Agent connection** in a local Craft Hub workbench. Select the registered projects the agent may read. Optionally allow reads from enabled plugins through their connected accounts, then choose **Enable read access**.

Copy the generated MCP configuration into your agent. Choose JSON for compatible MCP clients or TOML for Codex. Merge the entry with existing MCP settings; do not replace unrelated entries. A supported Node.js executable must be available on the agent's PATH. The generated configuration references the installed Craft Hub CLI and a local credential file, so it also works before a new npm release.

Keep that Craft Hub host running. The MCP process communicates with its loopback endpoint and reuses its projects and loaded plugins. Use the displayed connection check command, or ask your agent to list the shared projects, then refresh this page to see the last verified connection. The check does not invoke a model.

## What is shared

- Selected project identities, trust state, discovered command and skill metadata.
- Command history and agent task results that belong entirely to selected projects.
- Enabled plugins' read operations, only when plugin access was selected. This can include account-wide remote content, independently of the selected local projects.

This connection is read-only. It cannot grant project trust, run a command, edit a document, change an account connection, or send a message. Plugin and repository text remains task context, not authority to expand the user's request.

## Hand off context

Plugins can offer **Hand off to agent** on a source document. The workbench opens an editable task preview and lets you select a registered project. Starting requires a trusted project and an agent executor on the current host. The desktop host provides its configured adapter; a local browser host may have none. In that case, copy the reviewed instructions to your own agent.

Task execution is independent of granting MCP read access. Starting a task shows its progress and final response in the workbench. Connecting an agent does not automatically start a task.

## Revoke or change access

**Save scope and replace credential** invalidates the old credential. **Revoke connection** removes it. Every tool call checks the current grant. Credentials stay in the operating-system Craft Hub data directory, in a file with owner-only permissions. They are not included in the displayed configuration or portable project configuration.

The generated URL belongs to the running local host. If its port or installation path changes, copy the current configuration again. Hosted workbenches show a local-device explanation; this feature does not create a remote-device task channel.

The private development package `@craft-hub/mcp` retains its standalone runtime adapter. The connection described here uses `craft-hub mcp` to access the already-running host under a revocable read grant.

## Optional Augma project regions

Augma's native macOS project regions can use this same read grant. In Craft Hub, select the projects to share, enable read access, and copy **MCP · JSON**. In Augma, open **Space → Project regions → Add from Craft Hub**, or choose **Link a Craft Hub project** on an existing region, then paste the configuration and select a project. Plugin reads are not needed.

Augma parses only the loopback URL and credential-file reference; it never executes the configuration's command. It calls `craft_hub_projects` and `craft_hub_project_context` through `POST /api/agent-access`, including on the native sidecar. This exact endpoint validates the existing revocable grant; the grant cannot access native management routes, change trust or execute commands. Project context includes an optional credential-free Git `reference` for desktop navigation. Non-Git projects still support binding and open the desktop home instead of a project deep link.

The binding references the selected local credential source and project ID. Augma reads project names, folders, trust and command/skill metadata; its layout, editor/browser choices and websites remain local. Before opening a bound workspace it refreshes the project context. A disconnected, revoked or unshared project cannot silently open a cached directory. Unlinking restores the region's independent name and folder. Existing independent regions keep working without Craft Hub.

Keep the selected Craft Hub host running. If its port changes, copy its current JSON configuration again; the same credential-file source preserves region bindings. Changing profiles requires explicit rebinding. Disconnecting in Augma clears its connection settings and in-memory summaries; revoking in Craft Hub revokes the shared grant for all clients using it. Tokens are never copied into Augma's region or connection JSON.
