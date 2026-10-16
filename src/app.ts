import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  mcpAuthRouter,
  createOAuthMetadata,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { scopes, type Config } from "./config.js";
import { Store } from "./store.js";
import { Provider } from "./oauth.js";
import { ApiError, NiegeIPAPI } from "./api.js";
import { createMCP } from "./mcp.js";
import { connectPage, stylesheet, browserScript } from "./ui.js";
export function createApp(
  config: Config,
  store: Store,
  fetcher: typeof fetch = fetch,
) {
  const app = express(),
    provider = new Provider(config, store, fetcher);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    // Never trust forwarded hosts. Deploy behind a proxy preserving the configured Host.
    if (req.headers.host !== config.issuer.host) {
      res.status(421).json({ message: "Host not allowed" });
      return;
    }
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    if (!config.local) res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  const limit = rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "请求过于频繁，请稍后重试。" },
  });
  app.use(limit);
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/", (_req, res) =>
    res
      .type("text")
      .send("NiegeIP MCP · 请从支持 MCP 的客户端连接 /mcp，完成账户授权。"),
  );
  app.get("/.well-known/oauth-authorization-server", (_req, res) =>
    res.set("Access-Control-Allow-Origin", "*").json({
      ...createOAuthMetadata({
        provider,
        issuerUrl: config.issuer,
        scopesSupported: scopes,
      }),
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
    }),
  );
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.issuer,
      resourceServerUrl: config.resource,
      scopesSupported: scopes,
      resourceName: "NiegeIP 创作资产",
      clientRegistrationOptions: { clientIdGeneration: false },
    }),
  );
  app.get("/connect.css", (_req, res) => res.type("css").send(stylesheet));
  app.get("/connect.js", (_req, res) => res.type("js").send(browserScript));
  function browser(req: express.Request, request: string) {
    const entry = (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(provider.cookieName(request) + "="));
    return entry?.slice(entry.indexOf("=") + 1) ?? "";
  }
  app.get("/connect", (req, res) => {
    const request = z.string().max(100).parse(req.query.request);
    try {
      const pending = provider.pending(request, browser(req, request));
      res
        .type("html")
        .send(
          connectPage(
            pending.clientName,
            pending.redirectUri,
            pending.scopes,
            request,
          ),
        );
    } catch {
      res
        .status(400)
        .type("text")
        .send("授权请求已过期或浏览器不匹配。请返回 Agent 重新连接 NiegeIP。");
    }
  });
  app.use("/connect", express.json({ limit: "4kb" }), (req, res, next) => {
    if (req.method !== "POST" || req.headers.origin !== config.issuer.origin) {
      res.status(403).json({ message: "授权请求来源无效，请重新连接。" });
      return;
    }
    next();
  });
  const loginLimit = rateLimit({
    windowMs: 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "尝试次数过多，请一分钟后重试。" },
  });
  app.post("/connect/:action", loginLimit, async (req, res) => {
    const request = z.string().max(100).parse(req.body.request),
      cookie = browser(req, request);
    provider.pending(request, cookie);
    if (req.params.action === "deny") {
      res.json({ redirect: provider.deny(request, cookie) });
      return;
    }
    const phone = z
      .string()
      .regex(/^1[3-9][0-9]{9}$/)
      .parse(req.body.phone);
    if (req.params.action === "sms") {
      await new NiegeIPAPI(config.api, undefined, fetcher).sms(phone);
      res.json({ sent: true });
      return;
    }
    if (req.params.action !== "complete") {
      res.sendStatus(404);
      return;
    }
    z.literal(true).parse(req.body.consent);
    const code = z
      .string()
      .regex(/^[0-9]{4,8}$/)
      .parse(req.body.code);
    const redirect = await provider.complete(request, cookie, phone, code);
    res.clearCookie(provider.cookieName(request), {
      path: "/connect",
      httpOnly: true,
      secure: !config.local,
      sameSite: "lax",
    });
    res.json({ redirect });
  });
  app.use("/mcp", (req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== config.issuer.origin &&
      !config.origins.includes(origin)
    ) {
      res.status(403).json({ message: "Origin not allowed" });
      return;
    }
    if (origin) {
      res.set({
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Access-Control-Allow-Headers":
          "Authorization, Content-Type, MCP-Protocol-Version, Last-Event-ID",
        "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      });
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(
    "/mcp",
    requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl: new URL(
        "/.well-known/oauth-protected-resource/mcp",
        config.issuer,
      ).href,
    }),
    express.json({ limit: "64kb" }),
  );
  app.post("/mcp", async (req, res) => {
    if (!req.auth) {
      res.sendStatus(401);
      return;
    }
    const server = createMCP(
      provider.upstream(req.auth.token),
      req.auth.scopes,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all("/mcp", (_req, res) =>
    res.status(405).set("Allow", "POST, OPTIONS").end(),
  );
  app.use((_req, res) => res.status(404).json({ message: "页面不存在。" }));
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return;
      if (error instanceof ApiError) {
        res
          .status(error.code === "RATE_LIMITED" ? 429 : 400)
          .json({ message: error.message });
        return;
      }
      if (error instanceof OAuthError) {
        res
          .status(400)
          .json({ message: "授权请求无效或已过期，请返回应用重新连接。" });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "请检查手机号、验证码和授权选项。" });
        return;
      }
      res.status(500).json({ message: "服务暂时不可用，请稍后重试。" });
    },
  );
  return { app, provider };
}
