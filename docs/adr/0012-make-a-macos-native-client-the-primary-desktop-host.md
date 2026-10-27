# ADR 0012: Make a macOS native client the primary desktop host

Date: 2026-10-22. Status: accepted for implementation. The maintainer's native-client Goal authorizes the engineering work. Electron remains the shipped default host; daily-use acceptance, real-data migration and the distribution switch retain their separate gates.

Update, 2026-10-22: the `apps/macos` prototype (M1) runs the shared runtime sidecar from `apps/desktop/src/sidecar.ts`, which Electron and the native host compose through `createDesktopHostRuntime`. The Tauri trial is retired and removed (question 9). Native environment inspection and software browsing now consume the public API through a separate per-process bearer token delivered over the parent pipe. Configuration and installation remain in the embedded workbench; this does not complete the M0 decisions or M1 daily-use acceptance.

Update, 2026-10-27: routine CI retains cross-platform Electron/runtime build and test jobs and a Node 26 compatibility job. Native macOS jobs and the standalone Node 22/24 compatibility jobs are removed to reduce repeated CI runs; other jobs continue using `.node-version`. The supported Node range remains 22, 24 and 26; native formatting, Swift/Node interoperability, packaged app and signature checks remain local acceptance requirements. The `native-v*` release workflow is retained. This supersedes the routine CI and native formatting scheduling described below; dated validation evidence remains unchanged.

## M0 implementation decisions (2026-10-22)

- **Node support:** bound the published range to majors 22, 24 and 26, with the existing minimums 22.18 and 24.11. The Node compatibility CI job tests all three majors; local and hosted results are recorded separately. New majors are added with evidence rather than accepted automatically. The [official release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) currently places Node 27 in a future release phase.
- **Fixed search:** preserve the caller's absolute PATH order, then explicit PNPM_HOME, common GUI directories (including the default pnpm directory), and fnm roots. Prefer each fnm default alias before its numerically sorted installations. Ignore relative manager roots and noncanonical version directory names. Electron and Swift consume the same fixture at `apps/desktop/test/fixtures/node-host-contract.json`.
- **Bridge:** expose v1 metadata in both hosts and retain optional method detection for older clients. The [inventory](../guide/desktop-bridge.md) is the migration checklist; unimplemented methods stay absent.
- **CI:** retain cross-platform Electron/runtime checks and build/test/signature-check the native app on `macos-26`. Native jobs build with the workspace's pinned Node, then select Node 22, 24 or 26 for Swift interoperability and packaged management, extension, migration, instance and identity checks. Verifiers invoke the selected `node` directly. Local 22.23.1/26.0.0 results for the current candidate are recorded in the [acceptance checklist](../guide/native-candidate-acceptance.md#当前候选-node-兼容复验2026-10-23); the full Node 24 baseline is recorded separately. CI configuration and local success do not establish a successful hosted run.

