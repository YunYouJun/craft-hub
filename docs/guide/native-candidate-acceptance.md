# 原生候选版独立验收

本清单对应 [macOS 原生化 Goal 的 A–F 阶段](../plans/macos-native-client.md)。候选版已具备工程实现和本地自动化验证，但尚未完成全部真实界面、最低系统及分发验收。正式默认宿主仍是 Electron。历史批次、失败修复与测试计数保留在原生化计划；此页只描述当前复验入口和仍需补齐的证据。

## 候选产物与隔离启动

最新工程候选为 `apps/macos/build/closeout-20261024-candidate/native/Craft Hub Prototype.app`；本轮完整检查、七项包内验证、复验 ZIP、已通过的 XCTest 及分列待办见 [工程收尾记录](native-engineering-closeout.md)。本轮达到 A–F 工程交付完成标准；完整系统验收、正式发布和默认宿主切换仍按各自证据验收。以下保留前一通知修订及成对性能产物的来源，不能把其历史 UI/性能证据自动记到新包。

前一原生通知修订位于 `apps/macos/build/notification-errors-20261023-candidate/native/Craft Hub Prototype.app`。此修订增加通知授权失败的中英文恢复说明、等待系统授权时的进度提示和隔离授权状态测试；未改变共享运行时。主程序 SHA-256 为 `725484dbb57af82a489050b5850e1ebf70bee7b098f3b936facf0f1e3e4bf71c`，9 个 Mach-O 组件均含 arm64。下文“通知授权与错误恢复”记录此产物的检查及实机边界；此前成对性能数据仍绑定旧包。

最近一次成对交付目录为 `apps/macos/build/handoff-20261023-candidate/`：`native/Craft Hub Prototype.app` 是置顶候选的逐文件相同副本，`electron/Craft Hub-darwin-arm64/Craft Hub.app` 从同一份产品源码重新打包。两端均为 ad hoc 签名；原生 9 个和 Electron 18 个 Mach-O 组件均含 arm64，签名完整校验通过。`artifacts.json`、包内验证日志和 `performance/report.json` 记录这对具体产物，211 个网页文件逐一匹配。原生与 Electron 的运行时打包布局不同，以源码清单和包内行为验证对应关系。

上述成对目录中的原生产品代码与 `palette-pins-20261023-candidate/native/Craft Hub Prototype.app` 相同，包含系统快捷指令冷启动修复、自定义快捷键同步及置顶排序/通知；该候选的 UI 证据及 `node-bootstrap-ui-20261023/` 引导证据仍适用。App Intents 的系统调用证据绑定此前 `app-intents-20261023-candidate/final/` 的 Apple Development 签名副本，未记作本轮重新验收。旧的 `interaction-trace-20261023-final/` 原生/Electron 包和 `interaction-samples-20261023/` 交互采样继续保留为历史记录。

当前对照包的六次交替启动及完整内存采样见[性能记录](../research/native-macos-performance.md)。更早的 Node 22/26、x64/Rosetta 和 App Intents 系统验证仍属于各自注明的产物，没有因重新打包而自动升级为本轮验收。

重新执行默认构建命令会生成 `apps/macos/build/Craft Hub Prototype.app`，bundle ID 是 `dev.craft-hub.macos-prototype`。默认资料目录是 `~/Library/Application Support/Craft Hub Prototype`，与 Electron 分离。普通本地包使用 ad hoc 签名，更新、认证身份迁移和公开链接接管的发布能力保持关闭。

需要 Xcode 26 或更新版本及 pnpm 依赖。Node 支持 22（至少 22.18）、24（至少 24.11）和 26，实际进程架构必须与 App 相符。macOS 最低目标为 15；当前本地实测系统为 macOS 26.6.2 arm64，并已在该系统上构建、通过 Rosetta 运行 x64 App。macOS 15、真实 Intel 硬件和 x64 全量 Swift 测试仍未通过验收。

从仓库根目录构建；该命令不替换已安装 App：

```sh
pnpm install --frozen-lockfile
pnpm build:macos
codesign --verify --deep --strict 'apps/macos/build/Craft Hub Prototype.app'
```

第一次独立验收使用空资料目录，避免把两个宿主指向同一份数据：

```sh
review_root="$(mktemp -d /tmp/craft-hub-review.XXXXXX)"
printf '保留此路径用于复验：%s\n' "$review_root"
open -n "$PWD/apps/macos/build/Craft Hub Prototype.app" \
  --env "CRAFT_HUB_NATIVE_DATA_DIR=$review_root/profile" \
  --env "CODEX_HOME=$review_root/codex" \
  --env CRAFT_HUB_CLOUD_ENDPOINT= \
  --env CRAFT_HUB_CLOUD_ORIGIN=
```

每轮验收结束、失败、取消或等待用户操作时，退出本轮临时宿主并确认其 sidecar 已停止；脚本通过 `finally` 和信号处理自动清理，手工 UI 走查在交接前完成相同清理。只处理按 PID、可执行文件路径和启动时间确认属于本轮的进程，保留 App、资料、草稿和证据用于复验。日常只运行已安装的原生版，Electron 退出留作备用。

保留上述目录可验证草稿、设置及插件状态的恢复；下一次传入同一路径。`CRAFT_HUB_NATIVE_DATA_DIR` 同时隔离资料和原生偏好，不导入正式项目。不要把日用源目录作为这个覆盖值。当前开发用 `script/build_and_run.sh` 会按进程名停止已有原生实例；日用实例运行期间不要使用该脚本，使用上面的独立启动方式。

## 工程能力与验证边界

下表的“证据入口”指可执行验证或真实走查记录。单元测试、源码和声明文件不代替系统交互验证。

