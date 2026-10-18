"use server";
/**
 * Server Actions (commands). Each one: authenticate -> validate (zod) -> call a SECURITY DEFINER SQL command as the
 * user (membership/ownership enforced in SQL with auth.uid()) or a trusted service -> map errors -> revalidate.
 * Next.js Server Actions are POST-only with Origin checks (CSRF protection).
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool, withUser } from "../db";
import { domainError } from "../pg";
import { requireUser, signIn, signOut, signUp } from "../auth";
import { createGame, CreateGameInput } from "../services/create-game";
import { processNextMatchday } from "../services/matchday";
import { signExternalPlayer } from "../services/external-market";
import { deletePushSubscription, flushPush, savePushSubscription } from "../services/push";
import { FORMATIONS, SLOTS } from "../../engine/common/types";

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  data?: Record<string, unknown>;
}

function fail(e: unknown): ActionState {
  const d = domainError(e);
  if (d) return { error: d.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Dados inválidos." };
  if (e && typeof e === "object" && "digest" in e) throw e; // let Next.js redirects propagate
  console.error(JSON.stringify({ level: "error", msg: "action.failed", error: (e as Error)?.message }));
  return { error: "Ocorreu um erro inesperado. Tenta novamente." };
}

/* ------------------------------- auth ------------------------------- */
const Credentials = z.object({
  email: z.string().trim().toLowerCase().email("Email inválido."),
  password: z.string().min(8, "A palavra-passe precisa de pelo menos 8 caracteres.").max(72),
});

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = Credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = await signIn(parsed.data.email, parsed.data.password);
  if (r.error) return { error: r.error };
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function signupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = Credentials.extend({ displayName: z.string().trim().min(2, "Nome demasiado curto.").max(40) })
    .safeParse({ email: form.get("email"), password: form.get("password"), displayName: form.get("displayName") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = await signUp(parsed.data.email, parsed.data.password, parsed.data.displayName);
  if (r.error) return { error: r.error };
  if (r.needsConfirmation) return { ok: true, message: "Conta criada. Confirma o email que te enviámos para entrar." };
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  await signOut();
  redirect("/");
}

/* ------------------------------- leagues ------------------------------- */
export async function createGameAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  let created: { gameId: string; inviteCode: string };
  try {
    const input = CreateGameInput.parse({
      name: form.get("name"), snapshotId: form.get("snapshotId"), leagueId: form.get("leagueId"),
      maxManagers: form.get("maxManagers") ?? 20, tickMode: form.get("tickMode") ?? "manual",
      timezone: form.get("timezone") ?? "Europe/Lisbon", deadlineHour: form.get("deadlineHour") ?? 20,
      roundIntervalHours: form.get("roundIntervalHours") ?? 24,
    });
    created = await createGame(getPool(), user.id, input);
  } catch (e) {
    return fail(e);
  }
  redirect(`/g/${created.gameId}/settings?invite=${created.inviteCode}`);
}

export async function joinGameAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const code = String(form.get("code") ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  let gameId: string;
  try {
    gameId = await withUser(user.id, async (c) => (await c.query(`select public.join_game($1) g`, [code])).rows[0].g);
  } catch (e) {
    return fail(e);
  }
  redirect(`/g/${gameId}`);
}

async function userCommand(gameId: string, sql: string, params: unknown[], message: string, paths: string[] = []): Promise<ActionState> {
  const user = await requireUser();
  try {
    const rows = await withUser(user.id, async (c) => (await c.query(sql, params)).rows);
    for (const p of [`/g/${gameId}`, ...paths]) revalidatePath(p, "layout");
    return { ok: true, message, data: rows[0] ?? {} };
  } catch (e) {
    return fail(e);
  }
}

const uuid = z.string().uuid();

export async function selectClubAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  return userCommand(gameId, `select public.select_club($1, $2)`, [gameId, uuid.parse(form.get("clubId"))], "Clube escolhido. Boa sorte!");
}

export async function startGameAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  return userCommand(gameId, `select public.start_game($1) as rounds`, [gameId], "Liga iniciada! O calendário foi gerado.");
}

