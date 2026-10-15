# MoneyPrinterTurbo Execution Audit

Status: architecture audit only. No production runtime changes are authorized by this document.

Audited upstream:
- Repository: `harry0703/MoneyPrinterTurbo`
- Branch: `main`
- Commit: `b819f7e1213ca2bc444cbf53ad3e0e3080c8a866`
- License: MIT
- Official Colab notebook: `docs/MoneyPrinterTurbo.ipynb`

## 1. Executive finding

MoneyPrinterTurbo does not use a special Colab-only video engine. The official Colab notebook clones the normal repository into `/content/MoneyPrinterTurbo`, installs Python 3.11 and dependencies with `uv`, starts the regular Streamlit WebUI and exposes it through ngrok.

Its practical advantage over the current Caçadores audiovisual path is therefore twofold:

1. heavy media work runs on an ephemeral machine outside the shared VPS;
2. its standard video pipeline is much coarser and shorter.

The current Caçadores visual pipeline persists and validates work at scene/microbeat level. MoneyPrinterTurbo usually works from a small ordered set of search terms, downloads enough footage to cover narration duration, cuts the footage into short clips, concatenates it and renders the final video.

This difference in unit of work is the main architectural finding of this audit.

## 2. Upstream pipeline observed in source

The orchestration lives primarily in `app/services/task.py`. The normal path is:

```
script
  -> search terms
  -> audio
  -> subtitles
  -> materials
  -> final video
```

The same pipeline supports early stop points: `script`, `terms`, `audio`, `subtitle`, `materials`, and `video`.

### Script

If a complete script is supplied through `video_script`, it is used directly. Otherwise the configured LLM generates it.

### Search terms

If `video_terms` is supplied, MoneyPrinterTurbo uses those terms directly. Otherwise it generates terms from the script.

When `match_materials_to_script=true`, term order is explicitly treated as narrative order. The project normally requests eight ordered search terms in this mode.

The critical stock routine is `_download_videos_by_script_order` in `app/services/material.py`. It groups candidates by search term and selects them round-robin by term rather than letting early keywords monopolize the output.

### Audio

A supplied `custom_audio_file` bypasses TTS. Otherwise the selected TTS provider generates narration.

### Subtitles

The regular pipeline supports:
- Edge/TTS timestamps;
- Whisper transcription from audio.

The current first-party task schema does not expose a native custom SRT input, even though internal rendering utilities read SRT. Caçadores already has approved SRTs, so a minimal adapter should support direct SRT reuse rather than retranscribing.

### Materials

Stock sources:
- Pexels;
- Pixabay;
- Coverr;
- local images/videos.

Generated sources present upstream include WaveSpeed, VolcEngine Seedance, OFox, Metaso MiniMax, MuAPI, LoomLoom and OpenAI-compatible image generation.

For ordinary stock, the engine searches candidates, downloads only enough usable duration to cover the narration, and stops. Search and download concurrency are bounded.

### Composition

`app/services/video.py::combine_videos`:
- reads real narration duration;
- slices source media to a configurable maximum clip duration;
- normalizes aspect ratio using cover/contain behavior;
- optionally applies transitions;
- processes clips with bounded concurrency;
- loops material only if coverage is insufficient;
- concatenates with FFmpeg;
- progressively handles temporary clips rather than keeping the whole video in memory.

`generate_video` then adds narration, subtitles and optional BGM and writes the final file.

## 3. Colab behavior

The official notebook:

```
clone/pull repo
-> install uv + pyngrok
-> install Python 3.11
-> uv sync --frozen
-> start Streamlit on port 8501
-> health check
-> ngrok tunnel
```

The video engine itself is unchanged. Colab is an ephemeral execution host.

Implication for Caçadores: compute, downloaded media, FFmpeg scratch files and render cache can live outside the shared VPS and disappear with the runtime.

## 4. MoneyPrinterTurbo functionality inventory relevant to Caçadores

Creation interfaces:
- AI Agent;
- WebUI;
- FastAPI;
- CLI;
- batch manifests;
- task history/settings import-export.

Content:
- custom script;
- AI-generated multilingual script;
- many LLM providers and compatible gateways.

Visuals:
- Pexels;
- Pixabay;
- Coverr;
- local media;
- generated image/video providers;
- configurable clip duration;
- fit mode;
- ordered material matching;
- multiple output variants.

Voice:
- custom uploaded narration;
- no narration;
- Edge TTS;
- Azure;
- Gemini;
- ElevenLabs;
- Fish Audio;
- Kokoro;
- MiniMax;
- SiliconFlow;
- VoxCPM and others.

Subtitles:
- enable/disable;
- sentence or word-by-word;
- Edge timestamp mode;
- Whisper mode;
- font/size/color/stroke/background/position/animation.

Audio/music:
- voice volume;
- random/local BGM;
- generated BGM integrations;
- BGM volume.

Output:
- 9:16 1080x1920;
- 16:9 1920x1080;
- 1:1 1080x1080;
- configurable clip speed and transitions;
- cross-posting support.

## 5. Current Caçadores comparison

The current Caçadores intelligence layer is materially stronger and should be preserved:

- Radar and niche discovery;
- Universe / opportunity selection;
- Research Pack;
- Claim Ledger;
- originality/anti-slop gates;
- Script Engine;
- Retention Map;
- Channel Brain / Production DNA;
- factual controls;
- packaging and publishing intelligence.

