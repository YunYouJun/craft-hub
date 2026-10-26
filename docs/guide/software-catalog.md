# Software catalogs

Workstation maintains `software.config.ts` as the single editable software list.
Craft Hub reads that TypeScript file directly from an online Git repository or a
local checkout. There is no export, build or JSON publishing step.

## Add a repository source

Open **Software center → Repository sources → Load Workstation catalog** to load
the public Workstation catalog and save its repository association in one click.
This reads the default branch's `software.config.ts` and caches metadata without
installing software or importing machine configuration. If already linked, the
button refreshes the saved source using its existing branch and reading mode,
including a linked local checkout. Hosted workbenches cannot refresh local sources.

Open **Software center → Repository sources → Add source**. Use the Workstation
preset, enter an HTTPS repository URL, choose a registered local project, or enter
a local Git root. The default catalog path is `software.config.ts`.

A source can hold both an online URL and a local checkout. The local `origin` must
match the online repository; importing the same repository again updates its
binding rather than duplicating its catalog. Choose where to read:

- **Online repository** reads the TS file at one fixed commit on the selected
  branch (`HEAD` means the remote default). Authentication and repository scripts
  are not invoked. The current implementation supports public HTTPS repositories.
- **Local working tree** reads current TS content, including uncommitted edits.
  It does not pull, switch branches, change files or grant project execution trust.
  A local repository without an origin also works as a local-only source.

Preview the parsed application list, then save that exact preview. Editing a
field invalidates the preview. Existing sources can change their reading mode,
branch or catalog path through the same preview flow. When changing a previous
JSON-based source, set its path to `software.config.ts` and preview again.

Refresh reads only the selected location. Failures retain the last valid cache
and its original location/commit. Each saved **Online repository** source has
**Refresh settings** in the local client:

- **Manual only** reads the source only when you choose **Refresh now**.
- **At an interval** accepts 15–10080 whole minutes (up to seven days). The
  default is 1440 minutes, or 24 hours, including sources saved before refresh
  settings were available.
- **At a daily time** uses an `HH:mm` time and a saved IANA time zone. It defaults
  to your device's time zone, shown in the form. Changing the device's time zone
  later does not change the saved schedule.

Saving a policy only updates its schedule; it does not read the remote catalog.
**Refresh now** remains available with every policy. The running local client
checks schedules every minute and contacts a repository only when it is due.
Startup also checks for missed refreshes while the client was closed. Successful
refreshes update the open software center; failures retain the last valid catalog.
**Local working tree** sources still refresh manually and never pull Git changes.
Hosted workbenches can browse cached metadata and manually refresh online sources;
automatic refresh and its settings require the local client.
Removing a source leaves checkouts, favorites, plugins and the bundled catalog
intact.

## Supported TypeScript

Declare an exported constant named `softwareGroups` containing literal data:

```ts
export const softwareGroups = [
  {
    id: 'development',
    label: { en: 'Development', zh: '开发工具' },
    items: [
      {
        id: 'example-editor',
        name: { en: 'Example Editor' },
        url: 'https://example.com/editor',
        downloadUrl: 'https://example.com/editor/download',
        iconUrl: 'https://example.com/editor/icon.png',
        cask: 'example-editor',
        platforms: ['macos', 'windows', 'linux'],
      },
    ],
  },
] as const
```

