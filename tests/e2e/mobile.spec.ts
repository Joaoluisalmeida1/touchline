import { expect, test } from "@playwright/test";

test("landing and auth are usable on mobile without horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.goto("/auth");
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("squad hub works on a phone (tap-to-place, no horizontal scroll)", async ({ page }) => {
  const stamp = Date.now().toString(36);
  await page.goto("/auth?mode=signup");
  await page.getByLabel("Nome de treinador").fill("Mobile E2E");
  await page.getByLabel("Email").fill(`mob-${stamp}@e2e.test`);
  await page.getByLabel("Palavra-passe").fill("password-mob-123");
  await page.getByRole("button", { name: "Criar conta" }).last().click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("link", { name: "Criar liga" }).first().click();
  await page.getByLabel("Nome da liga").fill(`Liga Mobile ${stamp}`);
  await page.getByRole("button", { name: "Criar liga" }).click();
  await expect(page).toHaveURL(/\/settings\?invite=/);
  const gameUrl = page.url().replace(/\/settings.*$/, "");
  await page.goto(gameUrl);
  await page.getByRole("button", { name: "Escolher" }).first().click();
  await expect(page.getByText("O meu clube")).toBeVisible();
  await page.goto(`${gameUrl}/squad`);
  await expect(page.getByRole("button", { name: /^GR:/ })).toBeVisible();
  // tap a reserve, then tap the striker slot
  const reserve = page.locator("li").filter({ hasText: /cond\. \d+%/ }).last();
  const name = (await reserve.locator("p").first().innerText()).replace(/^\d+\s*/, "").trim();
  await reserve.getByRole("button").click();
  await page.getByRole("button", { name: /^PL:/ }).first().click();
  await expect(page.getByRole("button", { name: `PL: ${name}` })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/squad-hub-mobile.png", fullPage: false });
  // the matchday week fits a phone too (league started → press + training + scouting tabs)
  page.on("dialog", (d) => d.accept());
  await page.goto(gameUrl);
  await page.getByRole("button", { name: "Iniciar liga" }).click();
  await expect(page.getByRole("button", { name: /Jogar jornada 1/ })).toBeVisible();
  await page.goto(`${gameUrl}/week?tab=imprensa`);
  await expect(page.getByRole("radiogroup", { name: /Tom da resposta/ }).first()).toBeVisible();
  for (const tab of [/^Treino/, /^Adversário/, /^Imprensa/]) {
    await page.getByRole("tab", { name: tab }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: "test-results/week-mobile.png", fullPage: true });
});