- **Minimum system:** macOS 15, built with the macOS 26 SDK. Platform appearance falls back through system controls; features introduced after 15 require availability guards. A successful build on 26 does not replace the minimum-system smoke test.
- **Identity and data:** keep `dev.craft-hub.macos-prototype`, `Craft Hub Prototype.app` and `~/Library/Application Support/Craft Hub Prototype` for the native candidate and its Sparkle update chain. Electron keeps `com.yunyoujun.craft-hub` and its existing profile. Never point the two hosts at a live shared data directory. Migration will require both writers stopped, a versioned backup and preflight, then a copy into the native profile, validation, and an atomic completion journal. Keep the Electron source untouched for rollback. Keychain/vault migration is a separate authenticated step; browser sessions are not copied. A later identity rename requires an explicit update-chain and Keychain migration.
- **URL ownership:** candidates coexist without automatically replacing Electron's `craft-hub:` registration. Native links remain navigation-only; activating the public scheme belongs to the explicit default-host handover. A candidate scheme can be tested independently.
- **Node compatibility:** inspect version and actual process architecture together using fixed Node arguments, a 3-second deadline, a 4 KiB output limit, and a separate process group. Clean up descendants even if a probe ignores TERM or retains stdout. Node must match the app/addons, including an x64 app under Rosetta. Report why an explicit path was rejected and which fallback was chosen. Never log probe output.
- **Node bootstrap policy:** fixed discovery prefers the user's PATH/default alias over a newer installation. Version-manager shims must work with the restricted probe environment. The opt-in login-PATH action supports `/bin/zsh` and `/bin/bash`, non-interactive login mode, with a 5-second group deadline and bounded output. Its UI explains that startup files run; other shells can use explicit executable selection. Private Node uses a release-pinned supported LTS from `https://nodejs.org/dist/`, verified against both the compiled-in hash and that exact release's official SHA-256 manifest before extraction. Explicit upgrades retain the old selection until the new sidecar passes its handshake and clean shutdown using disposable state. It stays outside PATH. The 2026-10-23 implementation pins 24.22.1. Checksum-verified installation probes and sidecar preflight run at the final, still-unselected immutable path; its first executable probe allows 30 seconds for first-launch preparation, while ordinary discovery remains bounded to 3 seconds. Automated validation, arm64 download, and actual x64/Rosetta bootstrap/settings download, activation and restart passed. Minimum-system, real Intel hardware, login-PATH/file-selection/rollback UI and accessibility remain separate acceptance items. See [bootstrap and recovery](../guide/native-node-runtime.md).
- **Formatting:** `apps/macos/.swift-format` is the Swift style (2 spaces, 120 columns). `pnpm lint:macos` runs in native CI; `pnpm format:macos` applies it locally.

These decisions authorize implementation, not completed migration or release acceptance. Electron performance baselines, hosted CI, minimum-system runtime checks and migration/release exercises are recorded separately in the Goal.

## Context

The maintainer uses Craft Hub almost entirely on macOS; Windows use is rare. The best macOS experience is now worth more than identical hosts on every platform.

The Electron host has reached its ceiling on macOS. The first window refinement (commit `99cd42b`) floats the sidebar over a clear titlebar and removes stacked tints, but these limits remain:

- Electron 44 exposes only `vibrancy`, the behind-window `NSVisualEffectView` material, applied to the entire window. It cannot use the macOS 26 Liquid Glass views, give the sidebar, toolbar and popovers different materials, or blend web text with the material the way native sidebar labels do.
- During live window resizing, web content re-lays out behind the native window frame and can visibly lag it.
- The surfaces a personal workbench is opened through most often — a menu bar item, a global quick-capture panel, App Intents and Shortcuts, Spotlight, widgets, actionable notifications — are unavailable or must be imitated.

The repository already separates what a native client needs:

- `packages/craft-hub` owns the project registry, capability discovery, trust, execution and persistence. It serves them over the local HTTP API and the `/api/events` stream. `startCraftHubServer` accepts `authorizeRequest` and `handleHostRequest` hooks for a host's access gate and adapter routes. AGENTS.md already requires editor and desktop clients to consume public runtime contracts.
- Marketplace plugins are declarative ([ADR 0006](./0006-separate-marketplace-plugins-from-host-plugins.md)), so their workbench blocks can be rendered by a client other than the web UI.
- The Tauri host trial, since retired, bundled its own Node executable and ran the runtime as a separate backend process. That backend guarded every route with a one-use bootstrap URL and a session cookie, validated Host and Origin, and shut down when its parent's pipe closed. A Swift/AppKit helper supplied native folder selection. A native host can reuse the guard and the process lifecycle.
- Most users of a developer workbench already have Node. The Electron host finds an external Codex CLI and its Node through fixed GUI search rules (`guiToolDirectories` in `apps/desktop/src/codex-executable.ts`): absolute `PATH` entries, `~/.local/bin`, Homebrew, pnpm, and fnm installations. It does not run shell startup scripts. The runtime's only native module, `node-pty` 1.1.0, is built on node-addon-api with one prebuild per platform, so a single build loads on every supported Node major. The workspace and runtime package declare `^22.18.0 || ^24.11.0 || ^26.0.0`; future majors require an explicit compatibility review and CI coverage before extending the range.

Moving the Electron host is still real work:

