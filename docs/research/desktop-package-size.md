# macOS 桌面包体积分析

测量日期：2026-10-10，macOS arm64，Electron 44.0.0。使用 `du -sk` 测量 `/Applications/Craft Hub.app` 的实际磁盘占用，统一换算为 MiB；这不是压缩 DMG、ZIP 或内存大小。

| 部分 | 原内置 Codex 包 | 已安装轻量包 |
| --- | ---: | ---: |
| 整个 `.app` | 607.14 MiB | 335.15 MiB |
| Electron 与辅助 Frameworks | 285.41 MiB | 285.41 MiB |
| `app.asar` | 47.51 MiB | 47.54 MiB |
| 原生依赖 `app.asar.unpacked` | 272.37 MiB | 0.43 MiB |

总共减少 **271.99 MiB，约 44.8%**。其余资源约 1.8 MiB，包括应用图标、签名等；Web UI 和依赖元数据位于 ASAR 内，不能再次与整个 ASAR 大小相加。

## 原包的大头

Codex 原生包只有 `aarch64-apple-darwin` 一个目标，不是重复携带 Linux、Windows 或 Intel Codex。最大的文件是 `codex`（219,273,440 B）、`codex-code-mode-host`（56,820,448 B）、`rg`（4,010,672 B）与 `zsh`（752,656 B）。这些是同一目标的运行组件，不能随意删除配套文件。

node-pty 仍有构建源文件、测试与 Windows ConPTY 源资源，已在部署后的副本中裁剪。每个架构的 packager `afterCopy` 再保留自己的 native prebuild，先验证目标资源与真实路径位于部署目录内。共享 staging 不按单个目标裁剪，缺少目标依赖时构建失败。

同源部署 staging 的逻辑文件字节合计：原始 324,678,311 B，常规裁剪后 320,988,254 B，轻量模式 38,485,047 B。单纯移除无用源码与平台资源约省 3.52 MiB；外部 Codex 模式再减少约 269.42 MiB。这些 staging 数值和最终 `.app` 的磁盘块占用口径不同。

## 默认使用本机 Codex

新 macOS 构建默认不携带 Codex CLI，保留 SDK 并按需调用本机已有安装，不改变共享 runtime、项目信任或已有 SDK 任务合同：

```sh
MACOS_ARCHES=arm64 pnpm package:mac

# 构建、替换本机应用并打开
pnpm reinstall:mac

# 兼容分发可以显式选择内置 CLI
MACOS_ARCHES=arm64 CRAFT_HUB_DESKTOP_CODEX_MODE=bundled pnpm package:mac
```

默认包通过固定宿主搜索规则找到可执行 Codex 并显式传入 `codexPathOverride`。打包元数据记录 `codexMode: external`；旧包缺少此字段时仍按原有内置模式解析。本机缺少 CLI 或 Node 时，软件中心、导航与环境页仍能打开；只在发起 Codex 任务时提示前往软件中心安装 Codex CLI，然后重试任务，不隐式联网下载。

本次本机验证：模拟 GUI `PATH=/usr/bin:/bin`，找到 `~/.local/bin/codex`，真实 SDK 构造成功，CLI `--version` 为 `0.162.0-alpha.17.2`，`exec --experimental-json --help` 成功。CLI 是已安装原生应用内二进制的链接。SDK 为 0.149.1；外部 CLI 由用户维护，版本变化可能影响协议兼容，未用此次测试发起付费模型任务。

搜索保留绝对 `PATH` 的优先级，并补充 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、系统目录、绝对 `PNPM_HOME` 与 `~/Library/pnpm`。fnm 使用绝对 `FNM_DIR` 或常见数据目录中的 `aliases/default/bin`，以及已安装版本的 `installation/bin`，供 npm / pnpm 的脚本 CLI 查找 Node；不执行终端或版本管理器初始化脚本。

没有 PATH 链接时，也会检查 `/Applications` 和 `~/Applications` 中 Codex / ChatGPT 应用的已知原生 CLI 路径。原生 CLI 无需单独安装 Node；脚本 CLI 仍需要可用的 Node。Windows 仅支持原生 `codex.exe`，不会执行 `.cmd` / `.bat` shim。

## 后续优化

- Electron Frameworks 约占轻量包的 85%，普通依赖与图标裁剪无法把整个应用缩小到几十 MiB。不要为体积删除可能影响渲染、GPU、沙盒或兼容性的框架文件。
- 现有 SDK 调用者完全迁移至外部工作台后，可进一步移除 SDK，但它的 JS 本体不是当前主要占用。
- 若目标低于 100 MiB，继续验证 Tauri + 系统 WebView，并完成无本机 Node 时的独立启动检查和引导。系统 WebView 差异、宿主功能与后端引导验证完成后再切换默认分发，不能把试验包体积当作同功能替代结果。
- DMG / ZIP 压缩降低下载体积，不降低安装后的 `.app`；需用统一功能和口径分别测量。

本轮通过完整 lint、根目录与 Web 类型检查、1006 项测试（另有 2 项平台相关跳过，串行运行）和构建；已安装轻量包签名检查及本地 API 健康检查通过，ASAR 与构建产物一致，元数据为 `codexMode: external`，没有内置 Codex CLI。软件中心读取到 Workstation 的 29 项目录、11 项可安装与 12 项可打开应用，本机 Codex CLI 已检测到。软件中心功能与后续待办见 [产品方向](../design/machine-workbench-direction.md)。
