import Link from "next/link";
import { ArrowLeftRight, Award, Lock, MessagesSquare, Newspaper, Trash2, Trophy, Users } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { SectionTabs } from "@/components/club/section-tabs";
import { Crest } from "@/components/crest";
import { WallReactions } from "@/components/social/reactions";
import { Badge, Card, CardTitle, Empty, cn, eur, inputCls } from "@/components/ui";
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, type Tier } from "@/engine/narrative/achievements";
import { deleteWallPostAction, postWallAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getPool } from "@/server/db";
import { getGame } from "@/server/queries";
import { evaluateAchievements } from "@/server/services/social";
import { getAchievementRows, getManagers, getWall, type ManagerCard, type WallPost } from "@/server/social-queries";

export const metadata = { title: "Balneário" };
type Tab = "mural" | "treinadores" | "conquistas";

const TIER: Record<Tier, string> = { bronze: "text-[#d79b62]", silver: "text-[#c3cad3]", gold: "text-[#ffcc4d]" };

export default async function SocialPage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  // lazy catch-up (idempotent): achievements earned before this feature existed
  if (game.status === "active") await evaluateAchievements(getPool(), gameId).catch((e) => console.error(JSON.stringify({ level: "error", msg: "achievements.eval_failed", error: (e as Error).message })));
  const [wall, managers, rows] = await Promise.all([getWall(user.id, gameId), getManagers(user.id, gameId), getAchievementRows(user.id, gameId)]);
  const initial: Tab = (["mural", "treinadores", "conquistas"] as const).find((t) => t === sp.tab) ?? "mural";
  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow mb-2">{game.name}</p>
        <h2 className="headline text-4xl sm:text-5xl">Balneário</h2>
      </header>
      <SectionTabs<Tab> label="Balneário" initial={initial} tabs={[
        { id: "mural", label: "Mural" }, { id: "treinadores", label: "Treinadores" }, { id: "conquistas", label: "Conquistas" },
      ]} panels={{
        mural: <Wall gameId={gameId} posts={wall} me={user.id} isOwner={!!game.is_owner} />,
        treinadores: <Managers gameId={gameId} managers={managers} me={user.id} />,
        conquistas: <Achievements rows={rows} me={user.id} />,
      }} />
    </div>
  );
}

