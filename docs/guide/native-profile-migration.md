# Native candidate profile migration

The offline migration commands copy the Electron runtime and portable configuration into the native candidate's `runtime/` and `config/` directories. They preserve the Electron source and archive any previous candidate. They do not switch the default app, change project trust, run commands, load plugins, connect accounts or copy browser sessions.

This is an engineering migration path for a reviewed local profile. Authenticated Keychain/device-identity transfer, review of transferred external extension locations and the public URL-scheme handoff remain separate acceptance work. The [source-owned migration review and recovery](native-secure-storage.md#source-owned-migration-review-and-recovery) connect the encrypted transfer client to the shared coordinator through native system dialogs. Packaged macOS Electron now exposes a migration menu and [guarded-startup recovery entry](native-secure-storage.md#app-menu-and-guarded-startup-recovery) for profiles containing a device identity. Real signed-pair acceptance remains pending, and release markers are disabled. A source containing an encrypted personal-cloud device identity remains blocked by these offline CLI commands. Do not remove that identity just to bypass preflight.

## Ordinary data wizard

Choose **Craft Hub → 原生版资料迁移… → 普通资料迁移…**. After the ordinary workbench closes, system dialogs offer copy, recovery and rollback. Source roots come from the source application's configuration; selectors only choose the candidate or an existing transaction. This path never opens secure storage, launches a receiving application or adopts a default handler. Existing identity guards pin recovery to the authenticated identity path and do not offer the ordinary-copy option.

Copy preflight lists source/target paths, entry counts, excluded transient data and blockers. The full report can be saved to a new private file without overwriting an existing file. Cancellation leaves profiles unchanged; confirming requires a separate acknowledgement that both daily hosts and older CLI processes have stopped. Process inspection excludes only the exact current maintenance PID/executable, and runtime exclusive leases still reject current writers. Other running apps are never stopped automatically.

Recovery and rollback must belong to the current source roots. Approval binds the journal, candidate, saved predecessor and staged directory, including directory existence; it is rechecked under exclusive leases before mutation. Changes require a new review. Identity transactions are refused before offering a data-only review. Failed copies that have created a journal retain and report its recovery directory, even when automatic rollback has restored the candidate. Preserve that transaction and inspect it again instead of blindly retrying an uncertain operation.

This is a copy: the source remains usable and subsequent edits in the two hosts are not merged. Check the native profile before choosing it for daily use. It does not establish external extension or account compatibility. Encrypted identities remain blocked on this path; the signed identity-transfer contract is unchanged.

The 2026-10-23 macOS 26.6.2 arm64 Release rehearsal used an independently signed Electron copy with temporary runtime/configuration/browser directories. Its menu reached the ordinary-data dialogs, selected the fixture candidate and displayed the exact roots and copy scope. Save As wrote a mode-0600 metadata report and returned to an unchecked confirmation. Attempting the fixture copy while other known Craft Hub hosts were still running was refused before a transaction was created; the target, untrusted project state and absence of command/agent runs were verified, and the test processes exited. The computer-control tool briefly launched an extra ordinary fixture process while observing the relaunch gap; that extra process was closed before continuing. Positive copy/recovery/rollback is covered by the runtime/host tests and packaged rehearsal below; successful end-to-end GUI copying remains to be checked with daily hosts stopped. No real profile or identity was migrated.

## Review without changing data

Build the runtime with `pnpm build`, then run from the repository root:

```sh
node packages/craft-hub/dist/cli.mjs profile:preflight \
  "$HOME/Library/Application Support/Craft Hub" \
  "$HOME/.craft-hub" \
  "$HOME/Library/Application Support/Craft Hub Prototype" \
  --out /tmp/craft-hub-migration-review.json
```

Use the actual source directories if they differ. Preflight does not start a runtime or create profile files. The optional report is created exclusively with mode `0600`; choose a new filename if it already exists. It contains local paths, file sizes, modes and hashes, never file contents. Keep it local because filenames can still be sensitive.

The review includes source and candidate revisions, selected runtime/configuration entries, excluded browser/transient entries and blockers. Unknown top-level runtime entries require a migration policy instead of silently disappearing. Invalid JSON, unsupported links, special files and size limits fail closed. Known portable JSONC/YAML documents receive syntax and schema-version checks without conversion; complete domain validation remains with the runtime. Unfinished command/agent records and a pending native capture request ID require recovery before replacement. An ordinary unsent native draft and candidate-only files, including private Node installations, are retained.

Each regular file is limited to 256 MiB; each root snapshot to 2 GiB and 50,000 entries. External, absolute or cross-section symlinks and hard links are rejected. Known plugin package paths under the source data directory are relocated to the candidate runtime; external paths are preserved and still require normal host compatibility checks.

### Browser state stays at the source

The native WebKit session starts fresh. In addition to cookies and cache directories, the exclusion policy recognizes Chromium's `DIPS`, `SharedStorage`, `WebStorage`, `DevToolsActivePort` and `declarative_performance_observer.db`, including the named SQLite stores' `-journal`, `-wal` and `-shm` companions. These are browser-owned files, not portable Craft Hub records: see Chromium's [DIPS filename](https://chromium.googlesource.com/chromium/src/+/refs/tags/124.0.6367.39/chrome/browser/dips/dips_utils.h), [storage constants](https://chromium.googlesource.com/chromium/src/+/8ba1bad80dc22235693a0dd41fe55c0fd2dbdabd/components/services/storage/public/cpp/constants.cc), [DevTools port writer](https://chromium.googlesource.com/chromium/src/+/253c608f62eac20caaa863f95bb60e5d9e76eee3/content/browser/devtools/devtools_http_handler.cc) and [performance report store](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/declarative_performance_observer/declarative_performance_observer_store.cc).

macOS network temporary files are recognized only as `.<bundle-id>.Network Persistent State.<six alphanumeric characters>` or the corresponding `TransportSecurity` name. Chromium's [atomic writer](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/base/files/important_file_writer.cc) supplies the destination basename to its [temporary-file formatter](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/base/files/file_util_posix.cc), which adds the bundle prefix and `mkstemp` suffix. This rule does not cover arbitrary hidden files, backups, scripts or incomplete Craft Hub JSON writes.

Exclusion only omits a file or directory from the native copy and lists its name in the review. It never deletes or edits source browser state, nor includes its contents in the review. Near-matching names, unknown business directories, retained backups and unfinished operations remain blockers. Do not rename or remove unknown files just to pass preflight; preserve and classify their intended state first.

## Apply the reviewed copy

Quit both apps and all CLI writers. Resolve every blocker and regenerate the report after any source or candidate change. With explicit authorization to migrate the actual data:

```sh
node packages/craft-hub/dist/cli.mjs profile:migrate \
  /tmp/craft-hub-migration-review.json --confirm-stopped
```

Current Electron hosts and CLI clients hold shared kernel-backed leases; migration requires exclusive leases for all source and destination roots. The native App takes a root lease before initializing profile-dependent UI, and retains it while Node is missing, restarting or draining. Its sidecar also holds the root and exclusively owns its `runtime/` and `config/` directories before creating them, preventing overlapping sidecars after a parent crash. The lock identity is independent of `HOME` and `TMPDIR` on macOS. Process death releases the kernel lock; do not delete lease files.

The current native candidate also has a profile-scoped instance lock: a duplicate process forwards bounded navigation to the primary and exits without opening its profile or starting a sidecar. Independent profiles remain separate. This does not coordinate older candidate builds that lack the protocol; close those builds before testing a newer candidate on the same profile. Public URL-scheme/default-host handover is separately gated; see the [review and rollback implementation](native-link-handover.md).

Older apps do not hold these leases. The macOS CLI also refuses known running Craft Hub app executables. It cannot reliably identify every older Node CLI process, so `--confirm-stopped` is the caller's explicit confirmation that those clients are closed too. No process is stopped by the migration command.

The operation creates a private sibling transaction directory named `.Craft Hub Prototype.migration-<uuid>`. It contains a source snapshot, a staged candidate, the previous candidate when present and a versioned recovery journal. Copied regular files are private, retaining only their owner execute bit where needed. It rechecks the review before replacing the candidate and verifies the installed snapshot. The source stays untouched. Repeating the same completed review returns its existing receipt without overwriting later candidate edits.

Keep the returned transaction path. After migration, start the candidate and verify project/trust state, settings, plugin declarations and diagnostics before daily use. Connected accounts and external extensions need their own compatibility checks; a successful directory copy does not establish that they work in the new host.

## Roll back or recover

Quit both hosts and CLI clients again. Preview rollback to obtain the current candidate revision:

```sh
node packages/craft-hub/dist/cli.mjs profile:rollback /absolute/transaction/path
node packages/craft-hub/dist/cli.mjs profile:rollback /absolute/transaction/path \
  --revision REVIEWED_HASH --confirm-stopped
```

Rollback moves the current candidate, including edits made after migration, into a `returned-candidate-<uuid>` directory inside the transaction. It restores the previous candidate if one existed. It does not merge those later edits into Electron or delete backups. A changed rollback revision is rejected.

After an interrupted migration, inspect its retained journal and run:

```sh
node packages/craft-hub/dist/cli.mjs profile:recover /absolute/transaction/path --confirm-stopped
```

Recovery verifies directory hashes before completing an installed stage or restoring the prior candidate. Ambiguous state is left intact for manual review. An error is not permission to delete transaction directories. Process-crash recovery is tested; sudden power-loss durability has not been separately fault-injected.

## Reproduce the isolated rehearsal

```sh
pnpm build
pnpm build:macos
pnpm test:macos-migration
```

The verifier uses temporary source/candidate directories and a temporary home. It runs the actual bundled CLI preflight, applies/repeats the copy through the public offline runtime API with a fixture-specific quiescence check, and starts the actual bundled sidecar on the result. It checks project trust, settings, plugin/diagnostic API access, absence of execution, live-process migration exclusion across different `TMPDIR` values, normal exit, and rollback preserving later edits. It removes only its own fixture and processes. The separate runtime tests cover stale reviews, invalid inputs, authenticated identity blockers, forced process exit between renames and after installation, and recovery journals. Real-data migration and native UI acceptance remain separate gates.
