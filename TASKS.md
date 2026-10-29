# TASKS

## Live: Annaelle 4 monthly curate → Album04 (2026-10-27)

Brief: "best everyday moments of Annaelle"; subject Annaelle; `--yes` export.
Dest: `~/Documents/Projects/Annaelle/Album04/<YYYY-MM>/`

- [x] Curate all 11 months (Jev); review.html + manifest.json each
- [x] HEIC originals where local; shared-album gaps filled with 2048px preview JPEGs
- [x] Note: Annaelle 4 is shared — many originals never download; previews are the reliable copy
- [ ] Re-run months with `--min-photos 10` after that flag ships (thin months had &lt;10 picks)

## photo-filter `--min-photos` (2026-10-28)

- [x] `pickTarget` / `poolForTarget` + wire into decision pipeline
- [x] CLI default 10; skill + AGENTS note
- [x] Verify tests (65) / typecheck / build

## photo-filter (Apple Photos access for CLI + MCP agents)

Decisions: own package `packages/photo-filter` (core + CLI + MCP server sharing
one core, backed by osxphotos); project skill for "select best photos"; HTTP
serve mode for browser apps deferred (core designed for it); AGENTS.md updated
so packages are no longer required to be browser-safe.

- [x] Scaffold package wiring (package.json, tsconfigs, vitest config)
- [x] Core: osxphotos runner, listAlbums, queryPhotos, thumbnails, export
- [x] Pure helpers: date window, ranking, JSON normalization (+ tests)
- [x] CLI `photo-filter` (albums | query | thumbs | export)
- [x] MCP server `photo-filter-mcp` (list_albums, query_photos, get_thumbnails, export_photos)
- [x] Register MCP server in `.cursor/mcp.json`
- [x] Skill `.cursor/skills/select-best-photos/SKILL.md`
- [x] AGENTS.md: document package + relax browser-only rule
- [x] Verify: lint, typecheck, test (140), build — all green
- [x] Install uv (brew) — `uvx --python 3.12 osxphotos` 0.77.2 runs
- [x] Live check: albums lists 437-item shared "Annaelle 4"; query ~23s; thumbs render
- [x] Field mapping verified; shared-album scores are all 0 -> now null (skill updated)
- [ ] Run "Annaelle 4" example end to end via MCP

## photo-filter `curate` (deterministic pipeline, model only for judgment)

Defaults chosen (user said "go" without answering): Anthropic backend behind a
provider-neutral `VisionModel` interface (default `claude-sonnet-5-5`,
`ANTHROPIC_API_KEY`); context shared within a run AND persisted across runs
with review feedback; subject reference photos from `--ref` uuids or the
Photos People tag; final selection by a second model pass; HTML review sheet +
confirm prompt (`--yes` skips).

- [x] `person` query option (library + CLI)
- [x] Image tools via sharp: thumbnail, dHash, numbered contact sheet
- [x] Pure grouping: events by time gap, near-duplicate groups (+ tests)
- [x] Prompts + JSON schemas + reply validation (survey / judge / pick)
- [x] Context store (events, verdict cache, picks, feedback)
- [x] Anthropic adapter (structured output, retries) (+ fake-fetch test)
- [x] Pipeline `curatePhotos` (+ fake model test)
- [x] CLI `curate`: review.html, confirm/drop, export, manifest, save context
- [x] Docs: AGENTS.md, skill points at `curate`
- [x] Verify lint/typecheck/test (161)/build; dry run on real library (stub model): 40 photos, 5 events, 13 calls, 24 s
- [ ] Live run with a real model (needs ANTHROPIC_API_KEY)
- [ ] Optional: MCP `curate_photos` tool

## photo-filter model backends (research done 2026-10-24, awaiting decision)

Findings: `VisionModel` seam is good; a single OpenAI-compatible adapter covers
Ollama/LM Studio/vLLM (local), OpenRouter/DeepInfra (hosted open-weight) and
Gemini. Est. 400-photo run ≈ 175k in / 25k out tokens: Sonnet 5.5 ~$0.60,
Haiku 5.5 ~$0.03, Qwen3-VL-235B (DeepInfra) ~$0.06, local Ollama $0.

- [ ] Fix: cache keys (verdicts/events/pickCache) ignore `model.id`
- [ ] Track `usage` per call; pre-run cost estimate + hard budget cap
- [ ] OpenAI-compatible adapter (`PHOTO_FILTER_BASE_URL`, `response_format` json_schema)
- [ ] Prompt caching for system + reference images (Anthropic `cache_control`)
- [ ] Eval: same album through Sonnet / Haiku / Qwen3-VL local, compare picks
- [ ] Web app: decouple pipeline from osxphotos paths + sharp (photo source + image tools over Buffers)

### Jev (TypeSafe decision model) — researched, awaiting decision

