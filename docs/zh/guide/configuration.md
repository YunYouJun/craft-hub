# 项目配置

配置完全可选。只有需要自定义元信息或隐藏能力时，才添加 `.craft-hub/project.jsonc`。JSONC 兼容严格 JSON，同时允许注释和尾随逗号，便于 AI 稳定生成，也方便人工维护。

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/project-v1.schema.json",
  "version": 1,
  "project": {
    "name": "Craft Hub",
    "icon": "./icon.svg",
    "color": "purple"
  },
  "defaults": {
    "agent": "codex"
  },
  "capabilities": {
    "hidden": [],
    "descriptions": {
      "package.json:dev": {
        "default": "Start the local development environment.",
        "zh-CN": "启动本地开发环境。"
      }
    }
  },
  "packages": {
    "apps/web": {
      "description": {
        "default": "Craft Hub web workbench.",
        "zh-CN": "Craft Hub Web 工作台。"
      }
    }
  }
}
```

## 格式与 Schema

JSONC 是唯一的项目配置格式。它保留 JSON 明确的数据模型与成熟的编辑器工具链，同时允许注释和尾随逗号。项目元数据不再接受 YAML；YAML 同样需要 JSON Schema 才能获得补全和结构校验，却会增加第二套解析器与更难预测的程序化修改路径。

Zod v4 的 `projectConfigSchema` 是唯一真源。Craft Hub 直接使用它进行离线运行时校验，通过 `z.infer` 推导公开 TypeScript 类型，并生成提交到仓库的 Draft 2020-12 Schema：`packages/craft-hub/schema/project-v1.schema.json`。修改 Zod 模型后运行 `pnpm schema:project`；`pnpm schema:project:check` 会阻止生成结果漂移。

在 Craft Hub 拥有专用 Schema 域名前，带版本文件名的 GitHub Raw URL 是编辑器和第三方工具使用的公共标识。npm 包也会在 `craft-hub/schema/project-v1.schema.json` 携带同一份文件；Craft Hub 运行时校验不会下载公共 URL。

核心对象会拒绝未知字段，以便尽早发现拼写错误。第三方数据必须放在 `extensions.<provider>` 下，Craft Hub 只保留、不解释其内容：

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/project-v1.schema.json",
  "version": 1,
  "extensions": {
    "com.example.release": {
      "channel": "preview"
    }
  }
}
```

配置必须显式声明 `version`。新增可选字段不升级版本；破坏性的结构或语义变化必须发布新的版本化 Schema，并提供确定性迁移。Craft Hub 使用 JSONC AST 做最小增量修改，再原子替换文件，从而保留注释、格式、扩展数据及其他符合 Schema 的无关字段。

项目配置通常会提交到 Git。不要在其中保存 token、密码、凭证、本机路径或其他秘密；只声明所需环境变量名称或 secret provider 引用。

## 无效配置

某个项目配置无效或无法读取时，不会移除已注册项目，也不会阻塞其他项目加载。Craft Hub 会保留该项目已有的本机名称、信任状态和排序，同时显示包含文件位置与校验消息的项目级诊断；桌面端可以在已配置的编辑器中直接打开 `.craft-hub/project.jsonc` 并定位到错误行。

Craft Hub 不会自动修复或覆盖无效文件。请在编辑器中修正后刷新，文件通过校验后诊断就会消失。成功返回的空项目目录与目录请求失败是两种不同状态，因此 Runtime 错误会被明确展示，不会再伪装成首次安装后的空白界面。

## MCP 初始化

Agent 可以通过 MCP 的 `init_project_config` 工具初始化这个可选文件。`preview` 返回建议写入的完整 JSONC 和内容 revision，但不会写文件；`apply` 要求项目已授权 Craft Hub 执行，并携带该次预览返回且未发生变化的 revision。

初始化只会创建缺失的 `.craft-hub/project.jsonc`；生成的 `$schema` URL 可为编辑器提供补全与校验。如果文件已经存在，Craft Hub 会先校验再返回当前内容，不会重写。

