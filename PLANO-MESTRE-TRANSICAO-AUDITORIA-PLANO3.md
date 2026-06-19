# PLANO-MESTRE — Transição Auditoria → Backfill → Plano 3

> **Etapa Ponte (reconciliação)** — 2026-06-19. Sessão **read-only** (banco só por `SELECT`,
> zero LLM, zero escrita, zero migration). Fonte de verdade: **código atual + banco
> reconsultado hoje**; os documentos históricos são preservados, mas podem estar
> desatualizados. Proveniência: 🟦 código (`file:line`) · 🟩 banco (read-only, 2026-06-19)
> · 🟨 inferência · 🟧 decisão/recomendação.
>
> **Objetivo único desta etapa:** reconstruir o estado das três frentes, mapear as
> dependências entre `review_digest`, Potencial de Interesse e Plano 3, congelar o
> contrato da previsão antes de qualquer novo gasto, e definir **uma** sequência de
> trabalho. **Nenhuma implementação funcional aqui.**

---

## 1. Objetivo

Três frentes derivaram de [AUDIT_REPORT.md](AUDIT_REPORT.md) e se entrelaçaram:

1. **Arquitetura/orquestração de dados** ([ARQUITETURA-ORQUESTRACAO.md](ARQUITETURA-ORQUESTRACAO.md), derivada de [AUDITORIA-CICLO-VIDA-DADOS.md](AUDITORIA-CICLO-VIDA-DADOS.md)).
2. **Backfill das obras existentes** (Potencial de Interesse) — [PLANO-BACKFILL-ORQUESTRADO.md](PLANO-BACKFILL-ORQUESTRADO.md), [PILOTO-BACKFILL-INTERESSE.md](PILOTO-BACKFILL-INTERESSE.md), [LOTE-01-BACKFILL-INTERESSE.md](LOTE-01-BACKFILL-INTERESSE.md).
3. **Plano 3 — Interesse na Sinopse** (otimização do `synopsis_quality_predict`; materiais em [lib/synopsis-interest/](lib/synopsis-interest/)).

O conflito a resolver: o plano **previa** `review_digest` como entrada **futura/opcional** do Potencial de Interesse, mas o **predictor atual e as 112 primeiras previsões NÃO usam digest**. Não rodar novos lotes pagos antes de congelar o contrato final da previsão.

**Conclusão central desta etapa:** não há contradição entre arquitetura e implementação — o digest **sempre foi tratado como entrada futura/opcional (território do Plano 3)**, e as 112 previsões corretamente **não** o usam. O que falta é uma **decisão de produto** (o digest entra no contrato vencedor?) tomada com **evidência empírica** (golden sample rotulado + comparação de candidatos), **antes** de gastar com o backfill final.

---

## 2. Linha do tempo (commits por etapa)

Branch atual: `feat/data-orchestration`. HEAD: **`aedb4d5`** (🟩 verificado). Working tree limpo.
Lineage: `feat/data-orchestration` = `feat/synopsis-quality-optimization` (Plano 3 c1–c6) **+** a orquestração/backfill por cima (🟩 `git branch --contains`).

| Commit | Frente | Etapa | Conteúdo | Estado |
|---|---|---|---|---|
| `2a5003a` | Plano 3 | Fase B c1 | proveniência de `synopsis_quality` | completed |
| `9c70621` | Plano 3 | Fase B c2 | **golden sample + rúbrica** | completed |
| `03476ac` | Plano 3 | Fase B c3 | fluxo de rotulagem **cega** | completed |
| `deacf0c` | Plano 3 | Fase B c4 | métricas puras + **baselines D1/D2** | completed |
| `af93025` | Plano 3 | Fase B c5 | staleness signature + runner dry-run | completed |
| `d238e4c` | Plano 3 | Fase B c6 | D2 com matching parcial | completed |
| `be56513` | Plano 3 | Fase B | runner imprime distribuição + variância | completed |
| `1ef4318` | Arquitetura | Fase A | auditoria do ciclo de vida + desenho | completed |
| `e33d083` | Arquitetura | Fase B passo 1 | infra central readiness/planner/executor/jobs | completed |
| `056598a` | Arquitetura | Fase B passo 1 | ciclo de vida durável + smoke gratuito | completed |
| `10c351c` | Arquitetura | Fase B passo 2 | integra **review_summary/review_digest** na fila durável | completed |
| `809f3ff` | Arquitetura | Fase B passo 3 | integra `ensure_taste_profile` na fila durável | completed |
| `8c0cdeb` | Arquitetura | passo 4 (pré) | estimativa de custo conservadora (upper bound) | completed |
| `3868041` | Arquitetura | Fase B passo 4 | integra Potencial de Interesse na fila durável | completed |
| `3df82d5` | Arquitetura | Fase B passo 4 | conclui Interesse — per-work + lote + UI tipada | completed |
| `572d3b4` | Arquitetura | Fase B passo 5 | integra `recalculate_scores` na fila durável | completed |
| `aa70bb7` | Arquitetura | passo 5 (fix) | elimina bypasses de `recalculateAll` + guard de build | completed |
| `dd30a66` | Backfill | Prompt 2 / Etapa 1 | inventário read-only + plano do backfill | completed |
| `f1b4679` | Backfill | Etapa 2A | executor seguro (perfil + Interesse) | completed |
| `9b16a91` | Backfill | Etapa 2A.1 | endurecimento pré-piloto | completed |
| `d483128` | Backfill | Etapa 2B.0 | manifesto read-only do piloto pago | completed |
| `6775003` | Backfill | Etapa 2B.1 | resultado do piloto pago (12 obras) | completed |
| `0ed84d6` | Backfill | Etapa 2B.2 | recálculo headless-safe + recuperação | completed |
| `e987881` | Backfill | Etapa 2C.0 | manifesto read-only do Lote 01 (100) | completed |
| `57f4817` | Backfill | Etapa 2C.1 | teto da CLI arredonda p/ cima ao centavo | completed |
| `aedb4d5` ← HEAD | Backfill | Etapa 2C.2 | resultado da execução do Lote 01 (100) | completed |

---

## 3. Estado por frente (resumo)

| Frente | Estado | Uma linha |
|---|---|---|
| **1 — Arquitetura/orquestração** | **partial** | Os 5 passos da Fase B estão integrados na fila durável; backfill **só de Interesse** existe. Gaps: `runDigestBatch` planejado e **não construído**; lote legado de digest ainda **bypassa** a orquestração; `review_digest` **não** está no contrato de `predict_interest_potential` (decisão adiada, não bug). |
| **2 — Backfill de Interesse** | **partial** | Piloto (12, $0.62) + Lote 01 (100, $0.75) = **112 previsões modernas fresh**; **~622 pendentes**; **Lote 02 suspenso**; perfil v7 fresh, `recalc_pending=false`. |
| **3 — Plano 3 (Interesse na Sinopse)** | **partial** | Infra da Fase B pronta (golden sample FROZEN 90 slots, rúbrica, baselines D1/D2, rotulagem cega, métricas, staleness, runner dry-run). Pendente: **golden 0/90 rotulado**, piloto LLM (~$0.78) não rodado, comparação de candidatos não feita, **candidato com digest ainda não existe**. |

