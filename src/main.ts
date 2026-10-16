import {
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { configuration } from "./config.js";
import { Store } from "./store.js";
import { createApp } from "./app.js";
const config = configuration();
mkdirSync(dirname(config.statePath), { recursive: true, mode: 0o700 });
const lockPath = config.statePath + ".lock";
const lock = openSync(lockPath, "wx", 0o600);
writeFileSync(lock, String(process.pid));
try {
  const store = new Store(config.statePath, config.key);
  const { app } = createApp(config, store);
  const server = app.listen(config.port, config.host, () =>
    console.error(`NiegeIP MCP listening on port ${config.port}`),
  );
  server.on("error", () => {
    console.error("Unable to start HTTP server");
    process.exitCode = 1;
    server.close();
  });
  const stop = () => {
    server.close(() => process.exit());
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("exit", () => {
    closeSync(lock);
    unlinkSync(lockPath);
  });
} catch {
  closeSync(lock);
  unlinkSync(lockPath);
  throw new Error("Cannot open encrypted state; verify configuration and key");
}
