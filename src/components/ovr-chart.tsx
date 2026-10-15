/** Dependency-free SVG step chart of OVR over time, with a lime area fill. */
export function OvrChart({ points }: { points: { label: string; ovr: number }[] }) {
  const pts = points.length === 1 ? [...points, { ...points[0], label: "Agora" }] : points;
  const w = 600, h = 150, padX = 28, padY = 18;
  const min = Math.min(...pts.map((p) => p.ovr)) - 2;
  const max = Math.max(...pts.map((p) => p.ovr)) + 2;
  const x = (i: number) => padX + (i * (w - 2 * padX)) / Math.max(1, pts.length - 1);
  const y = (v: number) => h - padY - ((v - min) * (h - 2 * padY)) / Math.max(1, max - min);
  let d = `M ${x(0)} ${y(pts[0].ovr)}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${x(i)} V ${y(pts[i].ovr)}`;
  const area = `${d} V ${h - padY} H ${x(0)} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" role="img" aria-label={`Evolução do OVR de ${pts[0].ovr} para ${last.ovr}`}>
      <defs>
        <linearGradient id="ovr-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d4ff3a" stopOpacity=".25" /><stop offset="1" stopColor="#d4ff3a" stopOpacity="0" /></linearGradient>
      </defs>
      {[min + 2, Math.round((min + max) / 2), max - 2].map((v) => (
        <g key={v}><line x1={padX} x2={w - padX} y1={y(v)} y2={y(v)} stroke="#232931" strokeDasharray="3 5" /><text x={2} y={y(v) + 4} fontSize="11" fontWeight="700" fill="#5d6772">{v}</text></g>
      ))}
      <path d={area} fill="url(#ovr-fill)" />
      <path d={d} fill="none" stroke="#d4ff3a" strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.ovr)} r={i === pts.length - 1 ? 5 : 3.5} fill="#07090b" stroke="#d4ff3a" strokeWidth="2"><title>{`${p.label}: ${p.ovr}`}</title></circle>)}
    </svg>
  );
}
