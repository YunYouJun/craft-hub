# Microsoft To Do 聚合接入核查

2026-10-13 实现补记：Electron 已内置独立的 Host Plugin，默认只读，使用固定版本的本地连接器提供设备码授权、个人非共享列表及未完成待办的完整分页读取。首页提供授权状态、原有列表与智能分类（全部／重要／已逾期／已计划／今日到期）、搜索、分组预览、手动刷新及最近成功时间；显示选项可保存分组、密度与空列表偏好。快速记录在用户单独授权任务创建后，通过独立连接器写入审阅确认的任务；当前页面刷新失败保留旧结果，尚未实现持久化离线缓存或 delta 同步。接入步骤和限制见 [插件说明](https://github.com/YunYouJun/craft-hub/blob/main/packages/craft-hub-plugin-microsoft-todo/README.md)。以下调研中的建议保留为后续路线，不代表全部已实现。

核查日期：2026-10-12。范围：Craft Hub 插件方案，未登录账号、读取实际待办或实施接入。

## 结论

可以聚合桌面 Microsoft To Do 同一账号中已同步到云端的待办。官方集成接口是 Microsoft Graph To Do API；原生客户端和其他设备通过云端同步任务。[To Do API 概览](https://learn.microsoft.com/en-us/graph/todo-concept-overview)、[账号同步](https://support.microsoft.com/en-au/todo/syncing-your-microsoft-to-do-account)

建议独立提供 `craft-hub-plugin-microsoft-todo`，首版只读，接入用户选择的自有非共享列表。Craft Hub 保存项目关联与工具偏好，Microsoft To Do 保持待办状态来源。不要读取、修改或逆向原生应用本地数据库；本次核查的官方文档提供 Graph 契约，没有将该数据库作为支持接口的依据。

## 账号与授权前置条件

- Graph v1.0 的读取列表和任务接口支持个人 Microsoft 账号及工作/学校账号；最小委托权限均为 `Tasks.Read`。[列表接口](https://learn.microsoft.com/en-us/graph/api/todo-list-lists?view=graph-rest-1.0)、[任务接口](https://learn.microsoft.com/en-us/graph/api/todotasklist-list-tasks?view=graph-rest-1.0)
- 工作/学校账号使用 To Do 还需要适用的启用许可与 Exchange Online 邮箱。支持账号类型不代表每个账号已经满足服务前置条件。[To Do 服务要求](https://support.microsoft.com/en-us/todo/set-up-microsoft-to-do)
- 应用必须在 Microsoft Entra 注册；支持账号类型由注册配置决定。建议初期验证个人账号，再验证工作/学校账号，发布时明确注册由谁维护。[注册应用](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
- `Tasks.Read` 权限参考标为无需管理员同意，但租户同意策略仍可阻止用户授权。截至核查日，微软管理的推荐默认策略将 `Tasks.Read` 和 `Tasks.ReadWrite` 排除在普通用户可同意的权限之外。建议将“需要管理员授权”作为可解释的接入状态，不承诺所有组织账号一键连接。[权限参考](https://learn.microsoft.com/en-us/graph/permissions-reference#tasksread)、[同意策略](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies)
- v1.0 列表、任务接口的部署表不支持由世纪互联运营的中国区云，不能仅替换 Graph 域名承诺兼容。[列表部署范围](https://learn.microsoft.com/en-us/graph/api/todo-list-lists?view=graph-rest-1.0)

## 本地公共应用认证

桌面应用属于公共客户端，无法安全保存应用级 client secret。微软提供 Electron + MSAL Node 的授权码与 PKCE 示例，MSAL Node 支持并推荐公共客户端使用 PKCE。[公共与机密客户端](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications)、[Electron 教程](https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-v2-nodejs-desktop)、[MSAL Node 公共客户端](https://learn.microsoft.com/en-us/entra/msal/javascript/node/initialize-public-client-application)

建议由本地运行时中的 provider 通过系统浏览器完成授权码 + PKCE，在安全存储中保存用户令牌缓存；UI 和声明式插件只持有连接引用。不要把 client secret、refresh token 或认证缓存写入插件 manifest、项目元数据、共享配置或 Git。

Device code 可作为 CLI 或回调受限环境的备选：MSAL Node 提供 `acquireTokenByDeviceCode()`；该流程面向缺少浏览器或输入受限的公共客户端。平台文档说明可使用适当 authority 支持工作/学校及个人账号。建议桌面默认使用浏览器授权，不把 device code 作为首选体验。[MSAL Node 获取令牌](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests)、[Device code 与个人账号](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/desktop-mobile/device-code-flow)

## 读取与同步策略

| 操作 | v1.0 接口 | 核查结果与建议 |
| --- | --- | --- |
| 发现列表 | `GET /me/todo/lists` | `Tasks.Read`；首版周期性完整发现列表 |
| 读取列表任务 | `GET /me/todo/lists/{listId}/tasks` | `Tasks.Read`；必须读完所有分页 |
| 列表增量 | `GET /me/todo/lists/delta` | 官方委托权限表仅列 `Tasks.ReadWrite`，只读首版不用 |
| 每列表任务增量 | `GET /me/todo/lists/{listId}/tasks/delta` | 官方表同时列 `Tasks.ReadWrite` 和 `Tasks.Read`，但最小/更高权限顺序反常；先验证仅 `Tasks.Read` 可用，失败时退回普通 GET，不自动扩大权限 |

来源：[读取列表](https://learn.microsoft.com/en-us/graph/api/todo-list-lists?view=graph-rest-1.0)、[读取任务](https://learn.microsoft.com/en-us/graph/api/todotasklist-list-tasks?view=graph-rest-1.0)、[列表 delta](https://learn.microsoft.com/en-us/graph/api/todotasklist-delta?view=graph-rest-1.0)、[任务 delta](https://learn.microsoft.com/en-us/graph/api/todotask-delta?view=graph-rest-1.0)。任务 delta 的权限表不一致是上线前验证项，本次未使用真实账号验证。

分页须沿用完整 `@odata.nextLink`，直至不再返回。delta 一轮沿用 `nextLink`，结束后保存完整 `deltaLink`；它不是一次返回全部变化。[Graph 分页](https://learn.microsoft.com/en-us/graph/paging)、[任务 delta 状态](https://learn.microsoft.com/en-us/graph/api/todotask-delta?view=graph-rest-1.0)

Graph 建议本地缓存与周期同步；delta 可能延迟、重复或失效，`410 Gone` / `syncStateNotFound` 需重建同步状态。限流时按 `429` 的 `Retry-After` 退避。[To Do 缓存建议](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0)、[delta 语义](https://learn.microsoft.com/en-us/graph/delta-query-overview)、[限流](https://learn.microsoft.com/en-us/graph/throttling)

建议显示每个来源最后成功同步时间、离线/过期状态及手动刷新入口。离线时展示 Craft Hub 自己的最近成功缓存。由云端接口聚合意味着原生客户端尚未上传的本地修改暂不可见，这是基于云端同步契约的推论；不要将安装了原生应用等同于可离线读取它的全部最新数据。[原生客户端同步](https://support.microsoft.com/en-au/todo/syncing-your-microsoft-to-do-account)

## 通用事项映射与来源链接

`todoTask` 提供标题、状态、重要性、到期时间、修改时间；公开属性中没有 `assignee` 或任务自身的 `webUrl`。任务移动列表时其 ID 默认会变化。[任务资源](https://learn.microsoft.com/en-us/graph/api/resources/todotask?view=graph-rest-1.0)

建议以账号、列表 ID、任务 ID 组成来源键；显式绑定项目，避免用标题相似度自动合并。首版只处理自有非共享列表，并在通用模型表达“属于当前连接用户的个人事项”，不要虚造受派人以迁就按 assignees 过滤的个人总览。列表的 `isOwner` / `isShared` 可用来筛选。[列表资源](https://learn.microsoft.com/en-us/graph/api/resources/todotasklist?view=graph-rest-1.0)

`linkedResource.webUrl` 指向任务关联的外部资源，可能不存在，不等于 To Do 任务详情链接。创建 linkedResource 需要 `Tasks.ReadWrite`。[关联资源](https://learn.microsoft.com/en-us/graph/api/resources/linkedresource)、[创建关联资源](https://learn.microsoft.com/en-us/graph/api/todotask-post-linkedresources?view=graph-rest-1.0)

建议首版提供“打开 Microsoft To Do”官方 Web 入口，展示任务标题和列表以便定位；不要拼接未获官方契约保证的逐任务 URL。可另外打开 provider 返回的外部资源链接。完整任务详情深链或原生协议留作实测扩展。

## 只读首版与后续完成写回

建议首版交付连接/断开、选择列表、全部选中列表的待办聚合、项目绑定、打开项目和工具、来源刷新状态；不创建、编辑或完成源任务。验收覆盖分页、断网缓存、重复增量、令牌失效、权限拒绝、断开清理及项目绑定持久化。

后续可单独请求 `Tasks.ReadWrite`，通过 `PATCH /me/todo/lists/{listId}/tasks/{taskId}` 将 `status` 更新为 `completed`。这是独立增权和源系统写入功能，应先确认源返回成功，再更新本地状态；离线写入队列与冲突处理另设里程碑。[更新任务](https://learn.microsoft.com/en-us/graph/api/todotask-update?view=graph-rest-1.0)

本文是方案核查；账号可用性、公共应用注册配置、只读 delta 权限及深链均未替代真实联调验收。
