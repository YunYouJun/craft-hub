# Agent 工作台选择与 Craft Hub 边界

> 初次调研：2026-10-08；交接合同与定位更新：2026-10-09。只采用官方文档、仓库与许可证。本机只读核对 Orca 1.4.222、Raycast 1.104.29 的安装信息，以及 Orca / Codex CLI 帮助；未安装对照测试 cmux、Superset，也未实测各产品的恢复成功率、内存或启动时间。文档支持、源码路由、安装信息和真实交接成功是不同等级的证据。

## 选择结论

继续使用 Orca 作为完整的多 Agent 编程入口；额外最值得试用的是 **cmux**，前提是希望日常工作回到原生终端、减少完整 IDE 的负担。主要使用 Codex 时，直接采用官方 App 更省一层工作区管理。Superset 适合需要 SDK/MCP 驱动多主机任务的场景，目前没有充分理由仅因功能表就从 Orca 迁移。

不要以“通用工作台已经存在”为由一次删除 Craft Hub 的全部重叠模块。先把独有业务流程导出为 CLI、MCP/API 和小型 Web 页面，再退役相应的桌面交互；保留用于 Provider、信任边界和固定命令执行的底层合同。

## Orca 已覆盖的基线

Orca 官方将产品定位为多 Agent 开发环境，覆盖独立 worktree、终端、代码审阅、浏览器和远程开发；仓库当前采用 MIT。[官网](https://www.onorca.dev/)、[许可证](https://github.com/stablyai/orca/blob/main/LICENSE)

可编程与无窗口运行也已存在：CLI 操作 worktree、终端、浏览器和自动化，`orca serve` 启动无桌面窗口的 runtime；Remote Orca Server 由服务器持有工作区与会话状态，客户端重新连接时恢复视图。SSH 远程 PTY 有租约及重连机制，仍应区分客户端退出、断网与执行主机关机。[CLI](https://www.onorca.dev/docs/cli/overview)、[CLI reference](https://www.onorca.dev/docs/cli/reference)、[Remote Server](https://www.onorca.dev/docs/remote-servers)、[SSH](https://www.onorca.dev/docs/ssh)

Skills 与 MCP 已是正式扩展入口。因此，Craft Hub 不宜再以“跨 Agent、跨项目、可脚本化、headless”作为独有价值，也不应仅因缺少传统插件市场就认定 Orca 无法接入私有能力。[Skills / MCP](https://www.onorca.dev/docs/cli/skills)

## Raycast 已覆盖的快捷入口

Raycast 已有现成的个人工具入口：Pins 把网址、应用、目录和命令放进分组 List / 菜单栏；Repository Manager 发现本地 Git 项目并提供收藏、编辑器和终端入口；Todoist 提供 `My Tasks`、过滤器和菜单栏待办。因此，网址收藏、项目列表、热键和单一服务的待办列表，都不足以单独支撑 Craft Hub 的定位。[Pins](https://www.raycast.com/HelloImSteven/pins)、[Repository Manager](https://www.raycast.com/francesco_mecchi/repository-manager)、[Todoist](https://www.raycast.com/doist/todoist)

这些插件不会自动合成同一首页。定制 Raycast 扩展可以把数据放进 List 分组或 Grid，并调用其他命令，但 UI 使用受支持的原生组件，没有 HTML / CSS 自由布局。差异化仍需来自真实跨系统流程，而不是另做卡片、List 或 Grid。[UI 合同](https://developers.raycast.com/api-reference/user-interface)、[FAQ](https://developers.raycast.com/misc/faq)、[命令调用](https://developers.raycast.com/api-reference/command)

## 外部交接：验证过的合同

| 目标 | 有证据支持的入口 | 不应推断的能力 |
| --- | --- | --- |
| Raycast 应用 | 本机安装信息：应用名 `Raycast`，bundle ID `com.raycast.macos`；可由系统应用启动入口唤起 | 唤起应用并不代表某个命令接收了项目或待办 |
| Raycast 命令 | 官方 `raycast://extensions/<author-or-owner>/<extension-name>/<command-name>`；从实际 manifest 或 `Copy Deeplink` 获取 | 不能从可见标题猜 command name；命令必须安装且启用；正式 query 的存在不代表接收方会解释任何上下文 |
| Orca 应用 / runtime | 官方及本机帮助：`orca open [--json]`，没有项目路径参数；本机应用名 `Orca`，bundle ID `com.stablyai.orca` | 启动应用不等于打开指定仓库、创建会话或执行目标 |
| Orca 项目注册 | `orca repo add --path <path> [--json]`，注册仓库并改变 Orca 状态 | 注册仓库不等于选择或展示该项目；本次未执行此写操作 |

Raycast 官方支持 query `launchType`、`arguments`、`context` 和 `fallbackText`；其中 arguments / context 是 URL 编码的 JSON，传入字段还需接收方命令合同。官方也说明 deeplink 调用会要求确认。第一版只接受无 query / hash 的命令链接，不开放后台启动或任意上下文参数。[Deeplink 合同](https://developers.raycast.com/information/lifecycle/deeplinks)

Raycast 扩展内部的 `open(target, application?)` 能打开文件、目录或 URL，并指定应用名、bundle ID 或应用路径；`getApplications` 可查询安装信息。这是扩展开发 API，不是 Craft Hub 已能直接调用的远程执行服务。[Application / open API](https://developers.raycast.com/api-reference/utilities)

Orca 已注册 `orca` URL scheme；当前官方 `open-url` handler 和本机打包代码只把 URL 交给 skill-share parser，接受 `orca://skills/share/<id>`。官方配对 payload `orca://pair?code=...` 也不是项目路由。没有查到打开具体项目或已有工作区的正式 deeplink，因此不能构造 `orca://open?path=...`，也不能把 `open -a Orca <directory>` 称为 Orca 项目交接合同。[URL handler](https://github.com/stablyai/orca/blob/main/src/main/index.ts#L91-L97)、[parser](https://github.com/stablyai/orca/blob/main/src/shared/skill-share-link.ts#L13-L15)、[命令参考](https://www.onorca.dev/docs/cli/reference)

CLI 的 `worktree create --repo id:<repoId> --name <name> --activate --json` 可以新建并显示工作区，但会创建 checkout 和终端，可能执行项目 hooks；`terminal switch --terminal <handle> --json` 则依赖已查询到的 Orca runtime handle。它们不能降格为“普通打开项目”。本次只执行帮助与版本查询、读取安装信息和打包代码，没有启动应用、注册仓库或新建 worktree。具体上下文注入仍需验证接收路由、输入及可观察结果；首版只提供固定应用启动和手动复制。[命令规格](https://github.com/stablyai/orca/blob/main/src/cli/specs/core.ts#L64-L105)、[终端切换](https://github.com/stablyai/orca/blob/main/src/cli/specs/core.ts#L223-L231)

## 三个值得比较的替代方案

| 方案 | 相对 Orca 优先选择的条件 | 需要接受的边界 |
| --- | --- | --- |
| **cmux** | 更喜欢终端和自行组合工具；macOS 原生 UI 是重要诉求 | 工作区主要组织终端与浏览器；worktree 流程需要结合 Git 和自定义命令验证 |
| **Codex 官方 App** | 主要任务都交给 Codex；希望统一聊天、审阅、Skills 与远程任务 | 产品体验围绕 Codex；不把它当作不同厂商 Agent 的通用管理器 |
| **Superset** | 需要从 CLI、TypeScript SDK、MCP 批量操作任务与多主机；接受其服务和许可模式 | 与 Orca 重叠较多；ELv2 为 source-available；自动化有付费门槛 |

### cmux：最值得额外试用的终端方案

官方源码说明使用 Swift / AppKit 与 libghostty，提供垂直工作区、分屏、Agent 通知和嵌入浏览器；CLI / Unix socket 可创建工作区、发送输入、读取屏幕和自动化浏览器。项目命令可通过 `cmux.json` 声明。原生实现是值得测试的理由，不能据此声称其内存一定比 Orca 少。[README](https://github.com/manaflow-ai/cmux)、[CLI API](https://cmux.com/docs/api)、[自定义命令](https://cmux.com/docs/custom-commands)

恢复分两层：普通恢复重建布局、cwd 和尽力恢复的 scrollback；支持的 Agent 通过 hook 保存原生 session ID 后执行 resume。保持进程在线要另用 local tmux 或远程持久会话；SSH tmux 原生镜像仍标为 beta，重启后需要重新连接。[恢复文档](https://cmux.com/docs/session-restore)、[local tmux](https://github.com/manaflow-ai/cmux/blob/main/docs/local-tmux.md)、[远程 tmux](https://cmux.com/docs/remote-tmux)

SSH 支持远程浏览器网络、文件上传与重连；也提供 Mosh 选项。应用及 CLI 的默认许可证为 GPL-3.0-or-later，但列出的服务器与 relay 目录采用 BSL 1.1，生产自托管需要其商业许可。把 cmux 作为独立客户端，与把其代码并入 Craft Hub 是不同选择。[SSH](https://cmux.com/docs/ssh)、[许可证](https://github.com/manaflow-ai/cmux/blob/main/LICENSE)

### Codex 官方 App：主要使用 Codex 时直接采用

官方 OpenAI 文档提供项目与聊天组织、Git worktree 并行、Local / Worktree 交接，以及 SSH 远程项目和跨主机 Handoff。插件可携带 Skills、MCP 和 runtime hooks。它有理由成为 Codex 工作的主入口，但这些能力不证明其他厂商 CLI Agent 也有同等管理体验。[项目](https://learn.chatgpt.com/docs/projects)、[worktree](https://learn.chatgpt.com/docs/environments/git-worktrees)、[远程](https://learn.chatgpt.com/docs/remote-connections)、[扩展](https://learn.chatgpt.com/docs/skills-and-plugins)

本机 CLI 帮助已包含 `exec`、`agents`、`resume`、`fork`、`--worktree` 与 `app-server`。官方将 app-server 用于富客户端的历史、审批与事件集成，将 SDK 用于自动化和 CI。Craft Hub 可以调用它们，但不需要重建完整 Codex 客户端；也不能把开源 app-server 的许可等同于整个桌面 App 的许可。[App Server](https://learn.chatgpt.com/docs/app-server)

### Superset：需要可编程任务管理时比较

官方文档提供隔离 worktree、持久终端后台 daemon、diff review、主机注册与远程访问。CLI 可无窗口启动 host server，SDK 与 MCP 可创建工作区、启动 Agent、读写终端和管理自动化。这些明确的接口适合由外部业务入口派发任务。[概览](https://docs.superset.sh/overview)、[FAQ](https://docs.superset.sh/faq)、[CLI](https://docs.superset.sh/cli/cli-reference)、[SDK](https://docs.superset.sh/sdk/reference)、[MCP](https://docs.superset.sh/mcp-server)

但 Orca 也有 headless runtime 和 CLI，不能仅凭“可编程”判定 Superset 更好。Superset 当前采用 Elastic License 2.0，官方明确不属于 OSI 开源；创建、运行和恢复自动化需要 Pro / Enterprise，目标 host 必须在线且连接 relay。它更适合愿意采用此服务模式的用户。[许可证](https://github.com/superset-sh/superset/blob/main/LICENSE.md)、[官网许可说明](https://superset.sh/)、[自动化合同](https://docs.superset.sh/sdk/reference)

## 对 Craft Hub 定位的影响

定位细化为 **把跨 Provider 待办、项目上下文和外部工具交接连起来的个人开发工作台**。持续总览回答“哪些事项需要我处理、关联哪个项目、接下来交给哪个工具”；Raycast 负责快捷打开，Orca 或其他编码工作台负责执行和会话。Provider 保持工作项权威，Craft Hub 通过 CLI、MCP/API 和聚焦页面提供项目能力、上下文审阅与原生业务动作。

已有 `/overview`、保存在 OS 设置的工具分组和项目收藏，以及真实 `work-items.list` 只读预览。预览只接受无需确认的全局读取；按来源的精确账号 ID 筛选未完成事项，来源失败互不冒充成功。它仍是各来源的部分预览，尚未实现所有来源的完整查询、分页、项目关联和任务闭环。

当前外部委托切片：从事项或项目选择本机项目、补充目标、预览 / 复制文本，再显式打开 Raycast 或 Orca。工具保留 HTTPS 网站回退。启动结果报告 `contextTransferred: false`，不能显示“Agent 已执行”或“目标工具已接收”。浏览器与未安装应用需要明确降级；网站导航继续只接受 HTTPS，外部执行入口另用受限适配器。

接下来优先验证真实闭环：精确工作项 → 经确认的项目与能力上下文 → 外部工具接收 → 返回摘要 → Provider 原生状态动作。跨 Provider 的统一筛选、项目关系和交接证据有维护价值；单纯收藏夹、项目按钮和第二套任务数据库没有足够理由继续扩张。具体待办、阶段与验收记录在[工作台路线](../design/workbench-direction.md)，职责与持久化边界见 [ADR 0010](../adr/0010-personalize-the-persistent-workbench-overview.md)。

退出通用终端、多 Agent 会话、worktree 管理、浏览器、Git diff 和 Agent 自动化 UI 的竞争。移除旧执行路径仍须遵守 [ADR 0009](../adr/0009-focus-on-project-capabilities-and-integrations.md) 的调用迁移顺序。后续依据真实闭环中返回 Craft Hub 的原因评估桌面宿主，不把“具备接口”当作已经解决工作流。