`hidden` 条目可以填写能力名称、能力 ID，或 `package.json:release` 这样的“来源:名称”。`descriptions` 使用同样的键，并会在命令列表的命令名下方显示简介。描述既可以沿用单个字符串，也可以使用以 BCP 47 语言标签为键的多语言映射；Craft Hub 会依次匹配当前语言、上级语言标签和 `default`。当不同来源存在同名命令时，建议使用“来源:名称”。

包元数据使用项目相对目录作为稳定 key，根包使用 `.`。配置的包简介会在 Craft Hub 中覆盖缺失或不够友好的 `package.json` 简介，但不会修改包清单。

“完善项目说明”会先在本地审计缺失项，再以只读权限调用 Codex 生成结构化的命令与包说明建议。用户检查建议前不会修改仓库；应用时只更新当前生效的项目配置，并拒绝已经过期的建议。

## 参数化命令

`capabilities.inputs` 可以为已发现的命令声明表单字段。Craft Hub 在界面中把
`select` 渲染为下拉框、把 `text` 渲染为文本框、把 `boolean` 渲染为复选框；runtime
会校验值并将其作为独立 argv 参数追加，不会拼装 shell 字符串。布尔输入启用时只追加
flag 本身，关闭时不追加参数。

```jsonc
{
  "capabilities": {
    "inputs": {
      "apps/widget/package.json:deploy": {
        "environment": {
          "type": "select",
          "label": "部署环境",
          "options": ["dev", "staging"],
          "default": "dev",
          "flag": "--env"
        },
        "account": {
          "type": "text",
          "label": "Account",
          "pattern": "^\\d+$",
          "flag": "--account",
          "visibleWhen": { "input": "environment", "equals": "dev" },
          "requiredWhen": { "input": "environment", "equals": "dev" }
        },
        "silent": {
          "type": "boolean",
          "label": "仅更新，不打开页面",
          "flag": "--silent"
        }
      }
    }
  }
}
```

输入项支持 `equals`（默认，生成 `--env=dev`）与 `separate`（生成 `--env dev`）
两种 `argumentStyle`。下拉框必须声明 `options`；文本框可以通过 `pattern` 校验；布尔输入
可使用字符串 `"true"` 或 `"false"` 作为默认值。所有输入类型都支持 `default`：下拉框默认值
必须匹配一个选项，文本框默认值可以是任意字符串，布尔默认值必须是 `"true"` 或 `"false"`。
Craft Hub 会把默认值同时应用到初始表单与命令预览。`visibleWhen` 控制条件显示，
`requiredWhen` 控制条件必填；条件既可以是单个对象，也可以是必须全部匹配的对象数组。
所有输入在预览和实际执行时都会由 runtime 再次校验。对象形式的选项可以设置
`omitArgument: true`，使该选项仍可在界面中选择，但不追加对应 flag；例如“当前登录开发者”
可以交由底层 CLI 使用当前身份。

## Release 操作

根目录中的 `release` package script 会自动识别为受保护的发布操作。可以通过
`capabilities.operations` 关联仓库策略与发布自动化信息：

```jsonc
{
  "capabilities": {
    "operations": {
      "package.json:release": {
        "kind": "release",
        "requiresCleanGit": true,
        "requiredBranch": "main",
        "workflowPath": ".github/workflows/release.yml"
      }
    }
  }
}
```

Craft Hub 会展示当前版本、拟创建标签、分支、工作区状态与工作流效果。每次发布都需要单独确认，
runtime 会在执行前再次完成相同预检。发布平台状态和触发器可以由插件扩展，但不会替换宿主内置的
安全检查。

## Skill 参数

`capabilities.skillInputs` 可以为已发现的 Agent Skill 声明交互参数。字段支持与命令参数相同的
`select`、`text`、本地化标签、默认值和条件显示，但不接受 `flag` 或 `argumentStyle`：Skill
参数不会生成命令行，而是经过校验后作为结构化数据加入 Codex App 或 Craft Hub 后台任务的请求。

