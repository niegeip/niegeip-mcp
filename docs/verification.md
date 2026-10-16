# 实现与验证记录

日期：2026-10-14。所有账户、手机号、Token、素材 URL 均来自合成 fixture，未发送真实短信或创建购买记录。

## 文件与职责

- `src/oauth.ts`、`src/store.ts`：OAuth、加密状态、刷新与撤销。
- `src/app.ts`、`src/main.ts`：HTTP、CORS/Host 校验、限流、单写者启动。
- `src/api.ts`、`src/mcp.ts`：平台协议 schema 与四个 MCP tools。
- `src/ui.ts`：浏览器手机号登录和明确同意页。
- `.agents/plugins/`、`plugins/niegeip/`：marketplace、Plugin、素材准备技能与下载 helper。
- `scripts/`：开发配置初始化、正式域名配置、文件下载、发布包检查。
- `test/`：协议、scope、撤销、刷新重放、CSRF、浏览器、下载及错误测试。
- `.github/workflows/check.yml`：新公开仓库的 CI。

业务后端改动位于独立 `niegeip-api` 仓库：`domain/shared/mcpflow/`、`domain/web/mcp_controller.go`、`domain/web/router.go`、`test/mcp_export_test.go`、`docs/mcp-api.md` 和 README 文档索引。既有 Web/Admin/Miniapp 无调用方变化，未修改生产前端。

## 版本

实际验证 Node 20.18.1，TypeScript 5.9.3，MCP SDK 1.32.1，express-rate-limit 8.7.1。新项目使用 npm 锁文件；未改变相邻项目的 pnpm 10.12.2 基线。

后端 go.mod 保持 Go 1.23.4、Gorig v0.0.53，无 replace 或依赖升级。本机已有忽略的 go.work 选择 Go 1.26.8，验证命令实际使用该工具链。

## 检查

- 本机 `node scripts/init-local.mjs` 已生成忽略的 0600 `.env`；`npm start`、`GET /health` 和资源元数据 smoke 通过，检查后已停止服务。

- `npm run check`：类型、Prettier 格式、Node tests、构建和 Plugin 包一致性。
- `PLAYWRIGHT_CHANNEL=chrome npm run test:browser`：真实 Chrome 中跑 fixture；桌面、375px、axe AA、字段错误、短信 pending、OTP 失败、键盘提交成功、取消。
- `npm audit --omit=dev --registry=https://registry.npmjs.org`：修复限流库后为 0 已知漏洞。原用户配置的镜像源不提供 audit 接口，因此显式使用官方 registry，未修改全局 npm 配置。
- 前端设计静态审计 strict：0 findings。
- 后端 `go fmt ./...`：执行过，去掉了与本功能无关的自动格式变化；新增 Go 文件已格式化。
- 后端 `go vet ./...`、`go build ./...`：通过。
- 后端 `go test ./test -run '^TestMCP' -v`：新增 4 组测试（含授权失败子案例）通过。
- 后端 `go test ./... -v`：未全通过。未修改模块中的 `TestReplicateCatalogIsFixedUpscaleOnly` 预期与当前包含视频放大的模型目录不符；`TestImageStoreUploadPNG/JPEG/WebPAndGIF/ObjectOwnership` 因测试图像尺寸不可读取失败。没有为使全量变绿而修改这些无关业务。

## 尚未验证 / 发布前条件

真实 MySQL/Redis/短信/TOS 三图下载链路未运行：没有为本任务指定可使用的开发账户、获批订单与部署环境。没有访问生产配置或发送真实短信。针对外部服务的既有 smoke 测试按自身环境开关跳过。

没有在全部厂商 Agent 中做安装兼容性验收；协议层使用官方 SDK client 验证。没有部署公网服务或创建远程 Git 仓库。正式上线需配置官方 HTTPS 域名、状态密钥、平台接口和获批订单白名单，并在目标客户端完成真实授权/下载验收。

仅支持单实例文件状态。需多实例或更大流量时，先迁移状态存储的事务/原子消费语义，不能共享文件直接横向扩容。未新增平台已连接应用管理页；客户端通过 `/revoke` 撤销。代码许可证尚待仓库所有者选择。
