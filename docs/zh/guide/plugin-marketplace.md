# 插件市场

Craft Hub 有两套刻意隔离的扩展模型：

- **Host Plugin（宿主插件）**是嵌入应用显式加载的可信代码依赖；加载时会执行 JavaScript。
- **Marketplace Plugin（市场插件）**是由 Plugin Catalog 提供的声明式包；Craft Hub 只读取 `package.json#craftHub`，不会导入包代码。

Codex 插件使用另一套 Manifest，不属于 Craft Hub Marketplace Plugin。

创建脚手架、校验、本地关联和打包流程参见[编写 Marketplace Plugin](./plugin-authoring.md)。

## 市场源

Distribution 可以提供 `builtin` 或 `managed` Marketplace Source，用户也可以先预览、再添加 HTTPS `user` Source。每个 Source 对应一个版本化 Plugin Catalog，并可指定 npm Registry。

Catalog 地址及重定向必须使用不含凭证的 HTTPS。Craft Hub 将响应限制为 1 MiB，要求 JSON Content-Type，并在修改本地状态前验证完整文档。

## Manifest 契约

Marketplace Plugin 在 `package.json#craftHub` 发布 v1 声明。核心身份、权限和贡献字段之外，可以提供以下向后兼容的发现元数据：

- `slug`：稳定详情标识。
- `links`：文档、仓库、反馈和主页 HTTPS 链接。
- `icon`：HTTPS 图标或包内安全相对路径。
- `maintainers`：维护者；可以使用由 Distribution 定义的稳定 `handle`、HTTPS Profile，或同时提供两者。
- `permissionReasons`：逐项解释所申请权限的用途。
- `localizations`：按语言覆盖名称、描述和权限说明。

`permissionReasons` 中的键必须是插件已声明的权限。`craftHub.minVersion` 必须是合法 SemVer。

```json
{
  "schemaVersion": 1,
  "id": "@acme/craft-hub-plugin-example",
  "displayName": "Example tools",
  "slug": "example-tools",
  "links": {
    "documentation": "https://docs.example.com/plugins/example-tools",
    "repository": "https://github.com/acme/example-tools",
    "feedback": "https://github.com/acme/example-tools/issues"
  },
  "maintainers": [{ "handle": "alice", "name": "Alice" }],
  "permissionReasons": {
    "commands": "运行此包声明的命令。"
  },
  "craftHub": { "minVersion": "0.0.1-alpha.0" },
  "includesPlugins": [
    { "package": "@acme/craft-hub-plugin-toolkit", "version": "^1.0.0" }
  ],
  "requiresPlugins": [
    { "package": "@acme/craft-hub-plugin-shared", "version": "^1.0.0" }
  ],
  "projectFiles": [],
  "permissions": ["commands"],
  "contributes": {
    "commands": [],
    "commandPresets": [],
    "commandTemplates": [],
    "packageQuickActions": [],
    "packageLinks": [],
    "navigationPanels": [],
    "workbenches": [],
    "skills": [],
    "projectTemplates": [],
    "integrations": []
  }
}
```

`navigationPanels` 会把与项目无关的 HTTPS 入口添加到“导航工作台”。面板和链接都支持本地化标题与描述。由于 Craft Hub 不读取项目数据，也不会在用户点击前访问目标地址，因此该贡献不需要申请权限。URL 必须使用 HTTPS，且不能包含凭据。

```json
{
  "id": "developer-resources",
  "title": { "default": "Developer resources", "zh-CN": "研发资源" },
  "icon": "builtin:code",
  "links": [
    {
      "id": "engineering-handbook",
      "title": { "default": "Engineering handbook", "zh-CN": "研发手册" },
      "description": { "default": "Standards and workflows", "zh-CN": "规范与流程" },
      "url": "https://example.com/engineering",
      "icon": "builtin:docs",
      "keywords": ["handbook", "手册"]
    }
  ]
}
```

`workbenches` 可以把已有的集成视图和导航面板组合成项目侧栏中的一个产品级入口。它只保存引用：Provider 调用、权限、生命周期和所有权仍由对应的子插件负责。