---

## 4. Snapshot atual do banco (🟩, read-only, 2026-06-19)

Consistente com a [AUDITORIA-CICLO-VIDA-DADOS.md](AUDITORIA-CICLO-VIDA-DADOS.md) (2026-06-18) salvo onde o Lote 01 mudou os números de previsão.

### Catálogo
```
737  works total  (734 ativas · 3 arquivadas)
734    canonical_synopsis ......... 100% (ativas)
503    review_summary ............. 68%  (ativas)
 14    review_digest .............. 2%   (ativas; 100% version=digest-v1)
7363   work_reviews (linhas)
503    obras com review útil (texto ≥40 chars) = obras com QUALQUER review
231    obras SEM review útil  (734 − 503)  ← no_reviews / not_applicable p/ digest
489    obras com review útil e SEM digest  (503 − 14)  ← alvo do digest backfill
```

### Taste profile
```
7 versões (v1…v7, todas is_stub=false; versões antigas preservadas como linhas)
current = v7  ·  is_stub=false  ·  input_hash=210021707a97…  ·  created 2026-06-19T02:44 (regen do piloto)
assinatura funcional v7 = 23eb13f0…  ·  estado: FRESH (bate com as 112 modernas)
```

### Potencial de Interesse (`synopsis_quality_predictions`)
```
1026 linhas  =  v2:737  +  v1:289       ·  distinct work_ids = 737 (todo work tem ≥1 linha v2)
112  modernas fresh   (input_signature preenchida, stale=false, taste_profile_hash=23eb13f0 / v7)  ← 12 piloto + 100 lote
914  legadas stale    (input_signature NULL, stale=true)   [= 625 v2 legadas + 289 v1]
  0  modernas stale  ·  0 legadas fresh
modelo: 100% claude-sonnet-4-6  ·  prompt: v2  ·  schema: v1
~622 obras ATIVAS pendentes de previsão moderna  (734 − 112)
```

### Calculated scores / recalc
```
recalc_pending = false  ·  recalc_last_edit_at = null
calculated_scores = 737  ·  personal_fit não-null = 737/737  ·  max calculated_at = 2026-06-19T03:07:51 (recalc 2B.2)
```

### Jobs (`work_processing_jobs`)
```
114 total  ·  TODOS succeeded  ·  0 queued / 0 running / 0 failed
  predict_interest_potential/succeeded  112
  ensure_taste_profile/succeeded          1
  recalculate_scores/succeeded            1
```

### Plano 3 — golden (`synopsis_interest_golden`, migration 109 APLICADA)
```
90 linhas (sample_version=pilot-1)  ·  human_label preenchido = 0/90  ← golden NÃO rotulado
```

---

## 5. Arquitetura atual (orquestração) — o que está mesmo construído

🟦 `lib/orchestration/`: `contracts.ts` (registro declarativo das 14 ações), `readiness.ts` (resolver puro), `planner.ts`, `cost.ts` (gate micro-threshold $0.02 + upper bound × 1.5), `jobs.ts` (JobStore Supabase durável + InMemory fallback + single-flight), `executor.ts`, `integrations/` (reviews, taste-profile, synopsis-interest, recalculate-scores, interest-ui, build-phase), `backfill/` (interest-backfill + cli-args).

| Ação | Integrada na fila durável? | Evidência |
|---|---|---|
| consolidate_synopsis | sim (já era `after()`; readiness por hash) | contracts.ts:145 |
| enrich_tags | sim | contracts.ts:153 |
| acquire_reviews | sim (opt-in manual) | contracts.ts:161 |
| **generate_review_summary** | **sim** — `ensureReviewSummary` (job durável, dedup, gate, retomada) | reviews.ts:207 ; save em persist-reviews.ts:90 |
| **generate_review_digest** | **sim (per-work)** — `ensureReviewDigest`; o save deixou de ser fire-and-forget invisível e virou job durável | reviews.ts:281 ; save em persist-reviews.ts:106 |
| ensure_taste_profile | sim (cascata metered) | integrations/taste-profile.ts |
| predict_interest_potential | sim (assinatura de entrada, dedup, gate, resume) | integrations/synopsis-interest.ts:188 |
| recalculate_scores | sim (free + headless-safe) | integrations/recalculate-scores.ts |

**Backfill orquestrado:** existe **só** para Interesse — `planInterestBackfill`/`runInterestBackfill` (perfil + previsão + recalc), escopo `full|ids|limit`, `planSignature` sha256, dry-run padrão, `--execute` + `--plan-signature` + `--max-cost-usd` obrigatórios, soft-cap, cancelamento cooperativo, resume. CLI `npm run backfill:interest`. 🟦 [interest-backfill.ts](lib/orchestration/backfill/interest-backfill.ts), [backfill-work-data.ts](scripts/backfill-work-data.ts).

---

## 6. Auditoria do pipeline de digest

