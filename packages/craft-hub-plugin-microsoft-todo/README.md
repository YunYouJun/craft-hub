# Microsoft To Do host plugin

The Electron distribution includes this plugin with read access by default and separately authorized task creation and completion. It starts the pinned `@softeria/ms-365-mcp-server` connector using the bundled runtime; no global Node installation or agent session is required. Other local hosts can register `createMicrosoftTodoPlugin()` through the standard Host Plugin API.

## Connect and read

1. Open **Overview → Microsoft To Do → Connect account**. An optional account email selects a specific locally cached Microsoft account.
2. Approve the operating system's credential-access prompt if shown. On macOS, choose **Always Allow** for the installed Craft Hub app to remember the approval; **Allow** is temporary. If the connector needs a new login, open the displayed Microsoft link and enter its device code. The page checks connection status until the code expires or authorization succeeds.
3. Return to **Overview**. The source shows connection status, all owned non-shared lists including empty lists, unfinished tasks, importance, due dates and the last successful refresh time. Use the original list buttons and the All / Important / Overdue / Planned / Due today smart categories together, or search list and task names. Tasks are grouped by their original lists; expand the preview to see all loaded items.
4. Use **Refresh Microsoft To Do** to fetch a fresh snapshot. A failed refresh retains the current screen's last successful results and marks them stale. Disconnecting clears those results. **View all** opens the integration's full task view.

**Display options** lets you switch between grouped and flat tasks, choose a compact layout, and hide empty lists. These preferences apply to home task lists and persist in local `workbench.home.workItems` settings; they do not change Microsoft lists or tasks. Smart category counts refer to loaded unfinished personal tasks. Deadlines without a recognized timezone are not guessed into the overdue category.

**Planned** includes tasks with a due date or an enabled reminder, following Microsoft To Do's smart-list meaning. Disabled reminders are omitted even if Graph retains their previous reminder time. Reminder values retain the provider's local time and timezone independently of deadlines. **Due today** includes tasks whose deadline falls on the current calendar day; reminder-only tasks remain in Planned.

The adapter follows all list and task pages supported by the pinned connector, with four concurrent task-list reads. Unknown or repeated cursors fail the snapshot instead of silently reporting incomplete data as complete. Task identity includes the account, list and task ID. Shared lists are excluded because this version does not infer task ownership within shared lists. Locally edited tasks appear after the native client synchronizes them to Microsoft Graph.

## Authentication and storage

The read connector exposes only task-list reads and authentication, requests `Tasks.Read`, and owns its local encrypted token cache. Craft Hub stores its enabled flag, selected account and task-creation preference in its operating-system data directory at `integrations/microsoft-todo/connection.json`. Device codes remain in memory. **Disconnect Craft Hub** disables this integration without logging other local connector clients out.

Desktop hosts ship this plugin but load it only when **Microsoft To Do** is enabled under host extensions in plugin management; a host that already has an enabled connection turns it on automatically. Connectors start on the first call and stop after an idle period: 10 minutes for reads, 2 minutes for writes. The host also closes them on disconnect or application shutdown. A restarted connector can show the keychain prompt again unless you chose **Always Allow**. Other hosts keep the 30-second default unless they pass `idleTimeoutMs`, or use `keepAlive: true` and own its shutdown. An unexpectedly stopped connector is recreated on the next read.

macOS remembers keychain approval against the application's code signing identity. Local packaging pins an available application signing certificate; see [local signing](../../docs/guide/desktop-release.md#local-builds-and-keychain-approval). Moving from an ad hoc build to the pinned certificate can require one fresh **Always Allow** approval. Certificate changes, a locked or reset keychain, or revoked access can still require system confirmation. No keychain ACL is broadened and credentials are never exported to bypass the prompt.

Personal Microsoft accounts use the `consumers` tenant by default. A local host may set `CRAFT_HUB_MICROSOFT_TODO_TENANT_ID` for another supported tenant; organizational accounts and their consent policies require separate validation. Hosted workbenches cannot access this local connection. Neither native application databases nor agent configuration files are read.

Opening a task uses the official Microsoft To Do website; this version does not fabricate per-task deep links. Apart from completion (below), it does not edit existing tasks.

The integration toolbar also offers **Open locally**, with a compact shortcut beside the home task list actions. Local macOS hosts launch the installed Microsoft To Do app and fall back to the official website when it is unavailable. Other platforms and hosted workbenches use the website. Opening the app does not select or modify a task.

## Quick capture and today’s focus

Press **Command/Control + Shift + Space** while the desktop app is running, or choose **Quick capture** on Home. Enter a thought such as `明天下午三点跟进发布 #任务 !重要`, review the title, target list, due date and reminder, then save. **AI understanding** handles richer wording through the host’s configured text-assistance adapter. Ambiguous deadlines remain reviewable. The first version creates one task per capture; Microsoft due dates retain the calendar day; explicit times enable a separately reviewable reminder. Date-only captures do not enable reminders, and recurrence is not created.

Use **Authorize task writes** once to consent to `Tasks.ReadWrite`. A separate narrow connector permits only list reads, `create-todo-task` and `update-todo-task`; the normal reading connection continues to work if write consent is unavailable. The adapter only writes to the reviewed account’s owned, non-shared list and requires the explicit confirmed action. It does not expose deletion or general editing tools. The desktop closes both connections on shutdown.

## Complete tasks

Once write access is authorized, each home task row starts with a circle. Click it to mark that task completed in Microsoft To Do. The click is the confirmation for this single task; nothing else about the task changes. The task leaves the unfinished list without reloading other lists, and **Undo** reopens it with its previous status, such as In progress. A failed write keeps the task in place and explains why. Cached read-only snapshots and accounts without write access show the plain task icon instead.

The adapter implements the runtime's `work-items.update-status` operation with the one-step contract for providers without workflow transitions: `statusCategory` is `done` or `open`, and reopening may name a native open status to restore. It sends only `{ status }` to Graph, after re-checking the account and that the list is owned and private.

Drafts and preferred lists remain in the local browser/desktop profile. Creation receipts live in `integrations/microsoft-todo/captures` under the Craft Hub data directory. A receipt records the request fingerprint and created task identity so retries after a lost response or restart cannot silently duplicate tasks. An uncertain result requires checking the source before a new capture intent. Credentials remain in the connector’s encrypted cache.

**Today’s focus** combines loaded personal unfinished work from connected sources. The baseline explains due-date and priority signals. **AI analysis** is user-triggered, sends at most 80 candidates balanced across integrations to the configured assistant, and returns up to five recommendations with reasons and next steps. The view discloses missing/partial source coverage, discards recommendations when the snapshot changes, and never changes source priority or status. Desktop assistance uses the existing Codex login and the explicit workbench model preference, or the CLI-compatible default `gpt-5.5` at low reasoning effort. Browser-only hosts without an adapter retain capture previews and baseline ranking.

## Artwork

The integration uses the original Microsoft To Do macOS app icon, extracted unchanged from the 128px PNG representation of `AppIcon-Release.icns` in the signed `com.microsoft.to-do-mac` application. It is bundled as a data URI so the homepage, integration navigation and source labels share the same artwork offline. The artwork belongs to Microsoft; [Microsoft To Do on the Mac App Store](https://apps.apple.com/app/id1274495053).
