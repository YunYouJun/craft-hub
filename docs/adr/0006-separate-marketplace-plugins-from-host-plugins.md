# Separate marketplace plugins from host plugins

Craft Hub treats Host Plugins and Marketplace Plugins as separate trust boundaries. Host Plugins are explicitly installed code dependencies that may execute inside a host, while Marketplace Plugins are declarative, immutable npm packages installed without lifecycle scripts or runtime imports; a versioned Plugin Catalog supplies their integrity, compatibility, permission disclosure, lifecycle status, and optional discovery metadata. Distributions may curate Managed Sources, but installing either kind of plugin never grants Project Trust.

Marketplace solution packs remain declarative: `requiresPlugins` resolves only packages listed by the same source, is copied into the Catalog for pre-install review, and is verified against every downloaded Manifest. This composes features without turning npm runtime dependencies or Host Plugin execution into an implicit install side effect.