| 阶段 / 要求 | 当前实现与证据入口 | 尚需验证 |
| --- | --- | --- |
| A：运行时边界、信任与桥接 | 共享 `packages/craft-hub` / `createDesktopHostRuntime`；[桥接清单](desktop-bridge.md)、桥接合同测试、运行时信任与执行测试 | 浏览器、Windows/Linux 和 Node 22/24/26 的托管 CI 运行结果；配置存在不等于 CI 已通过 |
| A：最低系统、Node 合同 | ADR 0012；Swift/TypeScript 共用 `node-host-contract.json`；当前候选 Node 22/24/26 的本地测试、真实探测及包内验证见下文；原生 CI 已配置三版本矩阵 | 托管 CI、macOS 15、真实 Intel 硬件；本机 Xcode 的 arm64 Swift 测试加载器不能运行 x64 测试包 |
| B：工具启动、显示设置与公共事件流 | 两端共用 `project-launch.ts`；原生事件流、真实 loopback socket、迟到响应和重连测试；当前候选的主题/语言保存、原生与网页同步和重启恢复已实测 | 维护者实际编辑器、终端及外部工具的日用交接 |
| C：项目、今日重点、菜单栏 | SwiftUI 项目目录、共享今日重点快照、菜单栏入口；模型和 API 测试；当前候选侧栏上下键及各原生页面已走查 | 完整键盘、组合输入、VoiceOver；菜单栏和 Dock 逐项系统复验 |
| C：命令面板、快速记录、草稿 | 原生面板及恢复测试；2026-10-22 真实快捷键和未信任命令审阅；当前候选 ⌘K/焦点/回车、Escape、草稿跨退出重启已复验 | 输入法、完整焦点顺序、后台全局快捷键的新采样及显示器切换 |
| C：窗口、深链接、通知、App Intents | 几何恢复测试；系统菜单全屏进入/返回走查；实例/Launch Services 验证器；通知授权状态测试、拒绝提示及标准入口副本授权/重启、卡片默认点击和“查看项目”按钮走查；开发签名副本的 Shortcuts 注册、动作执行与窗口重开见下文 | 多显示器、键盘全屏、减少动态效果/透明度、高对比度；最新包等待授权提示、失败通知及其他通知场景；Spotlight 和正式签名包的系统入口 |
| D：插件、诊断与宿主扩展 | [管理指南](native-management.md)；`test:macos-management`、`test:macos-host-extensions`；普通页面走查；旧 Links 副本及最新收尾候选的 XCTest 证据；新包已完成安装/移除确认、取消/Escape、计划变化重新审阅、诊断详情与处理跳转，截图确认 README 和权限 | 完整焦点/组合输入和 VoiceOver、其他诊断处理目标及权限组合；本轮具体范围见工程收尾记录 |
| D：软件、环境、配置、声明式集成 | 原生来源、收藏、安装审阅、配置计划、加密备份、账号/动作/资源表单；`test:macos-configuration` 与模型/HTTP 测试 | 真实安装器和集成账号、文件选择器、敏感字段与未知回执恢复的系统走查；[自定义工具编辑与网站导航已原生化](native-tools.md) |
| D：无 Node 启动 | [Node 引导指南](native-node-runtime.md)；x64/Rosetta 真实下载与重启；当前 arm64 候选已实测无 Node 引导、登录 PATH、文件选择与失效路径回退，并完成私有版本恢复、取消、重启和缺失文件恢复 | 完整辅助功能、最低系统与真实 Intel；网络下载测试需单独启用 |
| D：Codex 活动、个人云和 Keychain | [活动指南](native-codex-activity.md) 已有系统审阅及事件走查；[私有通道](native-secure-storage.md) 的真实 Node/Swift/临时 Keychain/本地云替身演练 | 正式云网页的候选 callback 配套、真实账号授权、系统 Keychain 提示、正式签名更新后的访问 |
| E：普通资料复制与回退 | [迁移指南](native-profile-migration.md)；包内 CLI/sidecar 的复制、重复应用、竞争、恢复和保留后续编辑的回退；系统向导报告保存及活动宿主拒绝已走查 | 日用宿主停止后的正向 GUI 复制；真实资料仍有未知条目和未完成运行，不能直接应用 |
| E：设备身份迁移 | 源宿主审阅、同团队签名预检、逐消息内核身份验证、加密传输、资料/Keychain 协调、持久保护及中断恢复 | 真实 Developer ID 双宿主演练；当前发布能力标记关闭，不能把替身测试算作真实身份迁移 |
| E：单实例与公开链接交接 | [实例生命周期](native-instance-lifecycle.md)；`test:macos-instance`；[链接交接](native-link-handover.md) 的私有 scheme 系统切换与回退 | 公开 scheme 的签名发布开关、系统同意、重启和旧 Electron 竞争；实际默认宿主未切换 |
| E：签名、公证与更新 | [分发指南](native-macos-release.md)；独立 ad hoc 签名校验、Sparkle 框架及临时密钥的归档/订阅签名验证 | Developer ID、公证、Gatekeeper、真实公开 N→N+1 更新及托管发布流水线 |
| F：性能、可靠性与交接 | [性能记录](../research/native-macos-performance.md) 包含当前成对候选六次启动/footprint；此前双端面板/页面事件按旧产物单独绑定；原生相同产品代码已有输入、Escape、页面导航与正常退出证据 | 双端交互计时终点不同；同口径首帧、屏幕呈现与后台快捷键延迟、拖动帧时间、缩放录屏与连续两周日用仍待验收 |

## 通知授权与错误恢复（2026-10-23）

最新 `notification-errors-20261023-candidate/` 修订将系统的“通知不允许”错误映射为中英文权限说明，其他授权通信错误显示重试提示；仅将错误域和编号写入系统日志。等待系统授权期间显示进度及操作说明。通知默认关闭、只在点击开关时请求权限、只有授权成功才保存开启状态、关闭时移除通知的行为保留。新增可替换的系统通知边界，让自动化测试不触发真实系统权限或修改正式偏好。

