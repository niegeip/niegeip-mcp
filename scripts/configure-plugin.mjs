import { readFile, writeFile } from "node:fs/promises";
const raw = process.argv[2];
if (!raw)
  throw new Error(
    "Usage: node scripts/configure-plugin.mjs https://YOUR-OFFICIAL-HOST/mcp",
  );
const url = new URL(raw);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/mcp"
)
  throw new Error("Use the official HTTPS /mcp endpoint");
const file = new URL("../plugins/niegeip/.mcp.json", import.meta.url);
const value = JSON.parse(await readFile(file, "utf8"));
value.mcpServers.niegeip.url = url.href;
await writeFile(file, JSON.stringify(value, null, 2) + "\n");
console.log("Plugin endpoint updated.");