```json
{
  "id": "company-tools",
  "title": { "default": "Company tools", "zh-CN": "公司工具" },
  "description": { "default": "Work items, code, and team links.", "zh-CN": "待办、代码与团队入口。" },
  "icon": "builtin:briefcase",
  "order": 20,
  "views": [
    {
      "type": "integration",
      "plugin": "@acme/craft-hub-plugin-work-items",
      "integration": "work-items",
      "view": "assigned-to-me"
    },
    {
      "type": "navigation",
      "plugin": "@acme/craft-hub-plugin-company",
      "panel": "company-links"
    }
  ]
}
```

工作台可以引用自身贡献，也可以引用 `includesPlugins` 或 `requiresPlugins` 声明的 package。宿主会在创作阶段校验自身引用，并在安装后解析子插件引用。子插件被停用、缺失或不兼容时，对应页签会显示为不可用，而不会让整个工作台失效；子插件仍然可以独立管理。已被工作台收纳的集成视图不会再作为独立侧栏入口展示，从而避免图标重复。

`includesPlugins` 声明插件合集：列出的市场插件会从同一 Source 经一次审阅后一起安装，之后仍可独立管理。移除合集不会移除其中已经安装的插件。

`requiresPlugins` 声明来自同一 Marketplace Source 的强依赖。每项包含包名和 SemVer range；禁止引用自身、重复声明或同时出现在两个清单中。npm `dependencies` 仍然禁止使用。

`packageQuickActions` 允许声明式插件通过受限的文件标记识别工作区 package，并把已发现的 capability 放进该 package 的概览页。selector 可以是 capability ID、无歧义的 capability 名称或 `source:name`。因此它可以组合其他插件提供的技能或命令；目标 capability 未被发现时不会展示快捷项，并回退到常规命令快捷项。package 匹配需要 `read-project-files` 权限。

集成视图区块可以声明一个扁平的 `input` 对象，其值仅允许字符串、数字、布尔值或 null。宿主只会在用户打开或操作该区块时转发这些惰性数据。这样同一个 Provider 操作就能支持“全部条目”和“分配给当前账号的条目”等不同视图，而无需让 Marketplace 插件执行代码。

`skills` 随插件只安装一份 Agent Skill 内容，并使用稳定 `id` 作为项目引用。新插件应显式声明；旧版 v1 条目未声明 ID 时保留按路径生成的标识。技能不会全局暴露给所有项目；缺少 `activation` 时只能手动启用。表达式支持 `file`、`dependency`、`packageManager`、`all`、`any` 和 `not`，有深度与节点数限制，并要求 `read-project-files` 权限。Craft Hub 只在项目根目录和已发现的 pnpm package 根目录中求值。项目检测保持只读，后台调用技能仍受 Project Trust 保护。

```json
{
  "id": "widget-assistant",
  "path": "skills/widget-assistant/SKILL.md",
  "activation": {
    "all": [
      { "dependency": "@example/widget" },
      { "file": "widget.config.*" },
      { "not": { "file": "legacy-widget.config.js" } }
    ]
  }
}
```

```json
{
  "id": "widget-actions",
  "package": {
    "allFiles": ["package.json"],
    "anyFiles": ["widget.config.ts", "widget.config.js"]
  },
  "capabilities": ["codex-skill:Widget assistant", "dev", "build"]
}
```

`packageLinks` 会在这些操作旁展示由用户主动点击的 HTTPS 入口。插件声明受限的 package 相对配置文件和属性名；Craft Hub 只读取不超过 64 KiB 的普通文件中的带引号字符串字面量（最长 256 字符），在校验 package 边界前解析符号链接，对值做 URL 编码后替换唯一的 `{value}` 占位符。计算值不会被解析。package link 同样需要 `read-project-files` 权限。

```json
{
  "id": "widget-console",
  "title": { "default": "Widget console", "zh-CN": "组件控制台" },
  "package": {
    "allFiles": ["package.json"],
    "anyFiles": ["widget.config.ts", "widget.config.js"]
  },
  "urlTemplate": "https://widgets.example.com/console/{value}",
  "value": {
    "files": ["widget.config.ts", "widget.config.js"],
    "key": "appId"
  }
}
```

命令预设可以通过 `optionSources` 扩展 `select` 输入。`package-json-array` 从匹配 package 内受限的 JSON 数组读取选项，需要 `read-project-files`；`user-setting` 只读取一个精确的 `extensions.<plugin>.<setting>` 用户设置键，需要单独披露 `read-user-settings` 权限。静态选项保持在前、重复值会去重，缺失或非法数据源会被忽略，两种来源都不会执行项目代码。