三个新测试覆盖拒绝与异常、再次授权、偏好恢复、关闭不重复申请、系统响应前的重复点击和通信失败保留原设置。全仓 TypeScript 298 个文件、2402 项通过、3 项跳过；Swift 246 项通过、1 项可选官方联网下载跳过，真实 Node、当前包云侧车及私有 scheme 专项启用。lint/公共边界、typecheck、Swift 格式、工作区与原生构建、当前包插件/诊断管理、单实例及差异检查通过。最后一次原生构建包含最终日志改动，早一次构建记录另存，没有将旧二进制作为最终产物。

真实 Release 错误验收副本使用已知主程序身份不匹配的测试启动器触发系统 `UNErrorDomain 1`，实测中文提示、切换英文后重试的提示、开关保持关闭、正常退出重启后仍关闭且临时错误清除；两种语言均核对截图。此夹具只证明失败路径的真实 UI，不证明标准 App 入口被拒绝。两个会话的四个宿主/sidecar PID 均正常退出。副本 27 个产品 `__TEXT` 节及 App Intents 元数据与原包一致；包内 685 个普通文件和 1 个符号链接与此前成对交付的运行时一致。

另一个采用标准 `CFBundleExecutable` 的独立旧包副本曾进入系统授权等待。2026-10-24 维护者回复已允许后，原实例仍显示等待；正常退出并重启后，再次点击开关立即返回 `Notifications are not allowed for this application`，开关保持关闭。系统日志确认 `didGrant: 0`、`hasError: 1`，原因尚未确定。标准主程序名称、deep/strict 签名检查和 27 个产品 `__TEXT` 节与旧包的匹配均通过，不能把此结果归因于此前启动器身份不匹配。原三个 PID 已正常退出，重启实例保留以核对系统设置，记录在 `notifications-ui-20261023/report.json` 和 `authorization-followup-20261024.log`。

后续维护者明确要求由代理开启后，通过“系统设置 → 通知”正常界面确认 `Craft Hub Notifications Direct Test` 原开关为关闭，并将其开启。此前工具拒绝访问的是独立的 `com.apple.UserNotificationCenter` 授权程序，系统设置页面可正常操作；没有重试受限程序或重置权限。App 内重新启用通知后，系统日志确认 `didGrant: 1`、`hasError: 0`，开关显示开启，正常退出重启后仍保留。标准入口副本的实际授权和偏好持久化通过，证据仍绑定旧成对候选的产品代码。

独立测试项目先通过真实包内 API 核对命令预览、未信任执行拦截与零运行记录；随后仅对自建夹具明确授予信任，执行三秒 Node 输出任务，并在点击通知前恢复未信任。前四次任务均完成；原生事件订阅及摘要刷新、两条系统通知提交成功的日志分别保存在 `notifications-ui-20261023/request-observation.jsonl` 与 `card-delivery-process.log`。电脑控制工具无法选中通知卡片后，维护者明确允许使用 XCTest 完成系统 UI 验收。

2026-10-24 的 arm64 XCTest 实测通过两条路径：第 5 次夹具任务的卡片显示“Craft Hub／项目任务已完成。”，默认点击后截图确认选中 `notification-fixture-project`；第 7 次任务的卡片悬停显示“查看项目”，实际点击此按钮后截图再次确认对应项目及“未信任项目”提示。每条路径结束后均通过真实包内 API 复核仅有该项目、信任仍为 `untrusted`、运行记录分别保持 5/7 条，没有点击引起的额外执行。证据在 `notification-xctest-20261024/Result-20261024-005219.xcresult`、`Result-20261024-005511.xcresult`、对应 `report-*.json` 和导出的截图；这证明标准入口旧成对 Release 副本的完成通知与两种点击路径，不作为最新错误提示修订或所有通知场景的重新验收。

首次 XCTest 已点击旧卡片并冷启动 App，但读取 SwiftUI 无障碍树超时，未将其记作完整跳转通过。另保留旧卡片消失、测试运行器沙盒拒绝直接写仓库文件，以及一次未找到新卡片的失败记录；后者产生第 6 次任务，通知中心展开状态的具体影响未单独归因。最终测试通过 XCTest 附件保存截图，并使用自己的前台测试窗口确保夹具 App 在后台；没有修改产品或放宽系统权限。失败通知、其他通知场景及最终新包等待提示仍待实机验收。

所有 XCTest 会话均以 `finally` 和信号处理清理临时宿主、sidecar、辅助测试 App 与运行器，并按记录的 PID、主程序路径和启动时间确认退出；最终运行记录为 7 条、项目保持未信任，受保护握手文件已移除。日用原生 App 保持运行，Electron 未启动。夹具、系统授权、开启偏好和验收证据保留，临时修改的通知样式已恢复为“临时”。

提供 `Craft-Hub-Native-0.0.1-alpha.5-macOS-arm64-notifications-review.zip`（11,793,117 字节），SHA-256 为 `4c47d56f27996672603fa8e3898b8f4ada7e76d5f028e87a2c9a848d1405357d`。归档完整性、解压后签名和 778 个普通文件的内容匹配通过；这是本地 ad hoc 复验包，没有正式签名、公证或发布。性能对比、Node 22/26 与其他历史 UI 证据仍按各自注明的产物查阅。

## 成对候选的包内复验（2026-10-23）

同目录提供 `Craft-Hub-Native-0.0.1-alpha.5-macOS-arm64-review.zip`（11,788,468 字节），SHA-256 为 `984523b8b92ec3c703dc93e79cb80d04bc2daf5bad2ac1b0b9fc0b0516bf71e9`。归档完整性、解压后签名及 778 个文件内容与原包的一致性均通过；这是本地 ad hoc 验收归档，没有公证或发布。独立启动仍按本页空资料方式操作，不替换现用安装。

