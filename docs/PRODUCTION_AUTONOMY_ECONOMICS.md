# Autonomous Production Economics

`Production Autonomy Fit` is a post-market gate. The Market decides whether a curve or opportunity is worth investigating or piloting; this gate compares only market-valid opportunities by the cost and repeatability of manufacturing them autonomously.

The evaluator simulates at least ten distinct episode titles and expands each visual sequence to the global four-second ceiling. Each beat is allocated against ready, available evidence from the owned Asset Vault or acquired stock. A search result is not supply: an asset needs a stable source identity, a ready storage path, provenance, a verified license, and a match whose relevance and exact identity satisfy the beat.

The assessment records duration-weighted coverage for owned media, stock, generation and unresolved beats, title-level coverage, reusable source count, rights, factuality, cost, cycle time, operator minutes, repeatability at 15/50/100 episodes, and the status of every production stage. Unknown provider, rights, factuality, economics or repeatability evidence is preserved as a blocker. It never becomes zero cost, zero time or automatic approval.

Statuses are:

- `not-eligible`: the Market has not supplied validated evidence;
- `blocked`: the opportunity may be valid, but an objective dependency is unverified;
- `rejected`: a measured limit fails the autonomy policy;
- `approved`: every pilot gate is supported by evidence.

Assessments are stored in `radar_production_autonomy_assessments` with a seven-day expiry and jobs in `radar_production_autonomy_jobs`. The API accepts only a subject identity (`universe-gap`, `opportunity-report` or `next-episode` plus an optional candidate ID); it does not accept client-supplied scores or market validation. Pilot approval, Content OS handoff and Next Episode acceptance revalidate the stored assessment on the server.

Opportunity and Next Episode flows enqueue jobs. `scripts/production-autonomy-worker.mjs` polls the authenticated `/api/workers/production-autonomy` route, which claims work with a lease and persists the assessment. The operator panel can also run one evaluation immediately for a reviewable decision; both paths use the same deterministic evaluator.

The database additions are part of `docs/schema.sql`; apply the schema before enabling the live endpoint. Until then, ordinary Market and editorial reads continue to work, while the autonomy gate remains unavailable and fail-closed.

On self-hosted promotion, the deploy wrapper provisions the stable worker URL and polling interval in the protected production environment file and generates the secret locally when it is absent. The promotion never prints that value. The service remains manually controlled during calibration; no timer is installed for this worker.
