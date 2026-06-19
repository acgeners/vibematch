# Arquitetura — Orquestração de dependências e readiness dos dados da obra

> Desenho da **Fase A**, aprovado em 2026-06-18. Deriva da auditoria em
> [AUDITORIA-CICLO-VIDA-DADOS.md](AUDITORIA-CICLO-VIDA-DADOS.md). Implementação faseada;
> a Fase B passo 1 entrega **apenas a infraestrutura central** (sem integrar aos fluxos reais).
>
> **Nota (2026-06-19):** estado reconciliado com o backfill e o Plano 3 em
> [PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md](PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md).
> O `review_digest` segue **entrada futura/opcional** (não está no contrato de
> `predict_interest_potential`); as 112 previsões atuais foram geradas **sem digest**.

## Objetivo

Impedir que uma ação rode sem que seus pré-requisitos obrigatórios estejam prontos. Quando uma ação dependente é acionada, o sistema:
1. verifica pré-requisitos; 2. executa automaticamente os automáticos gratuitos ausentes/stale; 3. aguarda/rastreia; 4. roda a ação só quando pronta; 5. bloqueia com mensagem clara quando o pré-requisito é manual; 6. exige confirmação quando gera custo pago; 7. usa fallback explícito só para entradas realmente opcionais.

Sem dependências silenciosas nem baseadas na ordem acidental de `after()`.

---

## Decisões de arquitetura (aprovadas)

| # | Decisão | Escolha |
|---|---|---|
| D1 | Readiness derivado ou persistido? | **Derivado** (função pura sobre colunas existentes — `*_inputs_hash`, `*_version`, `stale`, `recalc_pending`). Não persistir readiness (evita 3ª fonte que também fica stale). |
| D2 | O que falta de verdade? | **Só rastreio de jobs assíncronos.** Uma tabela aditiva `work_processing_jobs`. |
| D3 | Granularidade do gate de custo | **Cascata + micro-threshold.** Confirma só quando o TOTAL estimado da cascata passa de `microThresholdUsd` (default **$0.02**). Sub-cent auto-libera. |
| D4 | Jobs duráveis agora? | **Sim** — `work_processing_jobs` no passo 1, com **fallback gracioso para single-flight em memória** enquanto a tabela não existir. |

**`cost_tier`** (refina as 4 categorias de entrada):

```
free      → TS puro, sem LLM (recalc, validação, hashes)              → auto sempre
micro     → 1 chamada barata (Haiku / 1 Sonnet), est. < threshold     → auto sem prompt (capability ainda vale)
metered   → escala com N (perfil 200 obras, lotes, digest em massa)   → exige confirmação de custo
manual    → nunca encadeável (avaliação IA, deep dive, alignment)     → bloqueia com instrução
```

Regra do gate (pura, em `cost.ts`):

```
estimatedUsd <= microThresholdUsd                      → auto         (sub-cent, silencioso)
allowPaid && (maxCostUsd==null || est<=maxCostUsd)     → auto         (pré-autorizado pelo caller)
allowPaid && est>maxCostUsd                            → blocked_over_cap
senão                                                  → needs_confirmation
```

---

## 1. Registro das ações (contratos)

`RAF`=required_automatic_free · `RAP`=required_automatic_paid · `RM`=required_manual · `OPT`=optional_with_fallback.