`typesafe/jev-1.14` (OpenRouter `/api/alpha/decisions`, $0.042/M input, output
free). Typed answers only (noul / choice / score / box), no free text; images
are experimental; ~4 images/request; 2–4 s per image call. Fits judge
(subjectPresent, relevant, quality score, best-of-burst choice); cannot do
event labels, moment tags, reasons, or set-level final pick. 400-photo judge
≈ 1M input tokens ≈ $0.04, computable before the run.

Decisions (user): test first, then pick a role; replace moment tags with
time/event spread in code; provider OpenRouter. Test = Jev only, judged by
eye on an HTML sheet, album "Annaelle 4". Key goes in
`packages/photo-filter/.env` (`.env` now gitignored).

Test inputs: 2025-11-30 → 2025-12-31 (59 photos, all local), brief
"Annaelle's 3rd birthday party and month thereafter". Library has no named
People, so no automatic reference photo (`--ref UUID` optional).

- [x] `DecisionModel` interface + OpenRouter adapter `src/curate/decisions.ts` (+ 4 fake-fetch tests)
- [x] `scripts/jev-eval.ts` (`pnpm jev-eval`): judge → burst knockout → code pick spread by event → review.html + results.json
- [x] Verified: `--fake` run on the real album (59 judged, 2 bursts, 12 picks); lint, 165 tests, typecheck green
- [x] Fix: Jev 400 "Invalid image dimensions" — short side must be ≥ ~288 px (probed: 257 fails, 288 ok);
      shared-album previews are ~250 px wide. Script upscales/pads to short side ≥ 320, long ≤ 1568.
- [x] Live run: 61 requests, 60k tokens, $0.0025, 9 s. Top ranks = cake/candles/balloons shots; bottom =
      back views, other kids, adults, drinks. Quality scores compressed (1.4–3.1 of 4), relevance permissive (54/59 ≥ 0.5).
- [x] User: picks "not bad", wants less weight on quality, asked about upscaling. Upscaling adds no
      information (and AI upscalers fake sharpness), so not used. Instead: script prefers local
      originals (20/59 are local 2048 px JPEGs; 39 iCloud-only have only ~256–430 px previews) and
      `--quality-weight` (default 0.3). Re-run: 7 picks kept, 5 changed, $0.0026. Originals moved
      quality by up to 0.47 (vs 0.14 run-to-run noise on unchanged inputs).
- [x] User feedback: wanted 097B386A (Dec 16 ride with dad) + 3FF437CA (new bike, Nov 30); wants
      "most special moments — with mother/father, special place, special present", fewer per event,
      more events; asked for two options. Script now asks subject/special/withParent/specialPlace/
      present/quality in one call; option A = holistic `special`, option B = any-of(parent, place,
      present); picks round-robin across events; `--mark` outlines user picks. Run: $0.0030, 6 events.
      Result: bike moment picked in both as burst sibling 34FEC655 (with dad); Dec 16 ride is 5th/6th
      of 9 in its outing (B scores 0.80–0.84 near-tied), so a 2-per-event spread misses it.
      Simulated score floor (0.4/0.5): removes weak filler but doesn't change that.
- [x] User chose option A (holistic `special`); B removed. Count now `--per-month 20` (scaled by
      range; `--count` overrides) → 21 picks for this month. Run: $0.0027; per event 3/3, 5/27, 4/7,
      4/11, 1/1, 4/10. Bike moment in via 34FEC655; Dec 16 ride 6th of 9 in its outing (0.54–0.44
      cluster). Weak filler still present (min pick score 0.09) — small events get all their photos.
- [x] Added `--min-score` (default 0.3) and per-event Jev knockout filling each event's quota from
      its top (quota + 3) candidates; knockout helper shared with bursts. Fake run checked both paths.
      Live: 87 requests, $0.0048, 21 picks from 4 events, min pick score 0.35, both user moments in
      (ride chosen by comparison at score 0.48). Dec 11 (preschool Hanukkah show) best 0.29 and Dec 13
      0.11 fall under the floor, so 2 events dropped. Jev run-to-run drift on `special`: mean 0.02.
- [x] User said "go": widen special (school shows / holidays / birthdays) + wire Jev into `curate`
- [x] `curateWithDecisions` (`decision-pipeline.ts`): judge → burst knockout → event spread +
      within-event Jev compare; prefers local originals; `fitForDecision` for Jev size limits;
      caches by `model.id` + `DECISION_PROMPT_VERSION`
- [x] CLI `curate` defaults to OpenRouter/Jev (`OPENROUTER_API_KEY`); `--per-month 20`,
      `--quality-weight`, `--min-score`; Anthropic `VisionModel` path kept but unused by CLI
- [x] Review sheet + context + skill + AGENTS.md updated; `jev-eval` thinned to call the library
- [x] Verify: lint, typecheck, 175 tests, build; fake run on Annaelle 4 → 21 picks
- [ ] (Deferred) download the 39 iCloud-only originals for full-res judging
- [ ] Optional: MCP `curate_photos` tool; live `curate` end-to-end export for Annaelle 4
