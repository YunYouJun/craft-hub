# Workstation configuration management — execution and acceptance

Status: implementation and isolated acceptance complete; real-machine adoption awaits explicit item decisions. Do not close the dotfiles sync Todo before that adoption is verified.

## Isolation and dependencies

- Craft Hub: branch `codex/workstation-configuration`, sibling worktree `craft-hub-workstation`, baseline `edf035c`.
- workstation: branch `codex/configuration-protocol`, sibling worktree `workstation-configuration`, baseline `7547545` (includes `ee33395`).
- Original Craft Hub checkout contains extensive unrelated uncommitted changes, including a newer resource-page protocol and Codex inspector. Preserve them; do not wholesale import them.
- Private configuration checkout contains uncommitted README and MCP overlay changes. Read only until the user selects a reviewed plan. Never record private paths, configuration values or credentials in this public document.
- No AGENTS.md was found in the workstation or private checkout roots. Craft Hub AGENTS.md applies here.

## Execution sequence

1. [x] Inspect repository constraints, dirty files and existing MCP/Git implementations; create isolated branches.
2. [x] Versioned workstation interface: read-only inventory, sanitized comparison, ownership, first-adoption vs baseline status.
3. [x] MCP per-item decisions, immutable preview, revision checks, backups, safe apply and guarded recovery; reuse workstation TOML/export/safe-file logic.
4. [x] User skills, global instructions, Zsh, Starship and Ghostty; managed/system/project boundaries.
5. [x] Git state, reviewed commit, fetch and explicitly separate publish; reuse Git transport and secret scan.
6. [x] Trusted Host Plugin and minimal generic configuration UI through local runtime; cloud denial.
7. [x] Isolated HOME/two-device temporary remote acceptance suite and real read-only MCP conflict inspection.
8. [x] Browser interaction acceptance, repository lint/typecheck/tests/build, English and Chinese documentation.
9. [ ] Report evidence and pending real choices. Apply real configuration only following explicit item decisions.

## Acceptance matrix

Verified by the automated and browser runs recorded below: new-device recovery; repeated application; local/source/both edits; deletion; no-baseline adoption; read-only ownership; credentials withheld; offline remote; concurrent file modification; scan failure; partial-write failure and recovery; uncommitted/unpushed/behind/diverged Git states; list/diff/decision/preview/apply/recovery browser flow.

## Design constraints

The workstation process owns all file interpretation, plans, baselines, writes, backups, rollback and Git operations. Host and plugin handle presentation and invocation only. Client requests use item/plan identifiers, never authoritative filesystem paths. No credentials, login state, cache, execution approvals or plugin/system skill payloads are migrated. No baseline means first-adoption, never a claimed three-way merge. Local apply and repository commit/publish are separate actions.

## Implemented (2026-09-09)

- Versioned workstation stdin/stdout JSON API, shared by CLI and Host Plugin.
- MCP inspection, source ownership, first adoption/baseline state, per-item and field choices, immutable previews, explicit application, journaled backups and guarded recovery.
- Public global instructions/Zsh/Starship/Ghostty mappings and private local user skill trees, including per-file deletion. Installer/system/plugin roots are protected; project MCP overrides are read-only and separately identified. Runtime caches and common authentication artifacts are excluded from skill traversal.
- Separate Git status/commit/fetch/publish workflows. Source commits are allowlisted by managed paths, refuse existing staging, require revision review and scanning; publication reuses existing workstation fast-forward and non-forced transport. Outgoing commit IDs, changed-line counts and redacted patches are reviewable.
- Generic host configuration renderer and operations, explicit confirmation floors, project trust and hosted-runtime denial. Desktop bundles the thin adapter; standalone browser hosts explicitly load it.
- English and Chinese guides in both repositories. Limits include conservative redaction, manual aligned-line merging, no automatic Git divergence resolution, bounded text files, recovery journals rather than an OS-wide transaction, and manual handling of stale locks after crashes.

## Verification evidence

### Automated

