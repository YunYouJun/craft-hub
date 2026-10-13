# Codex 任务

Workspace 顶部的 Codex 图标会直接在原生 Codex App 中打开主要项目；相邻的加号按钮会定位到多根目录任务表单。表单中的**在 Codex 中启动**通过已有 SDK runner 转交任务。作为[定位收缩](../../adr/0009-focus-on-project-capabilities-and-integrations.md)的第一步，Workspace 的通用 **Craft Hub 后台运行**入口已移除。

剩余 SDK 通路属于迁移期间的兼容流程：它仍会先在本地执行提示词，再打开原生客户端，尚未变成完全由外部工作台执行的启动器。

macOS 桌面构建默认使用本机 Codex CLI。缺失时可在软件中心通过 Workstation 按需安装；已有原生程序会从本机可执行路径及 Codex / ChatGPT App 中检测。工作台启动不需要 Codex 或本机 Node，执行 Codex 任务时才需要 CLI 及其独立登录。Workstation 本身仍是单独安装的 Node CLI。如需兼容包，可在构建时显式设置 `CRAFT_HUB_DESKTOP_CODEX_MODE=bundled` 内置 CLI。

## 在 Codex 中打开主要项目

需要官方文档所述的 `codex app <path>` 行为时，使用顶部的 Codex 图标：它会用 Workspace 的主要项目启动原生 App。这是一个直接跳转入口，有意只打开一个目录；它不会启动提示词，也不会附加 Workspace 的其他项目。

## 在 Codex 中启动

Craft Hub 会创建一个持久化 Codex 任务，以主要项目作为工作目录，并把每个已选项目挂载为 workspace root。提示词包含明确的 Craft Hub Workspace ID，让全局安装的 Craft Hub Plugin 无需依赖隐藏的“当前工作空间”状态即可解析同一工作空间。提示词会立即开始执行，且每个已选项目都必须已授权 Craft Hub 执行。

turn 运行期间，本地 thread 由 Codex SDK 进程持有。因此 Craft Hub 会把任务留在自己的界面，实时显示易读的 SDK 进度和命令输出，并且不会提前暴露 thread 跳转。SDK 进程完成并释放 thread 后，Craft Hub 才会自动在原生客户端中打开任务，从而避免原生客户端出现**已在另一个应用中打开**。

任务会保存在 Codex 的正常会话存储中。SDK 执行进程释放任务后，对话历史、审批、diff、进度和后续对话仍可在原生客户端中继续使用。

Codex 目前没有公开并文档化的桌面接口，允许第三方应用更新本地项目的文件夹列表。受支持的 `codex app <path>` 只会打开一个已保存项目；顶层 `--add-dir` 参数不会更新该 Desktop 项目。因此 Craft Hub 仅在明确的“打开主要项目”入口使用 `codex app`；多根目录工作仍使用 Codex SDK 任务通路，并且不依赖辅助功能脚本或私有 IPC。

对于多项目工作空间，主要项目仍是默认工作目录。所选项目列表会精确控制**在 Codex 中启动**附加的其他 roots。

## 已有内部任务

Workspace 不再创建通用后台任务。已有任务记录与输出仍可查看，已释放的 thread 仍可在 Codex 中打开。后端取消 API 继续支持运行中的任务。

Skills 执行、工作项启动、项目配置操作和远程投递仍使用共享任务管理器。这些调用必须先迁移，才能移除任务后端。对于留在 Craft Hub 的任务，只有在完成或停止、执行进程释放 thread 后才提供**在 Codex 中打开**。

SDK 任务不是终端会话：provider 消费的是结构化 JSON 事件流，没有 PTY 屏幕缓冲区。Craft Hub 会把这些事件渲染成类似终端的本地输出。若 Codex TUI 是用户在 Terminal 或 iTerm 中独立启动的，它归外部终端所有，Craft Hub 无法读取或镜像其屏幕内容。

## 选择入口

| 需求 | 推荐方式 |
| --- | --- |
| 不启动提示词，只跳转到主要项目 | 顶部 Codex 图标 |
| 查看实时输出，并在释放后自动打开任务 | 在 Codex 中启动 |
| 避免原生 App 的 thread 所有权冲突 | 在 Codex 中启动 |
| 启动通用无人值守任务 | 你选择的外部工作台 |
| 通过已有兼容流程对多个所选项目执行 | 在 Codex 中启动 |
| 在 Codex 中继续已经完成的后台任务 | 打开已释放的 thread |

Codex App Server 是用于构建 Codex 富客户端的协议；单独启动的 App Server 并不会成为 Codex Desktop App 的远程控制入口。因此 Craft Hub 将运行时保留在适配器之后，不复刻 Codex 的对话界面。参见官方 [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)和 [Codex SDK 文档](https://learn.chatgpt.com/docs/codex-sdk)。

## 安全边界

- Workspace 顶部会把 Codex 图标明确标注为“打开主要项目”；相邻的加号按钮才会定位到多根目录任务表单。
- **在 Codex 中启动**要求全部所选项目显式授权 Craft Hub 执行；直接打开主要项目的快捷入口不会执行项目代码。
- **在 Codex 中启动**会立即提交提示词、在运行中显示本地输出，并且只在 thread 释放后打开原生客户端。
- 项目启动使用结构化命令参数并设置 `shell: false`。
- Craft Hub 不使用 AppleScript、辅助功能自动化或未公开的桌面 IPC 修改 Codex 项目。
