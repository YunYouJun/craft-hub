# Codex 空间清理：社区复用调研

日期：2026-11-05。状态：完成官方文档、社区 README、许可证与部分源码审阅；未安装或执行任何社区清理工具，未读取真实会话或数据库。本轮只读核对本机 Codex CLI 帮助中存在会话管理子命令，不据此保证其他安装版本兼容。

## 建议

社区已有可参考实现。优先评估 `betterlmy/codex-cleaner` 的固定版本只读扫描与分类预览；工作树管理优先接官方保留、归档与恢复机制；Augma 继续承担应用缓存与系统清理。`iamquang95/codex-clean` 适合参考工作树占用与线程关联展示，Mole 适合复用已验证的独立 CLI 分析能力。当前没有足够证据把这些工具视为可直接嵌入、默认执行的成熟 Codex 清理 SDK。

这项判断侧重具体接口和数据保护，不能把 `~/.codex` 总占用等同于可释放量。会话、归档、工作树、生成成果和可视化文件都可能是用户资产，不能因为目录大或文件旧就归入缓存。

## 官方机制应优先复用

官方文档说明，Codex 默认保留最近 15 个托管工作树，可调整数量或关闭自动清理。关联置顶聊天或进行中聊天的工作树不会自动清理；删除托管工作树前保存快照，之后可通过聊天恢复。实际配置、旧版永久工作树及安装版本仍需单独识别。直接删除 Git 工作树目录不具备同等的聊天关联与恢复语义。[官方 Worktree cleanup](https://learn.chatgpt.com/docs/environments/git-worktrees#worktree-cleanup)

因此 Craft Hub 可以先显示项目、工作树大小、关联状态和维护入口。真正移除 Codex 托管工作树时，优先交给 Codex 自己的管理流程；不把手动修改 Git 元数据或应用数据库作为通用清理接口。

## 候选比较

| 候选 | 已核对的能力 | 接口与恢复方式 | 复用判断 |
| --- | --- | --- | --- |
| [betterlmy/codex-cleaner](https://github.com/betterlmy/codex-cleaner) | Codex 专项分类、未知路径保护、进程检查、清理归档与恢复 | TypeScript CLI；`scan --json`、指定 `--category`、默认 dry-run、显式 `--apply`；校验后的 gzip 归档 | 最适合先做受限 Adapter 评估。源码包版本为 0.1.1，未声明稳定库 Interface；不能把内部模块当成熟 SDK 使用。 |
| [iamquang95/codex-clean](https://github.com/iamquang95/codex-clean) | 工作树、分支、关联线程、总大小和产物占用的 TUI；清理产物和移除工作树 | Rust TUI，破坏性动作前确认；所审阅入口未提供供宿主消费的 JSON/非交互 dry-run 合同；删除使用 `remove_dir_all` | 参考发现、排序和关联展示。不能直接承诺官方快照恢复，也不宜原样作为默认后台删除器。 |
| [Mole](https://github.com/tw93/Mole) | Codex 固定缓存、失效更新暂存、旧 daemon 版本、崩溃报告及有限市场暂存规则 | 独立 CLI；占用分析有 JSON，清理有 dry-run；`mo clean` 涉及多个来源并有永久删除 | 沿用 Augma 的可选引擎路线。当前公开清理参数不能限制为单一 Codex 类别，不能把广泛清理包装成专项按钮。 |

候选能力依据：[Codex Cleaner README](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/README.md)、[包声明](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/package.json)、[codex-clean README](https://github.com/iamquang95/codex-clean/blob/66b71908683068f3b6f237fd50d342e72679e378/README.md)、[删除实现](https://github.com/iamquang95/codex-clean/blob/66b71908683068f3b6f237fd50d342e72679e378/src/cleanup.rs)、[Mole 清理入口](https://github.com/tw93/Mole/blob/304d9e3d523f8c595c7080e338ec62c303a54356/bin/clean.sh#L2155)。

## Codex Cleaner：值得评估的部分与限制

所审阅版本的默认 `clean` 只选择标为推荐的 `temp` 与 `model-cache`：前者含 `.tmp`、`tmp` 和远程插件安装暂存，后者含模型元信息和远程插件目录缓存。`--category` 可限定单个类别。日志、日志数据库、插件缓存和 shell 快照需要单独选择；未知目录不能进入文件清理计划。[分类目录](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/catalog.ts)、[命令默认项](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/cli.ts#L67)、[计划验证](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/plan.ts)

| 数据 | 此版本处理 |
| --- | --- |
| `sessions` | 标为有状态，通过独立会话管理命令处理，不作为文件缓存删除。 |
| `archived_sessions` | 受保护，不能选择为文件系统清理类别；另有独立永久删除归档会话命令。 |
| `state_*.sqlite`、`thread_history_*.sqlite`、`goals_*.sqlite`、`queue_*.sqlite`、`memories_*.sqlite` 及 WAL/SHM | 受保护；`thread_history_1.sqlite` 符合保护规则。 |
| `logs_*.sqlite` 及 WAL/SHM | 单独的 review 类别，并非所有 SQLite 都一律保护。 |
| `auth.json`、`config.toml`、skills、hooks、memories、运行时 packages | 受保护。 |
| `artifacts`、`archives`、`visualizations`、`worktrees` 和新出现的未知数据库 | 不在文件清理白名单中，扫描展示为 unknown，不能选择为该清理计划。 |

这些保护由[静态 catalog](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/catalog.ts)、[unknown 扫描](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/scanner.ts)和[仅允许 filesystem 类别的计划逻辑](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/plan.ts)共同形成。大目录未被覆盖不表示它们可以追加到删除白名单。

执行时检测 Codex/ChatGPT 进程及已知 IPC socket，存在进程、socket 或无法可靠查询进程时拒绝变更；恢复和会话变更入口也有运行状态检查。`doctor` 会探测 `codex archive/unarchive/delete --help`，会话操作实际委托这些 CLI 子命令，不直接改私有 SQLite。各版本仍需能力检测，不能把工具 README 所写命令视为任意安装都支持。[进程检测](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/process.ts)、[Codex 命令 Adapter](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/codex.ts)、[CLI 守卫](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/cli.ts)

归档流程先将候选复制到 cleaner 临时 payload，再创建 `.tar.gz`，验证清单与 SHA-256 后才移走并删除原条目；默认归档位于 `~/.codex-cleaner`。该路径在 `CODEX_HOME` 外不代表在另一个磁盘卷：保留压缩归档仍占空间，过程还需要临时副本和压缩包空间。候选逻辑大小不能作为净释放量。恢复只还原此类归档中的文件与目录，不重建被永久删除会话的聊天索引；工具明确不承诺恢复 `codex delete` 的结果。[归档/恢复实现](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/archive.ts)、[清理事务](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/src/clean.ts)、[恢复边界说明](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/README.md#safety-model)

集成前仍需验证扫描预算、取消、目录变化、崩溃回退、进程识别与当前数据格式。所审阅扫描器遍历已知和 unknown 条目，尚未形成适合 Craft Hub 的有界扫描和取消合同；其计划摘要也不等于跨扫描、归档和删除的原子保证。

## Mole：具体覆盖范围

审阅 `main` 的提交 `304d9e3d523f8c595c7080e338ec62c303a54356`，其 [lib/clean/dev.sh](https://github.com/tw93/Mole/blob/304d9e3d523f8c595c7080e338ec62c303a54356/lib/clean/dev.sh) 包含以下专项规则：

- `~/Library/Caches/Codex` 的三个固定 Chromium profile 下，仅处理 `Cache` 与 `Code Cache`；明确排除 Local Storage、IndexedDB、cookies、会话、偏好等持久数据，运行或进程状态未知时跳过。
- Sparkle 的旧安装暂存、`~/.codex/packages/app-server-daemon/releases` 中被替代的版本、Crashpad 过期报告。daemon 清理保留 `current` 与更新标记指向的版本，并检查安装锁和文件占用。
- `~/.codex/.tmp` 下固定市场暂存根，仅接受指定暂存前缀与年龄规则；完成安装的市场目录、backup 目录不在此规则范围。
- `clean_codex_cli` 本身是保护性的 no-op，保留 CLI 与 Desktop 共享的会话、索引、凭据及本地状态；不能据此宣称 Mole 默认清理所有 Codex 数据。

相关[回归测试源码](https://github.com/tw93/Mole/blob/304d9e3d523f8c595c7080e338ec62c303a54356/tests/clean_ai_cli_caches.bats)覆盖固定缓存叶子、运行中进程、路径替换、旧 daemon 锁与市场暂存等场景。本轮仅审阅测试，未执行这些测试或真实清理。

公开 `mo clean` 入口明确拒绝已移除的 `--select`、`--categories`、`--exclude` 参数；dry-run 是广泛清理预览，不能视为锁定单一 Codex 类别的事务。需要专项宿主能力时，应先争取上游结构化 Interface 或另行隔离验证，不能直接 source 私有 shell 函数并宣称稳定支持。[参数解析源码](https://github.com/tw93/Mole/blob/304d9e3d523f8c595c7080e338ec62c303a54356/bin/clean.sh#L2155)

## 版本、许可证与落地顺序

审阅快照：Mole `304d9e3d`，Codex Cleaner `2bd4c1c1`（包声明 0.1.1），codex-clean `66b71908`。截至调研时，Mole 最新正式版本为 [V1.69.0，2026-11-04 发布](https://github.com/tw93/Mole/releases/tag/V1.69.0)；审阅 `main` 不表示本机旧版本或该 release 自动包含所有相同行为。Codex Cleaner 与 codex-clean 仓库最近推送分别为 2026-09-03 和 2026-03-25，属于需要固定版本与独立验收的小型候选；不能用 README 的安全表述替代实际验证。[仓库元数据](https://api.github.com/repos/betterlmy/codex-cleaner)、[codex-clean 元数据](https://api.github.com/repos/iamquang95/codex-clean)

Codex Cleaner 与 codex-clean 均为 MIT，复用源码须保留相应声明；Mole 为 GPL-3.0。当前建议沿用独立 CLI Adapter，避免直接复制 Mole 规则或脚本进 Craft Hub/Augma 的 MIT 实现，打包分发另行核实许可安排。[Codex Cleaner LICENSE](https://github.com/betterlmy/codex-cleaner/blob/2bd4c1c134001d303301ab86c66460e6e5f95881/LICENSE)、[codex-clean LICENSE](https://github.com/iamquang95/codex-clean/blob/66b71908683068f3b6f237fd50d342e72679e378/LICENSE)、[Mole LICENSE](https://github.com/tw93/Mole/blob/304d9e3d523f8c595c7080e338ec62c303a54356/LICENSE)

建议先交付只读 Codex 分类占用与工作树关联；在隔离夹具中评估固定版本 `scan --json` 和显式单类别 dry-run，再决定是否接入执行。应用缓存专项继续放在 Augma；Craft Hub 负责项目/worktree 上下文及维护导航。会话与成果管理保留明确选择、官方命令能力检测和独立审阅，不能并入默认缓存清理。
