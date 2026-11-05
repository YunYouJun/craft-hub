# macOS 薄原生宿主与共享 Vue 收敛清单

2026-11-04 后续决定：[ADR 0014](../adr/0014-keep-electron-and-use-an-optional-resident-companion.md) 保持 Electron 主界面，原生常驻入口优先复用 Augma。下列 S1–S6 队列停止作为执行计划，保留为历史盘点；已完成的共享 Vue 改动继续使用，现有原生候选和资料保持完整。当前实施与验收见[常驻伴随应用指南](../guide/resident-companion.md)。

日期：2026-11-04。状态：方向已确认，剩余分组待实施。依据 [ADR 0013](../adr/0013-share-business-pages-across-desktop-hosts.md)，以当前工作区源码盘点；已有未提交的环境/配置收敛改动属于基线。本清单规定后续范围与顺序，不表示下列页面已经迁移或通过新一轮 Release 验收。

## 最终分工

- `apps/web` 是浏览器、Electron 和 macOS 的业务页面唯一实现，拥有表单、列表、筛选、业务导航、审阅呈现及操作反馈。
- `packages/craft-hub` 与两端共享的 TypeScript 宿主后端继续拥有发现、信任、执行、持久化、来源适配和业务规则。迁移渲染器不把这些行为放进 Swift 或 Vue。
- `apps/macos` 保留窗口和系统入口、运行时启动/恢复、系统权限与凭据存储，以及现有安全合同要求的本机批准界面。其 Adapter 通过现有公共 Interface 连接共享模块。
- Electron 继续承担跨平台宿主及 macOS 备用。此次不迁移用户资料、不变更公开链接归属，也不进行正式默认宿主切换。

原生新增业务页面停止扩展。后续原生交互例外须给出操作系统能力需求或同口径的实测收益，并单独记录决定。原生浮窗可以保留，其内部业务表单仍可复用 Vue。

## 当前入口盘点

盘点入口是 `apps/macos/Sources/CraftHubMac/Destination.swift`、`ContentView.swift`、`WorkbenchModel.swift`、`NativePanels.swift` 和 `Views/NativeSettingsView.swift`；Vue 对照入口是 `apps/web/src/router.ts`、`App.vue` 和各业务组件。当前 `Destination.isNative` 仍包含六个主内容组。

