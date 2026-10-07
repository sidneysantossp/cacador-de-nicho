# Caçadores de Nichos — Production Operating System

**Canonical ID:** `factory-mode`  
**Version:** `1.1.0`  
**Status:** LOCKED / GLOBAL  
**Applies to:** every owned content project and every AI involved in discovery, research, scripting, production, QA, packaging, publishing or learning.

## 1. Purpose

Caçadores de Nichos is a production system, not a collection of isolated tools. The operating goal is to convert validated market opportunities into high-quality videos with the least possible active operator time.

The platform must optimize for:

- finished videos per day;
- active operator minutes per video;
- batch cycle time;
- percentage of stages completed without human intervention;
- cost per finished video;
- reuse of owned/licensed assets without visual repetition;
- number and cause of blockers.

Feature development is subordinate to production. Once a production path is operational, new platform features should be paused unless a real P0/P1 production blocker proves they are necessary.

## 2. Factory Mode — global rule

Production is **batch-first and exception-driven**.

The operator approves the batch or project objective once. After that, the system advances automatically through objective gates and only stops when a real exception requires human judgment.

Do not request repetitive approvals for steps that already have deterministic acceptance rules.

Default validation cadence:

- Batch 01: videos 01–05;
- Batch 02: videos 06–10;
- Batch 03: videos 11–15.

The batch size may change when duration, render cost or project constraints require it, but the default operating unit is five videos.

## 3. Start policy

Factory Mode does **not** mean uncontrolled clock-based autonomy.

A production batch starts only after an operator-approved project, opportunity or batch trigger. Once started, the batch may continue automatically inside the approved scope.

Schedulers must not invent projects, approve political/editorial decisions, publish to a new destination, or expand scope without an explicit rule or operator authorization.

## 4. Mandatory project bootstrap

Before any AI begins a new owned project it must load this operating system and use the current version.

A new project must then move through:

1. market signal / opportunity hypothesis;
2. Evidence Pack;
3. demand and gap validation;
4. repeatable mechanism validation;
5. 50-title sustainability test when the project is intended to scale;
6. initial validation portfolio, normally 15 videos;
7. Production DNA;
8. batch production.

Do not begin large-scale production before the project has enough evidence to justify the mechanism.

## 5. Production pipeline

For each episode the canonical path is:

1. opportunity / episode selection;
2. incremental research;
3. Claim Ledger;
4. ORIGINALITY / ANTI-SLOP GATE;
5. script;
6. narration / voice;
7. transcript + timestamps;
8. Scene Plan;
9. Asset Vault matching;
10. external/licensed stock matching when needed;
11. original AI asset generation only for unresolved visual needs;
12. rights/provenance + synthetic-media review;
13. timeline / edit;
14. render;
15. technical + editorial QA;
16. packaging;
17. publish or hold for operator publication;
18. performance + audience learning loop.

The system must reuse validated project research. Do not rebuild the full Evidence Pack for every episode. Each episode should research only the incremental claims required by its thesis.

## 5A. Global visual cadence rule

This rule is mandatory for **every channel, every episode and every visual media type**.

- Target visual beat duration: **3–4 seconds**.
- Hard ceiling: **no image, video clip, shot or visually unchanged composition may remain on screen for more than 4 seconds**.
- The rule applies equally to still images, AI-generated visuals, owned footage, licensed stock, archive footage and other video sources.
- If a narration span lasts longer than 4 seconds, split the visual treatment into additional beats or introduce a meaningful visual change before the 4-second ceiling.
- A meaningful visual change may be a new image/clip, a new shot, a materially different crop/reframe, a cut to a relevant detail, a comparison view or another editorially justified composition change.
- Do not stretch a still image or a single source clip merely to fill narration time.
- Transcript/timestamps remain the temporal source of truth, but the Scene Plan may create additional visual beats when required to satisfy this cadence.
- AutoEditor and final QA must flag any interval above 4 seconds as **BLOCKED** until corrected.
- This is a global production-quality and originality safeguard. It does **not** replace rights, originality, reused-content, spam, synthetic-media or Community Guidelines checks.

The objective is to keep the viewer experience active, reduce slideshow-like or low-effort presentation patterns, and make the editing language visibly intentional across both image-led and video-led channels.

## 5B. Mandatory Pre-Render Visual QA

Asset acceptance happens **before** final render and before expensive generation is scaled across an episode or batch.

- File/container type is not proof of editorial motion. An MP4 made from a still, template, slide, interface card or decorative animation remains **static** for motion-coverage purposes unless sampled frames and local motion analysis prove meaningful visual progression.
- Every selected scene asset must have a current Visual QA result before Timeline approval and render eligibility.
- Image review must evaluate semantic match, production quality, editorial usefulness, placeholder/template risk and visual class.
- Video review must sample multiple temporal frames and combine semantic review with a local motion/freeze measurement. Decorative zooms, line movement, text reveals or small UI animation must not satisfy a motion-first requirement by themselves.
- Placeholder-like, weakly relevant, low-quality or low-usefulness assets are rejected before they can become selected Timeline media.
- The episode-level preflight must also detect visual monoculture: excessive static graphics, repeated template classes, repeated shot types or routing concentration incompatible with the channel Production DNA.
- Scene Plan approval must reject pathological sourcing strategies before asset spend, including generated/static monoculture in a channel whose DNA explicitly prefers motion.
- Expensive AI video generation must run in bounded batches. Validate a small batch first, then scale only after the same visual decision passes the QA gate. Do not generate hundreds of costly clips before validating the visual mechanism.
- The final Render Engine is a defense-in-depth gate and must refuse an internal render whenever required Visual QA is missing or failed.

