# Craft Hub agent guide

Craft Hub is a local, cross-project developer workbench. Project Palette discovers project commands and agent skills; the shared runtime powers the CLI, browser UI, and Electron shell.

## Architecture

- `packages/craft-hub`: source of truth for project registry, capability discovery, trust, execution, persistence, local API, and CLI.
- `apps/web`: Vue UI that consumes the local API. Keep it usable in a normal browser.
- `apps/desktop`: thin Electron host. Keep domain logic out of this package.
- `examples/sample-project`: deterministic manual-test fixture.
- `docs/design/workbench-concept.webp`: visual baseline for the workbench.

Keep the runtime vendor-neutral. Agent integrations belong behind adapters; editor or desktop clients consume public runtime contracts.

## Safety boundary

Capability discovery is read-only. A new project is `untrusted`, and command execution requires explicit trust. Represent execution as `command` plus `args`, set `shell: false`, and preserve the project working directory. Add raw shell support only through an explicit future config surface with its own review.

Persist user state in the operating-system Craft Hub data directory. The project repository only owns optional `.craft-hub/project.jsonc` metadata. Keep it declarative, validate it through the Zod schema, preserve comments with JSONC AST edits, and place third-party data under `extensions`.

## Working conventions

- Use pnpm catalog dependencies from `pnpm-workspace.yaml`.
- Use ESM and strict TypeScript. Add JSDoc to public runtime APIs.
- Follow the repository ESLint config: no semicolons and single quotes.
- Add discovery and trust/execution tests with every runtime behavior change.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test --run`, and `pnpm build` before handoff.

Packages remain private during the early alpha. The intended first public package is `craft-hub@0.0.1-alpha.0` on the `next` dist-tag after a successful pack and publish dry run; publishing requires explicit authorization.
