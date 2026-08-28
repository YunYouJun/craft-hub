# Color system

Craft Hub uses semantic CSS tokens as the stable interface between product UI and theme values. Components depend on roles such as `accent` and `warning`, never on palette positions or raw color values.

## Layers

1. Primitive colors describe color scales. They are implementation details and may later come from Radix Colors.
2. Semantic tokens describe product roles and live in `apps/web/src/styles/tokens.css`.
3. Component styles consume semantic tokens and keep interaction-specific decisions local.

Do not introduce a second public token vocabulary merely to match a component registry. If a tool requires shadcn-compatible names, map them at the integration seam rather than exposing both names to product code.

## Global token panel

| Role | Background or base | Foreground or paired value | Supporting values |
| --- | --- | --- | --- |
| Page and panels | `--surface` | `--text` | `--surface-subtle`, `--surface-muted`, `--surface-hover` |
| Secondary content | — | `--text-secondary`, `--muted` | — |
| Borders and focus | `--border`, `--border-strong` | — | `--focus-ring` |
| Primary action | `--accent` | `--on-accent` | `--accent-hover`, `--accent-soft` |
| Authorization and warning | `--warning` | `--on-warning` | `--warning-hover`, `--warning-soft` |
| Destructive action | `--danger` | `--on-danger` | `--danger-hover`, `--danger-soft` |
| Success | `--success` | `--on-success` | `--success-soft` when needed |
| Terminal | `--terminal-bg` | `--terminal-fg` | ANSI colors remain a terminal-specific concern |

Solid action colors and their `on-*` foreground are one contract. A component must not combine `warning` with `on-accent`, even when the combination happens to pass in one theme.

## Theme and accessibility rules

- Light and dark themes remap roles; they do not mechanically invert colors.
- Normal text must meet WCAG 2.2 contrast of at least 4.5:1. Large text and meaningful non-text UI require at least 3:1.
- Focus indicators use `--focus-ring` and remain distinct from adjacent surfaces.
- Status is always reinforced by text, icon, or shape. Color is supplementary.
- Hover, active, selected, disabled, and focus states are reviewed in both themes.
- Project accent colors identify projects only. They do not replace trust, warning, success, or failure colors.

## Change process

Add a semantic token only when at least one product role cannot be expressed by the current interface. Add a component token only when a reusable UI module has a stable need that should not spread to its callers. Validate rendered combinations before changing token values.

Community options and adoption tradeoffs are recorded in [Color tokens and dark theme research](../research/color-tokens-and-dark-theme.md).
