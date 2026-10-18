/** Reel symbols of the Roleta — original flat SVG icons (no third-party art). */
import type { Symbol } from "@/engine/slots/slots";

export function SlotSymbol({ s, size = 64 }: { s: Symbol; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 64 64", "aria-hidden": true } as const;
  switch (s) {
    case "ball": return (
      <svg {...common}><circle cx="32" cy="32" r="24" fill="#fff" stroke="#111" strokeWidth="3" />
        <path d="M32 20l9 6.5-3.4 10.6H26.4L23 26.5z" fill="#111" /><path d="M32 8v12M41 26.5l11-4M37.6 37l7 9.5M26.4 37l-7 9.5M23 26.5l-11-4" stroke="#111" strokeWidth="2.5" /></svg>
    );
    case "boot": return (
      <svg {...common}><path d="M14 14h16l2 18c6 0 14 3 18 8 2 3 1 8-3 8H14z" fill="#ff7a1a" stroke="#7a2e00" strokeWidth="3" strokeLinejoin="round" />
        <path d="M16 54h4M26 54h4M36 54h4" stroke="#222" strokeWidth="4" strokeLinecap="round" /><path d="M30 24h-6M30 30h-6" stroke="#fff" strokeWidth="2.5" /></svg>
    );
    case "glove": return (
      <svg {...common}><path d="M18 30V16a4 4 0 0 1 8 0v10-14a4 4 0 0 1 8 0v14-12a4 4 0 0 1 8 0v14-8a4 4 0 0 1 8 0v18c0 10-7 18-17 18h-2c-8 0-13-6-13-14z" fill="#16c2d5" stroke="#05535c" strokeWidth="3" strokeLinejoin="round" />
        <rect x="20" y="46" width="24" height="8" rx="2" fill="#05535c" /></svg>
    );
    case "coin": return (
      <svg {...common}><circle cx="32" cy="32" r="24" fill="#ffcc33" stroke="#8a5a00" strokeWidth="3" /><circle cx="32" cy="32" r="17" fill="none" stroke="#c98a00" strokeWidth="2" />
        <text x="32" y="41" textAnchor="middle" fontSize="26" fontWeight="900" fill="#8a5a00" fontFamily="Archivo Variable, sans-serif">€</text></svg>
    );
    case "bag": return (
      <svg {...common}><path d="M24 12h16l-4 8h-8z" fill="#1f9d55" stroke="#0c4d27" strokeWidth="3" strokeLinejoin="round" />
        <path d="M28 20h8c10 6 16 14 16 24 0 8-6 12-20 12S12 52 12 44c0-10 6-18 16-24z" fill="#2fbf6a" stroke="#0c4d27" strokeWidth="3" strokeLinejoin="round" />
        <text x="32" y="47" textAnchor="middle" fontSize="20" fontWeight="900" fill="#fff" fontFamily="Archivo Variable, sans-serif">€</text></svg>
    );
    case "star": return (
      <svg {...common}><path d="M32 6l7.6 16.4 17.8 2-13.2 12.2 3.6 17.6L32 45.4 16.2 54.2l3.6-17.6L6.6 24.4l17.8-2z" fill="#a855f7" stroke="#4c1d95" strokeWidth="3" strokeLinejoin="round" />
        <path d="M32 18l3.5 8 8.5 1-6.3 5.8 1.7 8.4L32 37l-7.4 4.2 1.7-8.4-6.3-5.8 8.5-1z" fill="#e9d5ff" /></svg>
    );
    case "trophy": return (
      <svg {...common}><path d="M20 10h24v14a12 12 0 0 1-24 0z" fill="#ffc21a" stroke="#7a5200" strokeWidth="3" />
        <path d="M20 14h-8c0 8 4 12 9 12M44 14h8c0 8-4 12-9 12" fill="none" stroke="#7a5200" strokeWidth="3" />
        <path d="M28 36h8v8h-8zM20 46h24v8H20z" fill="#ffc21a" stroke="#7a5200" strokeWidth="3" strokeLinejoin="round" /><path d="M26 16v8" stroke="#fff4c2" strokeWidth="3" strokeLinecap="round" /></svg>
    );
    case "cross": return (
      <svg {...common}><rect x="8" y="8" width="48" height="48" rx="10" fill="#fff" stroke="#b91c1c" strokeWidth="3" /><path d="M26 16h12v10h10v12H38v10H26V38H16V26h10z" fill="#e11d2e" /></svg>
    );
    case "redcard": return (
      <svg {...common}><rect x="18" y="8" width="28" height="44" rx="4" fill="#e11d2e" stroke="#7f1d1d" strokeWidth="3" transform="rotate(12 32 30)" /><path d="M24 18l14 3" stroke="#fca5a5" strokeWidth="3" strokeLinecap="round" transform="rotate(12 32 30)" /></svg>
    );
    case "whistle": return (
      <svg {...common}><circle cx="26" cy="36" r="14" fill="#cbd5e1" stroke="#334155" strokeWidth="3" /><path d="M30 24h22v10H36" fill="#cbd5e1" stroke="#334155" strokeWidth="3" strokeLinejoin="round" />
        <circle cx="26" cy="36" r="5" fill="#334155" /><path d="M10 14l6 6M20 8l2 8" stroke="#ffcc33" strokeWidth="3" strokeLinecap="round" /></svg>
    );
  }
}