本轮全仓 298 个文件、2402 项 TypeScript 通过、3 项跳过；Swift 243 项通过、1 项可选官方网络下载跳过，真实 Node、当前包云侧车和私有 scheme 专项启用。lint/公共边界、typecheck、Swift 格式、工作区构建和差异检查通过。原生 App 未重新构建，使用逐文件相同且原生构建已通过的置顶候选；本轮源码仅修正性能测量器的 Foundation HOME 隔离，并更新记录。

原生副本通过插件/诊断/置顶与活动、外部扩展、配置、资料复制/重复应用/回退、单实例、身份接收拒绝和 Sparkle 验证。Electron 新包通过身份源拒绝边界、实际包内 Node/身份启动器及后端检查；另外将 asar 原字节解包到一次性验证目录，运行相同插件/诊断/置顶与活动检查。解包验证只证明这些 API 行为，实际 asar 启动另由身份源 smoke 和六次成对性能采样验证。资料保持未信任，没有项目运行或真实迁移。

Electron 身份源首次预览达到 45 秒超时；保留 `identity-source-first.log`。随后最小预览在 0.26 秒正常退出，完整验证在 2.29 秒通过，未修改产品或放宽超时。首次超时的根因尚未确定，不能据复跑把失败记录删除或声称已修复。后续 `identity-startup-20261023/report.json` 又验证既有路径、新副本路径和新签名身份共五次预览：新副本首次为 2.066/1.814 秒，随后约 0.25 秒，均正常退出、未修改源身份、阻止 Node 选项注入。没有再次达到采样阈值或复现 45 秒超时；失败原因仍未定。该验证覆盖 ad hoc 源宿主的只读与拒绝路径，不代替 Developer ID 双宿主身份迁移。

本轮应用菜单可打开快速记录，输入框获得焦点，账户不可用时保存禁用，Escape 返回；系统菜单栏、Dock 和后台全局快捷键仍未可靠验收。未停止日用实例。完整辅助功能、详情弹窗工具崩溃、最低系统、正式发布与两周日用的门槛继续保留。

## 插件计划变化与归档校验补验（2026-10-23）

`apps/macos/build/plugin-plan-ui-20261023/report.json` 记录当前交付包的另一份隔离副本。原生目录已显示两个测试插件并核对截图；坐标操作随后返回 `noWindowsAvailable`，改用可访问的详情按钮后，21:37 的系统报告再次显示 `SkyComputerUseService` 在 `Array.remove(at:)` 中触发 SIGTRAP。此次 README 只有简短测试文本，App、转发进程和实际 sidecar 均存活。不能把目录截图或包内请求成功记作详情、安装确认及 Escape 的界面验收。

同一实际包内运行时通过本地 HTTPS 目录和 npm 仓库完成进一步验证：依赖从 1.0.0 变为 1.1.0，并新增 `read-project-files` 权限后，旧 `reviewedPlan` 返回 409，没有新增下载或安装；损坏的依赖归档被完整性校验拒绝，已安装列表仍为空；恢复原归档并提交重新读取的计划后，根插件 1.0.0 和依赖 1.1.0 实际下载、校验并安装成功。安装后的计划为保留已有版本，项目和运行记录均为空。

这次使用开发 sidecar 覆盖入口的透明管道转发器，为测试子进程单独提供本地 TLS 证书信任并记录临时握手；没有替换 API、修改产品包或系统信任库。副本的 27 个产品 `__TEXT` 节、App Intents 元数据、685 个运行时普通文件和 1 个符号链接均与交付原包匹配。因工具无法重新绑定详情弹窗，按完整路径核对后仅终止本次宿主，三个测试 PID 均已离开；这是异常结束后的清理，不是正常菜单退出证据。临时会话与私钥已移除。产品源码未变，全量检查沿用当前交付记录；原生安装计划确认仍待工具恢复后走查。

## 前一候选记录（2026-10-23）

架构修复前的本地工程记录位于 Git 忽略的 `apps/macos/build/acceptance-20261023-browser-policy/report.json`，同目录保留该批次验证日志。原生和配套 Electron arm64 均通过独立签名检查；该记录包含可执行文件/包内运行时 SHA-256、代码签名摘要、工具链和 dirty 状态，不把 Git HEAD 当作未提交构建的唯一标识。

本批次 TypeScript 2391 项通过、3 项跳过；Swift 233 项通过、1 项官方网络下载测试跳过，真实 Node、包内云与私有 scheme 系统演练启用。最新包内迁移演练验证浏览器状态排除、源保留、复制、幂等回执、恢复和回退。真实资料的新只读预检观察到 9 项阻塞（8 项未分类条目、1 项未完成运行），未执行实际迁移。其他流程的历史证据按上表链接查阅，不能视作本批次全部重新验收。

同日下午对这两份未改变摘要的产物完成插件/诊断管理、外部扩展、配置管理、单实例、身份接收入口、带 Electron 包内 Node 的身份启动器和 Sparkle 工具七项复验。配置项首次因隔离环境找不到真实 Codex CLI 失败，指定安装路径后通过，失败与重试日志均保留。解锁后新增更新弹窗与 Escape、本地插件链接及重启、诊断错误/恢复、公开链接只读设置的真实 UI 证据；详情仍触发电脑控制服务自身崩溃，已请求人工核对。详见管理与链接交接指南，未标记全部界面验收完成。

