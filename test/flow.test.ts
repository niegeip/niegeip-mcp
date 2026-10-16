import test from "node:test";
import { fixture } from "./helpers.js";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { configuration } from "../src/config.js";
import { Store } from "../src/store.js";
import { Provider } from "../src/oauth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

async function authorize(
  f: Awaited<ReturnType<typeof fixture>>,
  scope = "account:read ips:read assets:download",
) {
  const registered = await f.request("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Agent",
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registered.status, 201);
  const client = (await registered.json()) as { client_id: string };
  const verifier = "v".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: "https://client.example/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    state: "test-state",
    resource: f.config.resource.href,
  });
  const start = await f.request("/authorize?" + params);
  assert.equal(start.status, 302, await start.clone().text());
  const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
  const location = start.headers.get("location")!;
  const request = new URL(location, f.base).searchParams.get("request")!;
  const send = (path: string, body: object, origin = f.base) =>
    f.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: origin,
      },
      body: JSON.stringify({ request, ...body }),
    });
  const page = await f.request(location, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /授权给 Test Agent/);
  return { client, verifier, request, cookie, send };
}
async function finish(f: Awaited<ReturnType<typeof fixture>>, scope?: string) {
  const flow = await authorize(f, scope);
  const complete = await flow.send("/connect/complete", {
    phone: "13800000000",
    code: "654321",
    consent: true,
  });
  assert.equal(complete.status, 200, await complete.clone().text());
  const body = (await complete.json()) as { redirect: string };
  const code = new URL(body.redirect).searchParams.get("code")!;
  assert.equal(new URL(body.redirect).searchParams.get("state"), "test-state");
  const exchange = (extra: Record<string, string> = {}) =>
    f.request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: flow.client.client_id,
        grant_type: "authorization_code",
        code,
        code_verifier: flow.verifier,
        redirect_uri: "https://client.example/callback",
        resource: f.config.resource.href,
        ...extra,
      }),
    });
  return { ...flow, exchange };
}
test("OAuth browser consent → PKCE → real MCP SDK → three-image pack → revoke", async () => {
  const f = await fixture();
  try {
    const metadata = await (
      await f.request("/.well-known/oauth-protected-resource/mcp")
    ).json();
    assert.equal(metadata.resource, f.config.resource.href);
    const discovery = await (
      await f.request("/.well-known/oauth-authorization-server")
    ).json();
    assert.equal(discovery.issuer, f.config.issuer.href);
    assert.deepEqual(discovery.token_endpoint_auth_methods_supported, ["none"]);
    const unauth = await f.request("/mcp", { method: "POST" });
    assert.equal(unauth.status, 401);
    assert.match(
      unauth.headers.get("www-authenticate") ?? "",
      /resource_metadata/,
    );
    const flow = await finish(f);
    assert.equal(
      (await flow.exchange({ code_verifier: "wrong".repeat(15) })).status,
      400,
    );
    assert.equal(
      (await flow.exchange({ resource: "https://wrong.example/mcp" })).status,
      400,
    );
    const exchange = await flow.exchange();
    assert.equal(exchange.status, 200, await exchange.clone().text());
    const tokens = (await exchange.json()) as {
      access_token: string;
      refresh_token: string;
    };
    assert.equal((await flow.exchange()).status, 400);
    const client = new Client({ name: "fixture", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(f.base + "/mcp"), {
        requestInit: {
          headers: { Authorization: "Bearer " + tokens.access_token },
        },
      }),
    );
    assert.equal((await client.listTools()).tools.length, 4);
    const account = await client.callTool({
      name: "get_account",
      arguments: {},
    });
    assert(!JSON.stringify(account).includes("private-phone"));
    assert(!JSON.stringify(account).includes("fixture-upstream-secret"));
    const listed = await client.callTool({
      name: "list_purchased_ips",
      arguments: {},
    });
    assert(JSON.stringify(listed).includes("9007199254740993"));
    const pack = await client.callTool({
      name: "create_download_links",
      arguments: { assetId: "9007199254740993" },
    });
    assert(!pack.isError);
    assert(JSON.stringify(pack).includes("expression_grid"));
    assert(
      !readFileSync(f.config.statePath).includes(
        Buffer.from("fixture-upstream-secret"),
      ),
    );
    // A new provider reading encrypted state can validate the same token.
    const restored = new Store(f.config.statePath, f.config.key);
    await new Provider(f.config, restored).verifyAccessToken(
      tokens.access_token,
    );
    await assert.rejects(() =>
      new Provider(
        { ...f.config, resource: new URL("https://different.example/mcp") },
        restored,
      ).verifyAccessToken(tokens.access_token),
    );
    assert(restored.get("client:" + flow.client.client_id, z.unknown()));
    const revoked = await f.request("/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: flow.client.client_id,
        token: tokens.access_token,
      }),
    });
    assert.equal(revoked.status, 200);
    await assert.rejects(() =>
      f.provider.verifyAccessToken(tokens.access_token),
    );
    await client.close();
  } finally {
    await f.close();
  }
});
test("browser CSRF, wrong OTP, missing consent and cancellation do not grant access", async () => {
  const f = await fixture();
  try {
    const flow = await authorize(f);
    assert.equal(
      (
        await flow.send(
          "/connect/sms",
          { phone: "13800000000" },
          "https://attacker.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await flow.send("/connect/complete", {
          phone: "13800000000",
          code: "000000",
          consent: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await flow.send("/connect/complete", {
          phone: "13800000000",
          code: "654321",
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request("/connect?request=" + flow.request)).status,
      400,
    );
    const denied = await flow.send("/connect/deny", {});
    assert.equal(denied.status, 200);
    assert.match(JSON.stringify(await denied.json()), /access_denied/);
    assert.equal(
      (
        await flow.send("/connect/complete", {
          phone: "13800000000",
          code: "654321",
          consent: true,
        })
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
test("scope restriction, refresh rotation, replay and upstream expiration", async () => {
  const f = await fixture();
  try {
    const flow = await finish(f, "account:read");
    const tokens = (await (await flow.exchange()).json()) as {
      access_token: string;
      refresh_token: string;
    };
    const client = new Client({ name: "fixture", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(f.base + "/mcp"), {
        requestInit: {
          headers: { Authorization: "Bearer " + tokens.access_token },
        },
      }),
    );
    const denied = await client.callTool({
      name: "create_download_links",
      arguments: { assetId: "1" },
    });
    assert.equal(denied.isError, true);
    const refresh = (token: string, scope?: string) =>
      f.request("/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: flow.client.client_id,
          grant_type: "refresh_token",
          refresh_token: token,
          resource: f.config.resource.href,
          ...(scope ? { scope } : {}),
        }),
      });
    assert.equal(
      (await refresh(tokens.refresh_token, "assets:download")).status,
      400,
    );
    const rotated = await refresh(tokens.refresh_token);
    assert.equal(rotated.status, 200);
    const next = (await rotated.json()) as { access_token: string };
    assert.equal((await refresh(tokens.refresh_token)).status, 400);
    await assert.rejects(() => f.provider.verifyAccessToken(next.access_token));
    await client.close();
  } finally {
    await f.close();
  }
});
test("configuration, encryption tampering, expiry and DNS rebinding rejection", async () => {
  assert.throws(() => configuration({ NIEGEIP_STATE_KEY: "a".repeat(64) }));
  const f = await fixture();
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      httpRequest(
        f.base + "/health",
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      )
        .on("error", reject)
        .end();
    });
    assert.equal(status, 421);
    const flow = await finish(f);
    const token = (await (await flow.exchange()).json()) as {
      access_token: string;
    };
    f.setFailure();
    const api = f.provider.upstream(token.access_token);
    await assert.rejects(() => api.account());
    assert.throws(() => new Store(f.config.statePath, "b".repeat(64)));
    const expired = new Store(
      f.config.statePath,
      f.config.key,
      () => Date.now() + 400 * 86400000,
    );
    assert.equal(
      expired.get("client:" + flow.client.client_id, z.unknown()),
      undefined,
    );
  } finally {
    await f.close();
  }
});