- The Electron main process runs the runtime server in-process, along with Node-side services: Codex SDK execution and activity monitoring, the personal cloud controller, the `safeStorage`-backed device vault, host extensions, and host plugin loading such as the Microsoft To Do transport. It also owns the operating-system integration: menus, global shortcuts, deep links and single-instance handling, updates, editor and terminal launching, and window state.
- The [desktop bridge v1 inventory](../guide/desktop-bridge.md) covers 63 members of `window.craftHubDesktop`, including metadata. It records actual support and ownership for Electron, the native host, and the browser fallback; tests keep the inventory aligned with the injected scripts.
- The web UI has 123 Vue components, about 19,000 lines. Rewriting it at once would stop releases for months.

[ADR 0011](./0011-focus-on-machine-setup-and-environment.md) also requires the setup workbench to open on a machine without Node. A host may rely on external Node only if it provides an independent bootstrap view first. A native window can be that view because it starts before any Node process.

## Decision

1. **A Swift/SwiftUI client is the primary macOS host.** It uses AppKit where SwiftUI falls short, and new desktop-specific capabilities are built for it first. It is built with the macOS 26 SDK so standard sidebars, toolbars and controls adopt Liquid Glass. On earlier supported versions they fall back to the system's previous appearance.
2. **The TypeScript runtime stays the single source of truth.** The native app runs the runtime as a sidecar process that it owns. The client reaches it only through the public local API and event stream. Swift does not reimplement the registry, discovery, trust, execution or persistence.
3. **The sidecar prefers the user's own Node.** The app does not bundle Node. At each launch, before any Node process exists, the native host resolves one executable in this order:
   1. A Node path the user set explicitly in settings.
   2. A compatible Node already on the machine, found by the same fixed GUI search rules as the Electron host. The host does not run shell startup scripts or depend on version-manager shims that need a shell environment.
   3. A private Node managed by Craft Hub in its own data directory.

   A Node is compatible when it satisfies the runtime's declared range, matches the CPU architecture, and answers the fixed version-and-architecture probe within a short timeout. The selected path and version appear in diagnostics. When the previous choice disappears or becomes incompatible, the host falls back to the next choice and says so. The sidecar starts with variables that load extra code, such as `NODE_OPTIONS` and `NODE_PATH`, removed.

   With no compatible Node, the native bootstrap view still opens and explains what is missing. It installs the private Node only after the user confirms, verifies the download against the official checksums, and never adds it to `PATH` or replaces the user's Node. Installing Node globally remains a reviewed software-center action.
4. **Node-side host services move below the hosts.** The Codex SDK integration, personal cloud, host extensions and host plugin loading leave the Electron main process for a host backend that runs in the sidecar, so both hosts share one implementation. Operating-system integration stays with each host: menus, shortcuts, deep links, updates, secure storage, dialogs and application activation. Launching fixed external applications with `shell: false` may live in either layer, but each launch has one owner.
5. **Migration is incremental.** The native shell owns the window chrome from its first build: sidebar, toolbar, menus and command palette. Its content area hosts the existing web UI in a `WKWebView` running in an embedded mode until each surface is ported. Surfaces are ported in order of daily use. Declarative plugin blocks get native renderers, and any unported block falls back to the web renderer.
6. **Electron is the Windows and Linux host, in maintenance mode.** It keeps the same web UI and runtime and receives their changes, but no new desktop-only features. The normal-browser workbench stays supported. Replacing Electron on those platforms needs its own decision.
7. **The safety boundary does not change.** Projects start `untrusted`, and execution stays `command` plus `args` with `shell: false` in the project working directory. The native client never executes project commands itself; every execution goes through the runtime.

## Phased plan

Each phase ends with a go/no-go review. Engineering proceeds on isolated candidate data after the preceding contracts and safety boundaries are verified; independent work can continue while hosted CI, minimum-system hardware, maintainer daily use or release credentials are unavailable. Those missing acceptance results remain open and prevent the default-host switch. The [macOS native client goal](../plans/macos-native-client.md) separates engineering delivery from the full switch and defines their acceptance criteria.

