# Operationalization Roadmap — ChatGPT-operated Factory

**Status:** ACTIVE / P0  
**Owner:** Atlas / ChatGPT operator  
**Primary goal:** produce QA-approved master videos end-to-end with minimal operator infrastructure work.

## North Star

A production run is successful when an approved input can move through the canonical pipeline and return a QA-approved MP4 without manual Supabase/VPS/GitHub intervention.

Canonical path:

`Opportunity → Research → Script → Voice → Transcript → Scene Plan → Sources → Timeline → Video Edit → Render → Production QA → Master`

Publishing remains explicit.

## Rule

No new feature work unless it removes a real P0/P1 production blocker.

## Stage 1 — Golden Path / Production Runner

- arm an assisted run for ChatGPT-operated factory mode;
- automatically approve deterministic objective gates;
- automatically run Voice/Transcript/Scenes when inputs/config permit;
- keep research/script/visual prompt authoring operator-first;
- automatically run Visual Assets → Timeline → Video Edit → Render → QA;
- add bounded drain that advances multiple deterministic transitions in one call;
- stop only on async work, genuine operator input, hold/failure, budget or target master;
- keep publishing disabled.

**Done when:** one command can drain a prepared run to the next real dependency without repeated `advance/reconcile` calls.

## Stage 2 — Self-healing execution

- retry transient 429/5xx/timeouts;
- recover worker leases;
- recover after blue/green deploy/restart;
- provider circuit breakers;
- denylist rejected asset/segment candidates;
- only surface a blocker after available fallbacks are exhausted.

**Done when:** ordinary infrastructure/provider failures do not require manual DB repair.

## Stage 3 — Industrial Source Engine

- source reuse: one source video may serve multiple visual beats;
- global download/analysis cache;
- reuse embeddings and visual intelligence;
- select multiple non-repetitive temporal segments from one source;
- provider priority by channel policy;
- diversity/repetition gate;
- add authorized external-video/YouTube URL provider with provenance.

**Done when:** visual beats no longer imply one search/download/analysis each.

## Stage 4 — Microcut engine

- persist and use `sourceStartSeconds/sourceEndSeconds`;
- choose best semantic interval inside source media;
- avoid temporal reuse;
- intelligent crop/reframe;
- motion validation on the selected trim;
- limited speed adjustment when editorially safe.

**Done when:** long source videos can provide several distinct 3–5s usable clips automatically.

## Stage 5 — Cheap-first Visual QA

- FFmpeg technical/motion checks first;
- freeze/black/duplicate/perceptual checks;
- detect still/template disguised as video;
- AI vision only when needed;
- reject placeholder/filler before Timeline;
- automatic replacement after rejection.

**Done when:** bad visuals are caught before final render at low cost.

## Stage 6 — Automatic Timeline/Edit

- only QA-passed current assets;
- cadence and source diversity enforcement;
- captions/word timing;
- transitions/motion/SFX/music/ducking;
- localized rebuild when one scene changes.

**Done when:** changing one scene does not invalidate the whole episode.

## Stage 7 — Incremental Render + Final QA

- chapter/chunk rendering;
- reuse unchanged rendered chunks;
- retry failed chunks only;
- technical + editorial QA;
- contact sheet and repetition checks;
- stable persisted master URL.

**Done when:** a local edit does not require rerendering an entire long-form episode.

## Stage 8 — Cost Controller

- cost by provider/stage;
- expected final cost;
- hard/soft budget per episode/channel;
- free/cache/library before paid generation;
- premium video generation as exception.

## Factory acceptance tests

1. **Golden Path:** one input → one QA-approved MP4, no infrastructure intervention.
2. **Repeatability:** 3 different consecutive episodes, 3/3 PASS.
3. **Failure recovery:** provider outage, 502, timeout, worker restart and deploy do not stop the run permanently.
4. **Local correction:** replace one scene and rebuild only affected output.
5. **Scale:** 3 videos/day → 6 videos/day without proportional operator coordination.

## Current policy

The first acceptance milestone is **three consecutive finished videos with zero infrastructure intervention**. Until then, feature development is frozen unless it directly removes a production blocker.
