/** Prints SQL for formation_slots(), slot_roles() and preferrable_slots() generated from the TS engine (single source of truth). */
import { FORMATIONS } from "../../src/engine/common/types";
import { FORMATION_SLOTS, PREFERRABLE_SLOTS } from "../../src/engine/lineup/formations";
import { ROLES } from "../../src/engine/lineup/roles";
import { SLOTS } from "../../src/engine/common/types";

const arr = (xs: readonly string[]) => `array[${xs.map((x) => `'${x}'`).join(",")}]`;
const out: string[] = [];
out.push(`create or replace function public.formation_slots(p_formation text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_formation
${FORMATIONS.map((f) => `    when '${f}' then ${arr(FORMATION_SLOTS[f])}`).join("\n")}
    else null end;
$$;`);
out.push(`create or replace function public.slot_roles(p_slot text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_slot
${SLOTS.map((s) => `    when '${s}' then ${arr(ROLES.filter((r) => r.slots.includes(s)).map((r) => r.id))}`).join("\n")}
    else null end;
$$;`);
out.push(`create or replace function public.preferrable_slots(p_group text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case p_group
${(Object.keys(PREFERRABLE_SLOTS) as (keyof typeof PREFERRABLE_SLOTS)[]).map((g) => `    when '${g}' then ${arr(PREFERRABLE_SLOTS[g])}`).join("\n")}
    else null end;
$$;`);
console.log(out.join("\n\n"));
