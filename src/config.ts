import { z } from "zod";
export const scopes = ["account:read", "ips:read", "assets:download"];
export function safeBase(raw: string, local: boolean): URL {
  const u = new URL(raw);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(
      u.protocol === "https:" ||
      (local &&
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    )
  )
    throw new Error(
      "Use HTTPS, or explicit loopback HTTP for local development",
    );
  return u;
}
export function configuration(env: NodeJS.ProcessEnv = process.env) {
  const local = env.NIEGEIP_LOCAL === "true";
  const issuer = safeBase(env.NIEGEIP_ISSUER ?? "http://127.0.0.1:8787", local);
  if (issuer.pathname !== "/")
    throw new Error("Issuer must be an origin without a path");
  const api = safeBase(
    env.NIEGEIP_API_URL ?? "http://127.0.0.1:8081/api/web",
    local,
  );
  const key = z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .parse(env.NIEGEIP_STATE_KEY);
  return {
    local,
    issuer,
    api,
    key,
    statePath: env.NIEGEIP_STATE_PATH ?? ".state/oauth.enc",
    host: env.NIEGEIP_HOST ?? "127.0.0.1",
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.PORT ?? "8787"),
    resource: new URL("/mcp", issuer),
    origins: (env.NIEGEIP_CLIENT_ORIGINS ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => safeBase(x, local).origin),
  };
}
export type Config = ReturnType<typeof configuration>;