The goal is to move visual failure detection to the cheapest possible stage: plan first, asset second, proxy/timeline third, final render last.

## 6. Parallel production

Never treat the batch as five sequential projects.

While one episode is rendering, others should be scripting, generating voice, building scenes, matching assets or undergoing QA.

The production scheduler should maximize useful parallel work while respecting infrastructure, provider and render limits.

Batch completion time is more important than the isolated duration of a single stage.

## 7. Asset sourcing order

Before generating new media, search the existing Asset Vault semantically.

Default order:

1. owned Asset Vault;
2. owned previously generated reusable elements;
3. archive/open media with usable rights;
4. licensed stock;
5. original AI-generated media.

Use the best matching temporal segment from a video asset instead of placing the whole source video on the timeline.

Do not create new assets merely because generation is easy. Generate only what the episode still needs.

## 8. ORIGINALITY / ANTI-SLOP GATE

Every episode must answer all five questions:

1. What did we actually discover?
2. What is our defensible thesis?
3. What does this add beyond existing videos?
4. What part would be difficult to copy tomorrow?
5. What evidence/source plan will verify the episode?

The current deterministic acceptance target is **100/100**.

A title variation, thumbnail variation, AI visual style or cheap production method does not count as original value.

Preferred moats include:

- original research synthesis;
- primary sources and Claim Ledger;
- controlled experiments;
- self-captured gameplay/data;
- proprietary measurements or datasets;
- accumulated Channel Brain memory;
- repeatable editorial frameworks;
- evidence connections competitors have not assembled.

## 9. Evidence and truth rules

Research is part of the product.

Separate:

- confirmed facts;
- attributed claims;
- estimates;
- hypotheses/inference;
- speculation;
- unsupported or excluded claims.

Documentary/evidence-led projects require a Claim Ledger before the script can be approved.

Do not invent facts, sources, quotations, audience reactions, performance causes or prior events.

If evidence is insufficient, qualify, attribute, exclude or block the claim.

## 10. Rights and reused-content rules

Reused-content review and copyright/licensing review are separate gates.

Borrowed footage is evidence, not filler.

No project may rely on:

- leaked/pre-release material that is not authorized;
- watermark removal or source concealment;
- minimally transformed compilations;
- copied scripts/thumbnails;
- AI footage presented as genuine official footage;
- assets with unresolved rights when they are required for final render.

## 11. State model

At batch level and episode level, use operational states that answer three questions:

- **READY** — can advance automatically;
- **PROCESSING** — work is actively running or queued;
- **BLOCKED** — cannot proceed without a specific missing dependency or judgment.

Use **REVIEW** only when a human judgment is genuinely required.

Every BLOCKED state must state:

- exact blocker;
- stage;
- affected episode(s);
- evidence/log that triggered it;
- smallest action required to unblock it.

## 12. Operator interaction policy

The operator should manage exceptions, not micromanage deterministic steps.

Do not stop with “what should I do next?” when the next action is already defined by this document and the approved project state.

Continue until:

- an objective blocker is found;
- a required creative/editorial decision is genuinely ambiguous;
- a permission/payment/credential action is required;
- publishing scope requires explicit approval;
- the approved batch is complete.

## 13. Throughput targets

Operational progression:

- first stable target: **5 finished videos/day**;
- next target: **7 finished videos/day**;
- scaled target: **12 finished videos/day**, using parallelism and multiple render nodes when required.

These are throughput goals, not permission to lower quality gates.

Primary KPI: **active operator minutes per finished video**.

The platform is failing its automation goal if a theoretically automatic episode still requires hours of operator coordination.

## 14. Learning loop

After publication, the system should use real performance and audience evidence to update:

- Channel Brain;
- do-not-repeat rules;
- title/thumbnail hypotheses;
- pacing/retention hypotheses;
- content pillars;
- next episode strategy.

Do not infer causality from one video. Treat early performance as evidence with uncertainty.

## 15. AI behavior

Every AI working on Caçadores de Nichos must:

- treat this document as a higher-level production operating contract;
- load it before starting a new owned project;
- preserve project-specific Channel Brain and Production DNA beneath the global rules;
- use objective gates automatically;
- avoid unnecessary conversational checkpoints;
- prefer batch progress over single-video sequential work;
- return exceptions with actionable blockers;
- never relax factual, rights, originality or quality gates just to increase throughput.

Project-specific rules may add constraints. They may not silently remove these global rules. Any explicit operator override must be recorded.

## 16. Agent identity and Factory Control

Every production AI must operate under a stable agent identity and follow `docs/AGENT_OPERATIONS.md`. Episode ownership, contributor roles, current production stage, progress, blockers and post-publication performance must be attributable in Factory Control. Infrastructure work without a named creative owner uses the `factory-system` identity rather than being falsely credited to another agent.
