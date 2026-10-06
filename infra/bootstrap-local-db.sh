#!/usr/bin/env bash
set -euo pipefail
BASE=/srv/auditseo-deploy/projects/cacador-de-nicho/migration
SECRETS=/srv/auditseo-deploy/secrets/cacador-local-db.env
SOURCE_SCHEMA="$BASE/docs/schema.sql"
SELFHOST_SCHEMA="$(mktemp /tmp/cacadores-schema.XXXXXX.sql)"
trap 'rm -f "$SELFHOST_SCHEMA"' EXIT
set -a
source "$SECRETS"
set +a

python3 - "$SOURCE_SCHEMA" "$SELFHOST_SCHEMA" <<'PY'
from pathlib import Path
import re,sys
source=Path(sys.argv[1]).read_text()
s=source
s=s.replace('begin;\ncreate extension if not exists vector with schema extensions;', 'begin;\ncreate schema if not exists extensions;\ncreate extension if not exists vector with schema extensions;', 1)
needle='create table if not exists public.radar_settings(like public.radar_channels including all);'
provider="""\ncreate table if not exists public.radar_provider_secrets(provider text primary key,ciphertext text not null,updated_at timestamptz not null default now());\nalter table public.radar_provider_secrets enable row level security;\nrevoke all on table public.radar_provider_secrets from public,anon,authenticated;\ngrant all on table public.radar_provider_secrets to service_role;"""
if 'radar_provider_secrets' not in s:s=s.replace(needle,needle+provider,1)
storage="""insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cacadores-media','cacadores-media',false,524288000,array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/m4a','audio/ogg','audio/flac','audio/webm','image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

"""
s=s.replace(storage,'',1)
vault_start=s.find('-- Supabase Vault is enabled by default on hosted projects.')
claim=s.find('create or replace function public.claim_owned_media_analysis_job')
if vault_start!=-1 and claim!=-1:
    s=s[:vault_start]+'-- Provider credentials are stored in radar_provider_secrets by the application layer on self-hosted deployments.\n\n'+s[claim:]
s=re.sub(r'as \$(?!\$)', 'as $$', s)
s=re.sub(r'end \$(?!\$);', 'end $$;', s)
s=re.sub(r'(?m)^\$;$', '$$;', s)
claim=s.find('create or replace function public.claim_owned_media_analysis_job')
if 'grant usage on schema extensions to service_role;\ncommit;' not in s and claim!=-1:
    s=s[:claim]+'grant usage on schema extensions to service_role;\ncommit;\n\n'+s[claim:]
s += "\n\n-- Self-hosted privilege safety net.\ngrant usage on schema public to service_role;\ngrant select,insert,update,delete on all tables in schema public to service_role;\ngrant usage,select on all sequences in schema public to service_role;\ngrant execute on all functions in schema public to service_role;\n"
Path(sys.argv[2]).write_text(s)
PY

psql=(docker exec -i cacadores-postgres psql -v ON_ERROR_STOP=1 -U postgres -d cacadores)
"${psql[@]}" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD '${AUTHENTICATOR_PASSWORD}';
  ELSE ALTER ROLE authenticator NOINHERIT LOGIN PASSWORD '${AUTHENTICATOR_PASSWORD}'; END IF;
END
\$\$;
ALTER ROLE service_role BYPASSRLS;
GRANT anon TO authenticator;
GRANT service_role TO authenticator;
GRANT CONNECT ON DATABASE cacadores TO authenticator,anon,service_role;
SQL
cat "$SELFHOST_SCHEMA" | "${psql[@]}"
"${psql[@]}" <<'SQL'
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
GRANT USAGE ON SCHEMA public,extensions TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
SQL
echo "self-hosted PostgreSQL schema ready"