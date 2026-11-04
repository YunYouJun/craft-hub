# macOS runtime broker (P0/P1)

The SwiftPM package contains `RuntimeIPC`, `CraftHubRuntimeBroker`, and `CraftHubRuntimeClient`. It uses Foundation XPC code-signing requirements on both peers, a user-level Mach service, and a private stdin/stdout channel to one independent Node worker. GUI disconnection does not terminate accepted operations. Node exit ends the broker; broker loss closes Node's pipe and triggers bounded cleanup.

`RuntimeServiceRegistration` wraps `SMAppService.agent` and reports the system status. It rejects unpackaged callers and non-bundled plist names. Registration is never automatic during a normal Craft Hub/Augma launch. This fixture broker only accepts the `dev.craft-hub.fixture.*` service namespace and a configuration explicitly declaring `fixtureOnly`; the containing acceptance app pins Node and the worker entrypoint by SHA-256. The packaged production Node and all dependency/resource sealing remain release work.

Run:

```sh
swift test --package-path apps/runtime-macos
pnpm test:shared-runtime
```

The acceptance script builds the TS and Swift products, creates a private profile and ad hoc signed app under ignored `apps/macos/build/shared-runtime-<id>/`, registers a uniquely named user service, and records JSON evidence. `KeepAlive` and `RunAtLoad` are false. Test-only idle/request deadlines are shortened. If `SMAppService` approval is unavailable, the script explicitly records and uses an isolated development `launchctl` adapter; that result is not production registration acceptance. The script does not enable a disabled user preference.

Acceptance covers concurrent cold start, lazy plugin loading, both signature directions, protocol rejection, an isolated Electron main/renderer/helper exit followed by native capture, concurrent same-attempt commit, caller exit during sending, unknown replies, timeouts, worker and broker crashes, durable recovery, idle exit and absence of automatic restarts. The native CLI is the P0 client adapter used by the Electron fixture, not an integrated production Electron/Augma bridge. All signed fixture clients share one limited fixture capture grant; real pairing, per-client grants and credential access are P3.

The `finally` and signal cleanup unregister the fixture service, close temporary processes and verify PID, executable and process start time before terminating a residual instance. Fixtures, drafts and evidence remain available; installed daily-use apps are not replaced. Developer ID signatures, hardened runtime/notarization, a distributed service approval flow, minimum-system testing, packaging/upgrades, real account login and cloud writes remain unaccepted.
