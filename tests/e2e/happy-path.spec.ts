import { expect, test, type Page } from "@playwright/test";

/** Registo → criar liga → convite → segundo manager entra → clubes → escalação → jornada → jogo → tabela → mercado. */
const stamp = Date.now().toString(36);
const ana = { email: `ana-${stamp}@e2e.test`, name: "Ana E2E", password: "password-ana-123" };
const rui = { email: `rui-${stamp}@e2e.test`, name: "Rui E2E", password: "password-rui-123" };

async function signup(page: Page, u: typeof ana) {
  await page.goto("/auth?mode=signup");
  await page.getByLabel("Nome de treinador").fill(u.name);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Palavra-passe").fill(u.password);
  await page.getByRole("button", { name: "Criar conta" }).last().click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("two friends play a matchday end to end", async ({ browser }) => {
  const anaCtx = await browser.newContext();
  const ruiCtx = await browser.newContext();
  const a = await anaCtx.newPage();
  const r = await ruiCtx.newPage();

  // Ana registers and creates a league
  await signup(a, ana);
  await a.getByRole("link", { name: "Criar liga" }).click();
  await a.getByLabel("Nome da liga").fill(`Liga E2E ${stamp}`);
  await a.getByRole("button", { name: "Criar liga" }).click();
  await expect(a).toHaveURL(/\/settings\?invite=/);
  const code = await a.locator("code").first().innerText();
  expect(code).toMatch(/^[A-Z2-9]{16}$/);
  const gameUrl = a.url().replace(/\/settings.*$/, "");

  // Rui registers and joins with the code
  await signup(r, rui);
  await r.goto(`/join/${code}`);
  await r.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(r).toHaveURL(new RegExp(gameUrl.replace(/^https?:\/\/[^/]+/, "")));

  // Both choose clubs
  await a.goto(gameUrl);
  await a.getByRole("button", { name: "Escolher" }).first().click();
  await expect(a.getByText("O meu clube")).toBeVisible();
  await r.reload();
  await r.getByRole("button", { name: "Escolher" }).first().click();
  await expect(r.getByText("O meu clube")).toBeVisible();

  // Ana starts the league
  a.on("dialog", (d) => d.accept());
  await a.reload();
  await a.getByRole("button", { name: "Iniciar liga" }).click();
  await expect(a.getByRole("button", { name: /Jogar jornada 1/ })).toBeVisible();

  // Rui sets lineup + tactics
  await r.goto(`${gameUrl}/tactics`);
  await r.getByRole("button", { name: "Auto-escalar" }).click();
  await r.getByRole("radio", { name: "Alta" }).first().click(); // pressing high
  await r.getByRole("button", { name: "Guardar escalação e tática" }).click();
  await expect(r.getByText("Escalação e tática guardadas.")).toBeVisible();

  // Ana processes matchday 1
  await a.getByRole("button", { name: /Jogar jornada 1/ }).click();
  await expect(a.getByText("Jornada 1 concluída.", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Rui sees the result, opens the match and the table
  await r.goto(`${gameUrl}/fixtures`);
  const played = r.locator("a[href*='/matches/']").first();
  await played.click();
  await expect(r.getByText("Estatísticas")).toBeVisible();
  await expect(r.getByText("Golos esperados (xG)")).toBeVisible();
  await r.goto(`${gameUrl}/table`);
  await expect(r.getByRole("cell", { name: "Pts" }).or(r.getByText("Pts"))).toBeVisible();
  const playedCells = await r.locator("tbody tr").count();
  expect(playedCells).toBeGreaterThan(3);

  // Rui buys a player from an AI club at the asking price
  await r.goto(`${gameUrl}/market?listed=`);
  await r.locator("a", { hasText: "Proposta" }).last().click();
  await expect(r.getByLabel("Valor da proposta (€)")).toBeVisible();
  await r.getByRole("button", { name: "Fazer proposta" }).click();
  await expect(r.getByText(/Proposta aceite|Proposta enviada|Recusada/).first()).toBeVisible();
  await r.goto(`${gameUrl}/finances`);
  await expect(r.getByRole("columnheader", { name: "Saldo" })).toBeVisible();
  await expect(r.getByText("Saldo inicial").first()).toBeVisible();

  // An outsider gets 404 for the league
  const outsider = await (await browser.newContext()).newPage();
  await signup(outsider, { email: `x-${stamp}@e2e.test`, name: "Intruso", password: "password-x-1234" });
  const resp = await outsider.goto(gameUrl);
  expect(resp?.status()).toBe(404);
});
