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

`cacadores-owned-visual-worker-sync.timer` keeps the isolated OWNED Visual Intelligence worker on the promoted image.

`cacadores-verified-stock-worker-sync.timer` keeps the isolated verified-stock resolver on the promoted image. It processes stock gaps asynchronously so the dashboard and Episode Automation do not need to stay connected while external search, download and frame validation run.

## Secret handling

The Universe and Market wrappers source `CRON_SECRET` from the production environment and call the currently promoted port over loopback. The secret is never embedded in these repository files and is not placed in the process command line.

## Install / reconcile

Copy the files under `bin/` to `/srv/auditseo-deploy/bin/` with mode `0750`, and the files under `systemd/` to `/etc/systemd/system/` with mode `0644`. Then run `systemctl daemon-reload` and enable the timers required by the environment.

After reconciliation, verify the promoted application health, `systemctl list-timers`, and the next Universe execution time before considering the host healthy.
