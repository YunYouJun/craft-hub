# 仓库接入约定

复用现有声明文件描述项目或发布 Workstation 配置源。Craft Hub 将这些文件作为数据发现和读取；项目 checkout 与配置执行由 Workstation 负责。

## 生成或修改声明

1. 从[普通项目模板](https://github.com/YunYouJun/craft-hub/tree/main/examples/repository-templates/project)或 [Workstation 配置源模板](https://github.com/YunYouJun/craft-hub/tree/main/examples/repository-templates/workstation-source)复制需要的文件。
2. 替换示例名称、`github.com/example` 和 `example.com` URL、软件元数据，保留版本字段、Schema 指针和 JSONC 注释。项目元数据引用已发现的命令 ID；可执行命令留在已有命令文件中。
3. 运行[只读校验](#统一只读校验)，存在 `projects.yaml` 时加载可信 Workstation Host Plugin。修复无效声明并补齐校验器，直到每份声明均返回 `valid`，且退出码为 `0`。
4. 提交前检查差异。声明用于共享；[设备绑定和凭据](#仓库身份与本机状态)留在本机。

## 文件职责

| 文件 | 权威数据与用途 | 格式说明 |
| --- | --- | --- |
| `README.md` | 仓库用途、初始化和校验方式 | 仓库文档 |
| `AGENTS.md` | 引导 AI 读取适用规范并完成验证 | 本指南及仓库自身规则 |
| `.craft-hub/project.jsonc` | 项目元数据、已发现命令和 Skills 的设置 | [项目配置](./configuration.md) |
| `.craft-hub/source.jsonc` 或 `craft-hub/source.jsonc` | 发布可移植的工作区成员关系 | [工作区来源（英文）](../../guide/workspace-sources.md) |
| `projects.yaml` | Workstation 仓库分组与 checkout 声明 | [Workstation 项目管理](https://github.com/YunYouJun/workstation/blob/main/docs/guide/projects.md) |
| `software.config.ts` | 使用字面量 `softwareGroups` 声明软件元数据 | [软件目录（英文）](../../guide/software-catalog.md) |

工作区成员与 checkout 分组是独立声明；校验不比较仓库清单，也不执行导入。配置源可以只发布需要的声明。环境配置内容和私有 Manifest 遵循 Workstation 的配置流程。

## 声明发现规则

`repo:validate` 只读取所选目录内的这些位置：

- 项目元数据：`.craft-hub/project.jsonc`。
- 工作区来源：`.craft-hub/source.jsonc` 或 `.craft-hub/source.json`，以及 `craft-hub/` 下对应文件。同一目录同时发布两种 bundle 文件会报告冲突。bundle 在所属目录内具有权威性；没有 bundle 时，读取该目录及其 `workspaces/` 子目录中的独立工作区 JSON/JSONC 文件。
- 软件目录：根目录 `software.config.ts`。
- Workstation 项目：根目录 `projects.yaml`、`projects.yml`、`projects.example.yaml`。存在的每个文件均返回检查结果；`projects.local.yaml` 不在扫描范围内。

工作区 fallback 在每个来源配置目录的根目录跳过已知元数据名称：`project`、`projects`、`catalog`、`dotfiles`、`config`、`user-config`、`owner-scopes`、`settings`，后缀为 `.json` 或 `.jsonc`。`workspaces/` 子目录中的同名文件仍按工作区格式检查。除单独校验的 `.craft-hub/project.jsonc` 外，这些被跳过的元数据文件不属于本期四类声明的校验范围。

每份声明限 256 KiB，文件及父目录须为普通文件和目录。发现范围仅限上述位置；软件中心等导入流程有各自的大小限制。

## 仓库身份与本机状态

共享工作区引用使用无凭据、无查询参数、无片段的 HTTPS 仓库 URL，保留 host 和 namespace，例如 `https://github.com/example/app`。Workstation 兼容已有 SSH 和短路径格式；共享模板优先使用 HTTPS，便于跨设备识别。

已有项目无特殊布局要求时，checkout 使用 `<checkout-root>/<host>/<namespace>/<repository>`。每台机器自行选择根目录，模板省略 Workstation 可选的 `root`。Craft Hub 本机数据目录保存路径绑定、订阅、工作区选择和执行信任。凭据、真实私有 Manifest、session 文件和本机覆盖项留在共享声明之外，或放入被忽略的本地文件。私有仓库身份只在适当的仓库可见范围内共享。

加载读取声明并生成预览，新注册项目初始为未信任。安装、克隆、配置变更和恢复沿用授权与预览流程；目录声明不授予执行权限。

## Schema 与兼容性

编辑器 Schema 指针用于提示；实际校验复用本地解析器，不请求指针 URL。

| 声明 | 编辑器 Schema |
| --- | --- |
| 项目 JSONC | [`project-v1.schema.json`](https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/project-v1.schema.json) |
| 工作区来源 JSONC | [`workspace-source-v1.schema.json`](https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/workspace-source-v1.schema.json) |
| Workstation 项目 YAML | [`projects.schema.json`](https://raw.githubusercontent.com/YunYouJun/workstation/main/schemas/projects.schema.json) |
| 软件 TypeScript | 现有静态 AST 解析器；`export const softwareGroups = [...] as const` |

独立工作区 JSON/JSONC 文件使用工作区来源 Schema URL，并追加 `#/$defs/workspace`。

项目元数据使用 `version: 1`，工作区来源使用 `schemaVersion: 1`，Workstation 项目保持无版本字段格式。核心 JSONC Schema 拒绝未知字段；项目的第三方数据放在 `extensions.<provider>` 下。按各自兼容规则扩展现有格式。

维护者用 `pnpm schema:project:check`、`pnpm schema:source:check`，以及 Workstation 仓库中的 `pnpm projects:schema:check` 检查漂移。修改权威 Schema 后，运行对应的无 `:check` 命令重新生成。

## 统一只读校验

```sh
craft-hub repo:validate /path/to/project --json
craft-hub repo:validate /path/to/configuration-source --json \
  --host-plugin @craft-hub/craft-hub-plugin-workstation
```

提前安装并显式信任 Host Plugin。它协商 repository validation 协议 v1 与操作支持，再把 YAML 内容委托给 Workstation `host-json` 请求 `{ "version": 1, "operation": "validate-projects", "content": "..." }`。被检查声明不能决定加载哪些主机模块。旧版 CLI 或缺少校验器时，YAML 返回 `unsupported`，退出码非零，同时返回其他声明的结果。

在 Craft Hub checkout 中，可使用等价的开发命令：

```sh
pnpm repo:validate examples/repository-templates/project --json
pnpm repo:validate examples/repository-templates/workstation-source --json \
  --host-plugin "$PWD/packages/craft-hub-plugin-workstation/dist/index.mjs"
```

第二条命令需要先构建 Host Plugin，并使用兼容的 Workstation CLI。校验不运行仓库脚本、不导入 `software.config.ts`、不访问 Git 远端，也不改变 Craft Hub 状态。未发现声明时返回 `no-configurations`，校验失败。

JSON 报告包含 `version: 1`、`valid`、`files`、顶层 `issues` 和 `summary`。每个文件返回 `file`、`format`、`validator`、`status`（`valid`、`invalid` 或 `unsupported`）和 `issues`。问题含字段路径、说明及可用的行列定位。通过表示结构与解析语义有效；远端访问权限和软件可安装性由各自工作流验证。