export async function rotateInviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  const r = await userCommand(gameId, `select public.rotate_invite($1, 168) as code`, [gameId], "Novo convite gerado (válido 7 dias). O anterior deixou de funcionar.");
  if (r.ok && typeof r.data?.code === "string") redirect(`/g/${gameId}/settings?invite=${r.data.code}`);
  return r;
}

export async function revokeInviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  return userCommand(gameId, `select public.revoke_invite($1)`, [gameId], "Convite revogado.");
}

export async function leaveGameAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  const r = await userCommand(gameId, `select public.leave_game($1)`, [gameId], "Saíste da liga.");
  if (r.ok) redirect("/dashboard");
  return r;
}

export async function updateSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  const S = z.object({
    name: z.string().trim().min(3).max(60), tickMode: z.enum(["manual", "daily"]), timezone: z.string().min(3),
    deadlineHour: z.coerce.number().int().min(0).max(23), roundIntervalHours: z.coerce.number().int().min(1).max(336),
  });
  const p = S.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  return userCommand(gameId, `select public.update_game_settings($1,$2,$3,$4,$5,$6)`,
    [gameId, p.data.name, p.data.tickMode, p.data.timezone, p.data.deadlineHour, p.data.roundIntervalHours], "Definições guardadas.");
}

/** Owner-triggered matchday processing (manual mode / universal fallback). */
export async function processMatchdayAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const gameId = uuid.parse(form.get("gameId"));
  try {
    const isOwner = await withUser(user.id, async (c) =>
      (await c.query(`select 1 from games where id = $1 and owner_user_id = $2`, [gameId, user.id])).rowCount === 1);
    if (!isOwner) return { error: "Só o criador da liga pode avançar a jornada." };
    const r = await processNextMatchday(getPool(), gameId, { requestId: randomUUID() });
    revalidatePath(`/g/${gameId}`, "layout");
    if (r.status === "skipped") {
      const reasons: Record<string, string> = {
        lease_held: "Já há uma jornada em processamento.", not_active: "A liga ainda não começou.",
      };
      return { error: reasons[r.reason ?? ""] ?? `Nada para processar (${r.reason}).` };
    }
    return { ok: true, message: r.round ? `Jornada ${r.round} concluída.${r.season_completed ? " Época terminada — começa uma nova!" : ""}` : "Época concluída.", data: { round: r.round } };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------- squad / tactics ------------------------------- */
const Slot = z.enum(SLOTS);
const LineupInput = z.object({
  gameId: uuid,
  formation: z.enum(FORMATIONS),
  starters: z.array(z.object({ player_id: uuid, slot: Slot, role: z.string().max(40).nullish() })).length(11, "Escolhe 11 titulares."),
  bench: z.array(uuid).max(9),
  instructions: z.object({
    captain: uuid.nullish(), penalty_taker: uuid.nullish(), freekick_taker: uuid.nullish(), corner_taker: uuid.nullish(),
  }).default({}),
  tactics: z.object({
    mentality: z.enum(["defensive", "balanced", "attacking"]), tempo: z.enum(["slow", "normal", "high"]),
    pressing: z.enum(["low", "medium", "high"]), defensive_line: z.enum(["low", "medium", "high"]),
    width: z.enum(["narrow", "balanced", "wide"]), passing_directness: z.enum(["short", "mixed", "direct"]),
    transitions: z.enum(["possession", "balanced", "counter"]),
  }),
});

export async function saveLineupAction(input: z.input<typeof LineupInput>): Promise<ActionState> {
  const user = await requireUser();
  const p = LineupInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const ins = Object.fromEntries(Object.entries(p.data.instructions).filter(([, v]) => v));
  try {
    await withUser(user.id, async (c) => {
      await c.query(`select public.save_tactics($1, $2)`, [p.data.gameId, JSON.stringify({ ...p.data.tactics, formation: p.data.formation })]);
      await c.query(`select public.save_lineup_v2($1, $2, $3, $4, $5)`, [p.data.gameId, p.data.formation,
        JSON.stringify(p.data.starters.map((s) => ({ player_id: s.player_id, slot: s.slot, ...(s.role ? { role: s.role } : {}) }))),
        JSON.stringify(p.data.bench), JSON.stringify(ins)]);
    });
    revalidatePath(`/g/${p.data.gameId}`, "layout");
    return { ok: true, message: "Escalação e tática guardadas." };
  } catch (e) {
    return fail(e);
  }
}

const PresetInput = z.object({ gameId: uuid, name: z.string().trim().min(1, "Dá um nome.").max(40), payload: z.record(z.string(), z.unknown()) });
export async function saveTacticPresetAction(input: z.input<typeof PresetInput>): Promise<ActionState> {
  const p = PresetInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  return userCommand(p.data.gameId, `select public.save_tactic_preset($1, $2, $3) as id`, [p.data.gameId, p.data.name, JSON.stringify(p.data.payload)], `Predefinição "${p.data.name}" guardada.`);
}
export async function archiveTacticPresetAction(input: { gameId: string; presetId: string }): Promise<ActionState> {
  const gameId = uuid.parse(input.gameId);
  return userCommand(gameId, `select public.archive_tactic_preset($1)`, [uuid.parse(input.presetId)], "Predefinição apagada.");
}
export async function setPreferredSlotAction(input: { gameId: string; playerId: string; slot: string }): Promise<ActionState> {
  const gameId = uuid.parse(input.gameId);
  const slot = Slot.safeParse(input.slot);
  if (!slot.success) return { error: "Posição inválida." };
  return userCommand(gameId, `select public.set_preferred_slot($1, $2)`, [uuid.parse(input.playerId), slot.data], "Posição preferida definida.");
}
export async function setShirtNumberAction(input: { gameId: string; playerId: string; number: number | null }): Promise<ActionState> {
  const gameId = uuid.parse(input.gameId);
  const n = z.number().int().min(1, "Número entre 1 e 99.").max(99, "Número entre 1 e 99.").nullable().safeParse(input.number);
  if (!n.success) return { error: n.error.issues[0].message };
  return userCommand(gameId, `select public.set_shirt_number($1, $2)`, [uuid.parse(input.playerId), n.data], n.data ? `Número ${n.data} atribuído.` : "Número removido.");
}
export async function autoNumberSquadAction(input: { gameId: string }): Promise<ActionState> {
  const gameId = uuid.parse(input.gameId);
  return userCommand(gameId, `select public.auto_number_squad($1) as n`, [gameId], "Números atribuídos.");
}

/* ------------------------------- market ------------------------------- */
export async function createOfferAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  const playerId = uuid.parse(form.get("playerId"));
  const swap = uuid.safeParse(form.get("swapPlayerId"));
  const parent = uuid.safeParse(form.get("parentOfferId"));
  const message = z.string().trim().max(140, "Nota demasiado longa (máx. 140).").safeParse(String(form.get("message") ?? ""));
  if (!message.success) return { error: message.error.issues[0].message };
  const amountEur = z.coerce.number().int("Valor em euros inteiros.").min(swap.success ? 0 : 100_000, "Mínimo €100 000.").max(1_000_000_000)
    .safeParse(String(form.get("amountEur") ?? "").replace(/[^\d]/g, ""));
  if (!amountEur.success) return { error: amountEur.error.issues[0].message };
  // idempotency key generated in the form (hidden input) so double-submits/replays cannot double-reserve
  const key = z.string().min(8).max(100).safeParse(form.get("idempotencyKey"));
  const r = await userCommand(gameId, `select public.make_offer($1, $2, $3, $4, $5, $6) as r`,
    [playerId, amountEur.data * 100, key.success ? key.data : randomUUID(), swap.success ? swap.data : null, message.data || null, parent.success ? parent.data : null], "");
  if (!r.ok) return r;
  await pushNow();
  const res = (r.data?.r ?? {}) as { status: string; counter_amount_cents?: number; reason?: string };
  if (res.status === "accepted") redirect(`/g/${gameId}/players/${playerId}?toast=signed`);
  if (res.status === "pending") return { ok: true, message: "Proposta enviada ao treinador adversário." };
  if (res.reason === "ai_squad_too_small") return { error: "O clube recusou: não pode reduzir mais o plantel." };
  if (res.counter_amount_cents) return { error: `Recusada. O clube pede €${(Number(res.counter_amount_cents) / 100).toLocaleString("pt-PT")}.`, data: { counter: Number(res.counter_amount_cents) / 100 } };
  return { error: `Proposta ${res.status}.` };
}

