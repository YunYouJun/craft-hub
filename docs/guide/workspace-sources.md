# Shared workspace sources

A repository can publish portable workspaces for other users to subscribe to. Source discovery and updates do not clone working projects, install dependencies, execute commands or transfer execution trust.

## Publish configuration

Create `craft-hub/source.jsonc` (or `.craft-hub/source.jsonc`) in the source repository:

```jsonc
{
  "schemaVersion": 1,
  "id": "developer-environment",
  "name": "Developer environment",
  "workspaces": [
    {
      "schemaVersion": 1,
      "id": "daily-development",
      "name": "Daily development",
      "primaryProject": "https://github.com/example/profile",
      "members": [
        { "project": "https://github.com/example/profile", "label": "Profile" },
        { "project": "https://github.com/example/utilities", "label": "Utilities" }
      ]
    }
  ]
}
```

Members use credential-free HTTPS repository identities, not aliases or absolute machine paths. Optional workspace fields are `icon`, `color`, and `primaryProject`; optional member fields are `label` and `pinned`. The strict source schema rejects command, owner, credential, and machine-state fields. Alternatively publish individual workspace `.json` or `.jsonc` files in the selected directory or its `workspaces/` child. The source bundle is authoritative when present. A host reader can convert other source formats into this portable format.

Commit the configuration and publish the desired branch using your repository's normal review process. Share a directory URL such as `https://github.com/example/profile/tree/main/craft-hub`. Branch names containing slashes are supported; `craft-hub` or `.craft-hub` marks the beginning of the configuration directory. The community transport reads public HTTPS repositories in an isolated bare Git repository without checking out or executing their contents. Redirects, Git credential helpers and system/global Git configuration are disabled. Each read pins one commit, accepts regular configuration blobs, and enforces file count and size limits.

## Save, subscribe and update

Open **Workspace sources → Add source**, enter a name and configuration directory URL, and save the source. **My sources** lists subscriptions; **Discover sources** searches catalogs with a market filter. Each source has a URL-addressable detail page with **Workspaces** and **Subscription settings** views. Breadcrumbs return to the parent list; search and market filters live in the URL. The home workspace creation dialog also links to discovery. Saving a source does not add its workspaces. Choose **View and import**, select the workspaces, and confirm the preview. Market cards enter the same preview flow directly.

Applied workspaces appear under Personal with read-only source metadata. Repository identities resolve to existing registered local projects when there is exactly one match; ambiguous or missing projects remain unresolved. Explicitly locating a project verifies its repository identity before registration. A newly registered project remains untrusted.

Updates compare the displayed preview against a fresh remote read and the current local subscription version. A stale preview, identity change, invalid document, transport failure, or local file collision leaves the previous applied snapshot untouched. Updates replace one source's selected snapshot atomically. New upstream workspaces are not selected automatically on an existing subscription; removed workspaces are listed in the preview and leave the view only after confirmation. A source may explicitly publish an empty workspace list to remove all of its views.

**View applied snapshot** and **Export** work offline on a local installation. Copy a workspace from the applied snapshot to create an editable Personal workspace. Copies and registered projects survive deleting a source. One-time imported workspaces retain their existing independent behavior. Personal/team Git snapshot export excludes subscribed views to avoid turning subscriptions into editable duplicates; subscription exports contain portable source data without local bindings or credentials.

Source names can be edited with a revision check. Changing repository locations requires adding a new source so existing applied state is not silently reassigned. Subscription writes are serialized and protected by a file lock; an update racing with another runtime returns a retryable conflict.

## Maintain a source market

A market is an index, separate from the source configuration. Provision `distribution.workspaceMarkets` as described in [the implementation plan](../plans/workspace-source-market.md). Update the index and rebuild the distribution to publish or remove entries. This release does not create an online publication/review service or automatically push repositories.

Trusted host plugins can provide `workspaceCatalogProviders` and `workspaceRepositoryProviders`. Catalog providers return only entries the current user may discover. Repository readers must check current access before every read and return `{ repository, branch, directory, revision, files }`. They can use the supplied `context.readGit(target, authorizationHeader)` transport; the authentication header is passed only to Git's environment for the fixed HTTPS origin, never process arguments, repository URLs or persisted snapshots. Reader errors must not include credentials. Private readers take precedence over public Git and errors never fall back to an anonymous read.

Hosted deployments can set `publicWorkspaceRepositories: false`, use one runtime/state directory per verified account, and recheck permissions before exposing private applied snapshots. Private catalogs are not shared in a cross-account cache. Local installations deliberately retain their applied source snapshots for offline use.

The common HTTP routes are `/api/workspace-catalogs` and `/api/config-subscriptions`, with per-source `preview`, `apply`, `export`, and `copy` actions. Cross-origin requests, non-JSON mutations, oversized mutation bodies, and unknown source ids are rejected. Git authentication stays in trusted host code; listing a source does not grant repository access.


## User state and optional Git synchronization

The source repository owns shared workspace definitions. A catalog owns published source references. Neither owns an individual user's subscriptions.

The current local runtime persists subscriptions in `workspace-subscriptions.json` inside its operating-system data directory. The file records repository location, selected workspace IDs, applied revision, and the validated snapshot. Atomic replacement and file locking protect updates. Browser storage is not the authority. Hosted installations currently use an isolated persistent directory per verified account; this is file-backed persistence, not a database implementation.

For a future multi-instance hosted deployment, a transactional database should own the same per-user subscription records and applied versions. Authorization still runs at access time; a subscription is not a repository permission grant. Persistent volumes are required while using the current file-backed service.

A personal dotfiles repository can optionally synchronize a portable subscription manifest: repository URL, branch, configuration directory, display name, and selected workspace IDs. This is a future explicit export/import feature, not automatic synchronization of the runtime state file. Device-specific paths, trust decisions, credentials, account identifiers, private cached contents, and transient preview tokens must stay out of the portable manifest. Import should preview changes and recheck access before applying. The existing per-source export is a snapshot export, not an all-sources synchronization manifest.

Shared source repositories remain independent. Users can subscribe to several repositories without requiring a single aggregate Git repository or Git write access for ordinary subscription changes.