上述保留产物的性能报告为 `performance-20261023-candidate/report.json`，六次采样完整、清理无残留。另有 `instruments-20261023-candidate/report.json`：两端 App Launch 采集带有采样周期警告，原生初始帧阶段可导出，Electron 对应区间不可用；不据此宣称首帧对比或整体交互达标。两个报告均与本节候选记录相互关联，原始产物没有重建或改签。

## 架构与私有 Node 后续修复（2026-10-23）

构建器现按 Node 进程架构显式指定 Swift 目标，检查最终 Mach-O 架构，并只读取当前 Release 产品对应架构的 App Intents 常量。在本机 Xcode 下，即使由 Rosetta shell 启动，Swift 默认目标仍可能是 arm64；原先可能把 arm64 主程序和 x64 插件打进同一包。新增两个文件夹具测试覆盖混合架构、旧 Debug/测试输出及传统 SwiftPM 布局。

这批产物单独保存在 `apps/macos/build/arm64-acceptance/Craft Hub Prototype.app` 与 `apps/macos/build/x64-acceptance/Craft Hub Prototype.app`，未覆盖上节性能被测产物。主程序、keytar 和 PTY 的架构一致，独立 ad hoc 签名检查通过。两端最终包的插件/诊断管理、单实例及身份接收拒绝验证通过。摘要、工具链、命令与失败重试日志在 `apps/macos/build/acceptance-20261023-architecture/`。

x64 真实设置下载暴露了首次探测超时：已校验、刚解压的官方 Node 在本机首次启动耗时约 9.4 秒，超过普通搜索的 3 秒；移到最终目录后又出现约 8.5 秒的首次启动开销。安装器现在先放入未选中的不可变版本目录，再以 30 秒上限探测并运行包内 sidecar 预检，通过后才原子写入选择回执。失败保留旧选择并清理本次未启用版本，普通 Node 搜索仍使用 3 秒。新增回归覆盖慢启动、最终路径验证和激活前状态。

修复后的 x64 App 在 Rosetta 下用空资料真实打开无 Node 引导页，Escape 取消未产生下载目录；再次确认后完成官方下载、校验、自动启动，诊断中心显示私有 Node 24.22.1、零错误与警告。正常退出后宿主/sidecar 消失，重启自动使用同一版本；再次正常退出无对应进程残留。设置页下载和保留当前运行时也已实测。独立 UI 副本的全部 Mach-O `__TEXT` 节和包内运行时与最终 x64 产物逐项匹配。

本批次 lint/公共边界、typecheck、workspace build、Swift 格式与两种原生构建通过；TypeScript 296 个文件、2393 项通过、3 项跳过；arm64 Swift 234 项通过、官方网络下载 1 项跳过，真实 Node、包内云和私有 scheme 系统专项启用。x64 Swift 测试包虽能编译，但当前 Xcode 的 arm64 测试加载器拒绝加载它，测试用例没有执行；真实 App/Rosetta 和包内验证不能代替 x64 全量 Swift 测试、Intel 硬件或 macOS 15 验收。正式发布配置仍仅提供 arm64，签名公证和默认宿主状态没有改变。

## 当前候选交互与性能复验（2026-10-23）

最新 arm64 候选的独立副本已通过 ⌘K 打开与搜索焦点、Escape/重开、粘贴中文页面名并回车导航、插件/诊断页 ⌘F、侧栏上下键越过分组标题。快速记录从面板和原生菜单打开，本地草稿在收起、重开和正常退出后的重启中保留；空账户下远端保存保持禁用。系统菜单进入全屏并返回原窗口的布局已目视检查，键盘全屏组合键未确认生效，多显示器与连续缩放仍未验收。普通退出后两个测试会话的宿主和 sidecar 均消失。

记录在 `apps/macos/build/interaction-20261023-candidate/report.json`，绑定原包 SHA-256 与副本 `__TEXT` 节。原生处理入口到面板提交/页面 `onAppear` 的中位数约为 19 / 21 / 27 ms，这些回调不证明屏幕首帧或相同时间内的焦点就绪。新启动/内存对比为 `performance-20261023-architecture/report.json`，绑定架构修复后的原生摘要；六次采样完整且无清理残留。两份记录互相关联，方法、数据与限制见性能指南。未授予账户权限、提交远端待办或运行项目命令。

同一候选随后通过前台 ⇧⌘Space 打开快速记录、聚焦并恢复草稿，以及 ⌘, 打开原生设置、⌘W 关闭设置返回主窗。临时资料切到英文/浅色后，设置、侧栏、原生 View 菜单及网页回退同步更新；截图核对了浅色呈现。正常退出再启动后偏好保留，最终通过原生控件恢复中文/跟随系统。两个会话的宿主和 sidecar 均正常退出，产物摘要和副本的 27 个 `__TEXT` 节重新核对一致，记录为 `apps/macos/build/system-entry-20261023-candidate/report.json`。

这次系统入口尝试没有补齐 Dock、菜单栏和后台快捷键验收：工具连接 Dock 超时，观察已关闭主窗的 App 时重新打开了窗口；向访达投递快捷键后，候选没有新增快速记录事件。不能区分工具定向投递与系统全局快捷键行为，也没有停止其他日用实例来争抢快捷键。设置中一次 Tab 未建立完整焦点顺序；未更改系统键盘导航偏好。这些结果保留为不确定，不能用前台快捷键或控件标签代替。

## 私有 Node 版本恢复（2026-10-23）

`apps/macos/build/node-rollback-ui-20261023/` 补齐了当前原生相同产品代码的真实回退 UI。测试驱动使用未修改的生产下载器、安装器、Node 探测和 sidecar 预检代码，从 nodejs.org 下载并校验 arm64 Node 24.18.0 和当前固定的 24.22.1，生成隔离的升级历史；没有修改产品 pin，也没有伪造安装回执。这只是旧版历史夹具准备，不代表曾发布并运行过一份旧版 App。

