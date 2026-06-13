# Fase C — Remoção do ramo legado da Nota Prevista (UI + lib + schema)

> Plano para outra sessão executar. A **Fase B (remoção do compute)** já foi feita e
> commitada na branch `nota-prevista-recenter-blend-features` (commit `b47d502`).
> Esta Fase C é a limpeza de UI, deleção de arquivos órfãos e a migration de drop.

## Contexto

A **Nota Prevista** agora é unicamente o `expected_score` (single Ridge + blend com
`calc_score`). O ramo legado — `predicted_score` (Nota.Pr), `final_score` (Nota.Final),
stacker e kNN — **não é mais computado** (`recalculateAll` já foi limpo na Fase B). As
colunas legadas passaram a ser escritas como `null` (exceto `predicted_is_stub`, que é
`NOT NULL DEFAULT true` → escrito `true`). A UI ainda **lê** essas colunas e degrada pra
"—"/fallback, mas as opções de sort/filtro e telas de debug ainda aparecem.

### Decisões já tomadas (não reabrir)
- **kNN: remover de vez** (era só feature do stacker; medido neutro pra MAE).
- **Colunas DB: manter por ora, dropar via migration** (esta fase faz a migration).
- **Manter** (NÃO são legado): `calc_score` (Nota.Calc — parceiro do blend + feature),
  `expected_score`/`expected_*`, `personal_fit`/`personal_fit_percentile`, `platform_avg`.

### Símbolos a eliminar
Colunas: `predicted_score`, `predicted_is_stub`, `final_score`, `prediction_distance`,
`final_score_confidence`, `knn_score`, `knn_neighbors`, `mae_predicted`, `rmse_predicted`,
`distance_p95`, `stacker_coefficients`, `ridge_coefficients`, `stacker_enabled`.
Campos TS / símbolos: `predictedScore`, `finalScore`, `knnScore`, `predictionDistance`,
`finalScoreConfidence`, `maePredicted`, `rmsePredicted`, `calculateNotaFinal(Choosing)`,
`fitStacker`/`StackerCoefficients`, `predictKnn`/`KnnNeighbor`/`DEFAULT_K`,
`trainPredictor`/`ridgeOutOfFoldPredictions`, `calculateFinalScoreConfidence`.

## Princípios de execução
1. **tsc é a rede de segurança.** Rode `npx tsc --noEmit` após cada bloco — ele aponta
   todos os consumidores quebrados. eslint (`no-unused-vars`) pega imports/símbolos órfãos.
2. **Manter o app funcionando.** Ordem: primeiro tirar os **reads** da UI/queries (redirecionar
   pro `expected_score`/`personal_fit`), depois deletar lib órfão, por último a migration.
3. **Cuidado com o dev server (Next 16/Turbopack):** edições em rajada + tsc/vitest concorrentes
   podem travar o `next dev`. Rode tsc/vitest preferencialmente com o dev parado, e reinicie o
   dev de tempos em tempos. Sintoma de wedge: CPU ~300%+, requests penduram (timeout). Fix:
   `kill` o `next-server` e `npm run dev` de novo.
4. **Verificar no app rodando** (não só por leitura) — cuidado com SSR/RSC/Radix tabs.

## Inventário de consumidores (mapa do grep, jun/2026)

| Símbolo | Arquivos (fora de `server/actions/calculations.ts`, já limpo) |
|---|---|
| `predicted_score` | queries: score-thresholds, ranking, recommendations, works · actions: compare, settings · components: ranking-preferences-form, ranking-filters, work-heatmap-view, work-table, work-table-config, calculation-breakdown, import-wizard · app: favorites, titles, ranking · **lib/import: validations/import.schema, processor, mapper** |
| `final_score` | queries: calibration, works, score-thresholds, similar-works, ranking, recommendations · actions: settings, post-reading-weight-suggestions, compare · components: ranking-preferences-form, ranking-filters, ranking-table, work-heatmap-view, work-table, work-table-config, calculation-breakdown, import-wizard · app: ranking, favorites, titles · **lib: ml/post-reading-weight-inference, import/mapper, import/processor** |
| `finalScore`/`predictedScore` | queries: calibration, similar-works, ranking, recommendations · actions: compare, settings · components: ranking-table, similar-works-card, work-compare-drawer · lib: ai-recommendation/types, ai-calibration/types, calculations/index, calculations/calibration |
| `knn_score`/`knnScore` | queries/ranking · app: favorites, titles, ranking |
| `prediction_distance`/`predictionDistance` | actions/settings · components/calculation-breakdown · lib: calculations/calibration, calculations/confidence |
| `final_score_confidence` | queries/ranking |
| `predicted_is_stub` | queries: ranking, works · actions: settings, compare · components: work-table, work-heatmap-view, calculation-breakdown · lib/import/processor |
| `mae_predicted`/`maePredicted` | actions/settings · components: calculation-breakdown, calibration-panel · lib/calculations/calibration |
| `rmse_predicted` | lib/calculations/index |
| `stacker_enabled`/`stacker_coefficients` | actions/settings · components/calibration-panel |

