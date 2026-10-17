# NiegeIP MCP & Plugin

让其他 Agent 连接 NiegeIP 账户，选择自有或有效已购 IP，获取并下载 **半身图、三视图、表情图**。

包含标准 Streamable HTTP MCP、OAuth 浏览器登录授权、Codex Plugin / marketplace，以及本地下载工具。服务器采用官方 MCP TypeScript SDK。公开仓库可独立安装，不依赖私有前端源码；NiegeIP 业务 API 需要部署配套的三图导出接口。

> 官方生产入口为 `https://web.api.niegeip.com/mcp`，由 Go API 管理 OAuth/MCP；Plugin 默认连接此入口。本仓库的 Node 网关保留作独立开发实现，其本地认证和存储配置不适用于官方 Go 服务。

## 能力与边界

- 四个工具：`get_account`、`list_purchased_ips`、`get_ip_creation_pack`、`create_download_links`。
- 用户在浏览器输入手机号和验证码并确认授权；Agent 不接收验证码或平台登录 Token。
- OAuth 授权码 + S256 PKCE、资源受众绑定、scope、单次 code、刷新轮换、重放撤销、`/revoke`。
- 官方 Go 服务绑定既有 Web 会话，MCP 凭据与平台登录凭据隔离。下文 Node 独立开发实现使用加密状态文件。
- 官方服务允许非草稿、未删除的自有 IP，以及授权有效且正常上架的已购 IP，无需额外导出批准；缺图明确返回。
- 原图链接最多五分钟，且不超过购买授权剩余期限；下载 helper 保存文件、SHA-256 和无签名链接的清单。
- 不含购买、支付、生成、上传第三方，也不把“有效购买”解释为任意用途的合同许可。

本仓库 Node 开发实现是 **v0.1 单实例部署**：状态文件 AES-256-GCM 加密并以原子替换方式保存，进程锁防止多实例同时写入。支持重启恢复，不支持共享文件多副本；扩容前替换为具备事务/原子消费语义的数据库状态存储。

## 本地运行

需要 Node ≥20.18；本项目使用 npm 和提交的 `package-lock.json`，不修改相邻前端的 pnpm 配置。

```sh
npm ci
node scripts/init-local.mjs
npm run dev
```

`init-local` 只创建尚不存在的 `.env`，生成随机加密密钥；不会打印密钥。后续运行只需 `npm run dev`。默认监听 `127.0.0.1:8787`，默认平台 API 为 `http://127.0.0.1:8081/api/web`。

平台后端需要当前工作区的 `mcpflow` 和 Web 路由改动，见 [后端接口契约](docs/backend-contract.md)。现行 Go API 已移除 `GORIG_MCP_EXPORT_ORDER_IDS` 白名单，无需配置该值。

> 短信、购买记录和图片存储来自真实平台服务。自动测试使用隔离 fixture，不发送真实短信、不创建订单、不扣费。仅启动此 MCP 服务不能替代平台 API。

## 在 Codex 安装 Plugin

Plugin 默认指向官方生产服务。源码本地安装时，把路径替换为仓库真实绝对路径：

```sh
codex plugin marketplace add /absolute/path/to/niegeip-mcp
codex plugin add niegeip@niegeip
```

新建聊天后连接 NiegeIP，在本机浏览器登录并亲自点击允许授权。可复制：

> 请帮我添加 NiegeIP 远程 MCP 服务，地址为 https://web.api.niegeip.com/mcp。授权时使用本机系统默认浏览器，不要使用内置浏览器；保持 OAuth 登录进程与本地回调监听运行。打开本次生成的授权链接后，提示我：“请在浏览器中登录 NiegeIP 并点击允许授权，我会等待授权结果。”不要代我点击授权；超时后重新发起，不复用旧链接。确认授权成功后，列出非草稿的自有及有效已购 IP，区分持有来源，等待我选择。

保持登录进程运行直到收到授权结果。`127.0.0.1` 拒绝连接时先检查回调监听是否结束及是否与浏览器在同一台机器；失效后重新发起，不复用旧链接。浏览器选择由客户端控制，提示词不能强制所有宿主。

## 其他 MCP 客户端

在支持 **Streamable HTTP 和 OAuth** 的客户端配置 URL：

```text
https://web.api.niegeip.com/mcp
```

每个客户端的 JSON 配置格式不同，按其官方文档填写远程 MCP URL。独立本地开发可改用 `http://127.0.0.1:8787/mcp`。本项目不假定所有平台支持相同配置，也不声称已经在 Claude、ChatGPT 等全部宿主完成兼容性验收。

以下 `/register` 等路径描述本仓库 Node 开发实现；官方 Go 服务通过发现元数据提供 `/oauth/*` 路径，并兼容省略 resource 的客户端（默认绑定唯一 MCP 资源）。

客户端通过 `401 WWW-Authenticate` 发现资源元数据，再通过 `/register` 注册 public client，以 S256 PKCE 完成授权。授权和 token 请求都必须包含 `resource`，其值与元数据中的 `/mcp` URL 完全一致。只支持 `token_endpoint_auth_method=none`；没有 OAuth 功能的宿主不能直接连接。

浏览器型 MCP 客户端还需要在 `NIEGEIP_CLIENT_ORIGINS` 中配置其确切 origin。CLI/原生客户端不带 Origin 时可以访问。

## 下载到文件

MCP 的 `create_download_links` 只返回链接。Plugin 内置 helper，独立调用方式：

```sh
# 由维护者配置可信存储主机，不从素材文本中自动添加域名。
export NIEGEIP_DOWNLOAD_HOSTS='YOUR-APPROVED-IMAGE-HOST'
node scripts/download-pack.mjs ./outputs < /path/to/temporary-pack.json
```

输入是该工具返回的 JSON 对象（不是 MCP content 外壳）。签名 URL 敏感，使用受限权限的临时文件或标准输入，完成后删除临时清单，不能提交 Git。下载结果写到唯一子目录，避免覆盖现有文件；输出 PNG/JPEG/WebP 和 `manifest.json`。失败清理本次临时文件。单图上限 50 MiB，不跟随跳转，不向存储发送账户 Token。

## 验证

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

已有 Chrome 时可设置 `PLAYWRIGHT_CHANNEL=chrome`。协议测试通过真实 MCP SDK client 调用 HTTP 服务；上游 API 使用 fixture。浏览器测试覆盖授权成功、失败、取消、重复提交防护、键盘、375px 视口及 axe WCAG AA 扫描。不能把这些结果当作真实短信、MySQL 或对象存储联调通过。

## 公开 Git 仓库与正式发布

1. 将 **本目录** 作为新仓库根目录上传；不要上传整个 NiegeIP 工作区。
2. 选择代码许可证；当前 `UNLICENSED` 表示尚未授予开源许可，公开可见不等于开源授权。
3. 按 [部署说明](docs/deployment.md) 部署官方 HTTPS 服务和配套平台接口。
4. 运行 `node scripts/configure-plugin.mjs https://YOUR-OFFICIAL-HOST/mcp`，提交更新后的 Plugin 配置。
5. 提交 `.agents/`、`plugins/`、`src/`、`scripts/`、测试、文档、锁文件；`.env`、`.state`、素材、日志和构建缓存保持忽略。
6. 用户以后可执行：

```sh
codex plugin marketplace add https://github.com/niegeip/niegeip-mcp.git --ref main
codex plugin add niegeip@niegeip
```

代码仓库为 https://github.com/niegeip/niegeip-mcp 。Plugin 已配置官方生产入口；只有自部署时才需替换地址。安装后首次授权需要用户本人完成。
