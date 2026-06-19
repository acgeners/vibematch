# Plano de backfill orquestrado do catálogo

> **Prompt 2 — Etapa 1 (inventário read-only + plano).** Sessão exclusivamente de
> análise/planejamento — **nenhuma escrita, job, migration, LLM ou lote** foi
> executado. Deriva de [AUDITORIA-CICLO-VIDA-DADOS.md](AUDITORIA-CICLO-VIDA-DADOS.md)
> e [ARQUITETURA-ORQUESTRACAO.md](ARQUITETURA-ORQUESTRACAO.md). Os números foram
> **re-medidos no banco** (não copiados dos documentos). A implementação do executor
> é a Etapa 2 — **não** faz parte desta entrega.

## Legenda de proveniência (rigor exigido)

| Marca | Significado |
|---|---|
| 🟦 **CÓDIGO** | Fato verificado no código (com `arquivo:linha`) |
| 🟩 **BANCO** | Fato medido por query `SELECT`/`count` read-only em 2026-06-18 |
| 🟨 **INFERÊNCIA** | Dedução a partir dos dois acima — não medido diretamente |
| 🟧 **DECISÃO** | Proposta minha, depende de aprovação da usuária |

> **Como os números foram medidos:** script temporário `scripts/_inventory-backfill.mjs`
> (somente `select`/`count(head)` + paginação), rodado com `node --env-file=.env.local`,
> **removido ao fim** (relatado na §16). Custos = aritmética pura espelhando
> [lib/orchestration/cost.ts](lib/orchestration/cost.ts) sobre o pricing real
> ([lib/ai/pricing-data.json](lib/ai/pricing-data.json)). Sem chamada paga.

---

## 1. Snapshot read-only atual (🟩 BANCO, 2026-06-18)

```
734   works ativas (is_archived=false)        3 arquivadas
─────────────────────────────────────────────────────────────
canonical_synopsis ..... 734 / 734  (100%)    0 ausente   0 sem sinopse utilizável
tags (grupo) ........... 0 tags sem grupo  ·  0 obras com tag não-enriquecida
tags (subgrupo) ........ 22 tags sem subgroup_id  (fora do escopo da orquestração)
work_reviews ........... 7363 linhas · 7292 úteis (texto ≥40)
  obras com review ..... 503  ·  obras com review útil 503  ·  sem review 231
  IDs externos aceitos . 734 / 734  (100%)  ·  obras sem fonte de review 0
review_summary ......... 503 presente · 231 ausente (todas as 231 sem review)
review_digest .......... 14 presente  · 720 ausente  ·  489 ausentes COM reviews
taste_profile .......... v6 atual, não-stub, 2026-06-05 · 6 versões · 192 obras rotuladas
interest predictions ... 1026 linhas (v2=737, v1=289) · input_signature NULL em 100%
                         stale=826 / fresh-flag=200
recalc ................. recalc_pending=false · recalc_last_edit_at=null (config 2026-06-15)
work_processing_jobs ... 0 linhas (tabela vazia — slate limpo)
```

**Migrations relevantes — todas APLICADAS (🟩 probe no banco):**
`work_processing_jobs` (110) · `synopsis_quality_predictions.input_signature` (111) ·
`tags.tag_subgroup_id` (044).

**Mudança vs. AUDITORIA (🟩):** a auditoria de 2026-06-16/17 reportava `tags sem grupo`
como risco; hoje **0 tags sem grupo** e **0 obras com tag não-enriquecida** — o
enriquecimento de grupo está 100%. Canonical segue 100%. Logo, **canonical e tags
não têm universo de backfill** (ver §2).

---

## 2. Matriz por operação

Estados de readiness por **data key** vêm de [readiness.ts](lib/orchestration/readiness.ts);
contratos (`costTier`, requisitos) de [contracts.ts](lib/orchestration/contracts.ts).

