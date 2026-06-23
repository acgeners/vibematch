# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # starts on http://localhost:3001 (not 3000)
npm run build
npm run test         # vitest run (all tests once)
npm run test:watch   # vitest watch mode
npx vitest run tests/unit/calculations/score.test.ts  # single test file
npm run sync-constants  # regenerates constant files from Supabase DB (requires SUPABASE_SERVICE_ROLE_KEY)
npm run lint
```

`sync-constants` needs `SUPABASE_SERVICE_ROLE_KEY` in env. It overwrites 7 files — never hand-edit the files listed in the **Constants generated from DB** section below.

## Architecture

Next.js 16 App Router (Turbopack). All DB access is server-only via `createAdminClient()` (service role key). There is no auth layer — every page is accessible.

```
app/              – Next.js routes (server components by default)
components/       – React components ("use client" where needed)
server/
  actions/        – "use server" functions called directly from client components
  queries/        – server-only DB read helpers (no "use server" directive)
lib/
  ai-evaluation/  – Claude API integration (service.ts)
  calculations/   – deterministic scoring pipeline
  constants/      – GENERATED files (do not edit by hand)
  external/       – third-party API integrations + multi-source merge logic
  import/         – GENERATED files + CSV/XLSX import pipeline
  ml/             – Ridge regression for Nota Prevista / expected_score (pure TS, no native deps)
  supabase/       – client factories
  validations/    – Zod schemas
types/domain.ts   – canonical domain types (partly GENERATED)
scripts/sync-constants.js – DB → TypeScript code generator
supabase/migrations/ – SQL migration history
```

## Inline type imports and Turbopack

Turbopack (Next.js 16) fails to parse `import { type Foo }` inline syntax when a client component is traversed from a server context. Always use separate `import type` statements:

```ts
// ❌ breaks Turbopack
import { workFormSchema, type WorkFormValues } from "@/lib/validations/work.schema"

