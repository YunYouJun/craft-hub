# Workbench page layout

Primary views use `WorkbenchViewFrame` and `WorkbenchViewHeader`. Navigation, workspace sources, marketplace, composed plugin workbenches, and diagnostics share this frame. A view supplies its title, description, icon, actions, and body; it does not define its own page padding or heading sizes.

| Token | Desktop value | Purpose |
| --- | --- | --- |
| `--page-title-size` | 18px | Page h1 |
| `--page-title-weight` | 600 | Page title weight |
| `--page-title-line-height` | 24px | Consistent title baseline |
| `--page-description-size` | 12px | Supporting description |
| `--page-padding-inline` | 20px | Page horizontal inset |
| `--page-padding-block` | 20px | Header top inset |
| `--page-content-max-width` | 1180px | Shared content width |
| `--page-section-gap` | 20px | Space between sections |
| `--workbench-activity-width` | 44px | Global activity rail, separate from the primary sidebar |
| `--workbench-sidebar-width` | 236px | Default primary navigation width; home and composed workbenches share this preference |
| `--workbench-sidebar-min-width` / `--workbench-sidebar-max-width` | 208px / 346px | Shared sidebar resize limits, excluding the activity rail |
| `--workbench-sidebar-header-height` | 40px | Compact sidebar heading and toolbar |
| `--workbench-sidebar-row-height` | 30px | Compact navigation rows |
| `--workbench-sidebar-padding-inline` | 12px | Header and control inset |
| `--workbench-sidebar-item-inset` / `--workbench-sidebar-item-padding` | 4px / 8px | Navigation row gutter and inner padding |
| `--workbench-sidebar-font-size` / `--workbench-sidebar-heading-size` | 13px / 12px | Navigation labels and group headings |
| `--workbench-sidebar-color` | `--text` | Theme-aware primary text for navigation and headings; secondary text is reserved for counts and metadata |
| `--workbench-sidebar-icon-size` | 16px | Navigation icon size |
| `--workbench-sidebar-item-radius` / `--workbench-sidebar-selection-width` | 3px / 2px | Row corners and active marker |

Home and composed workbenches use `WorkbenchSplitter` for primary navigation and `WorkbenchResizeHandle` for the same draggable, keyboard-accessible divider. Sizes come from these CSS tokens: the home panel includes the 44px activity rail, giving a default of 280px. Resizing from either page saves the same local width preference. That preference takes precedence over the sidebar size in an older home layout, while home content panels retain their saved layout. Only user resizing changes the preference; mounting, loading content, and switching to compact navigation do not overwrite it. Sidebar backgrounds, text weights (400 normal, 500 selected, 600 heading), icons, hover states, focus rings, and accent markers use the same tokens; project-specific accent colors may override the active color. Tree indentation belongs to the project hierarchy and does not change the panel width.

These widths describe primary navigation. Configuration inventories, plugin metadata, settings dialogs, and other content-local lists keep widths appropriate to their content; they must not be treated as a second primary sidebar. Their navigation text and selection styling can reuse the same tokens.

The header stays outside the content scroll area. Composed plugin workbenches put their primary navigation in the `WorkbenchPageShell` sidebar slot, alongside the entire main column. This sidebar extends from the global title bar to the status bar; breadcrumbs and the current view header occupy only the main column. The compact sidebar header owns the workbench identity and plugin management action, while its grouped navigation scrolls independently. Long workbench descriptions are available on the sidebar title without reserving a separate introduction row. Plugin branding remains a contribution supplied by the plugin.

Below 900px the composed workbench sidebar becomes horizontal navigation and removes its resize handle. Home switches to its compact layout below 760px. The saved desktop width is restored when returning to a wider viewport. Below 760px the horizontal inset is 12px, header top inset is 16px, and controls use larger touch targets. Titles and descriptions can wrap; actions wrap as a group beneath the title instead of clipping.

Define values in `apps/web/src/styles/tokens.css`; use frame geometry from `styles/workbench-view.css`. Standalone integration pages use the same heading tokens. Embedded views contribute only their body, avoiding a second outer page gutter. Views that restore scroll position use the frame's `getScrollTop()` and `scrollTo(top)` methods.

## Entity filters and status badges

Read-only entity list/search blocks may declare `statusFilter: active | all` and `assigneeFilter: current-user | all`. Providers supply `assignees: [{ id, label? }]` on each entity and an optional `currentUser: { id, label? }` on the page. Account IDs must use the same namespace; the UI matches them exactly, supports multiple assignees, and combines account, status, and text filters over loaded items. If identity is unavailable, the UI falls back to all assignees with a visible hint. An account change resets the assignee selection to the block default.

`status` stays the native write value. `statusLabel` supplies copy; `statusCategory` selects semantic icons and theme-aware colors. Planning, active development, testing, review, and release are unfinished phases; resolved, done, closed, and cancelled are excluded by the unfinished filter. Independently, `archived: true` excludes an entity regardless of its workflow state. Archived items remain available through all statuses or the archived option, which is present only when loaded archived items exist; their badge uses the archive icon without changing the native status. Unknown states remain visible. Badge colors use the shared accent/warning/success tokens and `--status-planning`, `--status-review`, `--status-releasing`, and `--status-resolved`; geometry uses `--status-badge-radius`.