设置中首次显示正在使用的 24.22.1 和恢复入口；确认说明下次启动生效，Escape 取消后回执/PID 不变。确认恢复后私有选择变为 24.18.0，正在运行的 24.22.1 sidecar 不变；正常退出并重启后，实际使用私有目录中的 24.18.0。

仅暂时移走夹具中未被使用的上一版本文件后，恢复操作显示目录/状态错误，回执和当前进程均保留。恢复该文件并重新审阅后成功，错误清除；再次退出重启使用 24.22.1。两份 Node 的原文件摘要均未变化，三个会话正常退出，六个宿主/sidecar PID 均已离开。滚动后的设置截图已核对，路径和操作控件未重叠。

副本的 27 个产品 `__TEXT` 节、App Intents 元数据和 686 个包内运行时文件与交付原包匹配。额外 arm64 启动器只为隔离 HOME/PATH；本轮没有产品代码变化，全量测试/构建沿用交付候选记录。完整辅助功能、最低系统及真实 Intel 仍待验收。

## 登录 PATH 与 Node 文件选择（2026-10-23）

使用当前 `palette-pins-20261023-candidate` 原包的隔离副本补齐启动流程。证据在 `apps/macos/build/node-bootstrap-ui-20261023/report.json`：空搜索路径显示原生无 Node 引导，操作前没有 sidecar 或登录脚本记录；取消文件选择返回引导，选择非可执行文件显示拒绝原因。点击“读取登录 PATH”只执行一次夹具的非交互登录文件，成功使用含空格路径中的 Node 24.18.0。正常退出和重启使用保存路径，登录记录仍只有一次，交互启动文件从未执行。

仅在退出后移走夹具的已选 symlink，重启会回退到夹具 `~/.local/bin/node` 并显示原因及实际路径。设置中的文件选择会解析 symlink 到实际可执行文件，保存后当前 sidecar 的 PID/路径不变；下次启动采用新路径。文件选择器前台化后 Escape 取消成功。全部四轮有效验收的宿主/sidecar 正常退出且无残留；没有修改正式资料或现用 Node。

夹具同时设置 `HOME` 和 `CFFIXED_USER_HOME`，并通过独立 arm64 启动器固定环境；仅设置 HOME 不能隔离 Foundation 的主目录，而验收工具会覆盖 `LSEnvironment` 的 PATH。最初找到本机 Node 的试跑及被 launchd 拒绝的脚本启动器均记录为夹具修正，没有计入无 Node 通过项。最终副本的产品主程序 27 个 `__TEXT` 节、App Intents 元数据和 686 个包内运行时文件与原包一致；原包 9 个 Mach-O 均含 arm64，副本多出的第 10 个为测试启动器，两包签名完整校验通过。

本轮没有修改产品代码；全量测试和构建沿用上述摘要绑定的置顶候选记录，文档检查另行执行。空 HOME 下 Workstation 的配置缺失仍显示为诊断错误，未声称零诊断。本节当时保留的私有版本回滚已在上节补验；完整辅助功能、最低系统及插件详情工具故障继续保留。

## 置顶能力排序与通知（2026-10-23）

原生命令面板现在通过现有 `/api/projects/:id/pins` 读取运行时解析后的置顶 ID，不在 Swift 中复制语义匹配或持久化。搜索先比较精确名称、名称前缀、名称子串和说明匹配，同等相关度再将置顶结果提前；置顶图标带无障碍标签。项目范围、技能分类和命令前缀继续有效。失败的置顶读取不会隐藏已发现的命令，也不会继续显示旧置顶标记；底部提示可重试。

成功的置顶 API 写入现在发布既有 `project-change` / `capabilities` 通知，其他网页和原生客户端可重新读取。读取和被拒绝的写入不发布该通知；写入不改变信任或执行命令。已打开原生面板刷新时保留查询和选中结果身份，旧连接的迟到结果不能恢复已清除的目录。包内管理验证脚本增加真实置顶读取、写入、事件接收和取消置顶检查，仍确认 untrusted、零运行记录以及 sidecar 正常退出。

隔离 Release 副本实测并截图核对：默认置顶 `zeta-build` 位于首项；搜索 `build` 按 `build`、`build-preview`、`zeta-build` 排列，最后一项保留置顶图标和 `Pinned` 无障碍标签。方向键与 Return 进入未信任审阅页，没有执行输出。通过网页取消置顶后，重开原生面板恢复普通顺序；改为置顶 `build-preview` 后，原生首项同步更新，正常退出重启后仍保留。刷新按钮保留 `> project:` 查询、`alpha` 选中项和搜索焦点。已打开面板的外部写入通知覆盖由包内 SSE 和模型失效测试提供，未将重开面板走查写作这一场景的 GUI 证明。

证据在 `apps/macos/build/palette-pins-20261023-candidate/`，新原包主程序 SHA-256 为 `c19ffd4553ab46d7cd3ff973cb27baf3afed59c286cd34252d9b257a2cac5a82`；UI 副本 27 个 `__TEXT` 节和 App Intents 元数据匹配，9 个 Mach-O 组件均含 arm64，完整签名校验通过。两次 UI 会话正常退出，无测试宿主/sidecar 残留；当前包只读 API 复核仍 untrusted、零运行记录，唯一置顶为 `build-preview`。

全仓 298 个文件、2402 项 TypeScript 通过、3 项跳过；Swift 243 项通过、1 项官方网络下载跳过，真实 Node、当前包云侧车及私有 scheme 专项启用。lint/公共边界、typecheck、Swift 格式、工作区及原生构建、包内管理/置顶和单实例验证通过。首次 Swift 全量的既有进程清理测试缺少夹具 PID 文件，单项及完整复验通过；失败日志保留，未修改断言或超时。插件详情工具崩溃、完整辅助功能、系统入口、最低系统及正式分发待验收项继续保留。