| Ação | Entradas obrigatórias | Opcionais (fallback) | Saída | cost_tier | Auto/Manual | Invalidação | Idempotência | Retry | Consumidores |
|---|---|---|---|---|---|---|---|---|---|
| create_work | form válido (`RAF`) | — | works+filhos, calculated_scores | free | user | — | title-hash | não | tudo |
| update_work | form válido (`RAF`) | — | campos + recalc pendente | free | user | edição→recalc_pending | — | não | scores |
| refresh_external_data | IDs aceitos (`RM`) | cada fonte (`OPT`) | dados externos, reviews | free | user | data_refreshed_at | ids-hash | sim | obra |
| consolidate_synopsis | ≥1 raw synopsis (`RAF`) | — | canonical_synopsis | micro | auto | canonical_synopsis_inputs_hash | `synopsis:{workId}:{hash}` | 3 | interest, recs |
| enrich_tags | tags novas (`RAF`) | — | group/subgroup/cluster | micro | auto | tag.group=null | `tags:enrich:{ids}` | engole | perfil/fit |
| acquire_reviews | IDs aceitos (`RM`) | cada fonte (`OPT`) | work_reviews | free | auto/opt-in | fetched_at | `reviews:{workId}` | engole | summary,digest,eval |
| generate_review_summary | ≥1 review (`RAF`) | — | review_summary | micro | auto | review_summary_inputs_hash (`hash:n`) | `summary:{workId}:{hash}` | engole | recs, deep-dive |
| generate_review_digest | ≥1 review (`RAF`) | — | review_digest | micro→metered (lote) | auto/batch | review_digest_version/_n | `digest:{workId}:{version}` | **falta hoje** | ranker, deep-dive |
| ensure_taste_profile | ≥10 obras com user_score (`RM` p/ não-stub) | — | taste_profile | metered | manual(pago) | input_hash vs biblioteca | `taste_profile:{inputHash}` | propaga | interest, fit, recs |
| predict_interest_potential | taste_profile não-stub (`RAP`); ≥1 sinopse (`RM`) | tags, canonical (`OPT`) | synopsis_quality_predictions | micro (perfil pronto) | auto/on-demand | taste_profile_hash ou canonical mudou | `interest:{workId}:{sig}` | engole | ranking (display) |
| run_ai_evaluation | contexto externo (`RM`) | reviews (`OPT`) | ai_evaluation* | metered | **MANUAL** | input_hash | `aieval:{workId}:{hash}` | 2 | review UI |
| recalculate_scores | works+scores (`RAF`) | scores IA, perfil (`OPT`) | calculated_scores | **free** | auto(1h)/manual | recalc_pending | global (coalesce) | guard | ranking |
| run_alignment | obra rankeável (`RM`) | — | alignment_score | metered | **MANUAL** | edição→stale | `align:{workId}` | — | ranking opc. |
| run_deep_dive | obra+contexto (`RM`) | digest/summary (`OPT`) | deep_dive_results | metered | **MANUAL** | — | `deepdive:{workId}` | — | UI |

Pontos materiais: consolidação/summary são **pagas (micro)** mas hoje silenciosas — o tier `micro` preserva isso sem violar "não disparar pago silenciosamente" (auto-liberação documentada). `predict_interest` é micro com perfil pronto, mas **metered** quando precisa gerar o perfil (cascata) — onde a confirmação importa. `generate_review_digest` é a única automática sem retry → fonte dos 2% de cobertura.

---

## 2. Grafo de dependências

```mermaid
flowchart LR
  FORM[form] --> CW[create_work] --> RECALC[recalculate_scores]
  CW -.enqueue.-> CONS[consolidate_synopsis]
  CW -.enqueue.-> ENR[enrich_tags]
  CW -.enqueue.-> ACQ[acquire_reviews]
  UW[update_work] -.markPending.-> RECALC
  ACQ --> SUM[generate_review_summary]
  ACQ --> DIG[generate_review_digest]
  CONS --> PRED[predict_interest_potential]
  TP[ensure_taste_profile] ==required==> PRED
  CONS -.fallback.-> PRED
  DIG -.FUTURO/opt.-> PRED
  AIE[run_ai_evaluation MANUAL] -.manual.-> RECALC
  classDef m fill:#ffe0e0,stroke:#c00; class AIE,TP m;
```

DAG válido (sem ciclos). Dependência implícita perigosa hoje: `predict ← consolidate` só funciona pela ordem acidental do mesmo `after()` — o orquestrador a torna explícita. Nenhuma ação automática exige `run_ai_evaluation`.

---

## 3. Estados de readiness

Por **data key** (`readiness.ts`): `absent | fresh | stale | partial`.

Por **ação** (resultado de `ensureActionReady`): `ready (complete|partial) | blocked_manual | blocked_cost_confirmation | processing | failed`.

| Estado | Condição objetiva |
|---|---|
| not_ready | falta entrada `required` não-produzível (sem sinopse; <10 rotuladas p/ perfil) |
| processing | job rodando (linha em `work_processing_jobs` status=running, ou em voo no single-flight) |
| ready_partial | saída via fallback ou faltam só `OPT` (interest com sinopse bruta, sem canonical/digest) |
| ready_complete | todas `required` + `OPT` automáticas frescas |
| stale | assinatura divergente (hash/version/flag) — nunca só `null` |
| failed | último job da ação status=failed (com last_error) |
| blocked_manual | falta `required_manual` (sem IDs aceitos; avaliação IA exigida) |
| blocked_cost_confirmation | cascata metered e `est > teto` sem `allowPaid` |

---

## 4. Persistência

**Readiness: derivado** (sem tabela). Resolver puro lê: `works.canonical_synopsis`/`_inputs_hash`, `review_summary`/`_inputs_hash`, `review_digest`/`_version`/`_n`, `synopsis_quality_predictions.stale`+`taste_profile_hash`, `taste_profile.is_current/is_stub/input_hash`, `formula_config.recalc_pending`, `tags.tag_group_id`.

