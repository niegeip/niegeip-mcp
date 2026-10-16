import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = async (p) =>
  JSON.parse(await readFile(new URL("../" + p, import.meta.url), "utf8"));
const market = await read(".agents/plugins/marketplace.json"),
  plugin = await read("plugins/niegeip/.codex-plugin/plugin.json"),
  mcp = await read("plugins/niegeip/.mcp.json");
assert.equal(market.plugins[0].name, plugin.name);
assert.equal(market.name, "niegeip");
assert.equal(market.plugins[0].source.path, "./plugins/niegeip");
assert.equal(plugin.mcpServers, "./.mcp.json");
assert.equal(mcp.mcpServers.niegeip.type, "http");
const url = new URL(mcp.mcpServers.niegeip.url);
assert.equal(url.pathname, "/mcp");
assert.equal(
  await readFile(
    new URL("../scripts/download-pack.mjs", import.meta.url),
    "utf8",
  ),
  await readFile(
    new URL(
      "../plugins/niegeip/skills/niegeip-assets/scripts/download-pack.mjs",
      import.meta.url,
    ),
    "utf8",
  ),
);
console.log(
  "Marketplace, plugin and bundled downloader validated" +
    (url.protocol === "http:"
      ? " (development endpoint; configure HTTPS before publishing)."
      : "."),
);
