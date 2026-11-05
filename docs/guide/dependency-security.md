# Dependency security maintenance

Upgrade direct dependencies through the workspace catalog. Keep the lockfile, production audit and dependency regression tests together; never suppress an advisory just to make CI pass.

## Redirect patch (2026-11-04)

The override pins `follow-redirects` to 1.16.2 to resolve [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p), which affects 1.16.0–1.16.1. This is a targeted security patch; the other catalog versions are unchanged. Validate with `pnpm audit --prod --audit-level high`.

## Dependency refresh (2026-11-02)

All 84 catalog entries and the package manager were checked against the npm registry. This refresh upgrades 19 catalog entries, including Electron 45.2.1, Codex SDK 0.166.0, the Microsoft To Do connector 0.178.0, Babel parser 8.0.10, Marked 18.1.2 and Pierre Diffs 1.6.2. Build and development updates include tsdown 0.23.4, ESLint 10.14.0, UnoCSS 66.12.0, vue-tsc 3.3.14, Devframe 1.3.0 and Wrangler 4.156.0. VitePress stays on its existing 2.0 alpha channel at alpha.21. Vue, Vite, Vitest and both TypeScript packages already use the latest applicable versions.

The workspace package manager is [`pnpm@12.16.1`](https://github.com/pnpm/pnpm/releases/tag/v12.16.1). The 24-hour minimum release age and provenance policy continue to apply. Shiki 4.6.0, CloudBase JS SDK 3.11.0, Devframe 1.3.2 and Wrangler 4.156.1 were too recent at review time; their latest eligible versions remain selected.

CloudBase JS SDK advances to 3.10.4, matching Dependabot request #57. The older 4.0.0 artifact was published on 2025-08-06 and is outside the current stable release line. The MCP SDK remains at 1.32.2 in both the catalog and override.

The Devframe family is resolved together at 1.3.0 so Vite DevTools and UnoCSS share compatible peers. Production audit fixes set minimum versions for `follow-redirects` 1.16.2, `@hono/node-server` 2.1.3, `qs` 6.16.1 and `glob` 14.0.2. The remaining production Minimatch consumers, `ignore-walk` and `@tufjs/models`, use scoped overrides to 11.0.1. TypeDoc retains its supported Minimatch 10 dependency because it calls `matchOne`, which version 11 removed; the development-only advisory remains visible to a full audit. Glob and the production Minimatch overrides cross major versions; an offline regression test packs and extracts a real local package through Pacote, checking nested file inclusion, brace patterns, excluded source maps and disabled lifecycle scripts.

## TypeScript compiler and API consumers

TypeScript 7 runs `pnpm typecheck`. ESLint, TypeDoc, Vue tooling and compiler-API tests still require the JavaScript API. The catalog therefore follows Microsoft's [side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60): `@typescript/native` aliases TypeScript 7, and `typescript` aliases the official `@typescript/typescript6` compatibility package. This avoids replacing API calls with casts or disabling checks.

## Microsoft To Do connector

The connector now supports Zod 4 upstream, so the local 0.171.0 compatibility patch has been removed. Version 0.178.0 depends directly on Zod 4 and MSAL Node 7.1.1. Offline integration tests continue to exercise real MCP schema registration, To Do allowlists, write confirmation and the MSAL cache with isolated fixture storage; they never log in or access a user's credential store.

## Reviewed supply-chain exceptions

`@pierre/diffs@1.6.2` continues to require `@pierre/theme@2.0.0`, whose publication lacks the provenance of an earlier theme release. The exact theme tarball was reviewed on 2026-10-25 before adding a version-specific `trustPolicyExclude` entry. The registry publisher is the same publisher as `@pierre/diffs@1.6.1`. The package has no dependencies or lifecycle scripts. All eleven JavaScript modules consist solely of a literal theme-name array or `Object.freeze(JSON.parse(...))` containing the corresponding theme JSON, with no additional statements. This is a content review, not a provenance attestation.

Reviewed tarball integrity:

```text
sha512-yNDd9GYLQl1mEUJR8AneJ5e4ohLIHQd/wZLWr4fagt78vS2RwwZNW530vVgHqXFAyFVcFlRmGUD5ramXH46OXw==
```

Keep the exception restricted to this version and integrity. Review replacement artifacts independently, and remove the exception when upstream restores provenance. `trustPolicy: no-downgrade` and the minimum release age remain enabled for the workspace.
