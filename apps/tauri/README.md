# Optional Tauri host trial

This macOS trial reuses the Vue workbench and the existing Node runtime. It evaluates the cost of replacing the Electron shell while keeping Electron as the default desktop host.

The app includes its own build-time Node executable, a bundled runtime, the current architecture's `node-pty` native module and one Web build. Startup does not depend on a system Node installation. It does not include the Codex SDK or CLI. Existing project execution still uses the runtime's explicit trust boundary; PTY removal requires a separate runtime migration.

## Run and verify

Install the repository's pnpm dependencies and a stable Rust toolchain. The host runner uses `rustc` and `cargo` from `PATH`, or the isolated `.tools/cargo` and `.tools/rustup` directories when they exist. Xcode command line tools are required on macOS. The trial targets macOS 13.5 or later because its bundled Node executable has that minimum deployment version; validation currently covers macOS 26.6.2 on Apple silicon.

From the repository root:

```sh
pnpm build:tauri
pnpm --filter @craft-hub/tauri-trial test:host
node apps/tauri/scripts/verify-backend.mjs
```

`build:tauri` creates `src-tauri/target/release/bundle/macos/Craft Hub Tauri Trial.app`. The bundle is signed ad hoc for local validation. Developer ID signing, notarization and a release updater are not implemented by this trial.

Set `CRAFT_HUB_TAURI_TRIAL_DIR` to an empty directory to run a disposable validation session. Otherwise, the app uses its own `dev.craft-hub.tauri-trial` application data directory. It does not migrate or read the Electron application's state or encrypted cloud keys. `CRAFT_HUB_DEVICE_CONFIG` is removed before the runtime starts, so inherited legacy delivery configuration cannot attach this trial to an existing broker.

The bundled backend verifier checks actual bundled Node startup, unauthenticated and cross-origin API rejection, Host validation, bootstrap replay rejection, Web bridge injection, a native clipboard action and backend shutdown after its parent pipe closes. It writes a short verification phrase to the system clipboard.

## Host boundary

The Rust host starts the bundled backend, opens its random IPv4 loopback origin, blocks navigation to other origins and denies new WebView windows. It holds a stdin pipe open for the backend's lifetime. Normal exit closes the pipe and waits for shutdown; a host crash or force quit also closes the pipe, causing backend cleanup.

The backend protects every runtime route and static asset using a one-use bootstrap URL followed by an HttpOnly, SameSite=Strict session cookie. It validates Host and browser Origin before dispatch. The limited native bridge additionally requires JSON and a custom same-origin header. URLs, tool identifiers and project identifiers are validated on the host; external launch arguments are passed to fixed executables with `shell: false`.

The existing optional `window.craftHubDesktop` contract supplies folder selection, Finder opening, HTTPS browser opening, saved Raycast/Orca tool handoff and clipboard text. A small bundled Swift/AppKit helper presents native folder selection and returns JSON paths, preserving multibyte text and paths containing newlines. HTTPS links targeting a new window open in the system browser; the host always denies the new WebView. The trial has no remote Tauri IPC permissions or general shell execution bridge.

## Remaining migration work

This is a shell and packaging experiment. Electron-specific host extensions, editor and terminal selection, deep links, single-instance behavior, cloud key migration, personal cloud integration, automatic updates and embedded Agent execution are not ported. The full session-cookie guard also prevents legacy MCP/agent connection clients from accessing routes with their own credentials alone. Those clients require a separately reviewed authentication contract before this host can replace Electron.

Marketplace package installation and arbitrary dynamic Node host plugins are not acceptance criteria for the trial. Bundled third-party packages with executable helpers need additional packaging checks before those legacy flows are enabled in a lightweight release. The system WebView's rendering, accessibility, cold startup and memory use still need representative production measurements.

The app's measured size must include its Node executable and all backend resources. Compare downloads and installed directories separately, using the same architecture and functional scope. A shell-only Tauri binary is not a valid comparison with the complete Electron distribution.

Reference: [Tauri resources](https://v2.tauri.app/develop/resources/), [Node sidecars](https://v2.tauri.app/learn/sidecar-nodejs/) and [Tauri capabilities](https://v2.tauri.app/security/capabilities/).
