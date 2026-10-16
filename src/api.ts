import { z } from "zod";
const id = z.string().regex(/^[1-9][0-9]*$/);
export const assetSchema = z.object({
  id,
  title: z.string(),
  type: z.string(),
});
export const packSchema = z.object({
  asset: assetSchema,
  authorizationId: id,
  authorizationExpiresAt: z.string().datetime().optional(),
  complete: z.boolean(),
  images: z
    .array(
      z.object({
        kind: z.enum(["half_body_front", "three_view", "expression_grid"]),
        name: z.string(),
        version: id,
        url: z.string().url().optional(),
        expiresAt: z.string().datetime().optional(),
      }),
    )
    .max(3),
  missing: z.array(z.object({ kind: z.string(), name: z.string() })),
});
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class NiegeIPAPI {
  constructor(
    private base: URL,
    private token?: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.base.href.replace(/\/$/, "") + path, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError(
        "UPSTREAM_UNAVAILABLE",
        "平台暂时无法连接，请稍后重试。",
      );
    }
    if (response.status === 401)
      throw new ApiError("AUTH_REQUIRED", "登录已失效，请重新连接 NiegeIP。");
    if (response.status === 429)
      throw new ApiError("RATE_LIMITED", "请求过于频繁，请稍后重试。");
    // Never reflect raw upstream bodies: they can contain credentials, internal details or signed URLs.
    let data: unknown;
    try {
      if (!response.body) throw new Error("Empty upstream body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1024 * 1024)
            throw new Error("Upstream response exceeds limit");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ApiError("UPSTREAM_ERROR", "平台返回了无法识别的响应。");
    }
    const envelope = z
      .object({
        code: z.number(),
        msg: z.string().optional(),
        data: z.unknown(),
      })
      .safeParse(data);
    // Gorig's production login middleware uses HTTP 403 / -400300 for invalid sessions.
    if (
      response.status === 403 &&
      envelope.success &&
      envelope.data.code === -400300
    )
      throw new ApiError("AUTH_REQUIRED", "登录已失效，请重新连接 NiegeIP。");
    if (response.status === 403)
      throw new ApiError("FORBIDDEN", "当前账户无权执行此操作。");
    if (!response.ok || !envelope.success || envelope.data.code !== 200)
      throw new ApiError(
        "REQUEST_REJECTED",
        "请求未完成，请检查登录、购买授权或验证码后重试。",
      );
    const parsed = schema.safeParse(envelope.data.data);
    if (!parsed.success)
      throw new ApiError(
        "UPSTREAM_CONTRACT_ERROR",
        "接口版本不兼容，请联系平台更新 MCP 接口。",
      );
    return parsed.data;
  }
  async account() {
    const me = await this.request(
      "/me",
      z.object({ profile: z.object({ nickname: z.string() }) }),
    );
    return { nickname: me.profile.nickname };
  }
  async sms(phone: string) {
    await this.request("/sms", z.unknown(), { phone });
  }
  async login(phone: string, code: string) {
    return this.request("/login", z.object({ token: z.string().min(1) }), {
      phone,
      code,
    });
  }
  async list(page: number, size: number, keyword: string) {
    return this.request(
      "/mcp/purchased-ips?" +
        new URLSearchParams({
          page: String(page),
          size: String(size),
          keyword,
        }),
      z.object({
        page: z.number(),
        size: z.number(),
        total: z.number(),
        items: z.array(assetSchema),
      }),
    );
  }
  async pack(assetId: string, download: boolean) {
    return this.request(
      `/mcp/ips/${assetId}/${download ? "download-links" : "creation-pack"}`,
      packSchema,
      download ? {} : undefined,
    );
  }
}
