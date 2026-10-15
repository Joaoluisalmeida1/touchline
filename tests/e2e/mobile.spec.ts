import { expect, test } from "@playwright/test";

test("landing and auth are usable on mobile without horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.goto("/auth");
  await expect(page.getByLabel("Email")).toBeVisible();
});
