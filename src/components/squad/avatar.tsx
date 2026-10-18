/**
 * Generated, deterministic visuals — no real photos, crests or kits (no licensing issues).
 * Each player gets a stylised avatar derived from a hash of his id; clubs get a generated shield in their colours.
 */
import { useId } from "react";
import { cn } from "../ui";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = <T,>(arr: readonly T[], h: number, salt: number) => arr[(h >>> salt) % arr.length];

const SKIN = ["#f5d0b5", "#e9b48f", "#d29a6c", "#b97a4f", "#8d5a37", "#5e3a23"] as const;
const HAIR = ["#1f1a17", "#3b2a1e", "#6b4a2b", "#a0743f", "#d9b56b", "#8a8a8a"] as const;

/** Relative luminance → pick black/white text. */
export function contrastInk(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#0b1220" : "#ffffff";
}

export function PlayerAvatar({ id, primary, secondary, size = 40, className, title }: {
  id: string; primary: string; secondary: string; size?: number; className?: string; title?: string;
}) {
  const h = hash(id);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const skin = pick(SKIN, h, 0);
  const hair = pick(HAIR, h, 4);
  const style = (h >>> 8) % 6; // 0 bald, 1 short, 2 crop, 3 curly, 4 long, 5 mohawk
  const beard = (h >>> 12) % 4; // 0 none, 1 stubble, 2 beard, 3 moustache
  const brows = (h >>> 16) % 2;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cn("shrink-0 rounded-full bg-surface-2", className)} role="img" aria-label={title ?? "Avatar"}>
      <defs>
        <clipPath id={`c-${uid}`}><circle cx="32" cy="32" r="32" /></clipPath>
      </defs>
      <g clipPath={`url(#c-${uid})`}>
        <rect width="64" height="64" fill="#1b2944" />
        {/* shirt */}
        <path d="M6 64 C8 50 18 45 32 45 C46 45 56 50 58 64 Z" fill={primary} />
        <path d="M24 46 L32 54 L40 46" fill="none" stroke={secondary} strokeWidth="3" strokeLinejoin="round" />
        {/* neck + head */}
        <rect x="27" y="36" width="10" height="10" rx="3" fill={skin} />
        <ellipse cx="32" cy="27" rx="12" ry="14" fill={skin} />
        <ellipse cx="20" cy="28" rx="2" ry="3" fill={skin} />
        <ellipse cx="44" cy="28" rx="2" ry="3" fill={skin} />
        {/* hair */}
        {style === 1 && <path d="M20 23 C20 12 44 12 44 23 C41 18 23 18 20 23 Z" fill={hair} />}
        {style === 2 && <path d="M20 25 C19 11 45 11 44 25 L42 20 C36 16 28 16 22 20 Z" fill={hair} />}
        {style === 3 && <g fill={hair}>{[22, 27, 32, 37, 42].map((x, i) => <circle key={x} cx={x} cy={15 + (i % 2) * 2} r="4.2" />)}</g>}
        {style === 4 && <path d="M18 34 C14 10 50 10 46 34 L44 24 C40 17 24 17 20 24 Z" fill={hair} />}
        {style === 5 && <path d="M29 9 C30 7 34 7 35 9 L35 20 L29 20 Z" fill={hair} />}
        {/* face */}
        <g fill="#1f1a17">
          <circle cx="27.5" cy="28" r="1.4" />
          <circle cx="36.5" cy="28" r="1.4" />
          {brows === 1 && <><rect x="25" y="24" width="5" height="1.2" rx=".6" /><rect x="34" y="24" width="5" height="1.2" rx=".6" /></>}
        </g>
        <path d="M28.5 34.5 C30.5 36 33.5 36 35.5 34.5" fill="none" stroke="#5a3a2a" strokeWidth="1.2" strokeLinecap="round" />
        {beard === 1 && <path d="M21 31 C22 42 42 42 43 31 C40 38 24 38 21 31 Z" fill={hair} opacity=".35" />}
        {beard === 2 && <path d="M21 30 C21 45 43 45 43 30 C41 37 36 33 32 33 C28 33 23 37 21 30 Z" fill={hair} />}
        {beard === 3 && <path d="M27 33 C29 31.5 35 31.5 37 33 C35 32.6 29 32.6 27 33 Z" fill={hair} stroke={hair} strokeWidth="1.2" />}
      </g>
    </svg>
  );
}

