# 部署与发布

## 官方托管边界

本授权网关代表 NiegeIP 平台处理短信登录，必须由平台维护者部署在受控官方域名。不要让用户在未知第三方托管的实例输入验证码。公开源码不代表任何第三方部署自动可信。

网关需要私有平台 API 的 HTTPS 地址，以及一个独立官方 HTTPS origin。`NIEGEIP_ISSUER` 必须是无路径、query、fragment 的 origin，MCP 固定为 `/mcp`。正式模式不接受明文 HTTP 上游。

```dotenv
NIEGEIP_LOCAL=false
NIEGEIP_ISSUER=https://YOUR-OFFICIAL-HOST
NIEGEIP_API_URL=https://YOUR-PLATFORM-API/api/web
NIEGEIP_HOST=127.0.0.1
PORT=8787
NIEGEIP_STATE_PATH=/var/lib/niegeip-mcp/oauth.enc
NIEGEIP_STATE_KEY=GENERATE_64_HEX_CHARACTERS_IN_SECRET_MANAGER
NIEGEIP_CLIENT_ORIGINS=
```

示例 key 是提示文字，不能直接启动。用 secret manager 注入真正的 32 字节随机 hex key。状态密钥和状态文件需配套备份；丢失/轮换密钥时旧连接失效，用户重新授权。不要把密钥打印到聊天、构建日志或仓库。

## 运行

```sh
npm ci
npm run build
node dist/main.js
```

上面的生产命令读取进程环境；`npm run dev` 和 `npm start` 读取本地 `.env`。监听可交给 systemd 或容器管理；配置目录和运行用户仅授予所需权限。

本版必须 **单副本、单写者**。状态文件以加密原子 rename 保存，权限 0600，目录默认 0700；同目录存在 `.lock` 时拒绝启动。异常退出后必须确认旧进程已停止再删除 `.lock`，不能在仍有运行实例时删除。不要把状态目录放入源代码镜像或共享给多个副本。

反向代理必须保留配置中的确切 Host（包括非默认端口），关闭 `/authorize`、`/connect`、`/token`、`/mcp` 的 query/body/header 访问日志；代码不记录这些值。OAuth 回调 URL 含短期 code，同样不应写入代理日志。

应用默认不信任 `X-Forwarded-For`，避免可伪造 IP 绕过限流。代理后应用限流会按代理地址聚合；生产应在可信入口再设置每源 IP 的短信/登录限流，并按实际流量调整应用限额，不能直接开启无边界的 `trust proxy=true`。平台既有手机号发送频率和登录准入校验继续生效。

## OAuth 运维

- Client 通过 `/register` 动态注册 public client，回调支持 HTTPS 或 loopback HTTP，并与授权码绑定。
- 浏览器确认页展示应用名称和回调 origin；应用名称是客户端自报信息，不表示经过平台认证。
- 用户需明确勾选权限同意项；浏览器会话通过 HttpOnly SameSite Cookie、Origin 和短期请求绑定防护。
- 授权请求 10 分钟、code 60 秒、access token 最多 1 小时、授权会话最多 7 天。平台会话先过期时必须重新登录，网关不会延长平台权限。
- Refresh token 每次轮换，重用已消费 refresh token 会撤销整组授权。`/revoke` 可使用本客户端的 access 或 refresh token 撤销整组授权。
- 此版本通过客户端断开/撤销入口操作；尚未新增平台“已连接应用”管理页面。平台登出导致上游 Token 失效后，访问无法继续。
- 状态最多 20000 项。大规模使用前需要数据库/Redis 的原子事务、配额与清理作业；不要仅增加副本数。

## 上线验收

1. HTTPS、资源 metadata、AS metadata、PKCE 和完整 resource URL 互相一致。
2. 使用实际目标客户端完成安装/连接和浏览器登录，验证错误验证码、取消、重新授权。
3. 开发账户持有获批订单，确认仅出现其资产，三图原尺寸下载可读取。
4. 测试另一用户、未支付、过期、退款、下架、缺图、存储错误与 429；不得用生产用户数据作测试 fixture。
5. 测试 access 到期、refresh 重用、撤销和服务重启恢复。
6. 对照合同配置外部下载许可；至少保留订单授权和网关部署审批的内部记录。
7. 配置 Plugin 正式 HTTPS URL，`npm run check` 后发布 Git 仓库。

当前自动测试覆盖协议、授权与下载的隔离行为，不包含真实短信、MySQL、TOS 或各厂商 Agent 的线上兼容性验收。

## 2026-10-16 生产连接检查

已从官网发布的前端资源确认平台 API 根地址为 `https://web.api.niegeip.com/api/web`。`api.niegeip.com` 未解析到可连接地址；`niegeip.com` 是官网前端，直接访问 `/mcp` 返回 HTML，不能视为 MCP 接口。

对 `web.api.niegeip.com` 的只读检查：

| 路径                                                                                   | 结果                                |
| -------------------------------------------------------------------------------------- | ----------------------------------- |
| `/api/web/me`                                                                          | HTTP 403 / `code=-400300`，要求登录 |
| `/api/web/mcp/purchased-ips`                                                           | HTTP 403 / `code=-400300`，要求登录 |
| `/mcp`、`/health`                                                                      | HTTP 404                            |
| `/.well-known/oauth-protected-resource/mcp`、`/.well-known/oauth-authorization-server` | HTTP 404                            |

因此尚未验证公网 MCP 初始化、OAuth 登录或三图下载。未发送短信、未使用真实用户凭据。网关平台上游配置可使用 `NIEGEIP_API_URL=https://web.api.niegeip.com/api/web`；`NIEGEIP_ISSUER` 则必须对应实际部署的独立网关入口，不能直接把平台 API 根地址作为 MCP URL。

若复用现有域名，需在 HTTPS 虚拟主机中将 `/mcp`、`/health`、`/authorize`、`/token`、`/register`、`/revoke`、`/connect`（含其子路由）、`/connect.css`、`/connect.js` 和两条 OAuth well-known 路由转发至此 Node 服务，其他现有路由继续使用原服务。平台 API 使用该域名不代表这些 Node 路由会自动出现。也可为网关配置独立官方子域名并将整个虚拟主机转发至 Node 服务。
