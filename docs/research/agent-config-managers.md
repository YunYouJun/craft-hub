# Skills / MCP 全局管理工具与 Craft Hub 边界

> 调研日期：2026-10-13。依据官方仓库、发布记录、文档和当前本地代码；未安装候选工具，未修改 Agent 配置，未实测同步、恢复或客户端兼容性。功能文档、已发布版本和本机实测是不同等级的证据。

## 选择结论

未使用同类管理器时，日常图形界面可优先试用 CC Switch；声明式 Skills + MCP 同步可评估 Skillshare；只找和安装 Skills 则使用 Vercel Skills。已有管理器和安装器时，应先核对归属，不同时接管同一份配置。

2026-10-13 后续评估补充：Magpie 的 Library 已支持 MCP / Skills 分发；结合 Workstation 现有 APM 与配置管理，暂不建议再安装 CC Switch 或默认迁移到 Skillshare。集成实测、现有能力缺口和最小方案见 [Skillshare / Workstation 接入评估](./skillshare-workstation-integration.md)。

Craft Hub 已有 Workstation 配置管理接入，适合继续完善来源、归属、客户端作用域、差异和恢复体验。没有充分理由重新实现一个包含市场、安装器、同步引擎、账号、代理、会话管理的通用产品。社区 CLI 可成为 Workstation 后面的可选适配器，先验证合同，再决定复用范围。

## 推荐候选

