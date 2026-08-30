---
title: 插件市场
description: 了解 Craft Hub 的市场源与声明式插件机制。
---

# 插件市场

Craft Hub 的交互式插件市场位于桌面应用与本地 Web 工作台中。它会合并本机已配置市场源的 Catalog，展示插件权限与兼容性，并在安装前要求明确确认。

## 公共目录

::: info 早期 Alpha
Craft Hub 目前尚未附带中央公共 Plugin Catalog，因此本站暂时没有官方插件条目可列出。本页是稳定的公开市场地址；后续发布官方 Catalog 时，无需更换路由即可在此展示。
:::

第三方 Distribution 可以提供内置或托管市场源。你也可以在插件市场的**市场源**页签中预览并添加 HTTPS Catalog；Craft Hub 会先验证完整 Catalog，再保存配置。

## 打开交互式插件市场

运行 Craft Hub 后，在活动栏中选择**插件市场**。仅进行浏览器开发时，可以启动本地工作台：

```bash
pnpm dev:web
```

工作台路由是 `/marketplace`。其中内容来自本地运行时 API，因此公开文档站点不会复制用户已安装的插件或私有市场源。

关于包格式、市场源验证、生命周期状态与安装安全边界，请阅读[插件市场指南](/zh/guide/plugin-marketplace)。

::: warning 扩展模型彼此独立
Craft Hub Marketplace Plugin 是声明式包。Host Plugin 与 Codex plugin 使用不同的信任和 Manifest 模型，不在此处列出。
:::