命令模板和命令预设与项目配置共用同一套输入协议。`text` 或 `select` 输入可以把
`argumentStyle` 设为 `positional` 并省略 `flag`；Craft Hub 会按声明顺序把校验后的值作为
独立 argv 参数追加。整个过程仍是结构化执行，不会开放 shell 插值。

```json
{
  "inputs": {
    "account": {
      "type": "select",
      "flag": "--account",
      "default": "default",
      "options": [{ "value": "default", "omitArgument": true }]
    }
  },
  "optionSources": {
    "account": {
      "type": "user-setting",
      "key": "extensions.example-widget.accounts"
    }
  }
}
```

## Catalog 契约

Plugin Catalog 列出不可变的包版本。每个 Catalog Entry 包含精确包名、版本、SHA-512 SRI integrity、Publisher、权限集合、分类和生命周期状态，并可以复制 Manifest 的发现元数据。

- `requires`：兼容 Craft Hub 版本的 SemVer range。
- `status`：`active`、`deprecated` 或 `blocked`。
- `statusReason`：`deprecated` 和 `blocked` 必填。
- `replacement`：可选的替代 Marketplace Plugin 包名。
- `includesPlugins`：从 Manifest 复制的插件合集成员清单。
- `requiresPlugins`：从 Manifest 复制的插件依赖清单。

Catalog 的权限、权限说明和插件依赖必须与已安装包的 Manifest 一致。完整性、身份、权限、权限说明、插件依赖或兼容范围不一致时，Craft Hub 拒绝安装。

## 生命周期

- **active**：推荐且可安装。
- **deprecated**：仍可安装，但必须给出迁移说明，可推荐替代插件。
- **blocked**：禁止安装，并停用 Catalog 中精确匹配的已安装版本。

Catalog 维护者应保留被阻断的版本条目，让客户端能够实施精确撤销。

## 本地插件

开发版和正式版都可以直接从绝对路径加载同一种声明式插件包。桌面版可在 **已安装 → 加载本地插件** 中通过选择器选取文件夹；浏览器版可输入目录的绝对路径。该入口同时提供[插件格式与创建指南](./plugin-authoring.md)链接。也可以运行 `craft-hub plugin:link /插件目录的绝对路径`。本地插件会显示 **本地** 标记、跨重启保留，并覆盖同名市场版本而不修改原安装包。刷新插件列表或能力时会重新读取 Manifest，也可以使用 `craft-hub plugin:refresh <package>` 强制刷新；运行 `craft-hub plugin:unlink <package>` 后，会自动恢复同名市场版本。

关联本地目录属于用户显式信任操作，不具备 Catalog 完整性校验和发布者认证；但仍会校验包身份、Manifest Schema、Craft Hub 最低版本、文件路径边界、生命周期脚本和运行时依赖限制。本地修改不合法时，插件会保留在列表中并显示错误，其贡献会暂停启用，修复后可再次刷新恢复。

## 安装安全

确认安装前，Craft Hub 会递归解析根插件及其同源合集成员和强依赖闭包，拒绝缺失版本、不兼容的 Craft Hub 版本、冲突约束、阻断包和循环依赖，并返回按依赖优先排列、包含合并权限的安装计划。一次确认请求会安装新成员和依赖、重新启用兼容但已停用的插件，并跳过已启用版本。安装完成后，合集成员可以独立启停、更新或移除。

本地服务启动后，Craft Hub 会刷新已启用插件使用的市场源；当升级计划中的每个包都已从同一来源安装且权限集合完全不变时，会自动安装最新的 active 兼容版本，并保留上一版本用于回滚。新增权限或新增依赖的升级不会被自动批准，插件市场会将其作为手动升级展示，用户可先检查完整计划和合并权限。也可通过 `GET /api/plugins/updates` 检查安全升级，并以 `POST /api/plugins/updates` 应用。

Craft Hub 安装不可变 npm 版本时关闭生命周期脚本并排除开发依赖。声明式包不得声明运行时或可选 npm 依赖，贡献文件路径不得逃逸包目录。插件安装与 Project Trust 是两条独立边界：插件发现出的命令仍需目标 Project 获得显式信任后才能执行。
