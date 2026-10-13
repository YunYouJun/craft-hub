# 工作台差异化与交接路线

> 更新：2026-10-09。用户进一步将工作台定位为软件准备、工具入口与开发环境管理，当前优先路线见[个人环境工作台](./machine-workbench-direction.md)。本文件保留此前交接方向及宿主实验的记录；交接 P0 / P1 不再是默认开发顺序。已有总览决策见 [ADR 0010](../adr/0010-personalize-the-persistent-workbench-overview.md)，接口证据见[工作台调研](../research/agent-workbench-selection.md)。下列复选项区分已经落盘的基础能力与尚未完成的流程；未勾选项不构成已交付承诺。

## 核心工作流

Craft Hub 回答三个相连的问题：哪些工作需要我处理，关联哪个项目，以及带着哪些上下文交给哪个工具。价值应体现在减少重复查询和补充上下文，而不是拥有更多启动按钮。

```text
Provider 的真实工作项
  → 精确来源与身份
  → 用户确认的本机项目、目标与能力上下文
  → 预览 / 复制 / 经验证的外部接收
  → 返回摘要
  → 审阅 Provider 原生状态动作
```

Raycast 负责快捷搜索、热键与打开工具；Orca 或其他编码工作台负责会话、终端、worktree 和代码审阅。Craft Hub 保留跨来源总览、项目能力、上下文审阅、业务动作及其验证。工作项仍由 Provider 持有，路线待办记录在本文件，不创建第二个任务系统。

## 当前状态

| 能力 | 状态 | 实际边界 |
| --- | --- | --- |
| 默认 `/overview`、工具分组与项目收藏 | 已实现 | `workbench.home` 保存在 OS 设置目录；不只是浏览器存储 |
| 真实“我的工作”预览 | 已实现 | 各来源的无需确认的全局 `work-items.list`；精确账号筛选、终态过滤、失败隔离；返回数据的部分预览 |
| 项目与插件入口、业务操作 | 已实现 | 使用已有公开合同与受审阅的动作；不改写 Provider 权威 |
| 事项 / 项目上下文准备与外部启动 | 已实现首版 | 选本机项目、补充目标、预览 / 复制；启动 Raycast 或 Orca；网页回退；始终报告 `contextTransferred: false` |
| 工作项与项目的持久关系、完整上下文收集 | 待做 P0 | 当前手选项目不是已建立准确关联 |
| 可观察的上下文接收、返回摘要与真实闭环 | 待做 P1 | 目标端打开成功不是接收或执行证明 |
| 可定制布局、更多外部适配器 | 待做 P2 | 基于已验证需求再扩展，不先复制启动器或 IDE |

旧 Codex SDK 路径仍是迁移兼容流程：它会在本机执行后再打开客户端。新的外部入口不应悄悄复用该执行路径。移除 task/session/delivery 后端前，必须迁移其现有调用者，遵守 [ADR 0009](../adr/0009-focus-on-project-capabilities-and-integrations.md)。

## 已完成基础

- [x] 总览无选中项目也能展示真实状态；启动读取、空结果、无身份和错误分别显示。
- [x] 工具与 pins 通过 runtime 设置验证、revision 和 OS 持久化；工具网址只接受 HTTPS。
- [x] 来源读取排除写操作、需要确认、仅项目作用域和必须提供项目的动作。
- [x] “我的工作”按当前来源的精确用户 ID 筛选；相同 ID 的不同来源、资源范围互不混淆。
- [x] 明确部分预览与来源跳转，不把分页首屏称为全部待办。
- [x] 核对 Raycast 正式 deeplink、Orca CLI 和 URL handler；没有构造未经支持的 Orca 项目协议。

## 当前切片：显式准备与启动

