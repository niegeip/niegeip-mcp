import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NiegeIPAPI, packSchema } from "../src/api.js";
import { createMCP } from "../src/mcp.js";
// @ts-expect-error Standalone plugin JS helper has no declaration file.
import { downloadPack } from "../scripts/download-pack.mjs";

test("SDK selection to owned partial reference file succeeds without purchase ID", async () => {
  const asset = {
    id: "9007199254740993",
    title: "素材流程 fixture",
    type: "virtual",
    access: "owned",
  };
  const api = new NiegeIPAPI(
    new URL("https://api.example.invalid/api/web"),
    undefined,
    async (input) => {
      const url = String(input);
      if (url.includes("purchased-ips"))
        return Response.json({
          code: 200,
          data: { page: 1, size: 20, total: 1, items: [asset] },
        });
      const download = url.endsWith("download-links");
      return Response.json({
        code: 200,
        data: {
          asset,
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
                    url: "https://images.example.invalid/test.png?signature=private",
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
  const server = createMCP(api, ["ips:read", "assets:download"]);
  const client = new Client({ name: "workflow-fixture", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const dir = await mkdtemp(join(tmpdir(), "niegeip-workflow-"));
  try {
    await server.connect(a);
    await client.connect(b);
    const listed = await client.callTool({
      name: "list_purchased_ips",
      arguments: {},
    });
    assert.equal(listed.isError, undefined);
    const manifest = await client.callTool({
      name: "get_ip_creation_pack",
      arguments: { assetId: asset.id },
    });
    assert.equal(manifest.isError, undefined);
    const links = await client.callTool({
      name: "create_download_links",
      arguments: { assetId: asset.id },
    });
    assert.equal(links.isError, undefined);
    const text = links.content as Array<{ type: string; text: string }>;
    const pack = packSchema.parse(JSON.parse(text[0]!.text));
    assert.equal(pack.asset.access, "owned");
    assert.equal(pack.authorizationId, "");
    assert.equal(pack.materialStatus, "partial");
    const result = await downloadPack(
      pack,
      dir,
      ["images.example.invalid"],
      async () =>
        new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), {
          headers: { "Content-Type": "image/png" },
        }),
    );
    assert.equal(result.files.length, 1);
    assert.equal(result.complete, false);
    const saved = await readFile(
      join(result.files[0].path, "..", "manifest.json"),
      "utf8",
    );
    assert.equal(saved.includes("signature"), false);
    assert.equal(JSON.parse(saved).asset.access, "owned");
  } finally {
    await client.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
