# Desktop alpha release

Craft Hub distributes separate macOS builds for Apple silicon and Intel. The arm64 build is supported during alpha; the x64 build is experimental. A DMG is the initial installer and the matching ZIP is retained as the Squirrel.Mac update payload.

## Runtime hardening and bundled backend

Mac packages disable Electron's RunAsNode, Node-options and inspector fuses and enable ASAR integrity and ASAR-only app loading before signing. The packager embeds the archive digest; the build reads back the actual fuse values after packaging. No new cookie or web-protocol policy is selected by this change.

Workstation runs on a fixed private executable at `app.asar.unpacked/apps/desktop/workstation-runtime/node/bin/node`, so its own detached workers and backup subprocesses remain ordinary Node processes. Release pins and arm64/x64 archive SHA-256 values live in `scripts/desktop-node.lock.json`. Packaging downloads only from the official Node release server, checks both the published manifest and pinned archive digest before extraction, verifies the binary architecture, and retains Node's license. No terminal Node installation is required for this backend. The native candidate continues to use its separate Node bootstrap and does not package this Electron-only executable. The arm64 resource adds approximately 116.35 MiB uncompressed; this is the cost of removing Electron's general-purpose Node entry point while retaining the legacy host's bundled backend.

The archive download has one ten-minute deadline across at most three transport attempts. After a broken connection, a pinned archive may resume from the fully written byte offset only when the official server returns the matching byte range and total size. The complete archive must still match its pinned SHA-256. Manifest downloads have a three-minute deadline and never resume partial content; status, range, size, filesystem and checksum failures are not retried. Failed staging directories are cleaned up without promoting a partial runtime.

After packaging, run `pnpm test:desktop-backend <app>` and `pnpm test:macos-identity-source <app>`. They use disposable profiles and cover the real backend, a no-install detached worker, attempted Electron Node/preload/inspector injection and ASAR corruption in a re-signed disposable app copy. Release CI runs both before mounted-DMG acceptance and artifact upload. A local rehearsal can call `packageMacos({ adHoc: true, createArtifacts: false, architectures: [...] })` with an isolated `CRAFT_HUB_DESKTOP_OUTPUT_DIR`; this avoids selecting or persisting a real local signer and cannot be combined with `MACOS_SIGNING_ENABLED=true`.

