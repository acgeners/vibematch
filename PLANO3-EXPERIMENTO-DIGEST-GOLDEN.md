STATUS: PREPARADO — NENHUMA CHAMADA PAGA EXECUTADA

# Plano 3 — Experimento digest × golden (Fase B2.0)

> Sessão **read-only** — 2026-06-19. Congelamento do protocolo experimental + preparação
> do candidato com digest, derivado de [PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md](PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md).
> Banco só por `SELECT`. **Zero** LLM, digest, previsão, perfil, recalc, job, label, migration.
> Proveniência: 🟦 código (`file:line`) · 🟩 banco (read-only, 2026-06-19) · 🟨 inferência · 🟧 decisão/recomendação.
>
> Implementação funcional desta etapa: **somente o módulo PURO** [lib/synopsis-interest/experiment.ts](lib/synopsis-interest/experiment.ts)
> (candidatos, fallback, assinaturas, planner do digest do golden) + testes. Nenhum
> caminho de execução paga foi construído ou disparado.
>
> **✅ PRONTO PARA ROTULAGEM HUMANA — SNAPSHOT-BASE E PACOTE CEGO CONGELADOS (Fase B2.1C, 2026-06-19).**
> Nenhuma chamada paga executada. Manifesto: [PLANO3-GOLDEN-SNAPSHOT-BASE-MANIFEST.md](PLANO3-GOLDEN-SNAPSHOT-BASE-MANIFEST.md).
> `snapshot_version=base-1` · `snapshotBaseSignature=634571c2…` · pacote cego offline validado
> (`labelingPackageSignature=73eb0f5d…`). Artefatos completos (sinopses) em `.local-experiments/`
> (gitignored); regeneráveis por [scripts/synopsis-interest-snapshot.ts](scripts/synopsis-interest-snapshot.ts)
> (read-only). Antecedentes: Readiness Gate aprovado (B2.1A/B2.1B) — reviews ≤30d congeladas sem
> refresh · 9 summaries não regenerados · 51 digests = etapa paga separada · D1/D2 mantidos ·
> alignment fora · sem nova avaliação IA. **S078** congelada `missing_recoverable_frozen_empty`
> (proveniência distinta de `no_tags_legitimate`; `tags=[]` determinístico).

---

## 1. Estado do Plano 3

| Parte | Estado | Evidência |
|---|---|---|
| golden sample (estrutura/tabela) | **implemented** | migration 109 aplicada; [synopsis_interest_golden](supabase/migrations/109_synopsis_interest_golden.sql) |
| 90 slots (80 únicos + 10 repetições) | **implemented** | [golden-sample.pilot-1.json](lib/synopsis-interest/golden-sample.pilot-1.json) FROZEN; 🟩 90 linhas |
| rúbrica de rotulagem | **implemented** | [RUBRIC.md](lib/synopsis-interest/RUBRIC.md) |
| material de classificação (CSV/HTML cego) | **implemented** | [labeling-sheet.pilot-1.{csv,html}](lib/synopsis-interest/) |
| baselines D1/D2 (determinísticos) | **implemented** | [baselines.ts](lib/synopsis-interest/baselines.ts) |
| métricas (ordinal/ranking/intra-rater) | **implemented** | [metrics.ts](lib/synopsis-interest/metrics.ts) |
| staleness signature (candidata) | **implemented** | [staleness.ts](lib/synopsis-interest/staleness.ts) |
| runner dry-run (D1/D2 × golden) | **partial** | [synopsis-interest-run.ts](scripts/synopsis-interest-run.ts) — usa golden se rotulado; senão proxy contaminado |
| rotulagem humana | **missing** | 🟩 **0/90** `human_label` preenchido |
| piloto LLM (synopsis_quality_predict) | **missing** | nunca executado |
| candidato COM digest | **missing → preparado** | protocolo + assinaturas em [experiment.ts](lib/synopsis-interest/experiment.ts); execução não construída |
| storage experimental (outputs) | **planned** | offline + golden; NÃO `synopsis_quality_predictions` de produção (§8) |

---

## 2. Golden

🟩 `synopsis_interest_golden`, `sample_version = pilot-1`:
- **90 slots** = **80 obras únicas** (`S001…S080`) + **10 repetições cegas** (`R001…R010`).
- Estratificado pelo `synopsis_quality` no sorteio (♥/♥♥/♥♥♥/♥♥♥♥), split `development`/`holdout` (50 dev / 30 hold nos únicos).
- `candidate_pool = 655`. **`human_label` = 0/90** (não rotulado).
- `stratum` é OCULTO na rotulagem (bookkeeping de cobertura). `user_score` **nunca** entra.

