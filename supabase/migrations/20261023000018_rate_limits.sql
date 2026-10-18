-- Touchline — 0018: fixed-window rate limiter for abuse-prone server actions (sign-in, sign-up, joining a league).
-- Additive only: a new table and a new function. Server-only — no client grants (security invariant tests).
-- Keys are SHA-256 hashes built by the server (src/server/rate-limit.ts): no raw IPs or emails are stored.

create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Counts a hit for p_key and returns whether it is still within p_limit hits per p_window_seconds.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hits integer;
  v_expired timestamptz := now() - make_interval(secs => p_window_seconds);
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < v_expired then 1 else r.hits + 1 end,
        window_start = case when r.window_start < v_expired then now() else r.window_start end
  returning hits into v_hits;
  -- opportunistic cleanup of stale keys (~1% of calls) keeps the table tiny without a scheduled job
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end $$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
