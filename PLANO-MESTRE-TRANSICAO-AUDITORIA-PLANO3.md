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

> **🟢 ESTADO AUTORITATIVO 2026-06-28 — ler ANTES de tudo (inclusive do banner 06-23 abaixo).**
> Duas viradas posteriores ao corpo deste doc invalidam decisões registradas como fechadas:
> **(1)** a **golden-3 (n=180, 2026-06-25)** reverteu o veredito do digest — ΔMAE e1−b1 = **−0,211
> [IC95 −0,311; −0,117, exclui 0]** ⇒ **GO** para ligar o digest **no preditor de Interesse**.
> **(2)** o **e1 entrou em produção** (`PROMPT_VERSION="v3"`, PRs #15/#18, 414/758 obras backfilladas,
> ~$7,1) em 2026-06-27/28. **Consequências:** P1 (§15) está **invertido** (digest **ENTRA** no
> Interesse; **NÃO** na Nota Prevista/Ridge — ablação mostrou redundância); `runDigestBatch` (G2) e o
> **digest** estão revisitados (digest virou input do e1; cobertura **medida 2026-06-28 = 481/773 = 62%**,
> não os 2% do doc de 06-18 — resta só a cauda reviewável ~60–130 obras); a decisão **D2 "adiar digest"** está **superseded**; o "**~622** pendentes de Interesse"
> está **obsoleto** (Lote 02 fez **757/757**). Branches WIP triadas: 4 obsoletas apagadas (**+3 merjadas
> podadas em 2026-06-30**); `feat/shadow-ranking` preservada, mas **não é mais a única WIP** — ver **[§24n](#24n)**.
> **Detalhe completo + próximos passos em [§24n](#24n)/[§24m](#24m) (topo do bloco de addenda) e no [STATUS-2026-06-28.md §0](STATUS-2026-06-28.md).**

> **⚠️ ATUALIZAÇÃO 2026-06-23 — ler antes de §3/§20/§21/§22.** O experimento do Plano 3
> **foi concluído** sobre um golden **prospectivo** (pilot-2) que **supersede** o pilot-1
> citado nas seções abaixo. §3, §20, §21 e §22 descrevem o estado de **2026-06-19**
> (golden pilot-1, 0/90, experimento por rodar) e estão **desatualizadas**: o golden já
> foi rotulado (90 labels), os candidatos rodaram e há resultado. Estado atual + decisão
> pendente no novo addendum **§24i** (topo do bloco de addenda). **TL;DR:** LLM ≫ baselines
> determinísticos (D1/D2); o candidato com digest (e1, MAE holdout 0.441) bate o sem-digest
> (b1, 0.500) mas com **IC⊃0 (inconclusivo)**. **CONTRATO RATIFICADO 2026-06-23 = `b1`**
> (LLM perfil+sinopse+tags, **Sonnet**, sem digest) = contrato **v2 atual** (sem nova
> `prompt_version`, sem migration). **Lote 02 CONCLUÍDO 2026-06-23** — catálogo inteiro
> (757/757, $5.86, perfil v8 — §24j); catálogo 100% fresco. As três frentes estão
> essencialmente fechadas; o que resta é hardening/operação recorrente + **F1 (auth)** antes do deploy.

---

## 1. Objetivo

Três frentes derivaram de [AUDIT_REPORT.md](AUDIT_REPORT.md) e se entrelaçaram:

1. **Arquitetura/orquestração de dados** ([ARQUITETURA-ORQUESTRACAO.md](docs/archive/ARQUITETURA-ORQUESTRACAO.md), derivada de [AUDITORIA-CICLO-VIDA-DADOS.md](AUDITORIA-CICLO-VIDA-DADOS.md)).
2. **Backfill das obras existentes** (Potencial de Interesse) — [PLANO-BACKFILL-ORQUESTRADO.md](docs/archive/PLANO-BACKFILL-ORQUESTRADO.md), [PILOTO-BACKFILL-INTERESSE.md](docs/archive/PILOTO-BACKFILL-INTERESSE.md), [LOTE-01-BACKFILL-INTERESSE.md](docs/archive/LOTE-01-BACKFILL-INTERESSE.md).
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
| **2 — Backfill de Interesse** | **completed** (ver §24j) | Piloto (12, $0.62) + Lote 01 (100, $0.75) + **Lote 02 (catálogo inteiro, 757/757, $5.86, 2026-06-23)**; perfil **v8** fresh, `recalc_pending=false`; catálogo 100% fresco (sem mais split 112/~622). |
| **3 — Plano 3 (Interesse na Obra)** | **experimento concluído** (ver §24i) | ~~Infra da Fase B pronta; golden 0/90; piloto não rodado~~ → pilot-1 **superseded** (leakage retrospectivo); golden **prospectivo pilot-2** rotulado (90 labels, `a8abddca…`) e candidatos b1/e1/D1/D2 executados. Resultado: **LLM ≫ D1/D2**; **e1 (com digest) MAE 0.441 < b1 (sem) 0.500**, mas IC⊃0 (inconclusivo). **Contrato RATIFICADO 2026-06-23 = b1 (Sonnet, sem digest)**; próximo = **Lote 02** (~622) sob v2. |

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
90 linhas (sample_version=pilot-1)  ·  human_label preenchido = 0/90  ← golden pilot-1 NÃO rotulado em DB
# NOTA (2026-06-23): pilot-1 foi SUPERSEDED (leakage retrospectivo). O experimento migrou para o
# golden prospectivo pilot-2 (90 obras não lidas), rotulado e executado LOCALMENTE (.local-experiments,
# embargado) — esta tabela em DB segue com 0/90 de propósito. Ver §24i.
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

Comparando [ARQUITETURA-ORQUESTRACAO.md](docs/archive/ARQUITETURA-ORQUESTRACAO.md) / [AUDITORIA-CICLO-VIDA-DADOS.md](AUDITORIA-CICLO-VIDA-DADOS.md) com o código:

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
| P1 | Digest entra no contrato vencedor? | ⚠️ **REVISTO 2026-06-28 (§24m): SIM no preditor de Interesse** — golden-3 (n=180) deu GO; e1/`v3` em produção. **NÃO na Nota Prevista** (Ridge, redundante por ablação). Backfill de digest **REABERTO**. _(Histórico: RATIFICADO 2026-06-23 NÃO/`b1` a n=90 com IC⊃0 — ver §24i.)_ |
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

Já gastos (atualizado 2026-06-23): piloto 2B.1 **$0.62** + Lote 01 2C.2 **$0.75** + Lote 02 **$5.86** (perfil v8 + 757 previsões) + experimento Plano 3 **$2.31** (51 digests $0.86 + b1 $0.66 + e1 $0.79) = **≈$9.54**. Ver §24i/§24j.

---

## 17. Migrations conhecidas

Todas as relevantes estão **APLICADAS** (🟩 confirmado por colunas/linhas existentes):
`085/086` (synopsis_quality_predictions + multi-version), `103` (review_digest), `104` (tier_band_width), `105` (prediction_snapshots), `107` (ai_cache_events), `108` (synopsis_quality provenance), `109` (synopsis_interest_golden), `110` (work_processing_jobs), `111` (input_signature), `112` (work_external_reviews_manual — canal de reviews externas manuais text-only), `113` (drop provenance CHECK), `114` (drop metadata → text-only). As **112–114** foram aplicadas à mão **depois** desta etapa-ponte (durante o pilot-2) e mergeadas no PR #9 (commit `c964048`) — ver §24i.

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
| Arquitetura | `runDigestBatch`/`planDigestBatch` (lote orquestrado) | **REABERTO (§24m)** ⚠️ | PLANO-BACKFILL §7/§10/§30; **ausente** no código (G2) | **construir — digest venceu (golden-3); é o que falta p/ backfillar digest do catálogo** | backfill de digest das 489 |
| Arquitetura | migrar lote legado de digest p/ orquestração | partial | `consolidatePendingReviewDigests` bypassa o gate (G3) | substituir após winner | nada crítico hoje |
| Arquitetura | Interest sem digest = `ready_partial` (caso §2) | deferred | digest não é input do contrato (G1) | reabrir no contrato do winner | nada (decisão de design) |
| Backfill | inventário + dry-run + custo | completed | PLANO-BACKFILL §1–4; `dd30a66` | — | — |
| Backfill | executor seguro (2A/2A.1) | completed | interest-backfill.ts; `f1b4679`/`9b16a91` | — | — |
| Backfill | piloto 12 obras (2B.1) | completed | PILOTO §RESULTADO; $0.62; `6775003` | — | — |
| Backfill | recalc headless-safe (2B.2) | completed | `recalculateScoresHeadless`; `recalc_pending=false`; `0ed84d6` | — | — |
| Backfill | Lote 01 (100 obras, 2C.2) | completed | LOTE-01 §RESULTADO; $0.75; 112 modernas; `aedb4d5` | — | — |
| Backfill | **Lote 02 (catálogo inteiro)** | completed (§24j) | 757/757 ($5.86), perfil v8, recalc ok (2026-06-23) | — | — |
| Backfill | digest da cauda reviewável | **REVISTO (§24m)** ⚠️ | D2 superseded; mas digest **já cobre 481/773 = 62%** (medido 06-28) — resta ~60–130 obras reviewáveis | completar a cauda (~$1–3) + re-prever obras antigas em `v3` | qualidade do e1 na cauda |
| Plano 3 | proveniência synopsis_quality (c1) | completed | migration 108; `2a5003a` | — | — |
| Plano 3 | golden sample + rúbrica (c2) | completed | golden-sample.pilot-1.json (FROZEN); `9c70621` | — | — |
| Plano 3 | rotulagem cega (fluxo) (c3) | completed | labeling-sheet; `03476ac` | — | — |
| Plano 3 | métricas + baselines D1/D2 (c4/c6) | completed | metrics.ts/baselines.ts; `deacf0c`/`d238e4c` | — | — |
| Plano 3 | staleness + runner dry-run (c5) | completed | staleness.ts/synopsis-interest-run.ts; `af93025` | — | — |
| Plano 3 | **rotular o golden** (humano) | completed (pilot-2, §24i) | pilot-1 superseded; golden prospectivo pilot-2 rotulado (90 labels, `a8abddca…`) | — | — |
| Plano 3 | **piloto LLM** (b1, sem digest) | completed (pilot-2, §24i) | b1 90/90; MAE holdout 0.500; $0.66 | — | — |
| Plano 3 | **candidato COM digest** (e1) | completed (pilot-2, §24i) | e1 90/90; MAE holdout 0.441; $0.79 | — | — |
| Plano 3 | fallback digest→summary→no_reviews | completed (pilot-2, §24i) | `no_reviews_available` explícito; 9 obras sem reviews tratadas à parte | — | — |
| Plano 3 | comparar candidatos + escolher contrato | completed (§24i) | comparação FEITA + **contrato RATIFICADO = b1 (Sonnet, sem digest), 2026-06-23** | Lote 02 sob v2 | — |

---

## 21. Pontas soltas

| Item | Responsável/fase | Bloqueia? | Critério de fechamento |
|---|---|:--:|---|
| Golden rotulado | Plano 3 / Fase 3 | **resolvido** (§24i) | pilot-2: 90 labels (`a8abddca…`); pilot-1 superseded por leakage retrospectivo |
| Piloto LLM Plano 3 | Plano 3 / Fase 3 | **resolvido** (§24i) | b1/e1 executados 90/90; resultados em §24i |
| Candidato com digest | Plano 3 / Fase 3 | **resolvido** (§24i) | e1 executado; MAE holdout 0.441 (IC⊃0 vs b1) |
| Digest só nas obras do golden | Fase 2A | **sim** (p/ o candidato digest) | digest válido nas ≤80 obras com review do golden |
| `runDigestBatch`/`planDigestBatch` (G2) | Arquitetura | não (p/ experimento) | construído **se** digest vencer; reusa `ensureReviewDigest` |
| Lote legado de digest bypassa o gate (G3) | Arquitetura | não | migrado p/ orquestração ou aposentado |
| Interest "sem digest" ≠ ready_partial (G1) | Arquitetura | não | reabrir no contrato do winner (digest opcional + reprevisão) |
| Lote 02 (~622) suspenso | Backfill / Fase 2B | **sim** (conclusão) | rodar só após winner, sob o contrato final |
| Backfill de digest das 489 | Backfill / Fase 2B | não | condicional ao winner usar digest |
| Auto-refresh de previsões pós-perfil (G4) | Arquitetura | não | decisão de produto pós-contrato |

---

## 22. Próximo escopo recomendado (UMA etapa — não executar agora)

> **SUPERSEDED por §24i (2026-06-23).** A recomendação histórica abaixo (rotular o golden +
> piloto LLM) **já foi cumprida** no pilot-2: golden rotulado (90 labels), candidatos
> b1/e1/D1/D2 executados, resultado registrado. **Contrato RATIFICADO 2026-06-23 = b1;
> próximo passo = Lote 02** (não mais "ratificar"):
> - ✅ **`b1` ratificado** (LLM sem digest, Sonnet) como contrato; **não** se faz o backfill de
>   digest das 489 (o ganho do digest tem IC⊃0 — custo certo ~$23–35 por ganho incerto).
> - Em seguida: **Fase 2B** = Lote 02 (~622) sob o contrato **v2 atual** (sem nova
>   `prompt_version`; as 112 previsões existentes seguem válidas como baseline).
> - Reabrir o digest **só** com mais labels (poder estatístico) — alavanca real, não outra variante.

**Recomendação (histórica, 2026-06-19): retomar o Plano 3 pela rotulagem do golden + piloto LLM** (Fase 3, precedida do mínimo de 2A: digest só no golden). É o **gargalo real** — sem golden rotulado e sem o candidato com digest, não há como congelar o contrato, e sem contrato congelado todo backfill pago é especulativo.

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
| F5 | Ridge × calc sem ganho | deferred | **re-validado fresco (§24k): OOF honesta 0.570 vs calc 0.588, edge dentro do ruído** | hardening | não | simplificar p/ calc (ganho marginal, $0) — decidir | decidir simplificação |
| F6 | alignment (Veredito IA) sem ganho | deferred | **re-validado fresco (§24k): lift −0.232 IC exclui 0 (pior); ⚠️ alignment talvez stale** | decisão de produto | não | re-medir barato (`rerankStaleBatchAction(n)`, amostra ~$0.2–0.5) OU aposentar; **custo idle = 0** (re-rank pago sob demanda) | deferido sem custo: re-medir/aposentar só quando o sort pago importar (perto do multi-user) |
| F7 | personal_fit redundante | **completed** | **re-validado fresco (§24k): std 0.065; ρ0.47 sozinho mas Δ incremento IC⊃0**; **sort default 'Recomendado' JÁ unificado p/ expected_score + tiers + tag_overlap (PRs #11/#12, ranking.ts:681)** | hardening | não | personal_fit removido do peso do sort; segue só como display | — (feito) |
| F8 | dois sistemas de mood | deferred | preset × drawer (§10) | decisão de produto | não | unificar semântica | decidir |
| F9 | validação prospectiva | partial | `prediction_snapshots` mig 105 aplicada; **hooks JÁ conectados** (record em `runRecommendationAction` recommendations.ts:338; resolve em `updateWork`/`updateWorkStatus` works.ts:1431); falta só **dado acumulado** | operação recorrente | não | usar o app (recomendar + salvar notas) → painel sai do vazio | **verificar end-to-end no app** + acumular (não é mais "ligar hooks") |
| F10 | `synopsis_quality_predict` em Sonnet (custo/modelo) | **partial (respondido em parte, §24i)** | pilot-2: LLM (sonnet) ≫ D1/D2 (MAE 0.44–0.50 vs 0.79–0.91) ⇒ manter LLM | **Plano 3** | não | núcleo respondido (não trocar por determinístico); **Sonnet×Haiku ainda não testado** | ratificar manter-LLM; Haiku = hardening opcional |
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
| L5 | review_digest 2% | **partial (respondido, §24i)** | pilot-2: e1(digest) bate b1 mas IC⊃0 (inconclusivo) | Plano 3 → backfill final | não | digest **não recomendado** agora ⇒ backfill 489 dispensado se b1 vencer | ratificar b1; reabrir digest só com mais labels |
| L6 | taste_profile regen só pago | partial | v7 fresh; auto-refresh deferido | operação recorrente | não | política de refresh fora do pago OU aviso de velho | decidir pós-contrato |
| L7 | previsões stale (catálogo) | partial | 112 modernas / ~622 pendentes | backfill final | não (suspenso de propósito) | Lote 02 sob contrato final | após winner |
| L8 | recalc após update (stale) | partial | `markRecalcPending`; headless-safe ok | operação recorrente | não | = F11 | = F11 |
| L9 | provenance `synopsis_quality_source` | partial | 100% `legacy_unknown` | operação recorrente | não | sinal útil só após re-saves humanos | aguardar uso |
| L10 | alignment stale | not_applicable | re-rank manual de propósito | decisão de produto | não | ausência legítima | — |
| L11 | dados externos estagnados | deferred | = F12 | operação recorrente | não | = F12 | = F12 |
| L12 | readiness parcial/completa (materializar) | partial | resolver derivado; materialização parcial | hardening pós-Plano 3 | não | expor readiness na UI/ranking (AUDITORIA §10) | hardening |
| L13 | mudança de tags → staleness da previsão | **completed (superseded)** | `input_signature` (mig 111) **inclui tags** ⇒ tags mudam → stale | — | não | resolvido (supera AUDITORIA §11 caso 15) | — |
| L14 | lote legado de digest bypassa o gate | partial / legacy | `consolidatePendingReviewDigests` sem gate | backfill final / pós-Plano 3 | não | migrar p/ `runDigestBatch` OU aposentar | após winner |
| C1 | **mismatch de constructo** (sinopse-only × contextual) | **completed** | B2.1D: golden contextual único; synopsis-only superseded | Plano 3 | não | constructo = Potencial de Interesse na Obra; candidatos S0..e1 | rotular contextual (após 51 digests) |
| C2 | **visibilidade de obras sem reviews** | **completed** | aba "Sem reviews" em `/ai-evaluation` (diagnóstico read-only) | operação recorrente | não | obras com 0 review útil visíveis + ação manual | usar p/ priorizar inclusão manual |
| C3 | **ausência de reviews como risco de qualidade** | **partial** | `no_reviews_available` explícito; análise separada; aviso de custo×qualidade | Plano 3 / operação recorrente | não | grupo sem reviews analisado à parte; não escondido na métrica | medir no experimento |

### 23.3 Resumo

| Estado | IDs | n |
|---|---|--:|
| completed | F2, F4, F7, L1, L13 | **5** |
| partial | F3, F9, F10, F11, F13, F15, L2, L4, L5, L6, L7, L8, L9, L12, L14 | **15** |
| planned | F1 | **1** |
| deferred | F5, F6, F8, F12, L11 | **5** |
| not_applicable | L3, L10 | **2** |
| blocked | — | **0** |

**Principais bloqueadores:**
- do **experimento:** ✅ **resolvidos (§24i)** — golden prospectivo pilot-2 rotulado (90 labels) · candidatos b1/e1/D1/D2 executados · digests do golden gerados. Resta **ratificar o contrato (P1)**.
- do **deploy (não agora):** **F1** (auth + rate limit).

**Fase responsável por grupo:**
- **Plano 3 (experimento concluído, §24i):** F10, L5 — o experimento decidiu (manter LLM; digest inconclusivo/dispensado). Resta ratificar o contrato (P1).
- **pré-Plano 3 (feito):** F2, F4.
- **backfill final:** L7, L14.
- **pré-deploy:** F1.
- **hardening pós-Plano 3:** F3, F5, F7, F13, F14, F15, L12.
- **operação recorrente:** F9, F11, F12, L2, L4, L6, L8, L9, L11.
- **decisão de produto:** F6, F8, L3, L10.

> Regra mantida: item adiado **não desaparece** (fica nesta matriz); F5/F6/F7/F8/F9 têm destino explícito; F12 tem "política de atualização" como critério; F14/F15 ficam no hardening técnico; F1 segue bloqueando o deploy.

---

<a id="24n"></a>
## 24n. Addendum — Console /settings + trava de recálculo + poda de branches (2026-06-30)

> Addendum **mais recente**. Trabalho de **UI/ops** — não mexe na ciência/roadmap de notas; por isso o §24m
> segue como estado autoritativo da frente de dados. Detalhe completo em **[STATUS-2026-06-28.md §0](STATUS-2026-06-28.md)**.

- **PR #26 merjado** (`feat/pag-titles` → `main`, `f781b68`): console **`/settings` reorganizado por natureza**
  em 4 grupos ordenados por frequência (Calibração das notas → Gerado por IA → Fontes externas/Comix →
  Avançado/recolhido); 1 accent por grupo, **chips de custo/cadência**, **tooltips (ⓘ) por grupo**, card
  **Comix unificado**, toggles de criação reunidos. **Trava de recálculo** (`AiPendingGuardDialog`): "Recalibrar
  agora" (painel) **e** o botão de recalcular da sidebar/banner avisam quando há artefatos de IA pendentes
  (embeddings/sinopse canônica/resumo). Calibração de critérios IA: confiança default **90**, filtro
  "Critério"→**"Atributo"**. Limpeza de `revalidatePath` redundantes.
  - Nota técnica: `recalculateNow` (painel) e `triggerRecalcNow` (sidebar) são **o mesmo job**
    (`recalculateAll`, single-flight, force=true) — só mudam o contrato de retorno.
- **Poda de branches:** origin agora = **`main` + `feat/shadow-ranking`**. Apagadas (merjadas): `feat/pag-titles`
  (#25/#26), `perf/ai-evaluation-…` (#23), `feat/exploration` (#22 — origin; worktree/local mantidos).
- **Correção à triagem de §24m/§1:** **`feat/shadow-ranking` NÃO é mais a única WIP.** Há nova WIP real (fora do
  `main`, sem PR): **`feat/review-embeddings-ranking-transparency`** (worktree `animedb`) — ranking pré-filtros
  + Alinhamento por percentil (`c39a562`) e embeddings com digest/resumo no texto embedado (`9c8082e`).

---

<a id="24m"></a>
## 24m. Addendum — Virada do digest (golden-3) + e1 em produção + triagem de branches — ✅ ESTADO AUTORITATIVO (2026-06-28)

> **Addendum mais recente — fonte de verdade deste doc.** Reconcilia o corpo (congelado em 06-19,
> com addenda até §24l/06-25) com as duas viradas posteriores. Onde este addendum conflita com o
> corpo ou com §24i, **este prevalece**.

### 1. A virada: golden-3 (n=180) inverteu o veredito do digest
- O pilot-2 (§24i, n=90) deixou e1 (com digest) vs b1 (sem) **inconclusivo** (IC⊃0). Coletou-se mais
  rótulo → **golden-3, n=180** (digest-v1 de produção, 2026-06-25): **ΔMAE e1−b1 = −0,211
  [IC95 −0,311; −0,117]** — **exclui 0**, material. MAE ordinal **b1 0,667 → e1 0,456**;
  exact/QWK/ρ/pairwise todos melhoram (0,41→0,59 / 0,40→0,52 / 0,41→0,57 / 0,77→0,88).
- Robusto sem reuso (n=129: −0,202), bucket fino 2–4 (−0,255) e rico 10+ (−0,217). Holdout (72)
  tangencia 0 ([−0,319; 0]). Custo real: digests $3,59 + predições $2,91.
- **Ressalva honesta:** Protocolo C **infla a magnitude** (humano E e1 veem o digest) — o **sinal** é
  sólido, a **magnitude** é otimista. Validação contra `user_score` real só virá do ledger
  `prediction_snapshots` (hoje 0 linhas). b1 é baseline fraco (quase chute); o digest **calibra**
  (b1 super-estima +0,26 → e1 −0,14).

### 2. e1 em produção (2026-06-27/28)
- `PROMPT_VERSION` `v2 → "v3"`: digest entra no system+user **e** na `input_signature` (bug corrigido:
  o digest era omitido em 3 de 4 call-sites da assinatura). PRs **#15** (recalc/materialidade/drift) e
  **#18** (rollout e1). Backfill operacional: **414/758 obras** com previsão e1 (v3); perfil regenerado
  até **v16**. Custo total ≈ **$7,1**. _(Medido no banco 2026-06-28: 454/773 obras distinct com previsão `v3`; `review_digest` 481/773 = 62%; `prediction_snapshots` 0 linhas.)_ Migrations **119** (toggle sinopse canônica no create) e **120**
  (`works.ai_eval_reviews_stale`) aplicadas à mão.
- **Onde o digest vale:** Interesse na Obra (♥) / Veredito IA / **ordenação holística**.
  **Onde NÃO vale:** **Nota Prevista (Ridge)** — ablação $0 mostrou SinopseScore legado redundante
  (ΔMAE +0,0007). Digest **não** entra no preditor de nota.

### 3. Decisões revistas (vs §15/§20/§24i)
| Decisão antiga | Estado novo (2026-06-28) |
|---|---|
| P1: "digest NÃO entra / b1, sem digest" | **Invertida**: digest **ENTRA** no Interesse (e1/v3); **NÃO** na Nota Prevista |
| D2: "adiar backfill de digest (não alimenta Interesse)" | **Superseded**: e1 usa digest. Mas cobertura **medida 06-28 = 481/773 = 62%** (não os 2% do doc de 06-18 — o rollout do e1 já backfillou via cascata); resta só a cauda reviewável |
| G2: "`runDigestBatch` só se digest vencer" | **Reaberto**: digest venceu ⇒ é o que falta p/ backfillar digest do catálogo |
| "Lote 02 = ~622 pendentes" | **Obsoleto**: Lote 02 fez **757/757** ($5,86, perfil v8). Pendência atual = **e1 v3 em ~344 obras** (758−414), por demanda ou lote |
| F10: "manter LLM" / "LLM ≫ determinístico" | **Mantida** (golden-3 reforça) |

### 4. Triagem das branches WIP (forense de git, 2026-06-28)
- Todas as 5 saíram do merge-base **2026-06-12** e ficaram **12 PRs atrás** de `main`. Conteúdo do
  Plano 1/2 (observability + cache) foi **re-implementado e mergeado** via PRs #9–#19 (`main` é superset).
- **Apagadas (locais + remotas), sem perda:** `feat/realtime-chrome-refresh`, `feat/ai-observability`
  (PR #8 fechado como superseded), `feat/ai-reliability`, `feat/synopsis-quality-optimization`.
- **Preservada:** `feat/shadow-ranking` — única com código exclusivo (7 estratégias de ranking +
  `migration 106 ranking_strategy_snapshots`). **Porém redundante em propósito** (F5/F6/F7 já
  respondidos offline por §24k). Decisão pendente: descartar **ou** rebasear p/ validação prospectiva
  contínua (liga-se a F9).

### 5. O que segue em aberto (ver [STATUS-2026-06-28.md](STATUS-2026-06-28.md) p/ a lista completa + próximos passos)
- **F9 / `prediction_snapshots`**: 0 linhas — só acumula com uso do app; destrava F3 (largura de tier).
- **`runDigestBatch` + backfill de digest** (reabertos): construir ou aceitar e1 com cobertura parcial.
- **F1 (auth/rate-limit)** vs deploy público no Fly: tensão a decidir antes de expor a URL.
- **Auto-refresh pós-perfil/recalc** (F11/G4): recalc ainda 1h/manual.
- **F6 (alignment/Veredito IA)**: lift −0,232 (IC exclui 0) — aposentar ou re-medir.
- **Drift do perfil**: proxy heurístico (mig 118) não validado.

---

## 24l. Addendum — Tags inferidas por IA (sinopse + reviews) para obras da cauda — ✅ CONCLUÍDO (2026-06-25)

> **STATUS: ✅ CONCLUÍDO — 1019 tags `ai_inferred` gravadas, custo LLM total ~US$ 2,16, [PR #14](https://github.com/acgeners/vibematch/pull/14) (merged).** Trabalho **fora** do eixo Auditoria→Plano 3, registrado aqui como log da sessão. Doc dedicado: [PLANO-TAGS-IA.md](docs/archive/PLANO-TAGS-IA.md). 🟩 banco (read+write) · 🟦 código · 🟧 decisão.

**Problema.** Obras da cauda com poucas/zero tags. Tags alimentam o **desempate intra-tier `tag_overlap_net`** (maior alavanca de recomendação — §F7/PRs #11-13), a feature do Ridge e o input da avaliação IA. As fontes externas são pobres justo nessas obras → única fonte de tag específica = a **sinopse** (+ reviews).

**Diagnóstico (🟩).** Cauda menor que a premissa: 758 ativas, **45 com ≤5 tags / 10 com 0** (86,5% já com 11+). 100% das ≤5 com sinopse canônica e ID externo.

**Execução (3 frentes):**

| Frente | Mecanismo | Resultado |
|---|---|---|
| Backfill grátis | re-ingestão de tags externas (`refreshWorkExternalData`, aditivo) | 194 tags / 44 obras · $0 |
| Inferência da sinopse | Haiku 4.5, candidate→filter (vocabulário fechado ~630 tags, structured output via forced tool, `evidence` anti-alucinação, filtro client-side) | 673 alta + 158 média |
| Passada com reviews | `--with-reviews`: `review_summary`/`review_digest` como evidência extra (grava só tags novas) | 144 alta + 44 média |

**Qualidade (🟧).** "alta" = clara no texto; **"média" passa por 2º olhar estrito do Sonnet 4.6** (juiz independente, sem ver a confiança original — ~40-49% confirmadas). O Sonnet rejeitou a média justamente nos grupos "vibe" (tone_mood) e tags genéricas (Character Growth), coerente com a distribuição (%média alto em tone_mood 56%, ~0% em superpowers/character_profile-Role).

**Resultado (🟩).** **1019 tags `ai_inferred`** (673 sinopse-alta + 158 sinopse-média + 144 review-alta + 44 review-média). Cauda **eliminada**: ≤5 tags **45→3**, zero **10→0**, 11+ **86,5%→96%**.

**Proveniência/reversão (🟦).** Migration **117** (aplicada): `work_tags.source`/`confidence`/`created_at`. Reverter: `DELETE FROM work_tags WHERE source='ai_inferred'`.

**Custo (🟩).** ~US$ 2,16 (tag_inference Haiku $1,24 + tag_verify Sonnet $0,92). Caching não pegou (menu ~3,8k tok < mín 4096 do Haiku) — irrelevante no valor.

**Decorrências (🟧).** (a) `review_digest` (L5) ganhou um uso prático — evidência de tag em 10/85 obras — além da previsão de Interesse. (b) Tags mais ricas reforçam o desempate `tag_overlap_net` (F7). (c) Resta opcional: validar no app; eventual 2ª passada das média rejeitadas só com mais sinal.

---

## 24k. Addendum — Re-validação F5/F6/F7 sobre catálogo fresco (2026-06-23)

> **Resultado: as conclusões "a sofisticação não paga" NÃO eram artefato de staleness.** Offline ($0), read-only, sobre o catálogo fresco do Lote 02 (perfil v8 + 757 previsões + recalc; **n=197** rotuladas). Números da própria produção (`formula_config`) + bootstrap pareado (B=2000). Responde a **Oportunidade 1** levantada pela auditoria de ciclo de vida (era staleness ou sinal real?).

| Finding | Original | Fresco | Veredito |
|---|---|---|---|
| **F5** Ridge × calc | ≈ empate, IC⊃0 | OOF honesta expected **0.570** vs calc **0.588** (edge ~0.018, dentro do ruído; in-sample best-case Δ−0.046 IC[−0.077,−0.017]) | **Confirmado** |
| **F7** personal_fit | constante, sem incremento | std **0.065**; sozinho ρ**0.47** (tem sinal) mas incremento sobre calc Δ**−0.030** IC[−0.098,+0.030]⊃0 | **Confirmado** (redundante, não ruído) |
| **F6** alignment | sem lift, IC⊃0 (n=103) | alignment ρ**0.12** vs expected ρ**0.35**; lift **−0.232** IC[−0.419,−0.038] **exclui 0** (n=108) | **Reforçado** (ativamente pior) |

- **F5:** ponto OOF honesto da produção; **sem** IC pareado honesto-vs-calc fresco (exigiria reconstruir o pipeline OOF por-obra). In-sample = cota superior do Ridge.
- **F6:** ⚠️ `alignment_score` é re-rank **sob demanda** e **não foi refrescado** pelo Lote 02 — valores possivelmente stale; confirma "sem lift" mas refrescar é checagem paga separada.
- **n=197** ainda pequeno; alavanca real = **mais rótulos**.

**Decorrência:** abre a discussão de **simplificar** — retirar `alignment` (ganho mais claro: poupa LLM pago + remove sinal nocivo) e/ou remover o Ridge (simplicidade de código; ganho de MAE marginal, $0 nos dois lados). Junto com a [verificação de tags](project_audit_tag_features_verified) (não-degradadas), fecha as duas pontas que "ficaram pra trás" pela ordem das auditorias.

---

## 24j. Addendum — Lote 02 (backfill de Interesse) sob contrato b1 — ✅ CONCLUÍDO (2026-06-23)

> **STATUS: ✅ CONCLUÍDO — 757/757, custo real $5.86.** Primeira execução do backfill de
> Potencial de Interesse sob o **contrato b1 ratificado** (§24i). Read-only salvo a própria
> run paga (gated por `planSignature` + teto). **Catálogo agora 100% fresco sob o perfil v8.**

**Decisão e gate:**
- Contrato = **b1** (v2 atual, **Sonnet**, sem digest) ⇒ sem nova `prompt_version`, sem migration.
- Escopo: **completo** (catálogo inteiro). Perfil estava **stale** ⇒ o plano **regenera o perfil 1× (v7→v8)** e prevê TODAS as obras elegíveis (não prevê parcial contra perfil stale — aviso do dry-run).
- Dry-run: total=**757**, fresh=108, stale=626, ausente=23, bloqueadas=0 · likely **$8.34** / upper **$12.51**.
- 1ª tentativa (planSignature `3936a848…`) **abortou `plan_changed`** ($0, 0 obras previstas) — drift do catálogo entre dry-run e execute; gate de frescor funcionou.
- Execução válida: re-plano encadeado → planSignature `86a1de3b…`, `--max-cost-usd=13`, concorrência 3, início ~19:19.

**Entradas confirmadas (auditadas hoje):**
- **Perfil** = sua biblioteca avaliada (`works` com `user_score`, top 200 por `updated_at`): título · nota · status pessoal · sinopse · 9 category_scores · tags · 8 post-scores.
- **Previsão (b1)** = perfil + título + sinopse (canonical→raw mais longa) + tags. **NÃO** usa digest/summary/reviews nem category-scores da obra-alvo.
- **Features de tag** verificadas **não degradadas** por casing/group=null (Oportunidade 3 + risco L2-acoplado **refutados** empiricamente: 0 grupos nulos, 0 ambiguidade nome→grupo em 1478 tags / 25.917 work_tags).

**Resultado ✅ (2026-06-23, 19:19 → 19:55):**
- status: **COMPLETED** · planned=757 · started=757 · **succeeded=757** · failed=0 · blocked=0 · changedDuringRun=0
- stoppedByCost / stoppedByPlanChange / stoppedByCancel: todos **false**
- perfil: v7 → **v8** (`profileUpdated=true`) · recalc: **executado, sem falha** (`recalcExecuted=true`, `recalcFailed=false`)
- **custo real: $5.86** (vs likely $8.34 / upper $12.51 — ~metade do upper, como esperado pelo histórico)
- duração: **2184s (~36 min)**, concorrência 3
- cobertura: **757/757** previsões modernas frescas contra o perfil v8 (100% do catálogo elegível)

**Consequência:** o catálogo está **fresco pela 1ª vez** (perfil v8 + 757 previsões + recalc) ⇒ destrava a re-validação de **F5/F6/F7** sob a dimensão de staleness (Oportunidade 1), agora sem o confound de dados velhos.

---

## 24i. Addendum — Pilot-2 prospectivo: experimento CONCLUÍDO + decisão do contrato pendente (2026-06-22 → 23)

> **⚠️ SUPERSEDED PARCIAL (2026-06-28, §24m).** A ratificação "**b1, sem digest**" registrada nesta
> seção valia a **n=90** (e1−b1 com **IC⊃0, inconclusivo**). A **golden-3 (n=180, 2026-06-25)** reverteu:
> ΔMAE **−0,211 [IC −0,311; −0,117]** ⇒ digest **GO** no preditor de Interesse; **e1/`v3` em produção**.
> Mantida como registro do estado de 2026-06-23. O "manter LLM (F10)" e o "LLM ≫ determinístico"
> abaixo **continuam válidos**.

> **VIRADA DE ESTADO — addendum mais recente.** O experimento do Plano 3 **rodou e concluiu**
> sobre um golden **prospectivo** (pilot-2), que **supersede** o pilot-1 descrito em
> §3/§20/§22 e nos addenda §24–§24h. Resultados **agregados** abaixo; os **rótulos humanos**
> e outputs por-obra permanecem **embargados** (locais em `.local-experiments/plan3/…`,
> gitignored) — aqui só agregados/assinaturas, mesma convenção de B2.2B. Plano detalhado em
> [PLANO3-GOLDEN-PILOT-2-PLAN.md](docs/archive/PLANO3-GOLDEN-PILOT-2-PLAN.md). A infra do **canal de
> review externo** (migrations 112–114) foi mergeada na `main` (commit `c964048`, PR #9, 2026-06-23).

**Por que pilot-2 (e por que pilot-1 ficou superseded):** ao rotular o `contextual-1` (pilot-1, 80 obras) descobriu-se **leakage retrospectivo** — parte das obras já fora lida, impossibilitando separar *interesse antes de ler* (o alvo do experimento) de opinião pós-leitura. O pilot-2 reconstrói o golden **só com obras não lidas**, classificadas automaticamente por `works.personal_status_id` (`unread` / `partially_read` / `fully_read`; só `unread` entra na métrica prospectiva). O pilot-1 é mantido como **trilha retrospectiva** — nunca entra na métrica prospectiva principal.

**Golden pilot-2 (prospectivo, FROZEN):** 90 obras únicas não lidas (51 carryover `unread` do pilot-1 + 39 novas) · 100 slots (90 + 10 repetições intra-avaliador) · split **56 dev / 34 holdout** · strata ♥/♥♥/♥♥♥/♥♥♥♥ ≈ 22/23/23/22. Corpus de reviews recomputado sob política **text-only-v1** (`base-2r1`, gate `base2r1Signature=b9dc2f27…`). Reviews lidos do corpus canônico (`work_reviews` + `work_external_reviews_manual`); `work_manual_reviews` (opinião pessoal) **proibida** no corpus por guard estático (anti-leakage).

**Rotulagem humana: CONCLUÍDA e CONSOLIDADA** (local, $0) — 99/99 slots rotulados → **90 labels finais** por obra única (89 do pacote + 1 reuso comprovado por assinatura de display do pilot-1). Distribuição **♥15 / ♥♥44 / ♥♥♥22 / ♥♥♥♥9**. `finalLabelsSignature=a8abddca…`. Repetições 10/10 exatas (consistência intra-avaliador). Backup imutável das labels (csvSha `05e4ce77…`).

**Candidatos executados** (offline, contra os 90 labels; métrica principal = MAE ordinal no holdout):

| Candidato | Entradas | Tipo | Custo real | MAE holdout (n=34) | Spearman | pairAcc |
|---|---|---|--:|--:|--:|--:|
| **e1** | perfil + sinopse + tags **+ digest de reviews** | LLM (sonnet-4-6) | $0.79 | **0.441** | 0.684 | 0.935 |
| **b1** | perfil + sinopse + tags (= predictor de produção) | LLM (sonnet-4-6) | $0.66 | 0.500 | 0.620 | 0.908 |
| d2 | tags + keywords da sinopse | determinístico | $0 | 0.794 | 0.041 | 0.512 |
| d1 | tags × perfil (overlap ponderado) | determinístico | $0 | 0.912 | −0.041 | 0.480 |

`planSignature(b1/e1)=03f5b6f8…` · 90/90 succeeded cada · custo total pago **$1.45** (≪ hard-cap $3.02) · **0 escrita no banco** (send sem `createLoggedMessage`; só SELECT do perfil). **s0/s1** (contrato congelado, também LLM) **não executados** nesta fase — são pagos e sem substituto inventado (gap honesto, não falha).

**Leitura empírica (fato × inconclusivo):**
1. **LLM ≫ determinístico, sem ambiguidade (FATO):** b1/e1 (MAE ~0.44–0.50) esmagam d1/d2 (0.79–0.91); d1/d2 têm Spearman ≈ 0 (ordem inútil). ⇒ **manter o predictor LLM**; descartar trocá-lo por baseline determinístico. Responde **AUDIT F10** ("alternativa simples basta?" = **não**).
2. **Digest (e1) vs sem-digest (b1): direção a favor, mas INCONCLUSIVO.** e1 ganha nas 3 métricas de holdout, mas o **IC da diferença de MAE inclui 0 a n=90** — ganho não demonstrado estatisticamente. Mesmo padrão de Ridge≈calc / alignment / personal_fit no AUDIT_REPORT: **n pequeno não resolve diferenças finas**.

**Decisão do contrato (P1) — RATIFICADA 2026-06-23:**
- ✅ **Contrato = `b1`** (LLM perfil+sinopse+tags, **Sonnet**, **sem digest**). É o **contrato v2 atual** ⇒ "implementar o winner" é **no-op**: nenhuma nova `prompt_version`, nenhuma migration; as 112 previsões v2 seguem válidas como baseline.
- ✅ **Digest NÃO entra** — backfill de digest das 489 (~$23–35) **dispensado** (ganho do digest com IC⊃0; custo certo por ganho incerto). Reabrir **só** com mais labels (poder estatístico), não mais uma variante.
- ✅ **Modelo = Sonnet** (Haiku **não** será testado agora). Base: em regime estacionário o `synopsis_quality_predict` roda pouco (só obras novas/perfil), então a economia recorrente do Haiku é marginal e não paga o passo extra + risco de qualidade não medido. Haiku fica como **hardening opcional** se o volume crescer.
- ➡️ **Próximo passo = Lote 02** (~622 previsões pendentes) sob v2: dry-run → `--execute` com `planSignature` + teto, em lotes de ~200. Custo ~$5–10 one-time.

**Impacto neste plano (reconciliação):**
- §22 / §20 / §21: "rotular golden", "piloto LLM", "candidato com digest", "comparar candidatos" → **concluídos** (pilot-2). Gargalo agora = **ratificar o contrato (P1)**, não rodar o experimento.
- **AUDIT F10** e **AUDITORIA L5**: o experimento **respondeu** (manter LLM; digest inconclusivo/dispensado por ora).
- **Lote 02 (~622)** e **digest backfill (489)**: seguem corretamente **bloqueados** até a ratificação. Com **b1** vencedor: digest 489 **não é mais necessário** e o Lote 02 roda sob o contrato **v2** (sem re-previsão por mudança de contrato).
- **112 previsões v2** existentes: continuam como baseline válido; com b1 **não precisam ser re-previstas**.

**Migrations novas (aplicadas à mão, validadas; mergeadas no PR #9):** `112` (`work_external_reviews_manual` — reviews externas manuais, text-only, sem nota pessoal), `113` (drop provenance CHECK), `114` (drop colunas metadata → text-only). Corpus canônico unificado via `readCanonicalReviewCorpus`.

**Custos (reais):** experimento pilot-2 = digest do golden $0.86 (B2.2B) + b1 $0.66 + e1 $0.79 = **$2.31** (d1/d2 grátis). Backfill já gasto (piloto + Lote 01) = $1.37. **Total pago Plano 3 + backfill ≈ $3.68.**

**Fora de escopo / não feito:** nenhuma escrita em `synopsis_quality_predictions` de produção; nenhum digest 489; nenhum Lote 02; nenhum commit dos artefatos do pilot-2 (embargados). `dev:local-editor` parado.

---

## 24h. Addendum — Fase B2.2C: enriched-1 + pacote contextual cego (2026-06-20)

> **PRONTO PARA ROTULAGEM HUMANA CONTEXTUAL.** Read-only; zero chamada paga.
> Manifesto [PLANO3-GOLDEN-SNAPSHOT-ENRICHED-MANIFEST.md](docs/archive/PLANO3-GOLDEN-SNAPSHOT-ENRICHED-MANIFEST.md).

- **Pré-verificação (🟩):** base-1 íntegro (`634571c2…`/`8776419e…`), 80 obras, labels 0/90; **51/51 digests** `digest-v1` parseáveis/completos, **corpus inalterado 80/80**; **blocks=0** (sem corpus_changed/stale/inválido/failed). Nenhum summary fallback.
- **enriched-1** (deriva ESTRITAMENTE de base-1 + digests sanitizados): 51 `digest_available` + 29 `no_reviews_available`; `enrichedSnapshotSignature=8b61084d…`, `sanitizedDigestCorpusSignature=7958c236…` (determinístico — runs idênticas). Carrega congelados de base-1 (título/sinopse/tags/perfil/baseInputSignature); só acrescenta contexto.
- **Sanitização** (`sanitizeDigestForLabeling`): removeu nota-token (1) e recomendação (1). **Fix B2.2C:** o regex de recomendação não pegava acento (`recomendável`) — `\w`→`\p{L}` com flag `u`; regenerado deterministicamente → **0 nota / 0 recomendação / 0 URL / 0 contexto vazio** nos 51. Digest **bruto** persistido inalterado.
- **Pacote contextual cego** (`contextualPackageSignature=9e4d1b9f…`): HTML offline com SINOPSE + ELEMENTOS (tags `selectContextualTags`) + CONTEXTO DE LEITORES (digest sanitizado / no_reviews) + **rúbrica contextual** ([RUBRIC-CONTEXTUAL.md](lib/synopsis-interest/RUBRIC-CONTEXTUAL.md)). **Sem título** (b1 testa o título), sem work_id/scores/versões; **0 leakage** (validação estrutural); 90 cards; repetições idênticas sem marca; S078 com mensagem de elementos indisponíveis. CSV template vazio.
- **synopsis-only SUPERSEDED** (preservado; aviso local em `base-1/SUPERSEDED-NAO-USAR.txt`). Rotulagem ativa = `enriched-1/golden-contextual-labeling.html`.
- **Código (puro + testado):** `lib/synopsis-interest/{enriched,contextual-html}.ts` + gerador `scripts/synopsis-interest-enriched.ts`. **748 testes** (+24); tsc/lint/build verdes; build não gera o pacote. **Zero escrita no banco, zero LLM, zero migration.**
- **Desvio do runner B2.2B** (concorrência sequencial) registrado como observação não-bloqueante: verificar eficácia da concorrência antes de backfills maiores.

---

## 24g. Addendum — Fase B2.2B: 51 digests do golden EXECUTADOS (2026-06-20)

> **Execução paga autorizada e concluída.** Detalhes em [PLANO3-LOTE-DIGEST-GOLDEN.md](docs/archive/PLANO3-LOTE-DIGEST-GOLDEN.md) §RESULTADO.

- **Gates pré-execução (🟩):** dry-run final idêntico ao aprovado (`planSignature=e44e5996…`, 51 elegíveis, upper $3.41 ≤ $3.50); `snapshotBaseSignature=634571c2…`/`reviewCorpusSignature=8776419e…` batem; SHA dos 51 IDs `7b264c55…`; labels 0/90; 0 jobs ativos; 0 corpus drift; backup gitignored (sha `b0141e0d…`, 51 obras).
- **Resultado:** **51/51 succeeded**, 0 failed, status `completed`, exit 0, ~12 min. **Custo real $0.8578** (avg $0.0168, min $0.0082, max $0.0385) ≪ likely $2.27 ≪ upper $3.41 ≤ teto $3.50. **Só `review_digest`** — nenhuma outra operação paga.
- **Escritas:** `review_digest`/version/n/at nas **51** obras + **51 jobs** `generate_review_digest/succeeded` (attempts=1). **Zero** reviews/summary/predictions/candidatos/labels/perfil/recalc/migration.
- **Integridade (🟩):** só os 51 IDs (0 fora do golden); 29 `no_reviews_available` sem digest; corpus inalterado (51/51); predictions 1026 / taste_profile 7 / labels 0 inalterados.
- **Validação:** 51/51 estruturalmente válidos (`digest-v1`, campos completos, não-vazios); **0 leak de recomendação**; **1/51** com nota-token no digest bruto (a sanitização `RATING_RE` remove antes da rotulagem — não bloqueante).
- **Desvio:** runner roda **sequencial** (o `--concurrency=2` é aceito e ignorado) — mais seguro, só mais lento.
- **GO para `enriched-1`** (etapa separada: sanitizar → materializar enriched-1 → pacote contextual cego → liberar rotulagem).

---

## 24f. Addendum — Fase B2.2A: lote de digests do golden (dry-run) (2026-06-20)

> **Lote preparado, NÃO executado** — ver [PLANO3-LOTE-DIGEST-GOLDEN.md](docs/archive/PLANO3-LOTE-DIGEST-GOLDEN.md)
> (`STATUS: NÃO EXECUTADO — AGUARDANDO AUTORIZAÇÃO DE CUSTO`).

- **Compatibilidade (read-only):** o catálogo cresceu (works 734→737, digests 14→17, jobs 114→123) por atividade do app, **mas nenhuma mudança atingiu o golden** — `corpus_changed=0/80`, `reviewCorpusSignature` global bate (`8776419e…`), `base-1` íntegro (`634571c2…`). **Regra bloqueante não disparou** ⇒ não exige `base-2`.
- **Escopo:** **51 elegíveis** (corpus_unchanged_digest_missing) · 0 reutilizáveis (os 3 digests novos são fora do golden) · 29 `no_reviews_available` excluídas · 0 stale/changed. SHA-256 dos 51 IDs ordenados = `7b264c55…`.
- **Plano:** `planSignature=e44e5996…` · model sonnet-4-6 / digest-v1 / schema v1 · **likely $2.27 / upper $3.41** (real do `estimateStep`, não a projeção antiga ~$1/~$5.9); teto mín. $3.41, recomendado **$3.50**. Comando `npm run digest:golden -- --execute …` (gated; sem `--retry-failed`).
- **Código (puro + IO-injetável, testado):** [golden-digest.ts](lib/synopsis-interest/golden-digest.ts) (`planGoldenDigestBatch`/`runGoldenDigestBatch`: escopo só golden, exclui no_reviews, exclui reusable, **bloqueia corpus_changed**, soft-cap, re-check de plano, cancel, sem retry/summary, partial≠completed) + CLI [golden-digest-batch.ts](scripts/golden-digest-batch.ts). **Não** usa o lote legado de `settings`. **729 testes** (+24); `tsc`/lint/build verdes; build não dispara geração.
- **Correção (§ candidatos):** `b1`/`e1` **compartilham a mesma base de inputs de trabalho** (título/sinopse/tags/perfil), mas as **assinaturas FINAIS são distintas** (candidate id + review context). A frase anterior "b1/e1 com assinatura idêntica" significava "cada um manteve seu próprio hash anterior" (⇒ base-1 estável), **não** `b1==e1`.
- **Pós-sucesso (não agora):** verificar 51/51 → sanitizar digests → materializar `enriched-1` → pacote contextual → validar leakage → liberar rotulagem. Falha persistente em qualquer digest ⇒ parar para decisão.

---

## 24e. Addendum — Fase B2.1D: golden CONTEXTUAL + aba "Sem reviews" (2026-06-19)

> **Constructo corrigido** + melhoria operacional. Detalhes em
> [PLANO3-GOLDEN-CONTEXTUAL.md](docs/archive/PLANO3-GOLDEN-CONTEXTUAL.md).

**Parte A — protocolo:**
- **Constructo único:** **Potencial de Interesse na Obra** (sinopse + tags + contexto de reviews), **não** "apelo da sinopse". Um golden contextual só.
- **Pacote synopsis-only SUPERSEDED** (não rotular); **snapshot-base `base-1` preservado** como base técnica (`snapshotBaseSignature=634571c2…` reverificado inalterado após estender candidatos).
- **Candidatos S0/S1/D1/D2/b1/e1** (b1/e1 **mantêm cada um o próprio hash anterior** ⇒ base-1 intacto; assinaturas FINAIS de b1 e e1 são **distintas** — ver B2.2A); 8 perguntas experimentais; métrica principal = **MAE ordinal pareada por obra única no holdout** (80 work_ids; repetições só intra-avaliador).
- **Tags contextuais** (`selectContextualTags`): exclui `format`/`other`, dedupe determinístico, ordem canônica, máx 30; **S078** → mensagem neutra (não finge ausência legítima — `missing_recoverable_frozen_empty`).
- **Digest sanitizado** (`sanitizeDigestForLabeling` + `DIGEST_FIELD_POLICY`): remove notas/estrelas/recomendação; mantém traços (±)/polaridade/eixo/avisos.
- **29 obras = `no_reviews_available`** (não equivalência de qualidade): análises separadas (todas/com-digest/sem-reviews/S078); ausência não escondida na métrica.
- **Reviews pós-snapshot ⇒ nova versão** (`base-2` + novo corpus signature + novo plano/pacote); nada silencioso.
- **Fallback:** digest fresh → digest; `digest_failed` explícito; sem reviews → `no_reviews_available`; **sem** summary silencioso.

**Parte B — aba "Sem reviews" (`/ai-evaluation`):**
- Aba diagnóstica read-only listando obras ativas com **0 review útil** (regra centralizada `isUsefulReviewText` = trim≥40, reusada pelos gates de summary/digest). Filtros: busca/status/fonte-externa/golden (URL params, Server Component). Badges (Golden pilot-1 + aviso de imutabilidade de base-1), aviso de custo/qualidade, links p/ "Abrir obra"/"Adicionar review manualmente". **Não** gera reviews/summary/digest/avaliação/previsão.

**Validação:** base-1 reverificado inalterado; `tsc` limpo; testes verdes; lint 0 nos novos; build exit 0. Zero escrita no banco, zero LLM, zero migration.

---

## 24d. Addendum — Fase B2.1C: snapshot-base + pacote cego (2026-06-19)

> **✅ PRONTO PARA ROTULAGEM HUMANA.** Snapshot-base e pacote cego congelados/validados.
> Manifesto: [PLANO3-GOLDEN-SNAPSHOT-BASE-MANIFEST.md](docs/archive/PLANO3-GOLDEN-SNAPSHOT-BASE-MANIFEST.md).

- **Snapshot-base (`base-1`)** materializado read-only: 80 obras únicas, 90 slots (10 repetições intra-avaliador), 50 dev/30 holdout, strata 20×4. `snapshotBaseSignature=634571c2…`, `reviewCorpusSignature=8776419e…` (determinístico — 2 runs idênticas). Conteúdo em `.local-experiments/` (gitignored); manifesto versionado sem texto integral.
- **Reviews congeladas:** 51 `frozen_current` + 29 `no_reviews`. Regra de invalidação: o digest futuro (`enriched-1`) só roda se `reviewCorpusSignature` atual == congelada; senão `plan_changed` + nova snapshot version.
- **Pacote cego:** HTML offline (só `slot_key`+sinopse; **0** work_id/script/url/output — validado estrutural + grep), CSV template vazio, `labelingPackageSignature=73eb0f5d…`. Slots repetidos mostram conteúdo idêntico sem marca.
- **S078:** congelada `missing_recoverable_frozen_empty` (4 estados de tag agora: `tags_present`/`no_tags_legitimate`/`missing_recoverable_frozen_empty`/`loading_error`→throw); assinatura distinta de ausência legítima.
- **Código (puro, testado):** `lib/synopsis-interest/{snapshot,blind-package}.ts` + tag-context 4-estados + validador de labels (progresso/conclusão). **688 testes verdes** (+24) · `tsc` limpo · lint 0 · **build exit 0** (não auto-gera o pacote; mtime inalterado). **Sem migration, sem escrita no banco, sem chamada paga.**
- **Unidade estatística:** slot = rotulagem; **work_id único = observação** (repetições NÃO contam); split por work_id. **Planners (digest/b1/e1/D1/D2) operam com 0 labels** — labels só na etapa de métricas; nunca em prompt/assinatura/dedup.

---

## 24c. Addendum — Fase B2.1B: fechamento do Readiness Gate + S078 (2026-06-19)

> **Golden Data Readiness: APROVADO PARA SNAPSHOT-BASE.** Detalhes em
> [PLANO3-GOLDEN-DATA-READINESS.md](docs/archive/PLANO3-GOLDEN-DATA-READINESS.md) (Fechamento B2.1B).

- **Decisões fechadas (✅):** reviews ≤30d **congeladas sem refresh** · **9 summaries não regenerados** (digest os supera; falha de digest ⇒ estado explícito, nunca regen silencioso de summary) · **51 digests = etapa paga separada** (não autorizada; teto após dry-run, upper ~$5,90) · **D1/D2 mantidos** · **alignment fora** desta rodada · **sem nova avaliação IA** · **sem recalc/ratings**.
- **S078 (0 work_tags):** 🟩 tem 4 gêneros + 4 fontes externas aceitas ⇒ classificada **`missing_tags_recoverable`**; **congelada como `no_tags`** (recuperar = refresh externo, excluído pelo congelamento; golden FROZEN). `tags=[]` é entrada **determinística** (D1→♥; D2 usa sinopse) ⇒ **não bloqueia**; permanece nas 80, no slot holdout/♥♥♥♥, sem alterar split.
- **Correções (código puro + testes):** `tags required` de D1/D2 = **campo estrutural que aceita `[]`** (não "≥1 tag"); assinatura de tags distingue `no_tags` × erro/`null` × não-encontrada (`resolveTagContext`/`computeTagsSignature` em [experiment.ts](lib/synopsis-interest/experiment.ts)). `tsc` limpo · **633 testes verdes** (+8) · lint 0. **Sem migration, sem escrita no banco.**
- **Rotulagem:** **ainda não liberada** — só após materializar o snapshot-base + validar o pacote cego (próxima etapa, custo $0).

---

## 24b. Addendum — Fase B2.1A: Golden Data Readiness Gate (2026-06-19)

> Rotulagem humana **gated** por este readiness gate (fechado em B2.1B, acima). Detalhes em
> [PLANO3-GOLDEN-DATA-READINESS.md](docs/archive/PLANO3-GOLDEN-DATA-READINESS.md).

Gate read-only que comprovou a freshness dos dados das 80 obras únicas do golden por candidato (freshness medida com as funções reais de produção):

- **Rotulagem + b1 + D1 + D2 = prontos** (🟩 canonical **80/80 fresh**, perfil v7 fresh, tags 79/80 enriquecidas). Custo de desbloqueio: **$0** (só congelar snapshot + pacote cego).
- **e1 = não pronto** — exige **51 digests** (29 `no_reviews` legítimo; 9 summaries stale, regen opcional). Custo: **~$1.0 likely / ~$5.9 upper**.
- **Não-bloqueadores confirmados:** AI eval/category_scores (80/80 cat9), calc/expected/personal_fit (80/80, recalc_pending=false), **alignment** (= Veredito IA; decision_score derivado) e platform ratings **não são usados por nenhum candidato** ⇒ não viram pré-requisito (AUDIT F6/F10-rigor).
- **Decisões pendentes (D1–D7):** política de freshness de reviews · refrescar ou não as 51 · D1/D2 no experimento · alignment como candidato separado · gerar avaliações faltantes · regenerar 9 summaries · teto financeiro do digest. Recomendação geral: **congelar reviews como estão** (todas ≤26d) e gerar só os 51 digests.

---

## 24. Addendum — Fase B2.0 executada (2026-06-19)

Congelamento do protocolo experimental do Plano 3 — ver [PLANO3-EXPERIMENTO-DIGEST-GOLDEN.md](docs/archive/PLANO3-EXPERIMENTO-DIGEST-GOLDEN.md).

- **Golden auditado (🟩):** 80 únicas — **0 digest**, **51 missing_with_reviews** (todas summary-only), **29 no_reviews**, 0 stale/blocked ⇒ **51 digests** a gerar (não as 489). Previsão v2 do golden: 12 modernas / 68 legadas.
- **Código (puro, testado):** [lib/synopsis-interest/experiment.ts](lib/synopsis-interest/experiment.ts) — candidatos `b1`/`e1`, fallback explícito `resolveReviewContext`, `computeSnapshotSignature`/`computeCandidateInputSignature`, `planGoldenDigest`/`planCandidateDryRun`. 26 testes ([experiment.test.ts](tests/unit/synopsis-interest/experiment.test.ts)). **Nenhum caminho de execução paga construído.**
- **Cegamento:** auditado, forte por construção (export só `slot_key`+sinopse; labels em tabela separada). Risco residual: export lê sinopse live → fechar pelo snapshot congelado.
- **Custos (futuros, não gastos):** experimento total **~$2.6 likely / ~$8.6 upper** (digest 51 + b1 80 + e1 80 + D1/D2 grátis).
- **Banco:** somente SELECT; zero escrita; 1 script temporário (removido).
