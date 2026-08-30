---
title: Marketplace
description: Discover how Craft Hub marketplace sources and declarative plugins work.
---

# Marketplace

Craft Hub's interactive Marketplace lives in the desktop app and local web workbench. It combines the catalogs from sources configured on your machine, shows each plugin's permissions and compatibility, and keeps installation behind an explicit confirmation.

## Public catalog

::: info Early alpha
Craft Hub does not ship a central public Plugin Catalog yet, so there are no official entries to list on this site. This page is the stable public Marketplace URL; future official catalog entries can be published here without changing that route.
:::

Third-party distributions can provide built-in or managed sources. You can also preview and add an HTTPS catalog from the Marketplace's **Sources** tab. Craft Hub validates the complete catalog before saving it.

## Open the interactive Marketplace

Run Craft Hub, then choose **Marketplace** in the activity rail. Browser-only contributors can start the local workbench with:

```bash
pnpm dev:web
```

The workbench route is `/marketplace`. Its contents come from the local runtime API, so the public documentation site intentionally does not mirror a user's installed plugins or private sources.

For the package format, source validation, lifecycle states, and installation safety boundary, read the [Plugin Marketplace guide](/guide/plugin-marketplace).

::: warning Extension models are separate
Craft Hub Marketplace Plugins are declarative packages. Host Plugins and Codex plugins use different trust and manifest models and are not listed here.
:::