// ✅ correct
import { workFormSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues } from "@/lib/validations/work.schema"
```

Also: files without extensions (e.g. `work-form` alongside `work-form.tsx`) are resolved by Turbopack before the `.tsx` file. Rename any such files to `.bak` or `.unused`.

## Constants generated from DB

These files are **fully overwritten** by `npm run sync-constants` and must not be edited by hand:

| File | Source table(s) |
|---|---|
| `lib/constants/criteria.ts` | `criteria` (eval_type=IA) + `publication_status` + `personal_status` + `source` |
| `lib/constants/post-reading-criteria.ts` | `criteria` (eval_type=User) |
| `lib/constants/tag-groups.ts` | `tag_group` |
| `lib/external/types.ts` | `source` (ExternalSourceId only, rest preserved) |
| `lib/import/mapper.ts` | `criteria` aliases |
| `lib/import/normalizer.ts` | `publication_status` + `personal_status` maps |
| `types/domain.ts` | `PUBLICATION_STATUSES`, `PERSONAL_STATUSES`, `PLATFORMS`, `CRITERION_SLUGS` arrays |

The canonical list of AI evaluation criteria (`CRITERION_SLUGS`) comes from the `criteria` table where `eval_type = 'IA'`. Any change to criteria must go through the DB and then `sync-constants`.

`sync-constants` also backfills `work_tags` from the legacy `works.genres` text array using the `genre` tag group.

## Scoring pipeline

> **History (read this first):** the original pipeline had four named scores — Nota.IA → Nota.Calc → Nota.Pr → Nota.Final. The `Nota.Pr` + `Nota.Final` stage was **retired** and replaced by a single **Nota Prevista** (`expected_score`). `lib/calculations/final.ts`/`stacker.ts` were deleted and the `final_score`/`predicted_score` columns dropped in migration 099 (2026-06-14). `lib/calculations/prediction.ts` survives as dead code (no callers) pending cleanup. The user-facing score is now **Nota Prevista**; **Nota.Calc** lives on as an internal ensemble anchor.

Today a work's score flows through three stages:

1. **GPT (Nota.IA)** — weighted sum of `category_scores` using `score_weights`. Negative-weight criteria (drama, tragedy) only penalise when above `max_negative_threshold`. Result is clamped 0–10 then amplified: `GPT.N = 5 + (GPT - 5) × 1.25` (`lib/calculations/gpt.ts`).

2. **Nota.Calc** (`calc_score`) — blends GPT.N with platform average using Bayesian pseudo-vote pooling, then applies chapter and observation penalties (`lib/calculations/score.ts`). Computed both with and without the observation nudge (`calcScoreNoObs`). Persisted as `calc_score`; kept as a feature/ensemble anchor for stage 3, not shown to the user as the headline score.

3. **Nota Prevista** (`expected_score`) — the headline predicted score. A **single Ridge regression** (`trainExpectedPredictor` in `lib/calculations/expected.ts`) trained on works with a manual `user_score`. Features: the 9 category scores, GPT.N, platform avg, log(votes), chapters, synopsis quality, loved/avoided tag overlap, criterion-fit score, release age, run length, plus categorical publication status (one-hot) and origin country. (8 post-reading "quality" features are added only on the paid plan via `includeQuality`.) The Ridge output is then **blended with Nota.Calc** (`calcScoreNoObs`) using a weight grid-searched on out-of-fold predictions to avoid leakage — `w = 1` (no blend) when training set < 30 or the model is a stub. The observation adjustment is **not** a feature; it is added deterministically once after the blend. Below `MIN_TRAIN = 20` labelled samples the predictor falls back to the training mean. Persisted as `expected_score`.

Recalculation is triggered server-side by `recalculateWork(workId)` or `recalculateAll()` in `server/actions/calculations.ts`. The honest cross-validated MAE of Nota Prevista (~0.58–0.60) is stored in `formula_config`.

## AI evaluation flow

Two distinct paths both ultimately call `requestAiEvaluation()` in `lib/ai-evaluation/service.ts`:

**Path A — "✨ Avaliar" page (`/ai-evaluation`)**
`triggerAiEvaluation(workId)` → `fetchExternalEvaluationContextForWork()` → `requestAiEvaluation()`
- Uses saved work data (primary synopsis, genres, grouped tags, cover). If the work has accepted `work_external_ids`, reviews/context are fetched from those confirmed source IDs; otherwise it falls back to title search.
- Review sources (each only when the candidate has that source's ID): MangaUpdates + AniList + MyAnimeList + Kitsu (reactions) + AnimePlanet + MangaDex (forum comments) + ComicK (curated reviews + comments) + Comix (per-work comment thread, mini-reviews). Comix has no formal reviews API; `fetchComixReviews(hid)` walks detail `id` → `threads/lookup?page_identifier=manga{id}&page_url=/title/{hid}` → `threads/{threadId}/comments` (cursor-paginated, via `fetchComixJson`/FlareSolverr).
- Reviews go through `selectReviewsForEvaluation()` before the prompt — stratified per-source sampling with an **adaptive** quota: `perSource = min(maxPerSource, ceil(total / sourcesWithReviews))`, capped by `AI_EVAL_REVIEW_CAPS = { total: 30, maxPerSource: 12 }` (service.ts), then global round-robin in `REVIEW_SOURCE_PRIORITY` order (MangaUpdates first). So few-source works fill the budget (2 sources → up to 24, not 16) instead of being stuck at a fixed 8/source. All sources are always fetched in parallel; the cap is applied at selection time only (no fetch short-circuit). The full pool persists to `work_reviews`.
- Passes `sourcedReviews: SourcedReview[]` (rich format with source, matchScore, sourceTitle)
- Also passes `externalContext` (synopsis strings from external sources)
- Saves results to `ai_evaluations` + `ai_evaluation_scores` tables
- User reviews and optionally edits scores before they're committed to `category_scores`

**Path B — "✨ Buscar dados" form (`/titles/new`)**
`searchAllSources()` → user chooses candidate → `fetchMultiSourceDetails()` → user chooses final data → `evaluateCandidateForCreate()` → `requestAiEvaluation()`
- "Buscar dados" only finds candidate/source matches. "Usar" extracts metadata, lets the user pick synopses/covers/conflicts, then runs AI against the final selected data.
- Review/context sources come from the accepted external IDs for the selected candidate, not from a second independent title search.
- Passes `sourcedReviews: SourcedReview[]`; final selected synopsis is sent as the primary synopsis. Extra external context is omitted when a selected synopsis exists to avoid evaluating unselected synopsis blocks.
- Scores go into form fields; if saved unchanged they are persisted as `source: "ai_accepted"` with an `ai_evaluation_id`
- Works with all 9 criteria set get `ai_eval_status = "done"` and skip the Avaliar queue
- Completed AI evaluations that still need review use `ai_eval_status = "review_pending"`

Post-processing applied to every evaluation (in `service.ts`):
- `enforceR19AdultContentRule`: raises `adult_content` to ≥ 7.0 if R19 marker detected anywhere in input
- `enforceExternalContentRatingRule`: raises `adult_content` to a floor from the accepted external sources' content rating (MangaDex `contentRating` / ComicK `content_rating`) — `suggestive`→5, `erotica`→7, `pornographic`→8. Chained with the R19 rule; both are monotonic so the effective floor is the max of whichever triggered.
- `enforceNeutralCoupleDynamicsWhenNoRomance`: raises `couple_dynamics` to 5.0 when romance ≤ 3 and couple_dynamics < 5
- `enforceAuditableReviewUsage`: **throws and retries** if reviews were passed but the model didn't cite review IDs (`R1`, `R2`…) both in `review_usage` and in justifications

The model is `claude-sonnet-4-6`, prompt version `v19` (toggled by `CONCISE_OUTPUT` in `service.ts`: `v19` concise output / `v18` verbose — flipping it falls back to the old caches), up to 2 attempts (4500 max tokens on **both** attempts; temperature 0.2 then 0). Opus 4.7 and Haiku 4.5 are supported as per-evaluation overrides (the A/B "Reavaliar com…" buttons); Opus 4.7 doesn't accept the `temperature` param. MAE values stored in `formula_config` reflect calibration runs against the current model+prompt; the hardcoded fallbacks in `calibration.ts` (1.27/0.92) are historical defaults from the original spreadsheet — not authoritative.

## External data sources

`lib/external/index.ts` is the multi-source orchestration layer:
- `searchAllSources(query)` — parallel search across AniList, MangaUpdates, ComicK, Kitsu, MyAnimeList; merges by title similarity (threshold 0.65 for grouping, 0.72 for accepted)
- `fetchMultiSourceDetails(candidate)` — hydrates a candidate from all platforms by ID, filters accepted sources (titleScore ≥ 0.72 AND synScore ≥ 0.18 AND composite ≥ 0.62), then calls the AI. Reverse-substring matches ("Fake Lady" inside "The Fake Lady and Her Rabbit Duke") são graduados por proporção pra evitar falsos positivos.

Client-side fetches (ComicK ratings, AnimePlanet ratings) live in `lib/external/client-fetches.ts` and are called directly from `ExternalSearch` component to avoid the server action round-trip.

Review/context fetching is centralized in `lib/external/index.ts`:
- `fetchExternalEvaluationContextForCandidate()` hydrates confirmed source IDs and gathers reviews/context only from accepted sources.
- `fetchExternalEvaluationContextForWork()` is the fallback for works without confirmed IDs; it searches title variants, accepts a candidate, then delegates to the candidate-based context builder.

## Database schema summary

Core tables: `works`, `category_scores`, `calculated_scores`, `platform_ratings`, `score_weights`, `formula_config`, `ai_evaluations`, `ai_evaluation_scores`, `tags`, `tag_group`, `work_tags`, `criteria`, `source`, `imports`, `import_rows`.

AI recommendation tables: `taste_profile`, `recommendation_runs`, `deep_dive_results`, and `recommendation_chats` (conversational recommendation chat — paid-only; 1 row per conversation, messages in a JSONB array with a compact per-turn recommendation snapshot). The chat is a thin layer over `runRecommendationAction` (it reuses the ranker; each recommend turn still creates a `recommendation_runs` row). All Claude calls log to `ai_api_calls`.

All DB access uses the service role key (`createAdminClient()`). RLS is enabled on all tables with no permissive policies — anon access is intentionally blocked.

`works.ai_eval_status`: `"pending"` (never evaluated / needs AI run) | `"review_pending"` (AI completed / needs review) | `"done"` (accepted/saved) | `"skipped"`.
`ai_evaluations.status`: `"processing"` | `"completed"` | `"failed"` (separate from the work status).

`category_scores.source`: `"manual"` | `"imported"` | `"ai_accepted"` | `"ai_edited"`.

## Tests

Tests live in `tests/unit/calculations/` and cover the deterministic scoring functions only. No integration or component tests. Vitest with jsdom environment; path alias `@` → project root.