| 当前区域 | 当前原生实现 / 入口 | 最终归属与共享实现 | 批次 |
| --- | --- | --- | --- |
| 本机检测、环境方案、配置源连接、配置审阅 | 环境入口已转 Web，重复 Swift 页面已在当前工作区移除 | 继续使用 `EnvironmentWorkbench.vue`、`SetupProfileWorkbench.vue`、`EnvironmentSourcesWorkbench.vue`、`ConfigurationManager.vue` | S0：已有验收记录 |
| 插件工作台、集成连接、资源与通用动作表单 | 主内容已使用 Web，原生侧仍有目录和系统登录/导入入口 | `WorkbenchesOverview.vue`、`PluginWorkbench.vue`、`IntegrationWorkbench.vue`、`IntegrationConnectionSetup.vue`、`IntegrationResourceBrowser.vue`；目录和系统适配保留 | 已共享；保留回归 |
| 工具收藏及编辑 | `ToolsView`、`SoftwareFavoritesView`、`ToolEditorView` | 迁入 `ToolsWorkbench.vue`、`PersonalTools.vue` | S1 |
| 网站导航 | `WebsiteNavigationView`、`WebsiteNavigationGroup` | 迁入 `NavigationWorkbench.vue`；保持 `/navigation` 和 `/tools` 各自的位置与恢复 | S1 |
| 完整设置中的通用业务 | `NativeSettingsView` 的外观/语言、`CodexActivitySettings`、`NativeCloudSettings` 的连接/同步管理 | 使用 `SettingsDialog.vue`、`AppearanceDialog.vue`；原生只应用外观、语言和系统操作结果 | S1；最终整理 S6 |
| 诊断列表、筛选、详情、处理跳转 | `DiagnosticsView`、`DiagnosticDetailView` | 迁入 `DiagnosticsWorkbench.vue`，沿用共享诊断结果与目标解析 | S2a |
| 插件发现、安装、详情、来源、宿主组件与扩展管理 | `PluginsView`、`PluginDetailView`、`PluginSourcesView`、`PluginHostsView` | 迁入 `MarketplaceDialog.vue`、`PluginDetail.vue`、`HostExtensionsPanel.vue`；系统选目录和宿主代码信任确认保留适配 | S2b |
| 软件目录、安装审阅、进度、日志、来源、卸载指引 | `SoftwareView`、`SoftwareCatalogView`、`SoftwareInstallationsView`、`SoftwareSourcesView`、`ApplicationUninstallGuidanceView` 等 | 迁入 `SoftwareCenter.vue`、`SoftwareSources.vue`、`SoftwareInstallStatus.vue`、`ApplicationUninstallGuidance.vue` | S3 |
| 首页、今日重点、来源浏览、工作项详情/状态/完成/交接 | `TodayFocusView`、`WorkItems*`、`WorkSource*`、`WorkItem*` | 迁入 `PersonalWorkbench.vue`、`TodayFocus.vue`、`WorkItemsOverview.vue`、`WorkCollectionBrowser.vue`、`IntegrationWorkItemDetail.vue`、`IntegrationStatusTransitionControl.vue`、`WorkHandoffDialog.vue` | S4a |
| 快速记录的解析、列表选择、日期、授权、AI 和提交表单 | `QuickCaptureView`、`QuickCaptureModel` | 共享 `QuickCaptureDialog.vue` 的业务内容；原生保留全局唤起、浮窗、焦点和本机草稿适配 | S4b |
| 项目目录、详情、能力、信任审阅、命令参数和运行历史 | `ProjectsView`、`ProjectDetailsView`、`ProjectCommandView` | 迁入 `WorkbenchProjectCatalog.vue`、`ProjectOverviewPanel.vue`、`CapabilityList.vue`、`DetailPanel.vue`、`TrustRunDialog.vue` 等；保留现有 `projectId` / `capabilityId` 选择合同 | S5a |
| 内嵌终端及终端选择表单 | `NativeTerminalView`（SwiftTerm）、`ProjectTerminalControl` | 目标统一到 `AsyncTerminalOutput.vue` / `TerminalOutput.vue`（xterm）及共享终端偏好；外部终端启动继续由宿主 Adapter 完成 | S5b |
| 命令面板的搜索、分类、排序和业务选择 | `CommandPaletteView`、`CommandPaletteModel` | 使用 `CommandPalette.vue` 的共享内容；原生保留快捷键、浮窗和系统激活 | S6 |

设置通过现有命令入口打开，不假设存在 `/settings` 路由。项目通过现有选择合同进入 `/`，不另造项目详情路由。表中已有 Vue 组件表示可复用的实现入口，不能据此推定其与原生能力完全对齐。

## 长期保留的原生范围

