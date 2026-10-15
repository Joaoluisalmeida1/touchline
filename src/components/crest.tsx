import { ClubBadge } from "./squad/avatar";

/** Generated club crest from whatever colour/name fields a query returned. */
export function Crest({ id, name, short, color, color2, size = 32, className }: {
  id: string; name: string; short?: string | null; color?: string | null; color2?: string | null; size?: number; className?: string;
}) {
  const s = short || name.split(/\s+/).filter((w) => w.length > 2).map((w) => w[0]).join("").slice(0, 3) || name.slice(0, 3);
  return <ClubBadge seed={id} name={name} short={s} primary={color ?? "#64748b"} secondary={color2 ?? "#ffffff"} size={size} className={className} />;
}