| 工具 | 最适合的需求 | 已核对的边界 | 分发与维护证据 |
| --- | --- | --- | --- |
| **CC Switch** | 跨客户端 MCP / Skills 图形化管理，同时需要供应商切换 | v4.0.10 支持 Claude Code、Codex、Gemini CLI、Grok Build、OpenCode、Hermes、Pi、MiniMax Code 的 MCP / Skills；Claude Desktop 与 OpenClaw 不能从“支持十种工具”推断为同等能力 | MIT；macOS / Windows / Linux；v4.0.10 正式版于 2026-10-12 发布。[版本功能表](https://github.com/farion1231/cc-switch/blob/v4.0.10/README.md#supported-features-by-tool)、[发布](https://github.com/farion1231/cc-switch/releases/tag/v4.0.10)、[许可](https://github.com/farion1231/cc-switch/blob/main/LICENSE) |
| **Skillshare** | 用文件与 Git 管理全局 / 项目 Skills，并同步原生 MCP 配置 | 当前 MCP 已是正式功能；支持选定目标、导入、预览与恢复；不接管 OAuth 会话、凭据库或插件自带 MCP | MIT；Go CLI，另有 UI / 桌面项目；0.25.x 在 2026 年 10 月仍持续发布。[版本 README](https://github.com/runkids/skillshare/blob/v0.25.8/README.md)、[MCP 合同](https://skillshare.runkids.cc/docs/reference/commands/mcp/)、[发布](https://github.com/runkids/skillshare/releases) |
| **Vercel Skills** | 搜索、安装、更新 Skills；保留客户端原生发现机制 | 可选 Agent 与全局 / 项目安装；支持链接 / 复制；没有原生 MCP 配置管理命令 | MIT；`npx skills`；本次 main 的包版本为 1.7.2。[仓库](https://github.com/vercel-labs/skills)、[包信息](https://github.com/vercel-labs/skills/blob/main/package.json) |
| **mode-io/skill-manager** | 参考统一清单、纳管与逐客户端开关的 UI | macOS / Linux 当前文档包含 Skills / MCP / slash commands；OpenClaw MCP 未支持；Windows 首期只支持 Codex Skills | MIT；Homebrew / npm 本地应用；公开最新发布 v0.3.1 为 2026-05-19，不能将 main 的全部新功能当作已发布能力。[README](https://github.com/mode-io/skill-manager)、[发布](https://github.com/mode-io/skill-manager/releases/tag/v0.3.1)、[许可](https://github.com/mode-io/skill-manager/blob/main/LICENSE) |

### CC Switch：立即使用的 GUI 首选

已发布 README 提供现有 MCP 导入、按客户端开关，以及 Skills 仓库 / ZIP 安装、更新、链接或复制。它也管理供应商、用量和会话，因此比纯配置管理器更宽；这一广度是选择条件，不代表每项都需要启用。[v4.0.10 功能](https://github.com/farion1231/cc-switch/blob/v4.0.10/README.md#mcp-prompts--skills)

macOS 官方当前安装方式是 `brew install --cask cc-switch`，也可从官方 Releases 获取安装包。官方文档说明 macOS 包为签名、公证的 Universal 构建。版本变化快，安装前应看当前正式发布，不能根据搜索缓存把早期 4.0 预览或 3.20 当作最新版。[安装说明](https://github.com/farion1231/cc-switch#download--installation)、[正式发布](https://github.com/farion1231/cc-switch/releases/latest)

### Skillshare：最值得评估的同步底座

Skillshare 的全局来源目录与项目 `.skillshare` 支持文件 / Git 工作流；MCP 管理有全局、项目、目标选择、`--dry-run`、`--json` 和版本检查。它比另写一个多格式转换器更值得先做隔离验证。[版本 README](https://github.com/runkids/skillshare/blob/v0.25.8/README.md)、[MCP 命令](https://skillshare.runkids.cc/docs/reference/commands/mcp/)

重要限制：配置文件软链接会阻止写入；TOML 非普通表写法有兼容边界；Codex 插件里的 `plugins.*.mcp_servers` 不在纳管范围；`sync --all` 不是一个全目标原子事务。`mcp check` 默认静态读取，`--live` 才启动或连接服务。对于已有 dotfiles 与安装器，应先核对这些边界。[MCP 兼容与写入合同](https://skillshare.runkids.cc/docs/reference/commands/mcp/)

CLI 可按官方说明使用 `brew install skillshare`；独立桌面版通过 `runkids/tap` 分发。不同页面本次出现 0.25.x 小版本差异，因此只确认“10 月仍在发布”与 v0.25.8 已含 MCP，未宣称唯一最新小版本。[安装](https://github.com/runkids/skillshare#installation)、[桌面项目](https://github.com/runkids/skillshare-app)、[发布](https://github.com/runkids/skillshare/releases)

## 其他候选为何不作为综合首选

- **MCP Manager / mcpmgr**：MIT，v0.2.0 于 2026-09-30 发布。GUI 与 CLI 共用 Rust 核心，CLI Preview 有 `--json`、`--dry-run`、全局 / 项目与 rollback，适合评估 MCP 专项后端；没有 Skills 管理。CLI 仍标 Preview，接入需要固定版本与验证输出合同。[README](https://github.com/xjeway/mcp-manager#command-line-preview)、[发布](https://github.com/xjeway/mcp-manager/releases/tag/v0.2.0)、[参数源码](https://github.com/xjeway/mcp-manager/blob/main/crates/mcp-manager-cli/src/cli.rs)
- **vsync**：MIT，面向 Claude / Cursor / OpenCode / Codex 的 Skills、MCP、Agents、Commands 来源到目标同步。安全模式主要限制删除，目标的人工改动仍可能被覆盖；适合单向分发，不能直接当冲突协调器。README 的 1.2 与公开发布 1.1.0 不一致；没有核对到稳定 JSON / library 接口。[同步模式](https://github.com/nicepkg/vsync#sync-modes)、[FAQ](https://github.com/nicepkg/vsync#faq)、[发布](https://github.com/nicepkg/vsync/releases)
- **EnjoyableWork/mcp-sync**：MIT，v0.1.1 于 2026-08-13 发布；针对六种客户端的全局、本地 STDIO MCP 配置，提供预览、锁、备份与恢复。范围较窄，不覆盖 Skills、Claude Code、远程 OAuth 或项目层。官方发布也区分 fixture 验证与真正客户端 smoke，不能把六目标支持等同于六目标都已实测。[合同](https://github.com/EnjoyableWork/mcp-sync)、[发布及验证边界](https://github.com/EnjoyableWork/mcp-sync/releases/tag/v0.1.1)
- **ccckfg/agent-skills-manager**：Skills 导入、链接 / 复制与 TUI；其程序对 MCP 只做只读盘点。文档列 22 个 Agent，但这不能解释为 22 个客户端都有 MCP 写入适配。本次公开 Releases 页没有发布包。[边界](https://github.com/ccckfg/agent-skills-manager#mcp-为什么只读)、[发布记录](https://github.com/ccckfg/agent-skills-manager/releases)
- **OpenSkills**：Apache-2.0；适合依赖 `AGENTS.md` 索引的兼容工作流。`sync` 写入的是索引，不是跨客户端 MCP / 配置同步；`--universal` 使用单数 `.agent/skills`，不要与 `.agents/skills` 混淆。[README](https://github.com/numman-ali/openskills)

这些项目的“global”主要指一台机器的用户级位置。跨设备恢复、团队分发、项目覆盖和客户端登录是另外的能力，需要逐项检查，不能由“全局管理”推出。

## Craft Hub 已有实现与应保留的职责

当前代码已经有 [`craft-hub-plugin-workstation`](../../packages/craft-hub-plugin-workstation/src/index.ts)，通过版本化 JSON 调用 Workstation，包含 inspect、history、git-status、preview、apply、restore 与 Git 动作；进程调用使用固定 executable / args 与 `shell: false`。这是已有实现，不再只是计划。

现有[配置管理指南](../guide/workstation-configuration.md)覆盖 MCP、Skills、全局指令和终端配置；Installed / System Skills 与项目覆盖不能被全局同步覆盖。链接、系统根、Codex 插件缓存和安装器锁继续归原安装器。[机器工作台方向](../design/machine-workbench-direction.md)也明确复用 Workstation 的计划 / 备份，不实现第二套合并引擎。

建议继续分工：

1. **Craft Hub 展示和审阅**：按资源与客户端看来源、路径、作用域、归属、生效状态、差异、冲突与恢复记录。把“没有发现”“不支持”“安装器管理”“不可写”分别说明。
2. **Workstation 保存同步权威**：负责源连接、计划、版本校验、备份、执行与恢复。若接社区 CLI，由它持有固定版本适配器；同一份原生配置只指定一个写入责任方。
3. **社区工具负责其擅长的安装 / 更新**：先提供明确入口或结构化适配；市场与依赖获取不必复制进 Craft Hub。纳管前记录原安装器，避免移动系统 / 插件资产或破坏锁文件。

这不是“全部采用社区工具”与“自己重做全部”的二选一。合理的下一步是用 CC Switch 对照日常 UI，隔离验证 Skillshare 的输出和配置边界，再补当前开发环境插件真实缺少的部分。若社区合同不能承载已有归属与恢复要求，继续用 Workstation 的现有实现，只借鉴交互。

## 接入前的最小验证

使用临时 HOME / 配置根和 fake 客户端：检查未知字段及注释保留、同名冲突、项目优先级、原生文件漂移、插件 / 系统归属、软链接拒绝、失败后恢复、secret 脱敏与升级输出兼容。MCP 盘点不能自动启动服务器；Skills 发现不能执行附带脚本。只有证明这些合同后，才应让适配器处理真实配置。

本次仅形成调研记录；上述接入和安装均未执行。
