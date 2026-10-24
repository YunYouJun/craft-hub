# Native instance and profile lifetime

The current native candidate owns one primary process per canonical profile directory. `CRAFT_HUB_NATIVE_DATA_DIR` still allows independent acceptance profiles; it does not allow a second writer against the same directory through a path alias. Older candidate builds without this protocol must be closed before reusing their profile. The shipped Electron app and the public `craft-hub:` default handler are unchanged.

## Before any native state opens

`AppDelegate` acquires instance ownership before constructing the workbench, sidecar, panels, updater or notification service. A successful primary holds a shared profile-root SQLite lease for its whole lifetime, including missing-Node UI, private Node installation, sidecar restart and shutdown. Swift uses the same canonical paths, per-user lock directory, SHA-256 names and SQLite transaction contract as `profile-lease.ts`. A migration needs exclusive ownership of the root and both child data directories.

The sidecar acquires its root lease and exclusive `runtime/`/`config/` leases before creating directories or loading plugins. The native primary first checks that no former sidecar still holds the root. If the parent crashes, the child remains protected while draining after stdin closes; a new host cannot silently overlap it. Failed startup releases ownership and displays a retry-by-relaunch explanation without opening the profile. Existing Electron/CLI shared-client behavior is retained; direct CLI access to an active native sidecar's data directory is excluded, while the public HTTP API remains available.

Lock databases contain only an empty lock table. The native instance file carries no profile content. Do not delete lock files to bypass a busy profile: the inode is part of the interprocess identity. Kernel locks release on process death. Files are private, owned by the current user, and checked against symlinks/hard links. Swift does not open and close an existing SQLite lock file outside SQLite, because that could discard another connection's POSIX locks in the same process.

Pending or retained identity migration also blocks startup after kernel ownership is released. Swift and Node inspect the durable guard in the OS account's `Library/Application Support/Craft Hub Migration/guards` and the legacy `/tmp` mirror before opening any profile state. The durable location is independent of caller `HOME`/`TMPDIR`, and survives loss of the temporary marker. See the [identity migration interlock and coordinator contract](native-secure-storage.md#device-identity-transfer-core). The coordinator, authenticated transport and source-owned consent/recovery UI are connected; real Developer ID paired-host acceptance remains pending, with release capability markers disabled.

## Duplicate launch and navigation

A duplicate process starts no sidecar and initializes no profile-dependent native models. It sends activation, file/desktop URLs, project-picker queries or capture-composer navigation to the primary over a private Unix socket, then exits after acknowledgment and a short quiet period. Requests never execute commands, grant trust or submit captures. Project folders use the ordinary project-registration flow and remain untrusted.

The IPC envelope is versioned and memory-only. Both peers check the OS peer UID; the socket is inside a user-private directory. Requests are limited to 16 KiB, 100 URLs, 2 KiB per URL and 1024 characters per project query. The receiver caps its pending queue at 64, remembers the latest 256 request identities for retry deduplication and limits simultaneous connections to eight. Invalid versions, unsupported operations/schemes, malformed JSON and oversized/timed-out packets are rejected. Callback URLs and credentials are never written to disk or included in telemetry.

The primary waits until navigation callbacks are attached before draining startup requests. A non-default Launch Services startup may deliver its opening file/URL after `applicationDidFinishLaunching`; the relay waits for that payload, with a two-second fallback because restoration/services also use non-default launches. A one-second quiet period drains late events before exit. Failed acknowledgment shows an error instead of starting a second writer. This is bounded local delivery, not a durable inbox: a process crash can require reopening the original link. See the [AppKit launch key](https://developer.apple.com/documentation/appkit/nsapplication/launchisdefaultuserinfokey) and [Chromium's observed launch-event ordering](https://chromium.googlesource.com/chromium/src/+/08e0bbb3329b5030c0c5454773005e6bfa7bd829) for the timing distinction.

The ordinary candidate continues to register only `craft-hub-native:`. The runtime's strict desktop-link parser and project resolver retain ownership of URL meaning. [Public default-handler review and rollback](native-link-handover.md) require a separate signed-release capability, disabled in current builds. Native personal-cloud connections use the candidate callback scheme; public callbacks from an Electron session are not adopted.

## Verification

```sh
pnpm build
CRAFT_HUB_TEST_NODE="$(command -v node)" swift test --package-path apps/macos
pnpm build:macos
pnpm test:macos-instance
pnpm test:macos-migration
```

Swift tests exercise same-profile ownership, independent profiles, late queue observation, duplicate IDs, queue bounds, malformed cross-process packets, migration exclusion before profile creation and ownership release. Real Node subprocesses verify Swift/Node lock interoperability, including a second SQLite connection and different `TMPDIR` values. Runtime tests cover overlapping sidecars and the interval after parent ownership is released.

The instance verifier copies the actual Release app under a unique bundle identity and uses temporary profiles. It exercises duplicate executable launches, Launch Services folder/URL delivery, untrusted registration, native destination persistence, forced parent exit, sidecar draining, startup blocked by migration and startup blocked by a standalone sidecar. It also removes only its own legacy migration marker, verifies that the durable copy prevents profile/sidecar creation, and starts the runtime after matching guard recovery. It stops only its own fixture processes and removes its temporary data/preferences and guard markers, never SQLite lease files. It does not replace installed apps, migrate real data, authorize accounts or switch URL defaults. Process/routing verification does not replace visual, keyboard, input-method, VoiceOver, minimum-system or long-term daily-use acceptance.