function Wall({ gameId, posts, me, isOwner }: { gameId: string; posts: WallPost[]; me: string; isOwner: boolean }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3">
        <Card>
          <ActionForm action={postWallAction} hidden={{ gameId }} submitLabel="Publicar" resetOnSuccess className="space-y-3">
            <textarea name="body" required maxLength={280} rows={2} placeholder="Diz qualquer coisa à liga… (máx. 280)" aria-label="Mensagem para o mural"
              className={cn(inputCls, "min-h-16 resize-none py-2.5 leading-relaxed")} />
          </ActionForm>
        </Card>
        {posts.length === 0 ? <Empty title="Mural vazio" icon={<MessagesSquare />}>Sê o primeiro a provocar a malta.</Empty> : posts.map((p) => (
          <Card key={p.id} className="p-4 sm:p-4">
            <PostBody p={p} gameId={gameId} />
            <div className="mt-3 flex items-center justify-between gap-2">
              <WallReactions gameId={gameId} postId={p.id} reactions={p.reactions} />
              <div className="flex items-center gap-2">
                <time className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint" dateTime={p.created_at}>
                  {new Date(p.created_at).toLocaleString("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </time>
                {p.kind === "post" && (p.author_user_id === me || isOwner) && (
                  <ActionForm action={deleteWallPostAction} hidden={{ gameId, postId: p.id }} submitLabel={<Trash2 className="size-3.5" />} variant="ghost" inline
                    submitClassName="min-h-7 px-1.5" confirm="Apagar esta mensagem?" />
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="h-fit">
        <CardTitle>Regras do balneário</CardTitle>
        <ul className="space-y-2 text-sm text-muted">
          <li>Até 280 caracteres, sem imagens. Máximo de 20 mensagens por dia.</li>
          <li>Transferências com treinadores, conquistas e a manchete de cada jornada aparecem aqui sozinhas.</li>
          <li>O dono da liga pode apagar qualquer mensagem; cada um pode apagar as suas.</li>
        </ul>
      </Card>
    </div>
  );
}

function PostBody({ p, gameId }: { p: WallPost; gameId: string }) {
  const pl = p.payload as Record<string, string | number | boolean | null>;
  if (p.kind === "post") return (
    <div>
      <p className="text-xs font-bold text-accent">{p.author ?? "Treinador"}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{p.body}</p>
    </div>
  );
  const icon = p.kind === "transfer" ? <ArrowLeftRight /> : p.kind === "achievement" ? <Award /> : <Newspaper />;
  const text = p.kind === "transfer"
    ? <>{String(pl.to)} contrata <Link href={`/g/${gameId}/players/${pl.player_id}`} className="font-bold hover:text-accent">{String(pl.player)}</Link> ao {String(pl.from)}{pl.swap ? <> em troca de <b>{String(pl.swap)}</b>{Number(pl.amount_cents) > 0 ? ` + ${eur(Number(pl.amount_cents))}` : ""}</> : <> por <b>{eur(Number(pl.amount_cents))}</b></>}{pl.between_humans ? " — negócio entre treinadores" : ""}.</>
    : p.kind === "achievement" ? <><b>{String(pl.manager)}</b> ({String(pl.club)}) desbloqueou <b className={TIER[(pl.tier as Tier) ?? "bronze"]}>{String(pl.title)}</b>.</>
    : <>O Apito, J{String(pl.round)}: <Link href={pl.fixture_id ? `/g/${gameId}/matches/${pl.fixture_id}` : `/g/${gameId}/news`} className="font-display font-bold uppercase hover:text-accent">{String(pl.headline)}</Link></>;
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent ring-1 ring-line [&_svg]:size-4">{icon}</span>
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}

function Managers({ gameId, managers, me }: { gameId: string; managers: ManagerCard[]; me: string }) {
  if (!managers.length) return <Empty title="Sem treinadores" icon={<Users />} />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {managers.map((m) => {
        const pct = m.played ? Math.round((m.w / m.played) * 100) : 0;
        return (
          <Card key={m.user_id} glow={m.user_id === me}>
            <div className="flex items-center gap-3">
              <Crest id={m.club_id} name={m.club} short={m.short_name} color={m.primary_color} color2={m.secondary_color} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xl font-bold uppercase">{m.display_name}{m.user_id === me && <span className="ml-2 text-xs text-faint">(tu)</span>}</p>
                <p className="truncate text-xs text-muted">{m.club}</p>
              </div>
              {m.titles > 0 && <span className="flex items-center gap-1 font-display text-xl font-bold text-[#ffcc4d]"><Trophy className="size-5" />{m.titles}</span>}
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center text-sm">
              {[["Jogos", m.played], ["V-E-D", `${m.w}-${m.d}-${m.l}`], ["Golos", `${m.gf}:${m.ga}`], ["% vit.", `${pct}%`]].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-bg/50 p-2"><p className="text-[10px] uppercase tracking-wide text-faint">{k}</p><p className="font-bold tabular">{v}</p></div>
              ))}
            </div>
            {m.vs_me && (m.vs_me.w + m.vs_me.d + m.vs_me.l > 0) && (
              <p className="mt-3 text-xs text-muted">Contra ti: <b className="text-ink">{m.vs_me.w}V {m.vs_me.d}E {m.vs_me.l}D</b></p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{m.achievements} conquistas</Badge>
              {m.recent.map((k) => {
                const a = ACHIEVEMENT_BY_KEY.get(k);
                return a ? <span key={k} className={cn("inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] font-bold", TIER[a.tier])} title={a.description}><Award className="size-3" />{a.title}</span> : null;
              })}
            </div>
            <Link href={`/g/${gameId}/social?tab=conquistas`} className="sr-only">Ver conquistas</Link>
          </Card>
        );
      })}
    </div>
  );
}

function Achievements({ rows, me }: { rows: { user_id: string; key: string; unlocked_at: string; display_name: string; season: number; round: number }[]; me: string }) {
  const mine = new Map(rows.filter((r) => r.user_id === me).map((r) => [r.key, r]));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Tens <b className="text-ink">{mine.size}</b> de {ACHIEVEMENTS.length} conquistas nesta liga.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ACHIEVEMENTS.map((a) => {
          const got = mine.get(a.key);
          const others = rows.filter((r) => r.key === a.key && r.user_id !== me).map((r) => r.display_name);
          return (
            <div key={a.key} className={cn("rounded-2xl border p-3", got ? "border-accent/40 bg-accent/5" : "border-line bg-bg/40")}>
              <div className="flex items-start gap-2.5">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl ring-1", got ? "bg-surface-2 ring-line-strong" : "bg-surface ring-line")}>
                  {got ? <Award className={cn("size-5", TIER[a.tier])} /> : <Lock className="size-4 text-faint" />}
                </span>
                <div className="min-w-0">
                  <p className={cn("font-bold", !got && "text-muted")}>{a.title}</p>
                  <p className="text-xs text-muted">{a.description}</p>
                  {got && <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">E{got.season} · J{got.round}</p>}
                  {others.length > 0 && <p className="mt-1 text-[11px] text-faint">Também: {others.join(", ")}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
