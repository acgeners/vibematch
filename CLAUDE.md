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
  ml/             – Ridge Regression for Nota.Pr (pure TS, no native deps)
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

A work's final score flows through four stages:

1. **GPT (Nota.IA)** — weighted sum of `category_scores` using `score_weights`. Negative-weight criteria (drama, tragedy) only penalise when above `max_negative_threshold`. Result is clamped 0–10 then amplified: `GPT.N = 5 + (GPT - 5) × 1.25`.

2. **Nota.Calc** — blends GPT.N with platform average using Bayesian pseudo-vote pooling, then applies chapter and observation penalties (`lib/calculations/score.ts`).

3. **Nota.Pr** — Ridge Regression trained on works with `manual_score` set. Features: all 9 category scores, GPT.N, platform avg, log(votes), chapters, synopsis quality, observation penalty, publication status. Minimum 20 training samples; falls back to mean otherwise (`lib/calculations/prediction.ts`).

4. **Nota.Final** — inverse-variance weighted average of Nota.Calc and Nota.Pr using their respective MAE values stored in `formula_config`.

Recalculation is triggered server-side by `recalculateWork(workId)` or `recalculateAll()` in `server/actions/calculations.ts`.

## AI evaluation flow

Two distinct paths both ultimately call `requestAiEvaluation()` in `lib/ai-evaluation/service.ts`:

**Path A — "✨ Avaliar" page (`/ai-evaluation`)**
`triggerAiEvaluation(workId)` → `fetchExternalEvaluationContextForWork()` → `requestAiEvaluation()`
- Review sources: MangaUpdates + AniList + MyAnimeList (3 sources)
- Passes `sourcedReviews: SourcedReview[]` (rich format with source, matchScore, sourceTitle)
- Also passes `externalContext` (synopsis strings from external sources)
- Saves results to `ai_evaluations` + `ai_evaluation_scores` tables
- User reviews and optionally edits scores before they're committed to `category_scores`

**Path B — "✨ Buscar dados" form (`/titles/new`)**
`fetchMultiSourceDetails()` in `lib/external/index.ts` → `evaluateCriteriaWithAI()` in `lib/external/ai-criteria.ts` → `requestAiEvaluation()`
- Review sources: MangaUpdates only (if muId found)
- Passes `reviews: string[]` (legacy plain-text format, no metadata)
- No `externalContext`
- Scores go into form fields; saved as `source: "manual"` on work creation
- Works with all 9 criteria set get `ai_eval_status = "done"` and skip the Avaliar queue

Post-processing applied to every evaluation (in `service.ts`):
- `enforceR19AdultContentRule`: raises `adult_content` to ≥ 7.0 if R19 marker detected anywhere in input
- `enforceNeutralCoupleDynamicsWhenNoRomance`: raises `couple_dynamics` to 5.0 when romance ≤ 3 and couple_dynamics < 5
- `enforceAuditableReviewUsage`: **throws and retries** if reviews were passed but the model didn't cite review IDs (`R1`, `R2`…) both in `review_usage` and in justifications

The model is `claude-sonnet-4-6`, prompt version `v14`, up to 2 attempts (second attempt uses temperature 0 and 4500 max tokens). Opus 4.7 is supported as override but doesn't accept the `temperature` param. MAE values stored in `formula_config` reflect calibration runs against the current model+prompt; the hardcoded fallbacks in `calibration.ts` (1.27/0.92) are historical defaults from the original spreadsheet — not authoritative.

## External data sources

`lib/external/index.ts` is the multi-source orchestration layer:
- `searchAllSources(query)` — parallel search across AniList, MangaUpdates, ComicK, Kitsu, MyAnimeList; merges by title similarity (threshold 0.62)
- `fetchMultiSourceDetails(candidate)` — hydrates a candidate from all platforms by ID, filters accepted sources (title ≥ 0.62 AND synopsis similarity ≥ 0.05), then calls the AI

Client-side fetches (ComicK ratings, AnimePlanet ratings) live in `lib/external/client-fetches.ts` and are called directly from `ExternalSearch` component to avoid the server action round-trip.

`lib/external/reviews.ts` — dedicated review/context fetching for Path A. Searches MangaUpdates + AniList + MyAnimeList using all title variants; returns up to 8 `SourcedReview` objects and up to 6 external context synopsis strings.

## Database schema summary

Core tables: `works`, `category_scores`, `calculated_scores`, `platform_ratings`, `score_weights`, `formula_config`, `ai_evaluations`, `ai_evaluation_scores`, `tags`, `tag_group`, `work_tags`, `criteria`, `source`, `imports`, `import_rows`.

All DB access uses the service role key (`createAdminClient()`). RLS is enabled on all tables with no permissive policies — anon access is intentionally blocked.

`works.ai_eval_status`: `"pending"` (needs AI review) | `"done"` (reviewed) | `"skipped"`.  
`ai_evaluations.status`: `"processing"` | `"completed"` | `"failed"` (separate from the work status).

`category_scores.source`: `"manual"` | `"imported"` | `"ai_accepted"` | `"ai_edited"`.

## Tests

Tests live in `tests/unit/calculations/` and cover the deterministic scoring functions only. No integration or component tests. Vitest with jsdom environment; path alias `@` → project root.
