# Codex tasks

The Workspace header's Codex icon opens the Primary project directly in the native Codex app. The adjacent plus button focuses the multi-root task form, where **Start in Codex** hands off a task through the existing SDK runner. The Workspace's generic **Craft Hub background** action has been removed as the first step of the [scope reduction](../adr/0009-focus-on-project-capabilities-and-integrations.md).

The remaining SDK path is a compatibility flow during migration. It still executes the prompt locally before opening the native client; it is not yet a launcher that delegates execution entirely to another workbench.

macOS desktop builds use an installed Codex CLI by default. The Software center can install the missing CLI through Workstation; existing native binaries are discovered on local executable paths and inside the Codex or ChatGPT app. Craft Hub can open without Codex or a system Node installation; only Codex task execution requires the CLI and its separate authentication. Workstation itself remains a separately installed Node CLI. Set `CRAFT_HUB_DESKTOP_CODEX_MODE=bundled` explicitly when building a compatibility package with an embedded CLI.

## Open the Primary project in Codex

Use the header's Codex icon when you want the documented `codex app <path>` behavior: it launches the native app with the Workspace's Primary project. This is a direct navigation shortcut and intentionally opens one folder. It does not start a prompt or attach the Workspace's other Projects.

## Start in Codex

Craft Hub starts a persisted Codex task with the Primary project as its working directory and every selected project as a workspace root. The prompt includes the explicit Craft Hub Workspace ID so the globally installed Craft Hub plugin can resolve the same workspace without relying on hidden active-workspace state. The prompt begins immediately, and every selected project must already be authorized for Craft Hub execution.

While the turn is active, the Codex SDK process owns the local thread. Craft Hub therefore keeps the task in its own UI, streams human-readable SDK progress and command output, and does not expose an early thread link. After the SDK process finishes and releases the thread, Craft Hub automatically opens it in the native client. This avoids the native client's **Already open in another application** state.

The task is persisted in Codex's normal session store. Conversation history, approvals, diffs, progress, and follow-up turns therefore remain available in the native client after the SDK runner releases the task.

Codex does not currently expose a documented desktop interface for a third-party application to update a local project's folder list. The supported `codex app <path>` launcher opens one saved project; top-level `--add-dir` flags do not update that Desktop project. Craft Hub therefore uses `codex app` only for the explicit Primary-project shortcut. It uses the Codex SDK task path for multi-root work and does not rely on accessibility scripting or private IPC.

For a multi-project workspace, the Primary project remains the default working directory. The selected-project list controls exactly which additional roots are attached to **Start in Codex**.

## Existing internal tasks

The Workspace no longer creates generic background tasks. Historical task records and their output remain available, and released threads can still be opened in Codex. The backend cancellation API remains available for running tasks.

Skill execution, work-item launch, project configuration actions, and remote delivery still use the shared task manager. Their execution paths must be migrated before that backend can be removed. For tasks that stay in Craft Hub, **Open in Codex** becomes available only after the task finishes or is stopped and the runner has released it.

SDK tasks are not terminal sessions: the provider consumes a structured JSON event stream and has no PTY screen buffer. Craft Hub renders those events as terminal-like local output. A Codex TUI started independently in Terminal or iTerm is owned by that external terminal, so Craft Hub cannot read or mirror its screen contents.

## Choosing an entry point

| Need | Preferred mode |
| --- | --- |
| Navigate to the Primary project without starting a prompt | Header Codex icon |
| Watch live output, then automatically open the released task | Start in Codex |
| Keep the native app free of thread ownership conflicts | Start in Codex |
| Start generic unattended work | Your preferred external workbench |
| Start across selected project roots through the existing compatibility flow | Start in Codex |
| Continue a completed background task in Codex | Open the released thread |

Codex App Server is a protocol for building a rich Codex client; it does not turn a separately launched App Server process into a remote-control endpoint for the Codex desktop app. Craft Hub therefore keeps the runtime behind an adapter and does not imitate Codex's conversation UI. See the official [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server) and [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk).

## Safety boundary

- The Workspace header labels the Codex icon as a Primary-project shortcut; the adjacent plus button focuses the multi-root task form.
- **Start in Codex** requires explicit Craft Hub execution authorization for every selected project; the direct Primary-project shortcut does not execute project code.
- **Start in Codex** submits the entered prompt immediately, shows local output while running, and opens the native client only after release.
- Project launch uses structured command arguments with `shell: false`.
- Craft Hub does not use AppleScript, accessibility automation, or undocumented desktop IPC to mutate Codex projects.
