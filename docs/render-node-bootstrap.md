# Portable Render Node Bootstrap

This runbook adds a render-only VPS to the shared Caçadores de Nichos render queue. It does **not** run Next.js, Episode Automation, stock workers, or YouTube publishing.

## Host prerequisites

- Linux with Docker and Git
- Recommended baseline: 4 GB+ host RAM, 2+ vCPU, 20 GB+ free disk on the render work volume
- Outbound HTTPS access to GitHub, Supabase, and Cloudflare R2
- A root-readable environment file containing only:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

R2 credentials are not copied to the node. The render worker reads the R2 configuration from the existing Supabase Vault using the service-role RPC.

## Build an exact Git SHA on the render node

Create `/etc/cacadores/render-worker.env` outside the repository, then run:

```bash
sudo CACADORES_RENDER_REF=<exact-git-sha> \
  CACADORES_RENDER_WORKER_ID=render-02 \
  bash ops/self-hosted/bin/cacadores-render-node-bootstrap
```

The bootstrap fetches that ref, resolves it to a commit SHA, builds the existing project Dockerfile, and starts only `scripts/render-worker.mjs`.

## Use a prebuilt image

If an image registry is available:

```bash
sudo CACADORES_RENDER_IMAGE=<registry/image:tag> \
  CACADORES_RENDER_SHA=<exact-git-sha> \
  CACADORES_RENDER_WORKER_ID=render-02 \
  bash ops/self-hosted/bin/cacadores-render-node-bootstrap
```

The SHA is mandatory with a prebuilt image so the worker registry always exposes which code is running.

## Resource overrides

Defaults are intentionally conservative:

- worker memory: 2 GB
- worker CPU quota: 1.5 CPU
- worker scratch reserve: 10 GB
- host preflight: 4 GB RAM, 2 CPUs, 20 GB free disk

Override with `CACADORES_RENDER_MEMORY_BYTES`, `CACADORES_RENDER_CPUS`,
`CACADORES_RENDER_NANO_CPUS`, `RENDER_MIN_FREE_DISK_GB`, or the
`CACADORES_RENDER_HOST_MIN_*` variables.

Do not run multiple render workers on the same 6 GB VPS merely to increase the node count. The fleet model assumes independent usable compute capacity.

## Validation

After startup, the node heartbeats into `radar_render_workers`. It should appear in **Render Engine → Render Nodes** with the configured worker ID, SHA, memory, CPU and free disk.

The shared queue already uses database claiming with `SKIP LOCKED`, so multiple render nodes can safely consume different jobs. Render-v4 chapter cache remains shared through R2.
