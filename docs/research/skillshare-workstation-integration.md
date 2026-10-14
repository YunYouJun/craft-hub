# Skillshare / Workstation 集成评估与最小落地方案

> 2026-10-13。基于当前本地代码、官方源码和固定版本临时 fixture。本次只新增此文档并补充前一份调研结论；没有安装全局工具、读取真实 Agent 私有配置、修改产品代码或纳管真实配置。

2026-10-13 实施补记：第一期已在两个仓库接入 Workstation Skills audit、客户端 / 作用域 / 管理器 / 来源证据、原工具文档和 Magpie 打开入口。Craft Hub 复用配置预览、应用和恢复；Workstation 增加归属锁与恢复时的安装器接管保护。仍只盘点 Codex / 共享 Skills 和选定项目，未引入 Skillshare、未安装 CC Switch，也未纳管真实配置。使用说明见 [开发环境配置](../zh/guide/workstation-configuration.md)；下文的第三方评估记录保留为历史证据。

## 结论

**保留 Workstation 为 Craft Hub 的配置执行边界；首期补齐现有盘点、归属和诊断，不让 Skillshare 默认接管 MCP / Skills。** Skillshare 是有价值的多客户端适配候选，但不能直接替换现有审阅合同。公共 Skills 生命周期已经由 APM 负责；Magpie Library 也能管理 MCP / Skills，再增加默认写入者会制造新的同步冲突。

Skillshare 的合理位置是 **Workstation 内的可选适配器**。先检查固定版本、按用户选择的源做只读报告；后续仅为明确分配给它的客户端 / MCP 条目提供写入。Craft Hub 通过可信宿主接入具体工具的状态与动作，不把第三方原生状态文件当作自己的可写数据库。软件打开沿用现有能力，不要求所有工具的业务操作都经过 Workstation。

## Skillshare：文档承诺与隔离实测

### 版本与范围