- [x] 从项目或 Provider 返回的事项进入交接草稿，选择本机项目、补充目标，展示可复制的来源与项目上下文。
- [x] 工具采用 HTTPS 网站加可选固定 `launch`：Raycast 可配置无 query / hash 的命令 deeplink，Orca 仅应用启动。
- [x] 原生启动只在用户显式操作后发生；报告启动或失败，不报告目标执行或自动状态变更。
- [x] 普通浏览器、未安装应用和启动失败保留明确的网站 / 复制入口。
- [x] 自动化测试覆盖恶意 URL、无效 deeplink、禁用 query、固定应用 argv、失败回退和无隐藏 Agent 执行。
- [x] 手工验证 macOS Desktop 的 Raycast / Orca 应用打开、项目交接预览与复制，以及普通浏览器的网站入口；首版继续标记 `contextTransferred: false`。未安装应用的失败回退由自动化测试覆盖。

验收例：打开一个真实来源的工作项，选择一个本机项目，补充目标，检查并复制文本，然后打开 Orca。Craft Hub 展示“已请求打开；请在目标工具确认并粘贴上下文”，不显示“任务已派发”。应用不存在时能打开网站，草稿不丢失，也不更改该工作项状态。


验证记录（2026-10-09）：全量 159 个测试文件、867 项测试通过；lint、公开边界、TypeScript / Vue 类型检查和全量构建通过。使用隔离的 QA 数据目录与 Sample Project，在 macOS Electron 中实际点击工具入口并确认 Raycast 1.104.31、Orca 1.4.222 窗口；项目交接文本补充目标后复制成功。浏览器显示“浏览器模式 · 打开网站”。Provider 事项与多来源隔离通过组件测试；尚未跑真实业务 Provider 的执行与回写闭环，该项保留在 P1。Raycast 配置命令只做格式、安全和启动参数测试，没有执行用户的扩展命令。

## P0：使事项与项目上下文准确

- [ ] 精确来源定位：以 Provider 实例、资源范围和实体 ID 找回原事项；来源支持时使用声明的 `work-items.get`，否则跳回该来源，不用标题或全局 ID 猜测。
- [ ] 项目关联：从声明的仓库元数据提出候选，展示多匹配与无匹配，让用户确认；把关系存进 OS 用户数据，并处理路径变化和已删除项目。
- [ ] 上下文收集：纳入来源链接、目标、仓库 / 本机路径、选中子包、能力 ID 与结构化命令预览；显示每段来源和缺失项，用户审阅后才复制或传送。
- [ ] 跨 Provider 查询：统一“我的未完成事项”的来源选择、排序与刷新，同时保留账号、状态映射、分页、错误与最后更新时间；不能宣称只读首屏已覆盖所有事项。
- [ ] 保持读取安全：不自动执行项目命令、Skill、需确认的 Provider 动作或收集环境变量值；不得因选中项目而授予信任。

验收：两个真实来源存在相同 ID 的事项时，选择后仍定位正确；账号缺失不能冒充“我的”；同一仓库的多个本机候选不被静默选择；来源失败或分页未完成时，用户能辨认结果范围。

## P1：验证交接接收与返回

- [ ] 选择一个外部工具的实际接收合同，验证版本、输入编码、工作目录、失败行为和可观察接收结果；只有接收证据足够时才返回 `contextTransferred: true`。
- [ ] 最小交接记录：保存来源身份、项目引用、目的地、时间和实际观察到的结果；启动请求、接收和任务完成分开，不添加第二套 Agent task 状态机。
- [ ] 返回摘要：手动回到原事项或接受经过验证的返回 receipt；失效项目 / 来源、重复 receipt 和版本不兼容必须显式处理。
- [ ] Provider 回写：先审阅摘要，再进入来源原生状态动作，保留字段、校验和确认；应用启动和 receipt 不自动标记完成。
- [ ] 跑通一个真实工作流并记录往返次数、必须返回 Craft Hub 的原因及失败点；验证两任务隔离、客户端重启和中断后的恢复。
- [ ] 按真实使用证据迁移或退役旧内部执行路径，再删除其调用者、IPC、Provider 和依赖；不先删共享后端。

验收：原工作项可追溯到确认的项目和实际外部接收；关闭目标工具或取消操作不会显示完成；返回时仍能找到同一来源并独立审阅状态更改。CLI 存在、协议注册或系统 `open` 成功，都不能独自满足这一验收。

