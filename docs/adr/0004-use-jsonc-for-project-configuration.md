# ADR 0004: Use JSONC for project configuration

## Status

Accepted

## Context

Craft Hub project metadata is repository-owned, developer-facing, and updated by people, the workbench UI, and reviewed Codex workflows. The format must support comments, deterministic runtime validation, editor completion, minimal programmatic edits, readable Git diffs, and use without executing project code.

Strict JSON has the strongest interoperability but cannot retain user comments. YAML is concise for hand-authored prose, but still needs a JSON Schema for editor intelligence and makes automated scalar handling and AST edits less predictable. TOML becomes cumbersome for nested capability maps and localized descriptions. Executable TypeScript configuration would widen the trust seam and prevent read-only discovery.

The project is still private early alpha, with no published compatibility commitment. This is the lowest-cost point to choose one canonical format rather than maintain JSONC and YAML paths indefinitely.

## Decision

Craft Hub project metadata uses `.craft-hub/project.jsonc` as its only format.

Zod v4 is the single source of truth for runtime validation and TypeScript types. A checked-in Draft 2020-12 JSON Schema is generated from Zod, published under a stable versioned URL, and included in the npm package. Runtime validation uses the bundled Zod model and does not depend on network access.

Core configuration objects reject unknown fields. Third-party data is isolated under `extensions`. The configuration is declarative, explicitly versioned, and contains no credentials. Programmatic changes use JSONC AST edits and atomic replacement so comments and unrelated valid data survive.

The repository's YAML project configs and fixtures are migrated once. Project-config YAML parsing, watching, writing, compatibility types, documentation, and tests are removed. YAML dependencies remain where ecosystem-owned files such as `pnpm-workspace.yaml` and Taskfile require them.

## Consequences

- Callers use one configuration interface and never branch on file format.
- Editors and third-party tools can consume a versioned public Schema; Craft Hub remains fully offline at runtime.
- Schema, TypeScript types, and runtime validation cannot drift independently.
- Third-party parsers must support JSONC rather than calling `JSON.parse` directly.
- External editors without a cached Schema may lack completion on their first offline open; parsing and Craft Hub validation still work.
- Future breaking changes require a new configuration version, Schema, and deterministic migration.
