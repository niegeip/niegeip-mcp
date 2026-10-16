import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixture } from "./helpers.js";
const f = await fixture();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
});
const output = "outputs/browser";
mkdirSync(output, { recursive: true });
try {
  const registered = (await (
    await f.request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "NiegeIP Browser Test",
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      }),
    })
  ).json()) as { client_id: string };
  const params = new URLSearchParams({
    client_id: registered.client_id,
    response_type: "code",
    redirect_uri: "https://client.example/callback",
    code_challenge: createHash("sha256")
      .update("v".repeat(64))
      .digest("base64url"),
    code_challenge_method: "S256",
    scope: "account:read ips:read assets:download",
    resource: f.config.resource.href,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ body: "callback received", contentType: "text/plain" }),
  );
  await page.goto(f.base + "/authorize?" + params);
  await page
    .getByRole("heading", { name: "授权给 NiegeIP Browser Test" })
    .waitFor();
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    scan.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  await page.screenshot({ path: output + "/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "登录并授权", exact: true }).click();
  await page.getByText("请输入 11 位中国大陆手机号。").waitFor();
  assert.equal(
    await page.locator("#phone").getAttribute("aria-invalid"),
    "true",
  );
  await page.getByLabel("NiegeIP 账户手机号").fill("13800000000");
  await page.route("**/connect/sms", async (route) => {
    await new Promise((r) => setTimeout(r, 200));
    await route.continue();
  });
  await page.getByRole("button", { name: "获取验证码" }).click();
  assert(
    await page
      .getByRole("button", { name: "登录并授权", exact: true })
      .isDisabled(),
  );
  await page.getByText("验证码已发送，请查看短信。").waitFor();
  await page.getByLabel("短信验证码", { exact: true }).fill("000000");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "登录并授权", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "请求未完成" }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: output + "/mobile-error.png", fullPage: true });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByLabel("短信验证码", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "显示", exact: true }).click();
  assert.equal(await page.locator("#code").getAttribute("type"), "text");
  await page.getByRole("button", { name: "隐藏", exact: true }).click();
  await page.getByRole("button", { name: "登录并授权", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL("https://client.example/callback?**");
  assert(new URL(page.url()).searchParams.get("code"));
  // New authorization and explicit cancellation remain available without login.
  await page.goto(f.base + "/authorize?" + params);
  await page.getByRole("button", { name: "取消连接" }).click();
  await page.waitForURL("https://client.example/callback?error=access_denied");
  assert.deepEqual(errors, []);
  console.log(
    "Browser: desktop/mobile, axe AA, validation, pending, OTP failure, keyboard success, cancellation passed.",
  );
} finally {
  await browser.close();
  await f.close();
}
