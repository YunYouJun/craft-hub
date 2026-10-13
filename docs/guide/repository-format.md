# Repository integration convention

Use existing repository declarations to describe a project or publish a Workstation configuration source. Craft Hub discovers these files as data; Workstation owns project checkout and configuration execution.

## Generate or change declarations

1. Copy the files you need from the [ordinary project template](https://github.com/YunYouJun/craft-hub/tree/main/examples/repository-templates/project) or [Workstation source template](https://github.com/YunYouJun/craft-hub/tree/main/examples/repository-templates/workstation-source).
2. Replace example names, `github.com/example` and `example.com` URLs, and software metadata. Retain version fields, schema pointers and JSONC comments. Project metadata references discovered command IDs; executable commands belong in existing command files.
3. Run [read-only validation](#unified-read-only-validation), loading the trusted Workstation Host Plugin for `projects.yaml`. Resolve invalid declarations and unsupported validators until every declaration reports `valid` and the command exits with status `0`.
4. Review the diff before committing. Share declarations; keep [device bindings and credentials](#repository-identity-and-local-state) local.

## File responsibilities

| File | Authority and purpose | Format reference |
| --- | --- | --- |
| `README.md` | Explain repository purpose, setup and validation | Repository documentation |
| `AGENTS.md` | Point agents to the applicable format and verification steps | This guide and the repository's own rules |
| `.craft-hub/project.jsonc` | Project metadata and settings for discovered commands and Skills | [Project configuration](./configuration.md) |
| `.craft-hub/source.jsonc` or `craft-hub/source.jsonc` | Publish portable workspace membership | [Workspace sources](./workspace-sources.md) |
| `projects.yaml` | Workstation repository groups and checkout declarations | [Workstation projects](https://github.com/YunYouJun/workstation/blob/main/docs/en/guide/projects.md) |
| `software.config.ts` | Literal `softwareGroups` software metadata | [Software catalogs](./software-catalog.md) |

Workspace membership and checkout groups are independent; validation neither compares their repository lists nor imports them. Configuration sources can publish any subset of these declarations. Configuration payloads and private manifests follow Workstation's configuration workflow.

## Declaration discovery

`repo:validate` reads these bounded locations inside the selected directory:

- Project metadata: `.craft-hub/project.jsonc`.
- Workspace sources: `.craft-hub/source.jsonc` or `.craft-hub/source.json`, and the corresponding files under `craft-hub/`. Publishing both bundle names in the same directory is a conflict. A bundle is authoritative in its directory; when absent, the reader checks individual workspace JSON/JSONC files in that directory and its `workspaces/` child.
- Software catalog: root `software.config.ts`.
- Workstation projects: root `projects.yaml`, `projects.yml` and `projects.example.yaml`. Every present file is reported; `projects.local.yaml` is excluded.

Workspace fallback skips known metadata names (`project`, `projects`, `catalog`, `dotfiles`, `config`, `user-config`, `owner-scopes` and `settings`, with `.json` or `.jsonc`) at each source configuration directory's root. The same names inside `workspaces/` are checked as workspace documents. Apart from the separately validated `.craft-hub/project.jsonc`, the skipped metadata files are outside this release's four declaration formats.

Each declaration is limited to 256 KiB and must be a regular file under regular directories. Discovery does not recurse beyond the listed locations. Software center and other import workflows have independent limits.

## Repository identity and local state

Shared workspace references use HTTPS repository URLs without credentials, query strings or fragments, retaining host and namespace: `https://github.com/example/app`. Workstation also accepts existing SSH and short-path formats; shared templates prefer HTTPS for portability.

Use `<checkout-root>/<host>/<namespace>/<repository>` unless an existing project requires another layout. Select the root per machine; templates omit Workstation's optional `root`. Craft Hub's local data directory stores path bindings, subscriptions, workspace selections and execution trust. Credentials, real private manifests, session files and machine overrides stay outside shared declarations or in ignored local files. Share private repository identities only within the appropriate repository visibility.

Loading reads declarations and produces a preview; newly registered projects start untrusted. Installation, cloning, configuration changes and restoration retain their authorization and preview flows. Catalog declarations confer no execution permission.

## Schemas and compatibility

Editor schema pointers are hints; validation uses the existing local parsers and never fetches the pointer URL.

| Declaration | Editor schema |
| --- | --- |
| Project JSONC | [`project-v1.schema.json`](https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/project-v1.schema.json) |
| Workspace source JSONC | [`workspace-source-v1.schema.json`](https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/workspace-source-v1.schema.json) |
| Workstation projects YAML | [`projects.schema.json`](https://raw.githubusercontent.com/YunYouJun/workstation/main/schemas/projects.schema.json) |
| Software TypeScript | Existing static AST parser; `export const softwareGroups = [...] as const` |

Individual workspace JSON/JSONC documents use the workspace source schema URL with `#/$defs/workspace` appended.

Project metadata uses `version: 1`; workspace sources use `schemaVersion: 1`; Workstation projects retain their versionless format. Core JSONC schemas reject unknown fields; project-specific third-party data belongs under `extensions.<provider>`. Extend each existing format through its compatibility rules.

Maintainers check schema drift with `pnpm schema:project:check`, `pnpm schema:source:check` and, in Workstation, `pnpm projects:schema:check`. Regenerate with the corresponding command without `:check` after changing the authoritative schemas.

## Unified read-only validation

```sh
craft-hub repo:validate /path/to/project --json
craft-hub repo:validate /path/to/configuration-source --json \
  --host-plugin @craft-hub/craft-hub-plugin-workstation
```

The installed, explicitly trusted Host Plugin negotiates repository validation protocol v1 and operation support, then delegates YAML content to Workstation's `host-json` request `{ "version": 1, "operation": "validate-projects", "content": "..." }`. Inspected declarations cannot select host modules. An older CLI or absent validator reports YAML as `unsupported` and exits unsuccessfully while returning the other results.

Within the Craft Hub checkout, the equivalent development command is:

```sh
pnpm repo:validate examples/repository-templates/project --json
pnpm repo:validate examples/repository-templates/workstation-source --json \
  --host-plugin "$PWD/packages/craft-hub-plugin-workstation/dist/index.mjs"
```

Build the Host Plugin and use a compatible Workstation CLI before the second command. Validation runs no repository scripts, does not import `software.config.ts`, contact Git remotes or change Craft Hub state. A directory with no declarations reports `no-configurations` and fails validation.

The JSON report contains `version: 1`, `valid`, `files`, top-level `issues` and `summary`. Each file records `file`, `format`, `validator`, `status` (`valid`, `invalid` or `unsupported`) and `issues`. Issues identify the field path, message and available line/column. Success confirms structure and parser semantics; remote access and installability require their own workflows.