The AST reader supports string, number, boolean and null literals, objects,
arrays, comments, parentheses, type annotations, `as const` and `satisfies`.
Identifiers, imports, function calls, spreads, getters, computed properties and
interpolated templates cannot supply catalog values. Other module statements
(such as Workstation's derived `softwareItems`) are ignored, never executed.
The parser reads the initializer, not the result of subsequent mutations.

Groups require `id`, localized `label`, and `items`. Items require `id`, localized
`name`, and an HTTPS `url`; optional `downloadUrl`, `repositoryUrl`, `iconUrl`, `note`,
`cask` and `formula` supply portable metadata. Other literal fields are ignored.
Application paths and `installCommand` never enter the browser catalog. IDs must
be unique. Files are bounded to 2 MiB and catalogs to 1,000 applications.

## Uninstall guidance

Open **Software center → Uninstall guidance** to inspect applications under
`/Applications` and `~/Applications` on the local Mac. This works without an
installation plugin. Scans have bounded nesting and item counts; unreadable
locations are reported, and user data and other disks are not scanned.

Applications with the same bundle ID remain separate entries with their actual
paths. Selecting an application searches its package and, for applications inside
a vendor folder, that enclosing folder for uninstall-related filenames. These
are **unverified candidates**, with their location shown as evidence. **Show in
Finder** reveals the current file; the workbench never executes a candidate or
deletes anything. A missing candidate does not prove there is no uninstall menu
inside the application.

Catalog authors can add optional literal metadata to the original source:

```ts
export const uninstallMetadata = {
  macosBundleId: 'com.example.editor',
  uninstallUrl: 'https://example.com/support/uninstall',
}
```

Check the vendor's documentation before publishing the URL. The bundle ID must
match the installed application; names are not used to guess identity. The UI
attributes documentation to its catalog source. When no documentation is
configured, it offers the general operating-system guide and an explicitly
unverified web search. This does not claim to discover every official uninstaller.

Desktop Links `craft-hub://software?v=1&bundleId=com.example.editor` and
`craft-hub-native://software?v=1&bundleId=com.example.editor` navigate to the same
guidance, filtered by bundle ID. Omit `bundleId` to browse all applications. Links
cannot contain file paths, commands or uninstall instructions. Augma uses this
navigation contract; an Agent connection is not required.

Local HTTP routes `/api/application-maintenance`,
`/api/application-maintenance/:id` and the JSON POST
`/api/application-maintenance/:id/reveal` use freshly discovered, server-owned
identifiers. Hosted workbenches cannot inspect local applications or reveal files.

## Supported platforms

Set optional `platforms` to a nonempty, unique array of `macos`, `windows`
and/or `linux`, based on verified product support. Software cards display each
declared platform as a labeled icon. Omit the field when support is unknown;
Homebrew recipes, application artwork and the host OS do not establish the
product's full platform support. These labels describe the product, not whether
the connected local adapter can install it. Existing catalogs without this field
remain valid.

## Application artwork

Prefer complete official macOS application artwork in `macosIconUrl`. This is a
ready-to-display PNG, WebP or SVG export, including its original transparent
margins, rounded silhouette and shadows, rather than an individual Icon Composer
layer. It takes precedence over `iconUrl` on both software and favorite cards.

Use `iconUrl` for official website artwork when a native icon is unavailable.
The older `favicon` field is accepted; `iconUrl` takes precedence. Set
`iconStyle: 'rounded'` only for full-bleed square website images. Transparent logos
and images with an existing silhouette default to `original`. Native artwork is
always shown without an additional mask. Keep these choices in the source config;
the browser does not infer shapes from filenames or modify remote image pixels.

Both surfaces use a 40px frame with a 32px artwork area. Optional `iconScale`
(0.5–1.5, default 1) compensates for transparent margins in the preferred image
(`macosIconUrl` when present, otherwise `iconUrl`). For example, artwork whose
visible silhouette fills 80% of its canvas uses `iconScale: 1.25`. Keep the full
original image centered and scale it proportionally; do not crop its shape or
shadow. Store reviewed optical adjustments in the source catalog, not a second
UI-specific list. Favorites inherit them only for the same image URL; changing
a custom icon URL resets its old scale.

All image URLs must use HTTPS without embedded credentials. Images retain their
original colors and proportions in both themes. Unavailable images fall back to
a bundled brand or generic symbol (a failed native icon never restores an older
website image with unwanted borders). Images load lazily without a referrer and
use the browser HTTP cache; uncached images fall back when offline.

Favorites retain artwork metadata when added. Existing favorites look up newer
native artwork and shape hints from builtin or saved repository metadata when the
website and original icon URL still match. This never runs plugins or refreshes
repositories. Editing a favorite's icon URL overrides catalog artwork and clears
its old native selection; its shape can be selected in Customize tools.

## Builtin fallback and management

Craft Hub ships a reviewed copy of the upstream TS file at
`packages/craft-hub/catalogs/workstation.config.ts`, reads it as text, and uses the
same static parser. It works without Workstation, an adjacent checkout or network
access. Only edit the original Workstation file. Maintainers can refresh the
fallback copy with:

```sh
pnpm software-catalog:sync /path/to/workstation/software.config.ts
pnpm software-catalog:check
pnpm build
```

This copies validated source verbatim; it does not import the file or produce a
catalog JSON artifact. Normal builds validate the pinned copy offline.

The canonical Workstation repository's `software.config.ts` replaces the builtin
view while subscribed. Other repositories remain separate sources and cannot
claim plugin authority. Installation status is unknown until a trusted local
plugin detects it. Plugin observations only overlay matching application URLs
and package references; cached repository metadata does not authorize execution.
Installation and configuration management remain plugin operations.

Ghostty is listed under **Terminal and editor**. On macOS, a connected Workstation
plugin detects `Ghostty.app` and enables **Open** when it is installed. Adding
Ghostty to favorites also saves its native launch preset, so clicking its card
opens the application in the desktop workbench. In **Favorite tools → Customize
tools**, select **Ghostty** for a previously saved website shortcut, or select
**Website** to keep using its official site. Browser mode and unavailable native
applications use the HTTPS website fallback.

Parsed metadata and its content revision are saved as private JSON state in the
host's Craft Hub data directory. This is a cache, not another catalog to maintain
or publish. Local paths are not exposed by a hosted workbench. Hosted instances
can browse builtin and remote cached metadata but cannot read local checkouts or
manage local software.
