"use client";
import { useMemo, useState } from "react";
import type { PositionGroup } from "@/engine/common/types";
import { SLOT_LABEL } from "@/engine/lineup/formations";
import { Badge, Card, FormArrow, Meter, OvrBadge, POS_LABEL, POS_TONE, cn, eur, inputCls } from "../ui";
import { PlayerAvatar, RatingSpark } from "./avatar";
import { locate } from "./editor";
import type { ClubLook, EditorState, SquadP } from "./types";

type Col = { key: string; label: string; sort?: (p: SquadP) => number | string; cell: (p: SquadP) => React.ReactNode; className?: string; default?: boolean };

export function ListView({ squad, st, look, onOpen, selected }: {
  squad: SquadP[]; st: EditorState; look: ClubLook; onOpen: (id: string) => void; selected: string | null;
}) {
  const [group, setGroup] = useState<PositionGroup | "">("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "pos", dir: 1 });
  const [cmp, setCmp] = useState<string[]>([]);
  const status = (p: SquadP) => {
    const w = locate(st, p.id);
    return w.kind === "slot" ? "Titular" : w.kind === "bench" ? "Banco" : "—";
  };
  const cols: Col[] = useMemo(() => [
    { key: "num", label: "Nº", sort: (p) => p.shirt ?? 999, cell: (p) => <span className="tabular text-muted">{p.shirt ?? "—"}</span>, default: true },
    { key: "pos", label: "Pos.", sort: (p) => ["GK", "DEF", "MID", "ATT"].indexOf(p.group) * 100 - p.ovr, cell: (p) => <span className={cn("font-bold", POS_TONE[p.group])}>{p.preferred_slot ? SLOT_LABEL[p.preferred_slot] : POS_LABEL[p.group]}</span>, default: true },
    { key: "ovr", label: "OVR", sort: (p) => p.ovr, cell: (p) => <span className="flex items-center gap-1"><OvrBadge ovr={p.ovr} size="sm" />{p.ovr_delta !== 0 && <span className={cn("text-[11px] font-bold", p.ovr_delta > 0 ? "text-accent" : "text-danger")}>{p.ovr_delta > 0 ? `+${p.ovr_delta}` : p.ovr_delta}</span>}</span>, default: true },
    { key: "pot", label: "Pot.", sort: (p) => p.potential_band, cell: (p) => <span className="font-bold text-muted">{p.potential_band}</span>, default: true },
    { key: "age", label: "Idade", sort: (p) => p.age ?? 99, cell: (p) => <span className="tabular text-muted">{p.age ?? "—"}</span> },
    { key: "form", label: "Forma", sort: (p) => p.form, cell: (p) => <FormArrow form={p.form} />, default: true },
    { key: "fit", label: "Condição", sort: (p) => p.fitness, cell: (p) => <Meter value={p.fitness} label="Condição" />, default: true },
    { key: "mor", label: "Moral", sort: (p) => p.morale, cell: (p) => <Meter value={p.morale} label="Moral" tone="bg-info" /> },
    { key: "apps", label: "J", sort: (p) => p.stats.apps, cell: (p) => <span className="tabular">{p.stats.apps}</span>, default: true },
    { key: "goals", label: "G", sort: (p) => p.stats.goals, cell: (p) => <span className="tabular">{p.stats.goals}</span>, default: true },
    { key: "ast", label: "A", sort: (p) => p.stats.assists, cell: (p) => <span className="tabular">{p.stats.assists}</span>, default: true },
    { key: "avg", label: "Nota", sort: (p) => p.stats.avg ?? 0, cell: (p) => <span className="tabular">{p.stats.avg?.toFixed(1) ?? "—"}</span>, default: true },
    { key: "last", label: "Últ. 5", cell: (p) => <RatingSpark ratings={[...p.recent].reverse()} />, default: true },
    { key: "min", label: "Min.", sort: (p) => p.stats.minutes, cell: (p) => <span className="tabular text-muted">{p.stats.minutes}</span> },
    { key: "val", label: "Valor", sort: (p) => p.value_cents, cell: (p) => <span className="tabular">{eur(p.value_cents)}</span>, className: "text-right", default: true },
    { key: "wage", label: "Salário", sort: (p) => p.wage_cents, cell: (p) => <span className="tabular text-muted">{eur(p.wage_cents)}</span>, className: "text-right" },
    { key: "ctr", label: "Contrato", sort: (p) => p.contract_end, cell: (p) => <span className="tabular text-muted">ép. {p.contract_end}</span> },
    { key: "st", label: "Estado", sort: (p) => status(p), cell: (p) => <span className="text-xs text-muted">{status(p)}</span>, default: true },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [st]);
  const [visible, setVisible] = useState<string[]>(cols.filter((c) => c.default).map((c) => c.key));
  const [showCols, setShowCols] = useState(false);

  const rows = squad
    .filter((p) => (!group || p.group === group) && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => {
      const c = cols.find((x) => x.key === sort.key)?.sort;
      if (!c) return 0;
      const va = c(a), vb = c(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir * (sort.key === "pos" || sort.key === "num" || sort.key === "age" ? 1 : -1) || a.name.localeCompare(b.name);
    });
  const shown = cols.filter((c) => visible.includes(c.key));
  const compare = cmp.map((id) => squad.find((p) => p.id === id)).filter(Boolean) as SquadP[];

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0 sm:p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 text-sm">
          {([["", "Todos"], ["GK", "GR"], ["DEF", "Defesas"], ["MID", "Médios"], ["ATT", "Avançados"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setGroup(k)} className={cn("rounded-lg px-3 py-1.5 text-xs font-bold transition", group === k ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-ink")}>{l}</button>
          ))}
          <input className={cn(inputCls, "ml-auto min-h-9 w-44")} placeholder="Procurar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Procurar jogador" />
          <div className="relative">
            <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink" onClick={() => setShowCols((s) => !s)} aria-expanded={showCols}>Colunas ▾</button>
            {showCols && (
              <div className="absolute right-0 z-30 mt-1 grid w-56 grid-cols-2 gap-1 rounded-lg border border-line bg-surface p-2 shadow-xl">
                {cols.map((c) => (
                  <label key={c.key} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={visible.includes(c.key)} onChange={() => setVisible((v) => (v.includes(c.key) ? v.filter((x) => x !== c.key) : [...v, c.key]))} />{c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-line text-left text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
              <tr>
                <th className="w-8 p-2"><span className="sr-only">Comparar</span></th>
                <th className="p-2">Jogador</th>
                {shown.map((c) => (
                  <th key={c.key} className={cn("p-2", c.className)} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                    {c.sort ? <button type="button" className="font-semibold uppercase hover:text-ink" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}>{c.label}{sort.key === c.key ? (sort.dir === 1 ? " ↓" : " ↑") : ""}</button> : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((p) => (
                <tr key={p.id} className={cn("hover:bg-surface-2/50", selected === p.id && "bg-accent/[.07]")}>
                  <td className="p-2"><input type="checkbox" aria-label={`Comparar ${p.name}`} checked={cmp.includes(p.id)} onChange={() => setCmp((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id].slice(-2)))} /></td>
                  <td className="p-2">
                    <button type="button" className="flex items-center gap-2 text-left" onClick={() => onOpen(p.id)}>
                      <PlayerAvatar id={p.id} primary={look.primary} secondary={look.secondary} size={28} />
                      <span className="font-semibold hover:text-accent">{p.name}</span>
                      {p.injured > 0 && <Badge tone="danger">Lesão {p.injured}j</Badge>}
                      {p.suspended > 0 && <Badge tone="warn">Castigo {p.suspended}j</Badge>}
                      {p.listed && <Badge tone="info">À venda</Badge>}
                    </button>
                  </td>
                  {shown.map((c) => <td key={c.key} className={cn("p-2", c.className)}>{c.cell(p)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line p-2 text-xs text-faint">{rows.length} jogadores · marca 2 para comparar</p>
      </Card>
      {compare.length === 2 && <Compare a={compare[0]} b={compare[1]} look={look} onClose={() => setCmp([])} />}
    </div>
  );
}

function Compare({ a, b, look, onClose }: { a: SquadP; b: SquadP; look: ClubLook; onClose: () => void }) {
  const rows: [string, number, number, (v: number) => string, boolean?][] = [
    ["OVR", a.ovr, b.ovr, String],
    ["Evolução na época", a.ovr_delta, b.ovr_delta, (v) => (v > 0 ? `+${v}` : String(v))],
    ["Forma", a.form, b.form, (v) => v.toFixed(1)],
    ["Condição", a.fitness, b.fitness, String],
    ["Moral", a.morale, b.morale, String],
    ["Jogos", a.stats.apps, b.stats.apps, String],
    ["Golos", a.stats.goals, b.stats.goals, String],
    ["Assistências", a.stats.assists, b.stats.assists, String],
    ["Golos /90", a.stats.minutes ? (a.stats.goals * 90) / a.stats.minutes : 0, b.stats.minutes ? (b.stats.goals * 90) / b.stats.minutes : 0, (v) => v.toFixed(2)],
    ["Nota média", a.stats.avg ?? 0, b.stats.avg ?? 0, (v) => (v ? v.toFixed(2) : "—")],
    ["Valor", a.value_cents, b.value_cents, (v) => eur(v)],
    ["Salário", a.wage_cents, b.wage_cents, (v) => eur(v), true],
  ];
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="eyebrow">Comparação</h3>
        <button type="button" className="text-sm text-muted hover:text-ink" onClick={onClose}>Fechar</button>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 gap-y-1.5 text-sm">
        <div className="flex items-center justify-end gap-2 font-semibold"><span className="truncate">{a.name}</span><PlayerAvatar id={a.id} primary={look.primary} secondary={look.secondary} size={36} /></div>
        <span className="text-xs text-faint">vs</span>
        <div className="flex items-center gap-2 font-semibold"><PlayerAvatar id={b.id} primary={look.primary} secondary={look.secondary} size={36} /><span className="truncate">{b.name}</span></div>
        {rows.map(([l, va, vb, f, lowerBetter]) => {
          const better = va === vb ? 0 : (va > vb) !== !!lowerBetter ? -1 : 1;
          return [
            <span key={`${l}a`} className={cn("text-right tabular", better === -1 && "font-bold text-accent")}>{f(va)}</span>,
            <span key={`${l}l`} className="text-center text-[11px] uppercase tracking-wide text-faint">{l}</span>,
            <span key={`${l}b`} className={cn("tabular", better === 1 && "font-bold text-accent")}>{f(vb)}</span>,
          ];
        })}
      </div>
    </Card>
  );
}
