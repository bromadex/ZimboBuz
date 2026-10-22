-- Limits on public forms (website enquiries, store checkout, sign-in and
-- sign-up), so robots cannot flood a company's ERP or spend its Paynow and
-- messaging allowances. Counters are kept in the database so the limit holds
-- across every server; they are short-lived working data, not records.

create table app.rate_limits (
  key           text not null check (length(key) <= 300),
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);
revoke all on app.rate_limits from public, anon, authenticated;

-- Counts one attempt for p_key in the current window and returns true while
-- the attempts are within p_limit. Called by the server only.
create function app.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits  integer;
begin
  insert into app.rate_limits (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = app.rate_limits.hits + 1
  returning hits into v_hits;
  -- tidy old windows now and then
  if random() < 0.01 then
    delete from app.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;
revoke execute on function app.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function app.hit_rate_limit(text, integer, integer) to service_role;
