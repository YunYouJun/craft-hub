# Workspace source markets

## Outcome

Users browse independent workspace source catalogs, preview repository configuration, and subscribe without sharing device paths or execution trust. Personal and team authors use the same format. Downstream distributions supply their own catalogs and authentication.

## Delivery plan

1. Implement versioned catalog validation, multiple distribution-provisioned catalogs, a read-only runtime route, and source selection in the existing subscription page. Add runtime, desktop manifest, and UI tests.
2. Implement community repository readers and durable subscriptions: stable source identity, selected workspace ids, revision checks, isolated source namespaces, local project bindings, update conflicts, offline snapshots, unsubscribe and explicit copy. Preserve existing workspaces when migrating. Move the existing downstream subscription contract behind a common host interface; the current subscription page requires a downstream backend.
3. Integrate downstream private markets. Resolve identity and repository permissions before returning private entries. Add remote catalog refresh, persisted last-valid snapshots, publication validation and index submission. Keep domain names, organizational identifiers and credentials in the downstream repository.

## First delivery: distribution-provisioned catalogs

`DistributionConfig.workspaceMarkets` and desktop `distribution.workspaceMarkets` accept an array of `{ enabled, catalog }`. A catalog has `schemaVersion: 1`, `id`, `name`, and `entries`. Each entry contains `id`, `name`, `publisher`, `configurationUrl`, and optional `description`. Configuration URLs use HTTPS without embedded credentials. The URL identifies the directory accepted by the host subscription reader; it is not automatically fetched by catalog discovery.

```json
{
  "workspaceMarkets": [{
    "enabled": true,
    "catalog": {
      "schemaVersion": 1,
      "id": "example-market",
      "name": "Example workspaces",
      "entries": [{
        "id": "developer-environment",
        "name": "Developer environment",
        "publisher": "Example maintainer",
        "configurationUrl": "https://git.example.com/example/profile/tree/main/craft-hub"
      }]
    }
  }]
}
```

The first delivery publishes entries by editing this index and shipping the distribution. It does not provide an online publication service. Index content is separate from repository configuration. Browse with `GET /api/workspace-catalogs`; select an entry to preview through the existing `/api/config-subscriptions/preview` flow, then confirm import. If the host has no subscription backend, browsing remains available and import is disabled. No community sources are advertised until real repositories publish compatible configuration.

Catalog ids must be unique; source ids must be unique within a catalog. Identical source ids across catalogs remain distinct. Disabled catalogs are omitted. Unknown executable or credential fields are rejected. Discovery is read-only and must not register projects, grant trust, install dependencies or run commands.

Static distribution indexes are visible to all users of that installation. They must contain only entries suitable for that audience. They are not an access-control mechanism. Private per-user catalogs require the authenticated downstream endpoint in step 3; repository read permission must still be checked by the subscription backend. Repository permissions, not catalog listings or owner labels, authorize access.

## Subscription decisions for step 2

Keep ownership independent from repository location. A team may have several sources. Namespace imported workspace identities by stable source id; never merge by display name. Resolve shared repository references to local projects without transferring machine paths, credentials or trust. Local display preferences stay separate from source content. Pin each applied revision; validate the entire update before replacing the active snapshot. Preserve conflicting local edits and the last good snapshot. Removing a subscription never deletes a local checkout. Copying a workspace explicitly ends source tracking for that copy.

The existing one-time workspace import remains supported. Continuous subscription is a separate mode and will require a follow-up ownership ADR before changing imported-workspace behavior.

## Implementation status

Step 1 is implemented: schema and runtime catalog reader, HTTP discovery, desktop distribution parsing, catalog cards, selection into the existing preview flow, and an explicit unavailable-backend state. Runtime tests cover read-only discovery and unchanged project trust; UI tests cover source selection, retry, isolation, and missing subscription support.

Browser QA used bundled Playwright (Browser plugin not available), an isolated runtime with real catalog discovery, and a mocked downstream subscription endpoint. Selecting a source displayed the expected workspace preview without applying it; no page runtime errors were observed. Desktop layout was inspected. The existing global `body` minimum width of 900px causes horizontal overflow at a 390px viewport; global mobile layout is outside this delivery.

Steps 2 and 3 now have implementations: public Git configuration reading, durable named sources, selected-workspace subscriptions, atomic applied snapshots, offline export/copy, and authenticated host repository/catalog adapters. Private-market integration belongs in the downstream distribution and is validated independently. Existing personal configuration and legacy imports are not automatically migrated. See [Workspace sources](../guide/workspace-sources.md) for the shipped format and operations.

The first private-market delivery uses a distribution-maintained index and current per-user repository permission checks. Remote index refresh, an online submission/review workflow, and source-location migration remain separate future enhancements; this delivery does not deploy services or push published source repositories.