### Significado de "golden FROZEN" (verificado)
| Pergunta | Resposta |
|---|---|
| Lista de obras congelada? | **Sim** — `golden-sample.pilot-1.json` é o artefato versionado; `generated_note: "FROZEN — não regenerar após observar outputs candidatos"`. |
| Inputs também congelados? | **NÃO pelo arquivo** — o JSON guarda só `slotKey/workId/split/stratum/shuffleOrder`. **Sinopse/tags/perfil são lidos LIVE** ([export](scripts/synopsis-interest-export.ts):37, [run](scripts/synopsis-interest-run.ts):36 `getCandidatesByIds`). ⚠️ "lista congelada" **≠** "inputs congelados". |
| Snapshot por obra? | **Não existe ainda** — esta etapa o DEFINE (§3); hoje não há captura por obra. |
| Versão de snapshot? | `EXPERIMENT_VERSION = "digest-exp-1"` + `goldenVersion = "pilot-1"` (definidos em experiment.ts); ainda não materializados em linha. |
| Mudança no catálogo altera o material? | **Sim, hoje** — como os candidatos/export leem live, editar sinopse/tags de uma obra do golden mudaria o input. **Risco a fechar pelo snapshot congelado.** |
| Candidatos leem banco live ou snapshot? | **Live hoje** (D1/D2 via `getCandidatesByIds`). A regra do experimento exige **snapshot** (§3). |
| Como impede leakage? | Cegamento por construção no export (só `slot_key`+sinopse); labels em tabela separada (§9). |

**Conclusão:** lista congelada ✅; **inputs ainda não congelados** ⚠️ — gap fechado pela assinatura de snapshot (§3/§8), que torna detectável qualquer mudança de input pós-freeze.

---

## 3. Snapshot experimental (congelamento dos inputs)

Todos os candidatos usam **o mesmo snapshot**. O snapshot registra, por obra (assinaturas pré-hashadas pelo loader — nunca conteúdo bruto):

```
goldenVersion · workId · titleSig · synopsisSig · tagsSig · profileSig
reviewContextType · reviewContextSig · promptVersions · models · schemaVersions
```

🟦 `computeSnapshotSignature` ([experiment.ts](lib/synopsis-interest/experiment.ts)): ordena por `workId` (independente de ordem) → sha256. Regras congeladas:
- nenhum candidato depende de dados **live** durante a comparação (lê o snapshot);
- mudança futura no catálogo **não** altera um snapshot congelado (a assinatura diverge ⇒ exige nova versão de snapshot);
- **digest regenerado após o freeze exige nova versão de snapshot** (o `reviewContextSig` muda);
- **rótulos humanos NUNCA entram** no snapshot nem na entrada de candidato (verificado: nenhuma assinatura referencia `human_label`);
- todos os candidatos compartilham a **mesma base** de snapshot;
- **não usar `synopsis_quality_predictions` de produção como storage experimental** (§8).

**Migration:** nenhuma criada/aplicada. O snapshot pode ser materializado de forma aditiva (tabela `synopsis_interest_experiment_*` ou JSON congelado em `lib/synopsis-interest/`) — **proposta, não aplicada**; decidir no início da Fase 3. Reutiliza `synopsis_interest_golden` (109) para o material/labels.

---

## 4. Digest coverage do golden (🟩, read-only)

Classificação das **80 obras únicas** (mirror de `classifyDigestReadiness`: versão `digest-v1` + materialidade):

| Estado | Obras | Significado |
|---|--:|---|
| `digest_fresh` | **0** | nenhuma obra do golden tem digest (das 14 do catálogo, 0 caíram no golden) |
| `digest_stale` | **0** | — |
| `digest_missing_with_reviews` | **51** | têm review útil (≥40 chars) e **sem** digest → **alvo da geração** |
| `summary_only` (subconjunto) | **51** | todas as 51 já têm `review_summary` (fallback disponível) |
| `no_reviews` | **29** | 0 review útil → ausência legítima (não geram digest) |
| `blocked` | **0** | 0 arquivada; **100% com canonical_synopsis** |