/** Buy a player from a club outside the game's league (AI answers immediately: accept at/above asking price). */
export async function signExternalAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const gameId = uuid.parse(form.get("gameId"));
  const sourcePlayerId = uuid.parse(form.get("sourcePlayerId"));
  const swap = uuid.safeParse(form.get("swapPlayerId"));
  const parent = uuid.safeParse(form.get("parentOfferId"));
  const message = z.string().trim().max(140, "Nota demasiado longa (máx. 140).").safeParse(String(form.get("message") ?? ""));
  if (!message.success) return { error: message.error.issues[0].message };
  const amountEur = z.coerce.number().int("Valor em euros inteiros.").min(swap.success ? 0 : 100_000, "Mínimo €100 000.").max(1_000_000_000)
    .safeParse(String(form.get("amountEur") ?? "").replace(/[^\d]/g, ""));
  if (!amountEur.success) return { error: amountEur.error.issues[0].message };
  let res;
  try {
    res = await signExternalPlayer(getPool(), user.id, gameId, sourcePlayerId, amountEur.data * 100);
  } catch (e) {
    return fail(e);
  }
  if (res.status === "accepted") {
    revalidatePath(`/g/${gameId}`, "layout");
    redirect(`/g/${gameId}/players/${res.player_id}?toast=signed`);
  }
  return { error: `Recusada. O clube pede €${(Number(res.counter_amount_cents) / 100).toLocaleString("pt-PT")}.`, data: { counter: Number(res.counter_amount_cents) / 100 } };
}

