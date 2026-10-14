# Software catalogs

Workstation maintains `software.config.ts` as the single editable software list.
Craft Hub reads that TypeScript file directly from an online Git repository or a
local checkout. There is no export, build or JSON publishing step.

## Add a repository source

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
and its original location/commit. Browsing and restarting Craft Hub use saved
cache without automatically contacting repositories. Removing a source leaves
checkouts, favorites, plugins and the bundled catalog intact.

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
