# AUDIT_REPORT.md — Auditoria técnica e estatística do SatorIA/VibeMatch

> **Data:** 2026-06-17 · **Escopo:** catálogo + avaliação por IA + scoring + ranking + recomendação personalizada.
> **Método:** leitura de código + **validação empírica read-only no banco de produção** (724 obras, 191 rotuladas, 3.304 chamadas de IA) + execução de build/typecheck/lint/testes. Nenhum dado alterado.
> **Nota de honestidade (ponto 11 da revisão):** `SUPABASE_SERVICE_ROLE_KEY` **não é tecnicamente read-only** (pode escrever/DDL). Emiti apenas `SELECT` (zero escrita). Scripts inline (`node -e`), não persistidos, sem credenciais embutidas/impressas/versionadas.
> **Limite de potência estatística:** com **n=190–191 rótulos** (e n=103 no subconjunto re-rankeado), os ICs95% são largos (~±0,06 em MAE, ~±0,10 em Spearman). Diferenças pequenas entre modelos são **inconclusivas** — isto é tratado explicitamente abaixo.
>
> **Nota (2026-06-19):** as ações derivadas (orquestração, backfill, Plano 3 / Interesse na Sinopse) estão reconciliadas em [PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md](PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md). Conteúdo abaixo preservado como histórico.
>
> **⏭️ AUDITORIA MAIS RECENTE (2026-07-09):** este relatório (2026-06-17) foi **superseded** por [AUDIT_REPORT-2026-07-08.md](AUDIT_REPORT-2026-07-08.md) — nova auditoria completa (878 obras, 207 rótulos) com instrumentação prospectiva de ranking + view Faixas já shipadas (PR #85). Consulte o novo para o estado atual; este permanece como histórico.

## Conclusão objetiva (classificação)

> **O sistema apresenta uma boa base e sinal preditivo real, é útil para priorização ampla, mas ainda não sustenta ordenação fina confiável nem personalização consistente por mood; e a sofisticação (Ridge/LLM) não mostrou ganho mensurável sobre o modelo simples.**

### Legenda de confiança
- 🟥 **Fato comprovado** — código e/ou dado medido. 🟧 **Risco fortemente sugerido**. 🟦 **Hipótese** (depende de dado/execução ainda não disponível).

### Checklist de cobertura
- [x] Fórmulas de score · pesos/multiplicadores · 13 operações de IA · prompts · fontes de ranking · pontos de preferência/mood · cache/recálculo
- [x] Validação empírica: **OOF sem leakage, ablação, bootstrap/IC, comparação no mesmo subconjunto, regret, validação temporal, custos reais, error_message real, cobertura de tags, ablação de personalização**
- [x] Execução: build · typecheck · testes · lint
- [x] Mapeamento de ações privilegiadas (segurança)

---

## 1. Resumo executivo

| Pergunta | Veredito | Evidência (medida) |
|---|---|---|
| Tem sinal preditivo? | **Sim** 🟥 | OOF-MAE 0,58 vs baseline constante 0,75 (−22%); pairAcc 0,73 |
| Discrimina no grosso? | **Sim** 🟥 | pares Δy≥1,5 → acc 0,91; NDCG@10 lift +45% (in-sample) |
| Discrimina no fino? | **Não** 🟥 | pares Δprevisto<0,1 → acc 0,515; 49% dos pares dentro do erro |
| Ridge supera o modelo simples? | **Ganho não demonstrado** 🟥 | IC95% de TODAS as diferenças (FULL−calc) inclui 0; ambos usam os rótulos |
| Veredito LLM/decisão ajuda? | **Não demonstrado** 🟥 | no mesmo subconjunto (n=103), incremento sobre `expected` tem IC inclui 0 |
| Calibração prospectiva? | **Fraca** (indício) 🟧 | temporal MAE 0,72 ≈ baseline 0,75; **mas** Spearman 0,61 (ordem resiste); `created_at` é proxy |
| Personalização adiciona valor? | **Ganho incremental não demonstrado** 🟥 | tem sinal próprio, mas somada ao `calc` → ΔSpearman IC [−0,01;+0,01] inclui 0 |
| Mood reordena? | **Sim, mas dividido** 🟥 | preset "Modo de hoje" reordena a lista (sort+filtro); o refino nuançado é só no drawer |
| Custo de IA | ~$72/24,7d (com backfill) 🟥 | `ai_evaluation` 54%; 18% das avaliações falham (400 "imagem", custo $0) |
| Build/typecheck/testes | **Verdes** 🟥 | build exit 0; tsc limpo; 117/117 testes; lint 444 (29 err) |
| Exposição se publicado | **Crítica** 🟥 | ~30 arquivos de Server Action com service role, sem auth → mutação e gasto de IA por qualquer visitante |

**Maior alavanca:** assumir **bandas de prioridade** (largura a validar, não decretada), **componentes separados** e **medir prospectivamente** contra baselines — a infra de medição já foi construída (§1B: `prediction_snapshots` + `/admin/model-metrics`), faltando acumular dado prospectivo real.

---

## 1A. Matriz consolidada de achados

| ID | Achado | Severidade | Confiança | Evidência | Impacto | Recomendação | Prio |
|---|---|---|---|---|---|---|---|
| F1 | Exposição: Server Actions com service role sem auth | Crítica | 🟥 | ~30 arquivos `createAdminClient` | mutação de dados + gasto de IA por visitante | gate de auth + rate limit | P0 |
| F2 | Avaliação IA falha por capa (400 "Unable to download") | Alta | 🟥 | 160/160 falhas de `ai_evaluation` | 18% das chamadas + latência (retry) | pré-fetch base64 / validar URL | P0 ✅ feito (§1B) |
| F3 | Falsa precisão do ranking | Alta | 🟥 | pairwise 0,515 p/ Δ<0,1; `TIE_DELTA=0,3` | usuário confia em ordem que é ruído | banda validada + sem decimal falso | P0 ✅ feito (§1B) |
| F4 | MAE de vitrine in-sample (otimista) | Média | 🟥 | 0,545 (in-sample) vs 0,579 (CV) | superestima a utilidade | exibir só CV/OOF | P0 ✅ feito (§1B) |
| F5 | Ridge sem ganho demonstrado sobre `calc` | Alta | 🟥 | IC95% das diferenças inclui 0 | complexidade sem retorno medido | head-to-head OOF limpo; senão simplificar | P1 |
| F6 | Veredito LLM (alignment) sem ganho no mesmo subset | Média | 🟥 | incremento sobre `expected` IC inclui 0 | custo de IA sem retorno medido | repensar/medir antes de manter | P1 |
| F7 | Personalização: ganho incremental não demonstrado | Média | 🟥 | ΔSpearman calc+pf IC [−0,01;+0,01] | desempate frágil/redundante | percentil/robusto + buscar sinal ortogonal | P1 |
| F8 | Dois sistemas de mood (preset × drawer) | Média | 🟥 | `app/ranking/page.tsx:86-164` vs drawer | UX inconsistente | unificar semântica | P1 |
| F9 | Calibração prospectiva fraca | Média | 🟧 | temporal MAE 0,72 ≈ baseline 0,75 | número exibido otimista | medir no `prediction_ledger` | P1 ⏳ infra feita (§1B: `prediction_snapshots`); falta dado |
| F10 | `synopsis_quality_predict` em Sonnet | Média | 🟥 | 1074 chamadas, $10,3 (14%) | custo evitável | Haiku/determinístico | P2 |
| F11 | Staleness de derivados (recalc manual) | Média | 🟧 | `calculated_scores` só em `recalculateAll` | scores velhos após novo rótulo | auto-recalc / flag visível | P2 |
| F12 | Dados externos estagnam | Baixa | 🟧 | refetch só manual | obras em publicação desatualizadas | job de refresh | P2 |
| F13 | Multicolinearidade → waterfall não-identificável | Baixa | 🟥 | drama~tragedy 0,80; 9 notas 3× | explicação enganosa | não exibir waterfall por feature | P2 |
| F14 | Lint 444 (29 err); `noUncheckedIndexedAccess=false` | Baixa | 🟧 | execução do lint/tsconfig | dívida técnica | corrigir erros; ligar flag | P3 |
| F15 | Código morto / nomes legados | Baixa | 🟧 | `prediction.ts`, `seed-from-xlsx 4/5/6` | confusão de manutenção | limpar | P3 |

---

## 1B. Status de implementação (2026-06-17)

Correções já aplicadas nesta sessão (diagnóstico → código). **Não alteram as conclusões/medições acima** — só endereçam achados.

### F2 — Falhas de capa na avaliação IA → ✅ CORRIGIDO
- Pré-fetch da capa **no servidor** + envio em **base64** (a Anthropic não baixa mais a URL → fim dos `400 "Unable to download"`). Se o fetch local falhar, avalia **sem imagem** (sem desperdiçar a 1ª chamada).
- Arquivos: `lib/server/covers/cover-host-policy.ts` e `lib/server/covers/fetch-cover-for-model.ts` (server-only; allowlist + Referer/UA por host, validação de host em cada redirect/limite de redirects, timeout 12s, limite ~4,5 MB em 2 níveis (Content-Length + corte no stream), detecção por **magic bytes**, logs sem base64/URL); refator de `app/api/image-proxy/route.ts` (política única); integração em `lib/ai-evaluation/service.ts` (prefetch + `isImageRelatedModelError` restrito a 400 image/media_type/base64).
- Teste: `tests/unit/covers/fetch-cover-for-model.test.ts` (21 casos).

### F3 — Falsa precisão do ranking → ✅ CORRIGIDO (Opção A)
- **Banda de tiers configurável:** coluna `formula_config.tier_band_width` (**migration 104 aplicada**; CHECK 0,05–2; default/fallback 0,5; leitura não-cacheada em `server/queries/tier-band-width.ts`). Substitui o `TIE_DELTA=0,3` hardcoded.
- Função pura `buildRankingTiers` (`lib/ranking/build-tiers.ts`): âncora na 1ª obra do tier, limite **inclusivo**, **não-encadeada**, scores inválidos num tier final; config/validação Zod em `lib/ranking/tier-config.ts`. Teste: `tests/unit/ranking/build-tiers.test.ts` (10 casos).
- UI: `ranking-cells.tsx` rebaixa o decimal (prefixo `~`, fonte menor, tooltip de incerteza); `ranking-table.tsx` usa a banda da config. Controle de **teste** `components/ranking/tier-band-control.tsx` (chips 0,3–0,8 + “Padrão” via `?band=`, não persiste).
- ⚠️ Medido (724 obras): banda 0,5 → 11 tiers, **1º tier grande (225) e top-3 = 76%**. A largura segue **PROVISÓRIA, a validar** (fixa × percentil × cluster) — ver §20.

### F4 — MAE de vitrine in-sample → ✅ CORRIGIDO
- **Diagnóstico (mapa antes de mexer):** a headline de `/settings` **já usava** `cv_mae_expected_stage1` (CV honesta) + baseline. O gap real era o **toast de "Recalibrar agora"**, que mostrava `expectedPredictor.model.cvMAE` — o cvMAE **interno** do RidgeCV (só seleciona α por fold → otimista/vazado, ~0,55), rotulado "MAE CV". A in-sample (`mae_expected`) só aparecia no BucketDiagnostic, já rotulada in-sample.
- **Núcleo puro** `lib/metrics/model-evaluation.ts` (+ Zod no boundary): `ModelEvaluationMetrics` (rejeita `0`/`""`/`NaN`/negativo como MAE), `selectPrimaryModelMetric` (prioridade **prospectiva > CV/OOF > indisponível**; in-sample **nunca** é vitrine), `calculateRelativeErrorReduction` ("redução de erro vs baseline", não "acurácia"), `describeMetricSource` (rótulo+tooltip honestos por fonte), `MIN_PROSPECTIVE_SAMPLE_SIZE = 30` (provisório).
- **Fix do toast:** `recalculateAll` agora retorna `expectedHonestCvMAE` (= CV honesta); toast/lastRun em `calibration-panel.tsx` passaram a usá-la. Headline reescrita via `selectPrimaryModelMetric`; badge → "X% menos erro que o baseline". `app/settings/page.tsx` monta o `ModelEvaluationMetrics` validado por Zod.
- Teste: `tests/unit/metrics/model-evaluation.test.ts` (17 casos).

### P1 (parcial) — Validação prospectiva: `prediction_snapshots` → ✅ CAMADA FEITA (migration 105 **a aplicar**)
- **Decisão de schema:** **nova tabela `prediction_snapshots` (migration 105), aditiva**; NÃO estende o `prediction_ledger` (101). Motivo: 101 tem `unique(user_id, work_id)` + resolve-no-mesmo-evento — incompatível com "muitos snapshots imutáveis por obra, record-depois-resolve". 101 + `capturePredictionForFirstRating` seguem intactos (com comentário "Legacy… do not use for new metrics"). Doc comparativo em `lib/server/predictions/README.md`.
- **Imutável + resolução:** snapshot pré-rótulo nunca é sobrescrito; resolução grava só a 1ª nota + timestamp (Opção A: **erros NÃO persistidos** — derivados nas funções puras, nunca inconsistentes). Edição de nota = **relabel** (carimba `label_changed_at`, **mantém** a medição original nas métricas); `superseded` é invalidação **manual** (sem caminho automático). UPDATE condicional → idempotente/seguro sob concorrência.
- **Dedup dependente de contexto:** ranking → `ranking::{ranking_snapshot_id}::work::{work}` (a mesma obra em rankings diferentes no mesmo dia gera 2 snapshots — necessário pras métricas de ordenação); evento → `event::user::work::formula::context::mood::{dia America/Sao_Paulo}` (timezone explícito, não da máquina).
- **Métricas (puras):** principal = **1 previsão por obra** (sem pseudorreplicação); por fórmula = **1 por obra × fórmula** (pareada); diagnóstica = "por snapshot"; ordenação por `ranking_snapshot_id` (Spearman/Kendall/pairwise/NDCG/Precision/regret). **Stub** (`predicted_is_stub`) e `superseded` **excluídos** de todas. Baselines (média/calc/expected/decision) na própria cobertura **e** no subconjunto comum.
- **No-op visível:** `collection-status.ts` distingue tabela ausente (migration 105) × erro de conexão × inesperado × sem dados × ativa, com warn-once por processo.
- **Hooks:** record em `runRecommendationAction` (só obras SEM nota = leak-free, agrupadas por run); resolve nos 2 paths de save de nota em `works.ts`. **Painel** técnico `/admin/model-metrics` (status, cobertura/viés de seleção, principal × diagnóstica × ranking) usando `selectPrimaryModelMetric` (F4).
- Arquivos: `supabase/migrations/105_prediction_snapshots.sql` (**não aplicada**), `lib/server/predictions/*`, `lib/metrics/{prediction,ranking}-metrics.ts`, `server/queries/prediction-metrics.ts`, `app/admin/model-metrics/page.tsx`. Testes: `tests/unit/predictions/*` (65 casos) + `tests/unit/metrics/model-evaluation.test.ts`.

### Verificação
**230/230 testes** ✅ (eram 148; +82: F4 + ledger) · `tsc --noEmit` limpo ✅ · `next build` exit 0 ✅ · lint 0 problema nos arquivos alterados.
> Nota de ambiente: o repo usa **npm** (`package-lock.json`); `sharp` ausente → sem recompressão de imagem (só validação + limite).
> ⚠️ **Migration 105 ainda NÃO aplicada** — vai à mão no SQL Editor. Até lá a coleta é no-op tolerante (painel mostra "migration ausente"); nenhum dado prospectivo é gravado.

### Ainda NÃO implementado
- **F1** (gate de auth + rate limit) — pré-deploy.
- **F9** prospectivo: a **infra** está pronta (acima), falta **acumular dado real** (recomendações + notas) pra as métricas saírem do vazio; hooks de record hoje só na recomendação (eventos `work_opened`/`want_to_read`/etc. têm contexto no schema, sem gatilho ainda).
- Demais **P1+**: F5 (head-to-head Ridge×calc), F6 (alignment), F7 (personalização), F8 (mood unificado), e P2/P3.

---

## 2. Veredito sobre o objetivo principal
- 🟥 **Triagem ampla: funciona** (ordena obras claramente diferentes a 91%, lift de NDCG real).
- 🟥 **Ordenação fina: não confiável** (entre obras próximas é cara-coroa; 49% dos pares dentro do erro).
- 🟥 **A sofisticação não demonstrou ganho de acurácia** — na avaliação atual (n=190) Ridge e `calc` são estatisticamente indistinguíveis; a escolha deve ser por simplicidade/custo/explicabilidade.
- 🟥 **Personalização: ganho incremental não demonstrado** sobre a nota base (ambas ajustadas aos mesmos `user_score`; ΔSpearman IC inclui 0) — provável redundância, não ortogonalidade.
- 🟧 **Sem validação prospectiva** do mecanismo completo: existe evidência **offline**, falta a **online/prospectiva** (ponto 6).

---

## 3. Mapa da arquitetura
```
Next.js 16 (App Router, Turbopack) — server-first, SEM auth
app/                rotas server; app/api/ (4 route handlers)
components/         client onde há interação (work-form 2,4k LOC, ranking-filters 2,2k LOC)
server/actions/     ~30 arquivos "use server" — TODOS via createAdminClient (service role)
server/queries/     leituras server-only (getRanking)
lib/calculations/   pipeline determinístico: gpt, score, platform, chapters, expected(Ridge), decision, mood-refine
lib/ml/             Ridge + preprocessing (TS puro) + weight-inference
lib/ai-evaluation/  Claude: 9 critérios + tag/synopsis helpers
lib/ai-recommendation/ Claude: taste-profile, ranker, deep-dive, chat + personal-fit
lib/external/       8 fontes externas
supabase/migrations/ 103 migrations; RLS ligado sem policies (anon bloqueado)
```
DB AWS us-east-2 (Ohio) ~300 ms/round-trip; catálogo 724 obras.

---

## 4. Mapa dos fluxos

| Fluxo | Fonte de verdade | Recalculado quando | IA? |
|---|---|---|---|
| Avaliação IA (9 critérios) | `ai_evaluations`→`category_scores` | botão/criação | sim (Sonnet) |
| Scores (GPT→Calc→Prevista) | `calculated_scores` | **só `recalculateAll` manual** | não |
| Pesos do GPT | inferidos de `user_score` | `recalculateAll` (`score_weights_auto`) | não |
| Veredito IA (`alignment_score`) | `calculated_scores` | "Rankear" (pago) | sim |
| Ranking default | query `getRanking` | a cada request | não |
| Mood "Modo de hoje" | `?mood=` | a cada request (filtro+sort) | não |
| Mood nuançado | client (drawer) | interação | não |

🟥 **Staleness:** derivados só recalculam em `recalculateAll` manual; novo `user_score` não retreina o modelo até o usuário clicar (`recalc_pending` existe mas o gatilho é manual).

---

## 5. Regras de negócio
- **Pesos dos critérios:** **inferidos de `user_score`** via `inferScoreWeights` (`score_weights_auto` default-on desde migration 069); manuais ficam de fallback. ⇒ o `calc_score` **é label-informed** (não é baseline "cru").
- **Conteúdo adulto** (pós-IA, monotônico): R19→7,0; R15-de-R19→4,0; rating externo→5/7/8; couple_dynamics→5 quando romance≤3.
- **Auditoria de reviews** (`enforceAuditableReviewUsage`): rejeita+reavalia se citar review inexistente — **ocorre pós-resposta** (não causa 400; ver §9).
- **Preferências declaradas** (Item A) e **regras livres** (Item B) entram no perfil/prompt.

🟧 As 9 notas IA entram no Ridge 3× (cruas + `IA(n)` + `CriterionFitScore`) — ablação mostra `IA(n)` agregando ~0 (§7).

---

## 6. Auditoria dos cálculos e métricas

### 6.1 Constantes (todas localizadas)
| Constante | Valor | Local | Nota |
|---|---|---|---|
| `POSITIVE_BONUS_FACTOR` | 0,5 | `gpt.ts:9` | bônus acima do threshold |
| `normalizeGPT` slope | 1,25 | `gpt.ts:104` | centro = `gpt_mean` 6,97 |
| `SYNOPSIS_MULTIPLIER` | 0,99–1,07 | `score.ts:5` | não calibrado |
| `SINOPSE_MAP` | 2/5/8/13 | `expected.ts:49` | feature Ridge |
| `MIN_TRAIN` | 20 | `expected.ts:108` | abaixo → prevê a média |
| `ALIGN_MAX_WEIGHT` / `DEFAULT_CONFIDENCE` | 0,35 / 0,6 | `decision.ts:23-25` | peso do veredito LLM |
| `MOOD_SWING` | 0,9 | `mood-refine.ts:57` | "casado a MAE 0,9" — **real 0,58** 🟧 |
| largura de tiers | `tier_band_width` (config) | `lib/ranking/*` | era `TIE_DELTA=0,3` hardcoded → agora configurável (default 0,5) ✅ §1B |

### 6.2 Pipeline (legível)
1. **GPT.N** = clamp(6,97+(GPT−6,97)·1,25), GPT = Σ(nota·peso⁺0,5·excesso·peso)/Σpesos⁺ (pesos inferidos).
2. **Nota.M** = blend bayesiano de plataformas (pseudo=2× mediana).
3. **Nota.Calc** = (√pseudo·GPT.N+√votos·Nota.M)/(√pseudo+√votos)·mult_sinopse+obs(±0,3).
4. **Nota Prevista** = blend(w·Ridge_OOF+(1−w)·Calc)+obs.
5. **Decisão** = Prevista·(1−w)+(alignment/10)·w, w=0,35·conf.

### 6.3 Problemas (Etapa 3)
| Fórmula | Problema medido | Severidade | Alternativa |
|---|---|---|---|
| expected (Ridge) vs calc | indistinguíveis (IC inclui 0); ambos label-fit | 🟥 | escolher por simplicidade/custo (§20) |
| ablação features | `IA(n)`/categóricas ~0 | 🟥 | podar |
| √votos no Calc | popularidade domina blend em obras muito votadas | 🟧 | saturar |
| mult_sinopse | 0,99–1,07 sem validação | 🟧 | calibrar/remover |
| MOOD_SWING/TIE_DELTA | ancorados a MAE 0,9 (real 0,58) | 🟧 | validar bandas (§7.3/§20) |
| decisionScore | eixo misto (450/724 com alignment) + sem ganho medido | 🟥 | separar componente |
| personal_fit | sd 0,058; redundante c/ calc; tags 2× | 🟥 | percentil/robusto/calibrado (§20) |

### 6.4 Exemplos numéricos
- **Δ pequeno = ruído:** A 7,60 × B 7,55 → ordem real acerta 51,5%. Falsa precisão.
- **Δ grande = confiável:** A 8,3 × B 6,8 → 92%.
- **Excelente-pouco-votado × mediano-popular:** `platform_avg` sozinho correlaciona só 0,31 com `user_score`; o √votos dá peso desproporcional ao popular.

---

## 7. Auditoria estatística (validação empírica)

**Universo:** 724 obras; **191 rotuladas** (`user_score` média 7,81; sd 0,963). Dispersões: `expected` sd 0,665; `calc` sd 0,759; **`personal_fit` sd 0,058**; `alignment` em 450/724 (sd 15,75).

### 7.1 Ordenação vs `user_score` (n=191; `expected`/`calc` são in-sample — pesos ajustados nos rótulos)

| Preditor | Spearman | Kendall | pairAcc | NDCG@10 (lift vs aleatório) | P@10 |
|---|---|---|---|---|---|
| constante | — | — | 0,50 | — | — |
| expected (in-sample) | 0,607 | 0,46 | 0,729 | +45% | 0,70 |
| calc (in-sample) | 0,599 | 0,452 | 0,726 | +33% | 0,60 |
| personal_fit | 0,497 | 0,359 | 0,679 | +9% | 0,50 |
| platform_avg | 0,312 | — | — | +14% | — |
| alignment (LLM, n=103) | 0,118 | 0,092 | 0,544 | +27% | 0,80 |

> NDCG: relevância = `user_score−min`; lift = (NDCG−aleatório)/(1−aleatório). P@K: relevante = `user_score≥8` (prevalência 48%).
> ⚠️ **Os lifts/métricas de `expected` e `calc` nesta tabela são IN-SAMPLE** (otimistas — pesos ajustados nos próprios rótulos). Os números honestos (OOF) estão em §7.2 (ex.: o lift +45% in-sample do `expected` corresponde a Spearman OOF 0,582). `personal_fit`/`platform_avg`/`alignment` não são treinados em `user_score` → suas métricas são honestas.

### 7.2 O teste decisivo: OOF sem leakage + bootstrap (pontos 2 e 4)

Ridge reproduzido em JS, **imputação+padronização+seleção de α dentro de cada fold** (5-fold), sem as features de perfil (leaky):

| Modelo | MAE | Spearman | pairAcc |
|---|---|---|---|
| Ridge FULL (OOF) | 0,583 | 0,582 | 0,720 |
| Ridge sem `IA(n)` (OOF) | 0,583 | 0,584 | 0,721 |
| Ridge ingredientes-calc (OOF) | 0,595 | 0,563 | 0,713 |
| Ridge só 9 critérios (OOF) | 0,620 | 0,513 | 0,690 |
| Ridge só externo (OOF) | 0,700 | 0,333 | 0,619 |
| calc_score persistido (in-sample) | 0,587 | 0,600 | 0,726 |
| constante | 0,749 | — | — |

🟥 **IC95% das DIFERENÇAS (paired bootstrap, 2000):**
- FULL − calc persistido: ΔMAE [−0,050; +0,044]; ΔSpearman [−0,070; +0,030]; ΔpairAcc [−0,028; +0,015] → **todos incluem 0**.
- FULL − ingredientes-calc OOF: ΔSpearman [−0,009; +0,049] → inclui 0.
- IC por modelo: FULL MAE [0,526; 0,646]; calc MAE [0,528; 0,650] (fortemente sobrepostos).

🟥 **Conclusão (corrigida — ponto 2):** o Ridge testado **(sem features de perfil)** não mostra ganho sobre o `calc`, mas as diferenças são **estatisticamente inconclusivas** (n=190). **Não é fato que o Ridge tenha valor nulo** — é fato que, com os dados atuais, ele **não demonstra ganho** e adiciona complexidade. Ablação: `IA(n)` e categóricas somam ~0; o sinal está em critérios+externo. *(Caveat: `calc` é in-sample/otimista pois seus pesos foram ajustados em todos os rótulos; um head-to-head 100% limpo exigiria re-ajustar o `calc` por fold.)*

🟦 **Não confirmado:** o modelo de produção COM features de perfil, em OOF limpo (regenerando o perfil por fold — LLM). É a única forma de cravar se a personalização agrega sem leak.

### 7.3 Mesmo subconjunto (n=103, rotuladas ∩ com alignment) — ponto 3

| Modelo | Spearman | pairAcc | P@5 | P@10 | NDCG@10 | regret@10 |
|---|---|---|---|---|---|---|
| expected | 0,293 | 0,612 | 0,60 | 0,70 | 0,742 | 0,840 |
| calc | 0,280 | 0,607 | 0,60 | 0,60 | 0,682 | 0,970 |
| **alignment** | 0,118 | 0,544 | **1,00** | 0,80 | 0,732 | 0,880 |
| decision | 0,219 | 0,587 | 0,60 | 0,60 | **0,793** | 0,790 |
| **aleatório** | — | 0,50 | **0,66** | — | 0,636 | 1,375 |

🟥 **Correção (ponto 3):** o "alignment forte no topo" **não sobrevive à incerteza**. O P@5=1,00 parece ótimo, mas o aleatório nesse subset já é 0,66 (66% relevantes), e o **incremento sobre `expected` tem IC95% que inclui 0** em todos os casos: alignment−expected ΔSpearman [−0,40; +0,06], ΔNDCG@10 [−0,13; +0,17]; decision−expected ΔSpearman [−0,22; +0,06]. **Nenhum ganho demonstrável.** Além disso o subconjunto é **enviesado** (obras escolhidas pra re-rank), o que explica o Spearman menor (0,29).

### 7.4 Validação temporal (ponto 5) — separar calibração de ordenação
Forward-chaining por `created_at` (2ª metade, n=95):
- 🟥 **Calibração FRACA:** MAE 0,719 ≈ baseline constante 0,749.
- 🟧 **Ordenação RESISTE:** Spearman 0,608 (próximo do CV aleatório).
- 🟦 **Classificação: indício forte, não fato prospectivo definitivo** — `created_at` é proxy da data de **catalogação**, não de **rotulagem**. Sugere que o CV aleatório (MAE 0,58) é otimista para "prever a próxima obra", mas a ordem permanece útil.

### 7.5 Personalização — ablação incremental (ponto 7)
Perfil real: loved=50, avoided=13, crit_prefs=9.

| Sinal isolado (vs `user_score`, n=190) | Spearman | pairAcc |
|---|---|---|
| calc (base) | 0,600 | 0,726 |
| só criterion_align | 0,497 | 0,682 |
| só tag_align | 0,484 | 0,674 |
| só consistency | 0,432 | 0,653 |
| personal_fit combinado | 0,527 | 0,693 |

🟥 **Cada camada tem sinal próprio, MAS o ganho incremental ao somar ao `calc` não foi demonstrado:** calc+0,6·(personal_fit−0,5) → Spearman 0,601; **IC95% do ganho [−0,010; +0,012] inclui 0**. Provável causa: o `calc` já absorve o mesmo sinal (pesos ajustados aos `user_score`) → redundância provável, não ortogonalidade. *(Mood não é ablacionável contra `user_score` — não há rótulo de "satisfação dado mood X".)*

### 7.6 Discriminação × diferença prevista (valida o TIE_DELTA — ponto 4 da revisão anterior)
| Δprevisto | pairwise acc |
|---|---|
| [0; 0,1) | 0,515 |
| [0,1; 0,3) | 0,571 |
| [0,3; 0,6) | 0,640 |
| [0,6; 1,0) | 0,756 |
| ≥1,0 | 0,921 |

🟧 `TIE_DELTA=0,3` cai na zona ~0,57 (quase cara-coroa). A largura de banda **não deve ser decretada** (§20). → ✅ §1B: virou `tier_band_width` configurável (default 0,5); largura definitiva ainda **a validar**.

### 7.7 Outros riscos estatísticos
- 🟥 Multicolinearidade: |corr| médio 0,245; **drama~tragedy 0,80** → decomposição "waterfall" não-identificável (não exibir).
- 🟥 MAE de vitrine otimista: `mae_expected`=0,545 (in-sample) vs `cv_mae_expected_stage1`=0,579 (honesta).
- 🟥 Top-10 instável (bootstrap Jaccard 0,54).

---

## 8. Auditoria das avaliações por IA
**Avaliação** (`service.ts`): Sonnet 4.6, prompt v19, 4500 tok, temp 0,2→0, 2 tentativas. Saída via tool Zod (9 critérios). Pós-processamento monotônico + `enforceAuditableReviewUsage`. Cache L1 (memória, 30 min) + L2 (DB, hash+modelo+prompt_version).

🟧 Critérios correlacionados (drama/tragedy 0,80). 🟥 Versionamento por linha existe. 🟦 **Não há prova de que as notas IA estejam corretas** — só estrutura/custo (ver §15, golden dataset). 🟧 `synopsis_quality_predict` roda em **Sonnet** para rótulo de 4 níveis (candidato a Haiku/determinístico — §9).

---

## 9. Auditoria de custos de IA (dados reais, 24,7 dias)
**Total observado: $71,75.** **Run-rate do PERÍODO ≈ $87/mês, mas inclui backfill** (ponto 9): não é estado estacionário.

| Operação · modelo | Chamadas | avg in/out | Custo | $/call | Falhas | Backfill |
|---|---|---|---|---|---|---|
| ai_evaluation · Sonnet | 883 | 2752/1786 | **$38,7 (54%)** | $0,044 | **160 (18%)** | recorrente |
| synopsis_quality_predict · **Sonnet** | 1074 | 578/246 | **$10,3 (14%)** | $0,010 | 0 | **52% num dia** |
| recommendation_rank · Sonnet | 177 | 3561/1695 | $8,3 | $0,047 | 1 | pico 33% |
| calibration_audit · Sonnet | 52 | 16542/3945 | $6,3 | $0,120 | 0 | admin |
| taste_profile · Sonnet | 8 | 22828/3519 | $3,1 | $0,388 | 0 | — |
| review_summarizer · Haiku | 575 | 2004/236 | $1,8 | $0,003 | 0 | pico 37% |
| deep_dive · Sonnet | 17 | 2307/4929 | $1,7 | $0,101 | 4 | — |
| synopsis_consolidator · Haiku | 506 | 652/238 | $0,9 | $0,002 | 0 | pico 25% |

**Custos marginais (estado estacionário):** ~$0,044/avaliação, ~$0,047/recomendação. Cache ativo (ai_eval leu 4,85M tok de cache).

### Falhas (ponto 10 — causa-raiz por dado, não especulação)
- 🟥 **160/160 falhas de `ai_evaluation` = `400 invalid_request_error: "Unable to download [imagem]"`** — a API da Anthropic não consegue baixar a **URL da capa**. (`enforceAuditableReviewUsage` é pós-resposta, **não** causa 400 — confirmado.) → ✅ **CORRIGIDO (§1B):** capa agora vai em base64 pré-buscado no servidor.
- 🟥 deep_dive: 3× "Thinking may not be…", 1× "max_tokens must…" (config). recommendation_rank: 1× corpo inválido.
- 🟥 **Custo das falhas: $0** (400 rejeitado antes do faturamento). **É problema de confiabilidade/UX** (18% das avaliações), não de custo.
- 🟥 **Retries raros** (48 de 2.166 com `attempt`), limitados (máx 2). **Duplicação:** 160 falhas em 125 obras (máx 5) → ~125 obras com capa problemática.
- **Economia ao corrigir:** validar/proxiar/omitir a imagem antes de enviar elimina ~18% de re-execuções de avaliação (latência+UX; custo já é $0).

### Classificação
| Operação | Classe |
|---|---|
| ai_evaluation | Necessária (corrigir os 18% de 400) |
| synopsis_quality_predict (Sonnet) | **Substituível** por Haiku/determinístico |
| recommendation_rank/deep_dive | Útil, otimizável (influência não-demonstrada — §7.3) |
| review_digest vs review_summary | Potencialmente redundante |

---

## 10. Contradições e conflitos
1. 🟧 `MOOD_SWING`/`TIE_DELTA` ancorados a MAE 0,9; real 0,58.
2. 🟥 **Dois sistemas de mood** (preset sort+filtro × `computeMoodAdjusted` nuançado no drawer).
3. 🟥 **Eixo de ranking misto:** `decisionScore` usa `alignment` em 450/724; e o sort default é `expected_score` (veredito pago nem entra na visão padrão).
4. 🟥 MAE in-sample (0,545) vs CV (0,579) na config — ambos ainda existem no config, mas a **exibição foi corrigida** (§1B/F4: vitrine só CV/OOF; in-sample só em área técnica rotulada).
5. 🟧 Nomes legados (`min_predicted_score`/`min_final_score`); `prediction.ts` morto.

---

## 11. Auditoria de banco de dados
- 🟥 103 migrations; FKs/índices ok; RLS ligado **sem policies** (anon bloqueado).
- 🟥 Derivados (`calculated_scores.*`, `review_summary`, `review_digest`, `formula_config.*`) só recalculam sob trigger manual → staleness.
- 🟧 `work_reviews`/`platform_ratings` só re-buscados em "atualizar dados"/re-eval → obras em publicação estagnam.
- 🟦 Upsert em massa sem transação explícita (baixo risco single-user; relevante em concorrência).

---

## 12. Auditoria de segurança (reescrita — ponto 1)

🟥 **Premissa corrigida:** "single-user + RLS sem policy" **NÃO é proteção** quando a app é publicada. Server Actions e Route Handlers rodam **server-side com a service role**, que **ignora RLS**. Qualquer visitante pode invocá-los (Server Actions são endpoints POST gerados pelo Next).

### Mapa de ações privilegiadas
- 🟥 **~30 arquivos** em `server/actions/*`, **>100 funções `"use server"`**, **todas** via `createAdminClient()`. Sem nenhuma verificação de auth/ownership.
- 🟥 **Mutação/perda de dados:** `works.ts` (17 ações — criar/editar/deletar obra), `settings.ts` (14), `tag-consolidation.ts` (24), `tag-subgroups.ts` (19), `imports.ts`, `recalc-queue.ts`, `tag-preferences.ts`, `preference-rules.ts`. Qualquer visitante pode criar/editar/apagar catálogo e preferências.
- 🟥 **Gasto de dinheiro (sem auth, sem rate limit):** `ai.ts` (`triggerAiEvaluation`), `recommendations.ts` (10), `deep-dive.ts`, `recommendation-chat.ts`, `calibration.ts` (9), `enrich.ts`, `synopsis*.ts`. **Um visitante pode drenar o orçamento Anthropic** disparando avaliações/recomendações em massa.
- 🟧 **Route handlers** (`app/api/`): `image-proxy` (allowlist de host ✓), `animeplanet` (regex de slug ✓), **`comick/search` e `comick/[hid]` (sem validação visível)** — risco de uso como proxy/abuso (SSRF/scraping via seu IP).

### Recomendações
- 🟥 **Antes do deploy single-user no Fly.io:** colocar um **gate de auth global** na frente de tudo (Basic Auth, Cloudflare Access, ou middleware com 1 senha) **antes** de expor; **rate limiting** nos endpoints que gastam IA (por IP, com teto diário). Custo: baixo, alto retorno.
- 🟥 **Para multi-user (free × pago):** auth real (Supabase Auth/NextAuth); **coluna `user_id` + verificação de ownership em TODA action** (hoje os dados são globais — risco de IDOR massivo); **RLS com policies por usuário** OU autorização explícita na camada de action (defense-in-depth); **quota/rate limit por usuário** (free vs pago) nos endpoints de IA; sanitizar texto de review antes do prompt (prompt-injection).
- 🟥 Secrets ok hoje (só `NEXT_PUBLIC_*` no client; service role server-only; `.env.local` no `.gitignore`).

---

## 13. Auditoria de performance
- 🟥 DB Ohio ~300 ms/round-trip → paralelizar (já há `Promise.all`).
- 🟧 `/ranking` carrega até 2000 linhas in-memory; filtros de critério/percentil em JS pós-SQL.
- 🟧 Componentes-deus client (work-form 2,4k, ranking-filters 2,2k) — bundle grande.
- 🟥 Scores pré-calculados (não recalculados em render) — bom; o risco é staleness (§11).

---

## 14. Auditoria de qualidade de código (com execução — ponto 10)
- 🟥 **Build** (`next build`): **exit 0** (rotas estáticas+dinâmicas ok).
- 🟥 **Typecheck** (`tsc --noEmit`): **limpo**.
- 🟥 **Testes** (`vitest run`): **117/117 passam (17 arquivos)**.
- 🟧 **Lint** (`eslint`): **444 problemas (29 erros, 415 warnings)** — não bloqueia o build, mas é dívida real (no-unused-vars, no-unused-expressions, react-hooks/exhaustive-deps).
- 🟧 **`noUncheckedIndexedAccess` = false** (`strict:true`, mas esse flag desligado) — **divergência da stack**: com `noUncheckedIndexedAccess` ligado, vários acessos por índice precisariam de checagem; hoje `undefined` pode passar silenciosamente.
- 🟧 Código morto (`prediction.ts`), scripts redundantes (`seed-from-xlsx 4/5/6`).
- 🟥 Documentação interna excelente (CLAUDE.md, PLANO-ATUAL, doc-comments).

---

## 15. Auditoria de testes
- 🟥 117 testes passam, mas cobrem **só matemática determinística**.
- 🟦 **Ausentes:** regressão de ranking, **golden dataset humano de avaliação IA** + **teste de repetibilidade** (rodar a mesma avaliação N× e medir variância das notas — prova que a IA é estável, não só estruturada), RLS, E2E, snapshot de prompt.
- 🟥 ⏳ A validação prospectiva é o ativo que faltava: a **camada foi construída** (§1B: `prediction_snapshots` + métricas + `/admin/model-metrics`); falta aplicar a migration 105 e acumular dado. O `prediction_ledger` (101) permanece como anchor legado da 1ª nota.

---

## 16. Pontuação por área (provisória até validação prospectiva)

| Área | Nota /10 | Base |
|---|---|---|
| Qualidade técnica | 8 | build/tsc/testes verdes; strict TS; Zod |
| Coerência das regras | 6 | bom anti-double-count; constantes desatualizadas; 2 sistemas de mood |
| Confiabilidade dos dados | 5 | staleness manual; externos estagnam; tags OK (mediana 30) |
| Avaliações IA | 6 | prompt sólido; 18% de 400 (imagem); correção não-provada (sem golden) |
| Eficiência de custo IA | 5 | cache bom; Sonnet p/ tarefa de 4 níveis; backfill no run-rate |
| Coerência estatística | 5 | sinal real, mas ganho de ML/LLM inconclusivo; vitrine otimista |
| Personalização real | 4 | ganho incremental não demonstrado (ΔSpearman IC inclui 0) |
| Influência do mood | 5 | reordena (preset) e desempata (drawer); dividido; MOOD_SWING velho |
| Explicabilidade | 5 | tiers ajudam; waterfall não-identificável |
| Segurança (se publicado) | 3 | service role sem auth → mutação e gasto por visitante |
| Probabilidade de atingir o objetivo | 5 | boa triagem; ordenação fina não confiável; sem prova prospectiva |

---

## 17. Principais riscos
1. 🟥 **Exposição se publicado** (mutação + gasto de IA por visitante) — vira P0 no deploy.
2. 🟥 **Falsa precisão** (ordem fina/tiers 0,3 onde é cara-coroa).
3. 🟥 **Sofisticação sem ganho mensurável** (Ridge/alignment indistinguíveis do simples).
4. 🟧 **Calibração prospectiva fraca** (temporal ≈ baseline) — número exibido superestima utilidade.
5. 🟥 **18% de avaliações falhando** por capa inválida.
6. 🟦 **Sem validação prospectiva** do mecanismo (offline existe; online falta).

---

## 18. Quick wins
- 🟥 Exibir só CV/OOF MAE (não in-sample). P.
- 🟥 Validar/omitir URL de capa antes do envio → corta ~18% de falhas. P.
- 🟥 `synopsis_quality_predict`→Haiku/determinístico (item de 14%). P.
- 🟥 Gate de auth + rate limit antes de qualquer deploy. P–M.
- 🟧 Atualizar `MOOD_SWING`/`TIE_DELTA` após análise de bandas (§20). P.
- 🟧 Remover `prediction.ts`/scripts duplicados; reduzir 29 erros de lint. P.

---

## 19. Plano de ação P0–P3

**P0 — corrigir já**
1. 🟥 **Segurança de exposição:** gate de auth global + rate limit nos endpoints de IA **antes** do deploy single-user; planejar authz por usuário para multi-user. *(M)* — pendente
2. 🟥 ✅ **Parar de prometer ordenação fina** — feito (§1B: tiers configuráveis + decimal rebaixado). **F4 (vitrine OOF/CV) também feito** (§1B: toast honesto + `selectPrimaryModelMetric`). *(P–M)*
3. 🟥 ✅ **Corrigir os 18% de 400 (capa)** — feito (§1B: pré-fetch base64). *(P)*

**P1 — qualidade da recomendação**
4. 🟥 ⏳ Separar o número único em **componentes** (§20) e ligar a medição prospectiva vs baselines. **Infra feita** (§1B: `prediction_snapshots` + métricas por obra/fórmula/snapshot/ranking + `/admin/model-metrics`); falta **aplicar a migration 105** e acumular dado prospectivo. *(M–G)*
5. 🟥 Decidir o destino do Ridge por **head-to-head OOF limpo** (perfil por fold) — se não superar o `calc` com significância, simplificar para o `calc`. *(M)*
6. 🟥 Unificar a semântica de mood (blunt × nuançado). *(M)*
7. 🟧 `personal_fit`: como é redundante hoje, repensar (percentil/robusto/calibrado) e/ou buscar sinal ortogonal. *(P–M)*

**P2 — arquitetura/custo**
8. 🟧 `synopsis_quality_predict`→Haiku; avaliar fundir `review_digest`+`review_summary`; job de refresh de reviews/ratings. *(P–M)*
9. 🟦 Testes de regressão de ranking + **golden dataset + repetibilidade** da IA + snapshot de prompt. *(M)*

**P3 — evolução**
10. Sanitização de review no prompt; limpeza de nomes legados; ligar `noUncheckedIndexedAccess`.

---

## 20. Proposta de arquitetura/fórmula alternativa

**Não trocar por ML mais complexo** (o atual não mostrou ganho). Princípio: **separar conceitos e rankear por bandas, validando empiricamente.**

| Componente | Definição | Fonte | Escala |
|---|---|---|---|
| Satisfação prevista | prevê `user_score` (NÃO é "qualidade") | `calc` (ou Ridge se provar OOF) | 0–10 |
| Qualidade externa | nota das plataformas | `platform_avg` | 0–10 |
| Popularidade | volume | log(votos) | separado |
| Confiança da nota externa | credibilidade da média | f(nº votos) | 0–1 |
| Compatibilidade permanente | perfil/tags | `personal_fit` repensado | percentil |
| Compatibilidade com mood | viés momentâneo | mood nuançado | re-peso within-band |
| Confiança dos dados | cobertura de tags + recência | derivado | 0–1 |

- 🟦 **Largura de banda = HIPÓTESE DE PRODUTO a validar (ponto 11)**, não regra. Comparar: **(a) banda fixa** (ex. 0,5–0,6), **(b) percentis**, **(c) clusters** (k-means/jenks na distribuição), **(d) probabilidades calibradas** (P[A melhor que B] via modelo/curva de confiabilidade §7.6). Escolher pela métrica de produto, não por decreto.
- 🟦 **`personal_fit` (ponto 7 da revisão):** não recomendar rank puro. Comparar **percentil × normalização robusta (mediana/IQR) × função calibrada**, preservando diferenças relevantes (hoje sd 0,058 destrói diferença) — e buscar sinal **ortogonal** ao `calc` (senão continua redundante).
- 🟥 **Popularidade fora de "qualidade"** (ponto 6 da revisão): qualidade externa, popularidade e confiança são eixos próprios.
- 🟥 **Validar a IA (ponto 8):** **golden dataset humano** (N obras com notas de referência) + **repetibilidade** (mesma avaliação N×, medir variância) antes de confiar nas notas.
- **Calibração/validação:** prequencial em `prediction_snapshots` (✅ camada feita, §1B) + A/B vs baselines (média; calc; expected; decision) com MAE/RMSE/Spearman/Kendall/pairwise/NDCG@K/Precision@K/**estabilidade top-K**. Falta acumular dado + **ICs/bootstrap** (ainda não no painel). Sucesso = bater baselines com significância.
- **Migração não-destrutiva:** tudo já em `calculated_scores`; muda apresentação + banda + painel.

---

## 21. Perguntas em aberto
- 🟦 OOF **com** features de perfil regeneradas por fold (LLM) — única forma de cravar a personalização sem leak.
- 🟦 Head-to-head 100% limpo Ridge × calc (re-ajustar `calc` por fold).
- 🟦 Validação **prospectiva** em `prediction_snapshots` — infra pronta (§1B); ainda **sem dado** (migration 105 a aplicar + acumular recomendações/notas).
- 🟦 Repetibilidade real da avaliação IA (golden dataset).
- 🟦 `created_at` representa a data de rotulagem? (afeta a leitura da validação temporal).

---

## Respostas finais
1. **Maior problema:** promessa de ordenação fina (notas/tiers 0,3) onde o modelo é cara-coroa (acc 0,515 p/ Δ<0,1); somado à exposição de segurança se publicado.
2. **Maior impacto positivo:** componentes separados + bandas validadas + **medição prospectiva** vs baselines (infra feita em `prediction_snapshots`, §1B; falta dado).
3. **Sofisticado mas sem ganho demonstrado na avaliação atual:** Ridge 22-features + blend + waterfall (IC das diferenças inclui 0); veredito LLM (sem ganho no mesmo subset); personalização com ganho incremental não demonstrado.
4. **Maior risco de custo:** `synopsis_quality_predict` em Sonnet (14%) + backfill inflando o run-rate; falhas **não** custam (400).
5. **Cálculos confiáveis?** Como número, os determinísticos sim (testados); como **ordenação fina**, não; como **triagem ampla**, sim.
6. **Scoring mais adequado:** `calc` (satisfação prevista) + componentes separados + bandas + desempate por evidência — escolhendo o modelo por simplicidade, já que a acurácia é indistinguível.
7. **Está ajudando a escolher?** Para triagem ampla, sim; para a decisão fina, ainda não — e o ganho incremental da personalização ainda não foi demonstrado.
8. **Como provar:** prospectivo em `prediction_snapshots` (✅ infra, §1B) + golden dataset da IA + A/B contra baselines, sempre com IC/bootstrap. **Já há evidência offline; a infra prospectiva existe, falta acumular dado em produção.**