## Passo a passo

### 0. Branch e baseline
- Trabalhar na mesma branch `nota-prevista-recenter-blend-features` (ou nova `fase-c-...`).
- `npx tsc --noEmit` deve estar limpo no ponto de partida (Fase B).

### 1. Queries — remover reads legados (redirecionar pro expected/personal_fit)
- **`server/queries/ranking.ts`**: do `RankingEntry` remover `finalScore`, `predictedScore`,
  `knnScore`, `finalScoreConfidence`, `predictionDistance`; do `select` tirar `final_score,
  predicted_score, knn_score, knn_neighbors, prediction_distance, final_score_confidence,
  predicted_is_stub`; no comparador `compareByField` remover os `case` de `final_score`,
  `predicted_score`/`pred_score`, `knn_score`. Default sort já é `expected_score` (ok).
- **`server/queries/works.ts`**: tirar `final_score, predicted_score, predicted_is_stub` do
  select; remover o ramo `sort.field === "final_score"` (e qualquer `predicted_score`); manter
  `expected_score`.
- **`server/queries/score-thresholds.ts`**: parar de ler `final_score`/`predicted_score`;
  usar `expected_score` (ou `calc_score`) como base dos thresholds — **verificar a semântica**
  (o que essa query alimenta: cores de score por percentil).
- **`server/queries/similar-works.ts`**: trocar `finalScore` por `expectedScore` (ou
  `personalFit`, dependendo do que faz mais sentido pro card de similares).
- **`server/queries/calibration.ts`**: remover `final_score`/`finalScore` (era pro shadow
  compare). Manter `calc_score`.
- **`server/queries/recommendations.ts`**: remover `predicted_score`/`final_score`; o ranker
  já usa `expected_score`/`alignment_score`.

### 2. Components — remover opções/colunas legadas
- **`components/titles/calculation-breakdown.tsx`**: remover a seção `<details>` "Pipeline
  legado (debug — será removido após Fase 2)" e o array `STEPS` (entradas `predicted_score`/
  `final_score`); remover helpers órfãos resultantes (`confPr`, `confFinal`, leituras de
  `mae_predicted`/`predicted_is_stub`/`prediction_distance` e a prop `distanceP95`). Manter o
  `ExpectedWaterfall`.
- **`components/ranking/ranking-filters.tsx`** e **`components/settings/ranking-preferences-form.tsx`**:
  tirar `final_score`/`predicted_score` das listas de campos de sort/filtro.
- **`components/titles/work-table-config.ts`** e **`components/ranking/ranking-table-config.ts`**:
  remover as colunas `Nota.Final`/`Nota.Pr`/`knn` (definições de coluna).
- **`components/titles/work-table.tsx`**, **`work-heatmap-view.tsx`**, **`ranking-table.tsx`**:
  remover render de `finalScore`/`predictedScore`/`predicted_is_stub`.
- **`components/titles/work-compare-drawer.tsx`** e **`compare`**: remover linhas legadas.
- **`components/titles/similar-works-card.tsx`**: usar `expectedScore` em vez de `finalScore`.
- **`components/settings/calibration-panel.tsx`**: remover o **toggle do stacker**
  (`stacker_enabled`/`stacker_coefficients`) e os displays de `mae_predicted`/`maePredicted`.
  Manter o KPI honesto (`cv_mae_expected_stage1`), o `RidgeFeatureImportance` (já usa o
  expected) e os grupos novos.

### 3. App pages — listas de coluna
- **`app/ranking/page.tsx`**, **`app/favorites/page.tsx`**, **`app/titles/page.tsx`**: remover
  `"knn_score"` (e quaisquer `final_score`/`predicted_score`) das listas de colunas default.

### 4. Actions
- **`server/actions/settings.ts`**: remover a action de toggle do stacker (`setStackerEnabled`
  ou similar) e referências a `stacker_*`, `mae_predicted`, `prediction_distance`,
  `predicted_*`, `final_score`. **Conferir** se a action é importada em algum form do painel
  (remover o botão lá também).
- **`server/actions/compare.ts`**: remover `predicted_score`/`final_score`/`predicted_is_stub`
  das colunas comparadas.
- **`server/actions/post-reading-weight-suggestions.ts`**: remover uso de `final_score`.
- **`server/actions/synopsis-quality.ts`**: remover referência a `stacker` (era flag?).

### 5. Pipeline de import (cuidado — schema)
`predicted_score`/`final_score` aparecem como colunas **importáveis**:
- **`lib/validations/import.schema.ts`**: remover `predicted_score`/`final_score` do schema Zod.
- **`lib/import/mapper.ts`**: ⚠️ é **GERADO** por `sync-constants` (ver CLAUDE.md). NÃO editar à
  mão — remover os aliases dessas colunas na **fonte** (provavelmente não dá, pois mapper vem de
  `criteria`). **Verificar**: se `predicted_score`/`final_score` no mapper vêm de constantes de
  DB, talvez fiquem como colunas ignoradas no import. Decidir: ignorar no import vs. remover do
  gerador. Documentar.
