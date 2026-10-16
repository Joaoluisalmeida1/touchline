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

  // Rui builds his lineup in the squad hub: formation, auto-pick, drag & drop, tap-to-place, role, captain, tactics
  await r.goto(`${gameUrl}/squad`);
  await r.getByRole("button", { name: /^4-3-3/ }).click();
  await r.getByRole("option", { name: "3-4-2-1" }).click();
  await r.getByRole("button", { name: /Auto-escalar/ }).click();
  await r.getByRole("button", { name: /Melhor onze/ }).click();
  await expect(r.getByText("Onze sugerido aplicado.")).toBeVisible();
  // drag the first reserve onto the striker slot (mouse drag → dnd-kit)
  const reserve = r.getByRole("heading", { name: "Não convocados" }).locator("xpath=ancestor::section[1]").locator("li").first();
  const striker = r.getByRole("button", { name: /^PL:/ });
  const reserveName = (await reserve.locator("p").first().innerText()).replace(/^\d+\s*/, "").trim();
  await reserve.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const rb = await reserve.boundingBox(), sb = await striker.boundingBox();
  if (rb && sb) {
    await r.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await r.mouse.down();
    await r.mouse.move(rb.x + rb.width / 2 + 20, rb.y + rb.height / 2 + 10, { steps: 4 });
    await r.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 12 });
    await r.mouse.up();
  }
  await expect(r.getByRole("button", { name: `PL: ${reserveName}` })).toBeVisible();
  // tap-to-place: select the GK token, open its panel, then pick a striker role via the ST token
  await striker.click();
  await r.getByRole("button", { name: /Falso 9/ }).click();
  await r.getByRole("button", { name: "Capitão" }).click();
  await r.screenshot({ path: "test-results/squad-hub-desktop.png", fullPage: true });
  await r.getByRole("tab", { name: "Instruções" }).click();
  await r.getByRole("radio", { name: "Alta" }).first().click(); // pressing high
  await r.getByRole("tab", { name: "Lista" }).click();
  await expect(r.getByRole("columnheader", { name: /OVR/ })).toBeVisible();
  await r.getByRole("tab", { name: "Profundidade" }).click();
  await expect(r.getByText("Profundidade por posição")).toBeVisible();
  await r.getByRole("button", { name: "Guardar escalação" }).click();
  await expect(r.getByText("Escalação e tática guardadas.")).toBeVisible();

  // Rui's matchday week: press conference (tone + free text), training plan, scouting report
  await r.goto(`${gameUrl}/week?tab=imprensa`);
  const tones = r.getByRole("radiogroup", { name: /Tom da resposta/ });
  await expect(tones.first()).toBeVisible();
  const nq = await tones.count();
  for (let i = 0; i < nq; i++) await tones.nth(i).getByRole("radio", { name: i === 0 ? "Provocador" : "Calmo" }).click();
  await r.getByLabel("Texto da resposta 1").fill("Vamos jogar para ganhar, como sempre.");
  await r.screenshot({ path: "test-results/week-press-desktop.png", fullPage: true });
  await r.getByRole("button", { name: "Responder aos jornalistas" }).click();
  await expect(r.getByText("Conferência terminada")).toBeVisible();
  await r.getByRole("tab", { name: /^Treino/ }).click();
  await r.getByText("Intensa", { exact: true }).click();
  await r.getByText("Posse", { exact: true }).click();
  await r.getByRole("button", { name: "Guardar treino" }).click();
  await expect(r.getByText("Plano de treino guardado.")).toBeVisible();
  await r.screenshot({ path: "test-results/week-training-desktop.png", fullPage: true });
  await r.getByRole("tab", { name: /^Adversário/ }).click();
  await expect(r.getByText("Relatório do olheiro")).toBeVisible();
  await r.screenshot({ path: "test-results/week-scout-desktop.png", fullPage: true });

  // Rui runs the club: signs a shirt sponsor, raises ticket prices, checks the board and staff
  r.on("dialog", (d) => d.accept());
  await r.goto(`${gameUrl}/club`);
  await expect(r.getByRole("tab", { name: /^Patrocínios/ })).toHaveAttribute("aria-selected", "true");
  await r.getByRole("button", { name: "Assinar" }).first().click();
  await expect(r.getByText(/Até à época/).first()).toBeVisible();
  await r.screenshot({ path: "test-results/club-sponsors-desktop.png", fullPage: true });
  await r.getByRole("tab", { name: /^Estádio/ }).click();
  await r.getByText("Alto", { exact: true }).click();
  await r.getByRole("button", { name: "Guardar preço" }).click();
  await expect(r.getByText("Preço dos bilhetes atualizado.")).toBeVisible();
  await r.screenshot({ path: "test-results/club-stadium-desktop.png", fullPage: true });
  await r.getByRole("tab", { name: /^Direção/ }).click();
  await expect(r.getByText("Confiança da direção")).toBeVisible();
  await r.screenshot({ path: "test-results/club-board-desktop.png", fullPage: true });
  await r.getByRole("tab", { name: /^Staff/ }).click();
  await expect(r.getByText("Preparador físico")).toBeVisible();
  await r.screenshot({ path: "test-results/club-staff-desktop.png", fullPage: true });

  // Ana processes matchday 1
  await a.getByRole("button", { name: /Jogar jornada 1/ }).click();
  await expect(a.getByText("Jornada 1 concluída.", { exact: true })).toBeVisible({ timeout: 30_000 });

  // the Balneário: the round's headline was auto-posted; Rui posts and reacts
  await r.goto(`${gameUrl}/social`);
  await expect(r.getByText(/O Apito, J1/)).toBeVisible();
  await r.getByLabel("Mensagem para o mural").fill("Primeira jornada feita. Ana, prepara-te!");
  await r.getByRole("button", { name: "Publicar" }).click();
  await expect(r.getByText("Primeira jornada feita. Ana, prepara-te!")).toBeVisible();
  await r.getByRole("button", { name: "Reagir 🔥" }).first().click();
  await r.getByRole("tab", { name: /^Conquistas/ }).click();
  await expect(r.getByText(/conquistas nesta liga/)).toBeVisible();
  await r.getByRole("tab", { name: /^Mural/ }).click();
  await expect(r.getByLabel("Mensagem para o mural")).toBeVisible();
  await r.screenshot({ path: "test-results/social-desktop.png", fullPage: true });

  // O Apito quotes Rui's press conference
  await r.goto(`${gameUrl}/news`);
  await expect(r.getByText(/Vamos jogar para ganhar, como sempre/).first()).toBeVisible();

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
  await r.goto(`${gameUrl}/market?listed=&league=game`);
  await r.locator("a", { hasText: "Proposta" }).last().click();
  await expect(r.getByLabel("Valor da proposta (€)")).toBeVisible();
  await r.getByRole("button", { name: "Fazer proposta" }).click();
  await expect(r.getByText(/Proposta aceite|Proposta enviada|Recusada/).first()).toBeVisible();
  await r.goto(`${gameUrl}/finances`);
  await expect(r.getByRole("columnheader", { name: "Saldo" })).toBeVisible();
  await expect(r.getByText("Contas da época (blocos de 4 jornadas)")).toBeVisible();
  await r.screenshot({ path: "test-results/finances-desktop.png", fullPage: true });
  await expect(r.getByText("Saldo inicial").first()).toBeVisible();

  // An outsider gets 404 for the league
  const outsider = await (await browser.newContext()).newPage();
  await signup(outsider, { email: `x-${stamp}@e2e.test`, name: "Intruso", password: "password-x-1234" });
  const resp = await outsider.goto(gameUrl);
  expect(resp?.status()).toBe(404);
});