## P2：体验与分发

- [ ] 在本轮已实现的工作项 / 项目优先布局基础上，经 P0 / P1 验证后加入个人排序和必要的布局调整；工具入口为辅。
- [ ] 为已有真实需求增加 Raycast 专用命令或其他工具适配器；公开同一项目 / Provider 合同，避免维护第二套逻辑。
- [ ] 分离可导出的工具偏好与机器相关 project pins / associations，验证导入映射和失败回退。
- [ ] 按下列分发评估结果确定 Electron 宿主、浏览器和 CLI 分工；改变打包前保留用户数据迁移与回滚路径。

## 分发前置评估：包体与桌面宿主

2026-10-09 的初始本机审计：当前定位以总览和外部交接为主，应把小包体作为分发要求。推荐验证本地服务与 Web 工作台作为主入口，Electron 保持兼容；独立原生窗口通过可选 Tauri 宿主验证。下列初始目录测量与后续完整产物测量分别记录；默认桌面入口仍为 Electron。

| 当前对象 | 本机目录磁盘占用 | 解释 |
| --- | --- | --- |
| `apps/web/dist` | 约 12 MiB | 完整 Web 构建，包含高亮语言和终端等按需资源，不等于首页加载量 |
| `apps/desktop/dist` | 约 96 KiB | 自有主进程代码，不包含依赖 |
| Electron 44.0.0 的 `Electron.app` | 约 287 MiB | 安装的未压缩运行时，不是下载包 |
| Codex CLI 0.149.1 的 darwin-arm64 依赖目录 | 约 269 MiB | 现有 SDK 执行路径使用的本机依赖，不是新总览所必需的 UI |

测量采用 `du -sh`，这些目录不能直接相加推算最终安装包。旧社区 arm64 ZIP 约 251 MiB（文件日期 2026-09-02），不是当前源码的重新打包结果。[打包脚本](../../scripts/package-macos.ts)部署生产依赖，并额外复制 Web 资源；runtime 包也带 Web 资源；后续实际打包确认 ASAR 对相同内容共用 offset，不能将两个目录的磁盘占用视为重复的安装包 payload。

