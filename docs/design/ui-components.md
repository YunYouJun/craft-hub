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
- `settings`: owns grouped sections, aligned setting rows, metadata, and status/action layout. SettingsDialog, AgentConnectionSettings, and CelebrationSettings compose the same interface.
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

Keyboard focus uses `:focus-visible` with a two-pixel `--focus-ring` and a two-pixel offset, shared by buttons, inputs, selects, checkboxes and switches. The offset separates the ring from both solid actions and surrounding surfaces without showing it for pointer interaction.

## Desktop presentation

The shared Vue UI uses [MacVue](https://macvue.dev/) as a visual reference for control proportions and states while retaining Reka UI and source-owned semantic CSS. No additional component package or utility-CSS engine is required. The browser and Electron use the same 32px normal control height, 28px compact button height, 8px control radius, 12px group radius and 14px dialog radius. Narrow and coarse-pointer surfaces retain the existing 44px control floor.

Neutral push buttons and selects have a fine edge and slight elevation; text fields have an inset edge. Segmented preference choices and tabs use a neutral recessed track and a raised selected segment. Immediate preferences keep native button and `aria-pressed` semantics; only actual tab panels use Reka Tabs. Sidebar selection retains its existing accent tint. Focus, disabled state and reduced-motion behavior remain shared across pages and portals.

Accent text and solid fills have separate tokens: use `--accent` for text and focus, and `--accent-fill` with `--on-accent` for primary controls and highlighted menu rows. This keeps dark-theme accent text bright without weakening white labels on filled controls. Shared menu geometry and elevation also cover portaled Select and DropdownMenu content. Native adapters keep supplying semantic system colors; window materials remain the host's responsibility.

Dark appearance is reviewed separately from light appearance, against [Apple's Dark Mode guidance](https://developer.apple.com/design/human-interface-guidelines/dark-mode) and actual AppKit controls. Use neutral window/content/group layers, filled secondary buttons, recessed editable fields, subtle separators and black shadows. Group outlines and row dividers have separate tokens, so reducing card framing does not erase the internal structure. The modal scrim stays neutral and leaves the parent view recognizable. CSS fallback values are Craft Hub choices; an offscreen control comparison does not establish parity with an active native window, desktop tinting or system accessibility preferences.

In the macOS material host, the titlebar reserves a sidebar control column using the same live activity-width token as the sidebar. The sidebar toggle follows the system window controls; history and page context start beyond the floating sidebar's edge. Following Apple's [sidebar show/hide guidance](https://developer.apple.com/design/human-interface-guidelines/sidebars), hiding the macOS sidebar removes the complete navigation panel and its material, including the project tree and resize handle on project pages. Content reclaims that space; the toolbar keeps a minimum window-control reserve, and reopening restores the saved project-tree width. Ordinary browsers retain their compact icon rail, and narrow layouts keep mobile navigation. Keep small toolbar symbols free of decorative details that become indistinct at their displayed size.

## Settings contract

`SettingsSection` groups related preferences with an accessible title and optional description, controls, and footer. `SettingsRow` aligns a label and optional description with a control slot; pass `controlId` for native label activation, and forward the slot's `descriptionId` to the control. `SettingsStatus` presents a status title, metadata, and actions without introducing another provider-specific card design. Use its live-region attributes only when a status needs an announcement.

These components use `styles/settings.css` and the `--settings-*` tokens in `styles/tokens.css`. Font, focus, button, switch, and form dimensions reuse the global semantic tokens. The setting window, grouped rows, divider, metadata, and responsive spacing have their own semantic aliases; callers should supply content and placement, not duplicate typography, borders, colors, or control geometry.

Settings use the existing sidebar/tab navigation, Input, Textarea, Switch, and Button modules. Keep selection scope checkboxes for multi-selection. The active pane appears in the title, the last pane is restored when reopening, and a changed explicit entry pane still takes precedence. Narrow windows use the existing horizontal tab presentation.

This is an Electron web settings interface adapted to macOS conventions. The grouping, alignment, and navigation follow the [Apple Settings](https://developer.apple.com/design/human-interface-guidelines/settings), [Boxes](https://developer.apple.com/design/human-interface-guidelines/boxes), and [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) guidance. Pixel dimensions are Craft Hub design choices; the components do not claim to be AppKit controls.