- **`lib/import/processor.ts`**: parar de gravar `predicted_score`/`final_score`/
  `predicted_is_stub` ao processar linhas importadas.
- **`components/import/import-wizard.tsx`**: tirar essas colunas da UI de mapeamento.

### 6. Deletar lib órfãos (DEPOIS que tsc estiver limpo sem eles)
Confirmar orfandade com `grep -rn "<symbol>" --include=*.ts` antes de deletar. Candidatos:
- `lib/calculations/final.ts` (+ teste se houver) — `calculateNotaFinal`/`calculateNotaFinalChoosing`.
- `lib/calculations/stacker.ts` (+ `tests/.../` se houver) — `fitStacker`/`predictWithStacker`.
- `lib/calculations/prediction.ts` (+ `tests/unit/calculations/prediction.test.ts`) —
  `trainPredictor`/`ridgeOutOfFoldPredictions`. ⚠️ `expected.ts` tem só um **comentário**
  citando `ridgeOutOfFoldPredictions` (atualizar o comentário, não é dependência).
- `lib/ml/knn-predictor.ts` (+ teste) — `predictKnn`.
- `server/queries/knn-neighbors.ts` — `getKnnNeighborsBatch`.
- `lib/calculations/confidence.ts` (+ teste) — `calculateFinalScoreConfidence` (confirmar que
  não é usado por nada do expected).
- **`lib/calculations/index.ts`** (`calculateAll` single-work): usa `calculateNotaFinal`,
  `predictedScore`, `rmse_predicted`. ⚠️ **Verificar se `calculateAll` é usado** (provável no
  fluxo de criar/preview de obra). Se usado: reescrever pra produzir só `calc_score`/expected
  (ou o que o preview precisa). Se órfão: deletar.
- `lib/calculations/calibration.ts`: ainda é USADO (`computeCalibration` p/ `maeCalc`). NÃO
  deletar — apenas simplificar removendo a lógica de `predicted`/`final` se quiser (opcional).
- Tipos: `lib/ai-recommendation/types.ts`, `lib/ai-calibration/types.ts`,
  `lib/ml/post-reading-weight-inference.ts` — remover campos `predictedScore`/`finalScore`
  desses tipos/inputs (tsc guia).

### 7. Migration — dropar colunas mortas
Criar `supabase/migrations/NNN_drop_legacy_score_columns.sql`:
- `ALTER TABLE calculated_scores DROP COLUMN IF EXISTS predicted_score, predicted_is_stub,
  final_score, prediction_distance, final_score_confidence, knn_score, knn_neighbors,
  mae_predicted, rmse_predicted;`
- `ALTER TABLE formula_config DROP COLUMN IF EXISTS mae_predicted, rmse_predicted,
  distance_p95, stacker_coefficients, ridge_coefficients, stacker_enabled, gpt_std;`
  (⚠️ `gpt_mean` é REUSADO pelo recenter — **NÃO dropar**.)
- `calibration_history`: avaliar dropar `stacker_enabled, mae_loocv_stacker, mae_final,
  mae_predicted, stacker_coefficients` (são histórico append-only — pode manter pra não perder
  trendline antiga; decisão do dono).
- Rodar a migration no Supabase, depois `npm run sync-constants` se algum arquivo gerado
  depender (provável que não, mas conferir os 7 arquivos gerados).

### 8. Verificação final
- `npx tsc --noEmit` limpo.
- `npx eslint .` sem `no-unused-vars` novos.
- `npx vitest run` (ajustar/remover testes dos lib deletados).
- **Recalcular** pelo painel `/settings/calibration` e conferir: headline da Nota Prevista
  segue ~0.58; ranking ordena por `expected_score`; nenhuma coluna "Nota.Final/Nota.Pr/knn"
  sobrando; tela de detalhe sem o "Pipeline legado".
- Abrir no navegador: `/`, `/ranking`, `/titles`, `/titles/[id]`, `/favorites`,
  `/settings/calibration` — sem erro de render.

## Gotchas
- **`mapper.ts`/`normalizer.ts`/`criteria.ts` são GERADOS** — não hand-editar; ver seção
  "Constants generated from DB" no CLAUDE.md.
- **`predicted_is_stub` é `NOT NULL`** — só vira irrelevante após a migration dropar a coluna.
- **`gpt_mean` (formula_config)** agora é usado pelo recenter da Nota.Calc — preservar.
- O **import** pode trazer planilhas com colunas `predicted_score`/`final_score`; após remover
  do schema, decidir se erro ou ignora silenciosamente colunas desconhecidas.
- Ordenar/filtrar por campo removido: garantir que o `RankingFilters`/preferências não tenham
  um valor default ou salvo apontando pro campo removido (fallback pra `expected_score`).

## Sequência sugerida de commits
1. queries (reads) → 2. components + app pages → 3. actions → 4. import pipeline →
5. deleção de lib órfãos + testes → 6. migration. Rodar tsc/tests entre cada um.
