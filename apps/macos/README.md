# Native macOS prototype

This SwiftUI app prototypes the primary macOS host proposed in [ADR 0012](../../docs/adr/0012-make-a-macos-native-client-the-primary-desktop-host.md) (milestone M1 in the [native client goal](../../docs/plans/macos-native-client.md)). The window chrome is native: a system sidebar, toolbar and menus that adopt Liquid Glass on macOS 26 and later. The content is the existing web workbench in a `WKWebView`. Electron remains the shipped desktop host.

## Build and run

Requires Xcode 26 or later, the repository's pnpm dependencies, and a compatible Node (22.18, 24.11, or 26 and later) on the machine.

```sh
pnpm build:macos
open "apps/macos/build/Craft Hub Prototype.app"
```

The build compiles the web workbench, prepares the runtime backend shared with the [Tauri trial](../tauri/README.md), compiles this package in release mode, and assembles an ad hoc signed app in `apps/macos/build/`. Run the Node resolution tests with `swift test --package-path apps/macos`.

## How it works

- **Node:** the app ships no Node. At launch it resolves one executable: `CRAFT_HUB_NODE`, a path chosen in the app, or the first compatible Node found by the Electron host's fixed GUI search rules (`PATH`, `~/.local/bin`, Homebrew, `/usr/local/bin`, fnm). It never runs shell startup scripts. With no compatible Node, a native view explains why and lets you choose one.
- **Runtime sidecar:** the backend runs with a minimal environment (no `NODE_OPTIONS` or `NODE_PATH`). It prints a one-use bootstrap URL, guards every route with a session cookie, and exits when the app closes its stdin pipe, including after a crash or force quit.
- **Embedded web UI:** the app defines `window.__craftHubNativeHost` before the page loads. The web UI then hides its own titlebar, activity rail and status bar, accepts navigation and commands (`palette`, `settings`) from the native chrome, and reports each route so the sidebar follows. See `apps/web/src/native-host.ts`.

## Prototype limits

- Runtime state lives in `~/Library/Application Support/Craft Hub Prototype`, separate from the Electron app, so projects and settings start empty (ADR 0012 open question 4).
- The backend is the Tauri trial's: no Codex SDK, Microsoft To Do plugin, host extensions or personal cloud, and only the trial's native bridge actions.
- Not yet native: command palette, quick capture, menu bar item, App Intents, notifications, the login-shell PATH fallback and the private Node download.
- Ad hoc signed, not notarized, and no automatic updates.
