# Desktop bridge v1

状态：已定义；盘点日期：2026-10-22。类型声明在 `apps/web/src/env.d.ts` 的 `DesktopBridgeV1`，实现分别为 Electron preload 和 Swift `DesktopBridge.script`。本表记录当前可调用接口，后续迁移必须同步更新支持状态。

## 合同

- 正式实现暴露 `bridgeVersion: 1`、`hostKind` 和 `platform`。旧客户端仍通过可选方法探测工作；缺少方法表示该能力不可用，不能用成功返回的空函数占位。浏览器没有 `window.craftHubDesktop`，继续使用公共 API 和网页自身的导航、复制与输入流程。
- v1 保持现有平面方法名和参数，下面按职责分组。增添可选能力仍属 v1；变更已有参数、返回值或副作用需要新版本及兼容路径。元数据不是授权凭据。
- 操作返回 Promise；对话框取消返回 undefined；失败必须拒绝并给出可显示的错误。`on*` 返回释放函数，宿主替换或网页卸载时释放。`consume*` 只消费一次待处理入口。
- 项目和能力以 ID 指向运行时已知数据，涉及路径的接口由运行时核验范围。选择文件夹不授予信任；深链接、通知与系统快捷入口只导航或填充待确认内容。命令执行仍由运行时的显式信任、command/args、shell:false 和项目工作目录约束。
- Swift 的 WKScriptMessage 只接受工作台同源主框架；sidecar host 路由仅接受有效网页会话、同源 JSON 和自定义请求头。原生 bearer token 仅用于公共 `/api/`，不能调用这些 host 路由，也不进入网页。

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
| 项目与来源 | `openProjectDirectory` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openProjectInVSCode` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openProjectInEditor` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openIntegrationSource` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openProjectEvidenceInEditor` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openProjectGitRemote` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openCapabilitySourceInEditor` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openCapabilityWorkingDirectory` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| 项目与来源 | `openWorkspaceInEditor` | 是 | 缺 | 运行时校验；固定 OS opener | 项目/来源 ID 与路径校验 |
| Codex 适配 | `openProjectInCodex` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `openWorkspaceInCodex` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `startProjectInCodex` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `startWorkspaceInCodex` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `openCodexThread` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `focusCodexApplication` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `codexActivityStatus` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `installCodexActivityHooks` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `uninstallCodexActivityHooks` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| Codex 适配 | `onCodexActivityStatus` | 是 | 缺 | 共享 Codex 适配；OS 激活归宿主 | 信任/参数/订阅释放 |
| 终端与链接 | `listTerminalApplications` | 是 | 缺 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 终端与链接 | `openProjectInTerminal` | 是 | 缺 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 终端与链接 | `openDotfilesInTerminal` | 是 | 缺 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 终端与链接 | `openExternalUrl` | 是 | 是 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 终端与链接 | `openWorkbenchTool` | 是 | 是 | 运行时校验；固定 OS opener | shell:false/URL 与工具 ID 校验 |
| 设置与外观 | `openSettingsFile` | 是 | 缺 | 各宿主；设置来自运行时 | 设置同步/系统外观 |
| 设置与外观 | `setTheme` | 是 | 缺 | 各宿主；设置来自运行时 | 设置同步/系统外观 |
| 设置与外观 | `setLocale` | 是 | 缺 | 各宿主；设置来自运行时 | 设置同步/系统外观 |
| 更新 | `updateStatus` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 更新 | `setAutomaticUpdates` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 更新 | `checkForUpdates` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 更新 | `installUpdate` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 更新 | `onUpdateStatus` | 是 | 缺 | 各宿主更新适配 | 更新状态机/订阅释放 |
| 菜单与导航 | `consumeCelebration` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onCelebrationRequested` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onReplayOnboarding` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onOpenHelp` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onOpenSettings` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onMenuAction` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `consumeDesktopNavigation` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onDesktopNavigation` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `verifyProjectReference` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `consumeMarketplaceSourceImport` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 菜单与导航 | `onMarketplaceSourceImport` | 是 | 缺 | 各宿主入口；运行时验证引用 | 只导航/消费一次/取消订阅 |
| 个人云 | `cloudStatus` | 是 | 缺 | 共享云控制器与宿主安全存储 | 账户授权/密钥不进入网页 |
| 个人云 | `cloudConnect` | 是 | 缺 | 共享云控制器与宿主安全存储 | 账户授权/密钥不进入网页 |
| 个人云 | `cloudDisconnect` | 是 | 缺 | 共享云控制器与宿主安全存储 | 账户授权/密钥不进入网页 |
| 个人云 | `cloudSynchronize` | 是 | 缺 | 共享云控制器与宿主安全存储 | 账户授权/密钥不进入网页 |
<!-- bridge-inventory:end -->

## 验证与下一步

`apps/desktop/test/desktop-bridge-contract.test.ts` 在隔离环境加载两端实际注入的 JavaScript，检查版本、类型声明与清单覆盖、原生/sidecar 路由及拒绝传播。已有 `updater-preload.test.ts`、`window-appearance.test.ts`、`sidecar-host.test.ts` 和 `sidecar-native-api.test.ts` 分别覆盖更新、外观、同源边界与 token 权限；Swift 的面板测试覆盖原生入口。每个新增方法还需验证其实际 OS/运行时副作用，清单测试不能替代功能验收。

下一步先补齐日用的编辑器、终端、Codex、设置和外观接口，沿用 Electron 已有的运行时验证与 opener；安全存储、云和更新各自完成合同后再接入。原生公共 API 事件流与桥接事件分开管理：前者承载运行时数据变化，后者承载宿主菜单、窗口和更新状态。