| Operação | 🟦 costTier | Universo a processar (🟩) | Bloqueado (🟩) | Já fresh (🟩) | Integração durável existe? (🟦) | Classe |
|---|---|---|---|---|---|---|
| **recalculate_scores** | `free` | 0 agora (`recalc_pending=false`) | — | catálogo | ✅ [recalc-queue.ts:54](server/actions/recalc-queue.ts#L54) | **A** |
| **consolidate_synopsis** | `micro` | **0** (canonical 100%) | — | 734 | ❌ ainda `after()` solto | n/a |
| **enrich_tags** (grupo) | `micro` | **0** (0 tags s/ grupo) | — | 725 | ❌ ainda `after()` solto | n/a |
| **generate_review_summary** | `micro` | **0 p/ cobertura** (0 ausentes c/ review) | 231 (sem review) | 503 | ✅ [persist-reviews.ts:90](lib/external/persist-reviews.ts#L90) | **B** (só refresh) |
| **generate_review_digest** | `micro→metered` | **489** (ausente c/ reviews) | 231 (sem review) | 14 | ⚠️ só **por-obra** ([persist-reviews.ts:106](lib/external/persist-reviews.ts#L106)); **sem lote orquestrado** | **B** |
| **ensure_taste_profile** | `metered` | **≤1** (perfil global) | — (192 ≥ 10) | v6 (🟨 provável stale) | ✅ [ensure-profile.ts:41](lib/ai-recommendation/ensure-profile.ts#L41) | **C** |
| **predict_interest_potential** | `micro` | **537 stale** (até 734 se perfil regerar) | 0 | ~197 (condicional) | ✅ lote: [synopsis-quality.ts:248/287](server/actions/synopsis-quality.ts#L248) | **B** |
| **acquire_reviews** | `free` | 231 sem review (opt-in) | — (IDs aceitos: 734) | 503 | ❌ ainda `after()` solto | **D** |
| run_ai_evaluation / alignment / deep_dive | `metered`/`manual` | — | — | — | manual | **E** |

> **Leitura crítica (🟨):** o único backfill **metered de escala** real é o
> **digest** (489 obras). Interesse (537) é micro-por-obra mas metered no agregado.
> Summary **não tem universo de cobertura** (toda obra com review já tem summary) —
> só refresh opcional. Canonical/tags **não têm backfill**. Perfil é 1× global.

### Detalhe por área

**1. Sinopse canônica** — 🟩 734/734 presente, 0 ausente, 0 sem sinopse utilizável.
Produtor `consolidate_synopsis` (🟦 contrato `micro`, Haiku). **Não integrado à
orquestração durável** (🟦 não existe `integrations/consolidate-synopsis.ts`; roda em
`after()`). **Conclusão:** backfill **desnecessário** (cobertura total). Staleness por
hash (`canonical_synopsis_inputs_hash`) **não foi medida** — exigiria recomputar o
hash de consolidação (🟨); como o consumidor (Interesse) já usa a canônica atual e a
cobertura é 100%, não é gargalo.

**2. Enriquecimento de tags** — 🟩 1478 tags, **0 sem grupo**, 22 sem subgroup_id, 725
obras com tags, **0 obras com tag não-enriquecida** (group=null). Produtor `enrich_tags`
(🟦 `micro`, produz `tags_enriched` = grupo). **Não integrado à orquestração** (🟦
`after()`). **Conclusão:** backfill de grupo **desnecessário**. Subgrupo (22 tags) **não
é um data key da orquestração** (🟦 `DataKey` não tem `tags_subgrouped`) → fora deste
backfill; é a Fase B da camada de sub-grupos (etapa separada, ver memória do projeto).

**3. Reviews** — 🟩 503 obras com review útil; 231 sem nenhuma review; **734/734 com IDs
externos aceitos**. Distinção pedida:
- *ausente por nunca ter buscado* vs *ausente por não haver fonte*: **não distinguível
  só pelos dados atuais** (🟨) — todas as 231 têm IDs aceitos, então a fonte existe no
  papel; a ausência é "nunca buscada com sucesso OU fonte não produziu review".
- `acquire_reviews` é 🟦 `free` mas **opt-in/manual** (contrato: `required_manual` em
  `external_ids_accepted`, e o passo é disparado pelo usuário). **Não transformar
  ausência em operação automática** — classe **D**.

**4. Review summary** — 🟩 503 presente, 231 ausente; **0 ausentes têm review** (todo
ausente é por falta de review). `staleByMateriality = 491` é **UPPER BOUND** (🟨): o
gate real ([reviews.ts:59](lib/orchestration/integrations/reviews.ts#L59)) é
`hash igual → fresh` ANTES da materialidade; como **não recomputei o hash de
conteúdo**, 491 superconta (muitos têm `n` legado nulo → materialidade=true por
definição). **Stale real exige recompute** — provavelmente bem menor. Cobertura nova
necessária = **0**.

**5. Review digest** — 🟩 14 presente, 720 ausente; staleByVersion=0, staleByCount=0;
**489 ausentes COM reviews** (universo de backfill), 231 ausentes sem review
(bloqueado). Gate ([reviews.ts:79](lib/orchestration/integrations/reviews.ts#L79)):
versão (`digest-v1`) + materialidade. **Diferença "tudo vs. elegível":** processar
"tudo" (734) bate em 231 `blocked_manual` (sem review) + 14 `skipped` (fresh) → só **489
elegíveis** de fato.

**6. Taste profile** — 🟩 v6 atual (`prompt_version` interno v2), não-stub, 2026-06-05;
192 obras rotuladas (≥10 → **não** `blocked_manual`). **Staleness não verificada por
recompute** (🟨): exigiria reproduzir `getRatedWorksForProfile` + `computeInputHash`
([recommendations.ts:290](server/queries/recommendations.ts#L290),
[taste-profile.ts:10](lib/ai-recommendation/taste-profile.ts#L10)). Como a biblioteca
evoluiu desde 2026-06-05 e o `input_hash` muda a cada edição de nota/tag, o perfil é
**quase certamente stale** (🟨). Backfill exigiria: **uma** atualização global (metered,
escala 192) — **ou nenhuma**, se a usuária optar por manter v6. Contado **no máximo 1×**.

**7. Potencial de Interesse** — 🟩 1026 linhas (v2=737 atual, v1=289 legado de prompt
antigo), **input_signature NULL em 100%** (migration 111 aplicada mas nenhuma previsão
re-rodou pela integração nova). Para o prompt atual `v2` sobre 734 elegíveis:

| Estado (🟩, dual-read) | Qtde | Definição (🟦 [synopsis-interest.ts:92](lib/orchestration/integrations/synopsis-interest.ts#L92)) |
|---|---|---|
| ausente | **0** | sem linha v2 (todas as 734 têm) |
| fresh moderno (sig) | **0** | `input_signature` == assinatura atual (nenhuma tem sig) |
| stale moderno (sig) | **0** | `input_signature` != assinatura |
| **stale legado (flag)** | **537** | `input_signature`=null **e** `stale=true` → re-prever |
| fresh legado (hash) | **197** | `stale=false` **e** `taste_profile_hash == assinatura do perfil atual** |
| bloqueado (sem perfil/sinopse) | **0** | 192 ≥ 10 e 734 têm sinopse |

> ⚠️ **Os 197 "fresh legado" são condicionais** (🟨): só são fresh se o hash bater com a
> assinatura **do perfil atual**, que **não recomputei** (loader-dependente). Se o perfil
> for regerado, `markSynopsisPredictionsStale` (🟦 [taste-profile.ts](lib/ai-recommendation/taste-profile.ts))
> marca **todas** stale → universo salta de **537 → 734**.
> O prompt da previsão **não inclui** review_digest/summary/qualidade/popularidade/
> scores/ranking — confirmado no contrato (🟦 [contracts.ts:208](lib/orchestration/contracts.ts#L208)).
> Modelo/prompt/schema/níveis **permanecem intocados**.

**8. Recalculate scores** — 🟩 `recalc_pending=false`, `recalc_last_edit_at=null` →
estado **fresh**, **0 a recalcular agora**. Global, gratuita (🟦 `free`,
[recalculate-scores.ts](lib/orchestration/integrations/recalculate-scores.ts)). Contar
**no máximo 1 execução** (e só se algum passo do backfill marcar `recalc_pending`).

---

## 3. Blockers

| Blocker | Qtde (🟩) | Natureza | Ação |
|---|---|---|---|
| Sem review → sem summary/digest | 231 obras | `not_ready: no_reviews` (🟦 [reviews.ts:238](lib/orchestration/integrations/reviews.ts#L238)) | `acquire_reviews` é **opt-in** (classe D); **não automatizar** |
| Perfil **stale** trava previsão "limpa" | global | `blocked_cost_confirmation: profile_cascade` se `allowPaid=false` (🟦 [synopsis-interest.ts:223](lib/orchestration/integrations/synopsis-interest.ts#L223)) | decisão §15: regerar perfil ou prever contra v6 |
| <10 rotuladas p/ perfil | **0** (tem 192) | — | não aplicável |
| Dados impossíveis de produzir automaticamente | 231 (review) | falta de conteúdo de fonte | só via `acquire_reviews`/avaliação manual |

Nenhum blocker é "dado faltando no schema" — todos são **conteúdo ausente** (review) ou
**decisão de custo** (perfil). Não há job abandonado/failed travando dedup (🟩 jobs=0).

---

## 4. Custos prováveis e upper bounds (🟩 computado sobre pricing real)

Gate sempre usa **upper bound** = `likely × COST_SAFETY_MULTIPLIER (1.5)` (🟦 [cost.ts:29](lib/orchestration/cost.ts#L29)).
Micro-threshold = **$0.02** (🟦 [cost.ts:20](lib/orchestration/cost.ts#L20)).

**Por operação (unitário):**

| Op | modelo | escala | likely | upper | nota |
|---|---|---|---|---|---|
| predict_interest_potential | Sonnet | 1 | **$0.011** | **$0.016** | upper < $0.02 → **1 obra auto-libera**; lote soma → confirma |
| ensure_taste_profile | Sonnet | 192 | **$0.387** | **$0.581** | global, 1× |
| generate_review_digest | Sonnet | 40 | **$0.077** | **$0.115** | escala = `min(reviews úteis, 40)` |
| generate_review_summary | Haiku | 40 | **$0.021** | **$0.031** | só refresh |

**Por cenário de catálogo (totais):**

| Cenário | obras | likely | upper |
|---|---|---|---|
| **Interesse — só stale** | 537 | **$5.64** | **$8.46** |
| Interesse — todas v2 (se perfil regerar) | 734 | $7.71 | $11.56 |
| Perfil + Interesse stale | 1 + 537 | $6.03 | $9.04 |
| Perfil + Interesse todas | 1 + 734 | $8.09 | $12.14 |
| **Digest backfill (exato, `min(n,40)` por obra)** | 489 | **$23.32** | **$34.98** |
| Summary refresh (UPPER, ignora short-circuit de hash) | 491 | $4.69 | $7.04 |
| recalculate_scores | catálogo | **$0.00** | **$0.00** |

> **Custo total do backfill "completo" recomendado** (🟧 perfil + Interesse stale +
> digest, sem summary refresh): **~$29 provável / ~$44 upper**. Se a usuária regerar o
> perfil, Interesse vai a 734 → **~$31 provável / ~$47 upper**. **Summary refresh fica
> de fora** (universo incerto, baixo valor).

---

## 5. DAG do backfill (validado no código)

```mermaid
flowchart TD
  INV[inventário read-only] --> FREE[recalculate_scores · free · no-op hoje]
  INV --> DIG[digest backfill · 489 · metered · INDEPENDENTE]
  INV --> PROF{regerar taste_profile?}
  PROF -- sim --> TP[ensure_taste_profile · 1x · metered]
  PROF -- não --> PRED
  TP -. markSynopsisPredictionsStale .-> PRED[predict_interest · 537→734 · metered]
  PRED --> RECALC2[recalculate_scores final · se pendente]
  ACQ[acquire_reviews · OPT-IN · 231] -.manual.-> DIG
  classDef m fill:#ffe0e0,stroke:#c00; class TP,DIG,PRED m;
  classDef opt fill:#eef,stroke:#66c; class ACQ,PROF opt;
```

**Dependências confirmadas (🟦):**
- `predict_interest` depende de `taste_profile` (`required_automatic_paid`) +
  canonical/tags (`optional_with_fallback`). **Não** depende de digest/summary/scores/
  avaliação IA (contract [contracts.ts:208](lib/orchestration/contracts.ts#L208)).
- `digest` depende só de `reviews` (`required_automatic_free`) → **independente** do
  perfil e do Interesse; pode rodar em paralelo.
- Regerar perfil **invalida todas** as previsões (🟦 `markSynopsisPredictionsStale`) →
  por isso perfil **antes** de Interesse.
- `recalculate_scores` é free/global → no fim, só se algo marcou `recalc_pending`.
- `taste_profile` processado **no máximo 1×** (dedup por `input_hash`,
  🟦 [taste-profile.ts:57](lib/orchestration/integrations/taste-profile.ts#L57)).
- Previsões fresh **não entram no custo** (skip-fresh, 🟦 [synopsis-interest.ts:279](lib/orchestration/integrations/synopsis-interest.ts#L279)).
- Dual-read legado preservado (🟦 [synopsis-interest.ts:92](lib/orchestration/integrations/synopsis-interest.ts#L92)).

---

## 6. Fases recomendadas (🟧)

| Fase | Ação | Custo upper | Confirma? | Observação |
|---|---|---|---|---|
| 0 | Inventário/dry-run | $0 | não | read-only |
| 1 | Resolver blockers manuais | $0 | — | `acquire_reviews` opt-in p/ as 231 (decisão; fora do auto) |
| 2 | `recalculate_scores` | $0 | não (free) | no-op hoje (`recalc_pending=false`) |
| 3 | **Confirmar perfil** (se regerar) | $0.58 | sim (1×) | cascata; invalida previsões |
| 4 | **Digest backfill** (489) | $34.98 | sim | lote próprio, independente |
| 5 | **Interesse stale/ausente** (537→734) | $8.46–$11.56 | sim (cascata) | após perfil |
| 6 | `recalculate_scores` final | $0 | não | só se algum passo marcou pending |

Fases 4 e 5 são **independentes** e podem ser confirmadas/rodadas separadamente
(digest não alimenta Interesse hoje). Uma confirmação por **plano aprovado**, não por op.

---

## 7. Estratégia de dry-run (Etapa 2)

Reutilizar o padrão existente `planInterestBatch` (🟦 [synopsis-interest.ts:537](lib/orchestration/integrations/synopsis-interest.ts#L537),
read-only, **não executa**) e **criar** um `planDigestBatch` espelhado. O dry-run
**não faz nenhuma chamada paga** (só `loadCurrentPrediction`/`readArtifact`). Retorno:

```
{ totalAnalisado, fresh, stale, ausente,
  blocked_manual, blocked_cost_confirmation, processing, failed,
  likelyUsd, upperBoundUsd,
  acoesPlanejadas: [{op, n, likelyUsd, upperBoundUsd}],
  dependencias: ["taste_profile→interest", ...],
  planSignature }
```

---

## 8. Confirmação

- **Uma confirmação para a cascata aprovada** (perfil→Interesse), não op-a-op (🟦
  já é assim em [interest-ui.ts:27](lib/orchestration/integrations/interest-ui.ts#L27)
  `profile_cascade`). Digest é cascata separada → confirmação própria.
- Confirmação baseada em **upper bound** (🟦 gate usa `upperBoundUsd`).
- A confirmação **não** pode ser reaproveitada para outro plano nem para entradas
  alteradas → atrelar à **assinatura do plano** (§9). Se a assinatura mudar, a
  confirmação antiga é inválida.

---

## 9. Assinatura do plano (🟧)

`planSignature = sha256` de:

```
{ scope:        { n: <count obras elegíveis>, libraryDigest: <hash de id+updated_at ordenados> },
  profileSig:   computeProfileSignature(perfil atual ou "regen"),
  versions:     { predictPrompt:"v2", interestSchema:"v1", digestVersion:"digest-v1", summaryPrompt:"v2" },
  perOpTargets: { digest:489, interest:537|734, summary:0 },
  caps:         { microThresholdUsd:0.02, maxCostUsd:<teto>, mode:"profile_regen"|"keep_v6" } }
```

**Não usar timestamp** como assinatura (🟦 anti-padrão já evitado em
[recalculate-scores.ts:52](lib/orchestration/integrations/recalculate-scores.ts#L52)).
Qualquer obra nova, regeneração de perfil, bump de versão ou mudança de teto **muda a
assinatura** → bloqueia execução com confirmação velha. Não precisa de tabela: a
assinatura vive no token de confirmação da action e/ou no `payload` do job (🟦
`work_processing_jobs.payload`).

---

## 10. Batches

| Parâmetro | Interesse | Digest | Base (🟦) |
|---|---|---|---|
| executor | reusar `runInterestBatch` | **criar** `runDigestBatch` espelhado | [synopsis-interest.ts:614](lib/orchestration/integrations/synopsis-interest.ts#L614) |
| tamanho do lote | streaming por worker (sem chunk fixo) | idem | worker loop por índice |
| concorrência | 3 (default) | **2** (Sonnet pesado) | `concurrency` arg |
| ordenação | estável por `id`/`updated_at` (stale antes) | por `id` | determinística p/ resume |
| soft-cap | `acc >= maxCostUsd → blocked++` | idem | 🟦 [synopsis-interest.ts:626](lib/orchestration/integrations/synopsis-interest.ts#L626) |
| hard-cap | `maxCostUsd` passado a cada item decrementado | idem | 🟦 [synopsis-interest.ts:636](lib/orchestration/integrations/synopsis-interest.ts#L636) |
| custo perto do teto | para de iniciar novos itens | idem | já implementado p/ Interesse |
| dados mudam no meio | re-check de assinatura no runner descarta output velho → `stale` (não cobra) | digest re-checa versão/materialidade | 🟦 [synopsis-interest.ts:332](lib/orchestration/integrations/synopsis-interest.ts#L332) / [reviews.ts:331](lib/orchestration/integrations/reviews.ts#L331) |

> **Lacuna a fechar na Etapa 2:** `runDigestBatch` **não existe** — o único lote de
> digest hoje é `consolidatePendingReviewDigests` (🟦 [settings.ts](server/actions/settings.ts),
> 10/run) que **bypassa a orquestração** (sem job/dedup/gate de custo). A Etapa 2 deve
> criar o lote orquestrado reusando `ensureReviewDigest` (que já tem job/dedup/gate).

---

## 11. Retry / resume

Tudo já suportado pela infra durável (🟦 [jobs.ts](lib/orchestration/jobs.ts)):

| Necessidade | Mecanismo (🟦) |
|---|---|
| retomar após falha | `claim` reusa a linha `failed`, incrementa `attempts`, requeue ([jobs.ts:224](lib/orchestration/jobs.ts#L224)) |
| pular itens fresh | `ensure*` retorna `fresh`/`skipped` sem custo ([synopsis-interest.ts:279](lib/orchestration/integrations/synopsis-interest.ts#L279)) |
| reusar jobs failed | índice único parcial garante 1 transição `failed→queued` ([110:39](supabase/migrations/110_work_processing_jobs.sql#L39)) |
| evitar repetir concluídas | dedup_key por assinatura + re-check anti-cobrança-dupla no runner ([synopsis-interest.ts:338](lib/orchestration/integrations/synopsis-interest.ts#L338)) |
| **jobs `running` abandonados** | ⚠️ **GAP**: não há TTL/reaper. Um `running` órfão **trava** o dedup_key (índice único parcial). Ver §13/§15. |

---

## 12. Cancelamento

🟦 **A infra NÃO tem cancelamento real** — não há flag de cancel em
`work_processing_jobs`, nem `AbortSignal` em `runOrchestratedJob`
([jobs.ts:363](lib/orchestration/jobs.ts#L363)). **Não inventar.** Comportamento seguro
proposto (🟧):

- **parar de iniciar novos itens** — flag cooperativa lida no loop do worker
  (`while idx < workIds.length`); barato de adicionar sem mexer no motor.
- **deixar os em voo concluírem** (jobs já `running` terminam normalmente).
- **persistir progresso** — já é durável (cada item é um job).
- **retomar depois** — re-rodar o lote pula fresh e reusa failed.

---

## 13. Concorrência e observabilidade

**Concorrência:** Interesse 3, digest 2 (🟧 Sonnet mais caro/lento). Single-flight +
dedup cross-processo garantem 1 execução por assinatura mesmo com abas/processos
paralelos (🟦 [jobs.ts:363](lib/orchestration/jobs.ts#L363)).

**Observabilidade** — `InterestBatchReport` já entrega quase tudo (🟦
[synopsis-interest.ts:581](lib/orchestration/integrations/synopsis-interest.ts#L581));
estender p/ digest e expor:

```
planejados · processados · succeeded · failed · skipped · fresh
custoEstimado · custoReal · tempo · ultimoErro(sanitizado)
```

Erro sempre **sanitizado** (🟦 `sanitizeErrorMessage`, [jobs.ts:79](lib/orchestration/jobs.ts#L79)).
**Sem redesign de UI nesta etapa** — só retorno tipado / painel mínimo (reusar o de
`/admin/model-metrics` ou `/settings`).

---

## 14. Migrations necessárias ou desnecessárias

**A Etapa 2 NÃO precisa de migration nova** (🟦 análise):

| Pergunta | Resposta |
|---|---|
| `work_processing_jobs` basta p/ status/retry/custo/dedup? | **Sim** ([110](supabase/migrations/110_work_processing_jobs.sql)) |
| readiness por assinatura existe? | **Sim** (`input_signature` [111](supabase/migrations/111_synopsis_interest_input_signature.sql) aplicada; digest/summary usam versão/hash) |
| assinatura do plano precisa de tabela? | **Não** — derivável do dry-run; cabe no token de confirmação / `payload` do job |
| reaper de `running` órfão precisa de coluna? | **Não** — `started_at` já existe; reaper é só uma query por idade |

**Opcional (🟧, NÃO recomendado agora):** uma tabela `backfill_runs` (ledger
nível-execução, à la `recommendation_runs`) daria histórico cross-sessão de um "run"
com progresso agregado. **Dispensável**: `work_processing_jobs` já dá durabilidade
por-op e o relatório do lote cobre o agregado. Se um dia for desejada:
- **dado que falta:** identidade de "run" (1 linha) agregando N jobs + planSignature +
  custo total + status.
- **por que `work_processing_jobs` não basta:** ele é por-op, sem conceito de "run".
- **schema mínimo:** `id, plan_signature, mode, planned, succeeded, failed, skipped,
  cost_estimate_usd, cost_actual_usd, status, created_at, finished_at`.
- **rollback:** `drop table backfill_runs` (aditiva, não-destrutiva).

---

## 15. Critérios de aceite da futura implementação (Etapa 2)

1. **Dry-run primeiro**, sempre, sem nenhuma chamada paga; retorna os campos da §7.
2. Nenhuma chamada paga em **render/build** (guard `isProductionBuildPhase`, 🟦
   [build-phase.ts](lib/orchestration/integrations/build-phase.ts)) nem em **background**
   (perfil nunca regerado em background, 🟦 [synopsis-interest.ts:201](lib/orchestration/integrations/synopsis-interest.ts#L201)).
3. **Uma confirmação por plano**, atrelada à `planSignature`; confirmação velha com
   entrada alterada → re-confirma.
4. **Perfil contado 1×**; previsões fresh **fora do custo**; dual-read legado intacto.
5. `maxCostUsd` + soft-cap **param antes** de ultrapassar o teto.
6. Custo não-finito / modelo desconhecido → **bloqueia** (🟦 [cost.ts:118](lib/orchestration/cost.ts#L118)).
7. **Sem** mudança de modelo/prompt/schema/níveis/fórmula/ranking; digest **não** entra
   no prompt de Interesse.
8. `runDigestBatch` reusa `ensureReviewDigest` (job/dedup/gate) — não o lote legado.
9. Resume reusa failed, pula fresh; reaper opcional de `running` órfão.
10. TS/lint/build/test verdes; testes do executor sem DB/LLM (gateways injetáveis).

---

## 16. Riscos e decisões que dependem da usuária

**Decisões (🟧 — precisam de você):**

| # | Decisão | Recomendação | Base |
|---|---|---|---|
| D1 | **Regerar taste_profile** antes do backfill de Interesse? | **Sim, se a biblioteca mudou materialmente** desde 2026-06-05; senão prever contra v6 (537, mais barato) | Regerar → 734 previsões (+~$3 upper) + perfil $0.58; ganho = previsões refletem gosto atual |
| D2 | **Digest backfill** agora (~$23–35)? | **Adiar** — digest **não** alimenta Interesse hoje (é Plano 3); só serve ranker/deep-dive pagos | Custo alto, valor só no fluxo pago; sem dependência do Interesse |
| D3 | **Summary refresh** (491 upper)? | **Pular** — cobertura já 100%, stale real incerto | Universo superestimado; baixo retorno |
| D4 | `acquire_reviews` p/ as 231 sem review? | **Opt-in manual**, fora do backfill automático | É free mas I/O externo e pode não render review |
| D5 | Teto `maxCostUsd` do lote? | **$15** cobre Interesse+perfil com folga; **$40** se incluir digest | Upper bounds da §4 |

**Riscos (🟨/🟦):**

- 🟨 **Staleness do perfil não confirmada por recompute** — afirmo "provável stale" por
  inferência (biblioteca evoluiu); a Etapa 2 deve recomputar `input_hash` no dry-run
  para número exato antes de cobrar.
- 🟨 **197 "fresh legado" condicionais** — se o perfil regerar, viram stale (universo
  537→734). O dry-run da Etapa 2 deve recomputar a assinatura do perfil p/ fixar isso.
- 🟦 **Sem reaper de `running` órfão** — um crash deixa o dedup_key travado; mitigação:
  reaper por `started_at` antigo (não há hoje).
- 🟦 **`summary staleByMateriality=491` é upper bound** — não confundir com stale real
  (precisa recompute de hash).
- 🟦 **Lote de digest orquestrado não existe** — `consolidatePendingReviewDigests` é
  legado e bypassa o gate de custo; **não** reusar como backfill.

---

## 17. Próximo passo (escopo exato da Etapa 2 — NÃO implementar agora)

Implementar **apenas** o executor de backfill **read-mostly + opt-in pago**, escopo
mínimo:

1. `planBackfill()` — dry-run agregado (perfil + Interesse + digest), recomputando a
   assinatura do perfil e o `input_hash` da biblioteca p/ números exatos; retorna §7 +
   `planSignature`.
2. `runBackfill(planSignature, { mode, maxCostUsd })` — confirma 1×, roda fases
   3→4→5→6 via os `ensure*`/`run*Batch` existentes (criando `runDigestBatch`),
   respeitando cap/skip-fresh/resume.
3. Painel/retorno de observabilidade (§13), sem redesign.
4. Flag cooperativa de "parar de iniciar" (§12). Reaper de `running` órfão (opcional).

**Sem** migration, **sem** mudar fórmula/modelo/prompt/schema, **sem** tocar no Plano 3,
**sem** automatizar `acquire_reviews`.

---

# Anexos (requisitos ampliados)

## 18. Estado desejado do catálogo

> Vocabulário de readiness usado abaixo (e na §20): `fresh` · `stale` ·
> `missing_actionable` (ausente E produzível automaticamente) · `not_applicable`
> (ausência **legítima** — não é falha) · `blocked_manual` (falta entrada manual) ·
> `failed` (último job falhou, retomável). **Cobertura desejada ≠ 100% por padrão.**

| Dado | Cobertura atual (🟩) | Cobertura desejada (🟧) | Obrigatório? | Condição de aplicabilidade | Ausência legítima (`not_applicable`) | Produtor (🟦) |
|---|---|---|---|---|---|---|
| canonical synopsis | 734/734 (100%) | 100% das obras com ≥1 sinopse bruta | **Sim** (hard p/ Interesse) | tem ≥1 sinopse bruta | obra sem nenhuma sinopse | `consolidate_synopsis` |
| tags enriquecidas (grupo) | 725/725 c/ tag (100%) | 100% das obras com tags | Não (opt+fallback) | tem ≥1 tag | obra sem tags (9 obras) | `enrich_tags` |
| reviews brutas | 503/734 (69%) | **best-effort** (NÃO 100%) | Não | tem IDs externos aceitos | fonte sem reviews | `acquire_reviews` (opt-in) |
| review summary | 503/503 c/ review útil (100%) | 100% **das obras com review útil** | Não (opt consumer) | ≥1 review texto ≥40 | sem review útil (231) | `generate_review_summary` |
| review digest | 14/734 (2%) | **decisão de produto** (§23) | Não | ≥1 review texto ≥40 | sem review (231) | `generate_review_digest` |
| taste profile | 1 (v6, 🟨 stale) | **1 fresh global** | **Sim** p/ Interesse | ≥10 obras rotuladas (tem 192) | <10 rotuladas → stub | `ensure_taste_profile` |
| Potencial de Interesse | ~197 fresh¹/537 stale | 100% **das obras com sinopse**, fresh vs perfil atual | Não (display) | tem sinopse + perfil não-stub | sem sinopse OU sem perfil | `predict_interest_potential` |
| calculated scores | 734/734 (100%) | 100% fresh | **Sim** (sort do ranking) | toda obra | nenhuma | `recalculate_scores` |

¹ condicional à assinatura do perfil atual (🟨, ver §2.7). **Regra anti-100%:** review
summary/digest **só** para obras com review útil; Interesse **só** com sinopse; reviews
**não** são forçadas — `acquire_reviews` é opt-in.

---

## 19. Snapshot informativo — dados FORA do backfill (🟩, só diagnóstico)

> **Classificação explícita: diagnóstico informativo · fora do backfill atual · NÃO
> executar automaticamente.** Nenhum destes é pré-requisito de operação automática
> (🟦 confirmado: `recalculateAll`/`expected` **não** leem summary/digest/previsão; e
> nenhum fluxo auto exige `run_ai_evaluation`/`alignment`).

| Dado | Cobertura (🟩) | Stale (🟩) | Produtor | Dependências | Consumidores |
|---|---|---|---|---|---|
| category_scores | 726/734 c/ ≥9 critérios | n/a (sem versão) | avaliação IA / form (manual) | contexto externo (manual) | GPT.N, expected_score |
| ai_evaluation | 718 obras `completed` (status works: 717 done · 11 skipped · 6 pending) | por `input_hash` | `triggerAiEvaluation` (**manual**) | contexto externo | review UI, category_scores |
| personal_fit | 734/734 (100%) | via `recalc_pending` (global) | `recalculateAll` (free) | taste_profile (opt) | ranking, tiers |
| alignment (Veredito IA) | 450/734 (61%) | 2 stale (`alignment_stale`) | re-rank **manual/pago** | obra rankeável | ranking opcional |

**NÃO planejar backfill de:** `ai_evaluation`, `alignment`, `deep_dive`, `ranking`.
**Não** transformá-los em pré-requisitos de operações automáticas.

---

## 20. Classes operacionais de obras (🟩)

Estados **ortogonais** — uma obra participa de várias classes (não force exclusão mútua).

| Classe | Qtde | Critério (readiness/SQL) | Operação que resolve | Resolúvel auto? |
|---|---|---|---|---|
| prontas (Interesse fresh + scores fresh) | ~197¹ | prediction v2 `stale=false` ∧ hash perfil bate | — | — |
| parcialmente prontas | (fallback) | usa sinopse bruta / tags não enriquecidas | reprocesso opcional | sim |
| sem sinopse utilizável | **0** | `canonical IS NULL ∧ sem work_synopses` | — | **não** (`not_applicable`) |
| sem reviews | **231** | `work_id ∉ work_reviews(texto≥40)` | `acquire_reviews` (opt-in) | **não** (manual) |
| com reviews sem summary | **0** | review útil ∧ `review_summary IS NULL` | `generate_review_summary` | sim |
| com summary stale | ≤491² | hash difere ∧ material | `generate_review_summary` | sim |
| com summary sem digest | **489** | review útil ∧ `review_digest IS NULL` | `generate_review_digest` | sim (metered) |
| com digest stale | **0** | `version≠digest-v1 ∨ material` | `generate_review_digest` | sim |
| previsão fresh moderna | **0** | `input_signature = assinatura atual` | — | — |
| previsão fresh legada | ~197¹ | `input_signature NULL ∧ stale=false ∧ hash bate` | — | — |
| previsão stale moderna | **0** | `input_signature ≠ assinatura` | `predict_interest` | sim |
| previsão stale legada | **537** | `input_signature NULL ∧ stale=true` | `predict_interest` | sim |
| previsão ausente | **0** | sem linha v2 | `predict_interest` | sim |
| scores stale | **0** | `formula_config.recalc_pending=true` (global) | `recalculate_scores` | sim (free) |
| bloqueadas por ação manual | 231 | sem review (p/ summary/digest) | `acquire_reviews` / manual | **não** |
| com falha anterior retomável | **0** | `work_processing_jobs.status='failed'` | resume (reusa dedup_key) | sim |
| não aplicáveis | 231 (review) | ausência legítima | — | **não** |

¹ condicional (§2.7). ² upper bound (§2.4 — short-circuit de hash não medido).

**Sobreposições relevantes (🟩):**
- Interesse stale (537) = **338 com reviews úteis** + **199 sem reviews**.
- **335 obras** precisam de **ambos**: digest backfill **e** re-previsão de Interesse
  (são operações **independentes** — não há ordenação entre elas).
- digest backfill (489) ⊇ não-subconjunto de Interesse stale: digest cobre obras que o
  Interesse pode já considerar fresh, e vice-versa.

**Casos não resolúveis automaticamente:** 231 obras sem review (summary/digest
impossíveis sem `acquire_reviews` manual); obras sem perfil não-stub (não é o caso hoje:
192 ≥ 10).

---

## 21. Análise ampliada de custo e duração (🟩 histórico de `ai_api_calls`)

> **Regras:** médias históricas e cache são **diagnóstico** — **não** reduzem o upper
> bound nem servem de teto de autorização; o **upper bound** (contrato × 1.5) é a base
> da autorização. Custo/modelo/estimativa não-finita **bloqueia** (🟦 [cost.ts:118](lib/orchestration/cost.ts#L118)).
> Duração é **faixa aproximada**, não promessa — rate limit do provider não medido.

| Op | elegíveis | fresh evitados | chamadas | mín. teórico³ | **likely** | **upper (autoriz.)** | hist. médio/call (🟩) | latência hist. p50/max (🟩) | faixa duração⁴ | concorrência segura |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--|--|
| generate_review_summary | 0 cobertura | ~12 | 0 (só refresh ≤491²) | — | $0.021 | $0.031 | **$0.0032** (n=586) | 3.9s / 12.5s | n/a | 3 |
| generate_review_digest | 489 | 14 | 489 | $4.1 | $0.077 | $0.115 | **$0.0197** (n=17) | 16.0s / 20.8s | **~40–70 min** | **2** |
| ensure_taste_profile | ≤1 | 0/1 | 1 | $0.32 | $0.387 | $0.581 | **$0.388** (n=8) | 62.8s / 68.6s | ~1 min | 1 |
| predict_interest_potential | 734 | ~197¹ | 537 (→734) | $2.8 | $0.011 | $0.016 | **$0.0097** (n=1089) | 6.1s / 36.8s | **~15–25 min** | 3 |

³ mín. teórico = `min observado/call × chamadas` — **não usar como teto**. ⁴ faixa =
`chamadas ÷ concorrência × latência p50`; ignora rate limit (não medido) → **incerta**.

**Diagnóstico de custo real vs. upper (🟩 — só para contexto, NÃO altera autorização):**
o upper de contrato é **conservador**: digest real ~$9.6 (489×$0.0197) vs upper $35;
Interesse real ~$5.2 (537×$0.0097) vs upper $8.5. A folga é proposital (sinopses/reviews
longas). **Autorizar pelo upper.**

**Cache / reutilização (🟩):**
- **Cache que existe:** `ai_cache_events` (mig 107) + single-flight em-processo (🟦
  [jobs.ts:363](lib/orchestration/jobs.ts#L363)). Chave: `dedup_key` (action:work:assinatura).
- **Quantas chamadas evita realisticamente:** para backfill de **obras distintas**,
  **~0** — o cache de conteúdo só ajuda repetições do mesmo input. 🟩 `ai_cache_events`
  tem só **4 eventos de resolução** (todos `ai_evaluation`) — os 4 ops do backfill **não
  logam hits** hoje (memória: hits→Plano 2). A real economia é **skip-fresh** (197
  Interesse + 14 digest), **comprovada** no código, não cache.
- **Comprovado vs estimado:** skip-fresh = **comprovado** (🟦 retorna `fresh`/`skipped`
  sem custo). Economia por cache de conteúdo = **estimada ~0** (sem dados).

---

## 22. Regra de consistência do taste profile (🟧 design da Etapa 2)

O executor deve fixar **uma única assinatura de perfil por execução aprovada** e
registrar no `payload` do job / token do plano:

```
profile_id · profile_signature (computeProfileSignature) · profile_version (funcional, ex. v6)
· input_hash (biblioteca) · plan_signature
```

Comportamento (espelha o que já existe em 🟦 [synopsis-interest.ts](lib/orchestration/integrations/synopsis-interest.ts)):
- **perfil muda ANTES do início** → recalcular o plano e **reconfirmar** (plan_signature muda).
- **perfil muda DURANTE o lote** → **não iniciar** novas previsões com a confirmação
  antiga; itens em voo terminam mas o resultado segue sujeito ao **re-check de assinatura
  já existente** (🟦 [synopsis-interest.ts:332](lib/orchestration/integrations/synopsis-interest.ts#L332) descarta output de assinatura antiga).
- **nunca misturar** previsões de perfis diferentes no mesmo plano (a assinatura embute
  `profileSignature`).
- mudança de perfil **não** pode deixar o catálogo stale indefinidamente → o **dry-run
  visível** (§7) é o plano de regularização: ele sempre mostra quantas ficaram stale.

**Não criar/atualizar perfil nesta etapa.**

---

## 23. Avaliação específica do review digest (🟩/🟦)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Obras com reviews texto suficiente | **503** (≥1 review ≥40) — 489 sem digest + 14 com |
| 2 | fresh / stale / ausente / n.a. | 14 fresh · 0 stale · 489 `missing_actionable` · **231 `not_applicable`** |
| 3 | custo provável / upper | $23.3 / $35.0 (contrato) — real hist. ~$9.6 (🟩) |
| 4 | custo histórico médio | **$0.0197/call** (n=17, Sonnet) |
| 5 | campos consumidos | `salient_traits/consensus/divergence/execution/content_warnings` (🟦 schema [review-summarizer.ts](lib/ai-recommendation/review-summarizer.ts)) |
| 6 | fluxos que ganham valor | **ranker pago** (🟦 [recommendations.ts:285](server/queries/recommendations.ts#L285) `fetchReviewDigestsBatch`) + **deep-dive** (precedência sobre summary). **NÃO** o Interesse, **NÃO** o sort do ranking |
| 7 | redundância com summary | parcial: summary (Haiku, UI) é o **fallback** do ranker quando digest falta; digest (Sonnet, estruturado) agrega traços que o summary não tem |
| 8 | validar qualidade em piloto | 10–20 obras: comparar ranker/deep-dive **com vs sem** digest; checar schema válido + traços coerentes com as reviews |
| 9 | critérios de parada do rollout | falhas de API > limite · estouro de custo vs upper · digest com traços alucinados · sem lift mensurável no ranker |

**Tratar o digest como backfill separado** (decisão D2, §16). **Não** gerar digest para
obra sem texto utilizável. **Não** adicionar o digest ao prompt atual de Interesse.

---

## 24. Superfície futura de execução (🟧 — NÃO implementar)

| Opção | Reusa orquestrador | Risco fluxo paralelo | dry-run | confirm | resume | cancel | observab. | segurança | operável | local | efeito em render/build |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Script CLI** | ✅ chama `ensure*`/`run*Batch` | baixo | fácil | flag explícita | ✅ jobs | flag cooperativa | stdout/JSON | sem rota pública | ✅ | ✅ | **nenhum** (não há render) |
| Admin Server Action/UI | ✅ | médio (revalidate/render) | botão | modal | ✅ | botão | painel | precisa gate de rota | médio | ❌ | risco se rodar em render |
| Estender batches existentes | ✅ direto | baixo | já existe (`planInterestBatch`) | já existe | ✅ | parcial | report | — | médio | parcial | baixo |
| Híbrido (CLI + painel read-only) | ✅ | baixo | CLI | CLI | ✅ | CLI | painel lê jobs | ✅ | ✅ | **nenhum** (escrita só no CLI) |

**Recomendação (🟧): Híbrido** — **CLI** dispara o backfill (dry-run padrão, execução
explícita, fora do ciclo de render/build → zero risco de chamada paga em prerender) e um
**painel read-only** (reusa jobs/relatório) observa o progresso. O CLI reusa os `ensure*`
e o lote durável — **não cria fluxo paralelo** nem o lote legado de digest.

Argumentos conceituais do CLI (**NÃO fixar/implementar agora**; dry-run é o **padrão**,
execução exige opção explícita):

```
--dry-run (default) · --execute · --step <op> · --work-id <id> · --limit N
--batch-size N · --concurrency N · --resume · --max-cost-usd X
--only-missing · --include-stale · --retry-failed
```

---

## 25. Estratégia futura de rollout (🟧 — proposta, sem executar)

**Fase R0 — piloto gratuito:** só `recalculate_scores` (free) + dry-runs. Valida
readiness, dedup, jobs, resume e relatórios. **Zero LLM.**

**Fase R1 — piloto pago pequeno (10–20 obras):** amostra cobrindo, quando possível: com
reviews / sem reviews / summary-sem-digest / digest-stale / previsão-stale / previsão-
ausente / previsão-legada / fontes de sinopse distintas (canonical vs raw). **Antes de
rodar, apresentar:** plano assinado · likely · upper · `maxCostUsd` · ops exatas ·
**perfil (id/signature) que será usado**.

**Fase R2 — lote controlado:** batches iniciais **pequenos** (NÃO assumir 25/50 — definir
por custo, latência medida na §21, rate limit, duração do job, taxa de falha, capacidade
de resume). Sugestão de partida (🟧): digest 20–40/rodada (latência ~16s, conc. 2);
Interesse 50–100/rodada (latência ~6s, conc. 3) — **calibrar pelo R1**.

**Fase R3 — catálogo completo:** só **após** R1 aprovado · custo real medido · falhas
compreendidas · dedup comprovada · retry/resume validado · relatório antes/depois conferido.

---

## 26. `recalculate_scores` no backfill (🟦 confirmado no código)

Tratar como **global · free · coalescida · `work_id = null`** (🟦
[recalculate-scores.ts:84](lib/orchestration/integrations/recalculate-scores.ts#L84)).
**Nunca** um recálculo por obra. No plano completo, **no máximo 1 execução final**, e só
quando `recalc_pending = true` **ou** quando um passo alterar entrada **comprovadamente**
consumida por `recalculateAll`.

**Verificação (🟦):** `recalculateAll`/`expected.ts`/`score.ts`/`gpt.ts` **não** leem
`review_summary`, `review_digest` nem `synopsis_quality_predictions` (grep sem matches).
**Logo:** gerar summary/digest/previsão **não** dispara recalc. As entradas reais do
recalc são `category_scores`, `platform_ratings`, `synopsis_quality` (manual),
`taste_profile` (p/ personal_fit) — nenhuma é tocada por este backfill. **Não** alterar
fórmulas/ranking/regras de staleness.

---

## 27. Esquema mínimo de evidências da execução futura (🟧)

Por item × operação, a Etapa 2 deve emitir:

```
work_id · action · plan_signature · dedup_key · estado_anterior · readiness_anterior
· dependências · assinaturas_de_entrada · ação_executada · estado_posterior
· readiness_posterior · job_id · attempts · custo_estimado · custo_real · duração
· erro_sanitizado · versão_funcional · timestamp
```

**Já existe em `work_processing_jobs` (🟦, sem persistência redundante):** `id` (=job_id),
`action`, `dedup_key`, `status`, `attempts`, `cost_estimate_usd`, `cost_actual_usd`,
`error_category`, `last_error` (sanitizado), `payload` (carrega plan_signature/assinaturas/
versão), `created_at/started_at/finished_at` (→ duração derivada).

**Derivável (não persistir):** `duração` = `finished_at − started_at`;
`readiness_anterior/posterior` = recomputar do snapshot; `dependências` = do contrato;
`custo_real` agregado = `sum(cost_actual_usd)`.

**NUNCA registrar:** prompt completo · secrets · tokens/credenciais · conteúdo integral
desnecessário · stack trace exposto à UI (🟦 `sanitizeErrorMessage` já garante,
[jobs.ts:79](lib/orchestration/jobs.ts#L79)).

---

## 28. Critérios de conclusão + formato do relatório final futuro (🟧)

**Concluído (mensurável por op) quando:**
- todos os itens **aplicáveis obrigatórios** fresh (canonical, calculated_scores, perfil);
- ausências legítimas classificadas `not_applicable` (231 sem review);
- dependências manuais **explicitamente bloqueadas e relatadas** (não executadas);
- stale elegível processado **ou** permanece como falha **retomável**;
- **nenhuma** op manual executada automaticamente;
- **nenhum** output fresh reprocessado sem necessidade (skip-fresh comprovado);
- **sem** duplicação (dedup_key);
- custos **dentro dos tetos** autorizados (`maxCostUsd`/soft-cap);
- jobs `failed` retomáveis;
- scores globais atualizados quando aplicável;
- relatório mostra cobertura **antes e depois**;
- diferença planejado × executado explicada.

**O backfill NÃO exige output para todo item** — `not_applicable` é estado de conclusão
válido.

**Formato do relatório final futuro:**

```
cobertura antes/depois (por dado)
custos por operação (estimado vs real)
custo por item
chamadas evitadas (skip-fresh)
falhas e causas (sanitizadas)
retries
staleness resolvida
itens não aplicáveis
itens bloqueados (manual)
jobs restantes (queued/running/failed)
decisões pendentes da usuária
```

---

# 29. Etapa 2A — IMPLEMENTADA (executor seguro: perfil + Potencial de Interesse)

> Status: **implementada e validada** (2026-06-18). **Nenhum backfill real foi
> executado** — sem chamada paga, sem LLM, sem previsão real, sem regeneração de
> perfil. Validada com mocks/no-op + `InMemoryJobStore` + dry-run read-only no banco.
> NÃO altera os fatos históricos do inventário (§1–§28). Escopo: `ensure_taste_profile`
> + `predict_interest_potential` + `recalculate_scores` final (quando aplicável).
> **Fora**: digest/summary/acquire_reviews/canonical/tags/ai_eval/alignment/deep_dive/
> ranking/Plano 3 (não iniciados).

### Arquivos
- [lib/orchestration/backfill/interest-backfill.ts](lib/orchestration/backfill/interest-backfill.ts) — domínio (planner + assinatura + executor + gateway bulk read-only). Reusa `ensureTasteProfile`/`ensurePredictInterest`/`ensureRecalculateScores`/`estimateStep`/jobs — sem duplicar readiness/custo.
- [lib/orchestration/backfill/cli-args.ts](lib/orchestration/backfill/cli-args.ts) — parsing + validação Zod (puro).
- [scripts/backfill-work-data.ts](scripts/backfill-work-data.ts) — CLI híbrida (casca fina).
- [tests/unit/orchestration/interest-backfill.test.ts](tests/unit/orchestration/interest-backfill.test.ts) — 32 testes (planejamento/confirmação/execução/build).
- `package.json` — script `backfill:interest`.

### Comando de dry-run (PADRÃO; read-only)
```
npm run backfill:interest
```
Saída validada no banco real (2026-06-18): perfil **stale** → ação `regenerate`, 734
elegíveis (fresh 186 / stale 548 / ausente 0 / bloqueadas 0), 734 previsões planejadas,
recalc final **sim**, upper **$12.141**, `planSignature` + comando de execução impressos.
**Confirma empiricamente** a inferência da §2.6/§16 (perfil v6 estava de fato stale).

### Política de perfil (§decisão de produto, objetiva — não pela data)
`classifyTasteProfileReadiness` compara `currentLibraryInputHash` vs `currentProfile.input_hash`:
- **fresh** (hashes iguais + current + não-stub) → plano só com stale/ausentes.
- **stale** (hash diverge) → `regenerate` + prever **todas** as elegíveis + recalc final.
  **Não** prevê parcialmente contra perfil stale (sem bypass silencioso).
- **blocked_manual** (<10 rotuladas) → nenhuma previsão; sem stub artificial.

### Assinatura do plano (`computeInterestPlanSignature`, sha256)
Determinística sobre forma canônica (listas ordenadas; **sem timestamp**, sem ordem de
query): `scope (workIds ordenados)` · `profilePolicy` · `profileState` ·
`libraryInputHash` · `profileSignature` (ou `PENDING_PROFILE_REGEN`) · versão funcional
do perfil · `model/promptVersion/schemaVersion` · `costVersion` (pricing tag) · `items`
(workId + assinatura de entrada esperada + reason, ordenados) · `plannedActions` ·
`likelyUsd`/`upperBoundUsd` (arredondados). Mudança em obra/perfil/modelo/prompt/schema
**muda** a assinatura; ordem do banco **não**; ordem-só-de-tags **não** (a assinatura de
entrada ordena tags). NUNCA contém sinopse/perfil/reviews/prompt íntegros.

### Confirmação e gate de custo agregado
`runInterestBackfill` exige `planSignature` + `maxCostUsd`; (1) **re-planeja** integralmente;
(2) **aborta** se a assinatura divergir ("O catálogo ou o perfil mudou desde o dry-run.
Gere um novo plano e confirme novamente."); (3) **aborta** se `upperBound > maxCostUsd`.
A pré-autorização vale só p/ a assinatura/itens/versões/teto aprovados. O lote é metered:
o micro-threshold individual ($0.02) **não** o autoriza (teste 20).

### Executor / resume / cancelamento
- Perfil 1× (dedup por `input_hash`); previsões com **concorrência limitada** (default 3,
  máx 5); skip-fresh sem custo; dedup durável + single-flight (2 processos ⇒ 1 chamada);
  **soft-cap** (`acc + upperPróximo > maxCostUsd` ⇒ não inicia) — custo desconhecido nunca
  é zero; recalc global free/coalescido/`work_id=null` **1×** só quando o perfil foi
  regenerado (personal_fit derivado fica stale; ver abaixo).
- **Resume** derivado do estado (readiness + jobs + assinaturas): re-dry-run remove fresh,
  reusa `failed` via claim durável (só com `--retry-failed`), reporta `processing`.
- **Cancelamento cooperativo** (SIGINT/SIGTERM): para de iniciar novos itens; em-voo
  terminam; estado parcial; resume posterior. **Sem** cancelamento de chamadas já iniciadas.
- **Perfil muda durante a execução** → para de iniciar novos itens (validação opcional de
  assinatura entre itens); a proteção dura contra escrita inválida é o re-check por item
  já existente em `ensurePredictInterest` (output de assinatura antiga é descartado).

### Recalculate scores (verificado no código)
`insertNewTasteProfile` ([taste-profile.ts:144](lib/ai-recommendation/taste-profile.ts#L144))
faz `markAllProfilesAsStale` + `markSynopsisPredictionsStale` mas **NÃO** marca
`recalc_pending` / `touch_recalc_pending`. Logo uma nova versão de perfil deixa
`personal_fit` (derivado por `recalculateAll`) **stale** sem agendar recálculo. Integração
mínima da Etapa 2A: o executor roda **exatamente um** `recalculate_scores` (global, free,
coalescido, `work_id=null`, via `ensureRecalculateScores`/injetável) ao final **quando o
perfil foi regenerado** — nunca por obra, sem tocar fórmulas. Coberto por testes 31/32.
(O caminho pago standalone de perfil em [ensure-profile.ts](lib/ai-recommendation/ensure-profile.ts)
segue sem marcar `recalc_pending` — observação pré-existente, fora do escopo 2A.)

### Build / render
`runInterestBackfill` curto-circuita sob `isProductionBuildPhase()` (teste 34/35); o módulo
não tem efeito colateral por import (teste 33); o dry-run lê o banco mas não é importado por
rota/componente. Só a CLI explícita inicia trabalho.

### Limites conhecidos
- **Jobs `running`/`queued` órfãos**: detectados e **avisados** no dry-run (idade ≥30min);
  **sem reaper automático** (não muda status). Recuperação futura: inspecionar
  `work_processing_jobs` e, comprovado o abandono, requeue manual do `dedup_key`.
- **Validação de mudança de perfil mid-run** é opcional (dep injetável) p/ não custar N
  leituras; a garantia primária é o re-check por item.
- **Migration**: nenhuma criada/necessária — usa `work_processing_jobs` + `input_signature`
  + hashes/versões existentes.
- **Execução real do digest/summary/aquisição**: não iniciada (fora do escopo 2A).
