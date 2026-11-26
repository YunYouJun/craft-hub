# ADR 0016: Document spaces and host-contributed workbenches

Date: 2026-11-27. Status: accepted for implementation.

## Context

Craft Hub manages local projects, software readiness, environment migration ([ADR 0011](./0011-focus-on-machine-setup-and-environment.md)), and shared Vue business views across browser and desktop hosts ([ADR 0013](./0013-share-business-pages-across-desktop-hosts.md), [ADR 0014](./0014-keep-electron-and-use-an-optional-resident-companion.md)).

While coding sessions, worktrees, and interactive terminals remain delegated to external coding workbenches ([ADR 0009](./0009-focus-on-project-capabilities-and-integrations.md)), local development and planning workflows also generate durable documents: project notes, specifications, drafts, daily notes, and multi-document folder bundles. Today, Craft Hub only exposes read-only Markdown previews inside `resource-browser` blocks, forcing rich authoring and structured card organization into separate external tools and duplicating navigation/handoff surfaces.

## Decision

1. **Local-first Document Spaces as an open-source capability**:
   Craft Hub adds **Document Spaces** (`/spaces`) as a first-class, vendor-neutral capability alongside projects and development environments.
   - Standard Markdown (`.md`) with optional YAML frontmatter is the canonical on-disk format so external editors, Git workflows, and coding agents can read and update files directly.
   - A directory containing an entry document (`index.md`, `brief.md`, or `README.md`) acts as a **bundle** whose sibling Markdown files and child folders appear as subpage cards, alongside explicit inline `::card[...]` directives.
   - Writes use SHA-256 optimistic revision checks (`expectedRevision`) and refuse silent last-write-wins overwrites, surfacing conflicts (`409` / `conflict` result) for explicit diff review.
   - File watching emits coalesced `document-space-change` events over `/api/events` so clean open views reload automatically and dirty editors preserve local edits for comparison.

2. **Pluggable `DocumentSpaceProvider` and `document-space` block**:
   - The runtime ships a built-in `LocalFilesystemDocumentSpaceProvider` (storing registered space roots in `<dataDir>/document-spaces.json` with path-containment validation and symlink protection).
   - Trusted Host Plugins may register additional `documentSpaceProviders` to expose domain-specific workspaces (for example, repository-backed drafts or remote media references) without duplicating the editor, tree navigation, collection cards, or conflict-diff UI.
   - Declarative integration views may include a `document-space` block (`integrationViewBlockSchema`), and `workbenchContributionSchema` adds `'document-spaces'` to supported `host` views.

3. **Host-contributed workbenches and public boundary**:
   - Trusted Host Plugins may contribute `workbenches` alongside `integrations`, merged into `/api/workbenches` with Marketplace-contributed workbenches.
   - Marketplace packages remain strictly declarative and code-free ([ADR 0006](./0006-separate-marketplace-plugins-from-host-plugins.md)).
   - All core Document Space contracts, storage schemas, UI components, and tests in this repository stay 100% vendor-neutral and free of private workflow assumptions.

## Consequences

- Open-source users gain a calm, block-and-card Markdown workspace for any local directory or project documentation tree with zero plugins required.
- Downstream or private Host Extensions can plug domain-backed document spaces and custom navigation workbenches into the shared Vue UI without forking Craft Hub.
- Existing Project Trust, structured command execution, and external tool handoff boundaries remain unchanged: opening or editing a document never grants command execution trust.
