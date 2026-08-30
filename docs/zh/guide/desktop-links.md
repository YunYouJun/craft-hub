# 桌面链接

在线页面可以请求已安装的 Craft Hub 桌面版显示工作台或某个项目。请使用普通链接，让浏览器和操作系统处理协议跳转：

```html
<a href="craft-hub://open?v=1">在 Craft Hub 中打开</a>
```

如需定位项目，请传入不含凭据的 HTTPS Git 远端地址；对于 monorepo 包，还可以传入仓库相对路径：

```text
craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub&subdir=apps%2Fweb
```

Craft Hub 会使用标准化后的 `origin` 与子目录匹配当前已注册项目。唯一匹配会直接打开；多个匹配需要用户选择；没有匹配时，用户可以选择已有的本地检出目录。Craft Hub 校验通过并得到用户确认后才会注册，且新项目仍为未信任状态。

桌面链接只负责导航。版本 1 不接受命令、本地路径、信任变更、克隆、片段、重复参数或未知参数。正式应用使用 `craft-hub://`，本地开发使用 `craft-hub-dev://`，避免覆盖已安装应用的协议处理器。

浏览器无法可靠判断自定义协议是否已经成功打开应用。链接应在没有 JavaScript 时仍可使用；也可以在短暂等待后显示安装或排查入口，但不要据此断言用户没有安装应用。
