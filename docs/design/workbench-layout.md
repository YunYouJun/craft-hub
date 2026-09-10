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
| `--workbench-sidebar-width` | 196px | Docked workbench navigation |
| `--workbench-sidebar-row-height` | 30px | Compact navigation rows |

The header stays outside the content scroll area. Optional sidebar content occupies a flat panel with a subtle background, one divider, and its own scroll area. Use the sidebar slot to group existing destinations rather than adding duplicate primary navigation entries. Plugin branding remains a contribution supplied by the plugin.

Below 900px the sidebar becomes horizontal navigation. Below 760px the horizontal inset is 12px, header top inset is 16px, and controls use larger touch targets. Titles and descriptions can wrap; actions wrap as a group beneath the title instead of clipping.

Define values in `apps/web/src/styles/tokens.css`; use frame geometry from `styles/workbench-view.css`. Standalone integration pages use the same heading tokens. Embedded views contribute only their body, avoiding a second outer page gutter. Views that restore scroll position use the frame's `getScrollTop()` and `scrollTo(top)` methods.

## Entity filters and status badges

Read-only entity list/search blocks may declare `statusFilter: active | all` and `assigneeFilter: current-user | all`. Providers supply `assignees: [{ id, label? }]` on each entity and an optional `currentUser: { id, label? }` on the page. Account IDs must use the same namespace; the UI matches them exactly, supports multiple assignees, and combines account, status, and text filters over loaded items. If identity is unavailable, the UI falls back to all assignees with a visible hint. An account change resets the assignee selection to the block default.

`status` stays the native write value. `statusLabel` supplies copy; `statusCategory` selects semantic icons and theme-aware colors. Planning, active development, testing, review, and release are unfinished phases; resolved, done, closed, and cancelled are excluded by the unfinished filter. Independently, `archived: true` excludes an entity regardless of its workflow state. Archived items remain available through all statuses or the archived option, which is present only when loaded archived items exist; their badge uses the archive icon without changing the native status. Unknown states remain visible. Badge colors use the shared accent/warning/success tokens and `--status-planning`, `--status-review`, `--status-releasing`, and `--status-resolved`; geometry uses `--status-badge-radius`.
