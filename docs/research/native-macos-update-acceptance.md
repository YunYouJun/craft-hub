# Native macOS update acceptance — 2026-10-22

**PASS: public Sparkle N → N+1 download, installation and relaunch.**

| Item | N | N+1 |
| --- | --- | --- |
| Release | [native-v0.0.1-alpha.6](https://github.com/YunYouJun/craft-hub/releases/tag/native-v0.0.1-alpha.6) | [native-v0.0.1-alpha.7](https://github.com/YunYouJun/craft-hub/releases/tag/native-v0.0.1-alpha.7) |
| Source commit | `5839a3a7471666f6cdb8da8e9b1f8376bb5345b9` | `320dcf4214dde43708f57f971e7b0e2b2eac89ad` |
| CFBundleVersion | `0.0.1006` | `0.0.1007` |
| ZIP SHA-256 | `bf7e778998e1f3126cbbb8fc443cccf4b8e5c7b280086af6ce79405b556ca262` | `1bbbc9f0ab8a5b420c37bb598ed25afe86b07bea590b537d88003889d0f93a94` |

Test environment: Apple silicon, macOS 26.6.2 (25G83), user-writable Applications installation. Both releases retain bundle ID `dev.craft-hub.macos-prototype` and Developer ID team `QT792GAY4C`.

## Verified

- Both ZIPs passed Developer ID signature verification, notarization ticket validation and Gatekeeper assessment (`Notarized Developer ID`). Hardened Runtime is enabled.
- The public HTTPS appcast matched the release asset byte for byte and passed Sparkle's official Ed25519 feed verification. The installed public key matches both releases. The initial public ZIP also matched the verified CI artifact byte for byte.
- Alpha 6 showed Sparkle's standard error while the initial feed was not yet deployed, then successfully retried and reported no update. Manual checks also worked with automatic checks disabled.
- Alpha 6 offered build `0.0.1007` while running `0.0.1006`. Sparkle downloaded the public update, reached **Ready to Install**, and completed **Install and Relaunch**. No manual replacement of the installed app was used for this upgrade.
- The relaunched bundle reports `0.0.1-alpha.7` / `0.0.1007`, remains signed and notarized, and reports **You're up to date** on another check.
- All seven existing state files remained byte-identical by SHA-256, covering the project registry, workspace bindings, settings schema, host extension state, connection metadata and capture state. No private state contents are included in this report. Project selection and its untrusted status were retained.
- Automatic-check and automatic-download preferences remained enabled after relaunch. These preferences also survived an ordinary Alpha 6 quit/relaunch before upgrading.
- Process sampling observed the old sidecar exit before the new sidecar started (about 1.0 seconds between observed states). The old app and previously recorded runtime/connector processes exited.
- Required cross-platform CI, Swift tests, native packaging and isolated signature-tampering checks passed before release. See [implementation CI](https://github.com/YunYouJun/craft-hub/actions/runs/39790634446), [Alpha 7 CI](https://github.com/YunYouJun/craft-hub/actions/runs/39791623620), [Alpha 6 release](https://github.com/YunYouJun/craft-hub/actions/runs/39791527451) and [Alpha 7 release](https://github.com/YunYouJun/craft-hub/actions/runs/39793908495).

## Additional acceptance — 2026-10-23

**PASS: running-command cancellation, Remind Me Later, Skip This Version, and app-scoped offline/recovery at the update-check stage.**

The first three scenarios used an unmodified, Developer ID signed Alpha 6 copy in a separate writable Applications directory and the public Alpha 7 feed/archive. The installed Alpha 7 application was retained. No release assets or production feed contents were changed.

| Scenario | Action and observed result |
| --- | --- |
| Remind Me Later | Dismissed the Alpha 7 offer; Alpha 6 remained usable and no skipped-version preference was written. After quitting, backdated only `SULastCheckTime` to make the next scheduled check due and temporarily disabled automatic downloading. Relaunch fetched and verified the public feed. **Check for Updates** brought the pending reminder into focus without another network check (the last-check time stayed unchanged). |
| Skip This Version | The UI persisted `SUSkippedVersion=0.0.1007`. After another due-check fixture and relaunch, the signed feed was fetched, the last-check time advanced, the skip remained, and no update was offered. An explicit manual check fetched the feed again, cleared the skip and offered Alpha 7. Manual checks overriding a skip are Sparkle's intended behavior. |
| Cancel restart with a running command | Started a disposable local `npm run heartbeat` task, downloaded Alpha 7 and selected **Install and Relaunch**. The native busy-work alert appeared. **Cancel** retained Alpha 6, the app PID, sidecar PID and heartbeat PID. Heartbeat samples advanced from 34 to 87 with the same task process. No forced termination or replacement occurred. |
| Retry after the task ends | The heartbeat task completed normally with exit code 0. A manual check returned directly to **Ready to Install**, reusing the downloaded update. **Install and Relaunch** then upgraded the copy to build `0.0.1007`; old app/sidecar processes exited. Strict code-signature verification and Gatekeeper assessment passed (`Notarized Developer ID`). |
| Offline update check and recovery | An isolated, ad hoc signed test application compiled the unchanged release `NativeUpdater.swift`, configuration and localization sources and loaded the release's Sparkle 2.10.0 framework. A test-only `URLProtocol` in that application's URLSession configuration injected `NSURLErrorNotConnectedToInternet (-1009)` only for its feed requests. Sparkle showed its standard retrieval error. Dismissing it restored `canCheckForUpdates=true`. Removing the fault in the same process allowed a real HTTPS request, successful Ed25519 feed verification and the Alpha 7 offer. No restart was needed. |

Scheduling was accelerated by changing the test last-check timestamp; this was not a wall-clock 24-hour wait. The network scenario is an application-scoped transport simulation, as requested, rather than a physical interface outage or a Developer ID installation test. No system proxy, DNS, Wi-Fi or firewall setting was changed. The fixture does not bypass HTTPS or Sparkle signature verification.

After testing, the temporary project's trust and registration were removed, the prior project selection and automatic-check/download preferences were restored, and the original Alpha 7 app was reopened. All seven pre-existing state files match their pre-test SHA-256 values. No connected-service tasks were created or modified. Test evidence remains local: preference snapshots, heartbeat samples, process/version snapshots, Sparkle error/signature logs, fixture source and source hashes; private state contents are excluded from this report.

Repository verification for the documentation handoff passed: `pnpm lint`, `pnpm typecheck`, `pnpm test --run` (2,098 passed, 3 skipped), `pnpm build`, and `swift test --package-path apps/macos` (35 passed). No production source changes or new release binaries were needed. This Alpha revision predates the `lint:macos` script.

## Dependency audit follow-up — 2026-10-23

The documentation PR's dependency audit identified DOMPurify 3.4.16. The follow-up retains the sanitizer and upgrades it to 3.4.17, the patched version for [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7) and [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr). The preview uses string input/output without the affected `IN_PLACE`, template mode or hooks; the package audit alone did not establish exploitability in this application.

Browser regression testing also found that tab/newline-obfuscated URL schemes could be mistaken for local document paths. The preview now recognizes those schemes and discards document-authored `data-local-path` attributes before generating its own scoped navigation metadata. The tests retain the production sanitizer and verify executable content removal, dangerous links, malformed HTML reparsing, valid images, safe HTML, and project/plugin navigation. An unsanitized event-handler control verifies that the browser environment can execute the test payload. CI runs the browser suite without retries via `pnpm test:browser`.

The dependency and preview changes apply to subsequent builds. The published Alpha 6/7 binaries and their source commits, hashes, signatures and update acceptance evidence above are unchanged.

Local follow-up verification passed: production dependency audit at the high-severity threshold, lint, TypeScript and Vue type checks, 2,099 unit tests (3 existing skips), application and documentation builds, and all 48 browser checks (16 scenarios each in Chromium, Firefox and WebKit; no retries). A separate component preview at desktop and narrow viewports also verified expansion, scoped navigation, blocked links and stripped click handlers with no browser console errors. Browser-engine coverage does not replace acceptance in the shipped Electron or macOS WKWebView host.

## Coverage limits

Intel updates, operation on the minimum supported macOS 15, sustained daily use, and live cancellation specifically during agent tasks or capture saves remain unverified. This extension exercised a running command and check-stage network loss; archive-download interruption and a physical network outage were not induced. Modified ZIP/feed and mismatched-key rejection retain their isolated artifact/unit coverage rather than production-feed fault injection.