Electron 分发包含 Chromium 与 Node.js。[官方介绍](https://www.electronjs.org/docs/latest/) Tauri 使用系统 WebView，能够避免随应用分发 Chromium。[官方架构](https://v2.tauri.app/concept/architecture/) 但现有 runtime 依赖 Node 的文件系统、进程、监听、原生模块与动态 Host Plugin；保留行为仍需 Node sidecar 或后端迁移。Tauri 官方支持[外部二进制](https://v2.tauri.app/develop/sidecar/)和[Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)，不能据此承诺整个 Craft Hub 只需几 MiB。

- [x] 区分当前 Web / 主进程代码、Electron 运行时、Agent CLI 依赖和旧安装包；确认大头不在总览页面代码。
- [x] 对当前源码、macOS arm64 和同功能 Electron 分发测量压缩下载量、完整安装目录与资源构成；不同功能范围的 Tauri 试验另列。
- [ ] 将测量接入打包报告并设定轻量分发的体积预算，覆盖每个实际支持的架构。
- [ ] 验证 Web 主入口：账号设置、来源读取与业务动作、配置审阅、诊断和外部交接均可用；应用启动通过受控本地宿主能力提供，保持现有权限与来源校验。
- [ ] 迁移遗留执行调用者后，把内置 Agent SDK / CLI、PTY 等能力从轻量默认分发中拆成可选项；保留旧流程和用户数据的兼容路径。
- [ ] 审计 Web 资源重复收录、语法高亮语言范围和依赖打包；按实际用量裁剪，不把入口代码大小当作安装包大小。
- [ ] 若独立桌面窗口仍有明确需求，验证 Tauri + Node sidecar 最小方案，包括受控应用打开、目录选择、单实例、密钥存储迁移、更新与 sidecar 生命周期。

验收：比较覆盖同一条真实工作流的产物，包含所需 sidecar 和运行时；证明常用操作无需回退到旧 Electron 后，再决定默认分发。用户数据和已授权集成保持可迁移、可回滚；包体下降不以隐藏依赖或损坏旧执行调用者为代价。

## 2026-10-09：瘦身与 Tauri 验证实现

本轮 Electron 对照使用同一源码快照、依赖和 macOS arm64 架构，测量 `.app` 内普通文件逻辑字节总数（包括 `app.asar.unpacked`）与 `ditto` ZIP；不是旧版本的下载包，也不是仅 ASAR 的大小。

| 同功能 Electron 产物 | 优化前 | 优化后 | 减少 |
| --- | --- | --- | --- |
| 完整 `.app` | 697,361,591 B（665.06 MiB） | 635,011,200 B（605.59 MiB） | 59.46 MiB，8.94% |
| ZIP | 267,023,660 B（254.65 MiB） | 251,532,789 B（239.88 MiB） | 14.77 MiB，5.80% |

- [x] macOS 部署副本移除 Windows PTY prebuilds、桌面源码 / 测试 / 构建配置，保留两个 macOS 架构与执行能力。
- [x] 桌面保留一次显式 Web 资源入口；CLI 的内嵌 Web 分发不变。ASAR 已按内容去重，因此未将 Web 目录去重计作额外 12 MiB 的应用收益。
- [x] 修复已有 SDK subprocess 从 ASAR 路径启动导致 `ENOTDIR` 的打包缺陷：原生 CLI 解包至真实文件路径，SDK 使用该路径并保留配套工具 PATH。移动到 unpacked 的资源仍计入完整包体。
- [x] 实际打包后的启动 smoke、原生 PTY 命令、Codex CLI 与配套搜索工具执行通过；没有发起模型调用。
- [x] 插件市场改为进入页面时加载，完整语法高亮保留。HTML 声明的入口 JS / preload / CSS 从 1,435,811 B 降至 1,371,623 B（4.47%）；gzip 从 377,950 B 降至 362,501 B（4.09%）。完整 Web 产物增加 1,149 B，此项属于首屏优化，不是安装包缩减。
- [ ] 为配置预览验证受限语法包或上游 highlighter 注入接口。当前 File / FileDiff 组件仍依赖 Shiki 全量语言图；不通过脆弱内部 alias 裁剪，也不悄悄取消已支持的语法。

新增可选 `apps/tauri` 试验：复用 Vue 界面与共享 Node runtime，应用自带 Node 和当前架构 PTY，不依赖用户安装 Node，不携带内置 Codex SDK / CLI。试验使用独立用户数据目录，不读取或迁移现有 Electron 云设备密钥。原生桥只接收已保存的工具 ID、注册项目 ID、HTTPS 网址、目录选择与用户审阅的复制文本；共享 API 在所有路由前验证本次启动的 session，站外页面没有通用 Tauri IPC。

该试验未完成 Host extensions 恢复、云设备密钥迁移、更新、单实例、桌面协议与旧 Agent 执行路径的兼容验收。全路由 session 也不能替代 MCP 独立 credential；MCP 接入需要另行适配。Tauri 的体积结果必须注明这一区别，不作为同功能 Electron 替换率。

| Tauri 试验产物（macOS arm64） | 大小 |
| --- | --- |
| 完整 `.app`，含所有后端资源 | 145,267,191 B（138.54 MiB） |
| `ditto` ZIP | 46,610,226 B（44.45 MiB） |
| 其中自带 Node 24.18.0 | 120,965,360 B（115.36 MiB） |
| 其中 Rust 宿主 | 7,285,344 B（6.95 MiB） |
| 其中 Web 资源，含试验桥注入 | 12,384,952 B（11.81 MiB） |

Node 已占完整应用约 83%；当前最小壳层实验不能承诺几 MiB 的完整安装包。运行 `pnpm build:tauri` 可重建；试用及兼容范围见 [Tauri 说明](https://github.com/YunYouJun/craft-hub/blob/main/apps/tauri/README.md)。本地 ZIP 输出到 `release/tauri/Craft-Hub-Tauri-Trial-arm64.zip`，不纳入 Git。产物仅作本机验证，使用 ad hoc 签名，最低 macOS 13.5；实测系统为 macOS 26.6.2 arm64。

- [x] 用不含用户 Node 的 `PATH` 启动完整应用，确认总览与诊断加载。
- [x] 在实际 Tauri 窗口中选择 Sample Project，确认新增项目；输入中文与 emoji 交接目标并复制，UI 成功状态与剪贴板实际回读一致。
- [x] 使用隔离目录验证重启后项目保留；正常退出后 Rust、Node 与目录选择 helper 均无残留。
- [x] 后端实测验证 bootstrap 一次性使用、HttpOnly / SameSite cookie、Host / Origin 限制、未授权路由拒绝，以及非法 HTTP target 不崩溃。
- [x] 独立浏览器回归确认 ChatGPT 只调用一次 HTTPS 外开，Raycast / Orca 各只调用一次原生工具入口；后者不重复打开网站，无页面或 console 错误。此回归模拟原生 POST 成功，不代表目标工具实际接收上下文。
- [ ] 验证系统浏览器的最终目标页面；本轮原生 QA 未完成目标页面验收，不能将 OS 外开请求成功称为站点加载成功。
- [ ] 测量 WebView 的冷启动、内存、无障碍与渲染差异，并验证其他实际支持的架构和生产签名 / 更新链路。

本轮 lint、公开边界、TypeScript / Vue 类型检查、全量构建与 163 个文件 / 883 项测试通过；Tauri 另有原生桥测试及 bundled backend smoke。Electron 的现有执行路径与 Tauri 的轻量实验分别验证，不启用默认迁移。

当时的下一步是本记录中 P0 / P1 的交接工作流；目前交付优先级已由[软件与环境工作台路线](./machine-workbench-direction.md)接续。若工作台稳定采用外部 Agent，先完成旧执行调用者迁移并把 SDK / CLI 拆成可选能力；Tauri 先复用 Node 后端。只有自带 Node 仍超过分发预算时，再评估逐步迁移后端，避免为壳层实验重写领域逻辑。

## 本机 Node 与 Workstation 环境协作：下一步方案

此前针对已有开发环境的个人工作台，建议轻量分发优先复用经过校验的本机 Node。新机器准备场景则必须先提供独立的启动检查与引导界面，不能将本机 Node 作为工作台启动前提；目前仍保留 Electron 默认入口。按现有产物减去自带 Node 的算术估算，完整应用约 23.18 MiB；这不是已重建的外置 Node 应用或 ZIP 测量。当前 Tauri 试验仍固定启动包内 Node，没有自动探测或安装本机 Node。

Workstation 当前已管理 fnm 安装声明、Zsh 中的 fnm 初始化，以及 MCP / skills / instructions / 终端配置同步。已有 Craft Hub Host Plugin 调用其 `configuration` v1 JSON 接口，文件解释、计划、写入、备份和恢复仍由 Workstation 负责。当前接口没有 Node 运行环境探测或安装能力；Tauri 试验也尚未加载该插件。

- [x] 本机外部 Node 可行性 smoke：将后端资源复制到临时目录并排除内置 Node，用本机 fnm 的 Node 24.18.0 arm64 绝对路径及最小 PATH 启动；原生 PTY 实际命令、鉴权 / bootstrap、health / projects、页面桥接与 stdin EOF 正常退出通过。只证明同版本本机后端可用，没有生成外置 Node 版应用，也未验收其他 Node 版本 / 系统 / 架构。
- [ ] 在 Rust 宿主加入小型 Node 启动检查：支持用户指定绝对路径、已有 PATH 与受支持的版本管理器默认路径；校验实际版本、架构、后端所需 API 和原生模块加载，锁定本次启动的可执行文件。当前试验打包目标为 `node24`，先围绕已验证的 Node 24 建立验收，再扩大版本范围。
- [ ] Node 缺失或不兼容时仍能打开原生设置 / 诊断页，让用户选已有安装或查看安装方案；不因后端无法启动而直接退出。
- [ ] 区分工作台后端 Node 与项目 Node：后端启动版本保持稳定，项目命令依各自版本配置运行，切换项目不自动替换后端进程。
- [ ] 后端启动后加载现有 Workstation Host Plugin，复用开发环境配置页；增加版本化、只读的环境检查合同，报告工具路径、版本、架构与来源，不输出完整环境变量或密钥值。
- [ ] 安装 / 切换与配置同步继续通过明确的方案审阅操作完成。Workstation CLI 本身依赖 Node，不能用它作为 Node 不存在时的首个引导程序；原生检查和可用版本管理器需独立处理该阶段。
- [ ] 覆盖 Finder 与终端启动、Node 缺失 / 旧版本 / 路径失效、arm64 与 x64、多个版本管理器、项目旧 Node，以及 Workstation 不存在时的独立启动。

Tauri 的 WebView 兼容性单独验收：macOS 使用系统 WebKit，版本随系统更新，不能以本机系统通过推断最低支持版本也通过。[官方 WebView 说明](https://v2.tauri.app/reference/webview-versions/) 当前 PTY 依赖使用 Node-API，仍需实际加载验证架构及其原生依赖，不把任意 Node 版本视作兼容。[Node-API 边界](https://nodejs.org/api/n-api.html#implications-of-abi-stability)

## MyGo 调研补充：2026-10-09

已查阅官网、官方源码 `fa9e8e0` 与 [v0.3.5 发布](https://github.com/egoist/mygo/releases/tag/v0.3.5)，未编译或测量 Craft Hub 的 MyGo 产物。搜索缓存中的 v0.2.11 不是本次调研的当前版本。

| 宿主 | 界面与运行时 | 对当前 Craft Hub 的判断 |
| --- | --- | --- |
| Electron | 内置 Chromium / Node，现有 TypeScript 宿主 | 维持完整功能的兼容入口；优化后的完整安装目录仍较大 |
| Tauri | 系统 WebView / Rust 宿主；本项目另启 Node 后端 | 推荐继续验证的轻量方向，已完成本机打包与关键流程实测 |
| MyGo | 系统 WebView / Go 宿主，也支持纯 Go 原生 UI | 值得作为候选；仍需独立 Node 后端或后端迁移，没有本项目包体与流程实测 |

MyGo 的 Web 模式支持复用现有 Vue 构建；macOS / Linux / Windows 分别使用 WKWebView / WebKitGTK / WebView2，和 Tauri 具有同类系统 WebView 兼容边界。纯 Go 原生 UI 是另一种界面实现，现有 Vue 页面不会自动转成它。[官方介绍](https://github.com/egoist/mygo)、[前端合同](https://github.com/egoist/mygo/blob/fa9e8e0766119c153879e6e38f4489dc57504f99/docs/frontend.md)

MyGo 没有内置 Node 兼容后端；前端开发使用 Node / Bun 不代表现有 `node:sqlite`、进程与动态 Host Plugin 能直接调用 Go bindings。它支持用 Go `exec.Command` 启动辅助程序，因此可以沿用本机 Node 方案。官网约 7 MB 与内存指标针对示例构建，不能直接与完整 Craft Hub 的产物比较；Node、完整 Web 与后端资源仍需计入实际分发或标明外部前置要求。[辅助程序](https://github.com/egoist/mygo/blob/fa9e8e0766119c153879e6e38f4489dc57504f99/docs/distribution.md#helper-executables)、[基准范围](https://mygo.egoist.dev/benchmarks)

MyGo 已提供目录面板、剪贴板、托盘、深链、单实例、签名与更新等桌面能力。调用 Go 的边界采用来源信任和绑定方法；生产期 localhost 后端需要准确的 `TrustedOrigins` 配置，项目 trust 与命令审阅仍由 Craft Hub 执行。Tauri 另有正式的命令 capability 权限合同。[MyGo 绑定边界](https://github.com/egoist/mygo/blob/fa9e8e0766119c153879e6e38f4489dc57504f99/docs/bindings.md#who-may-call)、[Tauri capabilities](https://v2.tauri.app/security/capabilities/)

此前轻量候选为 Tauri + 本机 Node + Workstation 适配；随着新机器准备成为主流程，默认入口保留 Electron，Tauri 先验证独立引导页和同功能分发收益。MyGo 正在积极迭代，也有跨平台 GUI CI；若以后需要 Go 后端或纯 Go 原生 UI，可重新比较。现阶段优先完成软件与环境真实流程，不同时维护第三套正式宿主。

## 当前后端策略：保留共享 Node，隔离原生宿主

当前建议保留 TypeScript 编写、编译为 JavaScript 的 Node 本地后端，完成经过校验的本机 Node 接入；不因更换桌面壳而全面重写。CLI、浏览器服务与桌面复用 `CraftHubRuntime`，可执行 Host Plugin 通过 JavaScript 模块提供函数式 Provider。全面迁移需要同时处理插件合同、客户端复用、持久化、配置审阅、项目信任与执行语义。声明式 Marketplace 元数据则不等于可执行 Host Plugin，不能将两者的迁移成本混为一谈。

| 层 | 推荐职责 |
| --- | --- |
| Vue / WebView | 界面、草稿与操作反馈 |
| 共享 Node 后端 | 项目能力、来源集成、上下文、配置与信任校验、可执行插件 |
| 原生宿主 | 启动前 Node 检查、窗口、目录面板、剪贴板、原生打开及子进程生命周期 |
| Workstation | 已有配置同步与审阅；环境诊断 / 安装方案通过后续版本化合同扩展 |

原生宿主可以负责 OS 执行动作，但来源身份、参数校验、项目 trust 与业务确认必须保留明确的权威边界，不同时在两种语言里复制业务规则。当前试验仍有 Node 中的原生动作桥与 Swift 目录 helper；表中职责是目标边界，不表示所有动作已迁入 Rust。

本机 Node 方案减少增量下载与安装占用，不消除 Node 后端进程的内存或首次准备环境的成本。首先按新的工作台定位迁移或退役遗留内置执行调用者，再收敛依赖；不能为裁剪包体破坏已授权的插件与用户数据。

保留 Node 后端时，Electron 仍是合理选择。Tauri 的明确分发优势是复用系统 WebView、避免应用自带浏览器引擎；它并不自动改善 Node 后端的内存、性能或插件权限。Electron 固定随包的 Chromium / Node 版本，且当前实现完整，维护与兼容成本更可控。Tauri + 本机 Node 则要额外承担系统 WebView、环境发现、后端进程和原生桥的验收。

因此当前 Electron 默认入口继续保留，Tauri 作为小包体目标驱动的验证路线；不能仅因保留 Node 就否定 Tauri，也不能把 Tauri 称为所有条件下的最佳实践。此前 605.59 MiB 与 138.54 MiB 的差异包含 Codex SDK / CLI 等范围差别，不能全部归因于框架。

- [ ] 在相同轻量功能范围下对照 Electron 与 Tauri：两者都不带内置 Agent SDK / CLI，跑同一真实流程，比较完整包体、首次使用步骤、冷启动和内存后，再决定默认宿主。只有迁移带来的实际收益达到明确预算时，才承担正式切换成本。

只有出现明确的无 Node 安装要求、经测量无法通过模块裁剪解决的启动 / 内存瓶颈，或业务已收敛为小型原生能力且可执行 JS 插件有替代合同时，再针对具体模块评估 Rust / Go 迁移。没有这些证据时，不把重写整个后端作为瘦身前置任务。Tauri 官方支持辅助进程及 Node sidecar，但这是可用架构合同，不构成所有项目都应采用该方案的结论。[官方 Node sidecar 说明](https://v2.tauri.app/learn/sidecar-nodejs/)

自由多列布局、通用启动器、聊天会话同步、内嵌网站、交互终端和自动 worktree 不在当前路线中。只有出现已验证的未满足流程，才重新评估。
