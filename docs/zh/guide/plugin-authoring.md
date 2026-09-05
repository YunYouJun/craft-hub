---
title: 编写 Marketplace Plugin
description: 创建、校验、打包并在本地测试声明式 Craft Hub Marketplace Plugin。
---

# 编写 Marketplace Plugin

Craft Hub Marketplace Plugin 是纯声明式 npm 包。Craft Hub 读取 `package.json#craftHub` 并校验每项贡献，不会导入插件 JavaScript。只有嵌入应用确实需要加载可信可执行代码时，才应选择 Host Plugin。

[插件市场契约](./plugin-marketplace.md)说明了 Manifest 与 Catalog 的全部字段。在 API 仍处于 Alpha 阶段时，runtime 导出的 `pluginManifestV1Schema` 是唯一事实来源。

## 创建插件包

交互式初始化会询问包身份、展示名称、许可证和贡献类型：

```bash
craft-hub plugin:init ./my-plugin
```

Agent 和 CI 应使用确定性的非交互形式：

```bash
craft-hub plugin:init ./my-plugin \
  --non-interactive \
  --package @example/craft-hub-plugin-tools \
  --display-name "Example tools" \
  --license MIT \
  --with-command \
  --with-skill \
  --with-project-template
```

目标目录必须不存在或为空；初始化不会覆盖现有内容。包名必须采用带 scope 的 `craft-hub-plugin-*` 或 `plugin-*` 格式。包身份和许可证必须由作者明确提供，不能从 Git 或 npm 登录信息推断。

第一版作者工作流为三种贡献提供脚手架：

- `commands`：结构化的 `command` 与 `args`；不支持 shell 插值，执行前仍要求 Project Trust。
- `skills`：带稳定 `id` 的插件包内 Agent Skill 文件。新插件应显式声明；旧版 v1 条目未声明 ID 时保留按路径生成的标识。内容只安装一次，再按项目启用；可选的受限 `activation` 表达式用于自动匹配。
- `projectTemplates`：插件包内的项目模板目录。

发布前需要修改生成的占位内容。其他高级贡献类型暂时直接按照插件市场契约编辑，等出现真实需求后再增加专用脚手架。

### 声明技能自动启用条件

没有 `activation` 的技能只能手动启用，适合通用技能。框架或工具专用技能可以声明相关的项目事实：

```json
{
  "id": "widget-assistant",
  "path": "skills/widget-assistant/SKILL.md",
  "activation": {
    "all": [
      { "dependency": "@example/widget" },
      { "any": [{ "file": "widget.config.ts" }, { "file": "widget.config.js" }] }
    ]
  }
}
```

匹配器支持 `file`、`dependency`、`packageManager`、`all`、`any` 和 `not`，且只在项目根目录和 Craft Hub 已发现的 pnpm package 中求值。自动匹配需要插件声明 `read-project-files` 权限；整个过程只读，不执行插件或项目代码。

### 添加工作项原生状态流转

Host Plugin 可以实现 `workItems.transitions` 与 `workItems.updateStatus`，Marketplace Plugin 则声明对应的 `work-items.transitions` 和 `work-items.update-status` action。当同一集成通过 `work-items.get`、`work-items.search` 或 `work-items.list` 展示实体时，Craft Hub 会自动提供通用状态流转控件。

Renderer 会把实体的标量 `metadata` 连同 `itemId`、标题和当前状态传回 Provider。状态候选结果负责提供 Provider 原生目标状态及必填字段名。每次更新始终属于 `remote-write`：Craft Hub 会展示确认对话框、拒绝未经确认的调用，并通过 `context.confirmed` 把宿主确认结果传给可信 Provider。

## 校验

校验过程只读：

```bash
craft-hub plugin:validate ./my-plugin
```

它会检查 npm 身份与版本、当前 Manifest Schema、权限关系、包内相对路径、禁止的运行时依赖与安装生命周期脚本、Craft Hub 最低版本兼容性，以及 npm 实际会收入 tarball 的文件。命令使用 `npm pack --dry-run --ignore-scripts`，不会执行插件脚本。

## 本地测试

先通过校验，再检查绝对路径并明确执行关联：

```bash
craft-hub plugin:link /插件目录的绝对路径
craft-hub plugin:refresh @example/craft-hub-plugin-tools
```

关联状态会持久化到操作系统的 Craft Hub 数据目录，并覆盖同名的 Marketplace 安装版本。测试结束后移除覆盖：

```bash
craft-hub plugin:unlink @example/craft-hub-plugin-tools
```

## 打包并生成 Catalog Entry

Publisher 身份必须显式提供：

```bash
craft-hub plugin:pack ./my-plugin --publisher example
```

通过校验后，Craft Hub 会在禁用脚本的情况下打包，根据真实产物计算 SHA-512 integrity，并将 tarball 和经过校验的 Catalog Entry 草稿写入 `dist/`。命令不会覆盖已有产物，并会打印用于审查的绝对路径；它不会发布 npm 包，也不会修改 Plugin Catalog。

Catalog 维护者仍需在合并前审查 Publisher 身份、分类、兼容范围、权限和不可变版本。npm 发布与 Catalog 签名不属于该作者命令的职责。

## 可运行示例

[`examples/marketplace-plugin`](https://github.com/YunYouJun/craft-hub/tree/main/examples/marketplace-plugin) 是参与仓库测试的完整参考包。插件包不得包含运行时依赖、可选依赖或 npm 安装生命周期脚本。
