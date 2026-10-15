-- Touchline — 0008: lock down function privileges.
-- PUBLIC gets EXECUTE on new functions by default and that default can only be revoked globally
-- (ALTER DEFAULT PRIVILEGES ... IN SCHEMA cannot remove it), so we revoke both globally and explicitly.
alter default privileges revoke execute on functions from public;
revoke execute on all functions in schema public from public, anon;
-- explicit allow-list for signed-in users (everything else: owner/service_role only)
grant execute on function
  public.is_game_member(uuid), public.my_club_id(uuid), public.manages_club(uuid), public.shares_game_with(uuid),
  public.formation_slots(text),
  public.rotate_invite(uuid, integer), public.revoke_invite(uuid), public.join_game(text), public.select_club(uuid, uuid),
  public.leave_game(uuid), public.update_game_settings(uuid, text, text, text, integer, integer), public.start_game(uuid),
  public.save_tactics(uuid, jsonb), public.save_lineup(uuid, text, jsonb, jsonb), public.list_player(uuid, bigint),
  public.unlist_player(uuid), public.ai_asking_price(uuid), public.create_offer(uuid, bigint, text),
  public.respond_offer(uuid, boolean), public.cancel_offer(uuid), public.mark_notifications_read(uuid[])
to authenticated;
grant execute on all functions in schema public to service_role;
