# Web UI modules

Craft Hub builds its product UI from a small set of source-owned modules on top of Reka UI. The organization borrows shadcn-vue's semantic variants and copy-owned implementation model without making Tailwind CSS part of the runtime contract.

## Module seam

Reusable UI modules live under `apps/web/src/components/ui`. A module belongs there only when it hides repeated behavior or design rules behind a smaller interface. Do not wrap every Reka primitive by default.

Product workflows remain outside this directory. They compose UI modules and own domain language, data loading, and actions.

```text
src/
├── components/ui/     reusable interaction and visual contracts
├── features/          product workflows when a flat file becomes hard to navigate
├── styles/tokens.css  global semantic theme interface
└── styles.css         legacy and application layout styles during migration
```

## Initial modules

- `button`: owns variants, sizes, focus, disabled state, icon sizing, and foreground/background pairing.
- `select`: owns the styled Reka Select composition already used by command inputs.
- `dialog`: owns portal, overlay, accessible title and description, optional structured headers, and content attribute forwarding.
- Badge, field, and tooltip modules should be added when a second real caller demonstrates a reusable contract.

## Button contract

Button variants express intent: `primary`, `secondary`, `warning`, `danger`, and `ghost`. Sizes express layout: `default`, `compact`, and `icon`.

Callers must not override button colors or reconstruct a variant with local classes. Layout classes may be supplied by a caller when placement is specific to the product workflow. Icons and pending labels are composed explicitly; the button does not own application loading state.

## Migration rules

1. New product UI uses an existing UI module when its interface fits.
2. Existing markup migrates when a feature is already being changed; there is no repository-wide flag day.
3. Remove legacy global selectors only after their final caller has moved.
4. Keep Reka UI behind reusable modules where doing so removes repeated accessibility or overlay setup.
5. Inspect and adapt registry source before copying it. Registry code is a reference, not an automatic dependency update.

The initial migration covers every generic primary, secondary, warning, and destructive action plus every Reka dialog scaffold. Specialized controls—toolbar buttons, palette results, theme choices, and icon swatches—keep purpose-specific markup rather than pretending to be generic buttons.

Keyboard focus uses `:focus-visible` with a one-pixel surface isolation layer and a two-pixel `--focus-ring`. This keeps the ring legible against both solid actions and surrounding surfaces without showing it for pointer interaction.
