# 个人云实施任务

## 实施原则

- 第一版只实现 YunLeFun 登录、可移植信息同步和异步 command capability 请求。
- 复用现有 `CraftHubRuntime.run()`、trust 校验、运行记录、取消和 Electron 设置页。
- 不实现云端 Codex Agent Task、对话、终端、日志流、运行历史、远程 trust 或任意 shell。
- CloudBase 仅是个人云 Adapter；不扩展公开插件 ABI，不影响未启用个人云时的本地行为。

## 任务清单

- [x] 1. 固化可移植快照与远程执行复用边界
  - 为 workspace 和允许同步的设置定义最小 `PortableWorkbenchSnapshot`，以允许字段重新构造数据。
  - 增加 portable project key 的本机解析，缺失项目保持 unresolved，绑定不转移 trust。
  - 为快照排除路径、binding、trust、凭证、run、终端和 Codex task/thread 编写测试。
  - 远程执行只调用现有 `CraftHubRuntime.run()`，不新增 executor 或 Agent Task 模型。
  - _需求：2、4、5_

- [x] 2. 实现最小个人云深模块
  - 新增私有 `@craft-hub/personal-cloud` 包，只暴露连接状态、同步、轮询启停和请求处理的窄接口。
  - 实现 CloudBase HTTP Adapter 与内存 Adapter；不修改 `CraftHubPlugin` 公共接口。
  - 实现 revision/CAS 同步：相同 revision 幂等，双边修改保留冲突，不做自动合并 UI。
  - 实现 command 请求校验、去重、过期检查、项目解析、trust 检查和本地批准回调。
  - 用内存 Adapter 验证云端失败不阻塞本地 runtime，合法请求最多执行一次。
  - _需求：2、4、5_

- [x] 3. 实现桌面设备身份与连接回跳
  - 在 Electron main process 生成 Ed25519 设备密钥，使用 `safeStorage` 加密后存入系统数据目录。
  - 当安全存储不可用或 Linux 使用 `basic_text` 时拒绝启用个人云。
  - 注册 `craft-hub://cloud/connect`，严格校验 scheme、host、challenge 和一次性 code。
  - 实现规范请求签名；preload 仅暴露状态、连接、断开和立即同步，不暴露密钥或通用签名方法。
  - 补充密钥存储、协议回跳、签名规范化和 preload 权限测试。
  - _需求：1、3、5_

- [x] 4. 实现并本地验证 CloudBase 后端
  - 实现单个 Node.js HTTP Function BFF，包含 YunLeFun 双证明登录、一次性设备注册、设备签名认证、同步、heartbeat、请求创建/领取/状态更新。
  - 使用唯一索引、TTL、事务和领取租约保证 code/nonce 单次消费与 request 最多执行一次。
  - 使用内存 repository 运行 HTTP contract tests，覆盖白名单、Origin、CSRF、撤销、重放和日志脱敏。
  - _需求：1、2、3、4、5_

- [ ] 4.1 在获批环境中准备 CloudBase 资源
  - 获得 canonical EnvId 后，确认应用登录 provider、Publishable Key、函数公开访问范围和数据安全规则。
  - 创建 bootstrap code、device、sync document、sync conflict、remote request、device nonce 和 YunLeFun app session 所需集合。
  - 此项属于部署 gate；本地代码提交不创建或修改线上资源。
  - _需求：1、2、3、4、5_

- [x] 5. 接入桌面生命周期与最小设置界面
  - 在 desktop 启动后按配置创建个人云模块；失败仅显示 disabled/error，不影响本地 server 和窗口。
  - 实现 60 秒 heartbeat/同步与 5 秒请求轮询，包含上限退避、抖动、断网恢复和退出清理。
  - 领取有效请求后使用 Electron 原生确认框；批准后调用现有 runtime，拒绝后只上报状态。
  - 在现有设置对话框增加账号、设备、最近同步状态及连接/断开/同步操作，不新建设备管理页面。
  - _需求：1、2、3、4、5_

- [x] 6. 实现最小移动 Web
  - 复用 YunLeFun SSO 包完成登录和回调。
  - 仅提供设备选择、project key、command capability ID、提交和状态查看。
  - 不展示终端输出、Codex 对话、运行历史或远程 trust 操作。
  - 展示设备在线、离线和撤销状态，仅允许向可用设备投递。
  - _需求：1、3、4、5_

- [ ] 6.1 部署并验证真实移动 Web
  - 使用 CloudBase 首次应用部署流程创建托管 Web。
  - 在真实环境验证未登录、白名单拒绝、设备撤销、请求过期和移动端窄屏流程。
  - _需求：1、3、4、5_

- [x] 7. 完成本地端到端验证与文档
  - 执行 `pnpm lint`、`pnpm typecheck`、`pnpm test --run` 和 `pnpm build`，修复本次变更引入的问题。
  - 在本地内存 Adapter 下验证登录后状态、同步冲突、离线恢复、批准/拒绝及最多执行一次。
  - 记录环境变量、资源初始化、开发/生产隔离、回滚和删除个人云数据的方法。
  - _需求：1、2、3、4、5_

- [ ] 7.1 执行真实环境 smoke test
  - 在真实 CloudBase 环境验证 YunLeFun 登录、设备注册、同步、移动端投递、桌面批准、状态回传和设备撤销。
  - 当前工作区未配置 CloudBase 环境或凭证；此项不得用本地测试替代。
  - _需求：1、2、3、4、5_
