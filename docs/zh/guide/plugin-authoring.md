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
- `skills`：插件包内的 Agent Skill 文件。
- `projectTemplates`：插件包内的项目模板目录。

发布前需要修改生成的占位内容。其他高级贡献类型暂时直接按照插件市场契约编辑，等出现真实需求后再增加专用脚手架。

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
