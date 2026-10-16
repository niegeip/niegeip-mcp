import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Runtime JS helper ships with the plugin without a TypeScript runtime.
// @ts-expect-error The standalone script intentionally has no emitted declaration.
import { downloadPack } from "../scripts/download-pack.mjs";
const image = {
  kind: "half_body_front",
  name: "半身图",
  version: "1",
  url: "https://images.example.invalid/half.png?signature=private",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
const pack = {
  asset: { id: "1", title: "IP" },
  authorizationId: "2",
  images: [image],
  missing: [
    { kind: "three_view", name: "三视图" },
    { kind: "expression_grid", name: "表情图" },
  ],
  complete: false,
};
test("download verifies image, writes unique files and omits signed URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "niegeip-download-"));
  try {
    const mock = async () =>
      new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]), {
        headers: { "Content-Type": "image/png" },
      });
    const result = await downloadPack(
      pack,
      dir,
      ["images.example.invalid"],
      mock,
    );
    assert.equal(result.complete, false);
    assert.equal(result.files.length, 1);
    const manifest = await readFile(
      join(result.files[0].path, "..", "manifest.json"),
      "utf8",
    );
    assert(!manifest.includes("signature"));
    assert.match(manifest, /sha256/);
    const again = await downloadPack(
      pack,
      dir,
      ["images.example.invalid"],
      mock,
    );
    assert.notEqual(again.files[0].path, result.files[0].path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("unapproved URL, duplicate kind, stale link and invalid image fail safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "niegeip-download-"));
  try {
    for (const images of [
      [{ ...image, url: "https://evil.example/file" }],
      [image, image],
      [{ ...image, expiresAt: "2020-01-01T00:00:00Z" }],
    ])
      await assert.rejects(() =>
        downloadPack({ ...pack, images }, dir, ["images.example.invalid"]),
      );
    await assert.rejects(() =>
      downloadPack(
        pack,
        dir,
        ["images.example.invalid"],
        async () =>
          new Response("<html>not image</html>", {
            headers: { "Content-Type": "image/png" },
          }),
      ),
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