**Jobs: 1 tabela aditiva `work_processing_jobs`** (ver migration 110). Justificativa: os hashes dizem *se o dado está pronto/stale*, não *se há job rodando, tentativas, erro, custo*. Granularidade (obra, ação); jobs globais com `work_id=null`. Índices: `(work_id, action)`, `unique parcial (dedup_key) where status in ('queued','running')` (dedup cross-processo), `(status) where status='failed'` (resume). Retenção: sucesso TTL 7–30d (purge); falhas até resolver. RLS on, sem policy (service-role). Volume baixo (~5–8 jobs/obra × 734, com TTL). Rollback: `drop table` reverte; orquestrador cai pra single-flight em memória.

---

## 5. Orquestrador — `lib/orchestration/`

```
contracts.ts  — registro declarativo das ações (§1) + DATA_KEY_PRODUCER
readiness.ts  — resolveReadiness(snapshot): readiness por data key (puro)
planner.ts    — buildPlan(action, snapshot): DAG topológico de pré-reqs faltantes/stale
cost.ts       — estimatePlanUsd + decideCost (micro-threshold)
jobs.ts       — JobStore (Supabase durável + InMemory fallback) + runOrchestratedJob (single-flight)
executor.ts   — createOrchestrator({runners, jobStore, config}).ensureActionReady(...)
index.ts      — API pública
```

```ts
ensureActionReady({ workId, action, snapshot, allowPaidDependencies, maxCostUsd, scaleByAction })
// → ready | blocked_manual | blocked_cost_confirmation | processing | failed
```

Fluxo: lê contrato → resolve readiness → buildPlan (só faltantes/stale) → blocked_manual? → estima custo → decideCost → confirmação? → executa pré-reqs em ordem topológica via `runOrchestratedJob` (dedup durável + single-flight) → roda a ação → retorna estado acionável. Os runners reais são **injetados** (DI) — a infra não está acoplada a `consolidateSynopsis`/LLM; a integração vem nas fases seguintes.

---

## 6. Interface (reações de UI)

| Estado | UI |
|---|---|
| ready | botão habilitado, executa |
| ready_partial | executa + badge "parcial: falta {digest…}" + "completar" |
| blocked_manual | botão desabilitado + motivo + **link para a etapa** (atribuir fontes / `/ai-evaluation`) |
| blocked_cost_confirmation | modal "Vou executar {passos}. Custo ~$X. Confirmar?" (uma confirmação p/ a cascata) |
| processing | spinner com jobs em voo; auto-continua ao concluir |
| failed | erro + Retry (reusa dedup_key) + last_error legível |
| stale | badge "desatualizado" + "Recalcular/Reprever" |

Nunca "dados insuficientes" genérico — sempre o item faltante + a ação.

---

## 7. Comportamento dos 13 casos obrigatórios

| # | Caso | Comportamento |
|---|---|---|
| 1 | Interest sem taste_profile | cascata metered → blocked_cost_confirmation (gerar perfil) ou blocked_manual se <10 obras |
| 2 | Interest com sinopse, sem digest | digest `OPT` → ready_partial, marca p/ reprocesso |
| 3 | Interest com digest stale | usa atual/ignora + ready_partial; enfileira refresh |
| 4 | digest sem reviews | blocked_manual/not_ready: "atribua fontes/atualize dados" |
| 5 | reviews sem summary | summary `RAF` micro → roda automático, aguarda |
| 6 | summary sem digest | digest `RAF` micro → roda; lote metered → confirma |
| 7 | recalc sem scores IA | scores IA `OPT` → roda com features parciais (ready_partial) |
| 8 | update deixou scores stale | readiness=stale; recalc free→auto |
| 9 | sinopse muda durante previsão | dedup_key inclui synHash → previsão velha descartada, nova enfileira |
| 10 | duas ações idênticas simultâneas | single-flight + unique(dedup_key) → 1 execução |
| 11 | job falha após produção parcial | linha failed + checkpoint no payload → resume idempotente |
| 12 | dependência paga acima do teto | blocked_cost_confirmation (over_cap); não executa |
| 13 | dependência manual ausente | blocked_manual com instrução; nunca simula |

---

## 8. Sequência da Fase B

1. **Infra central** (este passo) — contracts/readiness/planner/cost/executor/jobs + testes + migration 110 (não aplicada).
2. review_summary / review_digest (resolve o gap de retry do digest).
3. ensure_taste_profile (cascata metered + confirmação).
4. predict_interest_potential (consome 2+3; fecha o gap de re-previsão).
5. recalculate_scores (free auto + stale explícito).

Sem backfill, sem chamadas pagas, sem mexer em ranking/scores/modelo/prompt, sem reabrir Plano 3, sem aplicar migration automaticamente, avaliação IA segue manual.

---

## Critérios de aceite
Pré-requisito obrigatório não ignorável · free encadeia · pago confirma (cascata) · manual bloqueia com instrução · opcional vira parcial explícito · sem duplicação · falha resumível · stale detectado · UI explica o que falta · sem dependência de ordem de `after()` · TS/lint/build/test verdes.
