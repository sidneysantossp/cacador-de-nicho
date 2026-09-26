-- Setup reviewable for a dedicated Supabase project. Not executed automatically.
begin;
create extension if not exists vector with schema extensions;
create table if not exists public.radar_channels(id text primary key,payload jsonb not null,updated_at timestamptz not null default now());
create table if not exists public.radar_analyses(like public.radar_channels including all);
create table if not exists public.radar_decisions(like public.radar_channels including all);
create table if not exists public.radar_contexts(like public.radar_channels including all);
create table if not exists public.radar_scripts(like public.radar_channels including all);
create table if not exists public.radar_settings(like public.radar_channels including all);
create table if not exists public.radar_runs(like public.radar_channels including all);
create table if not exists public.radar_managed_channels(like public.radar_channels including all);
create table if not exists public.radar_channel_brains(id text primary key references public.radar_managed_channels(id) on delete cascade,version int not null default 1 check(version>=1),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.radar_channel_brain_versions(id bigint generated always as identity primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,version int not null check(version>=1),payload jsonb not null,created_at timestamptz not null default now(),unique(channel_id,version));
create index if not exists radar_channel_brain_versions_channel_version on public.radar_channel_brain_versions(channel_id,version desc);
create table if not exists public.radar_content_arcs(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,sequence int not null default 1 check(sequence>=1),status text not null default 'planned' check(status in ('planned','active','completed','paused')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_content_arcs_channel_sequence on public.radar_content_arcs(channel_id,sequence);
create table if not exists public.radar_episodes(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,arc_id uuid references public.radar_content_arcs(id) on delete set null,sequence int not null default 1 check(sequence>=1),status text not null default 'idea' check(status in ('idea','planned','scripted','producing','published','archived')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_episodes_channel_sequence on public.radar_episodes(channel_id,sequence);
create index if not exists radar_episodes_arc_sequence on public.radar_episodes(arc_id,sequence);
create table if not exists public.radar_channel_concepts(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,concept_key text not null,status text not null default 'unknown' check(status in ('unknown','introduced','partial','established','retired')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(channel_id,concept_key));
create index if not exists radar_channel_concepts_channel_status on public.radar_channel_concepts(channel_id,status);
create table if not exists public.radar_production_dna(id text primary key references public.radar_managed_channels(id) on delete cascade,version int not null default 1 check(version>=1),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.radar_production_dna_versions(id bigint generated always as identity primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,version int not null check(version>=1),payload jsonb not null,created_at timestamptz not null default now(),unique(channel_id,version));
create index if not exists radar_production_dna_versions_channel_version on public.radar_production_dna_versions(channel_id,version desc);
create table if not exists public.radar_content_projects(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null unique references public.radar_episodes(id) on delete cascade,opportunity_id text,version int not null default 1 check(version>=1),status text not null default 'brief' check(status in ('brief','research','review','approved','blocked')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_content_projects_channel_updated on public.radar_content_projects(channel_id,updated_at desc);
create table if not exists public.radar_content_project_versions(id bigint generated always as identity primary key,project_id uuid not null references public.radar_content_projects(id) on delete cascade,version int not null check(version>=1),status text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(project_id,version));
create index if not exists radar_content_project_versions_project_version on public.radar_content_project_versions(project_id,version desc);
create table if not exists public.radar_episode_scripts(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null unique references public.radar_episodes(id) on delete cascade,content_project_id uuid not null unique references public.radar_content_projects(id) on delete cascade,version int not null default 1 check(version>=1),status text not null default 'draft' check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_episode_scripts_channel_updated on public.radar_episode_scripts(channel_id,updated_at desc);
create table if not exists public.radar_episode_script_versions(id bigint generated always as identity primary key,script_id uuid not null references public.radar_episode_scripts(id) on delete cascade,version int not null check(version>=1),status text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(script_id,version));
create index if not exists radar_episode_script_versions_script_version on public.radar_episode_script_versions(script_id,version desc);
create table if not exists public.radar_voice_assets(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,script_id uuid not null references public.radar_episode_scripts(id) on delete cascade,take int not null check(take>=1),source_type text not null check(source_type in ('uploaded','generated')),provider text,status text not null default 'ready' check(status in ('processing','ready','failed')),selected boolean not null default false,storage_path text not null,mime_type text not null,original_name text,bytes bigint not null default 0 check(bytes>=0),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(script_id,take));
create index if not exists radar_voice_assets_channel_created on public.radar_voice_assets(channel_id,created_at desc);
create index if not exists radar_voice_assets_script_take on public.radar_voice_assets(script_id,take desc);
create unique index if not exists radar_voice_assets_one_selected_per_script on public.radar_voice_assets(script_id) where selected=true;
create table if not exists public.radar_transcripts(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,script_id uuid not null references public.radar_episode_scripts(id) on delete cascade,voice_asset_id uuid not null unique references public.radar_voice_assets(id) on delete cascade,version int not null default 1 check(version>=1),source_type text not null check(source_type in ('alignment','scribe','imported')),status text not null default 'draft' check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_transcripts_channel_updated on public.radar_transcripts(channel_id,updated_at desc);
create index if not exists radar_transcripts_script_updated on public.radar_transcripts(script_id,updated_at desc);
create table if not exists public.radar_transcript_versions(id bigint generated always as identity primary key,transcript_id uuid not null references public.radar_transcripts(id) on delete cascade,version int not null check(version>=1),status text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(transcript_id,version));
create index if not exists radar_transcript_versions_transcript_version on public.radar_transcript_versions(transcript_id,version desc);
create table if not exists public.radar_scene_plans(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,script_id uuid not null references public.radar_episode_scripts(id) on delete cascade,voice_asset_id uuid not null references public.radar_voice_assets(id) on delete cascade,transcript_id uuid not null unique references public.radar_transcripts(id) on delete cascade,version int not null default 1 check(version>=1),status text not null default 'draft' check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_scene_plans_channel_updated on public.radar_scene_plans(channel_id,updated_at desc);
create index if not exists radar_scene_plans_script_updated on public.radar_scene_plans(script_id,updated_at desc);
create table if not exists public.radar_scene_plan_versions(id bigint generated always as identity primary key,scene_plan_id uuid not null references public.radar_scene_plans(id) on delete cascade,version int not null check(version>=1),status text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(scene_plan_id,version));
create index if not exists radar_scene_plan_versions_plan_version on public.radar_scene_plan_versions(scene_plan_id,version desc);
create table if not exists public.radar_visual_prompt_sets(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,scene_plan_id uuid not null unique references public.radar_scene_plans(id) on delete cascade,version int not null default 1 check(version>=1),status text not null default 'draft' check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_visual_prompt_sets_channel_updated on public.radar_visual_prompt_sets(channel_id,updated_at desc);
create table if not exists public.radar_visual_prompt_set_versions(id bigint generated always as identity primary key,prompt_set_id uuid not null references public.radar_visual_prompt_sets(id) on delete cascade,version int not null check(version>=1),status text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(prompt_set_id,version));
create index if not exists radar_visual_prompt_set_versions_set_version on public.radar_visual_prompt_set_versions(prompt_set_id,version desc);
create table if not exists public.radar_scene_assets(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,scene_plan_id uuid not null references public.radar_scene_plans(id) on delete cascade,visual_prompt_set_id uuid not null references public.radar_visual_prompt_sets(id) on delete cascade,scene_id uuid not null,variant int not null check(variant>=1),asset_kind text not null check(asset_kind in ('image','video','graphic')),source_type text not null check(source_type in ('generated','uploaded','stock','owned')),provider text,status text not null default 'processing' check(status in ('queued','processing','ready','failed','rejected')),selected boolean not null default false,storage_path text not null default '',mime_type text not null default '',original_name text,bytes bigint not null default 0 check(bytes>=0),width int,height int,duration_seconds numeric,payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(visual_prompt_set_id,scene_id,variant));
create index if not exists radar_scene_assets_channel_updated on public.radar_scene_assets(channel_id,updated_at desc);
create index if not exists radar_scene_assets_scene_variant on public.radar_scene_assets(visual_prompt_set_id,scene_id,variant desc);
create unique index if not exists radar_scene_assets_one_selected on public.radar_scene_assets(visual_prompt_set_id,scene_id) where selected=true;
create unique index if not exists radar_scene_assets_owned_link_unique on public.radar_scene_assets(
  visual_prompt_set_id,
  scene_id,
  ((payload->'owned'->>'assetId')),
  ((payload->'owned'->>'segmentId')),
  ((payload->'owned'->>'sourceStartSeconds')),
  ((payload->'owned'->>'sourceEndSeconds'))
) where source_type='owned';
create table if not exists public.radar_stock_searches(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,visual_prompt_set_id uuid not null references public.radar_visual_prompt_sets(id) on delete cascade,scene_id uuid not null,provider text not null check(provider in ('pexels','pixabay','unsplash','vecteezy')),media_kind text not null check(media_kind in ('image','video')),query text not null,result_count int not null default 0 check(result_count>=0),payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create index if not exists radar_stock_searches_scene_created on public.radar_stock_searches(visual_prompt_set_id,scene_id,created_at desc);
create table if not exists public.radar_external_import_batches(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,script_id uuid not null references public.radar_episode_scripts(id) on delete cascade,visual_prompt_set_id uuid references public.radar_visual_prompt_sets(id) on delete set null,status text not null default 'planned' check(status in ('planned','processing','partial','completed','failed')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_external_import_batches_channel_created on public.radar_external_import_batches(channel_id,created_at desc);
create table if not exists public.radar_external_import_items(id uuid primary key,batch_id uuid not null references public.radar_external_import_batches(id) on delete cascade,item_index int not null check(item_index>=0),kind text not null check(kind in ('image','video','audio','transcript','other')),original_name text not null,mime_type text not null default '',bytes bigint not null default 0 check(bytes>=0),matched_scene_id uuid,matched_time_seconds numeric,status text not null default 'pending' check(status in ('pending','processing','ready','unmatched','failed','skipped')),resource_type text check(resource_type in ('scene_asset','voice_asset','transcript')),resource_id text,error text,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(batch_id,item_index));
create index if not exists radar_external_import_items_batch_status on public.radar_external_import_items(batch_id,status,item_index);
create table if not exists public.radar_media_library_metadata(media_key text primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,resource_type text not null check(resource_type in ('scene_asset','voice_asset')),resource_id uuid not null,favorite boolean not null default false,tags text[] not null default '{}',notes text not null default '',semantic jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(resource_type,resource_id));
create index if not exists radar_media_library_metadata_channel_updated on public.radar_media_library_metadata(channel_id,updated_at desc);
create index if not exists radar_media_library_metadata_channel_favorite on public.radar_media_library_metadata(channel_id,favorite) where favorite=true;

create table if not exists public.radar_owned_media_assets(
  id uuid primary key,
  asset_kind text not null check(asset_kind in ('image','video')),
  status text not null default 'uploading' check(status in ('uploading','ready','failed')),
  source_type text not null default 'owned' check(source_type='owned'),
  storage_path text not null unique,
  mime_type text not null,
  original_name text not null,
  normalized_name text not null default '',
  content_fingerprint text,
  bytes bigint not null default 0 check(bytes>=0),
  width int,
  height int,
  duration_seconds numeric,
  title text not null default '',
  tags text[] not null default '{}',
  semantic jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  etag text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_owned_media_assets_status_created on public.radar_owned_media_assets(status,created_at desc);
create index if not exists radar_owned_media_assets_kind_created on public.radar_owned_media_assets(asset_kind,created_at desc);
create index if not exists radar_owned_media_assets_duplicate_name on public.radar_owned_media_assets(bytes,normalized_name,status);
create index if not exists radar_owned_media_assets_fingerprint on public.radar_owned_media_assets(content_fingerprint) where content_fingerprint is not null;
create index if not exists radar_owned_media_assets_search on public.radar_owned_media_assets using gin(to_tsvector('simple',search_text));

create table if not exists public.radar_owned_media_visual_analysis(
  asset_id uuid primary key references public.radar_owned_media_assets(id) on delete cascade,
  status text not null default 'processing' check(status in ('processing','completed','failed')),
  provider text not null default 'googleai',
  model text not null default '',
  asset_title text not null default '',
  duration_seconds numeric,
  payload jsonb not null default '{}'::jsonb,
  error text,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_owned_media_visual_analysis_status_updated on public.radar_owned_media_visual_analysis(status,updated_at desc);

create table if not exists public.radar_owned_media_segments(
  id uuid primary key,
  asset_id uuid not null references public.radar_owned_media_assets(id) on delete cascade,
  sequence int not null check(sequence>=1),
  start_seconds numeric not null check(start_seconds>=0),
  end_seconds numeric not null check(end_seconds>start_seconds),
  duration_seconds numeric not null check(duration_seconds>0),
  title text not null default '',
  summary text not null default '',
  semantic jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0 check(confidence>=0 and confidence<=1),
  quality_score numeric not null default 0.5 check(quality_score>=0 and quality_score<=1),
  usable boolean not null default true,
  quality_issues text[] not null default '{}',
  search_text text not null default '',
  keyframe_seconds numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(asset_id,sequence)
);
alter table public.radar_owned_media_segments add column if not exists quality_score numeric not null default 0.5 check(quality_score>=0 and quality_score<=1);
alter table public.radar_owned_media_segments add column if not exists usable boolean not null default true;
alter table public.radar_owned_media_segments add column if not exists quality_issues text[] not null default '{}';
create index if not exists radar_owned_media_segments_asset_sequence on public.radar_owned_media_segments(asset_id,sequence);
create index if not exists radar_owned_media_segments_search on public.radar_owned_media_segments using gin(to_tsvector('simple',search_text));

create table if not exists public.radar_owned_media_embeddings(
  resource_type text not null check(resource_type in ('asset','segment')),
  resource_id uuid not null,
  asset_id uuid not null references public.radar_owned_media_assets(id) on delete cascade,
  model text not null default 'gemini-embedding-001',
  dimensions int not null default 768 check(dimensions=768),
  content_hash text not null,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(resource_type,resource_id)
);
create index if not exists radar_owned_media_embeddings_asset on public.radar_owned_media_embeddings(asset_id,resource_type);
create or replace function public.match_owned_media_embeddings(
  p_query_embedding extensions.vector(768),
  p_match_count int default 50,
  p_resource_type text default 'segment'
) returns table(
  resource_type text,
  resource_id uuid,
  asset_id uuid,
  similarity double precision
)
language sql stable security invoker
set search_path=public,extensions
as $$
  select e.resource_type,e.resource_id,e.asset_id,
    greatest(0::double precision,least(1::double precision,1-(e.embedding <=> p_query_embedding))) as similarity
  from public.radar_owned_media_embeddings e
  where e.resource_type=p_resource_type
  order by e.embedding <=> p_query_embedding
  limit greatest(1,least(p_match_count,200));
$$;
revoke all on function public.match_owned_media_embeddings(extensions.vector,int,text) from public,anon,authenticated;
grant execute on function public.match_owned_media_embeddings(extensions.vector,int,text) to service_role;

create or replace function public.owned_media_embedding_similarity(
  p_left_segment uuid,
  p_right_segment uuid
) returns double precision
language sql stable security invoker
set search_path=public,extensions
as $$
  select greatest(
    0::double precision,
    least(1::double precision,1-(left_embedding.embedding <=> right_embedding.embedding))
  )
  from public.radar_owned_media_embeddings left_embedding
  join public.radar_owned_media_embeddings right_embedding
    on right_embedding.resource_type='segment'
   and right_embedding.resource_id=p_right_segment
  where left_embedding.resource_type='segment'
    and left_embedding.resource_id=p_left_segment
    and left_embedding.model=right_embedding.model
    and left_embedding.dimensions=right_embedding.dimensions
  limit 1;
$$;
revoke all on function public.owned_media_embedding_similarity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.owned_media_embedding_similarity(uuid,uuid) to service_role;

create or replace function public.owned_media_diversity_metrics(
  p_segment_ids uuid[]
) returns table(
  embedded_clip_count int,
  pair_count int,
  mean_similarity double precision,
  max_similarity double precision,
  semantic_diversity double precision
)
language sql stable security invoker
set search_path=public,extensions
as $$
  with requested as (
    select segment_id,ordinality::int as ord
    from unnest(coalesce(p_segment_ids,'{}'::uuid[])) with ordinality as item(segment_id,ordinality)
  ),
  embedded as (
    select requested.ord,requested.segment_id,e.embedding
    from requested
    join public.radar_owned_media_embeddings e
      on e.resource_type='segment'
     and e.resource_id=requested.segment_id
  ),
  pairs as (
    select greatest(
      0::double precision,
      least(1::double precision,1-(left_embedding.embedding <=> right_embedding.embedding))
    ) as similarity
    from embedded left_embedding
    join embedded right_embedding on left_embedding.ord<right_embedding.ord
  )
  select
    (select count(*)::int from embedded),
    count(*)::int,
    coalesce(avg(similarity),0::double precision),
    coalesce(max(similarity),0::double precision),
    case
      when count(*)=0 then 1::double precision
      else greatest(0::double precision,least(1::double precision,1-avg(similarity)))
    end
  from pairs;
$$;
revoke all on function public.owned_media_diversity_metrics(uuid[]) from public,anon,authenticated;
grant execute on function public.owned_media_diversity_metrics(uuid[]) to service_role;




create table if not exists public.radar_owned_media_analysis_jobs(
  id uuid primary key,
  asset_id uuid not null unique references public.radar_owned_media_assets(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
  worker_token uuid,
  lease_until timestamptz,
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_owned_media_analysis_jobs_status_created on public.radar_owned_media_analysis_jobs(status,available_at,created_at);


create table if not exists public.radar_verified_stock_jobs(
  id uuid primary key,
  channel_id text not null references public.radar_managed_channels(id) on delete cascade,
  episode_id uuid not null references public.radar_episodes(id) on delete cascade,
  visual_prompt_set_id uuid not null references public.radar_visual_prompt_sets(id) on delete cascade,
  scene_id uuid not null,
  status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
  query text not null check(char_length(query) between 1 and 2000),
  desired_duration_seconds numeric not null check(desired_duration_seconds>0 and desired_duration_seconds<=120),
  orientation text not null default 'landscape' check(orientation in ('landscape','portrait','any')),
  providers text[] not null default array['pexels','pixabay']::text[],
  max_candidates_per_provider int not null default 2 check(max_candidates_per_provider between 1 and 3),
  worker_token uuid,
  lease_until timestamptz,
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  result jsonb not null default '{}'::jsonb,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(visual_prompt_set_id,scene_id)
);
create index if not exists radar_verified_stock_jobs_status_available
  on public.radar_verified_stock_jobs(status,available_at,created_at);
create index if not exists radar_verified_stock_jobs_episode_updated
  on public.radar_verified_stock_jobs(episode_id,updated_at desc);
alter table public.radar_verified_stock_jobs enable row level security;

alter table public.radar_media_library_metadata add column if not exists semantic jsonb not null default '{}'::jsonb;
create table if not exists public.radar_asset_visual_analysis(
  asset_id uuid primary key references public.radar_scene_assets(id) on delete cascade,
  channel_id text not null references public.radar_managed_channels(id) on delete cascade,
  status text not null default 'processing' check(status in ('processing','completed','failed')),
  provider text not null default 'googleai',
  model text not null default '',
  asset_title text not null default '',
  duration_seconds numeric,
  payload jsonb not null default '{}'::jsonb,
  error text,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_asset_visual_analysis_channel_updated on public.radar_asset_visual_analysis(channel_id,updated_at desc);
create table if not exists public.radar_asset_segments(
  id uuid primary key,
  channel_id text not null references public.radar_managed_channels(id) on delete cascade,
  asset_id uuid not null references public.radar_scene_assets(id) on delete cascade,
  sequence int not null check(sequence>=1),
  start_seconds numeric not null check(start_seconds>=0),
  end_seconds numeric not null check(end_seconds>start_seconds),
  duration_seconds numeric not null check(duration_seconds>0),
  title text not null default '',
  summary text not null default '',
  semantic jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0 check(confidence between 0 and 1),
  search_text text not null default '',
  keyframe_seconds numeric not null check(keyframe_seconds>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(asset_id,sequence)
);
create index if not exists radar_asset_segments_asset_sequence on public.radar_asset_segments(asset_id,sequence);
create index if not exists radar_asset_segments_channel_updated on public.radar_asset_segments(channel_id,updated_at desc);
create index if not exists radar_asset_segments_search on public.radar_asset_segments using gin(to_tsvector('simple',search_text));
alter table public.radar_stock_searches drop constraint if exists radar_stock_searches_provider_check;
alter table public.radar_stock_searches add constraint radar_stock_searches_provider_check check(provider in ('pexels','pixabay','unsplash','vecteezy'));
create table if not exists public.radar_timelines(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,scene_plan_id uuid not null unique references public.radar_scene_plans(id) on delete cascade,script_id uuid not null references public.radar_episode_scripts(id) on delete cascade,voice_asset_id uuid not null references public.radar_voice_assets(id) on delete cascade,visual_prompt_set_id uuid not null references public.radar_visual_prompt_sets(id) on delete cascade,version int not null default 1 check(version>=1),status text not null default 'draft' check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_timelines_channel_updated on public.radar_timelines(channel_id,updated_at desc);
create table if not exists public.radar_timeline_versions(id bigint generated always as identity primary key,timeline_id uuid not null references public.radar_timelines(id) on delete cascade,version int not null check(version>=1),status text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(timeline_id,version));
create index if not exists radar_timeline_versions_timeline_version on public.radar_timeline_versions(timeline_id,version desc);
create table if not exists public.radar_audio_assets(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,kind text not null check(kind in ('music','sfx')),source_type text not null default 'uploaded' check(source_type in ('uploaded','generated','stock')),provider text,status text not null default 'ready' check(status in ('processing','ready','failed')),storage_path text not null,mime_type text not null,original_name text,bytes bigint not null check(bytes>=0),duration_seconds numeric,bpm numeric,favorite boolean not null default false,tags text[] not null default '{}',notes text not null default '',license jsonb not null default '{"type":"owned","label":"Owned / operator supplied"}'::jsonb,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_audio_assets_channel_kind_updated on public.radar_audio_assets(channel_id,kind,updated_at desc);
create index if not exists radar_audio_assets_tags_gin on public.radar_audio_assets using gin(tags);
create table if not exists public.radar_video_edits(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,timeline_id uuid not null unique references public.radar_timelines(id) on delete cascade,transcript_id uuid not null references public.radar_transcripts(id) on delete cascade,version int not null default 1 check(version>=1),status text not null default 'draft' check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_video_edits_channel_updated on public.radar_video_edits(channel_id,updated_at desc);
create table if not exists public.radar_video_edit_versions(id bigint generated always as identity primary key,video_edit_id uuid not null references public.radar_video_edits(id) on delete cascade,version int not null check(version>=1),status text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(video_edit_id,version));
create index if not exists radar_video_edit_versions_edit_version on public.radar_video_edit_versions(video_edit_id,version desc);
create table if not exists public.radar_render_jobs(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,video_edit_id uuid not null references public.radar_video_edits(id) on delete cascade,video_edit_version int not null check(video_edit_version>=1),status text not null default 'queued' check(status in ('queued','processing','completed','failed','cancelled')),progress int not null default 0 check(progress between 0 and 100),stage text not null default 'queued',attempts int not null default 0 check(attempts>=0),worker_token uuid,lease_until timestamptz,output_path text,output_bytes bigint check(output_bytes is null or output_bytes>=0),error text,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,updated_at timestamptz not null default now());
create index if not exists radar_render_jobs_channel_created on public.radar_render_jobs(channel_id,created_at desc);
create index if not exists radar_render_jobs_queue on public.radar_render_jobs(status,created_at) where status in ('queued','processing');
create unique index if not exists radar_render_jobs_one_active_version on public.radar_render_jobs(video_edit_id,video_edit_version) where status in ('queued','processing');
create table if not exists public.radar_render_chapters(
  id uuid primary key,
  render_job_id uuid not null references public.radar_render_jobs(id) on delete cascade,
  chapter_id uuid not null,
  sequence int not null check(sequence>=1),
  label text not null default '',
  start_seconds numeric not null check(start_seconds>=0),
  end_seconds numeric not null check(end_seconds>start_seconds),
  duration_seconds numeric not null check(duration_seconds>0),
  content_hash text not null,
  status text not null default 'queued' check(status in ('queued','processing','completed','failed','cancelled')),
  progress int not null default 0 check(progress between 0 and 100),
  cache_hit boolean not null default false,
  output_path text,
  output_bytes bigint check(output_bytes is null or output_bytes>=0),
  render_seconds numeric check(render_seconds is null or render_seconds>=0),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(render_job_id,chapter_id)
);
create index if not exists radar_render_chapters_job_sequence on public.radar_render_chapters(render_job_id,sequence);
create index if not exists radar_render_chapters_cache on public.radar_render_chapters(content_hash,completed_at desc)
  where status='completed' and output_path is not null;
create table if not exists public.radar_production_quality_reports(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,render_job_id uuid not null unique references public.radar_render_jobs(id) on delete cascade,video_edit_id uuid not null references public.radar_video_edits(id) on delete cascade,video_edit_version int not null check(video_edit_version>=1),version int not null default 1 check(version>=1),status text not null default 'review' check(status in ('blocked','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_production_quality_channel_updated on public.radar_production_quality_reports(channel_id,updated_at desc);
create table if not exists public.radar_production_quality_versions(id bigint generated always as identity primary key,quality_report_id uuid not null references public.radar_production_quality_reports(id) on delete cascade,version int not null check(version>=1),status text not null check(status in ('blocked','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),unique(quality_report_id,version));
create index if not exists radar_production_quality_versions_report_version on public.radar_production_quality_versions(quality_report_id,version desc);
create table if not exists public.radar_publication_packages(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,quality_report_id uuid not null unique references public.radar_production_quality_reports(id) on delete cascade,render_job_id uuid not null references public.radar_render_jobs(id) on delete cascade,version int not null default 1 check(version>=1),status text not null default 'draft' check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_publication_packages_channel_updated on public.radar_publication_packages(channel_id,updated_at desc);
create table if not exists public.radar_publication_package_versions(id bigint generated always as identity primary key,publication_package_id uuid not null references public.radar_publication_packages(id) on delete cascade,version int not null check(version>=1),status text not null check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),unique(publication_package_id,version));
create index if not exists radar_publication_package_versions_package_version on public.radar_publication_package_versions(publication_package_id,version desc);
create table if not exists public.radar_performance_observations(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,external_video_id text,observed_at timestamptz not null,source_type text not null check(source_type in ('manual','imported','youtube-analytics')),payload jsonb not null,created_at timestamptz not null default now());
create index if not exists radar_performance_observations_channel_observed on public.radar_performance_observations(channel_id,observed_at desc);
create index if not exists radar_performance_observations_video_observed on public.radar_performance_observations(external_video_id,observed_at desc) where external_video_id is not null;
create table if not exists public.radar_performance_reports(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,observation_id uuid not null unique references public.radar_performance_observations(id) on delete cascade,version int not null default 1 check(version>=1),status text not null default 'draft' check(status in ('draft','review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_performance_reports_channel_updated on public.radar_performance_reports(channel_id,updated_at desc);
create table if not exists public.radar_performance_report_versions(id bigint generated always as identity primary key,report_id uuid not null references public.radar_performance_reports(id) on delete cascade,version int not null check(version>=1),status text not null,payload jsonb not null,created_at timestamptz not null default now(),unique(report_id,version));
create index if not exists radar_performance_report_versions_report_version on public.radar_performance_report_versions(report_id,version desc);
create table if not exists public.radar_audience_intelligence_reports(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,performance_report_id uuid not null unique references public.radar_performance_reports(id) on delete cascade,observation_id uuid not null references public.radar_performance_observations(id) on delete cascade,version int not null default 1 check(version>=1),status text not null default 'review' check(status in ('review','approved')),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_audience_intelligence_channel_updated on public.radar_audience_intelligence_reports(channel_id,updated_at desc);
create table if not exists public.radar_audience_intelligence_versions(id bigint generated always as identity primary key,audience_report_id uuid not null references public.radar_audience_intelligence_reports(id) on delete cascade,version int not null check(version>=1),status text not null check(status in ('review','approved')),payload jsonb not null,created_at timestamptz not null default now(),unique(audience_report_id,version));
create index if not exists radar_audience_intelligence_versions_report_version on public.radar_audience_intelligence_versions(audience_report_id,version desc);
create table if not exists public.radar_episode_automation_runs(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,episode_id uuid not null unique references public.radar_episodes(id) on delete cascade,content_project_id uuid not null unique references public.radar_content_projects(id) on delete cascade,mode text not null default 'assisted' check(mode in ('assisted','autonomous')),status text not null default 'active' check(status in ('active','waiting','running','completed','failed','cancelled')),current_step text not null default 'content',attempts int not null default 0 check(attempts>=0),worker_token uuid,lease_until timestamptz,payload jsonb not null,last_error text,hold_step text,hold_reason text,hold_created_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_episode_automation_runs_channel_updated on public.radar_episode_automation_runs(channel_id,updated_at desc);
create index if not exists radar_episode_automation_runs_queue on public.radar_episode_automation_runs(status,updated_at) where status in ('active','running');
create table if not exists public.radar_episode_automation_events(id bigint generated always as identity primary key,run_id uuid not null references public.radar_episode_automation_runs(id) on delete cascade,step text not null,status text not null check(status in ('info','started','completed','waiting','blocked','failed')),message text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create index if not exists radar_episode_automation_events_run_created on public.radar_episode_automation_events(run_id,created_at desc);
create table if not exists public.radar_next_episode_plans(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,brain_version int not null check(brain_version>=0),version int not null default 1 check(version>=1),status text not null default 'review' check(status in ('review','accepted','superseded')),payload jsonb not null,acceptance_candidate_id uuid,acceptance_claimed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_next_episode_plans_channel_updated on public.radar_next_episode_plans(channel_id,updated_at desc);
create table if not exists public.radar_next_episode_plan_versions(id bigint generated always as identity primary key,plan_id uuid not null references public.radar_next_episode_plans(id) on delete cascade,version int not null check(version>=1),status text not null check(status in ('review','accepted','superseded')),payload jsonb not null,created_at timestamptz not null default now(),unique(plan_id,version));
create table if not exists public.radar_youtube_connections(id uuid primary key,channel_id text not null unique references public.radar_managed_channels(id) on delete cascade,youtube_channel_id text not null,youtube_title text not null default '',youtube_handle text,youtube_thumbnail text,scopes text[] not null default '{}',refresh_token_ciphertext text not null,status text not null default 'connected' check(status in ('connected','needs-reauth','disconnected')),last_validated_at timestamptz,error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_youtube_connections_status_updated on public.radar_youtube_connections(status,updated_at desc);
create table if not exists public.radar_youtube_publish_jobs(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,package_id uuid not null unique references public.radar_publication_packages(id) on delete cascade,package_version int not null check(package_version>=1),connection_id uuid not null references public.radar_youtube_connections(id) on delete cascade,status text not null default 'queued' check(status in ('queued','processing','completed','failed','cancelled')),progress int not null default 0 check(progress between 0 and 100),stage text not null default 'queued',attempts int not null default 0 check(attempts>=0),worker_token uuid,lease_until timestamptz,youtube_video_id text,youtube_url text,actual_privacy_status text,error text,payload jsonb not null,resumable_uri_ciphertext text,upload_bytes bigint not null default 0 check(upload_bytes>=0),upload_total_bytes bigint check(upload_total_bytes is null or upload_total_bytes>=0),created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,updated_at timestamptz not null default now());
create index if not exists radar_youtube_publish_jobs_channel_created on public.radar_youtube_publish_jobs(channel_id,created_at desc);
create index if not exists radar_youtube_publish_jobs_queue on public.radar_youtube_publish_jobs(status,created_at) where status in ('queued','processing');
create table if not exists public.radar_learning_loop_jobs(id uuid primary key,channel_id text not null references public.radar_managed_channels(id) on delete cascade,publish_job_id uuid not null references public.radar_youtube_publish_jobs(id) on delete cascade,package_id uuid not null references public.radar_publication_packages(id) on delete cascade,episode_id uuid not null references public.radar_episodes(id) on delete cascade,window_hours int not null check(window_hours between 1 and 720),due_at timestamptz not null,status text not null default 'scheduled' check(status in ('scheduled','processing','waiting','completed','failed','cancelled')),attempts int not null default 0 check(attempts>=0),worker_token uuid,lease_until timestamptz,stage text not null default 'scheduled',observation_id uuid references public.radar_performance_observations(id) on delete set null,performance_report_id uuid references public.radar_performance_reports(id) on delete set null,audience_report_id uuid references public.radar_audience_intelligence_reports(id) on delete set null,brain_version int,last_error text,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),completed_at timestamptz,updated_at timestamptz not null default now(),unique(publish_job_id,window_hours));
create index if not exists radar_learning_loop_jobs_due on public.radar_learning_loop_jobs(status,due_at,created_at) where status='scheduled';
create index if not exists radar_learning_loop_jobs_channel_updated on public.radar_learning_loop_jobs(channel_id,updated_at desc);
create table if not exists public.radar_autopilot_control(id text primary key check(id='global'),version int not null default 1 check(version>=1),status text not null default 'paused' check(status in ('running','paused')),pause_reason text not null default '',max_concurrent_automation_runs int not null default 1 check(max_concurrent_automation_runs between 1 and 10),max_concurrent_learning_jobs int not null default 1 check(max_concurrent_learning_jobs between 1 and 10),payload jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.radar_autopilot_control_versions(id bigint generated always as identity primary key,control_id text not null references public.radar_autopilot_control(id) on delete cascade,version int not null check(version>=1),status text not null check(status in ('running','paused')),payload jsonb not null,created_at timestamptz not null default now(),unique(control_id,version));
create index if not exists radar_autopilot_control_versions_control_version on public.radar_autopilot_control_versions(control_id,version desc);
create table if not exists public.radar_universe_queue(id text primary key,input text not null unique,status text not null default 'pending' check(status in ('pending','processing','completed','failed')),attempts int not null default 0,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_universe_queue_status_created on public.radar_universe_queue(status,created_at);
create or replace function public.claim_radar_universe_queue(p_limit int default 25)
returns table(id text,input text,status text,attempts int,last_error text,created_at timestamptz,updated_at timestamptz)
language plpgsql security invoker set search_path='' as $
begin
update public.radar_universe_queue as q
set status='pending',updated_at=now()
where q.status='processing' and q.updated_at<now()-interval '30 minutes';
return query
with picked as (
 select q.id from public.radar_universe_queue q
 where q.status in ('pending','failed') and q.attempts<3
 order by q.created_at asc
 for update skip locked
 limit greatest(1,least(coalesce(p_limit,25),50))
),claimed as (
 update public.radar_universe_queue q
 set status='processing',attempts=q.attempts+1,last_error=null,updated_at=now()
 from picked where q.id=picked.id
 returning q.id,q.input,q.status,q.attempts,q.last_error,q.created_at,q.updated_at
)
select c.id,c.input,c.status,c.attempts,c.last_error,c.created_at,c.updated_at
from claimed c order by c.created_at asc;
end;
$;
revoke all on function public.claim_radar_universe_queue(int) from public,anon,authenticated;
grant execute on function public.claim_radar_universe_queue(int) to service_role;
create table if not exists public.radar_snapshots(id bigint generated always as identity primary key,channel_id text not null,video_id text not null,views bigint not null check(views>=0),observed_at timestamptz not null);
create index if not exists radar_snapshots_observed on public.radar_snapshots(observed_at);
create table if not exists public.radar_jobs(id text primary key,status text not null check(status in ('running','completed','failed')),token uuid not null,lease_until timestamptz not null,attempts int not null default 1,updated_at timestamptz not null default now());
do $$ declare t text;begin foreach t in array array['radar_channels','radar_analyses','radar_decisions','radar_contexts','radar_scripts','radar_settings','radar_runs','radar_managed_channels','radar_channel_brains','radar_channel_brain_versions','radar_content_arcs','radar_episodes','radar_channel_concepts','radar_production_dna','radar_production_dna_versions','radar_content_projects','radar_content_project_versions','radar_episode_scripts','radar_episode_script_versions','radar_voice_assets','radar_transcripts','radar_transcript_versions','radar_scene_plans','radar_scene_plan_versions','radar_visual_prompt_sets','radar_visual_prompt_set_versions','radar_scene_assets','radar_stock_searches','radar_external_import_batches','radar_external_import_items','radar_media_library_metadata','radar_owned_media_assets','radar_owned_media_visual_analysis','radar_owned_media_segments','radar_owned_media_embeddings','radar_owned_media_analysis_jobs','radar_asset_visual_analysis','radar_asset_segments','radar_timelines','radar_timeline_versions','radar_audio_assets','radar_video_edits','radar_video_edit_versions','radar_render_jobs','radar_render_chapters','radar_production_quality_reports','radar_production_quality_versions','radar_publication_packages','radar_publication_package_versions','radar_performance_observations','radar_performance_reports','radar_performance_report_versions','radar_audience_intelligence_reports','radar_audience_intelligence_versions','radar_episode_automation_runs','radar_episode_automation_events','radar_next_episode_plans','radar_next_episode_plan_versions','radar_youtube_connections','radar_youtube_publish_jobs','radar_learning_loop_jobs','radar_autopilot_control','radar_autopilot_control_versions','radar_universe_queue','radar_snapshots','radar_jobs'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from anon, authenticated',t);execute format('grant all on table public.%I to service_role',t);end loop;end $$;
revoke all on sequence public.radar_snapshots_id_seq from anon, authenticated;
grant usage,select on sequence public.radar_snapshots_id_seq to service_role;
revoke all on sequence public.radar_channel_brain_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_channel_brain_versions_id_seq to service_role;
revoke all on sequence public.radar_production_dna_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_production_dna_versions_id_seq to service_role;
revoke all on sequence public.radar_content_project_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_content_project_versions_id_seq to service_role;
revoke all on sequence public.radar_episode_script_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_episode_script_versions_id_seq to service_role;
revoke all on sequence public.radar_transcript_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_transcript_versions_id_seq to service_role;
revoke all on sequence public.radar_scene_plan_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_scene_plan_versions_id_seq to service_role;
revoke all on sequence public.radar_visual_prompt_set_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_visual_prompt_set_versions_id_seq to service_role;
revoke all on sequence public.radar_timeline_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_timeline_versions_id_seq to service_role;
revoke all on sequence public.radar_video_edit_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_video_edit_versions_id_seq to service_role;
revoke all on sequence public.radar_production_quality_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_production_quality_versions_id_seq to service_role;
revoke all on sequence public.radar_publication_package_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_publication_package_versions_id_seq to service_role;
revoke all on sequence public.radar_performance_report_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_performance_report_versions_id_seq to service_role;
revoke all on sequence public.radar_audience_intelligence_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_audience_intelligence_versions_id_seq to service_role;
revoke all on sequence public.radar_episode_automation_events_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_episode_automation_events_id_seq to service_role;
revoke all on sequence public.radar_next_episode_plan_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_next_episode_plan_versions_id_seq to service_role;
revoke all on sequence public.radar_autopilot_control_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_autopilot_control_versions_id_seq to service_role;

insert into public.radar_autopilot_control(id,version,status,pause_reason,max_concurrent_automation_runs,max_concurrent_learning_jobs,payload)
values('global',1,'paused','Control Plane inicializado em modo seguro.',1,1,jsonb_build_object('kind','autopilot-control','id','global','status','paused','pauseReason','Control Plane inicializado em modo seguro.','maxConcurrentAutomationRuns',1,'maxConcurrentLearningJobs',1,'updatedBy','system','createdAt',to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
on conflict(id) do nothing;
insert into public.radar_autopilot_control_versions(control_id,version,status,payload)
select id,version,status,payload from public.radar_autopilot_control where id='global'
on conflict(control_id,version) do nothing;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cacadores-media','cacadores-media',false,524288000,array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/m4a','audio/ogg','audio/flac','audio/webm','image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.save_autopilot_control(p_status text,p_pause_reason text,p_max_concurrent_automation_runs int,p_max_concurrent_learning_jobs int,p_payload jsonb,p_expected_version int) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int;next_version int;
begin
perform pg_advisory_xact_lock(hashtext('autopilot-control:global'));
if p_status not in ('running','paused') then raise exception 'invalid autopilot control status';end if;
if p_max_concurrent_automation_runs not between 1 and 10 then raise exception 'invalid automation concurrency';end if;
if p_max_concurrent_learning_jobs not between 1 and 10 then raise exception 'invalid learning concurrency';end if;
select version into current_version from public.radar_autopilot_control where id='global' for update;
if current_version is null then raise exception 'autopilot control missing';end if;
if current_version<>p_expected_version then raise exception 'autopilot control version conflict';end if;
next_version:=current_version+1;
update public.radar_autopilot_control set version=next_version,status=p_status,pause_reason=left(coalesce(p_pause_reason,''),1000),max_concurrent_automation_runs=p_max_concurrent_automation_runs,max_concurrent_learning_jobs=p_max_concurrent_learning_jobs,payload=p_payload,updated_at=now() where id='global';
insert into public.radar_autopilot_control_versions(control_id,version,status,payload) values('global',next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_autopilot_control(text,text,int,int,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_autopilot_control(text,text,int,int,jsonb,int) to service_role;

create or replace function public.claim_render_job(p_worker_token uuid,p_lease_seconds int default 900) returns uuid
language plpgsql security invoker set search_path='' as $$
declare picked uuid;
begin
if p_lease_seconds<60 or p_lease_seconds>3600 then raise exception 'invalid render lease';end if;
update public.radar_render_jobs set status='queued',stage='requeued-after-lease',worker_token=null,lease_until=null,updated_at=now()
where status='processing' and lease_until is not null and lease_until<now();
select id into picked from public.radar_render_jobs where status='queued' order by created_at asc for update skip locked limit 1;
if picked is null then return null;end if;
update public.radar_render_jobs
set status='processing',progress=greatest(progress,1),stage='claimed',attempts=attempts+1,worker_token=p_worker_token,
lease_until=now()+make_interval(secs=>p_lease_seconds),started_at=coalesce(started_at,now()),error=null,updated_at=now()
where id=picked;
return picked;
end $$;
revoke all on function public.claim_render_job(uuid,int) from public,anon,authenticated;
grant execute on function public.claim_render_job(uuid,int) to service_role;

create or replace function public.heartbeat_render_job(p_job_id uuid,p_worker_token uuid,p_progress int,p_stage text,p_lease_seconds int default 900) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
update public.radar_render_jobs
set progress=greatest(progress,least(99,greatest(1,p_progress))),stage=left(coalesce(p_stage,'processing'),120),
lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
where id=p_job_id and status='processing' and worker_token=p_worker_token;
return found;
end $$;
revoke all on function public.heartbeat_render_job(uuid,uuid,int,text,int) from public,anon,authenticated;
grant execute on function public.heartbeat_render_job(uuid,uuid,int,text,int) to service_role;

create or replace function public.save_performance_report(p_report_id uuid,p_channel_id text,p_episode_id uuid,p_observation_id uuid,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int;next_version int;
begin
perform pg_advisory_xact_lock(hashtext('performance-report:'||p_report_id::text));
if p_status not in ('draft','review','approved') then raise exception 'invalid performance report status';end if;
if not exists(select 1 from public.radar_performance_observations o where o.id=p_observation_id and o.channel_id=p_channel_id and o.episode_id=p_episode_id) then raise exception 'performance observation not eligible';end if;
select version into current_version from public.radar_performance_reports where id=p_report_id for update;
if current_version is null then
  if exists(select 1 from public.radar_performance_reports where observation_id=p_observation_id) then raise exception 'performance observation already has report';end if;
  if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'performance report version conflict';end if;
  insert into public.radar_performance_reports(id,channel_id,episode_id,observation_id,version,status,payload) values(p_report_id,p_channel_id,p_episode_id,p_observation_id,1,p_status,p_payload);
  insert into public.radar_performance_report_versions(report_id,version,status,payload) values(p_report_id,1,p_status,p_payload);
  return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'performance report version conflict';end if;
next_version:=current_version+1;
update public.radar_performance_reports set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_report_id;
insert into public.radar_performance_report_versions(report_id,version,status,payload) values(p_report_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_performance_report(uuid,text,uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_performance_report(uuid,text,uuid,uuid,text,jsonb,int) to service_role;

create or replace function public.save_audience_intelligence_report(p_report_id uuid,p_channel_id text,p_episode_id uuid,p_performance_report_id uuid,p_observation_id uuid,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('audience-intelligence:'||p_report_id::text));
if p_status not in ('review','approved') then raise exception 'invalid audience intelligence status';end if;
if not exists(select 1 from public.radar_performance_reports pr join public.radar_performance_observations po on po.id=pr.observation_id where pr.id=p_performance_report_id and pr.status='approved' and pr.channel_id=p_channel_id and pr.episode_id=p_episode_id and po.id=p_observation_id and po.channel_id=p_channel_id and po.episode_id=p_episode_id) then raise exception 'audience intelligence source not eligible';end if;
select version into current_version from public.radar_audience_intelligence_reports where id=p_report_id for update;
if current_version is null then
  if exists(select 1 from public.radar_audience_intelligence_reports where performance_report_id=p_performance_report_id) then raise exception 'performance report already has audience intelligence';end if;
  if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'audience intelligence version conflict';end if;
  insert into public.radar_audience_intelligence_reports(id,channel_id,episode_id,performance_report_id,observation_id,version,status,payload) values(p_report_id,p_channel_id,p_episode_id,p_performance_report_id,p_observation_id,1,p_status,p_payload);
  insert into public.radar_audience_intelligence_versions(audience_report_id,version,status,payload) values(p_report_id,1,p_status,p_payload);
  return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'audience intelligence version conflict';end if;
next_version:=current_version+1;
update public.radar_audience_intelligence_reports set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_report_id;
insert into public.radar_audience_intelligence_versions(audience_report_id,version,status,payload) values(p_report_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_audience_intelligence_report(uuid,text,uuid,uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_audience_intelligence_report(uuid,text,uuid,uuid,uuid,text,jsonb,int) to service_role;

create or replace function public.claim_youtube_publish_job(p_worker_token uuid,p_lease_seconds int default 1800) returns uuid
language plpgsql security invoker set search_path='' as $$
declare picked uuid;
begin
if p_lease_seconds<60 or p_lease_seconds>7200 then raise exception 'invalid youtube publish lease';end if;
update public.radar_youtube_publish_jobs set status='queued',stage='requeued-after-lease',worker_token=null,lease_until=null,updated_at=now()
where status='processing' and lease_until is not null and lease_until<now();
select j.id into picked from public.radar_youtube_publish_jobs j join public.radar_youtube_connections c on c.id=j.connection_id
where j.status='queued' and c.status='connected' order by j.created_at asc for update of j skip locked limit 1;
if picked is null then return null;end if;
update public.radar_youtube_publish_jobs
set status='processing',progress=greatest(progress,1),stage='claimed',attempts=attempts+1,worker_token=p_worker_token,
lease_until=now()+make_interval(secs=>p_lease_seconds),started_at=coalesce(started_at,now()),error=null,updated_at=now()
where id=picked;
return picked;
end $$;
revoke all on function public.claim_youtube_publish_job(uuid,int) from public,anon,authenticated;
grant execute on function public.claim_youtube_publish_job(uuid,int) to service_role;

create or replace function public.heartbeat_youtube_publish_job(p_job_id uuid,p_worker_token uuid,p_progress int,p_stage text,p_lease_seconds int default 1800) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
update public.radar_youtube_publish_jobs
set progress=greatest(progress,least(99,greatest(1,p_progress))),stage=left(coalesce(p_stage,'processing'),120),
lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
where id=p_job_id and status='processing' and worker_token=p_worker_token;
return found;
end $$;
revoke all on function public.heartbeat_youtube_publish_job(uuid,uuid,int,text,int) from public,anon,authenticated;
grant execute on function public.heartbeat_youtube_publish_job(uuid,uuid,int,text,int) to service_role;

create or replace function public.claim_learning_loop_job(p_worker_token uuid,p_lease_seconds int default 900) returns uuid
language plpgsql security invoker set search_path='' as $$
declare picked uuid;control_status text;max_jobs int;active_jobs int;
begin
if p_lease_seconds<60 or p_lease_seconds>3600 then raise exception 'invalid learning loop lease';end if;
select status,max_concurrent_learning_jobs into control_status,max_jobs from public.radar_autopilot_control where id='global';
if control_status is distinct from 'running' then return null;end if;
update public.radar_learning_loop_jobs set status='scheduled',stage='requeued-after-lease',worker_token=null,lease_until=null,due_at=least(due_at,now()),updated_at=now()
where status='processing' and worker_token is not null and lease_until is not null and lease_until<now();
select count(*) into active_jobs from public.radar_learning_loop_jobs
where status='processing' and worker_token is not null and lease_until is not null and lease_until>now();
if active_jobs>=coalesce(max_jobs,1) then return null;end if;
select id into picked from public.radar_learning_loop_jobs
where status='scheduled' and due_at<=now()
order by due_at asc,created_at asc for update skip locked limit 1;
if picked is null then return null;end if;
update public.radar_learning_loop_jobs set status='processing',stage='claimed',attempts=attempts+1,worker_token=p_worker_token,lease_until=now()+make_interval(secs=>p_lease_seconds),last_error=null,updated_at=now() where id=picked;
return picked;
end $$;
revoke all on function public.claim_learning_loop_job(uuid,int) from public,anon,authenticated;
grant execute on function public.claim_learning_loop_job(uuid,int) to service_role;

create or replace function public.heartbeat_learning_loop_job(p_job_id uuid,p_worker_token uuid,p_stage text,p_lease_seconds int default 900) returns boolean
language plpgsql security invoker set search_path='' as $
begin
update public.radar_learning_loop_jobs
set stage=left(coalesce(p_stage,'processing'),120),lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
where id=p_job_id and status='processing' and worker_token=p_worker_token;
return found;
end $;
revoke all on function public.heartbeat_learning_loop_job(uuid,uuid,text,int) from public,anon,authenticated;
grant execute on function public.heartbeat_learning_loop_job(uuid,uuid,text,int) to service_role;

create or replace function public.claim_episode_automation_run(p_worker_token uuid,p_lease_seconds int default 900) returns uuid
language plpgsql security invoker set search_path='' as $$
declare picked uuid;control_status text;max_runs int;active_runs int;
begin
if p_lease_seconds<60 or p_lease_seconds>3600 then raise exception 'invalid automation lease';end if;
select status,max_concurrent_automation_runs into control_status,max_runs from public.radar_autopilot_control where id='global';
if control_status is distinct from 'running' then return null;end if;
update public.radar_episode_automation_runs set status='active',worker_token=null,lease_until=null,updated_at=now()
where status='running' and mode='autonomous' and worker_token is not null and lease_until is not null and lease_until<now();
select count(*) into active_runs from public.radar_episode_automation_runs
where status='running' and worker_token is not null and lease_until is not null and lease_until>now();
if active_runs>=coalesce(max_runs,1) then return null;end if;
select r.id into picked from public.radar_episode_automation_runs r
where r.mode='autonomous'
  and r.hold_step is null
  and (r.status='active' or (r.status='running' and r.worker_token is null))
  and not (
    r.current_step='visual-assets'
    and exists(
      select 1 from public.radar_verified_stock_jobs j
      where j.episode_id=r.episode_id
        and j.status in ('queued','processing')
    )
  )
  and not (
    r.current_step='render'
    and exists(
      select 1 from public.radar_render_jobs j
      where j.episode_id=r.episode_id
        and j.status in ('queued','processing')
    )
  )
order by r.updated_at asc for update skip locked limit 1;
if picked is null then return null;end if;
update public.radar_episode_automation_runs set status='running',attempts=attempts+1,worker_token=p_worker_token,lease_until=now()+make_interval(secs=>p_lease_seconds),last_error=null,updated_at=now() where id=picked;
return picked;
end $$;
revoke all on function public.claim_episode_automation_run(uuid,int) from public,anon,authenticated;
grant execute on function public.claim_episode_automation_run(uuid,int) to service_role;

create or replace function public.heartbeat_episode_automation_run(p_run_id uuid,p_worker_token uuid,p_lease_seconds int default 900) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
update public.radar_episode_automation_runs set lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now() where id=p_run_id and status='running' and worker_token=p_worker_token;
return found;
end $$;
revoke all on function public.heartbeat_episode_automation_run(uuid,uuid,int) from public,anon,authenticated;
grant execute on function public.heartbeat_episode_automation_run(uuid,uuid,int) to service_role;

create or replace function public.claim_next_episode_candidate(p_plan_id uuid,p_expected_version int,p_candidate_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare current_version int; current_status text; current_candidate uuid; current_payload jsonb;
begin
perform pg_advisory_xact_lock(hashtext('next-episode-accept:'||p_plan_id::text));
select version,status,acceptance_candidate_id,payload into current_version,current_status,current_candidate,current_payload
from public.radar_next_episode_plans where id=p_plan_id for update;
if current_version is null then raise exception 'next episode plan not found';end if;
if current_status='accepted' then
  if current_payload#>>'{review,acceptedCandidateId}'=p_candidate_id::text then return true;end if;
  raise exception 'next episode plan already accepted';
end if;
if current_status<>'review' then raise exception 'next episode plan unavailable';end if;
if current_version<>p_expected_version then raise exception 'next episode plan version conflict';end if;
if not exists(select 1 from jsonb_array_elements(coalesce(current_payload->'candidates','[]'::jsonb)) item where item->>'id'=p_candidate_id::text) then raise exception 'candidate does not belong to plan';end if;
if current_candidate is null then
  update public.radar_next_episode_plans set acceptance_candidate_id=p_candidate_id,acceptance_claimed_at=now(),updated_at=now() where id=p_plan_id;
  return true;
end if;
if current_candidate=p_candidate_id then return true;end if;
raise exception 'next episode acceptance already claimed';
end $$;
revoke all on function public.claim_next_episode_candidate(uuid,int,uuid) from public,anon,authenticated;
grant execute on function public.claim_next_episode_candidate(uuid,int,uuid) to service_role;

create or replace function public.save_next_episode_plan(p_plan_id uuid,p_channel_id text,p_brain_version int,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('next-episode-plan:'||p_plan_id::text));
if p_status not in ('review','accepted','superseded') then raise exception 'invalid next episode plan status';end if;
if not exists(select 1 from public.radar_managed_channels where id=p_channel_id) then raise exception 'managed channel not found';end if;
select version into current_version from public.radar_next_episode_plans where id=p_plan_id for update;
if current_version is null then
  if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'next episode plan version conflict';end if;
  insert into public.radar_next_episode_plans(id,channel_id,brain_version,version,status,payload) values(p_plan_id,p_channel_id,p_brain_version,1,p_status,p_payload);
  insert into public.radar_next_episode_plan_versions(plan_id,version,status,payload) values(p_plan_id,1,p_status,p_payload);
  return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'next episode plan version conflict';end if;
next_version:=current_version+1;
update public.radar_next_episode_plans set brain_version=p_brain_version,version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_plan_id;
insert into public.radar_next_episode_plan_versions(plan_id,version,status,payload) values(p_plan_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_next_episode_plan(uuid,text,int,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_next_episode_plan(uuid,text,int,text,jsonb,int) to service_role;

create or replace function public.save_production_quality_report(p_report_id uuid,p_channel_id text,p_episode_id uuid,p_render_job_id uuid,p_video_edit_id uuid,p_video_edit_version int,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('production-quality:'||p_report_id::text));
if p_status not in ('blocked','review','approved') then raise exception 'invalid production quality status';end if;
if not exists(select 1 from public.radar_render_jobs r where r.id=p_render_job_id and r.channel_id=p_channel_id and r.episode_id=p_episode_id and r.video_edit_id=p_video_edit_id and r.video_edit_version=p_video_edit_version and r.status='completed' and r.output_path is not null) then raise exception 'render job not eligible for production quality';end if;
select version into current_version from public.radar_production_quality_reports where id=p_report_id for update;
if current_version is null then
  if exists(select 1 from public.radar_production_quality_reports where render_job_id=p_render_job_id) then raise exception 'render job already has production quality report';end if;
  if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'production quality version conflict';end if;
  insert into public.radar_production_quality_reports(id,channel_id,episode_id,render_job_id,video_edit_id,video_edit_version,version,status,payload) values(p_report_id,p_channel_id,p_episode_id,p_render_job_id,p_video_edit_id,p_video_edit_version,1,p_status,p_payload);
  insert into public.radar_production_quality_versions(quality_report_id,version,status,payload) values(p_report_id,1,p_status,p_payload);
  return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'production quality version conflict';end if;
next_version:=current_version+1;
update public.radar_production_quality_reports set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_report_id;
insert into public.radar_production_quality_versions(quality_report_id,version,status,payload) values(p_report_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_production_quality_report(uuid,text,uuid,uuid,uuid,int,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_production_quality_report(uuid,text,uuid,uuid,uuid,int,text,jsonb,int) to service_role;

create or replace function public.save_publication_package(p_package_id uuid,p_channel_id text,p_episode_id uuid,p_quality_report_id uuid,p_render_job_id uuid,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('publication-package:'||p_package_id::text));
if p_status not in ('draft','review','approved') then raise exception 'invalid publication package status';end if;
if not exists(select 1 from public.radar_production_quality_reports q join public.radar_render_jobs r on r.id=q.render_job_id where q.id=p_quality_report_id and q.channel_id=p_channel_id and q.episode_id=p_episode_id and r.id=p_render_job_id and r.channel_id=p_channel_id and r.episode_id=p_episode_id and r.status='completed' and r.output_path is not null) then raise exception 'publication package source not eligible';end if;
select version into current_version from public.radar_publication_packages where id=p_package_id for update;
if current_version is null then
  if exists(select 1 from public.radar_publication_packages where quality_report_id=p_quality_report_id) then raise exception 'quality report already has publication package';end if;
  if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'publication package version conflict';end if;
  insert into public.radar_publication_packages(id,channel_id,episode_id,quality_report_id,render_job_id,version,status,payload) values(p_package_id,p_channel_id,p_episode_id,p_quality_report_id,p_render_job_id,1,p_status,p_payload);
  insert into public.radar_publication_package_versions(publication_package_id,version,status,payload) values(p_package_id,1,p_status,p_payload);
  return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'publication package version conflict';end if;
next_version:=current_version+1;
update public.radar_publication_packages set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_package_id;
insert into public.radar_publication_package_versions(publication_package_id,version,status,payload) values(p_package_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_publication_package(uuid,text,uuid,uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_publication_package(uuid,text,uuid,uuid,uuid,text,jsonb,int) to service_role;

create or replace function public.save_video_edit(p_video_edit_id uuid,p_channel_id text,p_episode_id uuid,p_timeline_id uuid,p_transcript_id uuid,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('video-edit:'||p_video_edit_id::text));
if p_status not in ('draft','review','approved') then raise exception 'invalid video edit status';end if;
if not exists(
  select 1
  from public.radar_timelines t
  join public.radar_scene_plans sp on sp.id=t.scene_plan_id
  join public.radar_transcripts tr on tr.id=sp.transcript_id
  where t.id=p_timeline_id
    and t.channel_id=p_channel_id
    and t.episode_id=p_episode_id
    and t.status='approved'
    and tr.id=p_transcript_id
    and tr.status='approved'
) then raise exception 'video edit upstream not eligible';end if;
select version into current_version from public.radar_video_edits where id=p_video_edit_id for update;
if current_version is null then
  if exists(select 1 from public.radar_video_edits where timeline_id=p_timeline_id) then raise exception 'timeline already has video edit';end if;
  if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'video edit version conflict';end if;
  insert into public.radar_video_edits(id,channel_id,episode_id,timeline_id,transcript_id,version,status,payload)
  values(p_video_edit_id,p_channel_id,p_episode_id,p_timeline_id,p_transcript_id,1,p_status,p_payload);
  insert into public.radar_video_edit_versions(video_edit_id,version,status,payload)
  values(p_video_edit_id,1,p_status,p_payload);
  return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'video edit version conflict';end if;
next_version:=current_version+1;
update public.radar_video_edits set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_video_edit_id;
insert into public.radar_video_edit_versions(video_edit_id,version,status,payload) values(p_video_edit_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_video_edit(uuid,text,uuid,uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_video_edit(uuid,text,uuid,uuid,uuid,text,jsonb,int) to service_role;

create or replace function public.save_timeline(p_timeline_id uuid,p_channel_id text,p_episode_id uuid,p_scene_plan_id uuid,p_script_id uuid,p_voice_asset_id uuid,p_visual_prompt_set_id uuid,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('timeline:'||p_timeline_id::text));
if p_status not in ('draft','review','approved') then raise exception 'invalid timeline status';end if;
if not exists(select 1 from public.radar_scene_plans sp join public.radar_episode_scripts s on s.id=sp.script_id join public.radar_voice_assets v on v.id=sp.voice_asset_id join public.radar_visual_prompt_sets vp on vp.scene_plan_id=sp.id where sp.id=p_scene_plan_id and sp.channel_id=p_channel_id and sp.episode_id=p_episode_id and sp.script_id=p_script_id and sp.voice_asset_id=p_voice_asset_id and sp.status='approved' and s.status='approved' and v.status='ready' and vp.id=p_visual_prompt_set_id and vp.status='approved') then raise exception 'timeline upstream not eligible';end if;
select version into current_version from public.radar_timelines where id=p_timeline_id for update;
if current_version is null then
 if exists(select 1 from public.radar_timelines where scene_plan_id=p_scene_plan_id) then raise exception 'scene plan already has timeline';end if;
 if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'timeline version conflict';end if;
 insert into public.radar_timelines(id,channel_id,episode_id,scene_plan_id,script_id,voice_asset_id,visual_prompt_set_id,version,status,payload) values(p_timeline_id,p_channel_id,p_episode_id,p_scene_plan_id,p_script_id,p_voice_asset_id,p_visual_prompt_set_id,1,p_status,p_payload);
 insert into public.radar_timeline_versions(timeline_id,version,status,payload) values(p_timeline_id,1,p_status,p_payload);
 return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'timeline version conflict';end if;
next_version:=current_version+1;
update public.radar_timelines set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_timeline_id;
insert into public.radar_timeline_versions(timeline_id,version,status,payload) values(p_timeline_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_timeline(uuid,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_timeline(uuid,text,uuid,uuid,uuid,uuid,uuid,text,jsonb,int) to service_role;

create or replace function public.refresh_external_import_batch_status(p_batch_id uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare total_count int; active_count int; ready_count int; problem_count int; failed_count int; next_status text;
begin
perform pg_advisory_xact_lock(hashtext('external-import:'||p_batch_id::text));
select count(*)::int,count(*) filter(where status in ('pending','processing'))::int,count(*) filter(where status in ('ready','skipped'))::int,count(*) filter(where status in ('failed','unmatched'))::int,count(*) filter(where status='failed')::int
into total_count,active_count,ready_count,problem_count,failed_count
from public.radar_external_import_items where batch_id=p_batch_id;
if total_count=0 then next_status:='planned';
elsif active_count>0 then next_status:='processing';
elsif ready_count=total_count then next_status:='completed';
elsif failed_count=total_count then next_status:='failed';
elsif problem_count>0 then next_status:='partial';
else next_status:='partial';
end if;
update public.radar_external_import_batches set status=next_status,updated_at=now() where id=p_batch_id;
return next_status;
end $$;
revoke all on function public.refresh_external_import_batch_status(uuid) from public,anon,authenticated;
grant execute on function public.refresh_external_import_batch_status(uuid) to service_role;

create or replace function public.reserve_scene_asset(p_id uuid,p_channel_id text,p_episode_id uuid,p_scene_plan_id uuid,p_visual_prompt_set_id uuid,p_scene_id uuid,p_asset_kind text,p_source_type text,p_provider text,p_mime_type text,p_original_name text,p_payload jsonb) returns int
language plpgsql security invoker set search_path='' as $$
declare next_variant int;
begin
perform pg_advisory_xact_lock(hashtext('scene-asset:'||p_visual_prompt_set_id::text||':'||p_scene_id::text));
if p_asset_kind not in ('image','video','graphic') then raise exception 'invalid asset kind';end if;
if p_source_type not in ('generated','uploaded','stock','owned') then raise exception 'invalid asset source';end if;
if not exists(select 1 from public.radar_visual_prompt_sets v join public.radar_scene_plans s on s.id=v.scene_plan_id where v.id=p_visual_prompt_set_id and v.channel_id=p_channel_id and v.episode_id=p_episode_id and v.scene_plan_id=p_scene_plan_id and v.status='approved' and s.status='approved' and exists(select 1 from jsonb_array_elements(s.payload->'scenes') scene where scene->>'id'=p_scene_id::text)) then raise exception 'scene not eligible';end if;
select coalesce(max(variant),0)+1 into next_variant from public.radar_scene_assets where visual_prompt_set_id=p_visual_prompt_set_id and scene_id=p_scene_id;
insert into public.radar_scene_assets(id,channel_id,episode_id,scene_plan_id,visual_prompt_set_id,scene_id,variant,asset_kind,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload)
values(p_id,p_channel_id,p_episode_id,p_scene_plan_id,p_visual_prompt_set_id,p_scene_id,next_variant,p_asset_kind,p_source_type,p_provider,'processing',false,'',coalesce(p_mime_type,''),p_original_name,0,p_payload);
return next_variant;
end $$;
revoke all on function public.reserve_scene_asset(uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_scene_asset(uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb) to service_role;

create or replace function public.select_scene_asset(p_visual_prompt_set_id uuid,p_scene_id uuid,p_asset_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
perform pg_advisory_xact_lock(hashtext('scene-asset-select:'||p_visual_prompt_set_id::text||':'||p_scene_id::text));
if not exists(select 1 from public.radar_scene_assets where id=p_asset_id and visual_prompt_set_id=p_visual_prompt_set_id and scene_id=p_scene_id and status='ready') then raise exception 'scene asset not ready';end if;
update public.radar_scene_assets set selected=false,updated_at=now() where visual_prompt_set_id=p_visual_prompt_set_id and scene_id=p_scene_id and selected=true;
update public.radar_scene_assets set selected=true,updated_at=now() where id=p_asset_id;
end $$;
revoke all on function public.select_scene_asset(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.select_scene_asset(uuid,uuid,uuid) to service_role;

create or replace function public.select_scene_asset_if_none(p_visual_prompt_set_id uuid,p_scene_id uuid,p_asset_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
perform pg_advisory_xact_lock(hashtext('scene-asset-select:'||p_visual_prompt_set_id::text||':'||p_scene_id::text));
if exists(select 1 from public.radar_scene_assets where visual_prompt_set_id=p_visual_prompt_set_id and scene_id=p_scene_id and selected=true and status='ready') then return false;end if;
update public.radar_scene_assets set selected=true,updated_at=now() where id=p_asset_id and visual_prompt_set_id=p_visual_prompt_set_id and scene_id=p_scene_id and status='ready';
return found;
end $$;
revoke all on function public.select_scene_asset_if_none(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.select_scene_asset_if_none(uuid,uuid,uuid) to service_role;

create or replace function public.save_visual_prompt_set(p_set_id uuid,p_channel_id text,p_episode_id uuid,p_scene_plan_id uuid,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('visual-prompt-set:'||p_set_id::text));
if p_status not in ('draft','review','approved') then raise exception 'invalid visual prompt status';end if;
if not exists(select 1 from public.radar_scene_plans where id=p_scene_plan_id and channel_id=p_channel_id and episode_id=p_episode_id and status='approved') then raise exception 'scene plan not approved';end if;
select version into current_version from public.radar_visual_prompt_sets where id=p_set_id for update;
if current_version is null then
 if exists(select 1 from public.radar_visual_prompt_sets where scene_plan_id=p_scene_plan_id) then raise exception 'scene plan already has visual prompt set';end if;
 if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'visual prompt version conflict';end if;
 insert into public.radar_visual_prompt_sets(id,channel_id,episode_id,scene_plan_id,version,status,payload) values(p_set_id,p_channel_id,p_episode_id,p_scene_plan_id,1,p_status,p_payload);
 insert into public.radar_visual_prompt_set_versions(prompt_set_id,version,status,payload) values(p_set_id,1,p_status,p_payload);
 return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'visual prompt version conflict';end if;
next_version:=current_version+1;
update public.radar_visual_prompt_sets set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_set_id;
insert into public.radar_visual_prompt_set_versions(prompt_set_id,version,status,payload) values(p_set_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_visual_prompt_set(uuid,text,uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_visual_prompt_set(uuid,text,uuid,uuid,text,jsonb,int) to service_role;

create or replace function public.save_scene_plan(p_plan_id uuid,p_channel_id text,p_episode_id uuid,p_script_id uuid,p_voice_asset_id uuid,p_transcript_id uuid,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('scene-plan:'||p_plan_id::text));
if p_status not in ('draft','review','approved') then raise exception 'invalid scene plan status';end if;
if not exists(select 1 from public.radar_transcripts t join public.radar_voice_assets v on v.id=t.voice_asset_id join public.radar_episode_scripts s on s.id=t.script_id where t.id=p_transcript_id and t.channel_id=p_channel_id and t.episode_id=p_episode_id and t.script_id=p_script_id and t.voice_asset_id=p_voice_asset_id and t.status='approved' and v.status='ready' and s.status='approved') then raise exception 'transcript not approved';end if;
select version into current_version from public.radar_scene_plans where id=p_plan_id for update;
if current_version is null then
 if exists(select 1 from public.radar_scene_plans where transcript_id=p_transcript_id) then raise exception 'transcript already has scene plan';end if;
 if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'scene plan version conflict';end if;
 insert into public.radar_scene_plans(id,channel_id,episode_id,script_id,voice_asset_id,transcript_id,version,status,payload) values(p_plan_id,p_channel_id,p_episode_id,p_script_id,p_voice_asset_id,p_transcript_id,1,p_status,p_payload);
 insert into public.radar_scene_plan_versions(scene_plan_id,version,status,payload) values(p_plan_id,1,p_status,p_payload);
 return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'scene plan version conflict';end if;
next_version:=current_version+1;
update public.radar_scene_plans set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_plan_id;
insert into public.radar_scene_plan_versions(scene_plan_id,version,status,payload) values(p_plan_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_scene_plan(uuid,text,uuid,uuid,uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_scene_plan(uuid,text,uuid,uuid,uuid,uuid,text,jsonb,int) to service_role;

create or replace function public.save_transcript(p_transcript_id uuid,p_channel_id text,p_episode_id uuid,p_script_id uuid,p_voice_asset_id uuid,p_source_type text,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $$
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('transcript:'||p_transcript_id::text));
if p_source_type not in ('alignment','scribe','imported') then raise exception 'invalid transcript source';end if;
if p_status not in ('draft','review','approved') then raise exception 'invalid transcript status';end if;
if not exists(select 1 from public.radar_voice_assets v join public.radar_episode_scripts s on s.id=v.script_id where v.id=p_voice_asset_id and v.channel_id=p_channel_id and v.episode_id=p_episode_id and v.script_id=p_script_id and v.status='ready' and s.status='approved') then raise exception 'voice asset not eligible';end if;
select version into current_version from public.radar_transcripts where id=p_transcript_id for update;
if current_version is null then
 if exists(select 1 from public.radar_transcripts where voice_asset_id=p_voice_asset_id) then raise exception 'voice asset already has transcript';end if;
 if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'transcript version conflict';end if;
 insert into public.radar_transcripts(id,channel_id,episode_id,script_id,voice_asset_id,version,source_type,status,payload) values(p_transcript_id,p_channel_id,p_episode_id,p_script_id,p_voice_asset_id,1,p_source_type,p_status,p_payload);
 insert into public.radar_transcript_versions(transcript_id,version,status,payload) values(p_transcript_id,1,p_status,p_payload);
 return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'transcript version conflict';end if;
next_version:=current_version+1;
update public.radar_transcripts set version=next_version,source_type=p_source_type,status=p_status,payload=p_payload,updated_at=now() where id=p_transcript_id;
insert into public.radar_transcript_versions(transcript_id,version,status,payload) values(p_transcript_id,next_version,p_status,p_payload);
return next_version;
end $$;
revoke all on function public.save_transcript(uuid,text,uuid,uuid,uuid,text,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_transcript(uuid,text,uuid,uuid,uuid,text,text,jsonb,int) to service_role;

create or replace function public.reserve_voice_asset(p_id uuid,p_channel_id text,p_episode_id uuid,p_script_id uuid,p_source_type text,p_provider text,p_mime_type text,p_original_name text,p_payload jsonb) returns int
language plpgsql security invoker set search_path='' as $
declare next_take int;
begin
perform pg_advisory_xact_lock(hashtext('voice-take:'||p_script_id::text));
if p_source_type not in ('uploaded','generated') then raise exception 'invalid voice source type';end if;
if not exists(select 1 from public.radar_episode_scripts where id=p_script_id and channel_id=p_channel_id and episode_id=p_episode_id and status='approved') then raise exception 'script not approved';end if;
select coalesce(max(take),0)+1 into next_take from public.radar_voice_assets where script_id=p_script_id;
insert into public.radar_voice_assets(id,channel_id,episode_id,script_id,take,source_type,provider,status,selected,storage_path,mime_type,original_name,bytes,payload)
values(p_id,p_channel_id,p_episode_id,p_script_id,next_take,p_source_type,p_provider,'processing',false,'',p_mime_type,p_original_name,0,p_payload);
return next_take;
end $;
revoke all on function public.reserve_voice_asset(uuid,text,uuid,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_voice_asset(uuid,text,uuid,uuid,text,text,text,text,jsonb) to service_role;

create or replace function public.select_voice_asset(p_script_id uuid,p_asset_id uuid) returns void
language plpgsql security invoker set search_path='' as $
begin
perform pg_advisory_xact_lock(hashtext('voice-select:'||p_script_id::text));
if not exists(select 1 from public.radar_voice_assets where id=p_asset_id and script_id=p_script_id and status='ready') then raise exception 'voice asset not ready';end if;
update public.radar_voice_assets set selected=false,updated_at=now() where script_id=p_script_id and selected=true;
update public.radar_voice_assets set selected=true,updated_at=now() where id=p_asset_id and script_id=p_script_id;
end $;
revoke all on function public.select_voice_asset(uuid,uuid) from public,anon,authenticated;
grant execute on function public.select_voice_asset(uuid,uuid) to service_role;

create or replace function public.select_voice_asset_if_none(p_script_id uuid,p_asset_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $
begin
perform pg_advisory_xact_lock(hashtext('voice-select:'||p_script_id::text));
if exists(select 1 from public.radar_voice_assets where script_id=p_script_id and selected=true and status='ready') then return false;end if;
update public.radar_voice_assets set selected=true,updated_at=now() where id=p_asset_id and script_id=p_script_id and status='ready';
return found;
end $;
revoke all on function public.select_voice_asset_if_none(uuid,uuid) from public,anon,authenticated;
grant execute on function public.select_voice_asset_if_none(uuid,uuid) to service_role;

create or replace function public.save_episode_script(p_script_id uuid,p_channel_id text,p_episode_id uuid,p_content_project_id uuid,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('episode-script:'||p_script_id::text));
if p_status not in ('draft','review','approved') then raise exception 'invalid episode script status';end if;
if not exists(select 1 from public.radar_managed_channels where id=p_channel_id) then raise exception 'managed channel not found';end if;
if not exists(select 1 from public.radar_content_projects where id=p_content_project_id and channel_id=p_channel_id and episode_id=p_episode_id and status='approved') then raise exception 'content project not approved';end if;
select version into current_version from public.radar_episode_scripts where id=p_script_id for update;
if current_version is null then
 if exists(select 1 from public.radar_episode_scripts where episode_id=p_episode_id) then raise exception 'episode already has script';end if;
 if exists(select 1 from public.radar_episode_scripts where content_project_id=p_content_project_id) then raise exception 'content project already has script';end if;
 if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'episode script version conflict';end if;
 insert into public.radar_episode_scripts(id,channel_id,episode_id,content_project_id,version,status,payload) values(p_script_id,p_channel_id,p_episode_id,p_content_project_id,1,p_status,p_payload);
 insert into public.radar_episode_script_versions(script_id,version,status,payload) values(p_script_id,1,p_status,p_payload);
 return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'episode script version conflict';end if;
next_version:=current_version+1;
update public.radar_episode_scripts set version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_script_id;
insert into public.radar_episode_script_versions(script_id,version,status,payload) values(p_script_id,next_version,p_status,p_payload);
return next_version;
end $;
revoke all on function public.save_episode_script(uuid,text,uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_episode_script(uuid,text,uuid,uuid,text,jsonb,int) to service_role;

create or replace function public.save_content_project(p_project_id uuid,p_channel_id text,p_episode_id uuid,p_opportunity_id text,p_status text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('content-project:'||p_project_id::text));
if p_status not in ('brief','research','review','approved','blocked') then raise exception 'invalid content project status';end if;
if not exists(select 1 from public.radar_managed_channels where id=p_channel_id) then raise exception 'managed channel not found';end if;
if not exists(select 1 from public.radar_episodes where id=p_episode_id and channel_id=p_channel_id) then raise exception 'episode does not belong to channel';end if;
select version into current_version from public.radar_content_projects where id=p_project_id for update;
if current_version is null then
 if exists(select 1 from public.radar_content_projects where episode_id=p_episode_id) then raise exception 'episode already has content project';end if;
 if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'content project version conflict';end if;
 insert into public.radar_content_projects(id,channel_id,episode_id,opportunity_id,version,status,payload) values(p_project_id,p_channel_id,p_episode_id,p_opportunity_id,1,p_status,p_payload);
 insert into public.radar_content_project_versions(project_id,version,status,payload) values(p_project_id,1,p_status,p_payload);
 return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'content project version conflict';end if;
next_version:=current_version+1;
update public.radar_content_projects set opportunity_id=p_opportunity_id,version=next_version,status=p_status,payload=p_payload,updated_at=now() where id=p_project_id;
insert into public.radar_content_project_versions(project_id,version,status,payload) values(p_project_id,next_version,p_status,p_payload);
return next_version;
end $;
revoke all on function public.save_content_project(uuid,text,uuid,text,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_content_project(uuid,text,uuid,text,text,jsonb,int) to service_role;

create or replace function public.save_production_dna(p_channel_id text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext('production-dna:'||p_channel_id));
if not exists(select 1 from public.radar_managed_channels where id=p_channel_id) then raise exception 'managed channel not found';end if;
select version into current_version from public.radar_production_dna where id=p_channel_id for update;
if current_version is null then
 if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'production dna version conflict';end if;
 insert into public.radar_production_dna(id,version,payload) values(p_channel_id,1,p_payload);
 insert into public.radar_production_dna_versions(channel_id,version,payload) values(p_channel_id,1,p_payload);
 return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'production dna version conflict';end if;
next_version:=current_version+1;
update public.radar_production_dna set version=next_version,payload=p_payload,updated_at=now() where id=p_channel_id;
insert into public.radar_production_dna_versions(channel_id,version,payload) values(p_channel_id,next_version,p_payload);
return next_version;
end $;
revoke all on function public.save_production_dna(text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_production_dna(text,jsonb,int) to service_role;

create or replace function public.save_channel_brain(p_channel_id text,p_payload jsonb,p_expected_version int default null) returns int
language plpgsql security invoker set search_path='' as $
declare current_version int; next_version int;
begin
perform pg_advisory_xact_lock(hashtext(p_channel_id));
if not exists(select 1 from public.radar_managed_channels where id=p_channel_id) then raise exception 'managed channel not found';end if;
select version into current_version from public.radar_channel_brains where id=p_channel_id for update;
if current_version is null then
 if p_expected_version is not null and p_expected_version not in (0,1) then raise exception 'channel brain version conflict';end if;
 insert into public.radar_channel_brains(id,version,payload) values(p_channel_id,1,p_payload);
 insert into public.radar_channel_brain_versions(channel_id,version,payload) values(p_channel_id,1,p_payload);
 return 1;
end if;
if p_expected_version is not null and p_expected_version<>current_version then raise exception 'channel brain version conflict';end if;
next_version:=current_version+1;
update public.radar_channel_brains set version=next_version,payload=p_payload,updated_at=now() where id=p_channel_id;
insert into public.radar_channel_brain_versions(channel_id,version,payload) values(p_channel_id,next_version,p_payload);
return next_version;
end $;
revoke all on function public.save_channel_brain(text,jsonb,int) from public,anon,authenticated;
grant execute on function public.save_channel_brain(text,jsonb,int) to service_role;
create or replace function public.claim_radar_job(job_key text,lease_token uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare claimed text;
begin
-- One global advisory transaction lock serializes claim decisions only.
perform pg_advisory_xact_lock(825014101);
if exists(select 1 from public.radar_jobs where status='running' and lease_until>now()) then return false;end if;
insert into public.radar_jobs(id,status,token,lease_until) values(job_key,'running',lease_token,now()+interval '15 minutes')
on conflict(id) do update set status='running',token=excluded.token,lease_until=excluded.lease_until,attempts=public.radar_jobs.attempts+1,updated_at=now()
where public.radar_jobs.status<>'completed' and public.radar_jobs.attempts<3 and (public.radar_jobs.status='failed' or public.radar_jobs.lease_until<now()) returning id into claimed;
return claimed is not null;
end $$;
create or replace function public.finish_radar_job(job_key text,lease_token uuid,success boolean) returns void language sql security invoker set search_path='' as $$ update public.radar_jobs set status=case when success then 'completed' else 'failed' end,lease_until=now(),updated_at=now() where id=job_key and token=lease_token; $$;
revoke all on function public.claim_radar_job(text,uuid) from public,anon,authenticated;
revoke all on function public.finish_radar_job(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_radar_job(text,uuid) to service_role;
grant execute on function public.finish_radar_job(text,uuid,boolean) to service_role;
create or replace function public.prune_radar_data(analytics_approved boolean) returns void language plpgsql security invoker set search_path='' as $$
begin
update public.radar_channels set payload=(payload-'analysis') || jsonb_build_object('status','watching') where (payload->'analysis'->>'createdAt')::timestamptz < now()-interval '30 days';
delete from public.radar_channels where updated_at < now()-interval '30 days';
delete from public.radar_analyses where updated_at < now()-interval '30 days';
delete from public.radar_scripts where updated_at < now()-interval '30 days';
delete from public.radar_snapshots where observed_at < now() - case when analytics_approved then interval '36 months' else interval '30 days' end;
end $$;
revoke all on function public.prune_radar_data(boolean) from public,anon,authenticated;
grant execute on function public.prune_radar_data(boolean) to service_role;
create table if not exists public.radar_login_attempts(id text primary key,attempts int not null,expires_at timestamptz not null);
alter table public.radar_login_attempts enable row level security;
revoke all on table public.radar_login_attempts from anon,authenticated;
grant all on table public.radar_login_attempts to service_role;
create or replace function public.radar_allow_login(attempt_key text) returns boolean language plpgsql security invoker set search_path='' as $$
declare total int;
begin
delete from public.radar_login_attempts where expires_at<now()-interval '1 day';
insert into public.radar_login_attempts(id,attempts,expires_at) values(attempt_key,1,now()+interval '15 minutes')
on conflict(id) do update set attempts=case when public.radar_login_attempts.expires_at<=now() then 1 else public.radar_login_attempts.attempts+1 end,expires_at=case when public.radar_login_attempts.expires_at<=now() then now()+interval '15 minutes' else public.radar_login_attempts.expires_at end returning attempts into total;
return total<=5;
end $$;
revoke all on function public.radar_allow_login(text) from public,anon,authenticated;
grant execute on function public.radar_allow_login(text) to service_role;

-- Supabase Vault is enabled by default on hosted projects. These narrow RPCs are
-- the only application path to decrypted values; browser roles receive no access.
create or replace function public.radar_get_secret(p_secret_name text) returns text
language plpgsql security definer set search_path='' as $$
begin
if p_secret_name not in ('openai_api_key','youtube_api_key','elevenlabs_api_key','google_ai_api_key','pexels_api_key','pixabay_api_key','unsplash_access_key','vecteezy_config','cloudflare_r2_config') then raise exception 'secret not allowed';end if;
return (select d.decrypted_secret from vault.decrypted_secrets d where d.name=p_secret_name limit 1);
end $$;

create or replace function public.radar_set_secret(p_secret_name text,p_secret_value text) returns void
language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
if p_secret_name not in ('openai_api_key','youtube_api_key','elevenlabs_api_key','google_ai_api_key','pexels_api_key','pixabay_api_key','unsplash_access_key','vecteezy_config','cloudflare_r2_config') or length(p_secret_value)<8 then raise exception 'secret not allowed';end if;
select d.id into secret_id from vault.decrypted_secrets d where d.name=p_secret_name limit 1;
if secret_id is null then
 perform vault.create_secret(p_secret_value,p_secret_name,'Caçadores de Nichos provider credential');
else
 perform vault.update_secret(secret_id,p_secret_value,p_secret_name,'Caçadores de Nichos provider credential');
end if;
end $$;

create or replace function public.radar_delete_secret(p_secret_name text) returns void
language plpgsql security definer set search_path='' as $$
begin
if p_secret_name not in ('openai_api_key','youtube_api_key','elevenlabs_api_key','google_ai_api_key','pexels_api_key','pixabay_api_key','unsplash_access_key','vecteezy_config','cloudflare_r2_config') then raise exception 'secret not allowed';end if;
delete from vault.secrets where name=p_secret_name;
end $$;

create or replace function public.radar_secret_status() returns table(secret_name text,last4 text,updated_at timestamptz)
language sql security definer set search_path='' as $$
select d.name::text, case when d.name in ('cloudflare_r2_config','vecteezy_config') then '' else right(d.decrypted_secret,4) end, d.updated_at from vault.decrypted_secrets d where d.name in ('openai_api_key','youtube_api_key','elevenlabs_api_key','google_ai_api_key','pexels_api_key','pixabay_api_key','unsplash_access_key','vecteezy_config','cloudflare_r2_config');
$$;

revoke all on function public.radar_get_secret(text) from public,anon,authenticated;
revoke all on function public.radar_set_secret(text,text) from public,anon,authenticated;
revoke all on function public.radar_delete_secret(text) from public,anon,authenticated;
revoke all on function public.radar_secret_status() from public,anon,authenticated;
grant execute on function public.radar_get_secret(text) to service_role;
grant execute on function public.radar_set_secret(text,text) to service_role;
grant execute on function public.radar_delete_secret(text) to service_role;
grant execute on function public.radar_secret_status() to service_role;
commit;


create or replace function public.claim_owned_media_analysis_job(p_worker_token uuid,p_lease_seconds int default 3600) returns uuid
language plpgsql security invoker set search_path='' as $$
declare picked uuid;
begin
if p_lease_seconds<300 or p_lease_seconds>7200 then raise exception 'invalid owned media analysis lease';end if;
update public.radar_owned_media_analysis_jobs
set status='queued',worker_token=null,lease_until=null,updated_at=now()
where status='processing' and lease_until is not null and lease_until<now();

select id into picked
from public.radar_owned_media_analysis_jobs
where status='queued' and available_at<=now()
order by available_at asc,created_at asc
for update skip locked
limit 1;

if picked is null then return null;end if;

update public.radar_owned_media_analysis_jobs
set status='processing',worker_token=p_worker_token,lease_until=now()+make_interval(secs=>p_lease_seconds),
attempts=attempts+1,last_error=null,updated_at=now()
where id=picked;

return picked;
end $$;
revoke all on function public.claim_owned_media_analysis_job(uuid,int) from public,anon,authenticated;
grant execute on function public.claim_owned_media_analysis_job(uuid,int) to service_role;


create or replace function public.claim_verified_stock_job(
  p_worker_token uuid,
  p_lease_seconds int default 1800
) returns uuid
language plpgsql security invoker set search_path='' as $
declare picked uuid;
begin
if p_lease_seconds<300 or p_lease_seconds>7200 then raise exception 'invalid verified stock lease';end if;
update public.radar_verified_stock_jobs
set status='queued',worker_token=null,lease_until=null,available_at=now(),updated_at=now()
where status='processing' and lease_until is not null and lease_until<now();

select id into picked
from public.radar_verified_stock_jobs
where status='queued' and available_at<=now()
order by available_at asc,created_at asc
for update skip locked
limit 1;

if picked is null then return null;end if;

update public.radar_verified_stock_jobs
set status='processing',worker_token=p_worker_token,
lease_until=now()+make_interval(secs=>p_lease_seconds),
attempts=attempts+1,last_error=null,updated_at=now()
where id=picked;

return picked;
end $;
revoke all on function public.claim_verified_stock_job(uuid,int) from public,anon,authenticated;
grant execute on function public.claim_verified_stock_job(uuid,int) to service_role;
