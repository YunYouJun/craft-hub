# Craft Hub agent guide

Craft Hub is a local, cross-project developer workbench. Project Palette discovers project commands and agent skills; the shared runtime powers the CLI, browser UI, and Electron shell.

## Architecture

- `packages/craft-hub`: source of truth for project registry, capability discovery, trust, execution, persistence, local API, and CLI.
- `apps/web`: Vue UI that consumes the local API. Keep it usable in a normal browser.
- `apps/desktop`: thin Electron host. Keep domain logic out of this package.
- `apps/macos`: SwiftUI/AppKit macOS candidate with a WKWebView fallback and the shared TypeScript sidecar. Consume public API/event contracts; keep discovery, trust, execution and persistence in the runtime. Keep candidate data isolated from Electron until an explicitly accepted migration (ADR 0012).
- `examples/sample-project`: deterministic manual-test fixture.
- `docs/design/workbench-concept.webp`: visual baseline for the workbench.

Keep the runtime vendor-neutral. Agent integrations belong behind adapters; editor or desktop clients consume public runtime contracts.

Keep runtime code, fixtures, examples, documentation, and tests free of organization-specific product, account-system, package-scope, registry, editor, and intranet-domain names. Those belong only in downstream distributions. Run `pnpm check:public-boundary`; CI treats any denylist match as a hard failure.

The sole data exception is `packages/craft-hub/catalogs/workstation.config.ts`: this copied, statically parsed catalog may name public third-party software. Workstation owns `software.config.ts`; never edit the snapshot manually. Refresh it with `pnpm software-catalog:sync <software.config.ts>` as described in `docs/guide/software-catalog.md`. Private sources and machine state stay outside the catalog.

## Safety boundary

Capability discovery is read-only. A new project is `untrusted`, and command execution requires explicit trust. Represent execution as `command` plus `args`, set `shell: false`, and preserve the project working directory. Add raw shell support only through an explicit future config surface with its own review.

Persist user state in the operating-system Craft Hub data directory. The project repository only owns optional `.craft-hub/project.jsonc` metadata. Keep it declarative, validate it through the Zod schema, preserve comments with JSONC AST edits, and place third-party data under `extensions`.

## Working conventions

- Before pushing, inspect remote branch protection. Keep `main` history linear and wait for required checks before merging.
- For repository declarations or integration templates, follow `docs/guide/repository-format.md` and reuse `examples/repository-templates/`. Run `pnpm repo:validate <directory> --json` with the required trusted validators; resolve invalid and unsupported results before handoff.
- Use pnpm catalog dependencies from `pnpm-workspace.yaml`.
- Use ESM and strict TypeScript. Add JSDoc to public runtime APIs.
- Follow the repository ESLint config: no semicolons and single quotes.
- Add discovery and trust/execution tests with every runtime behavior change.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, and `pnpm build` before handoff.
- For native changes also run `pnpm lint:macos` and `swift test --package-path apps/macos`; candidate handoff requires `pnpm build:macos` and real Release App checks. Keep missing daily-use, minimum-system and release-credential acceptance explicit.

## Local macOS acceptance lifecycle

- Keep the installed native daily-use app running and Electron closed as a fallback. Preserve app bundles, user profiles, drafts and acceptance evidence.
- Close each acceptance session's temporary hosts and sidecars before handoff, including failure, cancellation or waiting for user input. Scripted sessions must automate cleanup with `finally` and signal handlers; manual UI sessions must perform equivalent cleanup. Verify exit against the recorded PID, executable and process start time. Preserve fixtures for resumption and leave the daily-use instance running; broad process-name termination is prohibited.

Packages remain private during the early alpha. The intended first public package is `craft-hub@0.0.1-alpha.0` on the `next` dist-tag after a successful pack and publish dry run; publishing requires explicit authorization.
