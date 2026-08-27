# Codex 任务

Craft Hub 有意保留两种不同的 Codex 启动方式。**在 Codex 中启动**是主操作；无人值守的 Craft Hub 后台执行位于它的次级菜单中。

## 在 Codex 中启动

Craft Hub 会在 Codex 中打开工作空间的主要项目，并把提示词复制到剪贴板。复制的提示词包含明确的 Craft Hub Workspace ID，让全局安装的 Craft Hub Plugin 无需依赖隐藏的“当前工作空间”状态即可解析同一工作空间。用户检查后，将提示词粘贴到新任务中并手动发送。

这是默认方式，因为任务从一开始就由 Codex App 持有。对话历史、审批、diff、进度和后续对话都留在原生客户端中，不需要在两个进程之间转移一个仍在运行的任务。

Codex 目前没有公开并文档化的桌面自动化接口，不能让第三方应用创建原生 App 任务、注入提示词并自动提交。受支持的 `codex app <path>` 启动方式负责打开项目，因此 Craft Hub 保留用户确认发送这一步，不依赖辅助功能脚本或私有 IPC。

对于多项目工作空间，Codex 中打开的是主要项目。所选项目列表只会自动应用于后台运行；原生 App 对其他路径的访问仍由 Codex 配置与审批决定。

## 在 Craft Hub 后台运行

次级操作通过 Codex SDK，让提示词在全部已选择且已授权 Craft Hub 执行的项目根目录中运行。Craft Hub 会记录任务、展示状态，并保存对应的 Codex thread ID。

这种方式适合无人值守或跨项目任务。turn 仍在执行时，本地 thread 由 SDK 进程持有；此时在 Codex 中打开同一任务，可能出现“已在另一个应用中打开”。因此 Craft Hub 应在任务完成或停止、执行进程释放 thread 后，再提供**在 Codex 中打开**。

## 为什么保留两种方式

| 需求 | 推荐方式 |
| --- | --- |
| 在 Codex App 中观察并调整执行过程 | 在 Codex 中启动 |
| 发送前检查提示词 | 在 Codex 中启动 |
| 无人值守或对多个所选项目执行 | Craft Hub 后台运行 |
| 在 Craft Hub 汇总任务状态 | Craft Hub 后台运行 |
| 在 Codex 中继续已经完成的后台任务 | 打开已释放的 thread |

Codex App Server 是用于构建 Codex 富客户端的协议；单独启动的 App Server 并不会成为 Codex Desktop App 的远程控制入口。因此 Craft Hub 将运行时保留在适配器之后，不复刻 Codex 的对话界面。参见官方 [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)和 [Codex SDK 文档](https://learn.chatgpt.com/docs/codex-sdk)。

## 安全边界

- 打开 Codex 不会自动执行提示词。
- 写入剪贴板的内容仅限明确的 Craft Hub Workspace ID 和用户输入的提示词。
- 在 Codex 中打开项目不要求 Craft Hub 执行授权；工作区访问、sandbox 和审批由 Codex 负责。
- 后台执行仍要求全部所选项目显式授权 Craft Hub 执行。
- 项目启动使用结构化命令参数并设置 `shell: false`。
- Craft Hub 不使用 AppleScript、辅助功能自动化或未公开的桌面 IPC 点击“发送”。