The macOS package also compiles and signs the small `identity-launcher/launcher.node` process-owner module for its selected architecture. `pnpm test:identity-launcher <app>` verifies suspended fixture creation/validation, refusal cleanup, descriptor isolation, authenticated Mach transport and the packaged Node ABI; the actual Electron maintenance check loads the module as well. The source coordinator, native review, recovery and ordinary App menu are connected, but the complete identity-transfer release markers remain disabled until real Developer ID paired-app acceptance. See the [source-owned process boundary](native-secure-storage.md#source-owned-process-foundation) and [App migration entry](native-secure-storage.md#app-menu-and-guarded-startup-recovery).

These checks do not enable real identity migration. The coordinated-transfer security marker remains absent until authenticated source-owned recipient launch, private pipes and user consent/recovery are implemented and accepted.

## Version policy

Desktop versions accept stable SemVer and numeric `alpha.N` prereleases, with `N` from 0 to 998. The macOS version uses `major.minor.(patch × 1000 + N)` for alpha builds and `major.minor.(patch × 1000 + 999)` for stable builds:

- Repository and tag: `0.0.1-alpha.5`, `v0.0.1-alpha.5`
- Packaged macOS application: `0.0.1005`
- Next distributed alpha: `0.0.1-alpha.6`, packaged as `0.0.1006`
- Stable release: `0.0.1`, packaged as `0.0.1999`

All workspace package versions must match the release tag. Each release must increase the version. This keeps the numeric macOS application version strictly increasing while retaining the semantic version in source, GitHub Releases, and update notifications. The Alpha feed deployment currently selects numeric alpha tags; stable channel publication needs its own release policy.

## Required GitHub secrets

- `MACOS_CERTIFICATE_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_ISSUER_ID`
- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_BASE64`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The release workflow publishes the site to Cloudflare Pages and writes architecture-specific Alpha manifests under `updates/alpha/darwin/{arm64,x64}/RELEASES.json`. Community builds read these manifests from `https://craft-hub.pages.dev/updates/alpha`.

Local packages do not enable automatic updates. `package:mac` writes packaged build metadata with updates enabled only when `MACOS_SIGNING_ENABLED=true`; this prevents unpublished local builds from repeatedly requesting a missing release feed.

## Automatic updates

This section describes the Electron host. The SwiftUI host uses a separate [native Sparkle release pipeline](./native-macos-release.md).

Signed release builds check on startup and once per hour when **Automatically check for and download updates** is enabled in Settings. **Check now** also works when automatic checks are disabled; **Check for Updates…** in the native application menu opens Settings and starts a manual check. Each architecture reads its own static Squirrel.Mac manifest and downloads the matching ZIP in the background. The native Electron updater reports checking, availability, and download completion; it does not expose byte counts or a percentage, so the download indicator remains indeterminate. See the [Electron autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater) and [Squirrel.Mac static manifest format](https://github.com/Squirrel/Squirrel.Mac#update-file-json-format).

After download, the native dialog offers **Restart** and **Later**. Choosing **Later** retains the downloaded update; Settings then offers **Restart and install**. Installation closes the local runtime before restarting the application. A repeated manual check while a check or download is active does not start another download.

Downstream distributions provide an HTTPS `desktop.updateBaseUrl` in their distribution manifest. Omitting it disables release updates for that distribution. They must publish `{updateBaseUrl}/darwin/{arm64,x64}/RELEASES.json` and ZIPs signed for the same application identity. Community updates are limited to packaged macOS applications; browser and development sessions do not install desktop updates.

`scripts/generate-macos-update-feed.ts` validates the architecture, `v` release tag, GitHub `owner/repository`, and a valid UTC publication timestamp before writing a manifest. Its `currentRelease`, release lookup version, and download version must all use the numeric packaged macOS version. The release name retains the original SemVer for display.

## Local builds and keychain approval

`package:mac` and `reinstall:electron:mac` select a valid Developer ID Application certificate, or an Apple Development / Mac Developer certificate for local development. The chosen certificate fingerprint is saved under `~/Library/Application Support/<product>/build/<bundle-id>-signing.json`. Rebuilds reuse this identity even if another certificate is later installed. Only the certificate fingerprint and display name are stored; private keys stay in the system keychain.

If multiple eligible certificates exist, choose one with `MACOS_LOCAL_SIGNING_IDENTITY=<certificate-fingerprint>`. This explicit setting also permits certificate rotation. If the saved certificate is unavailable, packaging stops instead of silently changing to another identity. Without an eligible certificate and without a saved selection, packaging retains ad hoc signing and prints a warning that keychain prompts can recur after rebuilding.

Ad hoc signatures identify a particular build, so previous keychain approvals can stop matching after an update. The first certificate-signed build may need one new **Always Allow** approval. Subsequent local rebuilds retain the application's designated requirement. Keychain resets, revoked permissions, certificate changes, or switching between local development and distribution channels may still require approval. Local certificate signing does not enable notarization or turn on release updates; release signing remains controlled by `MACOS_SIGNING_ENABLED`.

Each copied macOS target verifies the `keytar@7.9.0` native credential addon against its architecture. When the installed addon belongs to the build machine's other architecture, packaging obtains the matching pinned N-API v3 prebuild through the locked installer. A missing or incompatible prebuild stops packaging. The addon remains unpacked for application signing, and the shared staging tree stays reusable for both targets. This prevents Intel packages built on Apple silicon from silently falling back to a credential-encryption key stored beside the token cache.

## Application icon

`apps/desktop/assets/icon.icon` is the Icon Composer source. Its three glass facets use the YunLeFun sky blue, cyan, and sun palette, so the system can render default, dark, tinted, and clear appearances. `@electron/packager` finds the `.icon` beside `icon.icns`, compiles it into `Assets.car`, and sets `CFBundleIconName`. That step requires macOS 26 and Xcode 26 or later, so the release job runs on `macos-26`. The `.icns` remains the fallback for earlier macOS releases; the native macOS prototype uses both the same way.

After you edit the Icon Composer source, run `pnpm icons:desktop` on macOS. It renders `icon.png` and `icon.icns` on the 824/1024 macOS icon grid. Update the flat favicon in `apps/web/public` and `docs/public` by hand when the facet geometry changes. A downstream distribution that sets `desktop.icons.macos` can add a sibling `.icon` with the same base name.

## Release gate

Pushing a matching `v*` tag starts the release workflow. It does not create the GitHub Release until all of these checks succeed:

1. Tag and workspace versions match.
2. Lint, typecheck, tests, application build, and documentation build pass.
3. Both architecture-specific applications are signed and notarized.
4. Each DMG is notarized, stapled, verified, and contains the application plus an `/Applications` shortcut.
5. Each update ZIP passes an archive integrity check.
6. Each mounted DMG completes the packaged startup smoke test.

Only then are both DMGs and both ZIPs attached to the GitHub Release. The Alpha update feed is deployed after the Release assets are available.

## First N → N+1 update validation

The updater cannot be proven with a single build. Use the first two distributed alphas as an explicit release gate:

1. Publish `v0.0.1-alpha.5` and install the appropriate DMG by dragging Craft Hub into Applications.
2. Confirm the About window reports `0.0.1005`, automatic checks are enabled, and existing project state is retained after a normal restart.
3. Publish `v0.0.1-alpha.6` without removing the first installation.
4. Confirm the matching Cloudflare Pages manifest uses `0.0.1006` and points to the `v0.0.1-alpha.6` architecture-specific ZIP.
5. In the first installation, open Settings and choose **Check now**. Confirm the UI moves through checking, background download with an indeterminate indicator, and downloaded states.
6. Choose **Later** in the native confirmation dialog, then choose **Restart and install** in Settings.
7. Confirm the About window reports `0.0.1006`, the app starts normally, and projects, trust state, settings, and run history remain available.
8. Repeat once on arm64 and once on x64. Record x64 failures as experimental-platform issues; an arm64 failure blocks the release.

Do not announce automatic updates as validated until this two-version exercise succeeds.

## Recorded upgrade validation

On 2026-10-13, the following isolated two-version exercises passed on an Apple silicon Mac:

| Package/channel | Architecture | Before → after | Installation exercised |
| --- | --- | --- | --- |
| Published, notarized alpha.4 → alpha.5 | arm64 | `0.0.1` → `0.0.1005` | Public HTTPS feed, signed ZIP download, native Squirrel installation on normal exit, reopening with the same isolated profile |
| Published, notarized alpha.4 → alpha.5 | x64 under Rosetta | `0.0.1` → `0.0.1005` | Matching x64 feed and ZIP, native installation, reopening with the same isolated profile |
| Current source, local certificate-signed fixtures | arm64 | `0.0.1005` → `0.0.1006` | Actual Settings **Restart and install** action, clean shutdown, native replacement, automatic reopening |

The published alpha.4 artifacts predate the current version mapping and contain `0.0.1`; the installed alpha.5 bundles contain `0.0.1005`. Signature verification passed after each replacement. Each exercise retained a fixture project's ID, path and explicit trust, theme and locale, run history, and disabled automatic-check preference. The current-source application was also inspected after its automatic relaunch: Settings reported `0.0.1006`.

The current-source fixtures used a separate application identity and embedded data, configuration, browser-profile, and log paths. They enabled updates only inside the temporary signed test bundles. Their real native download used a loopback feed selected through Electron's native feed API after initial HTTPS feed setup; the public HTTPS distribution path was exercised separately above. No release tag was created or published, and the production local-build update policy was unchanged. Native notification automation chose **Later**, then exercised the real Settings installation button.

The old alpha.4 x64 bundle returned `posix_spawnp failed` when starting the fixture command under Rosetta; its failed run record survived the upgrade. This did not prevent the update exercise. Rosetta coverage does not replace validation on physical Intel hardware, and the local current-source fixtures do not replace a future notarized public release smoke test.
