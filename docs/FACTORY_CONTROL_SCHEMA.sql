-- Factory Control + Agent Attribution
-- Mirrors the production Supabase objects introduced on 2026-09-30.

create table if not exists public.radar_agents(
  id text primary key,
  display_name text not null,
  signature text not null unique,
  provider text not null,
  model text,
  role text not null,
  status text not null default 'active'
    check(status in ('active','paused','retired')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.radar_agent_operations(
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  agent_id text not null references public.radar_agents(id) on update cascade,
  channel_id text,
  episode_id uuid references public.radar_episodes(id) on delete set null,
  batch_key text,
  stage text not null,
  status text not null
    check(status in ('ready','processing','blocked','review','completed','failed')),
  progress int not null default 0 check(progress between 0 and 100),
  summary text not null default '',
  blocker text,
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.radar_episode_agent_attributions(
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.radar_episodes(id) on delete cascade,
  channel_id text not null,
  agent_id text not null references public.radar_agents(id) on update cascade,
  role text not null
    check(role in ('owner','research','script','visual','production','qa','packaging','review')),
  weight numeric(5,4) not null default 1 check(weight>=0 and weight<=1),
  contribution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(episode_id,agent_id,role)
);

create unique index if not exists radar_episode_one_owner_idx
  on public.radar_episode_agent_attributions(episode_id)
  where role='owner';

create index if not exists radar_agent_operations_agent_idx
  on public.radar_agent_operations(agent_id,status,updated_at desc);
create index if not exists radar_agent_operations_episode_idx
  on public.radar_agent_operations(episode_id,updated_at desc);
create index if not exists radar_agent_operations_channel_idx
  on public.radar_agent_operations(channel_id,updated_at desc);
create index if not exists radar_episode_agent_attributions_agent_idx
  on public.radar_episode_agent_attributions(agent_id,updated_at desc);

alter table public.radar_agents enable row level security;
alter table public.radar_agent_operations enable row level security;
alter table public.radar_episode_agent_attributions enable row level security;

revoke all on table public.radar_agents from anon,authenticated;
revoke all on table public.radar_agent_operations from anon,authenticated;
revoke all on table public.radar_episode_agent_attributions from anon,authenticated;
grant all on table public.radar_agents to service_role;
grant all on table public.radar_agent_operations to service_role;
grant all on table public.radar_episode_agent_attributions to service_role;

-- Derived production state is exposed through:
--   public.radar_factory_episode_status_v
--   public.radar_factory_operations_v
--   public.radar_agent_performance_v
--
-- public.refresh_factory_control_snapshot() serializes the derived state into:
--   radar_contexts.id = 'factory-control:live'
--
-- The statement-level trigger public.factory_control_refresh is installed on
-- canonical production artifact tables, performance observations, agent
-- attribution tables and radar_agent_operations. The dashboard therefore reads
-- one live, auditable snapshot without inferring work from chat history.
