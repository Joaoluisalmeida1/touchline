import { createHash } from "node:crypto";

/** Canonical JSON (sorted keys) so that equal inputs always hash identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function hashInput(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