/** Crest skins won in the Roleta (original SVG overlays; "chama"/"relampago" are animated). */
function SkinOverlay({ skin, clip }: { skin: string; clip: string }) {
  switch (skin) {
    case "riscas": return <g clipPath={`url(#${clip})`} opacity=".35">{[8, 16, 24, 32, 40, 48, 56].map((x) => <rect key={x} x={x} width="2.5" height="64" fill="#fff" />)}</g>;
    case "aros": return <g clipPath={`url(#${clip})`} opacity=".35">{[14, 26, 38, 50].map((y) => <rect key={y} y={y} width="64" height="5" fill="#fff" />)}</g>;
    case "faixa": return <g clipPath={`url(#${clip})`}><path d="M-6 18 L20 -6 L70 44 L44 70 Z" fill="#000" opacity=".28" /></g>;
    case "xadrez": return <g clipPath={`url(#${clip})`} opacity=".22">{Array.from({ length: 64 }, (_, i) => ((i + Math.floor(i / 8)) % 2 ? <rect key={i} x={(i % 8) * 8} y={Math.floor(i / 8) * 8} width="8" height="8" fill="#fff" /> : null))}</g>;
    case "estrela": return <path d="M32 -1 l3 6.5 7 .8-5.2 4.8 1.4 7-6.2-3.5-6.2 3.5 1.4-7-5.2-4.8 7-.8z" fill="#ffcc33" stroke="#7a5200" strokeWidth="1" transform="translate(0 2) scale(1)" />;
    case "ouro": return <><path d="M32 3 L58 11 C58 34 50 52 32 61 C14 52 6 34 6 11 Z" fill="none" stroke="#ffcc33" strokeWidth="5" /><path d="M14 14 L30 9" stroke="#fff6c8" strokeWidth="3" strokeLinecap="round" opacity=".8" /></>;
    case "carbono": return <g clipPath={`url(#${clip})`} opacity=".35">{Array.from({ length: 16 }, (_, i) => <path key={i} d={`M${i * 4 - 32} 64 L${i * 4 + 32} 0`} stroke="#000" strokeWidth="1.6" />)}</g>;
    case "vitral": return <g clipPath={`url(#${clip})`} opacity=".4"><path d="M0 0 L32 32 L0 64Z" fill="#e11d2e" /><path d="M64 0 L32 32 L64 64Z" fill="#3a5bf0" /><path d="M0 0 L64 0 L32 32Z" fill="#ffcc33" /><path d="M0 64 L64 64 L32 32Z" fill="#2fbf6a" /></g>;
    case "chama": return (
      <g clipPath={`url(#${clip})`}>
        <g style={{ transformOrigin: "32px 60px", animation: "tl-flame .8s ease-in-out infinite" }}>
          <path d="M8 64 C10 50 18 52 16 40 C24 48 22 54 28 46 C30 36 36 40 34 30 C44 40 40 50 46 44 C48 52 56 50 58 64 Z" fill="#ff7a1a" opacity=".85" />
          <path d="M16 64 C18 56 24 56 24 50 C30 56 30 58 34 52 C38 58 44 56 48 64 Z" fill="#ffcc33" opacity=".9" />
        </g>
      </g>
    );
    case "relampago": return <path d="M36 4 L20 34 H31 L26 60 L46 26 H34 Z" fill="#fff6a8" stroke="#ffcc33" strokeWidth="1.5" style={{ animation: "tl-flash 2.4s linear infinite" }} />;
    default: return null;
  }
}

