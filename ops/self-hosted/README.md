# Self-hosted runtime guards

These files mirror the production scheduler/watchdog artifacts installed on the AuditSEO VPS for Caçadores de Nichos.

## Runtime paths

- Application deploy state: `/srv/auditseo-deploy/state/cacador-de-nicho.json`
- Production env: `/srv/auditseo-deploy/env/cacador-de-nicho.production.env`
- Runtime scripts: `/srv/auditseo-deploy/bin/`
- systemd units: `/etc/systemd/system/`

## Critical timers

`cacadores-auto-deploy.timer` checks GitHub `master` on a short interval and triggers the blue/green deployment service.

`cacadores-universe-cycle.timer` runs the bounded Universe cycle daily at 12:00 UTC (09:00 America/Sao_Paulo). It is intentionally non-persistent so re-enabling it after the daily slot does not trigger an unexpected heavy catch-up run.

`cacadores-health-watch.timer` checks production every two minutes. The watchdog validates the public and loopback health endpoints against the promoted commit, performs rollback after repeated health failures when the previous release is healthy, and restores critical timers when needed.

`cacadores-episode-automation-worker-sync.timer` keeps the lightweight Episode Automation coordinator on the promoted image. It claims autonomous runs and advances one production transition at a time while heavy media work stays delegated to specialized workers.

`cacadores-owned-visual-worker-sync.timer` keeps the isolated OWNED Visual Intelligence worker on the promoted image.

`cacadores-verified-stock-worker-sync.timer` keeps the isolated verified-stock resolver on the promoted image.

`cacadores-render-worker-sync.timer` keeps the ffmpeg Render Worker on the promoted image. It is resource-bounded independently from the web app and media-analysis workers. It processes stock gaps asynchronously so the dashboard and Episode Automation do not need to stay connected while external search, download and frame validation run.

`cacadores-production-autonomy-worker-sync.service` is a manually controlled, long-running Production Autonomy evaluator. It is intentionally not enabled and has no timer in the calibration phase. Start it explicitly only after the idle, claim, persistence and fail-closed checks pass; stopping the unit removes its worker container.

## Secret handling

The Universe and Market wrappers source `CRON_SECRET` from the production environment and call the currently promoted port over loopback. The secret is never embedded in these repository files and is not placed in the process command line.

`AGENT_OPERATOR_SECRET` is a separate 32+ character server-only credential for machine/operator access. It does not replace `APP_PASSWORD`: browser users keep the normal session + same-origin flow. The application accepts the agent credential only on an explicit allowlist of operational APIs and writes an `agent-operator-api` event to application logs for each write.

`cacadores-agent-api` is the supported host-side client. It reads the secret from the protected production env, resolves the currently promoted loopback port, and sends the credential in `x-cacadores-agent-secret`. The secret is never passed on the command line or printed. Example:

```bash
printf '%s' '{"action":"reconcile","runId":"<uuid>"}' |
  /srv/auditseo-deploy/bin/cacadores-agent-api POST /api/episode-automation
```

Sensitive control-plane endpoints such as `/api/auth`, `/api/provider-settings`, `/api/autopilot-control`, and the interactive OAuth flow are intentionally outside the agent allowlist.

## Install / reconcile

Copy the files under `bin/` to `/srv/auditseo-deploy/bin/` with mode `0750`, and the files under `systemd/` to `/etc/systemd/system/` with mode `0644`. Then run `systemctl daemon-reload` and enable the timers required by the environment.

After reconciliation, verify the promoted application health, `systemctl list-timers`, and the next Universe execution time before considering the host healthy.

The Production Autonomy worker reads `PRODUCTION_AUTONOMY_WORKER_SECRET`, `PRODUCTION_AUTONOMY_WORKER_URL` and `PRODUCTION_AUTONOMY_WORKER_POLL_MS` from `/srv/auditseo-deploy/env/cacador-de-nicho.production.env`. The secret is never stored in Git, the image, browser code or log payloads.
