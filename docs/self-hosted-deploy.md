# Self-hosted deployment pilot

The Caçadores de Nichos application is being validated on the AuditSEO VPS as a parallel deployment target while Vercel remains intact.

## Deployment contract

- GitHub remains the source of truth.
- Every release is identified by an exact Git commit SHA.
- Docker images are immutable and tagged by short SHA.
- Preview is deployed before promotion.
- Promotion requires:
  - typecheck PASS
  - test suite PASS
  - Next.js production build PASS
  - application health PASS
  - live Supabase connectivity PASS
- Production uses blue/green ports so the candidate is healthy before Nginx changes traffic.
- The previous production container remains available for instant rollback.
- Garbage collection keeps only Preview, Production and Previous Production images.
- Persistent data volumes are never removed automatically.

## Pilot endpoints

Temporary sslip.io hostnames are used only during infrastructure validation. They are not the final production domains.

## Secrets

Runtime secrets live only on the VPS environment files and Supabase Vault. They must never be committed to Git.


## Automatic production watch

The VPS watches the GitHub `master` branch on a short interval. A new commit is built and tested as a candidate. Production traffic changes only after the candidate passes the application health gate and live Supabase connectivity check. Failed candidates leave the current production release untouched.


## Universe scheduler

The operational Universe scheduler lives on the AuditSEO VPS, not on Vercel.

The scheduler is split into two independent phases so a slow or malformed AI response cannot make DNA progress and Market recomputation fail as one monolithic job.

- DNA service: `cacadores-universe-batch.service`
- DNA timer: `cacadores-universe-cycle.timer`
- DNA cadence: daily at 12:00 UTC (09:00 America/Sao_Paulo)
- Market service: `cacadores-market-intelligence.service`
- Market timer: `cacadores-market-intelligence.timer`
- Market cadence: daily at 12:08 UTC (09:08 America/Sao_Paulo)
- execution path: loopback to the currently promoted production port
- authentication: `CRON_SECRET` is loaded from the VPS production environment and is never passed in the process command line
- the Vercel project does not define a Universe cron

The 12:00 phase executes queue processing plus bounded Channel DNA bootstrap only. Individual DNA batch failures are isolated and reported instead of aborting all already-persisted work. The 12:08 phase recomputes Curves/Gaps independently from the newest persisted DNAs. The previous production container remains available for rollback independently of both schedulers.


## Versioned runtime guards

The exact watchdog, Universe wrappers and critical systemd units used by the VPS are versioned under `ops/self-hosted/`.

The production health watchdog always verifies that `cacadores-auto-deploy.timer` remains enabled and active. Universe and Market timers are self-healed only when the runtime operation mode is not `assisted-manual`. In assisted-manual mode, editorial AI, render, publication and learning workers stay stopped until the operator explicitly asks ChatGPT to run the corresponding operation.


## Runtime sync

The source-of-truth wrappers and systemd units live under `ops/self-hosted/`. Production promotion must synchronize those files to `/srv/auditseo-deploy/bin` and `/etc/systemd/system`, run `systemctl daemon-reload`, and preserve the runtime operation mode. Infrastructure timers remain enabled; editorial/productive timers may remain deliberately disabled in `assisted-manual` mode. This prevents deployment from silently restoring autonomous work.


## Assisted-manual operation mode — 24/09/2026

The current production operating model is `assisted-manual`.

- OpenAI, YouTube and other provider integrations remain configured and available.
- No editorial AI scheduler runs autonomously.
- No production, render, learning-loop or YouTube-publish worker remains continuously active.
- `cacadores-universe-cycle.timer` and `cacadores-market-intelligence.timer` stay disabled.
- worker-sync timers for episode automation, closed loop, render and YouTube publishing stay disabled.
- health-watch, auto-deploy and maintenance remain automatic because they protect infrastructure rather than make editorial decisions.
- ChatGPT is the operational assistant: the human operator explicitly requests a morning, afternoon or evening run; ChatGPT inspects current state, starts only the required process, validates the result, persists approved machine output and reports back for human decision.
- Automatic API fallback must never be enabled merely because the assisted workflow is unavailable.
