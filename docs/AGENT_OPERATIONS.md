# Caçadores de Nichos — Agent Operations & Attribution

**Canonical status:** GLOBAL / MANDATORY  
**Applies to:** every AI, autonomous worker or human-assisted agent that contributes to owned content production.

## 1. Why attribution exists

The platform must be able to answer, at any moment:

- which agent owns each video;
- what that agent is doing now;
- which channel and video are affected;
- current stage, status and progress;
- what is blocked and why;
- which agent/process produced the strongest repeatable results after publication.

Attribution is operational telemetry. It must not become a vanity score or a reason to overfit to one viral video.

## 2. Stable agent identity

Every production agent needs:

- stable `agent_id`;
- human-friendly `display_name`;
- unique `@signature`;
- provider/model when relevant;
- production role;
- active / paused / retired state.

The primary ChatGPT orchestrator currently uses `atlas` / **Atlas** / `@atlas`. The display name and signature are renameable without deleting historical attribution.
## 3. Ownership and contribution rules

Every owned episode must have exactly one primary `owner` agent.

Additional agents may be attributed as:

- research;
- script;
- visual;
- production;
- QA;
- packaging;
- review.

One agent can contribute multiple roles. Do not silently overwrite another agent's ownership. A deliberate handoff must preserve the prior contribution history and record the new owner.

Infrastructure-only work that has no named creative owner is attributed to `factory-system` / `@factory`, never falsely to a human-facing agent.

## 4. Mandatory operation telemetry

When an agent accepts work, changes stage, becomes blocked, hands off, or completes work, Factory Control must be able to expose:

- agent identity and signature;
- channel;
- video / episode;
- batch when applicable;
- production stage;
- operational status;
- progress percentage;
- blocker;
- last update time.

Operational statuses are:

- `READY`;
- `PROCESSING`;
- `BLOCKED`;
- `REVIEW`;
- `COMPLETED`;
- `FAILED`.

Progress is an operational estimate tied to completed production stages, not a fabricated forecast of remaining wall-clock time.

## 5. Performance attribution

Performance must be attached to the episode owner and preserved with contributor metadata.
Compare agents using observable metrics, comparable publication windows and sample size. Keep views, CTR, retention/APV, RPM, revenue, cycle time and operator time separate rather than creating one opaque score.

## 6. Learning from stronger agents

When one agent repeatedly produces stronger results, create a Formula Snapshot covering thesis selection, evidence depth, hook structure, packaging mechanism, pacing, visual sourcing, scene cadence, narration, production time and audience signals. Reuse the mechanism and learning, not the original wording or assets.

## 7. Cross-agent experiments

Preserve Production DNA where possible, record changed variables, compare similar publication windows and prefer repeated evidence over a single outcome. Validated mechanisms should become versioned learnings available to other agents.

## 8. Required AI bootstrap

Before beginning a new owned project or accepting production work, every agent must load `AI_START_HERE.md`, `docs/PRODUCTION_OPERATING_SYSTEM.md`, this document, the current Channel Brain, Production DNA and active project/episode state. The agent must have a stable identity before claiming episode ownership.

## 9. Source of truth

- agent registry: `radar_agents`;
- explicit operations: `radar_agent_operations`;
- episode ownership and contributors: `radar_episode_agent_attributions`;
- live Factory Control snapshot: `radar_contexts.id = factory-control:live`.

Factory Control may derive stage and progress from canonical production artifacts and workers. Attribution and performance must remain auditable rather than inferred from chat history.
