# Dependency security maintenance

Upgrade direct dependencies through the workspace catalog. Keep the lockfile, production audit and dependency regression tests together; never suppress an advisory just to make CI pass.

## TypeScript compiler and API consumers

TypeScript 7 runs `pnpm typecheck`. ESLint, TypeDoc, Vue tooling and compiler-API tests still require the JavaScript API. The catalog therefore follows Microsoft's [side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60): `@typescript/native` aliases TypeScript 7, and `typescript` aliases the official `@typescript/typescript6` compatibility package. This avoids replacing API calls with casts or disabling checks.

## Microsoft To Do connector

The pinned connector's Zod 4 compatibility patch uses `z.toJSONSchema` for input schemas, updates record key schemas and optional/lazy unwrapping, and retains the connector's allowlists and confirmation requirements. MSAL Node is overridden to the patched 7.1 series. Offline integration tests exercise real MCP schema registration and the MSAL cache with isolated fixture storage; they never log in or access a user's credential store. Remove the patch when the upstream connector supports Zod 4 directly.

## Reviewed supply-chain exceptions

`@pierre/diffs@1.6.1` requires `@pierre/theme@2.0.0`, whose publication lacks the provenance of an earlier theme release. The exact theme tarball was reviewed on 2026-10-25 before adding a version-specific `trustPolicyExclude` entry. The registry publisher is the same publisher as `@pierre/diffs@1.6.1`. The package has no dependencies or lifecycle scripts. All eleven JavaScript modules consist solely of a literal theme-name array or `Object.freeze(JSON.parse(...))` containing the corresponding theme JSON, with no additional statements. This is a content review, not a provenance attestation.

Reviewed tarball integrity:

```text
sha512-yNDd9GYLQl1mEUJR8AneJ5e4ohLIHQd/wZLWr4fagt78vS2RwwZNW530vVgHqXFAyFVcFlRmGUD5ramXH46OXw==
```

Keep the exception restricted to this version and integrity. Review replacement artifacts independently, and remove the exception when upstream restores provenance. `trustPolicy: no-downgrade` and the minimum release age remain enabled for the workspace.
