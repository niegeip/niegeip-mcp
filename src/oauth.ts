import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthClientInformationFullSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  InvalidClientMetadataError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { z } from "zod";
import { Store, randomToken, digest } from "./store.js";
import { scopes, type Config } from "./config.js";
import { NiegeIPAPI } from "./api.js";

const pendingSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  redirectUri: z.string(),
  scopes: z.array(z.string()),
  resource: z.string(),
  codeChallenge: z.string(),
  state: z.string().optional(),
  browserHash: z.string(),
});
const codeSchema = pendingSchema.extend({ sessionId: z.string() });
const sessionSchema = z.object({
  upstreamToken: z.string(),
  clientId: z.string(),
  scopes: z.array(z.string()),
  resource: z.string(),
  expires: z.number(),
});
const tokenSchema = z.object({
  sessionId: z.string(),
  clientId: z.string(),
  scopes: z.array(z.string()),
  resource: z.string(),
  expires: z.number(),
  used: z.boolean().optional(),
});
const HOUR = 3600000,
  WEEK = 7 * 24 * HOUR;
export class Provider implements OAuthServerProvider {
  constructor(
    readonly config: Config,
    readonly store: Store,
    private fetcher: typeof fetch = fetch,
  ) {}
  readonly clientsStore = {
    getClient: async (clientId: string) =>
      this.store.get("client:" + clientId, OAuthClientInformationFullSchema),
    registerClient: async (
      client: Omit<
        OAuthClientInformationFull,
        "client_id" | "client_id_issued_at"
      >,
    ): Promise<OAuthClientInformationFull> => {
      if (client.token_endpoint_auth_method !== "none")
        throw new InvalidClientMetadataError(
          "Only public PKCE clients are supported",
        );
      if (!client.redirect_uris.length || client.redirect_uris.length > 10)
        throw new InvalidClientMetadataError("Provide 1–10 redirect URIs");
      for (const value of client.redirect_uris) {
        const u = new URL(value);
        const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(
          u.hostname,
        );
        if (
          u.username ||
          u.password ||
          u.hash ||
          !(u.protocol === "https:" || (u.protocol === "http:" && loopback))
        )
          throw new InvalidClientMetadataError(
            "HTTPS or loopback callbacks required",
          );
      }
      if (
        client.scope &&
        client.scope.split(" ").some((s) => !scopes.includes(s))
      )
        throw new InvalidScopeError("Unsupported scope");
      const value: OAuthClientInformationFull = {
        ...client,
        client_id: randomToken(),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method: "none",
        client_secret: undefined,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      };
      this.store.set("client:" + value.client_id, value, 365 * 24 * HOUR);
      return value;
    },
  };
  private target(resource?: URL) {
    if (!resource || resource.href !== this.config.resource.href)
      throw new InvalidTargetError("Use the advertised MCP resource URL");
  }
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ) {
    this.target(params.resource);
    const requested = params.scopes?.length ? params.scopes : scopes;
    if (requested.some((s) => !scopes.includes(s)))
      throw new InvalidScopeError("Unsupported scope");
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))
      throw new InvalidGrantError("S256 PKCE required");
    const request = randomToken(),
      browser = randomToken();
    this.store.set(
      "pending:" + digest(request),
      {
        clientId: client.client_id,
        clientName: client.client_name ?? "未命名应用",
        redirectUri: params.redirectUri,
        scopes: requested,
        resource: this.config.resource.href,
        codeChallenge: params.codeChallenge,
        state: params.state,
        browserHash: digest(browser),
      },
      10 * 60 * 1000,
    );
    res.cookie(this.cookieName(request), browser, {
      httpOnly: true,
      secure: !this.config.local,
      sameSite: "lax",
      path: "/connect",
      maxAge: 10 * 60 * 1000,
    });
    res.redirect("/connect?request=" + encodeURIComponent(request));
  }
  cookieName(request: string) {
    return "niegeip_flow_" + digest(request).slice(0, 16);
  }
  pending(request: string, browser: string) {
    const pending = this.store.get("pending:" + digest(request), pendingSchema);
    if (!pending || digest(browser) !== pending.browserHash)
      throw new InvalidGrantError("授权请求已过期，请返回 Agent 重新连接。");
    return pending;
  }
  async complete(
    request: string,
    browser: string,
    phone: string,
    code: string,
  ) {
    const pending = this.pending(request, browser);
    const { token } = await new NiegeIPAPI(
      this.config.api,
      undefined,
      this.fetcher,
    ).login(phone, code);
    await new NiegeIPAPI(this.config.api, token, this.fetcher).account();
    // Consume only after successful login; recheck after I/O to prevent concurrent completion.
    this.pending(request, browser);
    const sessionId = randomToken(),
      authorizationCode = randomToken();
    this.store.set(
      "session:" + sessionId,
      {
        upstreamToken: token,
        clientId: pending.clientId,
        scopes: pending.scopes,
        resource: pending.resource,
        expires: Date.now() + WEEK,
      },
      WEEK,
    );
    this.store.set(
      "code:" + digest(authorizationCode),
      { ...pending, sessionId },
      60000,
    );
    this.store.delete("pending:" + digest(request));
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", authorizationCode);
    if (pending.state !== undefined)
      redirect.searchParams.set("state", pending.state);
    redirect.searchParams.set("iss", this.config.issuer.href);
    return redirect.href;
  }
  deny(request: string, browser: string) {
    const pending = this.pending(request, browser);
    this.store.delete("pending:" + digest(request));
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    if (pending.state !== undefined)
      redirect.searchParams.set("state", pending.state);
    return redirect.href;
  }
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ) {
    const row = this.store.get("code:" + digest(code), codeSchema);
    if (
      !row ||
      row.clientId !== client.client_id ||
      row.resource !== this.config.resource.href
    )
      throw new InvalidGrantError("Invalid authorization code");
    return row.codeChallenge;
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.target(resource);
    const row = this.store.get("code:" + digest(code), codeSchema);
    if (
      !row ||
      row.clientId !== client.client_id ||
      row.resource !== this.config.resource.href ||
      row.redirectUri !== redirectUri
    )
      throw new InvalidGrantError("Invalid authorization code");
    this.store.delete("code:" + digest(code));
    return this.issue(row.sessionId, row.clientId, row.scopes);
  }
  private issue(
    sessionId: string,
    clientId: string,
    allowed: string[],
  ): OAuthTokens {
    const session = this.store.get("session:" + sessionId, sessionSchema);
    if (!session || session.resource !== this.config.resource.href)
      throw new InvalidGrantError("Session expired");
    const access = randomToken(),
      refresh = randomToken();
    const lifetime = Math.min(HOUR, session.expires - Date.now());
    if (lifetime < 1000) throw new InvalidGrantError("Session expired");
    const row = {
      sessionId,
      clientId,
      scopes: allowed,
      resource: session.resource,
      expires: Date.now() + lifetime,
    };
    this.store.set("access:" + digest(access), row, lifetime);
    this.store.set(
      "refresh:" + digest(refresh),
      { ...row, expires: session.expires },
      session.expires - Date.now(),
    );
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: Math.floor(lifetime / 1000),
      scope: allowed.join(" "),
    };
  }
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    token: string,
    requested?: string[],
    resource?: URL,
  ) {
    this.target(resource);
    const key = "refresh:" + digest(token),
      row = this.store.get(key, tokenSchema);
    if (
      !row ||
      row.clientId !== client.client_id ||
      row.resource !== this.config.resource.href
    )
      throw new InvalidGrantError("Invalid refresh token");
    if (row.used) {
      this.store.delete("session:" + row.sessionId);
      throw new InvalidGrantError("Refresh token reuse detected; reconnect");
    }
    const allowed = requested ?? row.scopes;
    if (allowed.some((s) => !row.scopes.includes(s)))
      throw new InvalidScopeError("Scope escalation denied");
    // Mark used synchronously before any await. Reuse revokes this authorization family.
    this.store.set(key, { ...row, used: true }, row.expires - Date.now());
    const session = this.store.get("session:" + row.sessionId, sessionSchema);
    if (!session || session.resource !== this.config.resource.href)
      throw new InvalidGrantError("Session expired");
    try {
      await new NiegeIPAPI(
        this.config.api,
        session.upstreamToken,
        this.fetcher,
      ).account();
    } catch {
      this.store.delete("session:" + row.sessionId);
      throw new InvalidGrantError("Platform session expired; reconnect");
    }
    return this.issue(row.sessionId, row.clientId, allowed);
  }
  async verifyAccessToken(token: string) {
    const row = this.store.get("access:" + digest(token), tokenSchema);
    if (
      !row ||
      row.resource !== this.config.resource.href ||
      !this.store.get("session:" + row.sessionId, sessionSchema)
    )
      throw new InvalidTokenError("Token expired or revoked");
    return {
      token,
      clientId: row.clientId,
      scopes: row.scopes,
      expiresAt: Math.floor(row.expires / 1000),
      resource: this.config.resource,
    };
  }
  upstream(token: string) {
    const row = this.store.get("access:" + digest(token), tokenSchema);
    const session = row
      ? this.store.get("session:" + row.sessionId, sessionSchema)
      : undefined;
    if (!session || session.resource !== this.config.resource.href)
      throw new InvalidTokenError("Reconnect NiegeIP");
    return new NiegeIPAPI(this.config.api, session.upstreamToken, this.fetcher);
  }
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ) {
    const row =
      this.store.get("access:" + digest(request.token), tokenSchema) ??
      this.store.get("refresh:" + digest(request.token), tokenSchema);
    if (row?.clientId === client.client_id)
      this.store.delete("session:" + row.sessionId);
  }
}
