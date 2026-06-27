# PLANO-TAGS-IA — Inferência de tags a partir da sinopse

Status: **✅ CONCLUÍDO (2026-06-25)** — [PR #14](https://github.com/acgeners/vibematch/pull/14) (merged). Objetivo: dar tags às obras da cauda
(poucas tags) inferindo-as da **sinopse**, com vocabulário fechado e proveniência
auditável. Complementa o backfill grátis de tags externas (ver
[[project_tag_backfill_coverage]]), que cobriu a camada macro mas deixou ~18 obras
ainda rasas e não traz tags **específicas** (as fontes externas são pobres justo
nessas obras).

## Por que / onde ajuda

Tags entram em 3 canais: prompt da avaliação IA, **desempate intra-tier
`tag_overlap_net`** (maior alavanca de recomendação) e feature do Ridge. O ganho
real aqui é tag **específica** (Slow Burn, Contract Marriage, Villainess…) na
cauda — a única fonte é a sinopse, via LLM.

## Escopo (travado)

- **Obras:** ativas com `< 10` tags (~92).
- **Vocabulário (menu):** ~630 tags, filtro:
  - grupos: tone_mood, romance, relationship_dynamics, conflict, themes, setting,
    fantasy, scifi, social_political, content_indicator, female_lead, male_lead,
    superpowers (completos, **sem o subgrupo "Looks"**);
  - **character_profile: só o subgrupo "Role"** (Villain/Tyrant/Antihero/Savior…);
  - `usage_count >= 3` (corta cauda rara/sinônimo);
  - **fora:** "Looks", format, cast, character_context, activities, elements,
    school_youth, other.
- **Motivo do corte:** inferibilidade (aparência/format não saem da sinopse) +
  precisão (menu menor = menos fadiga de decisão) — não custo (é barato).

## Modelo, custo, caching

- Modelo: **`claude-haiku-4-5-20251001`** (o mesmo do classificador de grupos).
- Preço Haiku: $1 / $5 por 1M (in/out). Por obra ≈ **$0,005 sem cache**.
- 92 obras ≈ **$0,10–0,46** (cacheado → ~$0,10).
- Caching: `cache_control: ephemeral` no menu. **Mínimo cacheável do Haiku = 4096
  tokens**; o menu (~3,5k) pode ficar abaixo → talvez não cacheie (silencioso).
  Irrelevante — custo já é centavos.

## Estrutura (espelha `lib/ai-evaluation/tag-classifier.ts`)

| Arquivo | Papel |
|---|---|
| `lib/tags/infer-from-text.ts` | `buildTagMenu()` (monta o menu+prompt cacheável) e `inferTagsFromText()` (chamada Haiku + filtro client-side) |
| `scripts/infer-tags.ts` | runner `--dry-run` (CSV de revisão) / `--execute` (grava + reversal) |
| `supabase/migrations/117_work_tags_provenance.sql` | colunas `source`/`confidence`/`created_at` em `work_tags` |

Reusa `createLoggedMessage` (log em `ai_api_calls`), `resolveOrCreateTags`
(resolve os nomes escolhidos → ids), upsert **aditivo** + **reversal log**.

## Structured output (forced tool)

`tool_choice:{type:"tool"}` → `extract_tags({ tags:[{ tag, confidence, evidence }] })`.
- `confidence` ∈ `"alta" | "média"` → 0,9 / 0,6.
- `evidence` = trecho da sinopse que sustenta a tag → **anti-alucinação** (tag sem
  evidência é descartada). Mesma ideia do `enforceAuditableReviewUsage` da avaliação.
- **Vocabulário fechado em 2 camadas:** menu na prompt + **filtro client-side**
  que descarta qualquer tag fora do menu. (Endurecer com `strict:true`+`enum` é
  opcional; o filtro já basta.)

## Proveniência (migration 117, aditiva)

```sql
ALTER TABLE work_tags
  ADD COLUMN source TEXT,        -- 'ai_inferred' nas novas; NULL = legado/humano/import
  ADD COLUMN confidence REAL,    -- 0..1 quando ai_inferred
  ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
```
Sem CHECK (não quebra os upserts existentes que não setam `source`). Permite
auditar, reverter (`DELETE … WHERE source='ai_inferred'`) e futuramente pesar
menos no modelo. **Aplicar à mão no SQL editor antes do `--execute`** (o dry-run
não precisa dela).

## Validação (n pequeno → à mão)

1. `--dry-run` → CSV (obra → tag, confidence, evidence).
2. Revisar as 92 na mão; marcar falsos-positivos.
3. Se precisão < ~85%, ajustar prompt/limiar antes de gravar.
4. `--execute --min-confidence=alta` no 1º lote (conservador); "média" depois.
5. `recalc:scores` propaga (igual ao backfill).

## Rollout

| # | Passo | Custo |
|---|---|---|
| 1 | Migration 117 (à mão) | $0 |
| 2 | módulo + script | $0 |
| 3 | `--dry-run` → CSV | ~$0,10–0,46 |
| 4 | revisão à mão → ajuste | $0 |
| 5 | `--execute` (alta) + recalc | já pago no 3 |

## Resultado final (✅ 2026-06-25)

Executado em 3 frentes; **1019 tags `ai_inferred`** gravadas no banco:

| Frente | Tags |
|---|---|
| Sinopse — alta | 673 |
| Sinopse — média (verificada Sonnet) | 158 |
| Reviews — alta | 144 |
| Reviews — média (verificada Sonnet) | 44 |

Cauda eliminada: obras com ≤5 tags **45→3**, com zero **10→0**, 11+ tags **86,5%→96%**. Custo LLM total ~**US$ 2,16** (Haiku $1,24 + Sonnet $0,92). Migration 117 aplicada. Reversível por `source='ai_inferred'`.

Modos adicionados além do plano original: **`--verify`** (Sonnet 4.6 como juiz estrito das "média") e **`--with-reviews`** (passada incremental usando `review_summary`/`review_digest` como evidência extra; grava só tags novas).
