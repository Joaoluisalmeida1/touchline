import { slotCoordinates } from "@/engine/lineup/formations";
import type { AwardsJson } from "@/server/league-queries";
import { Shirt } from "./squad/avatar";
import { cn } from "./ui";

type Look = Map<string, { primary_color: string; secondary_color: string; short_name: string }>;

/** Team of the round on a 4-3-3 pitch (GK, 4 DEF, 3 MID, 3 ATT in the award's order). */
export function TeamOfRound({ team, look }: { team: AwardsJson["team"]; look: Look }) {
  const coords = slotCoordinates("4-3-3");
  const byGroup = { GK: team.filter((p) => p.group === "GK"), DEF: team.filter((p) => p.group === "DEF"), MID: team.filter((p) => p.group === "MID"), ATT: team.filter((p) => p.group === "ATT") };
  // 4-3-3 slot order: GK, LB, CB, CB, RB, CM, DM, CM, LW, ST, RW
  const order = [byGroup.GK[0], byGroup.DEF[0], byGroup.DEF[1], byGroup.DEF[2], byGroup.DEF[3], byGroup.MID[1], byGroup.MID[0], byGroup.MID[2], byGroup.ATT[1], byGroup.ATT[0], byGroup.ATT[2]];
  return (
    <div className="relative mx-auto aspect-[68/80] w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[repeating-linear-gradient(0deg,#123a26_0,#123a26_10%,#0f3220_10%,#0f3220_20%)]">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 68 80" preserveAspectRatio="none" aria-hidden>
        <g fill="none" stroke="rgba(255,255,255,.3)" strokeWidth=".35">
          <rect x="2" y="2" width="64" height="76" /><line x1="2" y1="40" x2="66" y2="40" /><circle cx="34" cy="40" r="6" />
          <rect x="17" y="66" width="34" height="12" /><rect x="17" y="2" width="34" height="12" />
        </g>
      </svg>
      {coords.map((c, i) => {
        const p = order[i];
        if (!p) return null;
        const l = look.get(p.club_id);
        return (
          <div key={`${p.id}-${i}`} className="absolute flex w-20 -translate-x-1/2 translate-y-1/2 flex-col items-center" style={{ left: `${c.x}%`, bottom: `${c.y * 0.86 + 4}%` }}>
            <Shirt primary={l?.primary_color ?? "#64748b"} secondary={l?.secondary_color ?? "#fff"} number={null} size={30} />
            <span className="mt-0.5 max-w-full truncate rounded bg-black/75 px-1 font-display text-[11px] font-bold uppercase leading-4 text-white">{p.name.split(" ").at(-1)}</span>
            <span className={cn("rounded px-1 font-display text-[11px] font-extrabold leading-4 tabular", p.rating >= 8 ? "bg-accent text-accent-ink" : "bg-white text-slate-900")}>{p.rating.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}
