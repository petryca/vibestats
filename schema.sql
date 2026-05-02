create table if not exists events (
  id bigserial primary key,
  domain text not null,
  visitor_id text not null,
  path text not null,
  referrer text,
  search_term text,
  country text,
  os text,
  browser text,
  created_at timestamptz not null default now()
);

create index if not exists events_domain_created_at_idx
  on events (domain, created_at desc);

create index if not exists events_domain_visitor_day_idx
  on events (domain, visitor_id, (created_at::date));
