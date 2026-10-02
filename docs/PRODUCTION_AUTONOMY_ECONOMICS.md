# Autonomous Production Economics

`Production Autonomy Fit` is a post-market gate. The Market decides whether a curve or opportunity is worth investigating or piloting; this gate compares only market-valid opportunities by the cost and repeatability of manufacturing them autonomously.

The evaluator runs a Supply Preflight after Market validation. It simulates at least ten distinct episode titles, expands each visual sequence to the global four-second ceiling, checks the Asset Vault first, then records permitted provider search evidence. Each beat is classified as `owned-ready`, `stock-ready`, `stock-discoverable`, `generation-required` or `unresolved`. A search result is never ready supply: a ready asset needs a stable source identity, a storage path, provenance, a verified license, and a match whose relevance and exact identity satisfy the beat. The preflight records representative beats, materialized assets and discoverable candidates; measured economics are used when present in asset evidence, and unknown economics remain unknown.

The assessment records separate `readySupplyCoverage`, `discoverableSupplyCoverage` and explicitly projected `projectedAutonomousCoverage`. It also records duration-weighted coverage for owned media, stock, generation and unresolved beats, title-level coverage, reusable source count, rights, factuality, cost, cycle time, operator minutes, repeatability at 15/50/100 episodes, evidence confidence and the status of every production stage. Unknown provider, rights, factuality, economics or repeatability evidence is preserved as a blocker. It never becomes zero cost, zero time or automatic approval.

Statuses are:

- `not-eligible`: the Market has not supplied validated evidence;
- `blocked`: the opportunity may be valid, but an objective dependency is unverified;
- `rejected`: a measured limit fails the autonomy policy;
- `approved`: every pilot gate is supported by evidence.

The persisted `supplyStatus` gives the supply state without replacing the legacy gate status: `market-valid-but-supply-unproven`, `supply-discoverable`, `supply-verified` or `autonomy-approved` (with `market-not-eligible` for an invalid Market input). A discoverable result without sufficient licensing or provenance remains discoverable or unresolved and cannot be allocated as ready.

Assessments are stored in `radar_production_autonomy_assessments` with a seven-day expiry and jobs in `radar_production_autonomy_jobs`. The API accepts only a subject identity (`universe-gap`, `opportunity-report` or `next-episode` plus an optional candidate ID); it does not accept client-supplied scores or market validation. Pilot approval, Content OS handoff and Next Episode acceptance revalidate the stored assessment on the server.

Opportunity and Next Episode flows enqueue jobs. `scripts/production-autonomy-worker.mjs` polls the authenticated `/api/workers/production-autonomy` route, which claims work with a lease and persists the assessment. The operator panel can also run one evaluation immediately for a reviewable decision; both paths use the same deterministic evaluator.

The database additions are part of `docs/schema.sql`; apply the schema before enabling the live endpoint. Until then, ordinary Market and editorial reads continue to work, while the autonomy gate remains unavailable and fail-closed.

On self-hosted promotion, the deploy wrapper provisions the stable worker URL and polling interval in the protected production environment file and generates the secret locally when it is absent. The promotion never prints that value. The service remains manually controlled during calibration; no timer is installed for this worker. TERM is forwarded to the worker and its active request so a manual `systemctl stop` can finish without relying on a forced container kill.
