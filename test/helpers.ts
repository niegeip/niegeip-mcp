import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { configuration } from "../src/config.js";
import { Store } from "../src/store.js";
import { createApp } from "../src/app.js";
import { createServer } from "node:http";

export async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "niegeip-mcp-"));
  const config = configuration({
    NIEGEIP_LOCAL: "true",
    NIEGEIP_ISSUER: "http://127.0.0.1:18787",
    NIEGEIP_API_URL: "http://127.0.0.1:8081/api/web",
    NIEGEIP_STATE_KEY: "a".repeat(64),
    NIEGEIP_STATE_PATH: join(dir, "state.enc"),
  });
  let failure = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (failure) return Response.json({ code: 401 }, { status: 401 });
    if (url.pathname.endsWith("/login")) {
      const body = JSON.parse(String(init?.body));
      if (body.code !== "654321")
        return Response.json(
          { code: 400, msg: "secret internal details" },
          { status: 400 },
        );
      return Response.json({
        code: 200,
        data: { token: "fixture-upstream-secret" },
      });
    }
    if (url.pathname.endsWith("/sms"))
      return Response.json({ code: 200, data: { sent: true } });
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer fixture-upstream-secret",
    );
    let data: unknown = {};
    if (url.pathname.endsWith("/me"))
      data = {
        userId: "web:private-phone",
        profile: { nickname: "测试账户", phone: "do-not-expose" },
      };
    else if (url.pathname.endsWith("/purchased-ips"))
      data = {
        page: 1,
        size: 20,
        total: 1,
        items: [{ id: "9007199254740993", title: "测试 IP", type: "virtual" }],
      };
    else
      data = {
        asset: { id: "9007199254740993", title: "测试 IP", type: "virtual" },
        authorizationId: "21",
        complete: true,
        images: ["half_body_front", "three_view", "expression_grid"].map(
          (kind, i) => ({
            kind,
            name: kind,
            version: String(i + 1),
            ...(url.pathname.endsWith("/download-links")
              ? {
                  url: `https://images.example.invalid/${kind}.png`,
                  expiresAt: new Date(Date.now() + 300000).toISOString(),
                }
              : {}),
          }),
        ),
        missing: [],
      };
    return Response.json({ code: 200, data });
  };
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  assert(address && typeof address !== "string");
  config.issuer.port = String(address.port);
  config.resource.port = String(address.port);
  const store = new Store(config.statePath, config.key),
    { app, provider } = createApp(config, store, fetcher);
  server.on("request", app);
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init: RequestInit = {}) =>
    fetch(base + path, { ...init, redirect: "manual" });
  return {
    dir,
    config,
    provider,
    store,
    base,
    request,
    setFailure: () => {
      failure = true;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
