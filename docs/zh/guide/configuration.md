# 项目配置

配置完全可选。只有需要自定义元信息或隐藏能力时，才添加 `.craft-hub/project.yaml`。

```yaml
version: 1
project:
  name: Craft Hub
  icon: ./icon.svg
  color: purple
defaults:
  agent: codex
capabilities:
  hidden: []
  descriptions:
    package.json:dev:
      default: Start the local development environment.
      zh-CN: 启动本地开发环境。
```

## MCP 初始化

Agent 可以通过 MCP 的 `init_project_config` 工具初始化这个可选文件。`preview` 返回建议写入的完整 YAML 和内容 revision，但不会写文件；`apply` 要求项目已授权 Craft Hub 执行，并携带该次预览返回且未发生变化的 revision。

初始化只会创建缺失的 `.craft-hub/project.yaml`。如果文件已经存在，Craft Hub 会返回当前内容并保持逐字节不变，包括注释和下游扩展字段。

`hidden` 条目可以填写能力名称、能力 ID，或 `package.json:release` 这样的“来源:名称”。`descriptions` 使用同样的键，并会在命令列表的命令名下方显示简介。描述既可以沿用单个字符串，也可以使用以 BCP 47 语言标签为键的多语言映射；Craft Hub 会依次匹配当前语言、上级语言标签和 `default`。当不同来源存在同名命令时，建议使用“来源:名称”。

## 参数化命令

`capabilities.inputs` 可以为已发现的命令声明表单字段。Craft Hub 在界面中把
`select` 渲染为下拉框、把 `text` 渲染为文本框；runtime 会校验值并将其作为独立
argv 参数追加，不会拼装 shell 字符串。

```yaml
capabilities:
  inputs:
    apps/liteapp/package.json:deploy:
      environment:
        type: select
        label: 部署环境
        options: [dev, rdm]
        default: dev
        flag: --env
      uin:
        type: text
        label: UIN
        pattern: '^\d+$'
        flag: --uin
        visibleWhen: {input: environment, equals: dev}
        requiredWhen: {input: environment, equals: dev}
```

输入项支持 `equals`（默认，生成 `--env=dev`）与 `separate`（生成 `--env dev`）
两种 `argumentStyle`。下拉框必须声明 `options`；文本框可以通过 `pattern` 校验。
`visibleWhen` 控制条件显示，`requiredWhen` 控制条件必填。所有输入在预览和实际执行时
都会由 runtime 再次校验。

## 可移植工作空间

跨项目关系属于用户，而不属于任一成员仓库。Craft Hub 在 `~/.craft-hub/workspaces/` 中为每个工作空间保存一份带版本的 manifest；可通过 `CRAFT_HUB_CONFIG_DIR` 覆盖此便携配置目录。

```yaml
schemaVersion: 1
id: craft-hub
name: Craft Hub
primaryProject: craft-hub
members:
  - project: craft-hub
    pinned: true
  - project: dotfiles
```

成员 key、顺序、置顶和主要项目可以通过私有 dotfiles 仓库同步。绝对路径、Craft Hub 执行授权、本机 binding、当前选择、运行历史、凭证和 Codex thread ID 仍保存在操作系统数据目录中，不应同步。新设备上无法解析的成员会继续显示，直到绑定本机已注册项目；binding 不会转移执行授权。

项目图标可以填写仓库内的 SVG/PNG 相对路径、`emoji:<字符>`，或 `builtin:folder`、`builtin:hub`、`builtin:skill`、`builtin:terminal`。文件路径只能解析到项目目录内；无效或越界路径会回退为文件夹图标，并显示非阻塞警告。可选的 `color` 只接受 `blue`、`cyan`、`green`、`orange`、`pink`、`purple`、`red`、`yellow`。强调色用于识别项目，不会覆盖执行授权或运行状态的语义色。

## 全局用户设置

用户偏好与项目配置相互独立。Craft Hub 在操作系统数据目录中保存严格 JSON：

- macOS：`~/Library/Application Support/Craft Hub/settings.json`
- Windows：`%APPDATA%/Craft Hub/settings.json`
- Linux：`$XDG_DATA_HOME/craft-hub/settings.json`，未设置时使用 `~/.local/share/craft-hub/settings.json`

可通过 `CRAFT_HUB_DATA_DIR` 覆盖数据目录。应用会在设置文件旁生成 `settings.schema.json`，编辑器离线时也能校验配置。

```json
{
  "$schema": "./settings.schema.json",
  "workbench.locale": "zh-CN",
  "workbench.theme": "system"
}
```

桌面端的设置弹窗可以打开此文件，也可以导入或导出便携 JSON。精简导出只包含用户明确修改的值，完整快照包含全部有效且非敏感的设置。Craft Hub 执行授权、项目注册记录、运行历史、用户名和机器路径永远不会导出。替换导入前会自动备份，并保留最近五份。

置顶的命令与 Skill 属于直接操作产生的本机工作台状态。混合排序保存在同一数据目录下的 `workspace-state.json` 中，不参与设置导入或导出。

运行日志属于本机数据，可能包含命令、路径或终端输出。未置顶的已完成记录默认保留 30 天，总量上限为 500 MB。每次运行的持久化输出上限为 10 MB；活动记录和置顶记录不会被自动清理。

CLI 使用相同的 runtime 行为：

```sh
craft-hub settings:get
craft-hub settings:set workbench.locale zh-CN
craft-hub settings:set workbench.theme dark
craft-hub settings:export settings.json --mode minimal
craft-hub settings:import settings.json --dry-run --json
craft-hub settings:import settings.json --replace
```

未知核心键会被拒绝，以便发现拼写错误。`extensions.<extension-id>.*` 下的键会为向前兼容而保留，但在扩展设置注册能力落地前不会生效。
