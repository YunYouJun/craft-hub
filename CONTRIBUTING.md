# Contributing to Craft Hub

Thanks for helping improve Craft Hub. The project is in early alpha, so small, focused changes with tests are easiest to review.

## Development setup

Install Node.js 22.18 or newer and pnpm 11, then run:

```bash
pnpm install
pnpm dev:web
```

Use `pnpm dev` when you also need the Electron host.

## Architecture and safety

- Keep shared runtime behavior in `packages/craft-hub`.
- Keep the browser UI usable without Electron and keep domain logic out of `apps/desktop`.
- Capability discovery must remain read-only. A new Project is untrusted and must require explicit trust before execution.
- Represent execution as a command and argument array with `shell: false`; preserve the Project working directory.
- Keep repository-owned `.craft-hub/project.jsonc` metadata declarative and credential-free.
- Keep runtime code, fixtures, documentation, and tests vendor-neutral. Run the public-boundary check before submitting changes.

See [CONTEXT.md](./CONTEXT.md) for the domain vocabulary and [docs/adr](./docs/adr) for accepted architectural decisions.

## Quality checks

Run all required checks before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
pnpm docs:build
pnpm audit --prod
```

Runtime behavior changes should include tests at the discovery, trust, or execution boundary they affect. Keep commits scoped and explain the user-visible reason for the change.

## Security reports

Do not disclose suspected vulnerabilities in an issue or pull request. Follow [SECURITY.md](./SECURITY.md) instead.