### Phase 0: Prepare shared seams in TypeScript

- Extract the Node-side services from `apps/desktop/src/main.ts` into a host backend that the Electron host and a sidecar entry can both start. Reuse the lifecycle and guard of the Tauri trial's backend, now `apps/desktop/src/sidecar-host.ts`.
- Define an authentication contract for clients that are not browsers, so a native client — and the MCP and agent clients that a session-cookie guard blocks — can connect without a browser cookie.
- Specify the desktop bridge as a versioned contract grouped by concern: navigation and events, application launching, dialogs, updates, cloud, and Codex. The versioned inventory replaces the implicit member list.
- Declare the runtime's supported Node range in the runtime package and run its tests on each supported major.
- Write the Node search rules down as shared fixtures. Node is resolved before any Node process exists, so the native host needs its own Swift implementation. Both implementations must pass the same fixtures as `guiToolDirectories`.

Acceptance: Electron ships on the extracted backend without behavior changes. Discovery, trust and execution tests are unchanged and passing.

### Phase 1: Native shell spike

- A SwiftUI app with a `NavigationSplitView` sidebar, toolbar and application menu.
- A Node sidecar started on the resolved executable, with its lifetime tied to the app through the parent pipe, plus the native bootstrap view for machines without a compatible Node.
- A `WKWebView` content area showing the web UI in embedded mode. Bridge methods cover folder selection, external links, the clipboard, theme and locale.

Acceptance: the maintainer uses it as the daily host for one week. Cold start, memory, and installed and download sizes are measured against the Electron app with the same functional scope, counting every resource each app needs for it. Electron's frameworks are about 285 MiB of the current 335 MiB app ([package size](../research/desktop-package-size.md)). The native app ships no Node, so the comparison counts its backend resources and reports the private Node download size separately. Any gap that blocks daily use is recorded.

### Phase 2: Native high-frequency surfaces

- Command palette, quick capture as a global panel, today focus, and the project list.
- A menu bar item, native notifications, and App Intents for opening a project and quick capture.

Acceptance: these flows no longer touch the web view. Keyboard focus, shortcuts and VoiceOver behave like system apps.

### Phase 3: Parity and distribution

- Port settings, the software center and the environment views. Add native renderers for the declarative plugin block types in use.
- Signing and notarization of the app and native modules such as `node-pty`. Download, verification and upgrade of the private Node. Native updates. Migration of encrypted keys from `safeStorage` to the Keychain. Handover of the URL scheme and single-instance behavior.
- Stop shipping the Electron build for macOS once a written parity checklist passes.

## Consequences

- Craft Hub gets real system materials and system integration on its main platform without forking runtime behavior.
- Windows, Linux and the browser keep working through the existing web UI.
- Two UI stacks coexist for a long time. Each user-facing feature needs an explicit decision about which hosts get it, and the platforms will diverge.
- The project needs Swift and SwiftUI skills, XCTest coverage and macOS CI runners alongside Vitest.
- During migration, the seams between native chrome and web content — focus, shortcuts, drag and drop, scrolling — are visible until the surfaces behind them are ported.
- Using the user's Node keeps the app small: the Electron frameworks go away without a Node runtime taking their place. In exchange, runtime behavior depends on which supported Node major the user has, which widens the test matrix. A user upgrading or removing Node becomes a new failure mode that the bootstrap view and diagnostics must make visible.

This decision does not by itself change the Electron host's behavior.

## Open questions