本次固定 **v0.25.10**，从 [官方发布](https://github.com/runkids/skillshare/releases/tag/v0.25.10)下载 `skillshare_0.25.10_darwin_arm64.tar.gz`，并与同一发布的 `checksums.txt` 比对 SHA-256：

```text
1f6ada0546d4007d6520fb063e8f2dcb00f3e1833a26845ed7a96f8f59cfd46f
```

二进制仅解压到临时目录，不进入 PATH。所有子进程使用显式最小环境：临时 HOME、XDG config/state/data/cache、CODEX_HOME、CLAUDE_CONFIG_DIR、SKILLSHARE_CONFIG；工作目录也是 fixture。没有使用真实凭据，没有运行 Skills 脚本、MCP 服务器、`--live`、UI 服务或 Git 远端动作。系统客户端是否实际加载仍未验证。

fixture、二进制、固定版本源码、校验文件及每次 stdout 留在系统临时目录中的 `craft-hub-skillshare-eval-*`；其 `reproduce.py` 可另建一套隔离 fixture 重现关键合同。临时文件不进入仓库，不作为长期验收资产。

官方 [MCP 命令](https://skillshare.runkids.cc/docs/reference/commands/mcp/)支持 portable 定义、按客户端选择、JSON 预览、revision、所有权与恢复；MCP 不负责 OAuth / 密钥库。原生 MCP 文件软链接会阻止写入。[Skills 同步](https://skillshare.runkids.cc/docs/reference/commands/sync/)则支持 merge / copy / symlink，保留外部目录链接，默认 merge 保留同名真实本地目录。两者的计划、写入和恢复合同应分开适配。

### 三组决定性 fixture

| 用例 | v0.25.10 观察 | 对接含义 |
| --- | --- | --- |
| MCP 定点写入与漂移 | Codex TOML 的顶层注释、model、无关 server、plugin MCP，以及 OpenCode JSONC 注释 / 无关设置均保留。只改 model 后旧 MCP revision 仍可应用；改已纳管 server URL 后旧 revision 被拒绝，重新预览为 conflict，恢复也拒绝覆盖较新的条目 | MCP 合同可复用；revision 基于 MCP 相关状态，并非整文件锁；与 Workstation 的完整快照语义不同 |
| MCP 原生文件链接 | 将 fixture `config.toml` 链接到 fixture dotfiles 后，预览退出 1；链接及目标内容未改变 | 若目标由 dotfiles 链接管理，不能直接交给 Skillshare MCP；首期显示不可写与所属管理器，不迁移路径 |
| Skills 归属与计划 | 外部 Skills 根目录链接、同名真实本地目录均保留；但同名 Skill 条目链接到假 plugin cache 时，默认 merge **在没有 `--force` 的情况下重指向 Skillshare 源**并登记到自己的 manifest。dry-run JSON 只有计数。普通 Skills sync 接受并忽略 `--revision invalid`，退出 0 | 不能把“支持软链接”理解成“保护所有安装器链接”；APM、skills.sh、plugin cache、Workstation 链接必须先排除。现有精确计划 / apply 不能直接包裹普通 Skills sync |

最后一项与固定版本的 [merge 实现](https://github.com/runkids/skillshare/blob/v0.25.10/internal/sync/sync.go#L619)一致：同名链接指向其他位置会被当作需要修正的链接；[参数解析](https://github.com/runkids/skillshare/blob/v0.25.10/cmd/skillshare/sync.go#L520)只处理已知布尔标记，其余参数没有形成 revision 保护。本次只证明 fixture 行为，不推断未来版本或全部模式行为。

链接观察（路径均在临时 fixture HOME 内）：应用前 `.codex/skills/plugin-owned → .codex/plugins/cache/fixture`；应用后同一条目变为 `→ .config/skillshare/skills/plugin-owned`，原 fake cache 内容仍在，变的是客户端链接及归属。因此不能通过通用参数透传把 `--revision` 当作所有资源的保护机制。

实际运行的命令（均带 `-g`）包括：

```text
skillshare version
skillshare status --json
skillshare list --json
skillshare sync --dry-run --json
skillshare sync mcp --dry-run --json
skillshare sync mcp --json --revision <preview-revision>
skillshare mcp restore <backup-id> --dry-run --json
skillshare sync --json                 # 仅对临时 Skills fixture 应用
skillshare sync --dry-run --json --revision invalid
```

还有一个接口细节：`--json` **不保证失败时 stdout 只有 JSON**。MCP conflict 预览输出 JSON 后继续输出人类错误提示；stale revision / 文件软链接拒绝则输出纯文本。适配器必须同时检查 exit code、可验证 JSON 与尾部输出，错误时禁止应用，脱敏后显示原因。`status` / `list` JSON 与 Skills dry-run 的结构也不相同，需按命令、版本解析；没有观察到统一版本化的 JSON envelope。

MCP 成功 apply 返回 `plan`、`applied` 与 `backupIds`；恢复按操作中的条目处理，而非覆盖整个文件。源码 [MCP write](https://github.com/runkids/skillshare/blob/v0.25.10/internal/mcp/write.go)与 [restore](https://github.com/runkids/skillshare/blob/v0.25.10/internal/mcp/restore.go)可作为后续适配合同依据。不要使用 `sync --all` 作为跨资源原子事务，也不要在 Workstation 恢复与第三方恢复之间隐式切换。

## 现有 Workstation / Craft Hub 能力与缺口

[Workstation 本地 Configuration API v1](https://github.com/YunYouJun/workstation/blob/main/docs/guide/configuration-api.md)已经有稳定 JSON envelope、inspect、精确 preview / apply、baseline、来源 / 本机冲突、执行前版本检查、备份 journal 和保护后续编辑的 restore。Craft Hub 的 [Host Plugin](../../packages/craft-hub-plugin-workstation/src/index.ts)已经接通这些操作；[配置展示合同](../../packages/craft-hub/src/configuration-management.ts)与 [界面](https://github.com/YunYouJun/craft-hub/blob/main/apps/web/src/ConfigurationManager.vue)可以沿用。

[Workstation Agent Skills 指南](https://github.com/YunYouJun/workstation/blob/main/docs/en/guide/codex-skills.md)明确 APM 是公共 Skills / 项目标准 MCP 的生命周期权威。现有 `wst skills audit --json` 检查 APM manifest / lock、skills.sh lock、Workstation provenance lock、哈希漂移、共享与项目根、重复名、无效元数据和 implicit / explicit-only；私有本地 Skills / Codex MCP 另有已有写入流程。新方案应接入这些能力。

当前 audit 返回 summary / findings，并非已经暴露完整逐 Skill 来源清单。新增 inventory 应复用现有 discovery / lock readers 补齐条目元数据，再合并 audit findings；不得把 summary 直接宣称为跨客户端生效清单。

| 当前状态 | Craft Hub 实际缺少的连接 / 展示能力 |
| --- | --- |
| 有 Codex 全局 MCP 与指定私有片段的配置审阅 | 跨客户端矩阵；原生与 plugin MCP 的独立归属；作用域、源、是否生效 / 被覆盖的明确解释 |
| 有用户 / 项目 / installer 大类及不可写提示 | APM / skills.sh / Workstation / native plugin / Magpie / unknown 的可解释 manager 元数据；外部未知资产禁止凭猜测纳管 |
| Workstation 已有丰富 Skills audit | audit 未形成当前 Craft Hub 配置协议中的版本化诊断视图；需要显示重复、锁 / 哈希问题和 explicit-only 状态 |
| 配置页已有手动差异选择、预览、恢复 | 尚无通用新增 / 安装 / 更新 / 逐客户端分发闭环；这些不必都放进第一期 |
| Craft Hub Marketplace Skills 有自己的 plugin / project 引用模型 | 它管理的是 Craft Hub Marketplace Plugin Skills；不是 Codex 全局安装器，应与外部 Agent Skills 清单分开解释 |

上述缺口区分“底层没有”和“已有但 UI 未接入”。首期不重复实现安装器、锁解析器或合并引擎。

## 软件复用与职责分工

复用原工具完成已有专业操作，Craft Hub 补跨工具衔接，Workstation 管本机环境、配置来源与恢复。Workstation 不作为所有第三方 GUI / CLI 的通用包装层；新增适配必须解决具体缺口。

| 归属 | 继续复用的职责 | Craft Hub 如何连接 |
| --- | --- | --- |
| Magpie | 模型、供应商、账号、路由、用量，以及 Library 已管理的 MCP / Skills | 首期检测并打开原工具；有稳定接口后才补可选只读状态 |
| APM | 公共 Skills / 项目标准 MCP 安装、更新与锁文件 | 先展示 Workstation 已有审计结果及原管理入口；保留 manifest / lock 权威 |
| skills.sh / Agent plugin installer | 各自安装资产的生命周期 | 展示来源与归属；安装、更新交给原工具 |
| Workstation | 软件目录 / 安装、本机诊断、私人配置源、配置预览 / 应用、备份恢复 | 现有 Host Plugin 与版本化合同；复用 Skills audit |
| Craft Hub | 状态汇总、项目关联、打开工具、跨来源归属解释、准备 / 恢复步骤的展示和导航 | 扩展既有页面与插件，主应用保持通用合同 |
| Skillshare | 现有工具确实缺少的多客户端分发 | 可选 Workstation 适配；第一版不要求安装，不迁移已有资产 |

接入按三层推进：

1. **打开原工具**：沿用软件中心的检测 / 打开合同，工具未安装时提供官方安装入口。这一层不需要复制原软件界面或重造管理接口。
2. **读取状态**：优先使用稳定、结构化的只读合同，经可信宿主转换为有限的展示数据，标记来源、观察时间和支持范围。接口未验证时只提供原工具入口，不抓取人类文本或读写内部数据库。
3. **执行选定动作**：原工具仍拥有动作及恢复记录；只有具体接口能够保留现有计划与归属合同，才从 Craft Hub 提供审阅后执行。各工具的备份和恢复按来源呈现，不承诺跨工具统一事务或回滚。

Craft Hub 值得补的能力：

- **项目准备检查**：以项目声明为依据，关联所需软件、运行时、MCP / Skills，区分已发现、配置引用、客户端确认加载和未验证，指向实际负责处理的工具。现有全局清单不等于客户端已经生效；配置恢复不授予项目执行信任。
- **跨管理器归属与冲突解释**：把同名资源、全局 / 项目覆盖和管理器归属放在同一处解释；归属不明保持 unknown。同一文件可容纳多个管理器，同一条目 / 字段只有一个写入者。
- **换机恢复衔接**：把安装软件、回放原安装器的声明、恢复终端 / 用户 Agent 配置、重新绑定项目路径、重新检查连起来。Workstation 负责它管理步骤的计划和记录，Craft Hub 展示下一步与各来源结果；账号登录、令牌及第三方恢复继续由原工具负责。

例如一个由 APM 安装的 Skill 出现重复：Craft Hub 展示重复路径、来源和诊断 → 定位负责的安装器 → 使用原工具处理 → 刷新 Workstation 审计。只有属于 Workstation 的用户配置冲突才进入其现有差异预览与恢复。初期不必为 APM 新造安装按钮。

## 最小落地方案

**范围：macOS 现有开发环境页，Codex MCP + `.agents` / `.codex` Skills 的盘点与诊断，选定项目只读。** 保留已有 diff → preview → apply → restore；只有已经纳管的用户资源可执行。这里显示可发现的配置 / 文件和覆盖诊断，不承诺全部客户端已经加载或执行成功。

1. **Workstation 扩展只读协议**：为既有 `inspect` 响应增加可选诊断，内部调用现有 Skills audit。当前 item 可选增加 `client`、`scope`、`manager`、`provenance`；现有 `source` 仍为脱敏展示内容，不改变其类型。归属不能确认时标记 unknown；避免把外部状态里的 raw 值、凭据或任意执行命令透出。
2. **Craft Hub 接入和展示**：沿用配置页已有 MCP / Skills 筛选，增加客户端、作用域、管理器筛选及元数据，显示 audit 结果和“原管理器维护”的原因。外部资产只提供打开配置路径或所属工具；不移动目录、不新增默认同步源。
3. **保留现有执行责任**：APM 维护公共 Skills / 项目 MCP；skills.sh 和 plugin installer 保留自身资产；Workstation 管已有用户配置与私有资产；Magpie Library 自己部署的条目交还它维护。所有权以资源 / 字段界定，同一个文件可以容纳多个管理器，**同一字段只能指定一个写入者**。
4. **Skillshare 后置为可选适配器**：第一步只读固定版本、list/status、静态 MCP check（`--no-dns`）与用户明确选择的源 dry-run；不默认执行 init/import/collect/sync。后续写入仅开放选定 MCP 条目 / 客户端，先验证精确 changed paths、revision、owner 隔离、partial failure 与第三方 backup ID 映射。Skills 分发暂缓。

最小改动地图：

| 仓库 / 文件 | 拟做改动 |
| --- | --- |
| Workstation `packages/cli/src/configuration/model.ts`、`protocol.ts`、`engine.ts` | 增加只读 inventory / audit 合同及元数据；调用 `skills.ts` 中已有 audit |
| Craft Hub `packages/craft-hub/src/configuration-management.ts` | 扩展只读展示类型与可选诊断；保持失败 / 不支持 / 无数据的区别 |
| Craft Hub `packages/craft-hub-plugin-workstation/src/index.ts` | 校验并转发扩展的只读响应；旧 CLI 缺少诊断时标记不支持，保持 `shell: false` 与版本校验 |
| Craft Hub `apps/web/src/ConfigurationManager.vue` | 复用现有页呈现来源、归属、诊断和所属工具入口 |

验收：未安装第三方管理器时盘点仍可用；fixture 能区分 APM、skills.sh、private provenance、plugin / 外部链接与 unknown；project override 不被全局同步写入；重复 / 漂移可见；已纳管资源继续经过预览和恢复；外部 installer 资源没有写入按钮。新增 runtime 行为必须加发现 / 信任 / 执行测试，交付前运行仓库规定的 lint / typecheck / test / build 与 public-boundary 检查。

首期不引入新 sidebar、通用 provider 框架、原生根迁移、OAuth、live MCP 检查或后台自动同步。

## CC Switch 与 Magpie：当前无需再装一套

这里指 [yetone/magpie](https://github.com/yetone/magpie)。Magpie 除了供应商 / 网关，也有 **Library**：MCP 与 Skills 按 Agent 部署；[官方插件说明](https://usemagpie.ai/docs/plugins#agent-plugins)描述原生配置合并、Skills link / copy、归属清理和备份。[Library CLI](https://github.com/yetone/magpie/blob/main/library_cli.go)有 MCP add / agents / rm、Skills update / link / copy / collision 选择，以及 library sync；[v0.1.1224 正式发布](https://github.com/yetone/magpie-releases/releases/tag/v0.1.1224)也包含 Library / Skills 修复，证明能力已经发布。

| 能力 | Magpie 与 CC Switch 的重叠 / 增量 |
| --- | --- |
| 模型、供应商、协议转换、账号、路由与用量 | 两者都覆盖；具体策略不同。[Magpie 入门](https://usemagpie.ai/docs/start)、[CC Switch v4.0.10](https://github.com/farion1231/cc-switch/blob/v4.0.10/README.md) |
| MCP / Skills 分发与更新 | 两者都能管理原生配置与 Skills 链接 / 复制；CC Switch 另有 skills.sh / ZIP 发现入口 |
| 备份 / 跨机同步 | 两者都覆盖；Magpie 有加密备份及 WebDAV / S3 / 私有 GitHub 同步。[备份合同](https://github.com/yetone/magpie/blob/main/docs/reference.md#moving-to-another-machine) |
| 项目整套快照 / 原生日志费用统计 | CC Switch 有明确的 provider + MCP + Skills + prompt 项目快照，以及无需代理的会话日志统计；本次未确认 Magpie 提供完全等价能力 |

**已经日常使用 Magpie 时，CC Switch 不作为额外默认安装项。** 只有某个具体客户端能力或操作体验未被 Magpie 满足，再按该缺口比较。当前 Magpie Library CLI 是人类文本输出，并非已验证的稳定 JSON API；Craft Hub 首期读取原生盘点或使用受限只读适配，不能直接读写其内部数据库，也不能把输出中的命令参数 / URL 原样透出。

推荐当前职责：Magpie 负责已经在它 Library 中管理的配置；Workstation 负责配置源、既有恢复与机器诊断；Craft Hub 负责统一入口、归属和差异审阅；Skillshare 保留为未来多客户端适配候选。用户需要解决的是可见性和写入责任，而不是再增加一个默认同步开关。
