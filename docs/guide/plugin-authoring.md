---
title: Author a Marketplace Plugin
description: Create, validate, pack, and locally test a declarative Craft Hub Marketplace Plugin.
---

# Author a Marketplace Plugin

Craft Hub Marketplace Plugins are data-only npm packages. Craft Hub reads `package.json#craftHub`, validates every contribution, and never imports package JavaScript. Use a Host Plugin instead only when an embedding application must load trusted executable code.

The [plugin marketplace contract](./plugin-marketplace.md) defines every Manifest and Catalog field. The runtime's exported `pluginManifestV1Schema` remains the source of truth while the API is in alpha.

## Create a package

Interactive initialization asks for the package identity, display name, license, and contribution types:

```bash
craft-hub plugin:init ./my-plugin
```

Agents and CI should use the deterministic form:

```bash
craft-hub plugin:init ./my-plugin \
  --non-interactive \
  --package @example/craft-hub-plugin-tools \
  --display-name "Example tools" \
  --license MIT \
  --with-command \
  --with-skill \
  --with-project-template
```

The target directory must be absent or empty. Initialization never overwrites existing content. Package names must use a scoped `craft-hub-plugin-*` or `plugin-*` name. Identity and licensing values must be supplied by the author rather than inferred from Git or npm credentials.

The first authoring workflow scaffolds three contribution types:

- `commands`: structured `command` plus `args`; shell interpolation is unavailable and Project Trust is still required before execution.
- `skills`: package-relative Agent Skill files with a stable `id`. New plugins should declare it explicitly; legacy v1 entries without an ID retain their path-derived identifier. They are installed once and activated per project; an optional bounded `activation` expression enables automatic matching.
- `projectTemplates`: package-relative template directories.

Edit the generated placeholders before publishing. Add advanced contribution types directly against the Marketplace contract until they gain dedicated scaffolds.

### Declare Skill activation

A Skill without `activation` is manual-only. This is the recommended default for general-purpose Skills. For a framework- or tool-specific Skill, declare the project facts that make it relevant:

```json
{
  "id": "widget-assistant",
  "path": "skills/widget-assistant/SKILL.md",
  "activation": {
    "all": [
      { "dependency": "@example/widget" },
      { "any": [{ "file": "widget.config.ts" }, { "file": "widget.config.js" }] }
    ]
  }
}
```

Matchers support `file`, `dependency`, `packageManager`, `all`, `any`, and `not`. They are evaluated only at the project root and pnpm packages already discovered by Craft Hub. Automatic matching requires the plugin's `read-project-files` permission. It remains read-only and never executes plugin or project code.

### Add native work-item status transitions

A Host Plugin may implement `workItems.transitions` and `workItems.updateStatus`, while a Marketplace Plugin declares matching `work-items.transitions` and `work-items.update-status` actions. When the same integration renders entities from `work-items.get`, `work-items.search`, or `work-items.list`, Craft Hub adds the generic status control automatically.

The renderer sends the entity's scalar `metadata` back with its `itemId`, title, and current status. The transition result supplies the provider-native target statuses and any required field names. Every update remains a `remote-write`: Craft Hub shows a confirmation dialog, rejects an unconfirmed invocation, and exposes the reviewed decision to the trusted Provider as `context.confirmed`.

## Validate

Validation is read-only:

```bash
craft-hub plugin:validate ./my-plugin
```

It checks npm identity and versioning, the current Manifest Schema, permission relationships, package-relative paths, forbidden runtime dependencies and lifecycle install scripts, minimum Craft Hub compatibility, and the files that npm would include in the tarball. The command runs `npm pack --dry-run --ignore-scripts`; plugin scripts are not executed.

## Test locally

First validate the package. Then review its absolute path before explicitly linking it:

```bash
craft-hub plugin:link /absolute/path/to/my-plugin
craft-hub plugin:refresh @example/craft-hub-plugin-tools
```

The link persists in the operating-system Craft Hub data directory and overrides an installed Marketplace version with the same package name. Remove the override when testing is complete:

```bash
craft-hub plugin:unlink @example/craft-hub-plugin-tools
```

## Pack and prepare a Catalog Entry

Publisher identity must be explicit:

```bash
craft-hub plugin:pack ./my-plugin --publisher example
```

After validation, Craft Hub packs with scripts disabled, computes the actual SHA-512 integrity, and writes the tarball plus a validated Catalog Entry draft to `dist/`. Existing artifacts are never overwritten. The command prints absolute paths for review; it does not publish npm packages or modify a Plugin Catalog.

The Catalog maintainer remains responsible for reviewing Publisher identity, categories, compatibility, permissions, and the immutable version before merging the entry into a source. Publishing and Catalog signing stay outside this authoring command.

## Working example

