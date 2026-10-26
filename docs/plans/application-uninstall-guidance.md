# Application uninstall guidance

## Scope and ownership

Craft Hub owns installed-application discovery and uninstall guidance in Software
center. Augma supplies a navigation shortcut from its application district.
Both applications remain independently usable.

The first release is read-only: list local macOS applications, inspect nearby
uninstaller candidates, show catalog-provided documentation and reveal files in
Finder. A filename match is a candidate, never proof of an official uninstaller.
No candidate, script, uninstall command or deletion is executed.

## Delivery plan

- [x] Add a bounded local discovery service and local-only HTTP contracts.
- [x] Accept optional `macosBundleId` and `uninstallUrl` catalog metadata through
  the existing static parser, without editing the upstream catalog snapshot.
- [x] Add native and browser Software center views with loading, unavailable,
  empty, error and duplicate-application states, and evidence for each candidate.
- [x] Add a versioned, navigation-only Desktop Link selecting a bundle ID.
- [x] Add the Augma shortcut, missing-host feedback and localized strings.
- [x] Test discovery boundaries, stale files, hostile inputs, HTTP locality,
  navigation, native contracts and the rendered browser interaction.
- [x] Run repository checks and build both native applications. Record remaining
  real-host acceptance separately from automated checks.

## Acceptance

Software center → Uninstall guidance → select an installed application → see
its name, bundle ID and path → inspect candidate evidence → reveal one candidate
in Finder or open documentation. Selecting an application never launches it.
An Augma link selects all matching installed copies explicitly; paths and
executable instructions are never carried by the link.

Discovery is limited to /Applications and ~/Applications with bounded nesting;
system applications, app data and entire disks are not scanned. Inaccessible or
unsupported locations are reported rather than presented as an empty success.
Finder actions revalidate server-owned identifiers and current files. Hosted
workbenches cannot inspect or reveal the host's applications.

## Follow-up backlog

- Read installed package-manager receipts and expose separately attributed
  uninstall plans; never equate community recipes with vendor instructions.
- Add verified, version-aware vendor rules at the catalog source.
- Consider opening verified native uninstallers after their behavior is reviewed.
- Evaluate residual-file preview and optional deletion monitoring independently.

## Verification record

Verified on macOS on 2026-10-26:

- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @craft-hub/web typecheck`,
  `pnpm lint:macos` and both repositories' `git diff --check` pass.
- Craft Hub full suite: 303 files, 2,446 passing tests and 3 skipped tests.
  Run with `GIT_CONFIG_GLOBAL=/tmp/craft-hub-uninstall-test.gitconfig` for
  disposable fixture repositories. The machine's global reference-transaction
  forwarding hook fails during `git init`; no global configuration was modified.
  The isolated installation used `--ignore-scripts`; restoring the dependency's
  expected `spawn-helper` executable permission fixed the PTY fixture failures.
- Craft Hub native tests: 156 executable-target tests plus 123 core tests pass.
  An existing Node pipe timing test failed during the initial concurrent build;
  the subsequent complete native run passed.
- Augma native tests: 242 tests, 1 skipped, no failures. Its universal release
  package and Craft Hub's ad-hoc Release App both build successfully.
- Chromium: `/software?tab=uninstall`, desktop 1360×900 and narrow 440×900.
  Inspected 48 real local applications. Verified selection, empty search,
  nonblank content, no framework overlay, no console errors and no component
  horizontal overflow. Browser plugin was not available; used repository
  Playwright. Temporary HTTP server and Chromium were closed in `finally`.
- Opened the packaged native Craft Hub with an isolated profile and an explicit
  `craft-hub-native://software?v=1&bundleId=…` link. Accessibility state and
  screenshot confirm the native guidance tab selected the correct installed
  Augma. Verified exit of the recorded temporary App and sidecar processes;
  preserved the daily-use instances, app bundles and data.
- Finder actions are verified through service, HTTP and native-client contracts;
  no uninstall program, script, deletion or external search was executed.

Screenshot evidence remains outside Git at
`/tmp/craft-hub-uninstall-desktop.png`, `/tmp/craft-hub-uninstall-mobile.png` and
`/tmp/craft-hub-uninstall-native.png`. Temporary verification profiles are kept
for resumption and are not committed.

Remaining acceptance: the Augma button's actual click across both packaged
applications, minimum-supported macOS, Developer ID signing/notarization, and
vendor-specific guide coverage. No per-vendor guide rules are seeded in this
release; configured catalogs can supply reviewed URLs, and other apps retain
explicitly labeled general-guide/search fallbacks.
