# Desktop alpha release

Craft Hub distributes separate macOS builds for Apple silicon and Intel. The arm64 build is supported during alpha; the x64 build is experimental. A DMG is the initial installer and the matching ZIP is retained as the Squirrel.Mac update payload.

## Version policy

Every distributed alpha increments the numeric core and uses an `alpha.0` suffix:

- Repository and tag: `0.0.1-alpha.0`, `v0.0.1-alpha.0`
- Packaged macOS application: `0.0.1`
- Next distributed alpha: `0.0.2-alpha.0`, packaged as `0.0.2`

All workspace package versions must match the release tag. This keeps the numeric macOS application version strictly increasing while retaining the alpha label in source and GitHub Releases.

## Required GitHub secrets

- `MACOS_CERTIFICATE_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_API_ISSUER_ID`
- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_BASE64`

The release workflow publishes the site to Cloudflare Pages and writes architecture-specific Alpha manifests under `updates/alpha/darwin/{arm64,x64}/RELEASES.json`. Community builds read these manifests from `https://craft-hub.pages.dev/updates/alpha`.

Local ad-hoc packages do not enable automatic updates. `package:mac` writes packaged build metadata with updates enabled only when `MACOS_SIGNING_ENABLED=true`; this prevents unpublished local builds from repeatedly requesting a missing release feed.

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

1. Publish `v0.0.1-alpha.0` and install the appropriate DMG by dragging Craft Hub into Applications.
2. Confirm the About window reports `0.0.1`, automatic checks are enabled, and existing project state is retained after a normal restart.
3. Publish `v0.0.2-alpha.0` without removing the first installation.
4. Confirm the matching GitHub Pages manifest points to the `0.0.2` architecture-specific ZIP.
5. In `0.0.1`, open Settings and choose **Check now**. Confirm the UI moves through checking, downloading, and downloaded states.
6. Choose **Restart** in the native confirmation dialog.
7. Confirm the About window reports `0.0.2`, the app starts normally, and projects, trust state, settings, and run history remain available.
8. Repeat once on arm64 and once on x64. Record x64 failures as experimental-platform issues; an arm64 failure blocks the release.

Do not announce automatic updates as validated until this two-version exercise succeeds.
