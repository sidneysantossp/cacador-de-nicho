# Self-hosted YouTube Publish Worker

This worker closes the infrastructure path from an approved Publication Package to a resumable YouTube upload on the VPS.

## Safety model

- The worker is installed with production deployments but its sync timer stays disabled while the operation mode is `assisted-manual`.
- No video is published merely because the worker exists. It only claims rows already queued in `radar_youtube_publish_jobs`.
- A Publication Package must already be approved and explicitly enqueued by the operator.
- OAuth refresh tokens remain encrypted in Supabase and are never written to this runbook or returned to the browser.

## Required production environment

The production env file must contain:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `YOUTUBE_OAUTH_CLIENT_ID`
- `YOUTUBE_OAUTH_CLIENT_SECRET`
- `YOUTUBE_OAUTH_REDIRECT_URI`
- `YOUTUBE_TOKEN_ENCRYPTION_KEY` with at least 32 characters

The worker itself requires all except the redirect URI. The web OAuth flow requires the redirect URI as well.

If worker credentials are incomplete, the sync wrapper exits safely without starting a container and writes a blocked state to:

`/srv/auditseo-deploy/state/cacador-de-nicho-youtube-publish-worker.json`

## Manual activation in assisted-manual mode

After OAuth is configured and one channel is connected, start the synchronizer deliberately:

`systemctl start cacadores-youtube-publish-worker-sync.service`

The created container is:

`cacador-de-nicho-youtube-publish-worker`

It uses the exact production image/SHA, 1 GB RAM, 0.5 CPU, and a dedicated `/tmp` work volume.

Do not enable the timer until autonomous publishing is intentionally approved. For the first real test, keep the Publication Package visibility `private`.


## OAuth scope separation

The publishing connection intentionally requests only:
- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.readonly`

YouTube Analytics scopes are not part of the publishing consent. Analytics must use a separate, explicit authorization step if/when that product capability is approved and enabled.