The current audiovisual path is much more granular:

```
Transcript
-> Scene Plan
-> Visual Prompt Set
-> scene-by-scene Source Router
-> persistent Scene Assets
-> Verified Stock Jobs
-> leases/retries
-> per-asset Visual QA
-> diversity checks
-> full visual coverage gate
-> Timeline
-> Video Edit
-> Render chapters
-> Production QA
```

The Panama pilot has 241 scenes. Under the current model, individual scenes may each create routing decisions, stock jobs, QA state, diversity state and gate state.

MoneyPrinterTurbo instead treats a small ordered search-term set and the narration duration as the primary material-selection problem.

## 6. What should be preserved, bypassed, or reconsidered

Preserve:
- all intelligence/research/editorial systems above the execution layer;
- approved script and transcript;
- Production DNA as configuration input;
- R2;
- QA after the master exists;
- publishing pipeline;
- existing database and episode identity.

Bypass for the first execution experiment:
- mandatory 100% per-scene asset coverage;
- hundreds of verified-stock jobs;
- per-scene Source Router as a prerequisite to obtaining a first master;
- internal Timeline/Video Edit/Render as the only path to a master.

Reconsider after baseline:
- use Scene Plan as an optional source of ordered search hints rather than a required persistent asset graph;
- apply factual-source enforcement only to beats where factual evidence is actually required;
- keep visual QA as sample/final-master QA instead of requiring full scene-level approval in every format.

## 7. Existing Caçadores capability that makes the experiment low-risk

Caçadores already supports an `external-master` path in `src/lib/server/render-engine.ts`.

The platform can:
- prepare an external MP4 upload;
- stream the external master to R2;
- probe/finalize it;
- associate it with the existing episode;
- continue downstream workflows without requiring an internal render.

Therefore an external execution engine does not require replacing the Caçadores control plane.

## 8. Proposed execution contract

A first coarse-grained video job should look conceptually like:

```json
{
  "episodeId": "...",
  "title": "...",
  "script": "...",
  "audio": "...",
  "subtitle": "...",
  "searchTerms": ["...", "..."],
  "aspectRatio": "16:9",
  "clipDurationSeconds": 3,
  "videoSource": "pexels",
  "matchMaterialsToScript": true,
  "captions": true,
  "backgroundMusic": {
    "enabled": true,
    "volume": 0.2
  }
}
```

The execution engine returns one MP4 plus a lightweight material/source manifest.

One episode should correspond to one coarse execution job, not hundreds of persistent scene jobs.

## 9. Panama baseline experiment

Do not resume the current 224-scene asset drain before this experiment.

Use the assets already available from the Panama pilot:
- approved script;
- uploaded narration;
- approved SRT;
- Production DNA;
- research and Claim Ledger;
- existing episode identity.

Baseline A — unmodified MoneyPrinterTurbo in Colab:
- custom approved script;
- custom narration MP3;
- 16:9;
- 3-second source clip duration;
- `match_materials_to_script=true`;
- Pexels first;
- MoneyPrinterTurbo-generated ordered terms or operator-supplied ordered terms;
- Whisper subtitles if necessary for the unmodified baseline;
- final MP4.

Baseline B — minimal adapter:
- same inputs;
- add direct approved-SRT use;
- use Caçadores-generated ordered visual search hints;
- final MP4.

Import each result into the existing external-master path for comparison and QA.

## 10. Acceptance metrics

The experiment should be judged on:
- publishability of the final video;
- semantic congruence between narration and visuals;
- motion/video coverage;
- visible repetition;
- factual integrity;
- total wall-clock time;
- manual interventions;
- execution failures/retries;
- VPS CPU/RAM/disk delta;
- external execution storage footprint;
- cost per finished video.

The primary KPI is a publishable master, not the number of internal entities or gates completed.

## 11. Implementation order

1. Freeze the current Panama visual-asset expansion.
2. Reproduce MoneyPrinterTurbo unmodified in Colab.
3. Generate the Panama baseline using the already approved script/audio.
4. Import the result as an external master.
5. Evaluate quality and execution metrics.
6. Add only the minimal compatibility features proven necessary:
   - direct SRT input;
   - Caçadores ordered search hints;
   - R2 input/output bridge;
   - execution callback/job status.
7. Run a second Panama test.
8. Only then decide which current visual subsystems should remain mandatory, optional, or retired.

## 12. Important constraints

- Do not move database or control-plane responsibilities into Colab.
- Do not use the shared VPS for heavy video assembly during the experiment.
- Do not delete the existing Scene Plan/Source Router implementation before the baseline comparison.
- Do not add hundreds of new per-scene jobs to the simplified path.
- Do not broaden Docker cleanup on the shared VPS as part of this work.
- Maintain upstream MIT attribution if substantial MoneyPrinterTurbo code is copied or modified.

## 13. Current recommendation

Treat Caçadores as the Intelligence Plane and MoneyPrinterTurbo-style execution as the first candidate Execution Plane.

The immediate goal is not feature parity with every MoneyPrinterTurbo provider. The immediate goal is to reproduce its simple, reliable path from approved content to a publishable MP4 outside the VPS, then improve that path using Caçadores intelligence.
