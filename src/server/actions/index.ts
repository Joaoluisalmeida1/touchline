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
const Slot = z.enum(["GK", "LB", "CB", "RB", "LWB", "RWB", "DM", "CM", "AM", "LM", "RM", "LW", "RW", "ST"]);
const LineupInput = z.object({
  gameId: uuid,
  formation: z.enum(["4-3-3", "4-2-3-1", "4-4-2", "4-1-4-1", "3-5-2", "5-3-2"]),
  starters: z.array(z.object({ player_id: uuid, slot: Slot })).length(11, "Escolhe 11 titulares."),
  bench: z.array(uuid).max(9),
  tactics: z.object({
    mentality: z.enum(["defensive", "balanced", "attacking"]), tempo: z.enum(["slow", "normal", "high"]),
    pressing: z.enum(["low", "medium", "high"]), defensive_line: z.enum(["low", "medium", "high"]),
    width: z.enum(["narrow", "balanced", "wide"]), passing_directness: z.enum(["short", "mixed", "direct"]),
    transitions: z.enum(["possession", "balanced", "counter"]),
  }),
});

export async function saveLineupAction(input: z.infer<typeof LineupInput>): Promise<ActionState> {
  const user = await requireUser();
  const p = LineupInput.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    await withUser(user.id, async (c) => {
      await c.query(`select public.save_tactics($1, $2)`, [p.data.gameId, JSON.stringify({ ...p.data.tactics, formation: p.data.formation })]);
      await c.query(`select public.save_lineup($1, $2, $3, $4)`, [p.data.gameId, p.data.formation, JSON.stringify(p.data.starters), JSON.stringify(p.data.bench)]);
    });
    revalidatePath(`/g/${p.data.gameId}`, "layout");
    return { ok: true, message: "Escalação e tática guardadas." };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------- market ------------------------------- */
export async function createOfferAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  const playerId = uuid.parse(form.get("playerId"));
  const amountEur = z.coerce.number().int("Valor em euros inteiros.").min(100_000, "Mínimo €100 000.").max(1_000_000_000)
    .safeParse(String(form.get("amountEur") ?? "").replace(/[^\d]/g, ""));
  if (!amountEur.success) return { error: amountEur.error.issues[0].message };
  // idempotency key generated in the form (hidden input) so double-submits/replays cannot double-reserve
  const key = z.string().min(8).max(100).safeParse(form.get("idempotencyKey"));
  const r = await userCommand(gameId, `select public.create_offer($1, $2, $3) as r`,
    [playerId, amountEur.data * 100, key.success ? key.data : randomUUID()], "");
  if (!r.ok) return r;
  const res = (r.data?.r ?? {}) as { status: string; counter_amount_cents?: number; reason?: string };
  if (res.status === "accepted") redirect(`/g/${gameId}/players/${playerId}?toast=signed`);
  if (res.status === "pending") return { ok: true, message: "Proposta enviada ao treinador adversário." };
  if (res.reason === "ai_squad_too_small") return { error: "O clube recusou: não pode reduzir mais o plantel." };
  if (res.counter_amount_cents) return { error: `Recusada. O clube pede €${(Number(res.counter_amount_cents) / 100).toLocaleString("pt-PT")}.`, data: { counter: Number(res.counter_amount_cents) / 100 } };
  return { error: `Proposta ${res.status}.` };
}

export async function respondOfferAction(_: ActionState, form: FormData): Promise<ActionState> {
  const gameId = uuid.parse(form.get("gameId"));
  const accept = form.get("accept") === "true";
  return userCommand(gameId, `select public.respond_offer($1, $2) as r`, [uuid.parse(form.get("offerId")), accept],
    accept ? "Transferência concluída." : "Proposta recusada.");
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
