# HANDOFF — Otimização (execução/obsolescência) + terminar digest no Interesse

**Criado:** 2026-06-27
**Para:** próxima sessão. Documento auto-contido — não precisa re-derivar o que está aqui.

## Objetivo da próxima sessão (3 frentes)
1. **Otimizar a execução/obsolescência** — hoje há ação demais rodando sem necessidade e coisas ficando stale sem mudança grande.
2. **Resolver as lacunas/assimetrias** mapeadas (ver §5).
3. **Terminar o digest na predição de Interesse na obra** (ver §7).

---

## 1. Estado atual (não refazer)

| Item | Estado |
|---|---|
| **Fase 1 (golden digest)** | ✅ GO — digest melhora o Interesse ♥ vs proxy humano (n=180; ΔMAE −0,211; IC [−0,311;−0,117]). Validado SÓ pra o ♥/Veredito, **não** pra a Nota Prevista. |
| **Fase 2 / 2A** | ✅ Commitado na branch `feat/digest-canonical-corpus` (**não pushado**): digest de produção agora lê o corpus canônico (`work_reviews` + `work_external_reviews_manual`, leakage-proof). Rebuild de produção feito (104→290 digests). |
| **Ablação do SinopseScore no Ridge** | ✅ Feita ($0): **redundante** (ΔMAE +0,0007). O Interesse legado **não move a Nota Prevista** (alinhamento já capturado por tag-overlap + criterion-fit + as 9 notas; obras lidas são tag-ricas, mediana 40 tags). |
| **Testes b1/e1 e atributos-via-Ridge** | ⏸️ PAUSADOS (caro × retorno provável marginal) — ver `PLANO-TESTES-DIGEST-RIDGE.md`. |
| **Instrumentação ELOB** | ✅ Revertida da `recalculateAll`. |
| **Working tree** | WIP do usuário (vários arquivos) segue não-commitada. Artefatos do experimento em `.local-experiments/plan3/` (gitignored). |

**Conclusão estratégica:** o lugar nobre do digest é a **ordenação holística** (Interesse ♥ / Veredito IA), **não** o número da Nota Prevista (Ridge saturado). Por isso a frente 3 é "terminar o digest no Interesse" (pathway validado), e não mexer no Ridge.

---

## 2. Custos (pra priorizar — o que é caro vale otimizar primeiro)

Preços/1M tokens: **Sonnet** $3 in / $15 out · **Haiku** $1 / $5 · cache-read ~10% · cache-write ~1,25×.

### Criar uma obra nova (por ação)
| Ação | Modelo | Quando | ~Custo |
|---|---|---|---|
| Avaliação IA (9 critérios) | Sonnet, 4500 tok, até 2 tent. | auto (pré-save) | ~$0,076 (1) / ~$0,14 (2) |
| Digest de reviews | Sonnet, 2000 tok | auto (save) | ~$0,02–0,05 |
| Resumo de reviews | Haiku, 700 tok | auto (save) | ~$0,005–0,017 |
| Interesse (♥) | Sonnet, 400 tok | sob demanda | ~$0,005–0,017 |
| Veredito IA (alignment) | Sonnet (no ranking) | sob demanda | ~$0,02 |

**Total criar:** ~$0,14–0,15 (automático) · ~$0,16–0,19 (com tudo) · piso ~$0 (cache) · teto ~$0,21.

### Outras ações
| Ação | ~Custo | Nota |
|---|---|---|
| Gerar/atualizar perfil | **~$0,30** (pago) / $0 (free=heurístico) | só regenera quando o `input_hash` muda |
| Gerar recomendação (ranking/favoritos) | **~$0,13** | Veredito sai na mesma chamada ($0 extra); +$0,30 se perfil stale |
| Deep Dive | **~$0,16** | Sonnet + extended thinking |

> A **avaliação IA** domina o custo unitário e tem cache (memória + `ai_evaluations` por hash). A ação **mais cara e recorrente** é o **recalc global** (ver §3) — não é LLM, mas é trabalho desnecessário em escala.

