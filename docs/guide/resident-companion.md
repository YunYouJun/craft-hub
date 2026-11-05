# Optional resident companion

Current user-facing implementation: the local summary/capture integration described below. [ADR 0015](../adr/0015-use-an-on-demand-shared-runtime-for-cloud-capture.md) and [the on-demand runtime design](../plans/on-demand-shared-runtime.md) now have an isolated P0/P1 fixture backend with native XPC activation and idle exit. Production clients, shared login and Xiaomi Cloud creation remain pending.

Electron is the primary Craft Hub desktop interface. Optional Augma integration supplies a native menu-bar entry, quick-capture window, durable local draft and cached Today summary. Reuse Augma's composer and delivery flow; it is a separate application and stays usable while Electron is stopped.

## Connect

1. In Electron's macOS application menu, choose **Share Today Summary…** and select a local JSON file. The dialog explains what is shared. Existing Today source reads run once, without authorization, writes or AI requests on a source's behalf.
2. In Augma's menu-bar panel, choose **Select Summary…** in the Craft Hub section and select that file. A failed selection preserves the previous one. The existing Agent project connection remains independent and retains its original read scope.
3. **Open Main Interface** launches the installed Electron Craft Hub by bundle identifier. Use **Select Main Application…** for another distribution or acceptance copy. Old standalone native candidates are rejected. The export never supplies an executable or launch arguments.
4. **Quick Capture Window** opens the existing Augma composer in a native floating window. Menu and window edit the same draft and retain explicit sending. Closing the window keeps the draft; quitting Augma flushes it before exit.

Use Electron's **Refresh Shared Summary** to update the selected file. Successful `/api/workbench/today` reads also update an enabled export atomically, without extra source polling. The current Vue home assembles its own source results and does not call that snapshot endpoint; viewing or refreshing the home alone does not promise to refresh the companion file. **Stop Updating Shared Summary** removes the export preference and leaves the dated file intact. Disconnect in Augma to clear its selected path and in-memory summary; delete the export separately if desired. Moving the export requires selecting its new location in both applications.

## Summary contract v1

JSON contains `version: 1`, ISO-8601 `checkedAt`, `total`, `sourceCount`, `loadedSourceCount`, `completeSourceCount`, and up to five `items` with only `id`, `title` and `sourceTitle`. Exclude source inputs, action targets, account labels, credentials and filesystem paths. Source coverage describes the observed page, not the full account. Failed or disconnected sources do not become complete empty success. A summary is cached evidence, including while Electron runs.

Craft Hub writes with owner-only permissions and atomic replacement only after explicit sharing. Augma accepts bounded regular JSON files, rejects unknown versions and invalid coverage, keeps the prior summary on failed reload and displays its timestamp. This version adds no second runtime, background refresh or live task completion. A user-selected export is not an authoritative task store.

## Scope and verification

Keep the previous `apps/macos` candidate, profiles and native capture drafts intact. This does not migrate them or replace the native host's personal-cloud approval, Keychain or update behavior. The current Augma package targets macOS 26; macOS 15 compatibility needs separate work.

Regression checks cover export minimization, opt-in/restoration/stop, older snapshot ordering, authorization and cache-error isolation, invalid formats, cached reads across companion reinitialization and durable Chinese/multiline drafts. Real App acceptance must show: Electron starts and fully exits while the same Augma process survives; cached Today remains visible; capture still accepts input; Augma quits and relaunches with its saved draft; opening the full interface starts the selected Electron app. Record artifact and process identities, and close temporary sessions in `finally` without broad process-name termination.

## Local acceptance, 2026-11-04

An isolated arm64 Electron 45.2.1 app and the Augma Release binary passed the requested real-UI workflow: export one fixture work item through Electron's native menu, select that file in the native capture window, verify its title/time/coverage, quit Electron and all its Helpers while Augma PID 40282 survives, edit a Chinese/multiline/emoji draft, quit/relaunch Augma with Electron stopped and recover that draft plus the cached summary, then click **Open Main Interface** and observe a new Electron process and workbench. The export's permissions were `0600`; no task was sent to a real account. The source Augma draft hash was unchanged and the existing Craft Hub native daily-use instance was preserved.

Evidence is retained in the ignored `apps/macos/build/resident-companion-20261104/` directory: `ui/manifest.json`, `ui/electron-exit-check.json`, `ui/final-ui-check.json`, `ui/cleanup.json`, source fingerprints, test/build logs and both application bundles. The cleanup guard records PID, executable and start time, and uses `finally` plus signal handlers; all 19 recorded UI processes exited. The final Electron bundle, including the later explicit refresh menu and corrected update copy, also passed a separate isolated smoke launch and signature verification. Its main and Helpers were checked to have exited.

The actual menu-bar popover was not driven by this UI automation; the same `CraftHubCompanionSection` was verified in the capture window. The final explicit refresh menu has source/regression and packaged-startup coverage, rather than an additional manual click-through. Lowest-system, long-term daily use, real-account delivery, formal signing/notarization and login-start behavior are outside this batch. Existing native-host probe tests hit startup deadlines under parallel execution; their failure logs and isolated/serial rechecks are preserved separately rather than treating a retry as evidence that the parallel run passed.

## Additional capture destinations

Augma can adapt another provider behind its existing capture/durable-delivery flow. The current Craft Hub Xiaomi Cloud plugin declares remote reads and local backups only; no cloud note creation/upload is implemented. Adding that destination requires validating a supported write path, explicit account/content review and uncertain-result handling. When its runtime is unavailable, preserve the local draft rather than claiming successful delivery. This companion batch does not widen the read-only Agent grant, copy Xiaomi credentials or modify existing note backups.
