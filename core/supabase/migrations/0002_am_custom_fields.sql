-- SCL EDI integration — AM custom fields (Phase: preliminary, per Mike's
-- 2026-08-07 request: "can you work on reading and storing custom fields
-- from Apparel Magic. I feel there's going to be a lot of them.")
-- Paste into Supabase Studio → SQL Editor → Run. Safe to re-run.
--
-- ApparelMagic's custom attribute fields (att1_*, att2_*, ...) are
-- genuinely dynamic: the field NAME itself encodes whatever label someone
-- configured in AM's UI, differs per endpoint (orders/ vs products/ vs
-- purchase_orders/ vs pick_tickets/), and isn't even consistent across
-- endpoints for the same underlying concept (confirmed live 2026-08-10 —
-- see adapters/erp/apparelmagic/lib/extractCustomFields.js). A generic
-- jsonb blob per record, not a fixed-column schema, is the only shape that
-- survives AM-side relabeling/expansion without a migration every time.

create table if not exists am_custom_fields (
  id          uuid primary key default gen_random_uuid(),
  record_type text not null,              -- e.g. 'orders', 'products', 'purchase_orders', 'pick_tickets', 'customers'
  record_id   text not null,              -- AM's own id for that record type (order_id, product_id, ...)
  fields      jsonb not null default '{}'::jsonb, -- raw attN_* key/value pairs, keys exactly as AM names them
  synced_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (record_type, record_id)
);

create index if not exists am_custom_fields_record_type_idx on am_custom_fields (record_type);

drop trigger if exists am_custom_fields_set_updated_at on am_custom_fields;
create trigger am_custom_fields_set_updated_at
  before update on am_custom_fields
  for each row execute function set_updated_at();

alter table am_custom_fields enable row level security;
