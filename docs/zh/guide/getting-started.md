# 开始使用

```bash
git clone https://github.com/YunYouJun/craft-hub.git
cd craft-hub
pnpm install
pnpm dev
```

新添加的项目默认不受信任。你可以先浏览能力和预览命令，明确设为可信后才能执行。

工作台在尚未注册项目时会展示三步安全引导。在 macOS 桌面应用中，可以随时选择 **帮助 → 重放开始使用引导（Replay Getting Started）** 再次查看；重放不会改变项目、信任或执行状态。

内置 MCP 适配器也支持 `add_project`、`list_workspaces`、`create_workspace` 和 `add_workspace_member`。这些工具通过 Craft Hub Runtime 修改状态，而不是直接编辑状态文件。添加项目或工作空间成员不会改变项目的信任状态，注册过程也不会执行项目代码。

项目注册属于本机状态。工作空间 manifest 是保存在 `~/.craft-hub/workspaces/` 下的可移植 JSONC；绝对路径和本机 binding 仍保存在操作系统的 Craft Hub 数据目录中。
