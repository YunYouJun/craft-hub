# 插件市场

Craft Hub 有两套刻意隔离的扩展模型：

- **Host Plugin（宿主插件）**是嵌入应用显式加载的可信代码依赖；加载时会执行 JavaScript。
- **Marketplace Plugin（市场插件）**是由 Plugin Catalog 提供的声明式包；Craft Hub 只读取 `package.json#craftHub`，不会导入包代码。

Codex 插件使用另一套 Manifest，不属于 Craft Hub Marketplace Plugin。

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
  "projectFiles": [],
  "permissions": ["commands"],
  "contributes": {
    "commands": [],
    "commandPresets": [],
    "commandTemplates": [],
    "skills": [],
    "projectTemplates": []
  }
}
```

## Catalog 契约

Plugin Catalog 列出不可变的包版本。每个 Catalog Entry 包含精确包名、版本、SHA-512 SRI integrity、Publisher、权限集合、分类和生命周期状态，并可以复制 Manifest 的发现元数据。

- `requires`：兼容 Craft Hub 版本的 SemVer range。
- `status`：`active`、`deprecated` 或 `blocked`。
- `statusReason`：`deprecated` 和 `blocked` 必填。
- `replacement`：可选的替代 Marketplace Plugin 包名。

Catalog 的权限和权限说明必须与已安装包的 Manifest 一致。完整性、身份、权限、权限说明或兼容范围不一致时，Craft Hub 拒绝安装。

## 生命周期

- **active**：推荐且可安装。
- **deprecated**：仍可安装，但必须给出迁移说明，可推荐替代插件。
- **blocked**：禁止安装，并停用 Catalog 中精确匹配的已安装版本。

Catalog 维护者应保留被阻断的版本条目，让客户端能够实施精确撤销。

## 安装安全

Craft Hub 安装不可变 npm 版本时关闭生命周期脚本并排除开发依赖。声明式包不得声明运行时或可选依赖，贡献文件路径不得逃逸包目录。插件安装与 Project Trust 是两条独立边界：插件发现出的命令仍需目标 Project 获得显式信任后才能执行。