**Digests que realmente precisam ser gerados para o experimento: 51** (não as 489 do catálogo). Distribuição de reviews úteis nas 51: de 1 a 91 (várias com 1–9; algumas com 20–91).

Cobertura de previsão **v2** do golden (🟩): **12 modernas** (input_signature, vs v7) + **68 legadas stale**. As 12 modernas pertencem às 112 de produção — **não** serão reusadas como baseline sem equivalência exata (§5).

---

## 5. Candidatos

🟦 Registro congelado em [experiment.ts](lib/synopsis-interest/experiment.ts) `CANDIDATES`:

| id | label | contexto de review | prompt | model | schema |
|---|---|---|---|---|---|
| **b1** | baseline — perfil+título+sinopse+tags | **não** | `v2` (= produção) | claude-sonnet-4-6 | v1 |
| **e1** | enriquecido — baseline + contexto de review | **sim** (fallback) | `v2+digest` | claude-sonnet-4-6 | v1 |
| **D1** | determinístico, só tags | n/a | — | — (sem LLM) | — |
| **D2** | determinístico, tags + keywords da sinopse | n/a | — | — (sem LLM) | — |

**Baseline (b1):** contrato equivalente à produção v2 (perfil+título+sinopse+tags, **sem** digest/summary). **Re-executado** sobre as 90 obras e o snapshot congelado. **NÃO** reusa as 112 previsões de produção como baseline — só com equivalência exata provada de `obra + snapshot + input_signature + prompt + model + schema + perfil` (🟦 `computeCandidateInputSignature`). As 12 modernas do golden foram geradas pelo prompt `v2` de produção, mas sob assinatura de produção (sem snapshot experimental) ⇒ re-executar para garantir paridade.

**D1/D2** entram como **piso barato** (sem LLM) — respondem "uma alternativa simples basta?" (AUDIT F10/§20).

---

## 6. Fallback (candidato enriquecido)

🟦 `resolveReviewContext` ([experiment.ts](lib/synopsis-interest/experiment.ts)) — fallback **explícito**, sem substituição silenciosa:

```
sem reviews úteis            → no_reviews        (ausência legítima)
digest fresco                → digest
digest presente porém stale  → stale_digest      (EXPLÍCITO, não cai p/ summary)
sem digest, summary fresco   → summary           (fallback)
sem digest, summary stale    → stale_summary     (EXPLÍCITO)
reviews sem artefato         → missing           (precisa gerar)
```

- **reviews brutas não entram** diretamente no predictor.
- estados stale/falho são **terminais e explícitos** (o experimento regenera ou marca; nunca downgrade silencioso).
- distribuição projetada do golden **após** gerar os 51 digests: **51 `digest` + 29 `no_reviews`** (0 `summary` — todas as 51 ganham digest). Antes da geração: 51 `summary` + 29 `no_reviews`.

---

## 7. Versões (congeladas)

```
EXPERIMENT_VERSION       = "digest-exp-1"
EXPERIMENT_DIGEST_VERSION = "digest-v1"     (espelha REVIEW_DIGEST_VERSION; manter sincronizado)
goldenVersion            = "pilot-1"
candidatos               b1 (prompt v2, sonnet-4-6, schema v1) · e1 (prompt v2+digest, sonnet-4-6, schema v1)
PRODUCTION_PROMPT_VERSION = "v2"  (NÃO usar como identidade/storage do experimento)
```

Bump de qualquer versão (prompt/model/schema/digest) ⇒ nova `snapshotSignature`/`planSignature`.

---

## 8. Assinaturas

🟦 Todas em [experiment.ts](lib/synopsis-interest/experiment.ts) (puras, sha256, testadas em [experiment.test.ts](tests/unit/synopsis-interest/experiment.test.ts)):

| Função | Inclui | Muda quando |
|---|---|---|
| `computeWorkSnapshotSignature` | título/sinopse/tags/perfil + contexto de review | qualquer input da obra muda |
| `computeSnapshotSignature` | todas as obras (ordenadas) + versões | qualquer obra/versão muda; **independe da ordem** |
| `computeCandidateInputSignature` (b1) | título/sinopse/tags/perfil + candidato/prompt/model/schema | **NÃO** muda com digest/summary |
| `computeCandidateInputSignature` (e1) | base + `reviewContextType`/`reviewContextSig` | muda com digest/summary/no_reviews |

**Garantias testadas:** mesma snapshot → mesma assinatura; ordem irrelevante; digest muda enriquecido mas **não** o baseline; summary muda o fallback; nenhuma assinatura referencia rótulo humano; baseline e enriquecido têm assinaturas distintas.

