# Native Node bootstrap

The macOS app opens a native bootstrap view before it needs Node. Fixed discovery prefers an explicit executable, then compatible machine installations, and finally the current private release. The supported majors remain 22, 24 and 26, with the same version and architecture checks for every source. Private installation does not change PATH, the explicit preference, or an already running sidecar.

## User flow

When discovery fails, **Choose Node**, **Read Login PATH** and **Download Private Node** are available. Reading a login PATH is an explicit action because zsh/bash login files execute; it uses noninteractive mode with bounded output and a five-second deadline. Downloading asks for confirmation and shows the exact version, architecture and nodejs.org origin. Native settings also offer the download and restore actions.

The current pin is [Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1). The installer fetches its exact official `SHASUMS256.txt`, requires the compiled-in SHA-256 for the selected architecture, and verifies the archive before extraction or executable probing. It rejects redirects, oversized transfers, unexpected archive paths, incompatible architecture/version, and failed sidecar startup. No project or account configuration is used for validation.

After extraction, the checksum-verified executable is placed in its immutable release directory and gets a bounded 30-second version/architecture probe to allow first-launch preparation, including Rosetta translation. Ordinary machine discovery retains its three-second probe. The new executable then starts the actual bundled sidecar from that final path with a disposable HOME/profile. This preflight requires a valid v1 handshake and successful shutdown after its parent pipe closes. Only then does the installer atomically replace the private selection. A failed attempt removes its unselected release; a crash may leave an unselected directory that discovery ignores. A missing-Node bootstrap retries startup immediately; an existing runtime continues until its next launch. Normal machine discovery still takes priority.

## Storage and recovery

The store is `<native profile>/private-node`, normally `~/Library/Application Support/Craft Hub Prototype/private-node`. It contains immutable `releases`, per-attempt `staging`, a kernel-held `install.lock`, and a 0600 `state.json` selecting current and previous releases. New store directories use 0700 permissions. The install/rollback lease prevents two processes from changing the selection together; process exit releases it without deleting or stealing a stale lock file.

- Network, checksum, extraction, probe or sidecar failures preserve the selected release. Retry starts a fresh attempt.
- Cancellation removes that attempt's staging files and terminates owned validation processes. A process crash can leave an unselected staging/release directory; it is never used automatically. Old releases are retained rather than pruned while another app might still use them.
- **Restore Previous Version** validates the previous executable and atomically swaps the two selections. It applies on next launch; it does not interrupt work or override machine discovery.
- Corrupt state or unsafe paths are reported and retained. Choose a known compatible Node to recover startup; do not delete a live profile or replace the state file without preserving it first. Automatic recovery of corrupt receipts is not implemented.

## Pin maintenance and verification

Pins live in `apps/macos/Sources/CraftHubMacCore/PrivateNode.swift`. To change one, review a supported LTS release, obtain both Darwin checksums from that release's official manifest, update the pin and fixture expectations, and rerun runtime compatibility and the real download test. A mutable “latest” URL is never resolved at launch. A new app pin still requires the user to request a download.

```sh
pnpm build:macos
swift test --package-path apps/macos
CRAFT_HUB_TEST_NODE="$(command -v node)" swift test --package-path apps/macos
CRAFT_HUB_TEST_PRIVATE_NODE_DOWNLOAD=1 \
  CRAFT_HUB_TEST_SIDECAR="$PWD/apps/macos/build/Craft Hub Prototype.app/Contents/Resources/app/apps/desktop/dist/sidecar.mjs" \
  swift test --package-path apps/macos --filter officialPrivateNodeDownload
```

The real download test is opt-in and deletes its temporary profile. Unit tests cover pin/manifest mismatch, archive paths, failed validation, atomic activation/rollback, cancellation, discovery priority, and concurrent installation. Real-Node tests cover handshake failure, nonzero shutdown, cancellation and process cleanup.

On 2026-10-23, the arm64 official download passed the actual bundled-sidecar preflight. A later x64 App check under Rosetta found that first launch of a newly extracted executable exceeded three seconds, and moving it after validation triggered another slow first launch. Validation now happens at the final immutable path with the longer installation-only deadline. The actual x64 bootstrap passed download confirmation, Escape cancellation, official download, automatic runtime startup, diagnostics, normal quit and restart using the same private Node; native settings also passed download without interrupting their running sidecar. The final x64 UI copy matches the source artifact's Mach-O text sections and packaged runtime.

The current arm64 candidate passed 243 Swift tests and skipped one optional official download test. Its unchanged product binary also passed real UI checks for missing Node, explicit login PATH, file-picker cancellation and invalid-file rejection, saved selection across restart, missing-preference fallback, and choosing a replacement for the next launch. The isolated noninteractive login file ran exactly once; later launches did not run it again, and the interactive startup file never ran. Xcode's arm64 testing helper could not load the x64 test bundles, so full x64 Swift tests remain unexecuted despite successful Rosetta App checks. Private-release rollback UI also passed in a separate isolated run: Escape cancellation, next-launch activation of 24.18.0, refusal when the previous executable was temporarily unavailable, explicit retry after repair, and return to 24.22.1. The active sidecar remained unchanged until each restart, and both original release files were retained. macOS 15, real Intel hardware, and full accessibility acceptance remain open. See the [candidate record](native-candidate-acceptance.md), [goal record](../plans/macos-native-client.md) and [separate private-Node size measurement](../research/native-macos-performance.md).

For isolated login-shell UI checks, set both `HOME` and `CFFIXED_USER_HOME`: changing HOME alone does not change Foundation’s home directory on macOS. Verify the launched process environment before counting a missing-Node result; the computer-control launcher inherited its PATH over the bundle environment in this run. The fixture-only native launcher and artifact comparisons are retained in `apps/macos/build/node-bootstrap-ui-20261023/`. No product startup script or user shell configuration was changed.

The rollback fixture was prepared by compiling a small test driver with the unchanged production installer/preflight sources. It downloaded and verified official 24.18.0 and pinned 24.22.1 archives, then validated both against the packaged sidecar before writing their receipts. This prepared upgrade history does not represent an actual old-App upgrade, and the shipping pin was not changed. Three UI sessions quit normally; evidence and source/binary comparisons are in `apps/macos/build/node-rollback-ui-20261023/`.