1. **Minimum macOS version:** decided as 15 above; runtime smoke testing on 15 remains required.
2. **Node resolution:** default/GUI priority, architecture, probe bounds, opt-in login PATH, private download/upgrade and explicit rollback are implemented. Actual x64/Rosetta bootstrap and settings download, private activation and restart are verified; complete login-PATH/file-selection/rollback interaction, minimum-system and real Intel hardware verification remain acceptance items. The local Xcode arm64 testing helper cannot load x64 test bundles, so Rosetta App evidence does not establish full x64 Swift test coverage. Corrupt receipts remain untouched and require manual recovery. Downstream bundled-Node policy is outside the community candidate's scope.
3. **Client authentication:** implemented for the native candidate as a bearer delivered in the v1 parent-pipe handshake. Browser sessions, native-only API routes and private Keychain operations remain separate; see the [versioned bridge contract](../guide/desktop-bridge.md) and [private channel](../guide/native-secure-storage.md). This is not a new authentication contract for unrelated MCP clients.
4. **Data continuity:** isolated candidates and stopped-writer copy/rollback are decided above. Offline preflight, shared client/exclusive migration leases, staged copying, idempotent receipts, preserved-edit rollback and journal recovery are implemented; see the [migration procedure](../guide/native-profile-migration.md) for its bounds and isolated rehearsal. Authenticated encrypted-key transfer, source consent and recovery are implemented; real Developer ID paired-host acceptance remains pending and release capability markers are disabled. Offline copying still blocks affected profiles. Public URL/default-host handoff and real-data migration retain separate gates; callers must keep all hosts and older CLI writers stopped throughout the operation.
5. **App identity:** keep the separate native candidate identity and update chain. The current candidate has profile-scoped primary ownership and a bounded, same-user navigation relay; native UI and sidecars hold interoperable migration leases across startup and shutdown. See [instance lifecycle](../guide/native-instance-lifecycle.md). Older candidate builds must be closed before reusing their profile. Electron retains the public scheme until an explicit handover. [Default-handler review and rollback](../guide/native-link-handover.md) are implemented behind a separate signed-release capability, disabled in ordinary candidates and the release workflow. Isolated-scheme system verification does not replace public-host acceptance.
6. **Embedded web mode:** implemented through embedded web presentation, validated navigation and the native bridge. Native destinations keep their own selection, supported plugin routes open native detail, and explicit full-page fallbacks preserve project/global scope. Late web routes must not replace current native navigation; see the [navigation and workbench contracts](../guide/desktop-bridge.md).
7. **Host extensions:** dynamic Node host plugins run in the sidecar after native review and registration, with loading deferred until restart. Native UI consumes public declarative contracts; arbitrary third-party native UI injection is not part of this candidate. Unsupported blocks retain the full-page fallback. See [host-extension review and lifecycle](../guide/native-management.md#外部宿主扩展).
8. **Codex integration:** SDK/task providers remain in the shared TypeScript host runtime. Editor/CLI handoff uses shared launch adapters, while native UI performs the review and OS activation. Activity hooks are profile-scoped, installed through explicit native review and monitored by the shared host service; see the [Codex activity guide](../guide/native-codex-activity.md).
9. **Tauri trial:** retired and removed on 2026-10-22. The native prototype runs the shared sidecar from `apps/desktop`, so nothing depended on the trial. Windows and Linux stay on Electron.

## Community references

Checked on 2026-10-22. No project found combines capability discovery, trust-gated execution, environment readiness and a native shell, so these are references, not dependencies.

- [electron-liquid-glass](https://github.com/Meridius-Labs/electron-liquid-glass) inserts `NSGlassEffectView` behind Electron web content on macOS 26. It needs a transparent window without `vibrancy`, relies on a reverse-engineered API, and marks its extra variants private and unfit for production. It suits an Electron-phase experiment, not a replacement for this decision. Qt, Rust and Flutter wrappers use the same approach.
- [Electrobun](https://github.com/blackboardsh/electrobun) pairs a Bun main process with the system WebKit view. The UI stays web-based, and moving the runtime from Node to Bun would need `node-pty` and the Codex SDK re-verified. Not adopted.
- [fix-path](https://github.com/sindresorhus/fix-path) and [shell-env](https://github.com/sindresorhus/shell-env) read `PATH` from the login shell, which is how many Electron apps find tools. It is the basis of the opt-in fallback in question 2, not the default, because it runs the user's startup files.
- [Applite](https://github.com/milanvarady/Applite), a SwiftUI front end for Homebrew Casks, is a reference for a native software center.
- [Project Launcher](https://github.com/PiotrChr/launcher), a native menu bar app that starts and supervises local projects, is a reference for the menu bar panel and process status.