**Não alterar:** prompt v2 de produção; assinatura das 112 previsões; flag `stale` das previsões de produção. Candidatos experimentais coexistem por: (a) storage separado (offline/golden, nunca `synopsis_quality_predictions`); (b) `prompt_version`/`candidate.id` distintos; (c) o predictor de produção lê só `PROMPT_VERSION="v2"` ⇒ experimentos **não** aparecem na UI/ranking.

---

## 9. Cegamento e leakage (auditoria)

🟦 [export](scripts/synopsis-interest-export.ts) gera a folha de rotulagem mostrando **só** `slot_key` opaco + **sinopse canônica**. Esconde: previsão, candidato, user_score, scores, ranking, tags, capa, dados externos, **título**, **work_id**, estrato.

| Critério | Status |
|---|:--:|
| identificação anônima (slot_key opaco) | ✅ |
| conteúdo permitido = só sinopse (rúbrica) | ✅ |
| ordem randomizada (`shuffleOrder` estável) | ✅ |
| repetições cegas (R001…, independentes) | ✅ |
| salvamento parcial / retomada | ✅ CSV incremental; `validateLabelRows` trata `unlabeled`/`missing`; import idempotente (UPDATE por slot_key) |
| sem links que exponham scores | ✅ HTML estático, sem links |
| separação física/lógica labels × outputs | ✅ labels em `synopsis_interest_golden`; **nunca** toca `works.synopsis_quality` nem `synopsis_quality_predictions` |
| labels entram no input dos candidatos? | ❌ **não** (verificado: nenhuma assinatura referencia label) |

**Risco residual (não-bloqueante):** o export lê a sinopse **live**. Se a sinopse de uma obra do golden mudar entre a rotulagem e a execução dos candidatos, o humano teria rotulado um texto diferente do que o candidato vê. **Mitigação:** congelar `synopsisSig` no snapshot (§3) e rotular/rodar candidatos **sobre o mesmo snapshot**; a divergência vira detectável (assinatura muda). **Nenhum leakage de output detectado.**

---

## 10. Protocolo estatístico (congelado antes de qualquer output)

Congelado: lista das 90 obras (golden FROZEN) · snapshot (§3) · rúbrica · candidatos (b1/e1/D1/D2) · prompts/models/schemas (§7) · fallback (§6) · métricas (abaixo) · critério de winner · falhas/empates/subgrupos.

**Ground truth:** `human_label` do golden (♥..♥♥♥♥). `user_score` é **downstream**, nunca ground truth do interesse.

**Métrica principal (congelada):** **MAE ordinal em níveis** (previsão × golden), 🟦 `ordinalAgreement.mae` ([metrics.ts](lib/synopsis-interest/metrics.ts)). **Não alterar após observar resultados.**

**Métricas secundárias:** `exactRate`, `within1Rate`, `bias`, **QWK** (`quadraticWeightedKappa`), `spearman`, `pairwiseAccuracy`, `ndcgAtK`, `topKOverlap`. **Consistência intra-avaliador:** `intraRaterConsistency` (10 repetições) — piso de ruído humano.

**Comparação pareada + IC:** baseline × enriquecido nas **mesmas** obras → ΔMAE pareado + **bootstrap CI** (rigor AUDIT §7.2/§21). Reportar `development` e **`holdout`** separadamente.

**Perguntas que o experimento responde (§11 do prompt):**
| # | Pergunta | Como |
|---|---|---|
| 1 | digest melhora o erro absoluto? | ΔMAE ordinal (principal), IC pareado |
| 2 | melhora ordenação ampla? | Δspearman / Δpairwise / ΔNDCG |
| 3 | melhora só justificativas? | inspeção qualitativa (não-métrica; registrar) |
| 4 | ganho nas 90 ou só no grupo com reviews? | subgrupos: `digest`(51) × `no_reviews`(29); **ablação** b1 × b1+digest nas 51 |
| 5 | compensa custo/complexidade? | Δmétrica × Δcusto (§13) |
| 6 | modelo caro supera alternativa simples? | b1/e1 (Sonnet) × **D1/D2** (sem LLM) |
| 7 | triagem ampla ou ordem fina? | pairwise por bucket de Δ (AUDIT §7.6) |

