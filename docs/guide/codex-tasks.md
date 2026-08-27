# Codex tasks

Craft Hub supports two intentionally different ways to start Codex work. **Start in Codex** is the primary action; unattended execution through Craft Hub is available from its secondary menu.

## Start in Codex

Craft Hub opens the workspace's Primary project in Codex and copies the prompt to the clipboard. The copied prompt includes the explicit Craft Hub Workspace ID so the globally installed Craft Hub plugin can resolve the same workspace without relying on hidden active-workspace state. The user pastes the prompt into the new Codex task and sends it after reviewing it.

This is the default because the Codex app owns the task from the beginning. Conversation history, approvals, diffs, progress, and follow-up turns remain visible in the native client without transferring a live task between processes.

Codex does not currently expose a documented desktop automation interface for a third-party application to create a native app task, inject a prompt, and submit it. The supported `codex app <path>` launcher opens a project, so Craft Hub keeps submission as an explicit user action instead of relying on accessibility scripting or private IPC.

For a multi-project workspace, the Primary project is the directory opened in Codex. The selected-project list is applied automatically only to background runs; access to any additional paths in the native app remains governed by Codex configuration and approvals.

## Run in the Craft Hub background

The secondary action uses the Codex SDK to run the prompt against all selected project roots for which Craft Hub execution is authorized. Craft Hub records the task, streams its status, and retains the resulting Codex thread ID.

Use this mode for unattended or multi-project work. While its turn is active, the SDK process owns the local thread. Opening that same thread in Codex may therefore report that it is already open in another application. Craft Hub should offer **Open in Codex** after the task finishes or is stopped and the runner has released it.

## Why both modes exist

| Need | Preferred mode |
| --- | --- |
| Watch and steer work in the native Codex app | Start in Codex |
| Review the prompt before submission | Start in Codex |
| Run unattended or across selected project roots | Craft Hub background |
| Aggregate task status in Craft Hub | Craft Hub background |
| Continue a completed background task in Codex | Open the released thread |

Codex App Server is a protocol for building a rich Codex client; it does not turn a separately launched App Server process into a remote-control endpoint for the Codex desktop app. Craft Hub therefore keeps the runtime behind an adapter and does not imitate Codex's conversation UI. See the official [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server) and [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk).

## Safety boundary

- Opening Codex never executes the prompt automatically.
- Clipboard content is limited to the explicit Craft Hub Workspace ID and the prompt the user entered.
- Opening a project in Codex does not require Craft Hub execution authorization; Codex owns its workspace access, sandbox, and approvals.
- Background execution still requires explicit Craft Hub execution authorization for every selected project.
- Project launch uses structured command arguments with `shell: false`.
- Craft Hub does not use AppleScript, accessibility automation, or undocumented desktop IPC to click Send.
