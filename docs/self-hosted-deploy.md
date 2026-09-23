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