export async function respondOfferAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  const accept = form.get("accept") === "true";
  const r = await userCommand(gameId, `select public.respond_offer($1, $2) as r`, [uuid.parse(form.get("offerId")), accept],
    accept ? "Transferência concluída." : "Proposta recusada.");
  await pushNow();
  return r;
}

export async function cancelOfferAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  return userCommand(gameId, `select public.cancel_offer($1) as r`, [uuid.parse(form.get("offerId"))], "Proposta cancelada; verba libertada.");
}

export async function listPlayerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  const eur = z.coerce.number().int().min(100_000).max(1_000_000_000).safeParse(String(form.get("askingEur") ?? "").replace(/[^\d]/g, ""));
  if (!eur.success) return { error: "Preço inválido (mínimo €100 000)." };
  return userCommand(gameId, `select public.list_player($1, $2)`, [uuid.parse(form.get("playerId")), eur.data * 100], "Jogador colocado à venda.");
}

export async function unlistPlayerAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  return userCommand(gameId, `select public.unlist_player($1)`, [uuid.parse(form.get("playerId"))], "Jogador retirado do mercado.");
}

export async function markNotificationsReadAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const gameId = uuid.parse(form.get("gameId"));
  await withUser(user.id, (c) => c.query(`select public.mark_notifications_read(null)`));
  revalidatePath(`/g/${gameId}`, "layout");
}

/* ------------------------------- admin ------------------------------- */
/** Platform admin only: load the FICTIONAL dev dataset (two synthetic leagues + finalized snapshot). */
export async function seedSyntheticAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  void form;
  try {
    const isAdmin = await withUser(user.id, async (c) =>
      (await c.query(`select is_admin from profiles where id = $1`, [user.id])).rows[0]?.is_admin === true);
    if (!isAdmin) return { error: "Só administradores." };
    const pool = getPool();
    const existing = await pool.query(`select id from dataset_snapshots where is_synthetic and status = 'finalized' limit 1`);
    if (existing.rowCount) return { ok: true, message: "O dataset fictício já existe — nada a fazer." };
    const { seedSyntheticLeague, SYNTHETIC_ANCHORS } = await import("../../integrations/catalog/synthetic");
    const { buildSnapshot } = await import("../../integrations/catalog/snapshot");
    await seedSyntheticLeague(pool, { externalId: "liga-atlantica", name: "Liga Atlântica (fictícia)", clubs: 18 });
    await seedSyntheticLeague(pool, { externalId: "taca-norte", name: "Divisão Norte (fictícia)", clubs: 8, strength: [1250, 1450] });
    const r = await buildSnapshot(pool, {
      provider: "synthetic", leagueExternalIds: ["liga-atlantica", "taca-norte"], label: "DEV — Dados fictícios",
      anchors: SYNTHETIC_ANCHORS, asOf: new Date("2026-08-01T00:00:00Z"),
    });
    revalidatePath("/admin/import");
    return { ok: true, message: `Dataset fictício criado: ${r.report.clubs_in_snapshot} clubes, ${r.report.players_in_snapshot} jogadores.` };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------- push ------------------------------- */
/** Best effort: a failed push never fails the user's action. */
async function pushNow() {
  await flushPush(getPool()).catch((e) => console.error(JSON.stringify({ level: "error", msg: "push.failed", error: (e as Error).message })));
}

const PushSub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) });

