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
  `/curation/works`, abas **"Sem reviews"** e **"Sem tags"** têm botões de
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
- `/curation/works` → aba **"Sem reviews"** → filtrar (ex.: com fontes externas aceitas) →
  **"Buscar reviews em fila"** (teto 8/execução; repetir). Gera reviews + resumo + digest.
- Obras que já têm reviews mas sem digest: painel **"Digest de reviews"** em `/curation/settings`
  (`consolidatePendingReviewDigests`, ~10/clique) até zerar.
- ⚠️ Scraping depende de **FlareSolverr (Docker)** pro Comix/ComicK — ligar antes.

### 2. Maximizar tags
- `/curation/works` → aba **"Sem tags"** → **"Inferir tags em fila"** (teto 25/execução; repetir).
  Usa sinopse + digest/resumo (review-aware). Grava `source='ai_inferred'` (reversível).
- Alternativa em massa/CLI: `npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/infer-tags.ts --with-reviews --from-csv=...`
- Rodar **`npm run recalc:scores`** depois (tags entram nas features).

### 3. (Opcional) Re-avaliar atributos desatualizados por reviews
- `/curation/works` → aba "IA atributos" → filtro **"Reviews novas"** lista as obras cujo pool
  de reviews mudou após a avaliação. Re-avaliar incorpora as reviews novas nos
  `category_scores` (→ Nota Prevista). **Opcional** e custa Sonnet — só onde valer.

### 4. Backfill do Interesse (e1)
- **Dry-run primeiro** (custo $0): `planInterestBackfill()` → mostra fresh/stale/absent +
  custo estimado (~**$8 provável / ~$12 upper** medido em 2026-06-27).
- Confirmar e **executar**: `runInterestBackfill({ maxCostUsd })` (ou pela UI de backfill, se exposta).
  É pago (predictor de Interesse) → roda com `allowPaid`; concorrência limitada, dedup, resume.
- Re-rodar até zerar os "absent/stale".

### 5. Verificar
- Painel **`/curation/model-metrics`** (métricas/shadow).
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

---

# EXECUÇÃO (log) — 2026-06-27/28

> Operação conduzida em **camadas** (estratégia: começar pelos mais "prontos"+relevantes,
> melhorar qualidade antes do e1, depois próxima camada). Tudo via `--work-id` escopado;
> previsões em `synopsis_quality_predictions` (NÃO aplicadas ao `works.synopsis_quality`
> exibido — o rótulo manual continua autoritativo).

## Pré-requisitos
- Migrations **119** (toggle canônica) e **120** (`reviews_hash` + `ai_eval_reviews_stale`) — **confirmadas aplicadas** no banco (colunas existem).

## 🐛 Bug de produção encontrado + corrigido (PR #15)
O digest entrava na `input_signature` REAL da previsão (`extraSources:{reviewDigest}`), mas
era **omitido em 3 dos 4 call-sites** de `computeInterestInputSignature`:
1. `ensurePredictInterest` **Re-check 1** (`synopsis-interest.ts`) → descartava TODA obra-com-digest como stale (1ª execução das 315: `changedDuringRun=315`, 0 salvas, só perfil pago).
2. `classifySig` e 3. `planItemSig` do **planner** (`interest-backfill.ts`) → marcariam digest-works como stale em re-planos futuros.

**Fix:** passar `extraSources` nos 3. Os 4 call-sites agora incluem o digest.
✅ **Teste de regressão** (`interest-backfill.test.ts` 6b): obra com digest cuja previsão foi feita COM o digest deve ficar `fresh` — confirmado que **falha sem o fix** (classifica stale) e passa com ele. 230 testes orq OK.

## Camadas executadas
| # | Escopo | Ação | Resultado | Custo real |
|---|---|---|---|---|
| 1 | Filtro `>3 reviews ∧ ≥20 tags ∧ pers∉{Completed,Dropped,Stalled} ∧ pub≠Cancelled` = **315** | digest dos 55 sem digest → backfill e1 | 55/55 digest; 315/315 v3 (perfil v13→v14 + recalc) | $1,04 + $3,40* |
| — | das 63 (digest, sem v3) com **<20 tags** = **25** | inferência de tags review-aware (Haiku) + verify (Sonnet) | 171 tags (138 alta + 33 média); 15/25 → ≥20 tags | ~$0,40 |
| 2 | **63** (digest, sem manual, sem v3) | backfill e1 | 63/63 v3 (perfil v14→v15 + recalc) | $1,11 |
| 3 | Grupo A **11** (Stalled, rev≥10, tags≥20) + Grupo B **25** (tinham 3–4 reviews) | digest dos 11 → backfill e1 das 36 | 11/11 digest; 36/36 v3 (perfil v15→v16 + recalc) | $0,26 + $0,91 |

\* inclui $0,52 de uma 1ª tentativa que regenerou o perfil mas descartou as 315 (pelo bug acima); re-executada após o fix por $2,88.

**Estado final: 414 obras com previsão e1 (v3).** Custo total da operação ≈ **$7,1**.

## ⚠️ Processo automático noturno (06-27→06-28)
Um job do app (aquisição de reviews + consolidação de digest) rodou entre as sessões e
**mudou o catálogo**: digest 458→469, reviews-sem-digest 168→132, +reviews em várias obras,
1 obra **renomeada**. NÃO faz previsão e1 (v3 inalterado até rodarmos). **Lição: re-baselinar
o estado do banco a cada sessão** — listas de ids em cache ficam stale; casar por título quebra
com rename (usar id).

## Ferramentas adicionadas
- `scripts/e1-prod-scope.ts` — fonte ÚNICA do filtro e1 (4 critérios) + escreve ids; `npm run e1:scope`.
- `scripts/e1-prod-digest.ts` — consolida digest escopado (filtro e1 **ou** `--ids-file=<lista>`), dry-run/execute + gate de custo + resume; `npm run e1:digest`.
- Backfill reusa o CLI existente: `npm run backfill:interest -- --work-id=<ids> ...`.

## Gotchas operacionais
- **`--work-id` precisa ser repetido no `--execute`** (a assinatura embute o escopo; a sugestão impressa pelo dry-run OMITE o `--work-id` → sem ele dá `plan_changed`, a trava agindo certo).
- **`infer-tags.ts --execute` grava work_tags mas NÃO marca `recalc_pending`** → o `recalc:scores` sugerido não roda sozinho. Workaround: `markRecalcPending` + `recalculateScoresHeadless`.
- Cada **regen de perfil** deixa previsões anteriores stale-vs-perfil-novo (benigno — não aplicadas ao exibido); p/ múltiplas camadas, enriquecer tags de todas ANTES + 1 backfill único evita pagar regen repetido.
- Rótulos humanos (`works.synopsis_quality` source=`human_manual`) **nunca** são tocados pelo backfill (só `synopsis_quality_predictions`); previsão sobre obra rotulada = sinal de acurácia.
