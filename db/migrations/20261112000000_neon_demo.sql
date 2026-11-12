-- Neon persistence for the live mainnet demo.
create table if not exists demo_snapshots (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists demo_event_log (
  id bigserial primary key,
  mission_address text not null,
  kind text not null,
  label text not null,
  tx_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists demo_event_log_mission_idx on demo_event_log (mission_address);