[`examples/marketplace-plugin`](https://github.com/YunYouJun/craft-hub/tree/main/examples/marketplace-plugin) is the executable reference package used by repository tests. Keep authored packages free of runtime dependencies, optional dependencies, and npm install lifecycle scripts.

## Local configuration inspectors

Trusted Host Plugins may contribute `integrations` alongside `integrationProviders`. The runtime validates and renders these declarations without requiring a second Marketplace installation. Use `configuration.list` with `local-read` for read-only configuration inspection; Marketplace declarations using this effect must disclose the `local-read` permission. Providers should return only display-safe fields through entity `details`, never raw configuration or credentials.

The Codex inspector in `packages/craft-hub-plugin-codex` demonstrates this contract. The desktop shell loads it as a trusted dependency; browser hosts can explicitly load a built Host Plugin with `craft-hub ui --host-plugin /absolute/path/to/plugin/dist/index.mjs`.

Scoped configuration controls use `configuration.update` with `local-write`. Marketplace declarations must disclose `local-write`. Write actions retain the host confirmation floor; a deliberate switch click supplies a confirmed invocation. Return `configurationToggle` on editable entities with the selected scope, effective boolean, inheritance flag, and opaque file revision. The provider must validate the requested entity and derive the target file on the host.

## Connection onboarding

Declare `connection.update` with `local-write` and an explicit confirmation policy next to `connection.status`. The trusted provider implements `connection.update` and returns display-safe `forms` and `links` from its status. Each form has an ID, title, submit label, and text/password fields. A deliberate form submission confirms that specific local operation; discovery and status checks never start authorization or save credentials. Never return password values in a form or include credentials in error messages.

For OAuth, the server supplies `context.callbackUrl`. The provider returns an HTTPS `authorizationUrl` containing an unpredictable `state` and implements `connection.complete`. The host records the original project context for ten minutes and accepts the callback once at `/api/integrations/:id/callback`; the provider must additionally validate its OAuth state and perform the code exchange. Register the exact local callback URL with the authorization service. The user follows the authorization link and returns to refresh the connection and lists. Keep vendor endpoints and credential persistence inside the trusted Host Plugin.

Use contribution `translations` for view/action titles and display messages. Store project associations in local user state when they are machine-specific; a normal registered project should not need an unrelated legacy configuration format just to connect an integration.

Integration views may declare a package-relative image such as `"icon": "assets/icon.svg"`. Active Marketplace Plugins resolve these bounded assets inside their own package, including symlink containment checks. The host renders SVG through an isolated image element, never by injecting markup; the sidebar, workbench tabs, and page header share the image. Missing or failed images use the renderer's fallback icon. Keep brand assets and their source attribution in the plugin package.

An `action-form` block can set `collapsible: true` to start as a closed disclosure within its existing view, and `requiresProject: true` to show a project-selection prompt until that view has a project scope. These options let repository actions live alongside repository lists without creating a separate page. Opening the disclosure never invokes the action; the normal execution trust and confirmation rules still apply. Other block types do not accept these form options.

## Resource pages (unreleased)

A `resource-browser` block delegates domain data to a trusted Host Plugin's `resources` adapter. Declare `resources.read` (`remote-read`), `resources.update` (`local-write`) and `resources.execute` (`remote-write`) actions. Updates and execution require confirmation. The provider returns a `ResourcePage`: a title, current input, navigation links, entity rows, documents and forms. Forms select `read`, `update` or `execute`; the renderer maps that effect to the corresponding declared action. Document comparisons, Markdown preview, downloads, select/checkbox fields and text insertion suggestions are native host UI.

The host derives project IDs and paths from its project registry. Project updates require project trust; execution additionally requires a selected local project. Confirmed global updates may change provider-owned configuration, but providers must reject missing project context for project mutations. Hosted runtimes disable resource mutations. Treat caller-supplied paths and operation selectors as input to validate, never as authority to bypass these checks.

Keep reads side-effect free. Return `refreshAfterMs` for asynchronous progress, and return the completed page when the operation finishes. The renderer preserves edits during background polling and resets them after an explicit successful action. Providers own job lifecycle, validation, optimistic revisions and safe persistence; use a revision field to reject edits based on stale documents.

This protocol requires a matching local source build until released. Do not publish a plugin using it with a minimum host version that predates support.


### Workbench groups and entity status filters

Workbench view references accept an optional localized `group` (a string or `{ default, "zh-CN" }` object). The host resolves group copy and displays the ordered views in a grouped sidebar, with compact horizontal navigation on narrow screens. References still point to the original integration or navigation view; grouping adds no new execution capability.

Each active contributed workbench also gets its own entry in the host's main navigation, using its localized title and icon. The entry opens the workbench directly and stays available when switching between projects and other workbenches, including with the sidebar collapsed. Workbenches remain listed on the home page and in the workbench overview; their member views stay grouped inside the workbench.

Entity list and search blocks can declare `statusFilter: "active"` or `"all"`. Filtering applies to loaded results, can be combined with text search, and never changes remote data. Providers may return `statusLabel` and `statusCategory` alongside the native `status` code. Categories are `open`, `active`, `resolved`, `done`, `closed`, `cancelled`, and `unknown`. The active filter excludes the four terminal categories; missing or unknown categories remain visible. Always preserve the native code for transitions, and return the original `url` for source navigation.

### Work item identity and personal membership

Host Providers can add `sourceRef` to a work item without changing legacy entity fields. The reference contains `providerId`, `instanceId`, `accountId`, `containerId`, `kind`, and the native `itemId`. The runtime supplies `context.integrationId`; use it for `instanceId`, and use the registered provider ID for `providerId`. These two fields are validated at the adapter boundary. Identity strings are nonempty, bounded and free of control characters; they retain their original case and whitespace. Equal display IDs in different accounts, containers or entity kinds remain distinct.

Use `personalMembership: { accountId, relation: 'owned' | 'assigned' | 'unknown' }` for a source that can prove personal ownership or assignment. Its account must match the source reference and the page's authenticated `currentUser.id` before the host includes it in personal work. Do not invent assignees for personal tasks. Legacy providers retain exact assignee matching; missing identity never implies personal membership. Optional `dueDate: { dateTime, timeZone }` preserves provider-local time, while `updatedAt` and page `fetchedAt` are ISO instants with an offset.

`work-items.get`, `list`, `search`, and status-update results validate the added fields. `workItemActionInput()` from `craft-hub/work-items` prepares the native `itemId`, full reference and legacy metadata for an adapter call. Providers remain responsible for authenticated access, native status mapping and business filters.

### Pagination and reusable host views

List and search providers return an opaque `nextCursor` on each page and accept it in the next query. Preserve the selected account, project, query and declarative block input across pages. Optional `coverage: 'complete' | 'partial'` describes the selected query scope; cursor exhaustion alone does not prove that all remote work was queried. A page may be empty and still offer a next cursor. The host deduplicates complete source identities, replaces old pages when account identity changes, rejects repeated cursors, and shows retry and stale-result states.

A workbench may reference host-rendered views alongside integration and navigation views:

```json
{
  "views": [
    { "type": "host", "view": "work-items", "group": "Work items", "integrations": ["example-tasks"] },
    { "type": "host", "view": "projects", "group": "Development" }
  ]
}
```

Omit `integrations` to use all eligible installed sources, or pass an empty array to select none. The work-items view only discovers global, unconfirmed read actions; it does not grant a plugin additional access or run project commands. Host references accept no scripts or execution options. These new references require a matching source build until released; set the published plugin's minimum host version to a release that contains this contract.

The personal overview and host work-items view share their list and handoff components. A complete `sourceRef` enables a reviewed project link: an item override takes precedence over its typed container default, explicit `null` means no project, and clearing an override restores the default. A legacy item can still be handed off manually but cannot acquire a fabricated persistent identity.

Links are stored separately from portable configuration in `work-item-projects.json` in the OS data directory. The file is version 1 and contains source references and project IDs; current project availability and trust come from the host registry. Missing directories and unregistered projects remain visible as unavailable links. Reading, linking and clearing do not grant trust, execute commands or change remote tasks. A new installation starts with empty links; existing handoff drafts had no persisted associations to migrate. Invalid or unsupported state files are preserved and reported.

`GET /api/work-item-projects` returns a revisioned snapshot. `PATCH` accepts `{ revision, target: { type: 'item' | 'container', ref }, projectId }`; the container reference omits `itemId`. `DELETE` accepts `{ revision, target }`. Stale revisions return 409 and require a reviewed retry. Mutations require a same-origin JSON request and a local host. Cross-process writes use a SQLite transaction sidecar so process termination releases the lock; the association JSON itself is saved atomically. Do not include either machine-local file in shared settings or project metadata.

## Installing local host extensions

Use the ordinary Craft Hub application for both public and private plugins. Host extensions supply executable providers, while Marketplace plugins declare their views and actions. A separate branded distribution is optional; installing private capabilities does not require one.

The desktop Marketplace includes a **Host extensions** tab. Add the author's `distribution.json`, review its executable modules, and choose **Trust and add**. Restart once to apply the change. The ordinary Craft Hub application then loads the saved extension on every startup, including launches from Finder or the Dock. No launcher or environment variable is required. Application branding, update configuration and project trust are unchanged.

When linking or enabling a local Marketplace plugin with integration declarations, the desktop also looks for a containing `distribution.json` and offers the same installation flow. Discovery and review do not execute code. Browser clients cannot install executable host modules.

Registrations live in `host-extensions.json` inside the operating-system Craft Hub data directory. They snapshot the approved module paths; editing the original manifest cannot silently add modules. Keep the linked extension and its dependencies at a stable path. Add it again after moving it or changing its module list. Disable or remove an extension from the tab and restart to unload it. Removal preserves source files and Marketplace plugins; those plugins can report unavailable providers until the matching host extension is enabled again.

`craft-hub ui`, browser launches through `craft-hub app` (including desktop fallback), and `pnpm dev:web` restore the same approved extensions on startup. `--host-plugin` remains available for explicitly loading an additional trusted module for one `ui` session; it does not alter saved installations or register the same module twice. CLI help and standalone discovery commands do not import saved extensions. Embedding applications that supply their own runtime retain control of its providers.
