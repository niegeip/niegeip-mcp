import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const template = await readFile(
  new URL("../.env.example", import.meta.url),
  "utf8",
);
await writeFile(
  new URL("../.env", import.meta.url),
  template.replace(
    "NIEGEIP_STATE_KEY=\n",
    "NIEGEIP_STATE_KEY=" + randomBytes(32).toString("hex") + "\n",
  ),
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created .env with a new local encryption key; existing files are never overwritten.",
);
