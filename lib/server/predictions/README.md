# Previsões prospectivas — `prediction_ledger` × `prediction_snapshots`

O projeto tem **duas** estruturas de captura de previsão. Elas são distintas e
não devem ser misturadas; não criar uma terceira sem revisitar este doc.

| Estrutura | Migration | Responsabilidade |
|---|---|---|
| `prediction_ledger` | 101 | **Legado.** Captura UMA previsão por obra, congelada no instante da **primeira** `user_score` (resolve no mesmo evento; `unique(user_id, work_id)`). `server/actions/prediction-ledger.ts` → `capturePredictionForFirstRating`. **Não usar para novas métricas de ranking prospectivas.** Não apagar/migrar nesta etapa. |
| `prediction_snapshots` | 105 | **Sistema prospectivo atual.** Múltiplos snapshots **imutáveis** por obra × fórmula × contexto × execução de ranking, registrados **antes** do rótulo e resolvidos depois. Base das métricas prospectivas (MAE/RMSE/baselines/ordenação). `lib/server/predictions/*`. |

## Camada `prediction_snapshots`

- **`prediction-context.ts`** (puro): schemas Zod, `buildDedupKey` (regra dependente
  de contexto — ver abaixo), `getPredictionDateBucket` (dia em `America/Sao_Paulo`),
  `decideResolution` (pendente→resolve / mesma nota→noop / nota nova→**relabel**).
- **`record-prediction.ts`** (server-only): `recordPredictionSnapshots`,
  `recordRecommendationSnapshots` (só obras SEM nota = leak-free, agrupadas por run).
- **`resolve-prediction.ts`** (server-only): casa a nota real com os snapshots
  pendentes (UPDATE condicional → idempotente/seguro sob concorrência).
  `markPredictionLabelChanged` carimba a edição/remoção de nota.
- **`collection-status.ts`**: classifica a disponibilidade da tabela (ativa,
  migration ausente, erro de conexão, erro inesperado) e dedup de warning.
- **Métricas puras**: `lib/metrics/prediction-metrics.ts` (por obra × por snapshot,
  baselines, cobertura) e `lib/metrics/ranking-metrics.ts` (Spearman/Kendall/
  pairwise/NDCG/Precision/regret, por `ranking_snapshot_id`).
- **Leitura/painel**: `server/queries/prediction-metrics.ts` → `/admin/model-metrics`
  (usa **apenas** `prediction_snapshots`).

## Regra de deduplicação (`dedup_key`)

- **Recomendação/ranking** (`ranking_snapshot_id` presente):
  `ranking::{ranking_snapshot_id}::work::{work_id}`. Cada run preserva o conjunto
  completo; a mesma obra pode ter vários snapshots no mesmo dia em rankings
  diferentes (necessário pras métricas de ordenação). Dentro do mesmo ranking a
  obra não duplica.
- **Eventos individuais** (sem ranking):
  `event::{user}::{work}::{formula}::{context}::{mood}::{dia America/Sao_Paulo}`.

## Por que não persistir erros (Opção A)

`abs/sq/signed error` **não** são colunas — são derivados de
`predicted_score`/`actual_user_score` nas funções puras. Assim nunca divergem das
notas. Só a nota real + timestamps são gravados na resolução.

## Edição de nota = relabel, não invalidação

A 1ª nota observada após a previsão (`actual_user_score`) é **imutável** e a
medição prospectiva (predição × 1ª nota) **permanece nas métricas** mesmo se a
nota for editada ou removida depois — só carimbamos `label_changed_at`
(auditoria). `superseded` é **invalidação MANUAL** (nota registrada por erro,
snapshot inválido, problema técnico) e NÃO é setado por edição normal. As
métricas excluem `superseded`.

## Stub = fora das métricas

`predicted_is_stub` = previsão em fallback (média do treino, sem modelo real, ex.:
< 20 rótulos). É **excluída** de TODAS as métricas (principal, por snapshot,
ranking, baselines, por fórmula); o painel mostra a contagem separada.

## Seleção por métrica

| Métrica | Seleção |
|---|---|
| Global principal | 1 previsão por **obra** (`selectPrimaryPredictionPerWork`) |
| Por fórmula | 1 previsão por **obra × fórmula** (`selectPrimaryPredictionPerWorkAndFormula`) — comparação pareada |
| Por snapshot (diagnóstica) | todos os snapshots válidos |
| Ranking | por `ranking_snapshot_id` (sem dedup global de obra) |

Em todas, "primeira avaliação real" = menor `resolved_at` da obra; escolhe-se o
snapshot mais recente capturado ANTES dela; stub/superseded excluídos.