---

## 3. Gatilhos automáticos (ação → dispara)

**Arquitetura:** recalc de notas é SEMPRE **global** (`recalculateAll`, `server/actions/calculations.ts:448`) — nunca por-obra (não existe `recalculateWork` de 1 obra). Edições marcam `recalc_pending` (diferido); criar/"recalcular agora" rodam síncrono. Orquestração é lazy/pull (só roda quando um `ensure*` é chamado). Só 2 triggers SQL (migration 046, sobre `ai_eval_status`).

| Ação | Dispara | Ref |
|---|---|---|
| Criar obra | recalc **síncrono** + consolidar sinopse + buscar reviews | `works.ts:~1050, ~991, ~1029` |
| Editar obra | `markRecalcPending` + `markWorkAlignmentStale` + resolve snapshot | `works.ts:~1439, ~1419, ~1430` |
| Mudar status | `markRecalcPending` (⚠️ **não** marca alignment stale) | `works.ts:~1607` |
| Editar dados externos | `markRecalcPending` + alignment stale + reconsolidar sinopse | `works.ts:~1778, ~1776, ~1714` |
| Aceitar avaliação IA | grava `category_scores` + status=done + alignment stale + `markRecalcPending` | `ai.ts:~421–450` |
| Salvar reviews (scraped) | `ensureReviewSummary` (aguardado) + `ensureReviewDigest` (fire-and-forget) | `persist-reviews.ts:90–104` |
| Sinopse canônica regenerada | interesse stale + auto-prever interesse | `works.ts:84–91` |
| Regenerar perfil | perfis antigos stale + interesse stale + `markRecalcPending` | `taste-profile.ts:147, 171, 178` |
| Salvar tag preferences | `markRecalcPending` (sem regen de perfil) | `tag-preferences.ts:63` |
| Atributos pós-leitura / sync capítulos / importar | `markRecalcPending` | `post-reading-attributes.ts:81`, `reading.ts:148`, `external-list-import.ts:331` |
| Abrir página / badges | recalc em background se `recalc_pending` e ocioso ≥1h | `badges.ts:42` → `recalc-queue.ts:144–153` |

---

## 4. Obsolescência (ação → torna stale)

| Ação | Obsoleta | Marcador (ref) |
|---|---|---|
| Editar nota/tag/cap/status/sinopse | `expected_score`/`calc`/`personal_fit`/`tag_overlap` da **BASE INTEIRA** | `recalc_pending` global (mig 096, `recalc-queue.ts:32`) |
| Editar obra / dados externos / aceitar eval | Veredito (alignment) **da obra** | `alignment_stale` (`alignment.ts:15–25`) |
| Editar título/tags/sinopse | Interesse (synopsis_quality) | `input_signature` mismatch (`synopsis-interest.ts:58–99`, mig 111) |
| Editar blocos de sinopse | sinopse canônica | `canonical_synopsis_inputs_hash` (mig 057) |
| Salvar reviews | resumo (hash+materialidade) e digest (versão+materialidade, **sem** content-hash) | `review_summary_inputs_hash` (mig 081) / `review_digest_n+version` (mig 103) |
| Salvar user_score | snapshots de predição em aberto | resolve/relabel (`works.ts:1430, 1601`) |
| Novo perfil | perfis antigos + interesse + personal_fit (⚠️ **não** alignment) | `is_current=false` + signatures (`taste-profile.ts`) |

### Chaves de staleness (referência rápida)
`recalc_pending` (global, mig 096) · `canonical_synopsis_inputs_hash` (057) · `review_summary_inputs_hash` (081) · `review_digest_n+version` (103) · `synopsis_quality_predictions.stale`+`input_signature` (085/111) · `taste_profile.input_hash`+`is_current` · `alignment_stale` (em `calculated_scores`).

---

## 5. Lacunas / assimetrias (frente 2 — pontos a resolver)