## 自定义快捷键与审阅导航（2026-10-23）

原生 View 菜单现在读取共享 `workbench.shortcuts` 的命令面板绑定，并通过“项目快捷键”菜单提供已配置能力。只对配置涉及的已登记项目做只读发现，选择能力仍进入既有审阅页；无效绑定、重复能力组合键、缺失能力不生成有效入口。设置/目录失效及连接切换立即清除能力菜单，延迟响应不能恢复旧入口。仅缓存资料范围内的面板绑定，未缓存能力授权或执行状态。系统保留组合键仍遵循 macOS 菜单优先级，完整快捷键编辑沿用网页设置。

隔离 Release 副本实测：⇧⌘J 打开面板并聚焦搜索，旧 ⌘K 不触发；⌥⌘I 打开未信任 `inspect` 审阅页。运行中修改临时设置文件后，公共事件使绑定切换为 ⌥⌘J / ⌥⌘O，两个旧绑定解除。正常退出重启后新绑定保留；清空配置后项目菜单消失，默认 ⌘K 恢复。在原生插件与诊断页均验证了面板入口。两个 GUI 会话正常退出，宿主和 sidecar 无残留；随后通过当前包的只读 API 再确认项目仍 `untrusted`、运行记录为零。

证据位于 `apps/macos/build/shortcuts-20261023-candidate/`。原包与 UI 副本主程序的 27 个 `__TEXT` 节及 App Intents 元数据一致，包内 9 个 Mach-O 组件均包含 arm64；签名完整校验通过。全仓 298 个文件、2401 项 TypeScript 通过、3 项跳过；Swift 239 项通过、1 项官方网络下载跳过，真实 Node 24.18.0、包内云与私有 scheme 专项启用。lint/公共边界、typecheck、Swift 格式、工作区与原生构建、当前包的插件/诊断管理和单实例验证通过。跨端共享快捷键夹具覆盖字母、修饰键、导航键和功能键；另有断线、晚到响应、项目移除及重复绑定测试。

本轮未重测性能、系统 App Intents 调用或正式分发，旧证据继续绑定各自的产物。插件详情弹窗的工具崩溃、完整键盘/输入法/辅助功能及其他系统入口仍按既有清单保留。

## App Intents 系统调用与冷启动修复（2026-10-23）

系统“快捷指令”已识别隔离副本的 `Open Project` 和 `Open Quick Capture`。ad hoc 包执行时报告无法与 App 通信；系统日志明确记录缺少 Team ID，`linkd` 因 `requiresValidatedBundle` 拒绝连接。对同一隔离副本使用本地 Apple Development 签名后，两个 `perform()` 均由系统实际调用。没有导出证书、修改已安装 App 或启用发布能力。

真实冷启动发现了窗口生命周期缺口：完全退出后，系统可执行动作，但主窗口尚未创建，原先位于根视图 `onAppear` 的导航连接不会发生。现将主窗口、设置与系统动作连接移至场景初始化，待处理动作可创建所需窗口。已运行状态下的快速记录显示原生表单、未连接时保存禁用、Escape 收起；项目动作传入名称/路径筛选并去掉首尾空格。修复后冷启动及关闭主窗口后的重开已走查，原生设置和命令面板快捷键也已回归。

记录保存在 Git 忽略的 `apps/macos/build/app-intents-20261023-candidate/`，包含失败与修复后的系统日志、隔离身份与资料目录、签名及代码摘要。系统快捷指令 `Craft Hub Native Entry Test` 仅关联此隔离副本。首次窗口缺失的测试实例无法通过电脑控制工具正常退出，已按精确进程路径终止并确认没有测试子进程；修复后验证使用正常退出。

完整打包后的副本再次由 Shortcuts 冷启动，项目页收到已修剪的查询，正常退出后宿主和 sidecar 均离开。原包与 UI 副本的 27 个主程序 `__TEXT` 节和 App Intents 元数据一致，包内 9 个 Mach-O 组件均包含 arm64。全仓 298 个文件、2400 项 TypeScript 通过、3 项跳过；Swift 234 项通过、1 项官方网络下载跳过，真实 Node、包内云与私有 scheme 验证启用。lint、公共边界、typecheck、Swift 格式、工作区构建、原生构建及包内插件/诊断管理、单实例验证通过。前两次并发测试分别出现文件监听和 Git 集成超时，各自定向复验通过；降低到单 worker 后全仓通过，失败日志保留，未放宽断言。

这项证据不覆盖 Spotlight、正式 Developer ID 签名包、最低 macOS 或真实 Intel 硬件。开发签名不是公证或正式发布验证；完整键盘、辅助功能和其他系统入口仍按上表保留。

## 当前候选 Node 兼容复验（2026-10-23）

对架构修复后的同一 arm64 App 补跑 Node 22.23.1 与 26.0.0。各版本的运行时/宿主测试为 147 个文件、1155 项通过、3 项跳过；Swift 全量各 234 项通过、1 项官方网络下载测试跳过，真实 Node、包内云及私有 scheme 系统专项均启用。两版本分别通过当前包的插件/诊断管理、外部宿主扩展、配置管理、资料迁移/回退、单实例及未认证身份接收拒绝验证；原生身份启动器的进程所有权与消息认证夹具也通过。配置项显式使用本机已安装的 Codex CLI；全程使用临时资料。Node 24.18.0 的全仓 2393 项及 Swift/构建结果沿用上文架构批次，未把定向矩阵计数写成全仓覆盖。

记录位于 Git 忽略的 `apps/macos/build/compatibility-20261023-final/`，包括逐命令日志、退出码及当前候选摘要。Node 26 使用既有官方下载缓存，执行前重新与该版本官方 SHA-256 清单核对归档，并核对现有可执行文件与归档成员一致；没有替换用户 Node 或修改用户 PATH。

