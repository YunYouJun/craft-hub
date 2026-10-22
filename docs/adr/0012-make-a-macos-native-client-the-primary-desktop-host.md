# ADR 0012: Make a macOS native client the primary desktop host

Date: 2026-10-22. Status: proposed. The maintainer set the direction; no native client code exists yet, and Electron remains the shipped host on every platform.

## Context

The maintainer uses Craft Hub almost entirely on macOS; Windows use is rare. The best macOS experience is now worth more than identical hosts on every platform.

The Electron host has reached its ceiling on macOS. The first window refinement (commit `99cd42b`) floats the sidebar over a clear titlebar and removes stacked tints, but these limits remain:

- Electron 44 exposes only `vibrancy`, the behind-window `NSVisualEffectView` material, applied to the entire window. It cannot use the macOS 26 Liquid Glass views, give the sidebar, toolbar and popovers different materials, or blend web text with the material the way native sidebar labels do.
- During live window resizing, web content re-lays out behind the native window frame and can visibly lag it.
- The surfaces a personal workbench is opened through most often — a menu bar item, a global quick-capture panel, App Intents and Shortcuts, Spotlight, widgets, actionable notifications — are unavailable or must be imitated.

The repository already separates what a native client needs:

- `packages/craft-hub` owns the project registry, capability discovery, trust, execution and persistence. It serves them over the local HTTP API and the `/api/events` stream. `startCraftHubServer` accepts `authorizeRequest` and `handleHostRequest` hooks for a host's access gate and adapter routes. AGENTS.md already requires editor and desktop clients to consume public runtime contracts.
- Marketplace plugins are declarative ([ADR 0006](./0006-separate-marketplace-plugins-from-host-plugins.md)), so their workbench blocks can be rendered by a client other than the web UI.
- The [Tauri host trial](../../apps/tauri/README.md) bundles its own Node executable and runs the runtime as a separate backend process. That backend guards every route with a one-use bootstrap URL and a session cookie, validates Host and Origin, and shuts down when its parent's pipe closes. A Swift/AppKit helper supplies native folder selection. A native host can reuse the guard and the process lifecycle.
- Most users of a developer workbench already have Node. The Electron host finds an external Codex CLI and its Node through fixed GUI search rules (`guiToolDirectories` in `apps/desktop/src/codex-executable.ts`): absolute `PATH` entries, `~/.local/bin`, Homebrew, pnpm, and fnm installations. It does not run shell startup scripts. The runtime's only native module, `node-pty` 1.1.0, is built on node-addon-api with one prebuild per platform, so a single build loads on every supported Node major. The workspace declares `^22.18.0 || ^24.11.0 || >=26.0.0`; the runtime package does not yet declare its own range.

Moving the Electron host is still real work:

- The Electron main process runs the runtime server in-process, along with Node-side services: Codex SDK execution and activity monitoring, the personal cloud controller, the `safeStorage`-backed device vault, host extensions, and host plugin loading such as the Microsoft To Do transport. It also owns the operating-system integration: menus, global shortcuts, deep links and single-instance handling, updates, editor and terminal launching, and window state.
- The web UI uses 47 members of `window.craftHubDesktop`. `main.ts` registers 42 IPC handlers, and `host-extensions.ts` registers 6 more.
- The web UI has 123 Vue components, about 19,000 lines. Rewriting it at once would stop releases for months.

[ADR 0011](./0011-focus-on-machine-setup-and-environment.md) also requires the setup workbench to open on a machine without Node. A host may rely on external Node only if it provides an independent bootstrap view first. A native window can be that view because it starts before any Node process.

## Decision

1. **A Swift/SwiftUI client is the primary macOS host.** It uses AppKit where SwiftUI falls short, and new desktop-specific capabilities are built for it first. It is built with the macOS 26 SDK so standard sidebars, toolbars and controls adopt Liquid Glass. On earlier supported versions they fall back to the system's previous appearance.
2. **The TypeScript runtime stays the single source of truth.** The native app runs the runtime as a sidecar process that it owns. The client reaches it only through the public local API and event stream. Swift does not reimplement the registry, discovery, trust, execution or persistence.
3. **The sidecar prefers the user's own Node.** The app does not bundle Node. At each launch, before any Node process exists, the native host resolves one executable in this order:
   1. A Node path the user set explicitly in settings.
   2. A compatible Node already on the machine, found by the same fixed GUI search rules as the Electron host. The host does not run shell startup scripts or depend on version-manager shims that need a shell environment.
   3. A private Node managed by Craft Hub in its own data directory.

   A Node is compatible when it satisfies the runtime's declared range, matches the CPU architecture, and answers `--version` within a short timeout. The selected path and version appear in diagnostics. When the previous choice disappears or becomes incompatible, the host falls back to the next choice and says so. The sidecar starts with variables that load extra code, such as `NODE_OPTIONS` and `NODE_PATH`, removed.

   With no compatible Node, the native bootstrap view still opens and explains what is missing. It installs the private Node only after the user confirms, verifies the download against the official checksums, and never adds it to `PATH` or replaces the user's Node. Installing Node globally remains a reviewed software-center action.
4. **Node-side host services move below the hosts.** The Codex SDK integration, personal cloud, host extensions and host plugin loading leave the Electron main process for a host backend that runs in the sidecar, so both hosts share one implementation. Operating-system integration stays with each host: menus, shortcuts, deep links, updates, secure storage, dialogs and application activation. Launching fixed external applications with `shell: false` may live in either layer, but each launch has one owner.
5. **Migration is incremental.** The native shell owns the window chrome from its first build: sidebar, toolbar, menus and command palette. Its content area hosts the existing web UI in a `WKWebView` running in an embedded mode until each surface is ported. Surfaces are ported in order of daily use. Declarative plugin blocks get native renderers, and any unported block falls back to the web renderer.
6. **Electron is the Windows and Linux host, in maintenance mode.** It keeps the same web UI and runtime and receives their changes, but no new desktop-only features. The normal-browser workbench stays supported. Replacing Electron on those platforms, for example with Tauri, needs its own decision.
7. **The safety boundary does not change.** Projects start `untrusted`, and execution stays `command` plus `args` with `shell: false` in the project working directory. The native client never executes project commands itself; every execution goes through the runtime.

