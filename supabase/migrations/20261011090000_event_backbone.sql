-- Event backbone (issue #21, master plan §4.3 and §12.5).
--
-- Business changes call app.emit_event() inside their own transaction, so an
-- event exists if and only if the change committed (transactional outbox).
-- Each event gets one delivery row per subscriber; background workers (running
-- as service_role) claim deliveries, handle them and report success or failure.
-- Failures retry with exponential backoff and become 'dead' after max attempts,
-- so an outage of an external service never loses work.

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.event_types (
  code         text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  description  text not null
);

create table public.event_subscribers (
  subscriber   text not null check (subscriber ~ '^[a-z_]+$'),
  event_type   text not null references public.event_types(code),
  max_attempts integer not null default 10 check (max_attempts between 1 and 50),
  primary key (subscriber, event_type)
);

insert into public.event_types (code, description) values
  ('lead.created',          'A website form or store quote request created a lead'),
  ('sale.submitted',        'A POS sale, store order or invoice was submitted'),
  ('payment.received',      'A payment was received or matched'),
  ('stock.low',             'A product fell to or below its reorder level'),
  ('document.submitted',    'A document was submitted and locked'),
  ('document.cancelled',    'A submitted document was cancelled'),
  ('approval.requested',    'An approval was requested'),
  ('approval.decided',      'An approval was approved or rejected'),
  ('activity.due',          'A scheduled activity reached its due date'),
  ('rate.changed',          'A company changed an exchange rate'),
  ('subscription.overdue',  'A company''s ZimERP subscription is overdue');

insert into public.event_subscribers (subscriber, event_type) values
  -- Ledger postings happen synchronously inside the business transaction
  -- (app.post_entry), so the ledger is not an event subscriber.
  ('webhooks',      'sale.submitted'),
  ('webhooks',      'payment.received'),
  ('webhooks',      'document.submitted'),
  ('webhooks',      'document.cancelled'),
  ('notifications', 'lead.created'),
  ('notifications', 'payment.received'),
  ('notifications', 'stock.low'),
  ('notifications', 'approval.requested'),
  ('notifications', 'approval.decided'),
  ('notifications', 'activity.due'),
  ('notifications', 'subscription.overdue'),
  ('whatsapp',      'sale.submitted'),
  ('whatsapp',      'payment.received'),
  ('crm',           'lead.created');

-- ---------------------------------------------------------------------------
-- Outbox and deliveries
-- ---------------------------------------------------------------------------

create table public.events (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies(id),
  event_type      text not null references public.event_types(code),
  aggregate_type  text not null,
  aggregate_id    text not null,
  payload         jsonb not null default '{}'::jsonb,
  actor_id        uuid,
  created_at      timestamptz not null default now()
);

create table public.event_deliveries (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references public.companies(id),
  event_id         bigint not null references public.events(id),
  subscriber       text not null,
  status           text not null default 'pending'
                   check (status in ('pending','processing','delivered','dead')),
  attempts         integer not null default 0,
  max_attempts     integer not null,
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz,
  last_error       text,
  delivered_at     timestamptz,
  unique (event_id, subscriber)
);

create index on public.events (company_id, created_at desc);
create index on public.events (aggregate_type, aggregate_id);
create index event_deliveries_due on public.event_deliveries (subscriber, next_attempt_at)
  where status in ('pending','processing');

create trigger events_append_only before update or delete on public.events
  for each row execute function app.forbid_change();

-- ---------------------------------------------------------------------------
-- Emitting
-- ---------------------------------------------------------------------------

-- Records an event and queues one delivery per subscriber, in the caller's
-- transaction. Called by business functions and triggers, not by clients.
create function app.emit_event(
  p_company        uuid,
  p_event_type     text,
  p_aggregate_type text,
  p_aggregate_id   text,
  p_payload        jsonb default '{}'::jsonb
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_event bigint;
begin
  insert into public.events (company_id, event_type, aggregate_type, aggregate_id, payload, actor_id)
  values (p_company, p_event_type, p_aggregate_type, p_aggregate_id, coalesce(p_payload, '{}'::jsonb), auth.uid())
  returning id into v_event;

  insert into public.event_deliveries (company_id, event_id, subscriber, max_attempts)
  select p_company, v_event, s.subscriber, s.max_attempts
  from public.event_subscribers s
  where s.event_type = p_event_type;

  return v_event;
end;
$$;

revoke execute on function app.emit_event(uuid, text, text, text, jsonb) from public;
grant execute on function app.emit_event(uuid, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Worker API (service_role only)
-- ---------------------------------------------------------------------------

-- Claims up to p_limit due deliveries for a subscriber. Concurrent workers
-- never receive the same delivery (SKIP LOCKED); a claim expires after
-- p_lock_seconds so a crashed worker's deliveries are retried.
create function app.claim_deliveries(p_subscriber text, p_limit integer default 50, p_lock_seconds integer default 300)
returns table (delivery_id bigint, event_id bigint, company_id uuid, event_type text,
               aggregate_type text, aggregate_id text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with due as (
    select d.id
    from public.event_deliveries d
    where d.subscriber = p_subscriber
      and d.next_attempt_at <= now()
      and (d.status = 'pending' or (d.status = 'processing' and d.locked_until < now()))
    order by d.next_attempt_at, d.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.event_deliveries d
    set status = 'processing',
        attempts = d.attempts + 1,
        locked_until = now() + make_interval(secs => p_lock_seconds)
    from due
    where d.id = due.id
    returning d.id, d.event_id, d.attempts
  )
  select c.id, e.id, e.company_id, e.event_type, e.aggregate_type, e.aggregate_id, e.payload, c.attempts
  from claimed c join public.events e on e.id = c.event_id
  order by c.id;
end;
$$;

create function app.complete_delivery(p_delivery bigint)
returns void
language sql security definer set search_path = ''
as $$
  update public.event_deliveries
  set status = 'delivered', delivered_at = now(), locked_until = null, last_error = null
  where id = p_delivery and status = 'processing';
$$;

-- Schedules a retry with exponential backoff (1, 2, 4 ... minutes, capped at
-- one day), or marks the delivery dead once max_attempts is reached.
create function app.fail_delivery(p_delivery bigint, p_error text)
returns void
language sql security definer set search_path = ''
as $$
  update public.event_deliveries
  set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
      next_attempt_at = now() + least(interval '1 minute' * power(2, attempts - 1), interval '1 day'),
      locked_until = null,
      last_error = left(p_error, 2000)
  where id = p_delivery and status = 'processing';
$$;

-- Puts a dead delivery back in the queue after the cause has been fixed.
create function app.retry_dead_delivery(p_delivery bigint)
returns void
language sql security definer set search_path = ''
as $$
  update public.event_deliveries
  set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
  where id = p_delivery and status = 'dead';
$$;

revoke execute on function app.claim_deliveries(text, integer, integer),
                           app.complete_delivery(bigint),
                           app.fail_delivery(bigint, text),
                           app.retry_dead_delivery(bigint) from public;
grant execute on function app.claim_deliveries(text, integer, integer),
                          app.complete_delivery(bigint),
                          app.fail_delivery(bigint, text),
                          app.retry_dead_delivery(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security: owners and auditors can see their company's events
-- ---------------------------------------------------------------------------

alter table public.event_types       enable row level security;
alter table public.event_subscribers enable row level security;
alter table public.events            enable row level security;
alter table public.event_deliveries  enable row level security;

create policy catalogue_read on public.event_types       for select to authenticated using (true);
create policy catalogue_read on public.event_subscribers for select to authenticated using (true);
create policy auditor_read   on public.events            for select to authenticated using (app.can(company_id, 'admin.audit.view'));
create policy auditor_read   on public.event_deliveries  for select to authenticated using (app.can(company_id, 'admin.audit.view'));

revoke all on public.event_types, public.event_subscribers, public.events, public.event_deliveries
  from anon, authenticated;
grant select on public.event_types, public.event_subscribers, public.events, public.event_deliveries
  to authenticated;
