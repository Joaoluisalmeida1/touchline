import { expect, test, type Page } from "@playwright/test";

/**
 * UI v2 screen sweep: every game route renders inside the new shell, in both themes, at phone (360) and desktop
 * (1440) widths, with no horizontal page scroll. Screenshots land in test-results/screens/ for visual review.
 */
test.setTimeout(720_000);

const ROUTES = ["", "/week", "/squad", "/tactics", "/fixtures", "/market", "/club", "/finances", "/table", "/news", "/cup", "/social", "/history", "/settings"];
const SIZES = [{ name: "phone", width: 360, height: 780 }, { name: "desktop", width: 1440, height: 900 }] as const;

async function overflow(page: Page) {
  return page.evaluate(() => {
    const over = document.documentElement.scrollWidth - window.innerWidth;
    if (over <= 1) return { over, culprits: "" };
    const culprits = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed")
      .slice(-3).map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 80)}`).join(" | ");
    return { over, culprits };
  });
}

test("every game screen renders in the v2 shell (dark + light, 360 + 1440)", async ({ page }) => {
  const stamp = Date.now().toString(36);
  page.on("dialog", (d) => d.accept());
  await page.goto("/auth?mode=signup");
  await page.getByLabel("Nome de treinador").fill("Screens E2E");
  await page.getByLabel("Email").fill(`screens-${stamp}@e2e.test`);
  await page.getByLabel("Palavra-passe").fill("password-screens-123");
  await page.getByRole("button", { name: "Criar conta" }).last().click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("link", { name: "Criar liga" }).first().click();
  await page.getByLabel("Nome da liga").fill(`Liga Ecrãs ${stamp}`);
  await page.getByRole("button", { name: "Criar liga" }).click();
  await expect(page).toHaveURL(/\/settings\?invite=/);
  const gameUrl = page.url().replace(/\/settings.*$/, "");
  await page.goto(gameUrl);
  await page.getByRole("button", { name: "Escolher" }).first().click();
  await expect(page.getByText("O meu clube")).toBeVisible();
  await page.getByRole("button", { name: "Iniciar liga" }).click();
  await page.getByRole("button", { name: /Jogar jornada 1/ }).click();
  await expect(page.getByText("Jornada 1 concluída.", { exact: true })).toBeVisible({ timeout: 60_000 });

  // a player page and a match page too
  await page.goto(`${gameUrl}/fixtures`);
  const matchHref = await page.locator(`a[href*="/matches/"]`).first().getAttribute("href");
  if (matchHref) await page.goto(matchHref);
  const playerHref = matchHref ? await page.locator(`a[href*="/players/"]`).first().getAttribute("href") : null;
  await page.goto(`${gameUrl}/table`);
  const clubHref = await page.locator(`a[href*="/clubs/"]`).first().getAttribute("href");
  const routes = [...ROUTES.map((r) => gameUrl + r), ...[playerHref, matchHref, clubHref].filter((h): h is string => !!h)];

  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((t) => localStorage.setItem("tl-theme", t), theme);
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const url of routes) {
        await page.goto(url);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByRole("navigation", { name: /Navegação da liga/ }).first()).toBeAttached();
        expect.soft(await page.getByText(/Application error|Unhandled Runtime Error/).count(), `${url} shows an error`).toBe(0);
        const o = await overflow(page);
        expect.soft(o.over, `${url} overflows at ${size.width}px (${theme}): ${o.culprits}`).toBeLessThanOrEqual(1);
        const slug = (url.replace(/^.*\/g\/[0-9a-f-]+/, "").replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-") || "home").slice(0, 40);
        await page.screenshot({ path: `test-results/screens/${theme}-${size.name}-${slug}.png`, fullPage: true });
      }
    }
  }

  // command palette + today drawer
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(gameUrl);
  await page.getByRole("button", { name: /^Procurar/ }).click();
  await page.getByRole("combobox", { name: "Procurar" }).fill("financas");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/finances$/);
  await page.getByRole("button", { name: /^Por decidir/ }).click();
  await expect(page.getByRole("dialog", { name: "Por decidir" })).toBeVisible();
  await page.waitForTimeout(700); // let the drawer finish sliding in
  await page.screenshot({ path: "test-results/screens/light-desktop-today-drawer.png" });
});
