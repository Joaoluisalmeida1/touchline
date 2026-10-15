/** Tiny dependency-free SVG step chart of OVR over time. */
export function OvrChart({ points }: { points: { label: string; ovr: number }[] }) {
  const pts = points.length === 1 ? [...points, { ...points[0], label: "Agora" }] : points;
  const w = 600, h = 140, pad = 24;
  const min = Math.min(...pts.map((p) => p.ovr)) - 2;
  const max = Math.max(...pts.map((p) => p.ovr)) + 2;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, pts.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - 2 * pad)) / Math.max(1, max - min);
  let d = `M ${x(0)} ${y(pts[0].ovr)}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${x(i)} V ${y(pts[i].ovr)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={`Evolução do OVR de ${pts[0].ovr} para ${pts[pts.length - 1].ovr}`}>
      {[min + 2, Math.round((min + max) / 2), max - 2].map((v) => (
        <g key={v}><line x1={pad} x2={w - pad} y1={y(v)} y2={y(v)} stroke="#22304d" strokeDasharray="3 4" /><text x={4} y={y(v) + 4} fontSize="10" fill="#5d7091">{v}</text></g>
      ))}
      <path d={d} fill="none" stroke="#34d399" strokeWidth="2.5" />
      {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.ovr)} r="3.5" fill="#0a101c" stroke="#34d399" strokeWidth="2"><title>{`${p.label}: ${p.ovr}`}</title></circle>)}
    </svg>
  );
}
