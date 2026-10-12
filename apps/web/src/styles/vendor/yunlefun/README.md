# YunLeFun Admin profile

`admin.css` is an unmodified copy from [YunLeFun/design](https://github.com/YunLeFun/design/blob/45ad5ba3788de14144a282d0aea0a975fb6c121c/packages/ui/styles/admin.css), pinned to commit `45ad5ba3788de14144a282d0aea0a975fb6c121c` (2026-10-04).

The published `@yunlefun/ui@0.0.6` package supplies the base CSS tokens but does not include the Admin export. Import the base package first, this profile second, and Craft Hub's semantic aliases last. Replace this copy with the package's CSS entry after the Admin profile is published and verified. Do not edit the upstream copy for Craft Hub overrides; keep those in `styles/tokens.css`.

The upstream MIT license is preserved in `public/licenses/yunlefun-design.txt`, which Vite copies into the browser distribution and desktop assets. Craft Hub uses Workspace / Admin density, system fonts, and its own Reka UI interactions. No upstream Vue runtime or remote web fonts are required.
