# 平台 API 契约 v0.1

服务端 `NIEGEIP_API_URL` 指向平台 Web API 根路径 `/api/web`。此地址由运营配置，不能来自 MCP tool 参数。只允许 HTTPS，显式本地模式可使用 loopback HTTP。所有请求 15 秒超时，不跟随重定向。

成功响应沿用 `{ "code": 200, "msg": "...", "data": ... }`。HTTP/业务错误不能当作成功；网关对外使用稳定错误标识并隐藏上游内部消息。

| 方法 | 路径                                         | 用途                                        |
| ---- | -------------------------------------------- | ------------------------------------------- |
| POST | `/sms`                                       | 浏览器主动请求验证码；body `{phone}`        |
| POST | `/login`                                     | 浏览器提交 `{phone,code}`，token 仅留在网关 |
| GET  | `/me`                                        | 检查平台登录；网关只输出 profile.nickname   |
| GET  | `/mcp/purchased-ips?page=1&size=20&keyword=` | 有效购买且外部下载获批的 IP，SQL 分页       |
| GET  | `/mcp/ips/:id/creation-pack`                 | 三图清单，不返回签名，不写平台素材库        |
| POST | `/mcp/ips/:id/download-links`                | 重新检查授权并签发原图链接，body `{}`       |

后四个接口使用平台既有 `Authorization: Bearer` 登录凭据。MCP Token 不透传给平台，平台 Token 也不返回给 Agent。

列表 data：

```json
{
  "page": 1,
  "size": 20,
  "total": 1,
  "items": [{ "id": "123", "title": "示例 IP", "type": "virtual" }]
}
```

素材包 data（示例 URL 不可下载）：

```json
{
  "asset": { "id": "123", "title": "示例 IP", "type": "virtual" },
  "authorizationId": "456",
  "authorizationExpiresAt": "2030-01-01T00:00:00Z",
  "complete": false,
  "images": [
    {
      "kind": "half_body_front",
      "name": "半身图",
      "version": "789",
      "url": "https://images.example.invalid/half.png",
      "expiresAt": "2026-10-14T12:05:00Z"
    }
  ],
  "missing": [
    { "kind": "three_view", "name": "三视图" },
    { "kind": "expression_grid", "name": "表情图" }
  ]
}
```

所有 ID 为十进制字符串，避免 64 位 ID 在 JS 中丢失精度。仅 download-links 返回 `url` 与 `expiresAt`。无固定到期时间的旧人工授权可省略 `authorizationExpiresAt`，不代表合同赋予永久无限使用。

## 授权和数据边界

- 身份从已验证的平台登录上下文提取，不能传 userId 伪造身份。
- `mcp.export_order_ids` / `GORIG_MCP_EXPORT_ORDER_IDS`：经平台审核允许外部下载的订单 ID 白名单。空值拒绝所有导出；非法值整项拒绝。不是用户可写配置。
- 同时复用 `orderflow.ActiveAuthorizationSQL` / `AuthorizationState`：人工订单 completed；历史在线订单未撤销、已完成且未到期。优先选择白名单中仍有效的授权，不用失效订单覆盖其他有效授权。
- 仅公开且正常可见的 IP 可对外导出。此功能不依赖 Seedance 专属人像映射，且不代表任何特定生成平台已批准使用。
- 仅从 `AssetPhoto.role=production_material` 读取固定三种 kind 的最新有效版本；不导出原始身份照片、证件或任意 URL。
- 原图签名 TTL 为 min(300 秒, 授权剩余秒数)，低于 1 秒拒绝；签名后再次查验授权。
- 退款/撤销立即影响后续签发；已经发出的对象存储签名可在剩余 TTL 内使用，已经下载的文件无法回收。需要立即阻断已发链接时应替换为每次访问鉴权的下载代理。
- 三图缺失可返回部分图片和明确缺项，全部缺失不是三图齐全。签名服务异常整次请求失败，不返回伪成功。

## 生产仓库接入

本工作区已经添加 `domain/shared/mcpflow/`、`domain/web/mcp_controller.go` 和三条 Web 路由；后端文档为 `docs/mcp-api.md`，测试为 `test/mcp_export_test.go`。这些文件属于独立的私有业务后端仓库，公开 MCP 项目只维护此接口契约，不复制整个业务源码。

无需改表。发布顺序：部署平台接口 → 按已确认的外部使用合同配置订单白名单 → 部署官方网关 → 更新 Plugin 域名 → 使用开发账户验收。回滚时清空白名单并停止网关；原有平台内创作接口不受影响。
