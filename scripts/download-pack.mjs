#!/usr/bin/env node
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const kinds = ["half_body_front", "three_view", "expression_grid"];
const formats = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);
const maxBytes = 50 * 1024 * 1024;
function imageMatches(bytes, type) {
  if (type === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  );
}
export async function downloadPack(
  pack,
  output,
  allowedHosts,
  fetcher = fetch,
) {
  if (
    !pack ||
    !/^[1-9][0-9]*$/.test(pack.asset?.id) ||
    !Array.isArray(pack.images) ||
    pack.images.length > 3 ||
    !Array.isArray(pack.missing)
  )
    throw new Error("Invalid creation pack");
  const seen = new Set();
  for (const item of pack.images) {
    if (
      !kinds.includes(item.kind) ||
      seen.has(item.kind) ||
      typeof item.version !== "string"
    )
      throw new Error("Invalid or duplicate image kind");
    seen.add(item.kind);
    const url = new URL(item.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !allowedHosts.includes(url.hostname) ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("Download host is not approved");
    const expiry = Date.parse(item.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now())
      throw new Error("Download links expired; request new links");
  }
  if (pack.images.length === 0)
    throw new Error("No creation images are available");
  const root = resolve(output);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, `niegeip-${pack.asset.id}-`));
  const files = [];
  try {
    for (const item of pack.images) {
      const response = await fetcher(item.url, {
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok || !response.body)
        throw new Error("Image download failed; request new links and retry");
      const type = (response.headers.get("content-type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase(),
        ext = formats.get(type);
      if (!ext) throw new Error("Unsupported image content type");
      const declared = Number(response.headers.get("content-length"));
      if (declared > maxBytes) throw new Error("Image exceeds 50 MiB limit");
      const chunks = [];
      let total = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) throw new Error("Image exceeds 50 MiB limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = Buffer.concat(chunks);
      if (!imageMatches(bytes, type))
        throw new Error("Image content does not match its type");
      const filename = item.kind + ext,
        path = join(directory, filename);
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      files.push({
        kind: item.kind,
        version: item.version,
        path,
        bytes: total,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const manifest = {
      asset: pack.asset,
      authorizationId: pack.authorizationId,
      authorizationExpiresAt: pack.authorizationExpiresAt,
      downloadedAt: new Date().toISOString(),
      complete: seen.size === 3,
      missing: pack.missing,
      files,
    };
    // Never persist bearer-style signed links in the output manifest.
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return manifest;
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error(
      "Download incomplete; temporary files removed. Check the approved host, image format and link expiry, then retry.",
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 1024 * 1024) throw new Error("Manifest too large");
    }
    const hosts = (process.env.NIEGEIP_DOWNLOAD_HOSTS ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (!hosts.length)
      throw new Error(
        "Configure NIEGEIP_DOWNLOAD_HOSTS with operator-approved image hosts",
      );
    const result = await downloadPack(
      JSON.parse(input),
      process.argv[2] ?? "outputs",
      hosts,
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Download failed");
    process.exitCode = 1;
  }
}