1. ✅ **FEITO (2026-06-27)** — ~~Reviews manuais externas NÃO disparam regen de digest~~. `createExternalManualReview`/`update`/`delete` chamam `ensureReviewDigest(force:true)` via `after()` (`force` ignora o gate por-contagem — curadoria deliberada muda o corpus; dedup por contentHash evita run redundante). Resumo NÃO regenera (corpus dele = só `work_reviews`, sem a manual externa). **Ciclo do 2A fechado.**
2. **`updateWorkStatus`** marca `recalc_pending` mas **não** `alignment_stale` (≠ `updateWork`). → Decidir se mudar status deve invalidar o Veredito.
3. **Gate do digest ignora content-hash** (`reviews.ts:81–93`) → editar review com mesma contagem nunca regenera o digest. → Considerar incluir content-hash (como o resumo faz).
4. **`savePreferenceRules` não marca nada** (`preference-rules.ts:41–43`) — regras só são lidas ao vivo pelo LLM, nunca entram no modelo offline. → Verificar se é intencional.

---

## 6. Frente 1 — Otimizar execução/obsolescência (a queixa principal)

**Diagnóstico:** o maior desperdício é o **recalc GLOBAL**. Editar 1 obra marca `recalc_pending` global → o próximo recalc reprocessa **todas as ~758 obras** (treina Ridge, recalcula percentis/pesos/calibração/calc/expected pra todo mundo). Custo: não-LLM, mas pesado (DB ~300ms/round-trip; catálogo grande) e roda à toa quando a mudança foi local.

**Por que é global hoje (razões legítimas):** adicionar/editar 1 obra **desloca** a média global, percentis de votos, pesos auto-inferidos e a calibração — que afetam o score de todas. Então não dá pra simplesmente trocar por "recalc só dessa obra" sem perder consistência.

**Alavancas a investigar (próxima sessão):**
- **Granularidade do `recalc_pending`:** hoje é booleano global (mig 096). Avaliar marcar por-obra/por-feature, e separar "o que realmente muda globalmente" (média/percentis/pesos) de "o que é local" (score de 1 obra).
- **Recalc incremental:** recomputar os agregados globais (média, percentis, pesos, calibração) só quando **eles** mudam materialmente; reusar pra o resto. Editar 1 campo de 1 obra raramente move o agregado o bastante pra mudar o ranking.
- **Debounce/batch:** já existe `maybeTriggerStaleRecalc` (≥1h idle). Avaliar se está sendo bom o suficiente ou se há recalc síncrono demais (create roda na hora — necessário?).
- **Obsolescência mais cirúrgica:** edição local não deveria invalidar a base inteira. Mapear quais edições realmente exigem recalc global vs local.
- **Cuidado:** medir antes/depois (o catálogo é pré-filtrado, dispersão baixa — mudanças de score são pequenas; talvez o recalc global mude **quase nada** na prática → forte argumento pra evitá-lo).

**Arquivos-chave:** `server/actions/calculations.ts` (recalculateAll), `server/actions/recalc-queue.ts` (markRecalcPending, maybeTriggerStaleRecalc), `supabase/migrations/096_*` (recalc_pending).

---

## 7. Frente 3 — Terminar o digest na predição de Interesse  ✅ FEITO (2026-06-27, código $0)

> Implementado: preditor aceita `reviewDigest` → adendo no system (2º bloco, cache preservado) + bloco `CONTEXTO DE LEITORES` no user; `PROMPT_VERSION` v2→v3; `formatDigestForPrompt` em contextual-package; wiring no gateway `loadWork` + backfill `listWorks` (lê `review_digest`→formata→passa ao predict E à assinatura `extraSources`); teste do contrato e1 + verificação DB→prompt ($0). FALTA (pago, sob autorização): backfill e1 (~$5–8) ou deixar fluir sob demanda (recomendado, alinha com a deferral do 2a). Detalhe abaixo (contrato original mantido p/ referência).