**Critério de winner (congelado):** o enriquecido (e1) só vence se melhorar a **MAE principal** com **IC que exclui 0 no `holdout`** (não só dev) **e** o ganho justificar custo+complexidade (§13). Senão vence o **baseline** (mais simples/barato) — coerente com AUDIT F10/§20 ("escolher por simplicidade quando a acurácia é indistinguível"). D2 vencer b1/e1 ⇒ adotar determinístico.

**Falhas:** previsão que falha (sem tool/schema) é registrada com `status=failed` + erro sanitizado e **excluída** do n da métrica (reportar taxa de falha por candidato). **Empates** (Δscore=0): ignorados no pairwise (já é assim em `pairwiseAccuracy`).

---

## 11. Dry-run do digest (projeção; NÃO executado)

🟦 `planGoldenDigest` ([experiment.ts](lib/synopsis-interest/experiment.ts)) — puro, rejeita IDs fora do golden, custo injetado por `estimateStep('generate_review_digest', min(n,40))`. Projeção sobre o golden (🟩):

```
escopo: 80 obras do golden (allowedWorkIds = golden pilot-1)
elegíveis (gerar digest): 51   (missing_with_reviews 51 + stale 0)
fresh: 0 · stale: 0 · no_reviews: 29 · blocked: 0 · summary_only: 51
custo: likely ~$1.0 (51 × $0.0197 hist.)  ·  upper ~$5.9 (51 × $0.115 contrato)
requiresAggregateAuthorization: true   (micro-threshold individual NÃO autoriza o lote)
planSignature: sha256(experimentVersion + goldenVersion + digestVersion + 51 IDs ordenados)  [computada no dry-run real]
```

Execução futura exigirá: `--execute` explícito + `--plan-signature` + `--max-cost-usd` + golden version/IDs congelados. Reutiliza `ensureReviewDigest`/`work_processing_jobs`/readiness/dedup/retry. **O lote legado de `settings.ts` (que bypassa o gate) permanece sem uso.** Evolução futura → `runDigestBatch` se o digest vencer (§18).

---

## 12. Dry-run dos candidatos (projeção; NÃO executado)

🟦 `planCandidateDryRun` ([experiment.ts](lib/synopsis-interest/experiment.ts)) — puro, conta por contexto de review, custo `estimateStep('predict_interest_potential')`. Todas as 80 obras são re-executadas (sem reuso de produção).

| Candidato | Obras | digest | summary | no_reviews | chamadas | likely | upper |
|---|--:|--:|--:|--:|--:|--:|--:|
| **b1** baseline | 80 | — | — | — | 80 | ~$0.78 | ~$1.26 |
| **e1** enriquecido (pós-digest) | 80 | 51 | 0 | 29 | 80 | ~$0.85 | ~$1.4 |
| D1/D2 | 80 | — | — | — | 0 (sem LLM) | $0 | $0 |

(likely: $0.0097/call hist.; upper: $0.01575/call do piloto. Enriquecido um pouco acima pelo digest no prompt.) Nenhum output gerado no dry-run. **planSignature** por candidato embute snapshot + assinaturas de entrada (computadas no dry-run real).

---

## 13. Custos (consolidado; futuro, NÃO gasto)

| Operação | Escopo | Likely | Upper |
|---|---|--:|--:|
| digest do golden | 51 | ~$1.0 | ~$5.9 |
| baseline b1 | 80 | ~$0.78 | ~$1.26 |
| enriquecido e1 | 80 | ~$0.85 | ~$1.4 |
| D1/D2 | 80 | $0 | $0 |
| **Total experimento** | | **~$2.6** | **~$8.6** |

Repetições (10) são p/ consistência **humana** — sem custo LLM. Teto sugerido p/ autorização: **$9** (≥ upper). Confirmar por dry-run real antes de qualquer `--execute`.

---

## 14. Comandos futuros (NÃO executados)

```bash
# 1) Rotulagem: gerar a folha cega (read-only; só sinopse) — NÃO chama provider
npx tsx --env-file=.env.local scripts/synopsis-interest-export.ts

# 2) Importar rótulos preenchidos (DRY-RUN valida; --apply grava em synopsis_interest_golden)
npx tsx --env-file=.env.local scripts/synopsis-interest-import.ts            # valida
npx tsx --env-file=.env.local scripts/synopsis-interest-import.ts --apply    # grava (exige sample carregada)

# 3) Dry-run D1/D2 × golden (read-only; determinístico)
npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/synopsis-interest-run.ts

# 4) [A CONSTRUIR] dry-run do digest do golden + dry-run dos candidatos b1/e1
#    (planGoldenDigest / planCandidateDryRun já existem PUROS; falta o loader read-only + CLI)
#    execução paga exigirá --execute + --plan-signature + --max-cost-usd + golden congelado
```