原生 CI 现为 Node 22/24/26 三版本矩阵。各任务先用 `.node-version` 构建，再切换运行时 Node，以显式 `node --import tsx` 运行包内验证；迁移/回退和单实例也纳入矩阵。本地工作流结构检查与 lint 通过只能说明配置可解析；尚未提交触发托管 CI，最低系统、真实 Intel 与 GUI 待验收项继续保留。

核对时发现更新验证器只读取默认构建目录，现已与其他包内验证器一致，接受明确的 App 路径。Node 22/26 对当前保留候选的 Sparkle 框架加载、临时签名 ZIP/appcast 校验及篡改拒绝均通过；未使用正式签名身份或发布更新。此轮改动为 CI、验证器和文档，产品包摘要保持不变；最终 lint/公共边界、typecheck 与差异空白检查通过。

## 一次可重复的自动化复验

从当前 checkout 运行。构建会重写 `dist`，应先完成测试，再开始构建，避免读取正在替换的产物：

```sh
pnpm lint
pnpm typecheck
pnpm test --run
pnpm build
pnpm lint:macos
pnpm build:macos
CRAFT_HUB_TEST_NODE="$(command -v node)" \
  CRAFT_HUB_TEST_CLOUD_SIDECAR="$PWD/apps/macos/build/Craft Hub Prototype.app/Contents/Resources/app/apps/desktop/dist/sidecar.mjs" \
  CRAFT_HUB_TEST_LINK_HANDOVER=1 \
  swift test --package-path apps/macos
codesign --verify --deep --strict 'apps/macos/build/Craft Hub Prototype.app'
pnpm test:macos-management
pnpm test:macos-host-extensions
CRAFT_HUB_TEST_CODEX="$(command -v codex)" pnpm test:macos-configuration
pnpm test:macos-migration
pnpm test:macos-instance
pnpm test:macos-identity-recipient
pnpm test:identity-launcher
pnpm test:macos-updates
```

配置验证使用已安装 Codex CLI 的真实 app-server 协议读取临时 TOML。`CRAFT_HUB_TEST_CODEX` 必须指向可执行文件的绝对路径；若 `command -v codex` 无结果，请先定位已安装 CLI。该覆盖值只在临时 HOME 内建立链接，不修改真实 Codex 配置。不要把缺少 CLI 导致的失败视为该项已通过。

包内验证默认使用上述构建目录。验收保留的另一份候选时，显式传入该 App 路径，例如 `pnpm test:macos-updates 'apps/macos/build/handoff-20261023-candidate/native/Craft Hub Prototype.app'`；更新验证器同样接受此参数，避免验证到默认目录中的旧包。

验证器使用独立夹具，只清理自己的数据、Keychain、临时注册和进程。它们不替换安装、不授予真实项目或账号权限，也不切换公开链接。官方私有 Node 下载需按引导指南另外启用；Swift 默认跳过该网络项。身份源端和独立 Electron 后端的包内验证见安全存储指南，需要相应 Electron 产物。

记录本次命令、退出码、跳过项、操作系统/工具链、Git revision 与 dirty 状态，以及产物的签名摘要和 SHA-256。dirty checkout 的 Git revision 本身不能唯一标识构建。原始日志和含本机路径的报告放在 Git 忽略的 `apps/macos/build/`；不要提交账户、凭据或真实资料列表。

## 真实界面验收顺序

1. 解锁系统，用隔离资料启动。先验证命令面板、快速记录和草稿恢复，再查看项目、今日重点、软件、环境及设置；全程保留未信任状态，命令入口只到审阅页。
2. 按管理指南测试本地声明式插件的链接、重启、启停、详情、确认取消、来源预览和诊断修复；测试扩展只使用自建夹具，检查重启后的加载边界。
3. 覆盖键盘、Escape、中文组合输入、VoiceOver、缩放/全屏和多显示器。AX 标签与中文粘贴不能替代这些验收。
4. 检查 App Intents、通知、菜单栏及 Dock。系统入口只能导航或填写待确认内容，不能直接授予信任、执行命令或提交记录。
5. 关闭本次主窗口后验证后台入口；菜单正常退出后检查对应 sidecar 和 WebKit 服务离开。进程存活与路由正确不代表像素和焦点正确。

当前电脑控制服务在部分 SwiftUI 详情弹窗发生自身崩溃；App 和 sidecar 仍运行。这是验收工具障碍，不能标为产品通过或产品崩溃。锁屏时只继续独立的代码/自动化工作，不反复尝试弹窗或把自动化结果替代真实走查。

架构须核对具体 App 路径和其组件，不能仅凭应用名称判断。2026-10-23 的日用安装及当前插件验收副本均包含 arm64，另有明确用于兼容测试的 x64 候选。[Apple 说明](https://developer.apple.com/news/?id=w5ngl9k2) macOS 26.4 起运行依赖 Rosetta 的应用可能提示 Intel 应用支持即将结束；先前 x64 测试可能触发该提示，但本次日志未能把维护者看到的历史通知对应到某次启动，不能将推测写成已确认的来源。

## 正式迁移与切换的独立门槛

完成未知资料分类和未完成运行的人工恢复后，重新生成只读迁移报告；停止所有相关写入者，审阅实际源、目标、备份与回退路径，再执行已明确授权的迁移。加密身份必须走已通过真实签名配对验收的通道。不要删除身份、锁或未知条目来绕过阻塞。

维护者连续两周日用、真实签名公证、公开更新、真实资料迁移和默认宿主切换分别保留证据。发布和替换默认安装需要明确授权；本地测试全部通过也不自动完成这些门槛。
