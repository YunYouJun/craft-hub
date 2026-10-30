# Desktop bridge v1

状态：已定义；最近复核：2026-10-23。类型声明在 `apps/web/src/env.d.ts` 的 `DesktopBridgeV1`，实现分别为 Electron preload 和 Swift `DesktopBridge.script`。本表记录当前可调用接口，后续迁移必须同步更新支持状态。

## 合同

- 正式实现暴露 `bridgeVersion: 1`、`hostKind` 和 `platform`。旧客户端仍通过可选方法探测工作；缺少方法表示该能力不可用，不能用成功返回的空函数占位。浏览器没有 `window.craftHubDesktop`，继续使用公共 API 和网页自身的导航、复制与输入流程。
- v1 保持现有平面方法名和参数，下面按职责分组。增添可选能力仍属 v1；变更已有参数、返回值或副作用需要新版本及兼容路径。元数据不是授权凭据。
- 操作返回 Promise；对话框取消返回 undefined；失败必须拒绝并给出可显示的错误。`on*` 返回释放函数，宿主替换或网页卸载时释放。`consume*` 只消费一次待处理入口。
- 项目和能力以 ID 指向运行时已知数据，涉及路径的接口由运行时核验范围。选择文件夹不授予信任；深链接、通知与系统快捷入口只导航或填充待确认内容。命令执行仍由运行时的显式信任、command/args、shell:false 和项目工作目录约束。
- Swift 的 WKScriptMessage 只接受工作台同源主框架；sidecar host 路由仅接受有效网页会话、同源 JSON 和自定义请求头。原生 bearer token 用于公共及明确登记的原生 `/api/` 路由，不能调用网页 host 路由，也不进入网页。原生专属接口另见下文，不能用网页 cookie 调用。

## 能力清单

“是”表示桥接方法已暴露，不等同于跨宿主行为验收完成。原生宿主的命令面板、快速记录和设置菜单也有 `craftHubNative` 消息通道；该通道不把下表缺少的方法视为已实现。Electron 的复制使用网页 Clipboard API，原生的窗口材质由 SwiftUI 管理。

