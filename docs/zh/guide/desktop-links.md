# 桌面链接

在线页面或本地集成可以请求已安装的 Craft Hub 桌面版显示特定导航目标。请使用普通链接，让浏览器和操作系统处理协议跳转：

```html
<a href="craft-hub://open?v=1">在 Craft Hub 中打开</a>
```

`open` 链接支持可选的 `home`、`marketplace` 和 `settings` 界面：

```text
craft-hub://open?v=1&view=marketplace
craft-hub://open?v=1&view=settings
```

可以通过稳定 ID 打开工作区：

```text
craft-hub://workspace?v=1&id=product-team
```

如果工作区属于某个 Team，请带上 owner scope；Craft Hub 会先切换 scope，再选中该工作区：

```text
craft-hub://workspace?v=1&id=release&scope=team-platform
```

如需定位项目，请传入不含凭据的 HTTPS Git 远端地址；对于 monorepo 包，还可以传入仓库相对路径：

```text
craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub&subdir=apps%2Fweb
```

附加 capability ID，可以在定位项目后打开对应详情：

```text
craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub&capability=command%3Adev
```

Craft Hub 会使用标准化后的 `origin` 与子目录匹配当前已注册项目。唯一匹配会直接打开；多个匹配需要用户选择；没有匹配时，用户可以选择已有的本地检出目录。Craft Hub 校验通过并得到用户确认后才会注册，且新项目仍为未信任状态。

桌面链接只负责导航。版本 1 不接受命令、本地路径、信任变更、克隆、片段、重复参数或未知参数。正式应用使用 `craft-hub://`，本地开发使用 `craft-hub-dev://`，避免覆盖已安装应用的协议处理器。

浏览器无法可靠判断自定义协议是否已经成功打开应用。链接应在没有 JavaScript 时仍可使用；也可以在短暂等待后显示安装或排查入口，但不要据此断言用户没有安装应用。

## 打开 Codex

Craft Hub 提供两个含义不同的 Codex 操作。**在 Codex 中新建任务**会使用当前项目启动 Codex，并复制准备好的提示词，供用户检查后发送。**在 Craft Hub 后台运行**会通过 Codex SDK 执行任务，在 Craft Hub 中保留任务记录和流式输出，并在任务停止运行后提供**在 Codex 中打开**操作。

打开已有任务时，Craft Hub 会将 `codex://threads/<thread-id>` 应用链接作为尽力兼容的桥接方式。该链接不属于公开的 Codex App Server 协议，因此 Craft Hub 不会依赖它完成持久化或执行。如果已安装的 Codex 版本无法处理该链接，任务仍可在 Craft Hub 中查看。需要稳定嵌入会话界面的集成应使用 [Codex App Server](https://learn.chatgpt.com/docs/app-server)。
