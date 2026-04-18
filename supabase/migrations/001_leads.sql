create table leads (
  id               uuid        primary key default gen_random_uuid(),
  created_at       timestamptz not null    default now(),
  name             text        not null,
  email            text        not null,
  service          text,
  message          text        not null,
  status           text        not null    default 'new'
                               check (status in ('new', 'responded', 'archived')),
  draft_reply      text,
  draft_status     text        not null    default 'pending_approval'
                               check (draft_status in (
                                 'pending_approval',
                                 'approved',
                                 'sent',
                                 'rejected',
                                 'failed'
                               )),
  responded_at     timestamptz,
  approval_token   text
);

-- RLS on, no public/anon access
alter table leads enable row level security;

-- API routes use the service_role key — full access
create policy "service_role full access"
  on leads
  for all
  to service_role
  using (true)
  with check (true);
