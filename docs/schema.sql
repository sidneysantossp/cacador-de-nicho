-- Setup reviewable for a dedicated Supabase project. Not executed automatically.
begin;
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
create table if not exists public.radar_universe_queue(id text primary key,input text not null unique,status text not null default 'pending' check(status in ('pending','processing','completed','failed')),attempts int not null default 0,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index if not exists radar_universe_queue_status_created on public.radar_universe_queue(status,created_at);
create table if not exists public.radar_snapshots(id bigint generated always as identity primary key,channel_id text not null,video_id text not null,views bigint not null check(views>=0),observed_at timestamptz not null);
create index if not exists radar_snapshots_observed on public.radar_snapshots(observed_at);
create table if not exists public.radar_jobs(id text primary key,status text not null check(status in ('running','completed','failed')),token uuid not null,lease_until timestamptz not null,attempts int not null default 1,updated_at timestamptz not null default now());
do $$ declare t text;begin foreach t in array array['radar_channels','radar_analyses','radar_decisions','radar_contexts','radar_scripts','radar_settings','radar_runs','radar_managed_channels','radar_channel_brains','radar_channel_brain_versions','radar_universe_queue','radar_snapshots','radar_jobs'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from anon, authenticated',t);execute format('grant all on table public.%I to service_role',t);end loop;end $$;
revoke all on sequence public.radar_snapshots_id_seq from anon, authenticated;
grant usage,select on sequence public.radar_snapshots_id_seq to service_role;
revoke all on sequence public.radar_channel_brain_versions_id_seq from anon,authenticated;
grant usage,select on sequence public.radar_channel_brain_versions_id_seq to service_role;

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
if p_secret_name not in ('openai_api_key','youtube_api_key') then raise exception 'secret not allowed';end if;
return (select d.decrypted_secret from vault.decrypted_secrets d where d.name=p_secret_name limit 1);
end $$;

create or replace function public.radar_set_secret(p_secret_name text,p_secret_value text) returns void
language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
if p_secret_name not in ('openai_api_key','youtube_api_key') or length(p_secret_value)<20 then raise exception 'secret not allowed';end if;
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
if p_secret_name not in ('openai_api_key','youtube_api_key') then raise exception 'secret not allowed';end if;
delete from vault.secrets where name=p_secret_name;
end $$;

create or replace function public.radar_secret_status() returns table(secret_name text,last4 text,updated_at timestamptz)
language sql security definer set search_path='' as $$
select d.name::text, right(d.decrypted_secret,4), d.updated_at from vault.decrypted_secrets d where d.name in ('openai_api_key','youtube_api_key');
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