| 保留项 | 当前主要位置 | 限制 |
| --- | --- | --- |
| 主窗口、原生侧栏/工具栏、窗口位置、全屏、主题与系统颜色适配 | `ContentView`、`MainWindowSizing`、`NativeWebAppearance`、`WindowGeometry` | 侧栏只呈现导航，不加载第二套业务详情；主题/语言写入共享设置 |
| 系统菜单、Dock、菜单栏、快捷键、App Intents、深链接和单实例 | `CraftHubApp`、`WorkbenchMenu`、`NativeShortcuts`、`WorkbenchIntents`、`SystemIntentRouter`、实例与链接模块 | 只激活、导航和展示简要快照；不得由链接直接信任项目或执行命令 |
| 命令面板与快速记录的窗口容器 | `NativePanels`、`PaletteSearchField` 的必要系统适配 | 业务内容按 S4/S6 共享；不把当前完整 Swift 表单视为永久保留项 |
| 无 Node 引导、下载、选择、回退，sidecar 启停与恢复 | `RuntimeSidecar`、`PrivateNodeControls`、`PrivateNodeModel`、`NodeLocator` 等 | 后端尚未启动时也必须能打开恢复界面；普通诊断详情仍由 Vue 呈现 |
| 系统通知、通知授权、默认链接设置、Sparkle 更新 | 通知模块、`DefaultLinkSettings`、`NativeUpdater`、`NativeUpdateSettings` | 系统偏好留在精简宿主设置；更新和退出仍检查未完成操作 |
| Keychain、身份转移、签名验证、资料租约与互斥 | `KeychainDeviceVault`、`ResourceCredentialVault`、`Identity*`、`ProfileLease` 等 | 私钥、身份认证及迁移授权不因页面迁移扩大到通用网页桥接 |
| 隔离账号登录及受限浏览器导入 | `ConnectionBrowserSignInView`、`ConnectionBrowserBridge`、`ResourceBrowserImportView`、`ResourceDesktopBridge` | 第三方页面无桌面桥接；保留来源/账号隔离及受限提取；资源列表/导入后的业务处理继续共享 |
| 本机可信批准及系统确认 | `NativeCloudReviewView`、宿主扩展/Hook 的现有系统审阅 | 个人云远程命令最终批准按现有安全合同留在原生；不向网页新增通用 `approve` 权限 |
| 文件/目录选择、保存、外部应用打开、凭据和草稿持久化适配 | `DesktopBridge` 及对应宿主模块 | 使用已校验的 ID/限定输入；浏览器提供能力降级；不暴露任意 shell、文件写入或凭据读取 |

菜单栏可以保留最近项目、少量今日重点与快速记录入口。它读取共享运行时的简要快照，不再依赖完整首页的来源筛选、分页和工作项写入模型。`TodayFocusModel`、`ProjectsModel` 中仍被菜单栏、通知或系统入口使用的读取能力，须先缩减为必要的宿主快照再清理。

## 实施顺序与分组验收

### S0：固化已有共享入口和迁移约束

环境、配置及插件工作台的已有验收记录继续有效，其范围见[候选清单](../guide/native-candidate-acceptance.md)。后续每组迁移沿用以下做法，不先创建新的通用渲染框架：

1. 原生导航完整传递路径、查询、项目/账号范围、选中资源和恢复位置。清理对应的原生拦截分支，避免 Vue 页面或内部链接又被切回旧原生页。
2. 保留当前运行时会话内的 `WorkbenchWebSession`，主窗口关闭/重开不重建业务页面。运行时更换后旧响应和审阅失效；跨 App 重启的草稿恢复单独验收。
3. 写入复用现有审阅、revision、确认和信任合同。`withIntegrationMutation` 的 pending 上报只覆盖在途请求；`finally` 清零不能证明未知回执、安装任务或命令已经结束。移除原生模型前，必须用共享状态继续保护导航、退出、更新和重启。
4. 每组按“补齐 Vue 能力 → 隔离候选切换 → 真实验收 → 清理重复 Swift 实现 → 最终产物复验”推进。验收前保留原生回退；验收后不长期维护两套完整实现，也不留下默认隐藏的双业务渲染器。

### S1：工具、网站导航与通用设置

先用低风险流程验证主内容切换：收藏添加/编辑/移除、网站分组、搜索、打开工具/链接、主题与语言、完整设置入口。`/tools` 与 `/navigation` 都直接进入共享页面。

个人云连接/同步状态和活动 Hook 管理已有 Vue 入口，复用现有宿主方法。连接管理与远程运行批准分开；Keychain、回调验证、Hook 写入确认继续由原生/共享后端承担。宿主设置保留 Node、通知、默认链接和更新，增加进入共享设置的入口。

验收包括设置 revision 冲突、窗口重开、跨重启恢复、外部打开失败、浏览器无宿主能力的降级。只在无引用后删除 `SoftwareFavoritesModel`、`WebsiteNavigationModel` 及其视图；`MachineModel` 还承载软件中心，不能整组提前删除。

### S2：诊断与插件管理

先 S2a 将诊断列表、详情和处理目标转 Vue，随后 S2b 闭合插件详情、来源管理及宿主扩展流程。两步属于同一导航组，分别验收；诊断步骤不依赖插件安装迁移完成。

