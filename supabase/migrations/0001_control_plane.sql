-- SCL EDI integration — Supabase control plane (Phase 1)
-- Paste into Supabase Studio → SQL Editor → Run. Safe to re-run.
--
-- These are internal tables accessed by n8n via the service-role key (which
-- bypasses RLS). RLS is enabled with no policies so nothing is reachable via
-- the anon/authenticated keys by default.

-- Auto-maintain updated_at on tables that have it.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- transactions — one row per document, any direction. The spine of the system.
-- ---------------------------------------------------------------------------
create table if not exists transactions (
  id             uuid primary key default gen_random_uuid(),
  correlation_id text not null,
  doc_type       text not null check (doc_type in
                   ('850','810','856','888','940','943','944','945')),
  direction      text not null check (direction in ('inbound','outbound')),
  partner        text,
  stream         text not null default 'TEST' check (stream in ('TEST','LIVE')),
  external_ids   jsonb not null default '{}'::jsonb,
  status         text not null default 'created' check (status in
                   ('created','transformed','staged','sent','acked',
                    'processed','errored','replayed')),
  payload_ref    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists transactions_correlation_id_idx on transactions (correlation_id);
create index if not exists transactions_status_idx        on transactions (status);
create index if not exists transactions_doc_type_idx      on transactions (doc_type);

drop trigger if exists transactions_set_updated_at on transactions;
create trigger transactions_set_updated_at
  before update on transactions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- idempotency_keys — dedupe before any create/writeback.
-- key = hash(retailer + PO# + order_date + partner) for orders,
--       or the correlation_id for warehouse confirmations.
-- ---------------------------------------------------------------------------
create table if not exists idempotency_keys (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,
  transaction_id uuid references transactions (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- errors — visible failures with enough context to act and replay.
-- ---------------------------------------------------------------------------
create table if not exists errors (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid references transactions (id) on delete set null,
  correlation_id text,
  root_cause     text not null,
  detail         jsonb,
  owner          text,
  next_action    text,
  retry_eligible boolean not null default true,
  resolved       boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists errors_resolved_idx on errors (resolved);

-- ---------------------------------------------------------------------------
-- sku_map — retailer UPC/SKU  <->  AM style/SKU  <->  DCG item id.
-- ---------------------------------------------------------------------------
create table if not exists sku_map (
  id           uuid primary key default gen_random_uuid(),
  partner      text,
  retailer_sku text,
  retailer_upc text,
  am_style     text,
  am_sku       text,
  dcg_item_id  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (partner, retailer_sku)
);

drop trigger if exists sku_map_set_updated_at on sku_map;
create trigger sku_map_set_updated_at
  before update on sku_map
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- partner_map — Orderful trading partner <-> AM customer <-> retailer routing.
-- ---------------------------------------------------------------------------
create table if not exists partner_map (
  id                 uuid primary key default gen_random_uuid(),
  orderful_partner_id text,
  retailer_code      text,
  am_customer_id     text,
  routing            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (orderful_partner_id)
);

drop trigger if exists partner_map_set_updated_at on partner_map;
create trigger partner_map_set_updated_at
  before update on partner_map
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Lock down: enable RLS, add no policies. Service-role key (used by n8n)
-- bypasses RLS; anon/authenticated get nothing.
-- ---------------------------------------------------------------------------
alter table transactions     enable row level security;
alter table idempotency_keys enable row level security;
alter table errors           enable row level security;
alter table sku_map          enable row level security;
alter table partner_map      enable row level security;

-- Phase 2 adds the `files` table (AWS/DCG file lifecycle). Not needed for
-- Slice 1, so it lives in migration 0002.