## Phased plan

Each phase ends with a go/no-go review. A phase does not start until the previous one meets its acceptance. The [macOS native client goal](../plans/macos-native-client.md) defines when the switch is complete, the interaction acceptance criteria and the milestones.

### Phase 0: Prepare shared seams in TypeScript

- Extract the Node-side services from `apps/desktop/src/main.ts` into a host backend that the Electron host and a sidecar entry can both start. Reuse the lifecycle and guard of `apps/tauri/backend`.
- Define an authentication contract for clients that are not browsers, so a native client — and the MCP and agent clients the Tauri trial left blocked — can connect without a browser cookie.
- Specify the desktop bridge as a versioned contract grouped by concern: navigation and events, application launching, dialogs, updates, cloud, and Codex. This replaces the implicit set of 47 members.
- Declare the runtime's supported Node range in the runtime package and run its tests on each supported major.
- Write the Node search rules down as shared fixtures. Node is resolved before any Node process exists, so the native host needs its own Swift implementation. Both implementations must pass the same fixtures as `guiToolDirectories`.

Acceptance: Electron ships on the extracted backend without behavior changes. Discovery, trust and execution tests are unchanged and passing.

### Phase 1: Native shell spike

- A SwiftUI app with a `NavigationSplitView` sidebar, toolbar and application menu.
- A Node sidecar started on the resolved executable, with its lifetime tied to the app through the parent pipe, plus the native bootstrap view for machines without a compatible Node.
- A `WKWebView` content area showing the web UI in embedded mode. Bridge methods cover folder selection, external links, the clipboard, theme and locale.

Acceptance: the maintainer uses it as the daily host for one week. Cold start, memory, and installed and download sizes are measured against the Electron app with the same functional scope, following the comparison rule in the Tauri trial. Electron's frameworks are about 285 MiB of the current 335 MiB app ([package size](../research/desktop-package-size.md)). The native app ships no Node, so the comparison counts its backend resources and reports the private Node download size separately. Any gap that blocks daily use is recorded.

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

This decision does not add native code, change the Electron host or remove the Tauri trial.

## Open questions

1. **Minimum macOS version:** 14, 15, or 26 only. The proposal is 15.
2. **Node resolution:** whether to prefer the user's default Node or the newest compatible one, whether shims from Volta, asdf or mise are supported, where the private Node comes from and how it is upgraded, and whether a downstream distribution may still bundle Node. Proposed fallback for Node set up only through shell startup files, such as nvm, Volta, asdf or mise: when the fixed rules find no compatible Node, the bootstrap view offers a **Read PATH from login shell** action. Only a user click triggers it, never a launch. It runs the user's login shell once, non-interactively and with a timeout, and reads only `PATH`. A Node found there passes the same compatibility checks and is saved as the user's explicit path (choice 1), so the shell is not run again. Still open: which shells to support, the timeout, and how to tell the user that their startup files will run.
3. **Client authentication:** the contract shape, such as a token handed over the parent pipe, and how MCP and agent clients adopt it.
4. **Data continuity:** the runtime data directory and Electron's Chromium profile currently share `~/Library/Application Support/Craft Hub`. Both hosts must not run against the same runtime state at once. Device vault and personal cloud keys need a migration path.
5. **App identity:** the same app name and bundle identifier replacing Electron, or a separate app side by side during migration, and which app owns the `craft-hub:` URL scheme meanwhile.
6. **Embedded web mode:** which web chrome is hidden, and how the native sidebar and the web router stay in sync — URLs, bridge messages, or both.
7. **Host extensions:** dynamic Node host plugins run in the sidecar. Can they contribute anything beyond declarative blocks to the native UI?
8. **Codex integration:** keep the SDK in the sidecar, or launch the external CLI from the native host. Where the activity hooks live.
9. **Tauri trial:** retire it, or keep it as the candidate to replace Electron on Windows and Linux.

## Community references

Checked on 2026-10-22. No project found combines capability discovery, trust-gated execution, environment readiness and a native shell, so these are references, not dependencies.

- [electron-liquid-glass](https://github.com/Meridius-Labs/electron-liquid-glass) inserts `NSGlassEffectView` behind Electron web content on macOS 26. It needs a transparent window without `vibrancy`, relies on a reverse-engineered API, and marks its extra variants private and unfit for production. It suits an Electron-phase experiment, not a replacement for this decision. Qt, Rust and Flutter wrappers use the same approach.
- [Electrobun](https://github.com/blackboardsh/electrobun) pairs a Bun main process with the system WebKit view. The UI stays web-based, and moving the runtime from Node to Bun would need `node-pty` and the Codex SDK re-verified. Not adopted.
- [fix-path](https://github.com/sindresorhus/fix-path) and [shell-env](https://github.com/sindresorhus/shell-env) read `PATH` from the login shell, which is how many Electron apps find tools. It is the basis of the opt-in fallback in question 2, not the default, because it runs the user's startup files.
- [Applite](https://github.com/milanvarady/Applite), a SwiftUI front end for Homebrew Casks, is a reference for a native software center.
- [Project Launcher](https://github.com/PiotrChr/launcher), a native menu bar app that starts and supervises local projects, is a reference for the menu bar panel and process status.