export async function savePushSubscriptionAction(sub: unknown): Promise<ActionState> {
  const user = await requireUser();
  const parsed = PushSub.safeParse(sub);
  if (!parsed.success) return { error: "Subscrição inválida." };
  await savePushSubscription(getPool(), user.id, parsed.data);
  return { ok: true, message: "Notificações ativadas neste dispositivo." };
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<ActionState> {
  const user = await requireUser();
  await deletePushSubscription(getPool(), user.id, z.string().max(1000).parse(endpoint));
  return { ok: true, message: "Notificações desativadas neste dispositivo." };
}

/* ------------------------------- matchday week (phase 2) ------------------------------- */
const TrainingInput = z.object({
  gameId: uuid, intensity: z.enum(["light", "normal", "intense"]),
  focus: z.enum(["none", "attack", "defense", "possession", "set_pieces", "fitness", "tactics"]),
});
export async function saveTrainingAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const t = TrainingInput.parse({ gameId: form.get("gameId"), intensity: form.get("intensity"), focus: form.get("focus") });
    return userCommand(t.gameId, `select public.save_training_plan($1, $2, $3)`, [t.gameId, t.intensity, t.focus], "Plano de treino guardado.");
  } catch (e) {
    return fail(e);
  }
}

const PlanInput = z.object({
  gameId: uuid,
  rules: z.array(z.object({
    minute: z.number().int().min(46, "Regras só na 2.ª parte (46'–88').").max(88, "Regras só na 2.ª parte (46'–88')."),
    when: z.enum(["losing", "drawing", "winning"]),
    mentality: z.enum(["defensive", "balanced", "attacking"]).optional(),
    sub: z.object({ out: uuid, in: uuid }).optional(),
  }).refine((r) => r.mentality || r.sub, "Cada regra precisa de uma mudança de mentalidade ou de uma substituição.")).max(3, "Máximo de 3 regras."),
  marking: z.array(uuid).max(2, "Máximo de 2 marcações."),
});
export async function saveMatchPlanAction(input: z.input<typeof PlanInput>): Promise<ActionState> {
  try {
    const p = PlanInput.parse(input);
    return userCommand(p.gameId, `select public.save_match_plan($1, $2, $3)`, [p.gameId, JSON.stringify(p.rules), JSON.stringify(p.marking)], "Plano de jogo guardado.");
  } catch (e) {
    return fail(e);
  }
}

const PressInput = z.object({
  gameId: uuid, confId: uuid,
  answers: z.array(z.object({
    key: z.string().min(1).max(40), tone: z.enum(["confident", "calm", "provocative", "evasive"], { message: "Escolhe um tom para cada resposta." }),
    text: z.string().trim().max(280, "Máximo de 280 caracteres por resposta."),
  })).min(1).max(5),
});
export async function answerPressAction(input: z.input<typeof PressInput>): Promise<ActionState> {
  try {
    const p = PressInput.parse(input);
    return userCommand(p.gameId, `select public.answer_press($1, $2) as r`, [p.confId, JSON.stringify(p.answers)], "Conferência terminada. As tuas palavras vão sair n'O Apito.", [`/g/${p.gameId}/week`]);
  } catch (e) {
    return fail(e);
  }
}

export async function answerEventAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    const choice = z.coerce.number().int().min(0).max(9).parse(form.get("choice"));
    return userCommand(gameId, `select public.answer_inbox_event($1, $2) as r`, [uuid.parse(form.get("eventId")), choice], "Decisão tomada.");
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------- club business (phase 3) ------------------------------- */
export async function setTicketPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    const level = z.enum(["low", "normal", "high"]).parse(form.get("level"));
    return userCommand(gameId, `select public.set_ticket_price($1, $2)`, [gameId, level], "Preço dos bilhetes atualizado.");
  } catch (e) {
    return fail(e);
  }
}

