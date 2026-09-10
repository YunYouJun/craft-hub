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
