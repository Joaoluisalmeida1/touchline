import { expect, test } from "@playwright/test";

/** Route guards: anonymous users are sent to /auth, signed-in users cannot see leagues or admin pages they don't belong to. */
const stamp = Date.now().toString(36);

test("security headers are sent and the framework is not advertised", async ({ request }) => {
  for (const path of ["/", "/auth", "/api/health"]) {
    const h = (await request.get(path)).headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-powered-by"]).toBeUndefined();
  }
});

test("anonymous visitors are redirected to sign-in with a return path", async ({ page }) => {
  for (const path of ["/dashboard", "/games/new", "/admin/import"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/auth\\?next=${encodeURIComponent(path).replace(/%2F/g, "(/|%2F)")}`));
  }
});

test("signed-in non-members and non-admins get a 404, never the data", async ({ page }) => {
  await page.goto("/auth?mode=signup");
  await page.getByLabel("Nome de treinador").fill("Intruso E2E");
  await page.getByLabel("Email").fill(`intruso-${stamp}@e2e.test`);
  await page.getByLabel("Palavra-passe").fill("password-intruso-123");
  await page.getByRole("button", { name: "Criar conta" }).last().click();
  await expect(page).toHaveURL(/\/dashboard/);

  // unknown and foreign league ids look the same (no enumeration)
  const league = await page.goto("/g/00000000-0000-4000-8000-000000000000");
  expect(league?.status()).toBe(404);
  const admin = await page.goto("/admin/import");
  expect(admin?.status()).toBe(404);
});