export async function startUpgradeAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    const kind = z.enum(["capacity", "vip"]).parse(form.get("kind"));
    return userCommand(gameId, `select public.start_upgrade($1, $2) as r`, [gameId, kind], "Obra iniciada.");
  } catch (e) {
    return fail(e);
  }
}

export async function hireStaffAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    return userCommand(gameId, `select public.hire_staff($1) as r`, [uuid.parse(form.get("candidateId"))], "Contratado.");
  } catch (e) {
    return fail(e);
  }
}

export async function signSponsorAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    return userCommand(gameId, `select public.sign_sponsor($1) as r`, [uuid.parse(form.get("offerId"))], "Contrato de patrocínio assinado.");
  } catch (e) {
    return fail(e);
  }
}

export async function setBudgetShiftAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    const shift = z.coerce.number().int().min(-20, "Só podes mover até 20%.").max(20, "Só podes mover até 20%.").parse(form.get("shift"));
    return userCommand(gameId, `select public.set_budget_shift($1, $2)`, [gameId, shift], "Orçamento ajustado.");
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------- negotiations + wall (phase 4a) ------------------------------- */
export async function counterOfferAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    const amountEur = z.coerce.number().int("Valor em euros inteiros.").min(0).max(1_000_000_000).parse(String(form.get("amountEur") ?? "").replace(/[^\d]/g, ""));
    const message = z.string().trim().max(140, "Nota demasiado longa (máx. 140).").parse(String(form.get("message") ?? ""));
    const r = await userCommand(gameId, `select public.counter_offer($1, $2, $3) as r`, [uuid.parse(form.get("offerId")), amountEur * 100, message || null], "Contraproposta enviada.");
    await pushNow();
    return r;
  } catch (e) {
    return fail(e);
  }
}

export async function acceptCounterAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    const key = z.string().min(8).max(100).safeParse(form.get("idempotencyKey"));
    const r = await userCommand(gameId, `select public.accept_counter($1, $2) as r`, [uuid.parse(form.get("offerId")), key.success ? key.data : randomUUID()], "Negócio fechado!");
    await pushNow();
    return r;
  } catch (e) {
    return fail(e);
  }
}

export async function postWallAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    const body = z.string().trim().min(1, "Escreve alguma coisa.").max(280, "Máximo de 280 caracteres.").parse(String(form.get("body") ?? ""));
    return userCommand(gameId, `select public.post_wall($1, $2)`, [gameId, body], "Publicado.");
  } catch (e) {
    return fail(e);
  }
}

export async function reactWallAction(input: { gameId: string; postId: string; emoji: string }): Promise<ActionState> {
  try {
    const gameId = uuid.parse(input.gameId);
    return userCommand(gameId, `select public.react_wall($1, $2) as r`, [uuid.parse(input.postId), z.enum(["👏", "🔥", "😂", "😬", "🤝"]).parse(input.emoji)], "");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteWallPostAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    return userCommand(gameId, `select public.delete_wall_post($1)`, [uuid.parse(form.get("postId"))], "Apagado.");
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------- cups & careers (phase 4b) ------------------------------- */
export async function promoteProspectAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    return userCommand(gameId, `select public.promote_prospect($1)`, [uuid.parse(form.get("prospectId"))], "Promovido à equipa principal.");
  } catch (e) {
    return fail(e);
  }
}

export async function releaseProspectAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    return userCommand(gameId, `select public.release_prospect($1)`, [uuid.parse(form.get("prospectId"))], "Dispensado.");
  } catch (e) {
    return fail(e);
  }
}

export async function renewContractAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    const seasons = z.coerce.number().int().min(1).max(3).parse(form.get("seasons"));
    return userCommand(gameId, `select public.renew_contract($1, $2)`, [uuid.parse(form.get("talkId")), seasons], "Contrato renovado.");
  } catch (e) {
    return fail(e);
  }
}

export async function signFreeAgentAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const gameId = uuid.parse(form.get("gameId"));
    return userCommand(gameId, `select public.sign_free_agent($1)`, [uuid.parse(form.get("playerId"))], "Jogador livre contratado.");
  } catch (e) {
    return fail(e);
  }
}