```jsonc
{
  "capabilities": {
    "skillInputs": {
      "agent-skill:wetools-release": {
        "app": {
          "type": "select",
          "label": "应用",
          "options": [
            { "value": "task-center", "label": "小微任务中心" },
            { "value": "todo", "label": "待办与提醒" }
          ],
          "default": "task-center",
          "required": true
        },
        "version": {
          "type": "select",
          "label": "版本类型",
          "options": ["patch", "minor"],
          "default": "patch"
        }
      }
    }
  }
}
```

Skill 可以使用能力 ID、名称或“来源:名称”作为 key；推荐使用 `agent-skill:<name>` 等带来源的
稳定引用，避免同名 Skill 冲突。界面会将 `select` 渲染为下拉框，并把用户选项与自由文本请求
一同交给 Agent。配置只能声明数据和值域，不能保存凭据或注入额外执行命令。

## 可移植工作空间

跨项目关系属于用户，而不属于任一成员仓库。Craft Hub 在 `~/.craft-hub/workspaces/` 中为每个工作空间保存一份带版本的 manifest；可通过 `CRAFT_HUB_CONFIG_DIR` 覆盖此便携配置目录。

每个工作空间和工作空间组都只属于一个 Owner Scope。旧 manifest 未声明 `ownerScopeId` 时归入固定的 `Personal`；Team manifest 会记录稳定的 Team ID，例如 `ownerScopeId: acme`。Team 身份与 Git 工作区相互独立，因此迁移仓库不会改变所有权。

工作台将 Owner Scope 切换视为即时导航：每个 Scope 独立维护工作空间树、项目引用绑定、独立项目分组和上次选中的工作空间。本机注册目录、信任状态、运行记录和凭据仍只属于当前设备。Team 视图只显示该 Team 引用的项目，未分配的本机项目只显示在 Personal。命令面板可以跨 Scope 搜索，并在打开工作空间前先切换到它所属的 Scope。

创建 Team 时必须选择一个现有的本地 Git 工作区。Craft Hub 默认将 Team 快照写入 `.craft-hub/teams/<team-id>/`，但不会 fetch、commit、push 或保存 Git 凭据。切换 Scope 会立即读取本地状态；同步需要显式触发，发生冲突时必须选择采用本地或仓库快照。

重命名 Team 时会保留稳定 ID 和 Git 目标，并将本地快照标记为有变更，等待下一次显式同步。删除 Team 前必须准确输入 Team 名称；Craft Hub 会清理该 Team 的本地工作空间、绑定、导航状态和同步目标，若删除的是当前 Team 则自动切回 Personal，同时保留共享 Git 快照以供恢复。

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
  "workbench.codex": {
    "model": "gpt-5.6-sol",
    "reasoningEffort": "high"
  },
  "workbench.editor": {
    "default": "custom",
    "custom": {
      "name": "Cursor",
      "command": "cursor",
      "args": ["--reuse-window", "{path}"]
    }
  },
  "workbench.locale": "zh-CN",
  "workbench.theme": "system"
}
```

`workbench.codex` 为 Craft Hub 启动的所有 Codex SDK 任务提供可选默认值。省略 `model`、`reasoningEffort` 或整个设置时，会沿用用户 `~/.codex/config.toml` 中的 Codex 配置。模型使用自由填写的 Codex model ID，避免 Craft Hub 固化容易过期的版本列表。当前内置 SDK 可显式设置 `minimal`、`low`、`medium`、`high`、`xhigh`、`max` 和 `ultra`；实际可用范围仍取决于所选模型与账号。

项目与工作空间顶部按钮共用 `workbench.editor`。内置值为 `vscode` 与 `cursor`；自定义编辑器使用一个直接执行的命令及独立参数。自定义参数必须包含 `{path}`，Craft Hub 会替换该占位符，并始终以 `shell: false` 启动命令。

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
