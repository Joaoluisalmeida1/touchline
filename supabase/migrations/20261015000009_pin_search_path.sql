-- Touchline — 0009: pin search_path on the remaining helper functions (Supabase linter 0011).
alter function public._setting_int(public.games, text, integer) set search_path = public, pg_temp;
alter function public._game_is_processing(public.games) set search_path = public, pg_temp;
alter function public._fail(text, text) set search_path = public, pg_temp;
alter function public.formation_slots(text) set search_path = public, pg_temp;
