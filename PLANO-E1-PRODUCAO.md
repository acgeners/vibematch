# PLANO — e1 (digest no Interesse) rodando em produção + backfill

> **Objetivo:** deixar o preditor de **Interesse na Obra** rodando em produção com o
> **e1** (usa o `review_digest` como contexto), com o **backfill** do catálogo previsto.
> Criado 2026-06-27.

## Estado atual (o que JÁ está pronto)

- ✅ **Código do e1 está no `main`** (PR #15, `PROMPT_VERSION="v3"`): o
  `synopsis-quality-predictor` injeta o `works.review_digest` (fallback resumo) como
  "CONTEXTO DE LEITORES"; o digest entra na `input_signature` (staleness correta);
  `interest-backfill.ts` (`planInterestBackfill`/`runInterestBackfill`) está ciente.
- ✅ **Ferramentas de preparação** (PR desta sessão — ops de avaliação IA): em
  `/ai-evaluation`, abas **"Sem reviews"** e **"Sem tags"** têm botões de
  **buscar reviews+digest** e **inferir tags** (individual e em fila).
- ⚠️ **Pendente = OPERAÇÃO** (não há código novo do e1 a escrever).

## Por que precisa de backfill

O bump pra `v3` tornou as predições de Interesse anteriores **"absent"** (a
`input_signature` mudou). Sem rodar o backfill, a coluna de Interesse fica vazia até
re-prever. O e1 só agrega valor quando a obra **tem digest** — obra sem reviews/digest
cai no comportamento b1 (só sinopse), sem regressão.

## Ordem CORRETA (dependências)

```
reviews  ──▶  digest  ──▶  tags  ──▶  backfill do Interesse (e1)
```

- **Digest depende de reviews** → buscar reviews primeiro (gera digest no save).
- **Tags entram na assinatura do Interesse** → adicionar tags DEPOIS do backfill deixa a
  previsão stale (re-prever de novo). Então **tags antes** do backfill.
- **Tag-inference usa o digest/resumo** como contexto (mais tags específicas) → roda
  melhor **depois** de reviews/digest.

## Passos

### 0. Pré-requisitos (aplicar à mão no SQL editor — CLI dessincronizada)
- `migrations/119_user_settings_synopsis_canonical_on_create.sql` (toggle canônica)
- `migrations/120_works_ai_eval_reviews_stale.sql` (flag de avaliação desatualizada por reviews)

### 1. Maximizar reviews + digest
- `/ai-evaluation` → aba **"Sem reviews"** → filtrar (ex.: com fontes externas aceitas) →
  **"Buscar reviews em fila"** (teto 8/execução; repetir). Gera reviews + resumo + digest.
- Obras que já têm reviews mas sem digest: painel **"Digest de reviews"** em `/settings`
  (`consolidatePendingReviewDigests`, ~10/clique) até zerar.
- ⚠️ Scraping depende de **FlareSolverr (Docker)** pro Comix/ComicK — ligar antes.

### 2. Maximizar tags
- `/ai-evaluation` → aba **"Sem tags"** → **"Inferir tags em fila"** (teto 25/execução; repetir).
  Usa sinopse + digest/resumo (review-aware). Grava `source='ai_inferred'` (reversível).
- Alternativa em massa/CLI: `npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/infer-tags.ts --with-reviews --from-csv=...`
- Rodar **`npm run recalc:scores`** depois (tags entram nas features).

### 3. (Opcional) Re-avaliar atributos desatualizados por reviews
- `/ai-evaluation` → aba "IA atributos" → filtro **"Reviews novas"** lista as obras cujo pool
  de reviews mudou após a avaliação. Re-avaliar incorpora as reviews novas nos
  `category_scores` (→ Nota Prevista). **Opcional** e custa Sonnet — só onde valer.

### 4. Backfill do Interesse (e1)
- **Dry-run primeiro** (custo $0): `planInterestBackfill()` → mostra fresh/stale/absent +
  custo estimado (~**$8 provável / ~$12 upper** medido em 2026-06-27).
- Confirmar e **executar**: `runInterestBackfill({ maxCostUsd })` (ou pela UI de backfill, se exposta).
  É pago (predictor de Interesse) → roda com `allowPaid`; concorrência limitada, dedup, resume.
- Re-rodar até zerar os "absent/stale".

### 5. Verificar
- Painel **`/admin/model-metrics`** (métricas/shadow).
- Spot-check: obras com digest devem ter Interesse previsto; conferir que a faixa ♥ mudou
  sensatamente (no smoke 2026-06-27, e1 ficou mais conservador que b1: 2/5 baixaram).

## Custos (estimados, medir no dry-run)
| Etapa | Custo |
|---|---|
| Reviews+digest | digest Sonnet ~$0,02–0,05/obra (só onde falta) |
| Tags | Haiku ~$0,001–0,005/obra |
| Backfill Interesse (e1) | **~$8** provável / ~$12 upper (catálogo) |
| recalc:scores | $0 (determinístico) |

## Rollback
- Tags inferidas: `DELETE FROM work_tags WHERE source='ai_inferred'` (ou reversal logs).
- Reverter e1: `PROMPT_VERSION` `v3` → `v2` no `synopsis-quality-predictor` reativa o b1.

## Gotchas
- Obra sem digest ⇒ e1 = b1 (sem regressão), mas não aproveita o ganho — por isso reviews/digest primeiro.
- FlareSolverr/Comix podem estar fora (Docker) — afeta só a coleta de reviews, não o e1 em si.
- A avaliação IA de atributos **não** usa o digest (usa reviews cruas) — backfill de Interesse e re-avaliação de atributos são independentes.

Relacionado: `MAPA-DADOS-E-ROADMAP.md`, `HANDOFF-OTIMIZACAO-E-DIGEST.md`, memórias [[project_digest_interesse_ridge]] / [[project_synopsis_interest_plan3]].
