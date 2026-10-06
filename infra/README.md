# Self-hosted data plane

The production path is moving from hosted Supabase to PostgreSQL owned by the Caçadores VPS.

## Components

- `cacadores-postgres`: PostgreSQL 17 with pgvector, persistent data under the VPS.
- `cacadores-postgrest`: PostgREST 16.3, exposing the existing database contract so the application can keep using `@supabase/supabase-js` without depending on Supabase Cloud.
- `cacadores-infra`: private Docker network shared by the database, PostgREST and application containers.
- `bootstrap-local-db.sh`: transforms the canonical schema into a stock-PostgreSQL variant and applies it.

## Secrets

Runtime secrets live outside Git under `/srv/auditseo-deploy/secrets/` and the production environment file. Never commit them.

`PROVIDER_SECRETS_KEY` encrypts provider credentials before they are stored in `radar_provider_secrets`.

## Migration rule

The legacy Supabase project remains the migration source until database data and provider credentials have been verified in the local database. Production is not cut over merely because the local database is healthy.

## Storage

R2 is currently a transitional object-storage provider. New objects are isolated under the `cacadores/` prefix. A local/self-hosted storage backend will replace this dependency after the database cutover is stable.