### Produção individual
| Item | Resposta (🟦) |
|---|---|
| Quem produz `review_summary` | `consolidateReviewsDetailed` (Haiku), via `ensureReviewSummary` | [reviews.ts:263](lib/orchestration/integrations/reviews.ts#L263) |
| Quem produz `review_digest` | `consolidateReviewsDigestDetailed` (Sonnet), via `ensureReviewDigest` | [reviews.ts:334](lib/orchestration/integrations/reviews.ts#L334) |
| Freshness do summary | hash de conteúdo (`review_summary_inputs_hash` = `hash:n`) + materialidade | [reviews.ts:59](lib/orchestration/integrations/reviews.ts#L59) |
| Freshness do digest | **versão** (`review_digest_version=digest-v1`) + materialidade (`review_digest_n`); **sem hash de conteúdo** | [reviews.ts:79](lib/orchestration/integrations/reviews.ts#L79) |
| Summary e digest leem todas as reviews? | **Sim** — relê o conjunto completo persistido, não só o batch | persist-reviews.ts:72–108 |
| Erros persistidos? | sim — job `failed` com `last_error` sanitizado (não mais "engole silenciosamente") | reviews.ts:275/346 |
| Caminho fire-and-forget sem job durável? | **Não** no save — `ensureReviewDigest` é job durável (sem `await`, mas com dedup/status/resume) | persist-reviews.ts:106 |

### Orquestração
| Pergunta | Resposta | Classificação |
|---|---|---|
| `generate_review_summary` integrada a `work_processing_jobs`? | sim | **implementado** |
| `generate_review_digest` integrada a `work_processing_jobs`? | sim (per-work) | **implementado** |
| Dedup key por conteúdo/versão? | sim — `generate_review_digest:{workId}:{contentHash}:{version}` | **implementado** |
| Retry/resume real? | sim (job durável + single-flight + dedup) | **implementado** |
| Cost gate agregado para lote? | **não** (existe só o gate **por-obra** via `ensureReviewDigest`) | **ausente** |
| Planner de digest (`planDigestBatch`)? | **não** (planejado em PLANO-BACKFILL §7/§10/§30, não construído) | **ausente** |
| Runner de lote seguro (`runDigestBatch`)? | **não** (idem) | **ausente** |
| Batch legado bypassa o gate? | **sim** — `consolidatePendingReviewDigests` chama `consolidateReviewsDigestDetailed` direto (10/run, abort após 3 falhas), **sem** job durável/dedup/gate de custo | **legado a substituir** |
| CLI/UI apropriada? | UI legada `settings/review-digest-panel.tsx` (chama o batch legado); **sem** CLI orquestrada de digest | **parcial / legado** |
| Build/render/import disparam digest? | não (guard `isProductionBuildPhase`; save é a única origem automática) | **implementado** |

### Backfill de digest
| Pergunta | Resposta | Classificação |
|---|---|---|
| Dry-run seguro do backfill de digest? | **não** (não há `planDigestBatch`) | **ausente** |
| Seleção por IDs / limite? | só no caminho per-work (`ensureReviewDigest(workId)`); o batch legado é "todas pendentes, fatiado por `maxWorks`" | **parcial** |
| Assinatura de plano / confirmação por upper bound / soft cap / relatório agregado? | **não** (todos pertencem ao `runDigestBatch` inexistente) | **ausente** |
| Custo likely/upper atuais | 489 obras · **$23.3 likely / $35.0 upper** (contrato); real histórico ~$9.6 (n=17, $0.0197/call) | PLANO-BACKFILL §4/§23 |

**Síntese:** o digest **per-obra** é durável e observável; o **lote orquestrado** (planner+runner+gate+assinatura) **não existe** — o único lote hoje é o legado de `settings.ts`, a substituir.

---

## 7. Auditoria do predictor atual (`synopsis_quality_predict`)

🟦 [synopsis-quality-predictor.ts](lib/ai-evaluation/synopsis-quality-predictor.ts) · [synopsis-interest.ts](lib/orchestration/integrations/synopsis-interest.ts) · contrato em [contracts.ts:208](lib/orchestration/contracts.ts#L208).
Versões: **model `claude-sonnet-4-6` · prompt `v2` · schema `v1`**.

**Entradas reais do prompt:** `taste_profile` (perfil de gosto, obrigatório não-stub) + `título` + `sinopse` (canonical preferida → fallback raw mais longo) + `tags da obra`. **Nada além disso.**

| Entrada | Entra no **prompt**? | Entra na **input_signature**? | Mudança marca a previsão **stale**? |
|---|:--:|:--:|:--:|
| taste_profile (assinatura funcional) | ✅ | ✅ | **sim** |
| título | ✅ | ✅ | **sim** |
| canonical/raw synopsis | ✅ | ✅ (+ `synopsisSource`) | **sim** |
| tags | ✅ | ✅ (ordenadas/normalizadas) | **sim** |
| **review_digest** | ❌ | ❌ (`extraSources` é o hook reservado, hoje `null`) | **não** |
| **review_summary** | ❌ | ❌ | **não** |
| reviews brutas | ❌ | ❌ | **não** |
| model/prompt/schema | — | ✅ | sim (bump invalida) |

🟦 Assinatura: `computeInterestInputSignature` (synopsis-interest.ts:58) — comentário explícito: *"Exclui … review_digest (nesta etapa) …"*; o campo `extraSources` está pronto para receber o digest **sem quebrar o legado**.

**Readiness da previsão** (`classifyInterestReadiness`, synopsis-interest.ts:92): só `absent | fresh | stale`. **Não existe `ready_partial`** para "Interesse sem digest" — como o digest **não é entrada do contrato**, sua ausência **não** rebaixa a previsão a parcial. (O flag `partial` do `PredictInterestOutcome` existe, mas é acionado por fallback de **sinopse bruta** ou perfil stale, não por digest.)

**Conclusões objetivas:**
- O predictor atual **não usa** digest, summary nem reviews brutas.
- Mudança em **digest/summary/reviews** → **não** marca stale. Mudança em **tags/título/sinopse/perfil** → **marca** stale.
- O estado "sem digest" **não** aparece como `ready_partial` (digest não é input).

---

## 8. Desvio entre arquitetura aprovada e implementação

Comparando [ARQUITETURA-ORQUESTRACAO.md](ARQUITETURA-ORQUESTRACAO.md) / [AUDITORIA-CICLO-VIDA-DADOS.md](AUDITORIA-CICLO-VIDA-DADOS.md) com o código:

| # | Decisão documentada | Implementação atual | Classificação |
|---|---|---|---|
| G1 | ARQUITETURA §2/§7 caso 2: "Interest com sinopse, sem digest → digest `OPT` → **ready_partial**, marca p/ reprocesso" | digest **não é input** do contrato `predict_interest_potential`; não há `ready_partial` por digest; nenhuma reprevisão é agendada quando o digest chega | **decisão adiada** (a etapa atual de Interesse declaradamente *"NÃO inclui review_digest no prompt"* — synopsis-interest.ts:9) |
| G2 | PLANO-BACKFILL §7/§10/§30: criar `planDigestBatch` + `runDigestBatch` reusando `ensureReviewDigest` | não construído; só Interesse tem backfill orquestrado | **gap de implementação** |
| G3 | ARQUITETURA §1: `generate_review_digest` deve ter retry/fila (era a "única automática sem retry") | **resolvido** no per-work (`ensureReviewDigest`); o **lote legado** ainda não usa a orquestração | **parcial** (per-work feito; lote legado a substituir) |
| G4 | AUDITORIA §10 (Opção C): expor `readiness` na UI/ranking + fechar gap de re-previsão após mudança de perfil | re-previsão por mudança de perfil é feita via **backfill manual** (piloto/lotes), não auto; readiness materializado parcialmente | **decisão adiada** (backfill manual controlado em vez de auto-refresh) |
| G5 | Decisão D2 (PLANO-BACKFILL §16): "digest não alimenta Interesse hoje (é Plano 3); adiar o backfill de digest" | respeitado — digest backfill **não** foi executado; as 112 previsões não usam digest | **mudança deliberada / alinhada** |

**Veredito:** nenhum item é bug. G1/G4 são **decisões adiadas** explícitas; G2 é o único **gap de implementação** real (o lote orquestrado de digest); G3 está **parcial**; G5 está **alinhado**. **Não tratar uma decisão futura como defeito.**

---

## 9. Papel do digest no Plano 3

🟦 Materiais em [lib/synopsis-interest/](lib/synopsis-interest/): `sample.ts`, `RUBRIC.md`, `golden-sample.pilot-1.json` (FROZEN), `baselines.ts` (D1/D2), `labels.ts`, `metrics.ts`, `staleness.ts`, `labeling-sheet.pilot-1.{csv,html}`. Runner: [scripts/synopsis-interest-run.ts](scripts/synopsis-interest-run.ts) (dry-run, read-only).

### O que era a "parte 1 da Fase B" do Plano 3 (concluída antes da auditoria)
Commits c1–c6 + `be56513`: **proveniência, golden sample + rúbrica, fluxo de rotulagem cega, métricas puras, baselines determinísticos D1/D2, assinatura de staleness, runner dry-run + distribuição/variância**. Achados registrados na memória: *staleness lever fraco; D2≡D1 no início (corrigido em c6 com matching parcial)*; piloto LLM pago (~$0.78) **pendente de aprovação**.

### Candidatos hoje vs. candidatos planejados
| Candidato | Entradas | Existe em código? |
|---|---|---|
| **D1** (tags-only) | tags × perfil (overlap ponderado) — determinístico, sem LLM | ✅ baselines.ts:66 |
| **D2** (tags + keywords da sinopse) | D1 + análise determinística do texto — sem embeddings | ✅ baselines.ts:142 |
| **LLM baseline (sem digest)** | = predictor de produção (perfil + título + sinopse + tags) | ✅ synopsis-quality-predictor.ts |
| **LLM enriquecido com digest** | baseline + `review_digest` (traços salientes/consenso/divergência) | ❌ **não existe** — é o trabalho novo |
| **fallback digest → summary → no_reviews** | precedência de fonte descritiva | ❌ não existe (a definir) |

### Respostas objetivas
- **Digest já estava previsto?** Sim, como entrada **futura/opcional** (AUDITORIA §6/§7; ARQUITETURA §2 `DIG -.FUTURO/opt.-> PRED`). **Não** como candidato implementado.
- **Havia candidato com e sem digest?** Não — só baselines determinísticos D1/D2 e o LLM sem digest. O candidato **com** digest é o que esta reconciliação introduz.
- **Summary era fallback?** Sim, sempre tratado como fallback do digest (AUDITORIA §7; PLANO-BACKFILL §23 item 7).
- **Modelo planejado?** `claude-sonnet-4-6` (AUDIT_REPORT F10/§18 sugere avaliar Haiku/determinístico — em aberto).
- **Material de classificação (golden):** 80 obras únicas + 10 repetições cegas = **90 slots** estratificados (♥/♥♥/♥♥♥/♥♥♥♥ × development/holdout); `candidate_pool=655`. FROZEN: *"não regenerar após observar outputs candidatos"*.
- **Golden já existe?** Sim, a tabela (`synopsis_interest_golden`, migration 109 aplicada) e o JSON. **Mas 0/90 rotulado** (🟩) → a rotulagem humana cega **ainda não foi feita**.
- **Pode ser reutilizado?** Sim — está congelado e válido; só falta rotular.
- **Os outputs atuais foram gerados antes ou depois do digest?** O runner é determinístico (D1/D2) e **não** persistiu outputs LLM; as 112 previsões de produção foram geradas **sem digest** (contrato v2). Nada a regenerar **do experimento** ainda (o piloto LLM não rodou).

**O Plano 3 deve preservar, no mínimo, três candidatos:** (a) **baseline atual sem digest**; (b) **candidato enriquecido com digest**; (c) **fallback digest → summary → no_reviews**.

---

## 10. Destino das 112 previsões existentes

🟩 112 previsões modernas (12 piloto + 100 lote), prompt **v2**, schema **v1**, model **sonnet-4-6**, perfil **v7**, `input_signature` preenchida, `stale=false`. **Geradas pelo contrato SEM digest.**

**Decisão:** tratá-las como **baseline/provisórias**, não como dado manual definitivo.
- **Não apagar / não sobrescrever** durante experimentos.
- **Não aplicar** automaticamente como `synopsis_quality` manual (`source` permaneceria `legacy_unknown`/prediction, não `human_manual`).
- **Coexistência:** o unique é `(work_id, prompt_version)` (migration 086). Um candidato vencedor que mude o **prompt_version** (ex.: `v3`) gera **linhas novas** sem tocar nas v2 → as 112 baseline sobrevivem como histórico.
- **Não** adicionar digest via `extraSources` na **mesma** `prompt_version` v2 (marcaria as 112 stale e o upsert sobrescreveria a linha v2 — perda do baseline). Mudança de contrato ⇒ **novo `prompt_version`/`schema_version`**, não mutação do v2.
- **Experimentos rodam OFFLINE** contra o golden sample (comparar candidato × `human_label`); **não** escrevem em `synopsis_quality_predictions` de produção. Resultados experimentais ficam fora da tabela de produção (export/golden), nunca exibidos como produção.

**Não reescrever os documentos de execução para fingir que o digest já fazia parte:** as 112 previsões foram, comprovadamente, geradas pelo **contrato sem digest**.

---

## 11. Decisão de versionamento (estratégia)

| Necessidade | Estratégia |
|---|---|
| Preservar as 112 (v2) como baseline | manter; unique `(work_id, prompt_version)` permite coexistir com versões novas |
| Candidatos experimentais | rodar **offline** contra o golden (sem persistir em produção); custo separado por candidato |
| Winner final | nova `prompt_version` (e/ou `schema_version`/`extraSources`) ⇒ **nova `input_signature`** ⇒ re-backfill sob o novo contrato |
| Histórico comparável | golden FROZEN + mesmas labels p/ todos os candidatos; v1/v2 antigas ficam como linhas históricas |
| Impedir vazamento "experimento → produção" | predictor de produção lê só a `PROMPT_VERSION` corrente (hoje `v2`); experimentos sob outra versão **não** aparecem no ranking até o bump deliberado |

**Tabelas:** `synopsis_interest_golden` (109, aplicada) guarda o material + labels do experimento. `prediction_snapshots` (105, aplicada) é para **métricas prospectivas de produção** (1 snapshot por obra no momento da recomendação) — **não** é o store do experimento offline; não usar para os candidatos. **Nenhuma migration nova é necessária** para o experimento (offline + golden); um `prompt_version` novo também não exige migration.

---

## 12. Sequência reconciliada obrigatória

A proposta original é sólida; o único refino material é **não fazer o backfill completo de digest (489) antes do experimento** — o experimento precisa de digest **apenas nas obras do golden** (≤80 únicas, só as que têm review útil). O backfill completo de digest só se justifica **se o digest vencer**.

```
FASE 1 — Arquitetura/orquestração
  → COMPLETED nos 5 passos. Corrigir gaps SÓ se o experimento exigir:
    • (opcional) construir planDigestBatch/runDigestBatch (gap G2) — pode ser adiado
    • (opcional) migrar o lote legado de digest p/ a orquestração (G3)

FASE 2A — Regularização de pré-requisitos DO EXPERIMENTO (escopo mínimo)
  → garantir digest nas obras do GOLDEN com review útil (≤80, não as 489)
    • dry-run de digest dessas obras (planner ou per-work com IDs)
    • piloto de digest (10–20 obras, schema válido, traços coerentes — PLANO-BACKFILL §23 item 8)
    • gerar digest só do subconjunto do golden
    • obras sem review do golden → no_reviews/not_applicable (legítimo)
  → NÃO rodar o backfill de digest das 489 aqui

FASE 3 — Retomar Plano 3 (decidir o CONTRATO)
  → congelar snapshot dos dados (perfil v7, golden FROZEN)
  → rotular o golden sample (0/90 → 80 únicas + 10 repetições, cego)
  → rodar candidatos OFFLINE contra o golden:
      (a) baseline atual SEM digest   (b) candidato COM digest   (c) fallback summary/no_reviews
      [+ D1/D2 determinísticos como piso/baratos]
  → comparar (métricas ordinais: exato/±1/MAE/QWK; dev × holdout) com baseline e custo/candidato
  → ESCOLHER contrato/modelo final (digest entra? summary fallback? Haiku × Sonnet?)

FASE 2B — Finalizar o backfill de Interesse (SÓ após o winner)
  → implementar o winner: nova prompt_version/schema/signature
  → (se o winner usar digest) backfill de digest das 489 obras com review útil
  → novo piloto + novo dry-run + nova assinatura
  → backfill definitivo das ~622 (+ digest onde aplicável) em lotes controlados
  → relatório final de cobertura
```

### Razão técnica para esta ordem (e para NÃO antecipar)
- **Lote 02 de Interesse (~622) antes do winner = gasto potencialmente desperdiçado:** se o winner adicionar digest, muda a `prompt_version`/`input_signature` e as ~622 teriam de ser **re-previstas** sob o novo contrato. Rodar agora sob v2 (sem digest) é re-trabalho pago.
- **Backfill de digest (489, ~$23–35) antes do experimento = gasto especulativo:** o digest só agrega se **vencer** o baseline. O experimento precisa de digest **só no golden** (custo trivial).
- **Congelar o contrato é o gargalo legítimo:** todo o resto (lotes pagos) depende do contrato final.

---

## 13. Critérios de entrada e saída por fase

| Fase | Entrada (pré) | Saída (conclusão) |
|---|---|---|
| **1** | infra durável verde | 5 passos integrados (✅); gaps de digest documentados (G2/G3) |
| **2A** | golden FROZEN + perfil v7 fresh | digest válido nas ≤80 obras do golden com review; piloto de digest aprovado (schema/traços OK); obras sem review marcadas no_reviews |
| **3** | golden 90/90 rotulado + 2A completa | métricas dos candidatos (dev×holdout) com baseline e custo; **decisão registrada** do contrato (digest sim/não, fallback, modelo) |
| **2B** | winner definido | winner implementado (nova versão/assinatura); piloto+dry-run novos; ~622 (+digest se aplicável) previstas; **relatório de cobertura** com perfil/recalc/jobs |

---

## 14. Decisões já tomadas (registradas)

### Digest
- O digest é **candidato obrigatório do Plano 3** (precisa ser comparado contra o baseline sem digest).
- O digest **não é requisito duro** para obras sem reviews (no_reviews é ausência **legítima**).
- `summary` é **fallback possível** do digest.
- **reviews brutas não entram** diretamente no predictor.

### Backfill
- **Lote 02 permanece suspenso.**
- As **112 previsões** existentes são **baseline/provisórias** (contrato sem digest).
- **Nenhum backfill final** (Interesse ou digest das 489) **antes da seleção do winner**.

### Aquisição de reviews
- Continua **manual/opt-in** (classe D; `acquire_reviews` não automatizado).
- **Não bloquear** obras sem reviews; **não adquirir reviews automaticamente** no backfill.

### Experimentos
- **Mesmo snapshot** de obras (golden FROZEN) e **mesmas labels** entre candidatos.
- **Sem sobrescrever** a produção (offline; sem escrever em `synopsis_quality_predictions`).
- **Custos separados por candidato**; `prompt/model/version` registrados.

### Conclusão (definição de "pronto")
- O Prompt 2 **não termina** ao preencher as previsões atuais. **Termina** quando o **contrato vencedor estiver aplicado** e o **catálogo final** estiver em estado conhecido (cobertura medida, perfil fresh, recalc=false, jobs limpos).

---

## 15. Decisões pendentes (do usuário)

| # | Decisão | Recomendação 🟧 |
|---|---|---|
| P1 | Digest entra no contrato vencedor? | decidir **após** o experimento (golden rotulado), não antes |
| P2 | Modelo do predictor: manter Sonnet ou testar Haiku/determinístico (AUDIT F10/§18)? | incluir Haiku e D1/D2 como candidatos baratos na comparação |
| P3 | Construir `runDigestBatch` agora (G2) ou usar per-work no golden? | per-work/IDs no golden basta p/ o experimento; `runDigestBatch` só se o digest vencer |
| P4 | Auto-refresh de previsões pós-perfil (G4/AUDITORIA §13) ou seguir com lotes manuais? | seguir com lotes manuais até o contrato congelar; reavaliar depois |
| P5 | Aprovar o piloto LLM do Plano 3 (~$0.78)? | aprovar — custo trivial; é o que destrava a comparação |

---

## 16. Custos conhecidos

| Operação | Escopo | Likely | Upper | Real histórico |
|---|---|--:|--:|--:|
| Piloto LLM Plano 3 (synopsis_quality_predict no golden) | 80 únicas | ~$0.78 | <$1 | ~$0.0075–0.0099/call |
| Digest do golden (só obras com review) | ≤80 | <$1 | ~$1.6 | $0.0197/call |
| **Digest backfill completo** | 489 | **$23.3** | **$35.0** | ~$9.6 (n=17) |
| Interesse Lote 02 (restante, contrato atual v2) | ~622 | ~$4.7–6.5 | ~$9.8 | $0.0075/previsão (Lote 01) |
| ensure_taste_profile (se regenerar) | 1 | $0.39 | $0.58 | $0.388 |
| recalculate_scores | global | $0 | $0 | free (TS puro) |

Já gastos: piloto 2B.1 **$0.62** + Lote 01 2C.2 **$0.75** = **$1.37** (112 previsões + 1 perfil v7).

---

## 17. Migrations conhecidas

Todas as relevantes estão **APLICADAS** (🟩 confirmado por colunas/linhas existentes):
`085/086` (synopsis_quality_predictions + multi-version), `103` (review_digest), `104` (tier_band_width), `105` (prediction_snapshots), `107` (ai_cache_events), `108` (synopsis_quality provenance), `109` (synopsis_interest_golden), `110` (work_processing_jobs), `111` (input_signature).

**Esta etapa não cria migration.** O experimento (offline + golden) e um `prompt_version` novo **não exigem** migration. Eventual `runDigestBatch` reusa `work_processing_jobs` (sem migration). Mecanismo de aplicação: à mão no SQL editor (CLI dessincronizada — ver memória do projeto).

---

## 18. Riscos

| Risco | Sev | Mitigação |
|---|:--:|---|
| Rodar Lote 02 sob v2 e depois o winner mudar o contrato ⇒ re-trabalho pago | 🟠 | **suspender Lote 02** até o contrato congelar (decisão §14) |
| Backfill de digest (489) especulativo antes do experimento | 🟠 | digest só no golden em 2A; backfill completo em 2B condicional ao winner |
| Golden rotulado com viés (consultar previsão/tags) | 🟡 | rúbrica de rotulagem **cega** (RUBRIC.md); repetições medem consistência intra-avaliador |
| Lote legado de digest (`settings.ts`) gastar Sonnet fora do gate | 🟡 | preferir o caminho durável; não usar o painel legado durante a transição |
| Sobrescrever as 112 v2 ao adicionar digest na mesma versão | 🟡 | usar **novo `prompt_version`**, nunca mutar v2 (decisão §10/§11) |
| Recalc headless travar (Invariant unstable_cache) | 🟢 | resolvido em 2B.2 (`recalculateScoresHeadless`); `recalc_pending=false` |
| Perfil/biblioteca mudarem entre dry-run e execução paga | 🟢 | `planSignature` + re-plano ⇒ `plan_changed`, zero custo |

---

## 19. Fora de escopo (deliberado)

- Executar Lote 02, qualquer previsão, digest, perfil, avaliação IA, recálculo, aquisição de reviews, migration, escrita no banco, push, merge.
- Alterar prompt/modelo/schema/fórmula/ranking.
- Implementar o candidato com digest, o `runDigestBatch`, ou o auto-refresh de previsões.
- Reescrever o conteúdo histórico de AUDIT_REPORT/AUDITORIA/ARQUITETURA (só nota curta de ponteiro).
- F1 (auth/rate-limit) e demais P1+ do AUDIT_REPORT (frente separada, pré-deploy).

---

## 20. Tabela principal de reconciliação

Estados: `completed · partial · blocked · planned · deferred · not_applicable`.

| Frente | Etapa | Estado | Evidência | Próxima ação | Bloqueia |
|---|---|---|---|---|---|
| Arquitetura | Fase A (desenho) | completed | ARQUITETURA-ORQUESTRACAO.md; commit `1ef4318` | — | — |
| Arquitetura | Fase B p1 (infra) | completed | `lib/orchestration/*`; `e33d083`/`056598a` | — | — |
| Arquitetura | Fase B p2 (summary/digest durável) | completed | reviews.ts; `10c351c` | — | — |
| Arquitetura | Fase B p3 (taste_profile) | completed | integrations/taste-profile.ts; `809f3ff` | — | — |
| Arquitetura | Fase B p4 (predict_interest) | completed | synopsis-interest.ts; `3868041`/`3df82d5` | — | — |
| Arquitetura | Fase B p5 (recalculate_scores) | completed | recalculate-scores.ts; `572d3b4`/`aa70bb7` | — | — |
| Arquitetura | `runDigestBatch`/`planDigestBatch` (lote orquestrado) | planned | PLANO-BACKFILL §7/§10/§30; **ausente** no código (G2) | construir SÓ se digest vencer | backfill de digest das 489 (não o experimento) |
| Arquitetura | migrar lote legado de digest p/ orquestração | partial | `consolidatePendingReviewDigests` bypassa o gate (G3) | substituir após winner | nada crítico hoje |
| Arquitetura | Interest sem digest = `ready_partial` (caso §2) | deferred | digest não é input do contrato (G1) | reabrir no contrato do winner | nada (decisão de design) |
| Backfill | inventário + dry-run + custo | completed | PLANO-BACKFILL §1–4; `dd30a66` | — | — |
| Backfill | executor seguro (2A/2A.1) | completed | interest-backfill.ts; `f1b4679`/`9b16a91` | — | — |
| Backfill | piloto 12 obras (2B.1) | completed | PILOTO §RESULTADO; $0.62; `6775003` | — | — |
| Backfill | recalc headless-safe (2B.2) | completed | `recalculateScoresHeadless`; `recalc_pending=false`; `0ed84d6` | — | — |
| Backfill | Lote 01 (100 obras, 2C.2) | completed | LOTE-01 §RESULTADO; $0.75; 112 modernas; `aedb4d5` | — | — |
| Backfill | **Lote 02 (~622 restantes)** | blocked | 🟩 622 pendentes; perfil v7 fresh | **NÃO executar** até winner | conclusão do Prompt 2 |
| Backfill | backfill de digest das 489 | deferred | decisão D2; 489 sem digest (🟩) | condicional ao winner | só fluxos pagos (ranker/deep-dive) |
| Plano 3 | proveniência synopsis_quality (c1) | completed | migration 108; `2a5003a` | — | — |
| Plano 3 | golden sample + rúbrica (c2) | completed | golden-sample.pilot-1.json (FROZEN); `9c70621` | — | — |
| Plano 3 | rotulagem cega (fluxo) (c3) | completed | labeling-sheet; `03476ac` | — | — |
| Plano 3 | métricas + baselines D1/D2 (c4/c6) | completed | metrics.ts/baselines.ts; `deacf0c`/`d238e4c` | — | — |
| Plano 3 | staleness + runner dry-run (c5) | completed | staleness.ts/synopsis-interest-run.ts; `af93025` | — | — |
| Plano 3 | **rotular o golden** (humano) | planned | 🟩 `synopsis_interest_golden` 0/90 rotulado | rotular cego (90 slots) | comparação de candidatos |
| Plano 3 | **piloto LLM** (synopsis_quality_predict no golden) | planned | runner orça ~$0.78; não rodado | aprovar + rodar | comparação |
| Plano 3 | **candidato COM digest** | planned | não existe em código | construir após digest do golden | escolha do contrato |
| Plano 3 | fallback digest→summary→no_reviews | planned | não existe em código | definir no candidato | escolha do contrato |
| Plano 3 | comparar candidatos + escolher contrato | blocked | depende de golden rotulado + digest do golden | rodar após 2A + rotulagem | Fase 2B inteira |

---

## 21. Pontas soltas

| Item | Responsável/fase | Bloqueia? | Critério de fechamento |
|---|---|:--:|---|
| Golden 0/90 rotulado | Plano 3 / Fase 3 | **sim** | 80 únicas + 10 repetições rotuladas cego |
| Piloto LLM Plano 3 não rodado (~$0.78) | Plano 3 / Fase 3 | **sim** | piloto executado, outputs comparáveis ao golden |
| Candidato com digest inexistente | Plano 3 / Fase 3 | **sim** | candidato implementado (offline) + fallback summary/no_reviews |
| Digest só nas obras do golden | Fase 2A | **sim** (p/ o candidato digest) | digest válido nas ≤80 obras com review do golden |
| `runDigestBatch`/`planDigestBatch` (G2) | Arquitetura | não (p/ experimento) | construído **se** digest vencer; reusa `ensureReviewDigest` |
| Lote legado de digest bypassa o gate (G3) | Arquitetura | não | migrado p/ orquestração ou aposentado |
| Interest "sem digest" ≠ ready_partial (G1) | Arquitetura | não | reabrir no contrato do winner (digest opcional + reprevisão) |
| Lote 02 (~622) suspenso | Backfill / Fase 2B | **sim** (conclusão) | rodar só após winner, sob o contrato final |
| Backfill de digest das 489 | Backfill / Fase 2B | não | condicional ao winner usar digest |
| Auto-refresh de previsões pós-perfil (G4) | Arquitetura | não | decisão de produto pós-contrato |

---

## 22. Próximo escopo recomendado (UMA etapa — não executar agora)

**Recomendação: retomar o Plano 3 pela rotulagem do golden + piloto LLM** (Fase 3, precedida do mínimo de 2A: digest só no golden). É o **gargalo real** — sem golden rotulado e sem o candidato com digest, não há como congelar o contrato, e sem contrato congelado todo backfill pago é especulativo.

| Campo | Conteúdo |
|---|---|
| **Objetivo** | Rotular o golden (90 slots, cego) e rodar o piloto LLM + candidatos (baseline sem digest, D1/D2) contra o golden; gerar digest **só** das ≤80 obras do golden com review para habilitar o candidato com digest na sequência. |
| **Arquivos prováveis** | [scripts/synopsis-interest-run.ts](scripts/synopsis-interest-run.ts), [lib/synopsis-interest/*](lib/synopsis-interest/) (labels.ts/metrics.ts/baselines.ts), [lib/orchestration/integrations/reviews.ts](lib/orchestration/integrations/reviews.ts) (`ensureReviewDigest` por IDs do golden), eventual `scripts/synopsis-interest-import.ts` (ingestão das labels) |
| **Migration** | Nenhuma (109 já aplicada; experimento é offline + golden) |
| **Custo** | Piloto LLM ~$0.78; digest do golden <$1; **upper combinado <$3** — confirmar por dry-run antes de qualquer `--execute` |
| **Smoke** | `synopsis-interest-run.ts` em DRY-RUN (read-only) reportando D1/D2 × golden quando `human_label` existir; nenhum provider chamado no dry-run |
| **Critério de conclusão** | golden 90/90 rotulado; métricas dev×holdout dos candidatos com baseline e custo/candidato; digest válido nas obras do golden; **decisão do contrato registrada** (digest sim/não, fallback, modelo) |
| **Fora do escopo** | Lote 02; backfill de digest das 489; `runDigestBatch`; implementar o winner; auto-refresh; qualquer escrita em `synopsis_quality_predictions` de produção |

---

### Confirmação do banco (esta etapa)
```
zero chamadas pagas · zero LLM · zero perfis criados · zero previsões criadas/alteradas
zero digests criados/alterados · zero jobs criados · zero recálculos · zero migrations · zero escrita
Acesso: somente SELECT (2 scripts temporários, já removidos).
```

---

## 23. Matriz completa de rastreabilidade das auditorias (addendum 2026-06-19, Fase B2.0)

> Garante que **nenhum** achado das duas auditorias se perca na transição entre planos.
> Estados: `completed · partial · planned · blocked · deferred · not_applicable · superseded`.
> "Bloqueia agora?" = bloqueia o **experimento do Plano 3** (≠ "não é importante"). F1 **não**
> bloqueia o experimento mas **bloqueia o deploy**.

### 23.1 Achados do [AUDIT_REPORT.md](AUDIT_REPORT.md)

| ID | Achado | Estado | Evidência | Fase responsável | Bloqueia agora? | Critério de conclusão | Próxima ação |
|---|---|---|---|---|:--:|---|---|
| F1 | auth + rate limit (service-role exposto) | planned | ~30 server actions sem auth (AUDIT §12) | pré-deploy | não · **SIM p/ deploy** | gate auth global + rate limit nos endpoints IA | implementar antes de expor (não nesta fase) |
| F2 | falha de capa na avaliação IA | completed | base64 prefetch (AUDIT §1B/F2) | pré-Plano 3 | não | — | — (feito) |
| F3 | falsa precisão / tiers | partial | `tier_band_width` mig 104; largura definitiva a validar | decisão de produto | não | validar largura (fixa×percentil×cluster) sobre dado prospectivo | validar após F9 |
| F4 | métrica in-sample × OOF | completed | `selectPrimaryModelMetric` (AUDIT §1B/F4) | pré-Plano 3 | não | — | — (feito) |
| F5 | Ridge × calc sem ganho | deferred | IC inclui 0 (§7.2); shadow-ranking (branch `feat/shadow-ranking`, mig 106) | hardening pós-Plano 3 | não | head-to-head OOF limpo; senão simplificar p/ calc | rodar shadow ranking / decidir |
| F6 | alignment (Veredito IA) sem ganho | deferred | sem lift no subset (§7.3); shadow-ranking cobre | decisão de produto | não | medir lift ou aposentar | decidir após shadow ranking |
| F7 | personal_fit redundante | deferred | ΔSpearman IC inclui 0; sd 0,058 | hardening pós-Plano 3 | não | percentil/robusto OU sinal ortogonal | repensar pós-contrato |
| F8 | dois sistemas de mood | deferred | preset × drawer (§10) | decisão de produto | não | unificar semântica | decidir |
| F9 | validação prospectiva | partial | `prediction_snapshots` mig 105 aplicada; falta dado | operação recorrente | não | acumular recomendações+notas; painel sai do vazio | ligar hooks de evento + acumular |
| F10 | `synopsis_quality_predict` em Sonnet (custo/modelo) | **partial (no Plano 3)** | $10,3 / 14%; o experimento testa Sonnet × Haiku × D1/D2 | **Plano 3** | não (é o experimento) | experimento responde modelo/custo (§10 do experimento) | B2.0 → Fase 3 |
| F11 | staleness / recalc manual | partial | headless-safe (2B.2); recalc ainda 1h/manual | operação recorrente | não | auto-recalc OU flag visível | decidir auto-refresh |
| F12 | refresh de dados externos estagna | deferred | refetch só manual | operação recorrente | não | **política de atualização** (job de refresh) | definir política |
| F13 | multicolinearidade / waterfall | partial | drama~tragedy 0,80; "não exibir waterfall" | hardening | não | confirmar waterfall não exibido por feature | verificar UI |
| F14 | lint / `noUncheckedIndexedAccess` | deferred | 444 lint (29 err); flag off | hardening técnico | não | reduzir erros; ligar flag | hardening |
| F15 | código morto / nomes legados | partial | `prediction.ts` removido (2026-06-15); `min_*_score` repurposados | hardening técnico | não | varredura final de legado | hardening |

### 23.2 Achados do ciclo de vida ([AUDITORIA-CICLO-VIDA-DADOS.md](AUDITORIA-CICLO-VIDA-DADOS.md))

| ID | Achado | Estado | Evidência (🟩) | Fase responsável | Bloqueia agora? | Critério de conclusão | Próxima ação |
|---|---|---|---|---|:--:|---|---|
| L1 | canonical_synopsis | completed | 734/734 (100%) | — | não | — | — (saudável) |
| L2 | tags enriquecidas (group=null) | partial | fallback group=null | operação recorrente | não | enriquecimento durável cobre novas | monitorar |
| L3 | reviews ausentes (231 obras) | not_applicable | opt-in manual (classe D) | decisão de produto | não | ausência legítima (não automatizar) | — |
| L4 | review_summary 68% | partial | 503/734 | operação recorrente | não | backfill opcional OU sob demanda | decidir |
| L5 | review_digest 2% | **partial (no Plano 3)** | 14/734; experimento + backfill condicional | Plano 3 → backfill final | não | experimento decide; backfill só se vencer | B2.0 → Fase 3 |
| L6 | taste_profile regen só pago | partial | v7 fresh; auto-refresh deferido | operação recorrente | não | política de refresh fora do pago OU aviso de velho | decidir pós-contrato |
| L7 | previsões stale (catálogo) | partial | 112 modernas / ~622 pendentes | backfill final | não (suspenso de propósito) | Lote 02 sob contrato final | após winner |
| L8 | recalc após update (stale) | partial | `markRecalcPending`; headless-safe ok | operação recorrente | não | = F11 | = F11 |
| L9 | provenance `synopsis_quality_source` | partial | 100% `legacy_unknown` | operação recorrente | não | sinal útil só após re-saves humanos | aguardar uso |
| L10 | alignment stale | not_applicable | re-rank manual de propósito | decisão de produto | não | ausência legítima | — |
| L11 | dados externos estagnados | deferred | = F12 | operação recorrente | não | = F12 | = F12 |
| L12 | readiness parcial/completa (materializar) | partial | resolver derivado; materialização parcial | hardening pós-Plano 3 | não | expor readiness na UI/ranking (AUDITORIA §10) | hardening |
| L13 | mudança de tags → staleness da previsão | **completed (superseded)** | `input_signature` (mig 111) **inclui tags** ⇒ tags mudam → stale | — | não | resolvido (supera AUDITORIA §11 caso 15) | — |
| L14 | lote legado de digest bypassa o gate | partial / legacy | `consolidatePendingReviewDigests` sem gate | backfill final / pós-Plano 3 | não | migrar p/ `runDigestBatch` OU aposentar | após winner |

### 23.3 Resumo

| Estado | IDs | n |
|---|---|--:|
| completed | F2, F4, L1, L13 | **4** |
| partial | F3, F9, F10, F11, F13, F15, L2, L4, L5, L6, L7, L8, L9, L12, L14 | **15** |
| planned | F1 | **1** |
| deferred | F5, F6, F7, F8, F12, L11 | **6** |
| not_applicable | L3, L10 | **2** |
| blocked | — | **0** |

**Principais bloqueadores:**
- do **experimento (agora):** golden 0/90 rotulado · candidato com digest (preparado em B2.0, execução não construída) · digest dos 51 do golden.
- do **deploy (não agora):** **F1** (auth + rate limit).

**Fase responsável por grupo:**
- **Plano 3 (agora):** F10, L5 (o experimento decide modelo/custo/digest).
- **pré-Plano 3 (feito):** F2, F4.
- **backfill final:** L7, L14.
- **pré-deploy:** F1.
- **hardening pós-Plano 3:** F3, F5, F7, F13, F14, F15, L12.
- **operação recorrente:** F9, F11, F12, L2, L4, L6, L8, L9, L11.
- **decisão de produto:** F6, F8, L3, L10.

> Regra mantida: item adiado **não desaparece** (fica nesta matriz); F5/F6/F7/F8/F9 têm destino explícito; F12 tem "política de atualização" como critério; F14/F15 ficam no hardening técnico; F1 segue bloqueando o deploy.

---

## 24. Addendum — Fase B2.0 executada (2026-06-19)

Congelamento do protocolo experimental do Plano 3 — ver [PLANO3-EXPERIMENTO-DIGEST-GOLDEN.md](PLANO3-EXPERIMENTO-DIGEST-GOLDEN.md).

- **Golden auditado (🟩):** 80 únicas — **0 digest**, **51 missing_with_reviews** (todas summary-only), **29 no_reviews**, 0 stale/blocked ⇒ **51 digests** a gerar (não as 489). Previsão v2 do golden: 12 modernas / 68 legadas.
- **Código (puro, testado):** [lib/synopsis-interest/experiment.ts](lib/synopsis-interest/experiment.ts) — candidatos `b1`/`e1`, fallback explícito `resolveReviewContext`, `computeSnapshotSignature`/`computeCandidateInputSignature`, `planGoldenDigest`/`planCandidateDryRun`. 26 testes ([experiment.test.ts](tests/unit/synopsis-interest/experiment.test.ts)). **Nenhum caminho de execução paga construído.**
- **Cegamento:** auditado, forte por construção (export só `slot_key`+sinopse; labels em tabela separada). Risco residual: export lê sinopse live → fechar pelo snapshot congelado.
- **Custos (futuros, não gastos):** experimento total **~$2.6 likely / ~$8.6 upper** (digest 51 + b1 80 + e1 80 + D1/D2 grátis).
- **Banco:** somente SELECT; zero escrita; 1 script temporário (removido).
