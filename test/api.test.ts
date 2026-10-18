import test from "node:test";
import assert from "node:assert/strict";
import { NiegeIPAPI, ApiError } from "../src/api.js";
test("upstream errors and malformed data are bounded and never expose private bodies", async () => {
  for (const [status, code] of [
    [401, "AUTH_REQUIRED"],
    [403, "FORBIDDEN"],
    [429, "RATE_LIMITED"],
    [500, "REQUEST_REJECTED"],
  ] as const) {
    const api = new NiegeIPAPI(
      new URL("https://api.example.invalid/api/web"),
      "private-token",
      async (_url, options) => {
        assert.equal(options?.redirect, "error");
        return Response.json(
          { code: status, msg: "private-upstream-secret" },
          { status },
        );
      },
    );
    await assert.rejects(
      () => api.account(),
      (e) =>
        e instanceof ApiError &&
        e.code === code &&
        !e.message.includes("private-upstream-secret"),
    );
  }
  for (const response of [
    new Response("<html>bad</html>"),
    new Response("x".repeat(1024 * 1024 + 1)),
    Response.json({ code: 200, data: { profile: null } }),
  ]) {
    const api = new NiegeIPAPI(
      new URL("https://api.example.invalid"),
      undefined,
      async () => response,
    );
    await assert.rejects(() => api.account(), ApiError);
  }
  const offline = new NiegeIPAPI(
    new URL("https://api.example.invalid"),
    undefined,
    async () => {
      throw new Error("private-url-with-token");
    },
  );
  await assert.rejects(
    () => offline.account(),
    (e) =>
      e instanceof ApiError &&
      e.code === "UPSTREAM_UNAVAILABLE" &&
      !e.message.includes("token"),
  );
});

test("production Gorig session errors ask the user to reconnect", async () => {
  const api = new NiegeIPAPI(
    new URL("https://api.example.invalid/api/web"),
    undefined,
    async () =>
      Response.json(
        { code: -400300, data: null, msg: "private upstream auth details" },
        { status: 403 },
      ),
  );
  await assert.rejects(
    () => api.account(),
    (e) =>
      e instanceof ApiError &&
      e.code === "AUTH_REQUIRED" &&
      !e.message.includes("private"),
  );
});

test("owner manifest and download contract accepts empty purchase ID and preserves workflow", async () => {
  for (const access of ["owned", "purchased", undefined]) {
    const api = new NiegeIPAPI(
      new URL("https://api.example.invalid/api/web"),
      undefined,
      async (input) => {
        const download = String(input).endsWith("download-links");
        return Response.json({
          code: 200,
          data: {
            asset: {
              id: "123",
              title: "fixture",
              type: "virtual",
              ...(access ? { access } : {}),
            },
            authorizationId: "",
            downloadAllowed: true,
            additionalApprovalRequired: false,
            complete: false,
            materialStatus: "partial",
            stage: download ? "download_links" : "manifest",
            nextAction: download
              ? "consume_reference_images"
              : "create_download_links",
            images: [
              {
                kind: "three_view",
                name: "三视图",
                version: "1",
                ...(download
                  ? {
                      url: "https://images.example.invalid/fixture.png",
                      expiresAt: new Date(Date.now() + 60000).toISOString(),
                    }
                  : {}),
              },
            ],
            missing: [
              { kind: "half_body_front", name: "半身图" },
              { kind: "expression_grid", name: "表情图" },
            ],
          },
        });
      },
    );
    if (access !== "owned") {
      await assert.rejects(() => api.pack("123", false), ApiError);
      continue;
    }
    const manifest = await api.pack("123", false);
    assert.equal(manifest.asset.access, "owned");
    assert.equal(manifest.downloadAllowed, true);
    assert.equal(manifest.images[0]?.url, undefined);
    assert.equal(manifest.nextAction, "create_download_links");
    const links = await api.pack("123", true);
    assert.equal(links.stage, "download_links");
    assert.equal(links.images.length, 1);
    assert.ok(links.images[0]?.url);
    assert.equal(links.missing.length, 2);
  }
});
