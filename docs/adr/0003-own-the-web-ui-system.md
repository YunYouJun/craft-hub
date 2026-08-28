# ADR 0003: Own the web UI system on Reka UI

## Status

Accepted

## Context

The web app already uses Vue, Reka UI, UnoCSS for icons, and product-specific semantic CSS tokens. shadcn-vue also uses Reka UI, but its official component implementations and CLI expect Tailwind CSS. Community UnoCSS compatibility presets can translate many utilities, but add another compatibility surface and do not remove the need to review copied component source.

Craft Hub needs a compact desktop workbench rather than a general-purpose visual preset. A wholesale shadcn-vue migration would duplicate primitives, tokens, icons, and styling infrastructure before it removed existing code.

## Decision

Craft Hub will own a small UI module layer under `apps/web/src/components/ui`, built on Reka UI and semantic CSS tokens. It will adopt useful shadcn-vue conventions—source ownership, composition, semantic variants, and accessible primitives—without adopting Tailwind CSS or a shadcn compatibility preset at this stage.

UnoCSS remains limited to the existing icon pipeline. Product styling uses semantic tokens and module-local CSS. Migration is incremental and follows product changes.

The first completed modules are Button, DialogShell, and Select. Button owns semantic variants and focus treatment; DialogShell is the only application module that imports the Reka dialog scaffold directly.

## Consequences

- The app avoids a second utility-CSS engine and a community compatibility dependency.
- The UI remains visually specific to Craft Hub.
- Registry components cannot be copied blindly; their Tailwind styles must be adapted or their Reka primitive used directly.
- Craft Hub owns maintenance and testing of its UI modules.
- A future Tailwind or shadcn-vue adoption requires a new decision backed by a representative migration proving lower total maintenance cost.
