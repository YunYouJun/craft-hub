# Native macOS distribution and updates

The SwiftUI host uses [Sparkle 2](https://sparkle-project.org/documentation/), pinned in `apps/macos/Package.swift` and `Package.resolved`. Electron keeps its separate [Squirrel.Mac release pipeline](./desktop-release.md). The native host retains the bundle ID `dev.craft-hub.macos-prototype`, the name `Craft Hub Prototype.app`, and its existing data directory. Do not change these between updates without a migration plan.

## Client behavior

- **Check for Updates…** uses Sparkle's native UI and remains available when automatic checks are off. Sparkle disables duplicate checks during an active operation.
- **Software Update Settings…** exposes Sparkle's persisted automatic-check and automatic-download preferences and last-check date. It works even when Node is unavailable.
- The default consent prompt offers automatic updates on the second launch. Checks use Sparkle's daily schedule. Downloads/install-on-quit are opt-in; the host does not replace Sparkle's scheduler or overwrite preferences.
- Release builds require HTTPS, an Ed25519 public key, signed feeds, and archive verification before extraction. JavaScript in release notes and system profiling remain disabled. Sparkle's default signed-feed recovery policy applies; see [security settings](https://sparkle-project.org/documentation/customization/).
- Quit and update restart wait for the runtime child to exit. If capture, commands or agent tasks are active, or the runtime cannot be checked, a native dialog allows cancellation or explicit interruption. Draft persistence continues to use the existing native draft store.
- Local `pnpm build:macos` builds have `CraftHubUpdatesEnabled=false` and never initialize Sparkle, even if preferences from a previous release remain. They are ad hoc signed and need no publishing credentials.

### Local App Intents verification

On macOS 26.6.2, Shortcuts listed both actions from the ad hoc candidate, but `linkd` rejected invocation with `Unable to get teamId` and `requiresValidatedBundle`. A local Apple Development signature on the isolated copy allowed invocation. Metadata discovery and `codesign --verify` alone therefore do not establish that system actions can run.

Use an explicitly selected local development identity when reproducing this check, with a distinct test bundle identity and empty profile. Preserve the original ad hoc artifact and its digest. Development signing does not enable release updates, public-link takeover or identity migration; it does not establish Developer ID, notarization or Gatekeeper acceptance. See the [system-entry evidence](native-candidate-acceptance.md#app-intents-系统调用与冷启动修复2026-10-23).

## Release configuration

The current release workflow supports **Apple silicon, macOS 15 or later**, on the Alpha channel. The build scripts also accept a native Intel host and produce a separate `x64` feed URL, but Intel publication and testing are not enabled in CI yet. No cross-architecture update is offered.

Existing Apple credentials are reused:

| GitHub secret | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE_BASE64` | Developer ID Application certificate and private key, exported as password-protected PKCS#12 |
| `MACOS_CERTIFICATE_PASSWORD` | PKCS#12 password |
| `APPLE_API_KEY_BASE64` | App Store Connect notary private key |
| `APPLE_API_KEY_ID` | Notary API key ID |
| `APPLE_API_ISSUER_ID` | Notary API issuer ID |
| `SPARKLE_PRIVATE_ED_KEY` | Contents of Sparkle's exported private-key file; do not base64-encode it a second time |

Set the non-secret GitHub repository variable `SPARKLE_PUBLIC_ED_KEY` to the matching base64 public key. Keep the private key in a secure backup. Losing or replacing it requires Sparkle's documented key-rotation process; never silently generate a new release key per build.

Resolve the pinned tools with `swift package --package-path apps/macos resolve`. Then use `apps/macos/.build/artifacts/sparkle/Sparkle/bin/generate_keys` to create the signing key in Keychain. Use that tool's `--help` for exporting to a private path outside this repository. Upload the exported content to `SPARKLE_PRIVATE_ED_KEY` through GitHub secret management, and remove the temporary export. Do not put keys in source, app resources, appcasts, logs or command-line arguments. See [Sparkle setup](https://sparkle-project.org/documentation/) and [publishing updates](https://sparkle-project.org/documentation/publishing/).

## Packaging and publication

After the release has been authorized, use an increasing workspace version such as `0.0.1-alpha.6` and its matching **`native-v0.0.1-alpha.6`** tag. The native tag runs `.github/workflows/release-native.yml`; it does not run npm publication or the Electron release workflow.

The workflow runs repository checks and Swift tests, imports temporary credentials, then runs `pnpm package:macos`. Packaging:

1. Builds the native bundle with `CRAFT_HUB_NATIVE_RELEASE=true`, embeds Sparkle using `ditto`, and signs nested code from the inside out with the same Developer ID identity and Hardened Runtime.
2. Notarizes the archive, staples the app, and verifies signatures, the ticket and Gatekeeper assessment.
3. Recreates the ZIP after stapling, preserving symlinks and permissions.
4. Uses Sparkle's official `generate_appcast` to sign the ZIP and XML, then verifies the signed feed and checks the archive signature against the public key embedded in the app. Delta generation is initially disabled.
5. Publishes the verified ZIP and `appcast-arm64.xml` together in a native GitHub prerelease, then deploys the site.

The site deploy always restores the latest published native Alpha appcast byte for byte, including during ordinary documentation and Electron deployments. Its URL is `https://craft-hub.pages.dev/updates/native/alpha/darwin/arm64/appcast.xml`. ZIP URLs refer to immutable versioned release assets. Do not overwrite an already published ZIP or edit the signed XML; publish a new version instead.

For a downstream distribution, set `CRAFT_HUB_NATIVE_UPDATE_BASE_URL` at build time to its own HTTPS base and publish `{base}/darwin/{arm64,x64}/appcast.xml` there. It must also own a distinct application identity, data directory and signing keys; the community workflow publishes only the community Alpha feed.

For local release packaging, provide `MACOS_KEYCHAIN_PATH`, `APPLE_API_KEY_PATH`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `SPARKLE_PUBLIC_ED_KEY`, `SPARKLE_PRIVATE_KEY_FILE`, `GITHUB_REPOSITORY`, and `RELEASE_TAG` through the environment, plus `CRAFT_HUB_NATIVE_RELEASE=true`. `pnpm package:macos` only produces verified artifacts under `release/native/<architecture>`; it never uploads them. A release keychain must contain exactly one Developer ID Application signing identity.

`CFBundleVersion` uses the existing numeric mapping shared with desktop packaging: `0.0.1-alpha.5` becomes `0.0.1005`. Sparkle compares this monotonically increasing number; the original SemVer is retained as `CraftHubReleaseVersion` and in the archive filename. Stable native publication needs a separate channel policy before enabling it.

Public-link eligibility is separately gated by `CRAFT_HUB_NATIVE_PUBLIC_LINKS=true`, and remains disabled in the release workflow. See [default-handler handover and rollback](native-link-handover.md) before enabling it for a release.

## First N → N+1 acceptance gate

After `pnpm build:macos`, run `pnpm test:macos-updates` to load the embedded framework and exercise the official ZIP/appcast signing tools with an isolated application copy and temporary keys. It verifies both signatures and rejects modified archives/feeds. Native CI runs this check without publishing credentials.

Build and publish two signed, notarized native alphas with the same identity and keys. Install N into a writable Applications location, then verify:

1. Manual check offers N+1 from the public HTTPS feed; disabling automatic checks still permits manual checks.
2. Before downloading, exercise **Remind Me Later** and **Skip This Version** across relaunch and a due background check. An explicit manual check intentionally clears a skipped version. Then download, choose **Install and Relaunch**, and verify replacement. The **Ready to Install** window does not offer Later. Only the native app is replaced, the new bundle version is N+1, and projects, settings, grants and capture drafts survive.
3. Active commands, agent tasks and capture saves can cancel restart; normal idle restart leaves no old sidecar before starting the new one.
4. Automatic checks/download preferences survive relaunch, no duplicate download occurs, and no-update/offline/failure states use Sparkle's normal UI.
5. A modified ZIP, modified signed feed, wrong Ed25519 key and an incompatible architecture are rejected. Perform negative tests with isolated test identities and keys, never by corrupting the production feed.

Passing local builds and unit tests does not prove this public N → N+1 path. Record its result before describing native release updates as validated.

## Recorded Alpha acceptance

[Alpha 6 → Alpha 7 acceptance](../research/native-macos-update-acceptance.md) passed on Apple silicon/macOS 26.6.2 on 2026-10-22, with running-command cancellation, Later/Skip and app-scoped check-stage offline recovery added on 2026-10-23. The record distinguishes signed Release tests from the isolated network simulation and lists remaining minimum-system, daily-use and Intel coverage.