Nenhum comando acima foi executado nesta sessão.

---

## 15. Instruções de rotulagem humana

```
Onde abrir:   lib/synopsis-interest/labeling-sheet.pilot-1.html  (após rodar o export)
Quantos:      90 itens (80 únicos + 10 repetições embaralhadas)
O que ler:    SÓ a sinopse de cada slot. Rúbrica em lib/synopsis-interest/RUBRIC.md
NÃO consultar: previsão, candidatos, digest, summary, reviews, scores, alignment,
               ranking, personal_fit, tags, título, capa, dados externos
Como salvar:  preencher lib/synopsis-interest/labeling-sheet.pilot-1.csv (slot_key,label)
              níveis: ♥ / ♥♥ / ♥♥♥ / ♥♥♥♥  — pode parar e retomar (preenche aos poucos)
Verificar:    rodar o import em DRY-RUN → mostra válidos / sem rótulo / erros / ausentes
Concluir:     90/90 preenchidos, 0 erros → import --apply grava human_label
```
Pode ocorrer **em paralelo** após o protocolo + snapshot congelados. **Outputs dos candidatos NUNCA são mostrados** a quem rotula.

---

## 16. Critérios de autorização (gates antes de gastar)

1. protocolo + snapshot congelados (este documento);
2. dry-run do digest do golden com `planSignature` + `upper ≤ teto`;
3. golden congelado (IDs/version) — qualquer mudança ⇒ novo dry-run;
4. autorização explícita do **upper** (teto sugerido $9);
5. `--execute` + `--plan-signature` + `--max-cost-usd` obrigatórios;
6. micro-threshold individual **não** autoriza o lote (gate agregado);
7. rotulagem pode rodar antes (sem custo LLM).

---

## 17. Critérios de conclusão da Fase B2.0 (esta etapa) e da Fase 3

**B2.0 (concluída aqui):** protocolo/candidatos/fallback/assinaturas congelados em código testado; digest coverage do golden medida; cegamento auditado; dry-runs projetados; matriz de rastreabilidade no plano mestre; zero gasto.

**Fase 3 (próxima, não nesta sessão):** golden 90/90 rotulado · 51 digests gerados (autorizados) · b1/e1/D1/D2 executados sobre o snapshot · métricas dev×holdout com IC pareado · **decisão do contrato registrada** (digest sim/não, fallback, modelo) respondendo as 7 perguntas (§10) + AUDIT F10.

---

## 18. Relação com o backfill final

**Decisões formais (mantidas):**
- **Lote 02 continua suspenso.**
- as **112 previsões** atuais são **baseline/provisórias** (contrato sem digest); não apagar/sobrescrever/aplicar como nota manual.
- **nenhum backfill final** (Interesse ou digest das 489) antes de escolher o winner.

**Sequência esperada:** congelar protocolo → preparar digests do golden → rotular → executar candidatos → comparar → escolher winner → implementar contrato final → novo piloto → backfill definitivo → relatório de cobertura.

**Se o digest NÃO vencer:** não executar o backfill completo de digest; preservar digest só onde já existe ou tiver uso próprio (ranker/deep-dive pagos). Baseline/contrato atual segue; Lote 02 retoma sob v2.

**Se o digest VENCER:** implementar o `runDigestBatch` agregado seguro (planner+runner+gate+assinatura, evoluindo de `planGoldenDigest`); backfill de digest só nas obras aplicáveis (com review útil); `no_reviews` permanece ausência legítima; `summary` permanece fallback. Novo `prompt_version`/`schema` ⇒ nova assinatura ⇒ re-backfill das ~622.

---

### Banco (esta etapa — somente SELECT)
```
golden slots 90 · golden labels 0/90 (inalterado) · taste_profile 7 (v7 current)
review_summaries 503 · review_digests 14 · predictions 1026 (112 modernas, inalteradas)
calculated_scores 737 · jobs 114 (todos succeeded)
zero chamadas pagas · zero LLM · zero digests gerados · zero predictions geradas
zero outputs experimentais · zero jobs criados · zero labels alterados · zero migrations
```
