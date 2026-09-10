# 开发环境配置管理

可信 Host Plugin `@craft-hub/craft-hub-plugin-workstation` 在 Craft Hub 提供「开发环境」入口。桌面版内置适配器；浏览器连接同一本地服务。云端运行模式拒绝读取或修改设备配置。

## 本地启动

先构建提供 v1 接口的 workstation，再构建 Craft Hub。在宿主环境指定后端可执行文件：

```sh
# workstation 仓库
pnpm build
# Craft Hub 仓库
pnpm build
export CRAFT_HUB_WORKSTATION_COMMAND=/absolute/path/to/workstation/packages/cli/dist/cli.js
pnpm --filter craft-hub exec tsx src/cli.ts ui \
  --host-plugin /absolute/path/to/craft-hub/packages/craft-hub-plugin-workstation/dist/index.mjs
```

桌面启动进程使用同一个环境变量。未指定时使用 PATH 中的 `workstation`；不支持 JSON 接口的旧 CLI 会明确报错。公开源、私有源继续使用 workstation 现有配置和 `private connect` 流程，也可使用其已有 `DOTFILES_REPO_ROOT`、`WORKSTATION_PRIVATE_MANIFEST`、`DOTFILES_HOME`、`CODEX_HOME` 环境变量。浏览器不能提交任意本机命令。

## 处理配置差异

1. 在「开发环境」筛选 MCP、skills、全局指令或终端配置。
2. 点击条目查看来源、归属、本机路径、源文件路径及脱敏差异。状态包括已同步、本机修改、源端修改、双方冲突、首次接管、未纳管、不可写和扫描失败。没有历史基线时不会伪装成三方合并。
3. 选择「保留本机 → 更新源文件」「使用源配置 → 更新本机」「按字段/行合并 → 更新双方」或「暂不处理」。合并必须逐一明确选择变化字段或对齐行的来源。
4. 点击预览，检查所有修改路径、方向及删除项。预览仅保存本机方案，不修改配置、不提交 Git。
5. 明确应用后，workstation 再次核对源、目标、manifest 和基线版本，备份并安全写入。源文件写入要求密钥扫描成功。
6. 失败时查看应用及恢复记录。若文件仍与方案输出一致，可从备份恢复；存在后续独立修改时拒绝覆盖。部分完成或中断的操作保留恢复记录。

用户维护的 skill 通过私有 manifest 中 `skills.install` 声明 **local** 目录来源后可同步，目录内的文档和辅助文件逐项展示。未声明来源的用户 skills 仍列为未纳管。符号链接、系统目录、插件缓存及安装器锁标记的 skills 由原安装器管理。项目 MCP 单独展示，只读。全局同步不迁移登录态、缓存或执行授权字段。

## 拉取、提交与发布

仓库区域展示未提交文件、未推送数量、远端领先、分叉和待发布提交的标识及变更行数。远端状态基于上次 fetch；未设置 upstream 显示未知。拉取仅更新源仓库，不自动应用本机。

提交前选择纳管源文件，填写说明，审阅后明确确认；已有暂存内容时拒绝提交。发布需单独审阅和确认，复用 workstation 的密钥扫描及禁止强推机制。断网、远端领先或分叉会报告原因并保留内容；不自动重写历史。

## 已知限制

- 正文和未知字面值保守隐藏；仅展示受限的安全 MCP 信息。文本 `!` 表示该位置不同，`=` 表示一致；隐藏内容不会被写回。需要审阅完整私密正文时使用设备本地编辑器。
- 文本合并按对齐行逐项选择，不是语义合并或自动三方合并，需仔细审阅插入与删除。MCP/TOML 和 Zsh 有语法校验，通用 skill 文件、Ghostty 没有完整语义校验。
- 整个已声明 MCP fragment 缺失视为扫描失败；单个服务器或 skill 文件删除可管理。二进制、过大、符号链接和特殊文件不支持写入。
- 多文件操作依靠记录恢复，不是一个系统原子事务。外部编辑器不遵守 workstation 锁，替换前会再次检查版本。崩溃遗留锁需要确认进程退出后手动处理。
- gitleaks 不可用或扫描失败时阻止源写入、提交及发布。upstream 设置、Git 分叉处理、安装器更新和备份自动清理仍使用原工具。
- 本实现使用独立 worktree，未混入主工作区正在进行的资源页和 Codex 配置改动；后续合入时需协调通用协议，不能整体覆盖那些未提交改动。

恢复记录保存在设备的 `~/.local/state/workstation/configuration-v1`。其中可能包含真实密钥，目录和文件有受限权限，不应提交到 Git 或迁移到其他设备。

合并后的页面复用社区宿主的工作台标题、共享控件和主题变量，下游发行版使用同一份渲染代码。配置同步适配器与现有 Codex 配置查看功能共存；云端宿主禁止访问这两类本机配置入口。
