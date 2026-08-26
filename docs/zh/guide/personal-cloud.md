# 个人云（实验性）

个人云是可选功能，用于同步可移植的工作区信息，并从移动 Web 向已连接桌面投递异步命令请求。它不会同步本机路径、trust、凭证、运行记录、终端输出或 Codex 任务，也不会提供任意 shell。

## 环境隔离

开发与生产必须使用不同的 CloudBase 环境、域名、Publishable Key、API Key 和 YunLeFun SSO 应用。不要让开发客户端连接生产集合。桌面端未设置 `CRAFT_HUB_CLOUD_ENDPOINT` 和 `CRAFT_HUB_CLOUD_ORIGIN` 时，个人云保持禁用，本地功能不受影响。

CloudBase HTTP Function 使用以下服务端变量：

```text
CLOUDBASE_ENV_ID
CLOUDBASE_APIKEY
CRAFT_HUB_CLOUD_ORIGIN
CRAFT_HUB_SESSION_SECRET
YUNLEFUN_SSO_APP_ID
YUNLEFUN_SSO_CLIENT_ID
YUNLEFUN_SSO_ISSUER
YUNLEFUN_SSO_JWKS_URL
YUNLEFUN_ALLOWED_SUBJECTS
```

移动 Web 使用以下公开构建变量：

```text
VITE_CLOUD_API_URL
VITE_CLOUDBASE_ENV_ID
VITE_CLOUDBASE_REGION
VITE_CLOUDBASE_PUBLISHABLE_KEY
VITE_YUNLEFUN_SSO_CLIENT_ID
VITE_YUNLEFUN_SSO_EXCHANGE_URL
VITE_YUNLEFUN_REDIRECT_URI
```

## 资源初始化

部署前在目标环境创建 `cloudfunctions/personal-cloud/resources.json` 中列出的服务端集合与索引，并按 `@yunlefun/server-session-cloudbase` 的版本说明创建会话集合。所有集合应禁止浏览器直连，由个人云 HTTP Function 统一执行身份、Origin、CSRF 和设备签名校验。

部署顺序为：确认规范 EnvId 与登录配置，创建集合和索引，配置函数变量并部署函数，部署移动 Web，最后向桌面注入端点和 Origin。完成后依次验证登录、设备注册、同步冲突、请求批准/拒绝、状态回传、重放拒绝和设备撤销。

## 验证状态

仓库内的 HTTP contract tests 使用内存 repository 验证 Origin、CSRF、设备签名、重放拒绝、跨设备文档恢复、三方同步冲突和过期领取租约恢复。它们只验证代码契约，不能替代真实 CloudBase 环境的资源、权限和网络 smoke test。

提交此实现时，开发工作区没有配置 CloudBase EnvId、服务端 API Key、托管端点或 YunLeFun SSO 应用参数，因此没有创建或修改线上资源。首次部署必须单独完成部署 gate，并记录所用 canonical EnvId 与验证结果。

## 回滚与删除

回滚时先撤下移动 Web 或关闭入口，再清除桌面端两个个人云环境变量并重启桌面应用；这会立即恢复为纯本地模式。随后停止或回滚 HTTP Function。不要在仍有客户端连接时直接删除集合。

删除个人数据时，先撤销用户全部设备，再删除该用户在设备、同步文档、同步冲突、远程请求、nonce、bootstrap code 和应用会话集合中的记录。确认无需恢复后，才删除空集合或整个独立开发环境。生产环境的集合删除属于不可恢复操作，必须另行确认。