**O que falta:** o preditor de produção (`lib/ai-evaluation/synopsis-quality-predictor.ts`) é **b1** (só sinopse). "Ligar o digest" = virar **e1** (sinopse + digest sanitizado) — pathway **validado na Fase 1** (melhora o ♥; alimenta display + Veredito/ordenação). **NÃO** é pra mover a Nota Prevista (Ridge é redundante — ablação).

**Contrato e1 validado (da golden-3):**
- System: `SYNOPSIS_QUALITY_SYSTEM_PROMPT` + adendo neutro pré-comprometido:
  > "Além da sinopse, você recebe um RESUMO AGREGADO DE REVIEWS de leitores (consenso, divergências, traços recorrentes e avisos). Use-o como sinal COMPLEMENTAR ao julgamento — a SINOPSE segue dominante. Se não houver contexto de leitores, ignore esta parte."
- User: bloco extra `CONTEXTO DE LEITORES (resumo agregado de reviews):\n{digest text}` com o digest **sanitizado** (`sanitizeDigestForLabeling` → consenso/divergência/traços(polaridade)/execução/avisos).
- Fonte do digest no predict-time: `works.review_digest` (já populado pra a pool após Fase 2).

**Implementação concreta:**
1. `synopsis-quality-predictor.ts`: aceitar um `reviewDigest?` opcional em `PredictWorkInput`/args; `buildSynopsisQualityUserPrompt` adiciona o bloco do digest; system ganha o adendo quando há digest.
2. Wirar a fonte do digest no fluxo de predição (`autoPredictSynopsisQuality` / `synopsis-quality-runner.ts`): ler `works.review_digest`, sanitizar, passar.
3. Bump da `PROMPT_VERSION` (v2→v3) → invalida as predições antigas (re-prevê com digest). Avaliar custo do backfill (~$0,005–0,017/obra × pool elegível).
4. Atualizar a assinatura de invalidação (`input_signature`, `synopsis-interest.ts`) pra incluir o digest (senão mudança de digest não invalida).
5. Teste unitário (espelhar o do golden-3 `run-b1-e1.ts` `digestText`/`E1_SYSTEM_ADDENDUM`).

**Código de referência (experimento, já pronto):** `.local-experiments/plan3/digest-exp-1/golden-3/run-b1-e1.ts` tem o `digestText()`, o `E1_SYSTEM_ADDENDUM` e o uso do `sanitizeDigestForLabeling` exatamente como validado.