保留 `/diagnostics`、`/marketplace`、`/marketplace/plugins/:sourceId/:packageName` 及现有来源导入合同。来源链接只填草稿；目录预览、添加、安装和信任仍需明确操作。修正 `PluginRoute`、`openNativePlugin`、`openPluginManagement`、诊断目标和菜单中的原生强制跳转。

验收包括长/中文 README、图片和文档链接、权限/依赖展示、计划变化后重新审阅、启停/回滚/保留数据移除、扩展信任与重启、诊断未知/过期状态、Escape 与焦点恢复。完成后删除 `PluginsModel`、`DiagnosticsModel` 的业务实现及对应视图；`PluginNavigationModel` 继续为原生侧栏提供声明式目录。

### S3：软件中心与环境流程闭环

软件目录、安装记录、来源和卸载指引整体迁移。共享 `/software` 页面承接环境方案进入、安装进度返回和卸载入口，保留 `tab=uninstall` 等既有参数及待检查应用身份。

重点补齐批量选择、安装计划/前提审阅、取消、进度/日志、来源 revision 冲突、结果未知后的恢复。安装在后端继续执行，导航不隐式重发或取消；退出/更新必须仍能发现活动安装。原生只保留固定软件 ID 的打开、系统面板、系统安装器及凭据适配，不把卸载指引扩展为未经审阅的删除能力。

验收后清理 `MachineModel` 中的软件展示状态、`SoftwareInstallationModel`、`SoftwareSourcesModel`、`SoftwareManagementPresentation` 和 `ApplicationMaintenanceModel` 的业务部分及软件页面族。若发现仍需供宿主使用的读取/系统操作，保留小型 Adapter。不得删除运行时安装、来源校验及未完成任务检查。

### S4：首页、工作项与快速记录

S4a 将 `/overview`、来源浏览、工作项详情、状态流转、完成/撤销和交接作为一个业务组迁移。保留账号切换隔离、搜索/筛选、分页范围、缓存/过期提示及写入后的刷新。菜单栏收缩到共享摘要；AI 继续只在明确点击后执行。

S4b 保留原生全局快捷键及快速记录浮窗，提取 `QuickCaptureDialog.vue` 的可复用业务内容。当前 Swift 的 `CaptureDraftStore` 与 Vue 的 localStorage 是不同草稿来源；先做版本化、可恢复的草稿适配，核对文本、解析字段、账号/列表、日期/时区、提交身份及未知结果，再替换表单。保留旧草稿文件和恢复入口，不静默以空白覆盖。主窗口和浮窗不能同时成为同一草稿的写入者。

无运行时/离线时至少能保留本机文本并明确说明状态；提交需要后端就绪。验收全局唤起、首次可输入、中文组合输入、Escape、关窗/重开、App 重启、提交成功/失败/未知回执及防重复。不能只用 Vue 组件测试替代浮窗和草稿恢复。

完成后清理 `TodayFocusModel` 的页面状态、`WorkItemQuickActionsModel`、`WorkItemCompletionModel`、`WorkItemsBrowserSelection`、`QuickCaptureModel` 的重复业务实现及对应视图族。共享运行时的今日重点、状态流转和交接合同继续保留。

### S5：项目、命令及终端

S5a 统一项目列表、详情、能力选择、参数、信任/执行审阅和运行历史。项目注册/拖放和外部编辑器打开保留宿主 Adapter；深链接、菜单栏、通知和面板选择均进入共享选择合同，不自动执行。工作区、技能和 README 等已用 Vue 的流程保持连通。

S5b 目标统一 xterm 渲染。SwiftTerm 保留到真实终端验收通过，作为该组迁移期间的回退；当前没有同口径证据支持长期维护第二套终端。若发现可复现且无法由共享终端解决的系统交互差距，单独记录原生终端例外，不默认扩大为原生项目/命令页面。