Workstation configuration suites cover: first adoption; absent HOME configuration; repeated application; local/source/both changes; MCP and skill deletion; source ownership changes; retained execution approvals; parser failures; linked paths; independent terminal management; scanner unavailability; concurrent changes during temporary-file preparation; partial write failure and recovery; later edits preventing recovery; explicit text merge; project ownership; mixed decisions for multiple MCP servers; and permission changes before recovery.

Temporary bare remotes and two independent checkouts/HOME directories cover: restoring a new device from a reviewed publication; dirty/unpushed/behind state; safe fetch and publish; divergence; offline transport; stale commit review; preservation of unrelated staged work; scan failure; redacted Git patches.

Craft Hub tests cover provider resolution/discovery, confirmation, operation-selector isolation, hosted-runtime denial, project trust, preview selection with immutable revision, and error/recovery UI. Full suite passed with two workers after one transient existing filesystem-watcher timeout under heavy concurrent test/build load. The initial PTY failures were caused by the isolated installation's non-executable `node-pty` spawn helper; correcting the dependency's execute bit restored all existing execution tests without changing runtime execution code.

The supplementary Vue typecheck exposed two pre-existing missing translation references in `PluginWorkbench.vue`; they now use the already-defined equivalent key. This is the only unrelated source correction needed for that check.

### Browser

Environment: actual local Craft Hub API and compiled Vue app, backed by the built workstation CLI, disposable HOME/public/private repositories, and a temporary local bare Git remote. Used the available CUA in-app browser; no browser package installation was required.

Passed flow:

1. Open Development environment → inventory and type filters.
2. Select MCP → see redacted differences and safe command/enable/timeout fields → choose source → preview exact local path → apply → synchronized → restore → first adoption.
3. Select user skill → preview → independently modify its local file → apply rejected → visible error and recovery refresh → fresh preview → successful apply.
4. Select Zsh → preview local destination → successful application. MCP and skill state remain independently visible.
5. Keep a local MCP configuration → preview repository destination → save → source remains uncommitted → select its path → review and commit → unpushed count 1 → review outgoing commit and redacted patch → separately publish → unpushed count 0.
6. Page identity and meaningful content verified; no framework overlay or relevant console warnings/errors. Desktop and 390px viewport screenshots were inspected. Narrow-page overflow was corrected only for the configuration view; after loading, document width and scroll width were both 390px.

### Real configuration

Read-only real inventory was opened at the separate local service on port 4328. It contains 22 MCP entries: 12 first-adoption differences, 3 semantically synchronized entries and 7 unmanaged entries. All decision controls remained on Defer. Private manifest user skills and public terminal/instruction mappings are also listed.

A local in-memory redaction check compared two detected literal credential values against the API response: zero were present. Neither credential values nor private MCP names are recorded in this public document.

No real configuration plan was chosen or applied. No real source repository was committed, fetched or published. Original dirty worktrees remain separate.

## Remaining user-owned actions

- Choose resolutions in the real configuration view. Applying those choices requires the user's explicit action; there is no default winner.
- Integrate the isolated branches with the unrelated in-progress main-worktree protocol changes when those are ready. The original desktop installation has not been replaced.
- Keep the dotfiles sync Todo open until the real choices are applied and checked. UI completion alone is not closure.

Local verification logs are under `/tmp` with prefixes `craft-hub-workstation-` and `workstation-`. The durable evidence above records the tested cases; temporary fixtures and logs are not product state or portable backups.


## Final check results

- Craft Hub: public boundary, lint, TypeScript, supplementary Vue typecheck and build passed. Full test run: 114 files, 598 tests passed (`pnpm test --run --maxWorkers=2`).
- workstation: lint, typecheck and build passed. Full tests: 213 CLI tests plus 9 companion-package tests passed (222 total). Documentation build also passed.
- Browser: MCP/skill/terminal apply flows, recovery, stale-plan error, separate Git commit/publish and responsive layout passed against isolated real backend fixtures. The live real-data view remains undecided.


## Local delivery commits

- Craft Hub implementation: `07cefe0` on `codex/workstation-configuration`.
- workstation implementation: `2579076` on `codex/configuration-protocol`.
- Both isolated worktrees are committed. No implementation branch was pushed or merged; original working-copy changes were preserved.