**Atenção (lacuna #1 da §5):** com o digest no Interesse, a invalidação por mudança de digest precisa estar conectada — e a manual externa precisa disparar o regen do digest (senão o Interesse não vê a review nova).

---

## 8. Arquivos-chave (índice)
- Recalc/custo: `server/actions/calculations.ts`, `server/actions/recalc-queue.ts`
- Triggers de obra: `server/actions/works.ts`, `server/actions/ai.ts`
- Reviews/digest: `lib/external/persist-reviews.ts`, `lib/ai-recommendation/review-summarizer.ts`, `lib/synopsis-interest/digest-corpus.ts`, `lib/orchestration/integrations/reviews.ts`
- Interesse: `lib/ai-evaluation/synopsis-quality-predictor.ts`, `server/actions/synopsis-quality.ts`, `lib/synopsis-interest/synopsis-quality-runner.ts`, `lib/synopsis-interest/contextual-package.ts` (sanitizeDigestForLabeling)
- Perfil: `lib/ai-recommendation/taste-profile.ts`, `lib/ai-recommendation/service.ts`
- Recomendação/Veredito/Deep dive: `server/actions/recommendations.ts`, `lib/ai-recommendation/service.ts` (rankFavorites/alignment), `lib/ai-recommendation/deep-dive.ts`
- Manual externa (lacuna): `server/actions/external-manual-reviews.ts`
- Planos relacionados: `PLANO-REVIEWS-DIGEST.md`, `PLANO-TESTES-DIGEST-RIDGE.md`

## 9. Decisões já tomadas (não relitigar)
- Digest **não** vai pro Ridge/Nota Prevista (redundante). Vai pro Interesse/Veredito/ordenação.
- 2A já commitado (manual externa no corpus do digest).
- Testes b1/e1 e atributos-via-Ridge pausados (caro × marginal).
- Validação de "gosto real" só virá pelo ledger `prediction_snapshots` (hoje 0 linhas) ao longo do uso.

---

## 10. Sessão 2026-06-27 — executado (branch feat/digest-canonical-corpus, NÃO pushado)

**Frente 1 (otimização) — ENCERRADA.** Ver [[project_recalc_optimization_materiality]].
- `computeRecalc` extraído de `recalculateAll` (núcleo PURO, parity ~0,003). Blast radius medido (leave-one-out): edição sem-rótulo ~0 nas outras; rótulo só remexe o meio denso (topo estável).
- **Q** — nested-CV honesta (552ms, 74% do compute) cacheada por assinatura fiel (`cvSig`). 741→195ms quando rotuladas não mudam. Verificado.
- **2a** — Interesse: hard-norm na assinatura (cosmético 100%→0% de invalidação) + deferir a re-previsão na edição de sinopse (eager só na 1ª vez). 0 stale espúrio.
- **NO-GO empírico:** 2b (regen re-deriva o perfil inteiro → 0,5% de ganho), 2c, E (modesto).

**Frente 3 + lacuna #1 — FEITAS (código $0).** Ver §7 e §5 acima. Pago pendente (sob autorização): backfill e1 (~$5–8, opcional — sob demanda recomendado) e regen do digest na curadoria manual (~$0,02–0,05/edição, allowPaid).

**Frente 3 + lacuna #1 — FEITAS.** + **merge dos 2 UPDATE de formula_config** (−1 round-trip ~450ms; upsert incremental DESCARTADO: medido +450ms net-negativo).

**Mais entregas da sessão (commits cc7d45c · 5a1ea47 · 178c224 · bf31a3c · 92cb8f1):**
- **UI do digest** na aba "Notas & Avaliações" (estruturado + botão Gerar/Regerar) — `WorkReviewsCard`.
- **Resumo (Haiku) passa a incluir a manual externa** (= digest): `readSummaryReviewInputs` (scraped c/ nota + manual sem nota); save/gateway/backfill/lacuna#1 unificados.
- **Custo da previsão de Interesse = regen do PERFIL** (~$0,40 = 500tok×~201 obras no Sonnet), não a previsão (~$0,01). → **indicador de DRIFT method-free** (migration **118** APLICADA; fingerprint heurístico no gen; `getProfileDrift`; exposto no dialog) + **botão "Prever sem atualizar o perfil"** (acceptStaleProfile → prevê ~$0,01 sem regen). Drift ativa após próximo regen gravar o fingerprint (não-retroativo). Validar proxy (heurístico não lê sinopse) antes de auto-pular.
- **Bug achado+corrigido:** `calculations.ts` era `"use server"` → exports síncronos (computeRecalc/buildWork) quebravam o Turbopack (500 global) → trocado p/ `"server-only"`. tsc/vitest NÃO pegam.

**Lacunas §5 — FECHADAS:** #1 feita; **#2 (status→Veredito) e #4 (regras→nada) verificadas INTENCIONAIS** (Veredito = snapshot pago sob demanda, invalidado só por updateWork; status muda só a avaliação pessoal; regras são live-read no `rankFavorites`, não entram no perfil cacheado); #3 = `force` no path manual + global descartado por custo.

**Diagnósticos $0 re-rodáveis (scripts/diag-*.ts):** diag-recalc (blast radius), diag-q-verify (cache Q), diag-staleness (materialidade Interesse), diag-profile-drift (drift perfil).

**Pendências (todas do usuário / opcionais):** backfill e1 (~$5–8, opcional); resumos existentes de obras c/ manual externa re-geram no próximo save/edição; validar proxy do drift (logar delta LLM nos regens). NÃO sobra alavanca grande de código.