终端验收覆盖中文输入、粘贴/控制键、全屏程序、尺寸变化、滚动/复制、历史回放、停止及断连恢复。页面切换、关窗/重开不能隐式创建第二个 PTY 或终止后端进程；过期审阅必须拒绝，未知命令结果和输入送达不确定不能自动重试。保留 `shell: false`、项目工作目录和显式信任。

完成后清理 `ProjectDetailsModel`、`ProjectCommandModel`、`ProjectTerminalModel` 的重复页面实现及视图；最近项目、通知和目录注册所需的小型宿主读取适配继续保留。SwiftTerm 包依赖和许可仅在原生终端删除且无其他引用后移除。

### S6：命令面板与宿主收尾

在项目和业务目标均已共享后，统一命令面板的搜索、分类、排序、置顶和选择，原生 `NSPanel` 只保留系统激活、显示/隐藏及焦点管理。共享面板内容要区分“请求宿主打开浮窗”和“已在浮窗内呈现”，避免 `requestNativePanel` 循环打开；需要独立 WebView 时也复用内容与状态合同，不复制整套主窗口状态。

复验菜单栏、Dock、App Intents、快捷键、默认链接、主窗口历史和 settings 分流。精简 `WorkbenchModel`：移除六组原生业务分派、重复页面加载/刷新与重新拦截路由的逻辑。按引用清理 Swift 业务 wire models、图标缓存、`WorkSourceBrowserHost`、`SourceTabStrip` 等仅服务旧页面的实现及测试；系统入口和生命周期的测试保留。

## 每组完成条件

- 功能对照以完整流程为单位，列出 Vue 已有、需要补齐和宿主保留项；确认没有静默丢失原生能力。
- 浏览器、Electron 与 macOS 共用业务实现；宿主功能按可用能力显示，浏览器有明确降级。
- 检查深链接/内部链接、选中项目/账号、前进/后退、主窗口关闭/重开、草稿和未完成操作恢复；状态切换不得采用旧账号的迟到响应。
- 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、`pnpm build`；原生实现变更另跑 `pnpm lint:macos`、`swift test --package-path apps/macos`。最终候选运行 `pnpm build:macos`、独立签名校验和对应 Release 流程实测。
- 先在隔离资料中验收并记录产物身份、实际交互与失败项，再清理旧实现并复验最终包。日用安装单独通过既有安装器处理，不以候选构建代替日用更新。
- 关闭本组临时宿主、sidecar 和运行器，按 PID、可执行文件及启动时间核实退出；保留候选、夹具、资料、草稿和证据，日用原生实例保持运行。

迁移完成的判断是每组只保留一套业务实现，原生宿主仍能在运行时未就绪时启动/恢复，系统与安全能力没有回退。重新测量同功能、同数据、同就绪终点的启动、主窗口/浮窗交互与完整进程内存；不能把“未创建 WebView 的纯原生首页”历史数据沿用到新的共享 Vue 首页。

最低系统、真实 Intel、长期日用、正式签名/公证/更新链及从备份恢复到空环境，继续按[独立验收清单](../guide/native-candidate-acceptance.md)保留，不能通过渲染器切换自动记为完成。

## 当前执行队列

| 批次 | 状态 | 执行前必须保留的条件 |
| --- | --- | --- |
| S0：环境/配置及已有共享入口 | 已有验收记录；后续持续回归 | 本文未重新执行该批次 UI 验收 |
| S1：工具/导航、通用设置 | 下一组，待实施 | 先核对现有 Vue 能力、收藏编辑及设置/安全操作分流 |
| S2a → S2b：诊断 → 插件管理 | 待实施 | 先闭合诊断跳转，再切换安装及扩展管理 |
| S3：软件中心 | 待实施 | 活动安装/未知结果仍能保护退出与更新 |
| S4a → S4b：首页/工作项 → 快速记录表单 | 待实施 | 菜单栏摘要独立，旧草稿可恢复且只有一个写入者 |
| S5a → S5b：项目/命令 → 终端 | 待实施 | 审阅/执行合同不变，终端真实交互验收通过后再移除 SwiftTerm |
| S6：命令面板与宿主收尾 | 待实施 | 保留系统入口，最终清理重复业务状态并重新测量 |