<!-- bridge-inventory:start -->
| 分组 | 成员 | Electron | macOS | 最终实现归属 | 验证重点 |
| --- | --- | --- | --- | --- | --- |
| 身份与版本 | `bridgeVersion` | 是 | 是 | 各宿主 | 版本/能力盘点 |
| 身份与版本 | `hostKind` | 是 | 是 | 各宿主 | 版本/能力盘点 |
| 身份与版本 | `platform` | 是 | 是 | 各宿主 | 版本/能力盘点 |
| 身份与版本 | `windowMaterial` | 是 | 缺 | 各宿主 | 版本/能力盘点 |
| 快速记录 | `consumeQuickCapture` | 是 | 缺 | 宿主面板 | 面板生命周期/快捷键 |
| 快速记录 | `quickCaptureStatus` | 是 | 缺 | 宿主面板 | 面板生命周期/快捷键 |
| 快速记录 | `onQuickCapture` | 是 | 缺 | 宿主面板 | 面板生命周期/快捷键 |
| 对话框与剪贴板 | `selectProjectDirectory` | 是 | 是 | 各宿主 OS 适配 | 取消选择/主框架校验 |
| 对话框与剪贴板 | `selectProjectDirectories` | 是 | 是 | 各宿主 OS 适配 | 取消选择/主框架校验 |
| 对话框与剪贴板 | `copyText` | 缺 | 是 | 各宿主 OS 适配 | 取消选择/主框架校验 |
| 宿主扩展 | `hostExtensions` | 是 | 是 | 共享宿主后端；重启归宿主 | 扩展白名单/空闲重启 |
| 宿主扩展 | `installHostExtension` | 是 | 缺 | 共享宿主后端；重启归宿主 | 扩展白名单/空闲重启 |
| 宿主扩展 | `configureLocalPluginHost` | 是 | 缺 | 共享宿主后端；重启归宿主 | 扩展白名单/空闲重启 |
| 宿主扩展 | `setHostExtensionEnabled` | 是 | 是 | 共享宿主后端；重启归宿主 | 扩展白名单/空闲重启 |
| 宿主扩展 | `removeHostExtension` | 是 | 缺 | 共享宿主后端；重启归宿主 | 扩展白名单/空闲重启 |
| 宿主扩展 | `restartForHostExtensions` | 是 | 是 | 共享宿主后端；重启归宿主 | 扩展白名单/空闲重启 |
| 项目与来源 | `openProjectDirectory` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openProjectInVSCode` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openProjectInEditor` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openIntegrationSource` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openProjectEvidenceInEditor` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openProjectGitRemote` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openCapabilitySourceInEditor` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openCapabilityWorkingDirectory` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openWorkspaceInEditor` | 是 | 是 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| Codex 适配 | `openProjectInCodex` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `openWorkspaceInCodex` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `startProjectInCodex` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `startWorkspaceInCodex` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `openCodexThread` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `focusCodexApplication` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `codexActivityStatus` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `installCodexActivityHooks` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `uninstallCodexActivityHooks` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `onCodexActivityStatus` | 是 | 是 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| 终端与链接 | `listTerminalApplications` | 是 | 是 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 终端与链接 | `openProjectInTerminal` | 是 | 是 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 终端与链接 | `openDotfilesInTerminal` | 是 | 是 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 终端与链接 | `openExternalUrl` | 是 | 是 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 终端与链接 | `openWorkbenchTool` | 是 | 是 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 设置与外观 | `openSettingsFile` | 是 | 是 | 各宿主；设置来自运行时 | 设置同步/系统外观 |
| 设置与外观 | `setTheme` | 是 | 是 | 各宿主；设置来自运行时 | 设置同步/系统外观 |
| 设置与外观 | `setLocale` | 是 | 是 | 各宿主；设置来自运行时 | 设置同步/系统外观 |
| 更新 | `updateStatus` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 更新 | `setAutomaticUpdates` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 更新 | `checkForUpdates` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 更新 | `installUpdate` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 更新 | `onUpdateStatus` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 菜单与导航 | `consumeCelebration` | 是 | 是 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onCelebrationRequested` | 是 | 是 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onReplayOnboarding` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onOpenHelp` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onOpenSettings` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onMenuAction` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `consumeDesktopNavigation` | 是 | 是 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onDesktopNavigation` | 是 | 是 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `verifyProjectReference` | 是 | 是 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `consumeMarketplaceSourceImport` | 是 | 是 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onMarketplaceSourceImport` | 是 | 是 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 个人云 | `cloudStatus` | 是 | 是 | 共享云控制器与宿主安全存储 | 仅返回状态，不含密钥或批准请求 |
| 个人云 | `cloudConnect` | 是 | 是 | 原生桥接与共享云控制器 | 由 macOS Keychain 保存设备身份 |
| 个人云 | `cloudDisconnect` | 是 | 是 | 原生桥接与共享云控制器 | 撤销设备并按身份比对清除密钥 |
| 个人云 | `cloudSynchronize` | 是 | 是 | 原生桥接与共享云控制器 | 命令批准仍限定在原生界面 |
<!-- bridge-inventory:end -->

## 验证与下一步

`apps/desktop/test/desktop-bridge-contract.test.ts` 在隔离环境加载两端实际注入的 JavaScript，检查版本、类型声明与清单覆盖、原生/sidecar 路由及拒绝传播。已有 `updater-preload.test.ts`、`window-appearance.test.ts`、`sidecar-host.test.ts` 和 `sidecar-native-api.test.ts` 分别覆盖更新、外观、同源边界与 token 权限；Swift 的面板测试覆盖原生入口。每个新增方法还需验证其实际 OS/运行时副作用，清单测试不能替代功能验收。

日用编辑器、终端、项目/工作区、Codex 交接和设置文件现在由两端共用 `project-launch.ts`；通过注册 ID 解析目标，证据与 package 路径进行 realpath 范围检查。`startProjectInCodex` 先验证再复制提示词并打开项目，用户仍需在 Codex 中提交；`startWorkspaceInCodex` 进入共享 AgentTaskManager 的信任检查，任务释放后才激活线程。macOS 系统 opener 等待退出结果，不能只凭子进程启动报告成功。主题与语言在原生主线程应用，并通过运行时设置快照和 SSE 同步；旧请求不能覆盖新的选择。宿主扩展、安全存储与云已接入各自原生合同；Sparkle 更新使用原生设置和菜单，上表 Electron 更新方法继续不暴露给网页。Codex 活动状态和订阅已连接同一共享 monitor；Hook 写入经独立 bearer 路由和原生系统审阅，只增删此资料的精确命令，其他宿主的 Hook 保留。原生公共 API 事件流与桥接事件分开管理：前者承载运行时数据变化，后者承载宿主入口事件。

2026-10-23 复核：[Keychain 身份存储与私有管道合同](native-secure-storage.md) 已接入 App/sidecar 生命周期、共享个人云控制器和原生请求审阅。上表四个个人云方法仅暴露账号状态与操作；密钥、回调采用和命令批准不暴露为网页桥接方法。真实包内 sidecar、临时 Keychain 和本地云替身的组合演练覆盖连接、签名同步、撤销和未信任请求拒绝；真实账号授权及签名身份迁移另行验收。

### Native candidate navigation

`craft-hub-native:` is registered only by native candidates. The sidecar resolves incoming navigation links through the shared `deep-links.ts` parser and the runtime project-reference matcher. The injected bridge keeps independent pending lanes and delivers callbacks once. Validated marketplace navigation opens the native plugin page; source-import links fill its source draft without fetching or registering a source. They are consumed by the native page and are not replayed to web listeners. Other navigation and celebration callbacks retain the web flow. Project selection, missing-project registration and ambiguous matches remain in the existing workbench flow. No link grants trust or runs a command. The navigation parser rejects credentials, ports, control characters, unrecognized parameters and executable actions. Personal-cloud callbacks take a separate native path into the shared cloud controller: scheme/host/path/parameters, the pending challenge and expiry are checked before one-use adoption; the web navigation listeners never receive the callback.


### Native management APIs

Codex activity reads and subscriptions use cookie-authenticated host routes. Its install/uninstall bridge methods enter the Swift system review flow; bearer-only `/api/native-host/codex-activity` accepts bounded, one-use review IDs and never accepts arbitrary commands or paths. The shared monitor recognizes exact profile commands, preserves other hosts' hooks and drains writes during shutdown. See [native Codex activity](native-codex-activity.md) for concurrent-host and legacy-host limits.

Native SwiftUI plugin and diagnostic pages use public runtime contracts, including versioned `/api/marketplace/overview` and `/api/diagnostics`. Version selection, local override precedence, dependency plans and install permissions remain runtime-owned. `POST /api/plugins/install` optionally accepts `reviewedPlan`; when supplied it must match the current resolved plan or the runtime returns 409 with `reviewRequired: true` before downloading. Existing clients remain compatible.

`GET /api/native-host/extensions` and its JSON `PUT { id, enabled }` are a narrow sidecar-only exception for bundled component management. They require the native bearer and exact loopback Host/Origin; the bootstrapped browser cookie is rejected. These two routes cannot register executable modules or bootstrap a browser session. Other `/__craft_hub_host/` actions retain their existing cookie/custom-header boundary.

The native Host Components page separately uses JSON POST routes under `/api/native-host/external-extensions/`: `preview { manifestPath }`, `install { reviewed }`, `cancel { id }`, `enable { expected, enabled }`, and `remove { expected }`. All require native bearer authorization; none are exposed as web bridge methods. Preview returns a bounded, five-minute, one-use review without importing code. Confirmation compares the complete review, re-reads the declaration and canonical entry paths, then atomically compares the previous registration before persisting. Bundled identifiers are reserved. Installation remembers trusted code locations (including later local edits), loads only on a subsequent restart, and grants no project trust. The bridge inventory above still marks missing web methods as absent; external registration is available directly in native UI.

Native software management uses the existing bearer-authenticated `/api/software/:source/{plan,install,runs}` and `/api/software-sources` contracts. Confirmation sends only the reviewed provider plan ID; source saves send only the immutable preview ID. Revision-bound refresh preferences/removal and installation uncertainty recovery match the web workflow. Logs are displayed as text. No new OS execution bridge is added. Native quit/restart also reads provider installation history and configuration source jobs; inability to read a manageable provider's history is not treated as idle.

Software snapshots include optional `favorites.version: 1`, the settings revision, saved tools and runtime-derived catalog matches. `POST /api/software-favorites` changes one favorite using the inspected revision: additions select catalog source/item IDs and language; removals select a saved tool ID. The runtime preserves project pins and task preferences, enforces the shared 100-tool schema and rejects stale revisions. Vue and native clients share metadata conversion and variant-aware matching from `craft-hub/personal-workbench`. Native uncertain writes require a compatible fresh snapshot; reads started before or during a write cannot replace its result.

`POST /api/native-host/open-workbench-tool` accepts exactly one saved `toolId` and requires the native bearer. The sidecar reads its current saved launcher and uses the same `openPersonalWorkbenchTool` implementation as Electron. Query parameters, client-provided URLs/launchers and browser cookies are rejected. Successful replies distinguish application launch from website fallback. This sidecar API adds no desktop bridge member; the existing web host route retains its own credential boundary.

Native environment profiles consume `/api/setup-profile` (`GET`, `inventory`, `save`, `import`, `review`) and read-only `/api/environment/setup`. Saves carry the reviewed draft revision and selected IDs. Imported JSON retains unknown fields for strict runtime rejection rather than silently dropping them in Swift. Prerequisite and profile review revisions must match. The client can display/copy guidance but has no execution endpoint for it. Native `/environment/setup` navigation opens this profile UI.

Configuration-source connection uses `/api/environment/sources` with provider ID, repository kind and credential-free HTTPS URL; the provider owns target paths and validation. Authentication carries the pending job ID and transient username/token only. Neither credentials nor raw transport errors are retained by the native model. Cancellation is unavailable during binding; uncertain writes require a fresh snapshot before another mutation. Connection preparation and reviewed configuration application remain separate operations; neither adds a desktop bridge member.

Native configuration review discovers global `configuration-manager` blocks and their declared action IDs from `/api/integrations`; project-only blocks retain the web workflow. The existing action endpoint returns `presentation.version: 1` and runtime-derived `writableItemIds`. Web and native ownership affordances share `craft-hub/configuration-management`; the provider still validates every write. Decisions carry the inspected item revision; applying/restoring sends only the reviewed plan ID. Git requests carry the reviewed repository revision and explicit paths/message. Hard provider/configuration invalidation discards pending approval; uncertain mutations require fresh history/status before another operation. Skills audit and diffs are plain read-only text. Operation support controls available actions; source/target edits and ownership claims use revision-bound `repositories-update` actions. Encrypted backup save/restore uses `backup-preview` followed by reviewed `apply`; reserved/external targets remain non-executable.

The configuration presentation also includes `backupSourceIds` derived by the same helper used by Vue. Native registry drafts retain the inspected revision across refreshes, and registry uncertainty requires a fresh compatible registry. Native launches forward only the dedicated `CRAFT_HUB_BACKUP_KEY_` environment namespace for backup credentials; the sidecar takes those values out of the general environment before creating providers and supplies them solely to configuration transports. Neither bridge methods nor JSON requests carry passphrases.

The native sidebar reads localized `/api/workbenches` declarations and lists enabled plugin workbenches in their runtime-defined order, with their declared titles and icons. Selecting an entry opens its composed panels in the embedded web workbench. Plugin, configuration and language changes refresh these entries; failed reads retain disabled entries with a retry action, and removing the selected entry returns to the native Workbenches page. Reading sidebar declarations does not create a web session or invoke integration providers. Standalone website panels remain available under Tools → Website Directory.

Native plugin workbenches discover resolved `/api/integrations` declarations. Unconfirmed connection/list/search/resource blocks use the existing global or project action endpoint with `?presentation=workbench-v1`. The optional versioned envelope supplies connection state, entity pages with shared source identity/unfinished-state/personal-membership flags, or resource pages with the same entity identities; other result shapes explicitly report `unsupported`. Calls without this query retain their existing response. Pagination preserves the search input, replaces duplicates by the shared identity, discards prior-account pages and stops repeated cursors with partial coverage. Cache/unknown coverage and failed refreshes remain visible; cached or stale configuration rows cannot be changed.

Native resource navigation binds every invocation to the declared `resources.read` operation/effect and leaves `confirmed` false. Each accepted page retains its own input and project ID; refresh, back and resource-home navigation do not borrow another page's scope. Failed reads retain the previous page as stale, while account changes clear resource content, location/history and pending replies. Documents and comparisons render as literal selectable text; copying or exporting requires an explicit user action and export uses a system save panel. Forms, project suggestions and agent prompts are descriptive only, with an explicit full-workbench entry point retaining the resource scope. Native resources currently use manual refresh and do not transfer their nested resource location into the web fallback.

Configuration-list toggles freeze entity revision, scope, requested value and action ID in a native confirmation sheet. Requests also supply `reviewedAction: { operation, effect }`; the runtime rejects changed operation/effect declarations before invoking a provider. Existing confirmation and project trust checks still run. Runtime replacement, context changes and invalidation discard old approvals and read responses. Uncertain configuration writes require a compatible fresh read; the UI never repeats a write automatically.

Native connection management reads the declared `connection.status` action and submits `connection.update` only after reviewing a frozen form and project scope. Workbench-v1 connection responses include a `reviewRevision` derived from public account identity, permissions, pending authorization and form definitions; password defaults are omitted. Native submissions pass it as `reviewedConnection`. The runtime re-reads status, checks the revision and offered method/fields, then applies its existing confirmation rules before invoking the update adapter. The optional review contract does not change legacy action responses or authorize an action by itself.

Connection credentials stay in ephemeral native form/request state. Cancellation, invalidation and submission clear password fields; provider errors from credential-bearing writes are replaced with a generic status message. Device-code and OAuth flows open only a credential-free HTTPS link after the explicit submitted action. Restored/status reads never open a browser. Native polling checks status every two seconds, with the provider expiry capped at 15 minutes for device codes and 10 minutes for OAuth; completion, close, replacement, hard metadata invalidation and explicit pause stop polling. Unknown results never retry automatically; they require a fresh status read or an explicit acknowledgement after the user checks the provider. Acknowledgement leaves the form stale and requires reload before another submission.

The native Workbenches destination and command-palette integration links share this renderer. Unsupported blocks or connection declarations, task-detail/status/handoff flows and composed workbenches retain explicit full-page entry points; global configuration-manager blocks link to the existing native configuration UI. Full-page links carry `scope=global` or an explicit `project` ID. An explicit project missing from the registry blocks that page instead of borrowing the web client's selected project or silently reading global data. Integration web routes remain under the Workbenches destination so the toolbar can return to native content.