export function ClubBadge({ seed, name, short, primary, secondary, size = 36, className, skin }: {
  seed: string; name: string; short: string; primary: string; secondary: string; size?: number; className?: string; skin?: string | null;
}) {
  const h = hash(seed);
  const pattern = h % 4; // 0 plain, 1 stripes, 2 sash, 3 chevron
  const ink = contrastInk(primary);
  const id = `b-${h.toString(36)}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const shield = "M32 3 L58 11 C58 34 50 52 32 61 C14 52 6 34 6 11 Z";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cn("shrink-0", className)} role="img" aria-label={`Emblema ${name}`}>
      <defs><clipPath id={id}><path d={shield} /></clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <rect width="64" height="64" fill={primary} />
        {pattern === 1 && [14, 30, 46].map((x) => <rect key={x} x={x} y="0" width="8" height="64" fill={secondary} opacity=".9" />)}
        {pattern === 2 && <path d="M-4 52 L52 -4 L68 8 L8 68 Z" fill={secondary} opacity=".9" />}
        {pattern === 3 && <path d="M0 26 L32 44 L64 26 L64 36 L32 54 L0 36 Z" fill={secondary} opacity=".9" />}
      </g>
      {skin && skin !== "estrela" && skin !== "ouro" && skin !== "relampago" && <SkinOverlay skin={skin} clip={id} />}
      <path d={shield} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="2" />
      {skin && (skin === "estrela" || skin === "ouro") && <SkinOverlay skin={skin} clip={id} />}
      <text x="32" y="33" textAnchor="middle" dominantBaseline="middle" fontSize={short.length > 3 ? 13 : 16} fontWeight="900"
        fill={pattern === 0 ? ink : "#fff"} stroke={pattern === 0 ? "none" : "rgba(0,0,0,.45)"} strokeWidth=".8" paintOrder="stroke"
        style={{ letterSpacing: "0.5px", fontFamily: "inherit" }}>{short.slice(0, 4).toUpperCase()}</text>
      {skin === "relampago" && <SkinOverlay skin={skin} clip={id} />}
    </svg>
  );
}

/** Shirt token used on the pitch. */
export function Shirt({ primary, secondary, number, size = 40, dim }: { primary: string; secondary: string; number: number | null; size?: number; dim?: boolean }) {
  const ink = contrastInk(primary);
  return (
    <svg viewBox="0 0 48 44" width={size} height={size * 44 / 48} aria-hidden className={cn("drop-shadow-[0_2px_3px_rgba(0,0,0,.5)]", dim && "opacity-60")}>
      <path d="M15 2 L9 4 L1 12 L7 20 L11 17 L11 42 L37 42 L37 17 L41 20 L47 12 L39 4 L33 2 C31 6 17 6 15 2 Z" fill={primary} stroke="rgba(0,0,0,.35)" strokeWidth="1" />
      <path d="M15 2 C17 6 31 6 33 2" fill="none" stroke={secondary} strokeWidth="2.5" />
      <path d="M1 12 L7 20 M47 12 L41 20" stroke={secondary} strokeWidth="2.5" />
      {number !== null && <text x="24" y="28" textAnchor="middle" dominantBaseline="middle" fontSize="15" fontWeight="900" fill={ink}>{number}</text>}
    </svg>
  );
}

/** Tiny sparkline of recent match ratings (most recent last). */
export function RatingSpark({ ratings, width = 64, height = 18 }: { ratings: (number | null)[]; width?: number; height?: number }) {
  const vals = ratings.filter((r): r is number => typeof r === "number");
  if (vals.length === 0) return <span className="text-xs text-faint">—</span>;
  const xs = vals.map((_, i) => (vals.length === 1 ? width / 2 : (i * (width - 6)) / (vals.length - 1) + 3));
  const ys = vals.map((v) => height - 3 - ((Math.max(4, Math.min(10, v)) - 4) / 6) * (height - 6));
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const color = avg >= 7 ? "var(--color-accent)" : avg >= 6.3 ? "var(--color-info)" : avg >= 5.8 ? "var(--color-warn)" : "var(--color-danger)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Últimas notas: ${vals.map((v) => v.toFixed(1)).join(", ")}`}>
      <line x1="0" x2={width} y1={height - 3 - ((6 - 4) / 6) * (height - 6)} y2={height - 3 - ((6 - 4) / 6) * (height - 6)} stroke="var(--color-line)" strokeDasharray="2 2" />
      <polyline points={xs.map((x, i) => `${x},${ys[i]}`).join(" ")} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="1.8" fill={color} />)}
    </svg>
  );
}
