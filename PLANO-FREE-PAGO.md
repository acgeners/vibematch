# PLANO — Mapa canônico Free / Pago / Admin

> **Data:** 2026-07-11 · **Branch:** `feat/mapa-free-pago`
> **Objetivo:** fonte única do que separa **free × pago** e **usuário × admin/curadoria**, com a opção de cada lado definida e o **estado do gate** (feito / falta / onde). Pré-requisito do deploy multi-user.
> **Marcação:** ✅ verificado no código hoje · ⚠️ inconsistência · 🔴 buraco de segurança/custo.
> Substitui a spec parcial de `PLANO-MULTIUSER.md §1` e reconcilia `lib/plans/capabilities.ts`.

---

## 0. TL;DR — o que este mapa revelou

1. **O eixo free/pago está quase ok.** 6 capabilities definidas, **4 gateiam de verdade** (`llm_taste_profile`, `smart_shortlist`, `deep_dive`, `chat_recommend`). 2 são chaves mortas.
2. **O bloqueador de deploy NÃO é "definir free/pago" — é o eixo ADMIN.** O stopgap gateou as *mutações de commit*, mas deixou **~40 ações que gastam IA ou mutam o catálogo SEM `ensureAdmin`** (§4). Hoje qualquer logado — e em vários casos até anônimo — dispara Sonnet/Haiku/embeddings **no saldo do dono** (denial-of-wallet) ou sobrescreve o catálogo compartilhado.
3. **Quota/limite de produto não existe** (nº de obras, listas, export). E só faz sentido depois da **Fase 2 (partição per-user)**, que está adiada. Então o free hoje é "vitrine de leitura do catálogo do dono".
4. **`planAllows` é stub binário** (`plan === "paid"`, ignora a capability). Ok como design, mas o mapa por-capability é decorativo hoje.

**Conclusão:** o deploy depende de **fechar os buracos do §4** (eixo admin), não de mais decisões de plano. As decisões de produto (§6) podem esperar a Fase 2.

---

## 1. Modelo de acesso — 3 eixos ortogonais

| Eixo | Coluna DB | Gate (server) | Gate (UI) | Pergunta que responde |
|------|-----------|---------------|-----------|------------------------|
| **Plano** free/pago | `user_settings.user_plan` (default `free`, fail-closed) | `ensureCapability(cap)` / `planAllows` | `isPaid` esconde botões IA | "Esse usuário paga pela versão rica?" |
| **Admin/curadoria** | `user_settings.is_admin` (mig 139) | `ensureAdmin()` | `useIsAdmin()` esconde "Gerenciar" | "Pode editar o catálogo COMPARTILHADO?" |
| **Anon/deslogado** | sem sessão | `isCurrentUserAdmin→false` | só nav "Principal" | "Visitante — só leitura da vitrine" |

**Regra de ouro:** curadoria do catálogo = **admin**, nunca plano (um pago **não** edita o catálogo compartilhado). Valor de IA por-usuário = **plano**. São eixos independentes.

---

## 2. Mapa canônico A — Eixo PLANO (free × pago)

Fonte: `lib/plans/capabilities.ts`. Regra: **capability não-listada = Free**; só o que custa LLM é restrito.

| Feature | Free (determinístico) | Pago (IA) | Gate | Onde é aplicado |
|---|---|---|---|---|
| **Perfil de gosto** | heurística `buildTasteProfileHeuristic` | `generateTasteProfile()` LLM | ✅ | `llm_taste_profile` @ `recommendations.ts:220` |
| **Ordenação do ranking** | `expected × personal_fit` | `expected × alignment` (Veredito IA) | ✅ | `smart_shortlist` @ `ranking/page.tsx:161`, `ranking.ts:162` |
| **Recomendar / re-rank** | bloqueado → usa `/ranking` | `match_score` por IA | ✅ | `smart_shortlist` @ `recommendations.ts` (6 sites) |
| **Prever Interesse ♥** | bloqueado → usa Nota Prevista | Interesse ♥ por IA | ✅ (dentro de `smart_shortlist`) | `synopsis-quality.ts:44` |
| **Mood livre no ranking** | não tem | contexto livre ("algo leve hoje") | ⚠️ **chave morta** — efetivo via `smart_shortlist` | `mood_input` nunca é checada |
| **Deep Dive** | não tem | análise 1 obra (extended thinking) | ✅ | `deep_dive` @ `deep-dive.ts:31` |
| **Chat de recomendação** | formulário one-shot / `/ranking` | chat conversacional | ✅ | `chat_recommend` @ `recommendation-chat.ts:244` |
| **Previsão rica (8 critérios qualidade)** | — | — | ⚫ **morto** (`L0_QUALITY_ENABLED=false`, mediu ruído) | `l0_quality_eval` @ `calculations.ts:482` |

**Decisões de plano: essencialmente TRAVADAS.** As 5 features vivas têm as duas opções definidas e gateiam. Ver limpeza das 3 anomalias em §5.

---

## 3. Mapa canônico B — Eixo ADMIN (curadoria do catálogo)

### ✅ Já gated (`ensureAdmin`, 24 ações, verificado)
`createWork` · `createWorkPending` · `createWorksBatch` · `finalizePendingBatch` · `updateWork` · `archiveWork` · `unarchiveWork` · `toggleFavorite` · `setFavoriteMany` · `updateWorkStatus` · `setReadingStatusForWorks` · `deleteWork` · `updateWorkExternalData` · `applySynopsisPredictionAction`(+lote) · `skipSynopsisInterestAction` · `setSynopsisQualityAction` · `checkReadingUpdates` · `startImport` · `addWorksToList` · `triggerRecalcNow` · `applyWeightSuggestions` · `applyPostReadingWeights` · `commitExternalListImport`.

Padrão: gateia o **apply/commit**. Correto — mas incompleto (§4).

### Corretamente SEM gate (dado per-user, não catálogo)
`settings.ts` · `account.ts` · `pilot-taste.ts` · `tag-preferences.ts` · `preference-rules.ts` · `filter-presets.ts` · `post-reading-attributes.ts` · `ai-eval-read.ts` · `settings-read.ts` · `badges.ts` · `compare.ts`. Estes escrevem em tabelas `user_id`-scoped e devem seguir abertos ao usuário.

---

## 4. 🔴 Buracos críticos — o bloqueador do deploy

O gate parou nos *commits*; os *geradores/avaliadores* e várias mutações diretas ficaram abertos. **Todos deveriam ser eixo ADMIN.** Verificado: as 5 estrela (★) não têm nenhum `ensureAdmin`/`ensureCapability` no corpo; **30/42 arquivos de actions não citam gate nenhum**.

### 4a. Gastam IA sem gate → **denial-of-wallet** (roda no saldo do dono)
| Ação | arquivo:linha | Custo aprox. |
|---|---|---|
| ★ `triggerAiEvaluation` | `ai.ts:149` | Sonnet ~$0.05+/obra |
| ★ `generateAllWorkData` | `generate-all.ts:114` | cascata ~$0.13/obra |
| `evaluateCandidateForCreate` | `external.ts:310` | Sonnet |
| `prewarmEvaluationContext` | `ai.ts:410` | fetch externo |
| `inferTagsForWork` / `…Works` | `ai-eval-maintenance.ts:80,97` | Haiku |
| `acquireReviewsForWork` / `…Works` | `ai-eval-maintenance.ts:27,47` | scrape + Sonnet digest |
| `generateWorkReviewDigest` | `review-digest.ts:21` | Sonnet ~$0.02–0.05 |
| `previewCanonicalSynopsis` | `synopsis.ts:10` | Sonnet |
| `refreshEmbeddings` / `…ForWork` | `embeddings.ts:165,254` | API embeddings |
| `runCalibrationAuditAction` / `runBiasReportAction` | `calibration.ts:82,272` | Claude |
| ★ `recommendGroup` | `lists.ts:215` | Claude |
| ★ `proposeFavoriteGroups` | `lists.ts:267` | LLM |

### 4b. Mutam o catálogo compartilhado sem gate → **corrupção**
| Ação(ões) | arquivo:linha |
|---|---|
| ★ `submitAiReview` (commita as 9 notas!) · `skipAiEvaluation` | `ai.ts:445,505` |
| `recalculateAll` + helpers `recalculateScoresNow*` | `calculations.ts:467`, `recalc-queue.ts:87-119` |
| `updatePrimarySynopsis` | `manual-reviews.ts:29` |
| `createExternalManualReview`/`update`/`delete` | `external-manual-reviews.ts:80,107,151` |
| `deleteFetchedReview` | `fetched-reviews.ts:42` |
| `saveWorkSourceSelections` · `revalidateWorkSources` | `external.ts:868,558` |
| `comix-resolver.*` (5 ações: setHid/resolve/start) | `comix-resolver.ts:88,359,399,453,631` |
| `calibration.ts` accept/reject/apply/revert/bulk (7+) | `calibration.ts:408,424,438,453,488,548,591` |
| **`tag-consolidation.ts`** (todas, ~10) | curadoria de tags — 0 gate no arquivo |
| **`tag-subgroups.ts`** (todas, ~12) | curadoria de subgrupos — 0 gate no arquivo |
| `createWorkList` · `updateWorkList` · `deleteWorkList` · `removeWorksFromList` · `addListComment` · `deleteListComment` · `createGroupFromProposal` | `lists.ts:46,67,91,130,165,191,306` |
| `suggestScoreWeights` · `suggestPostReadingWeights` (o *apply* é gated, o *suggest* não) | `weight-suggestions.ts:18`, `post-reading-weight-suggestions.ts:22` |

> Hoje essas só dependem de `useIsAdmin` esconder a UI — que **não é bloqueio** (a server action é chamável direto). Este é o P0 real do deploy.

---

## 5. Reconciliação do `lib/plans/capabilities.ts`

| Item | Estado | Ação recomendada |
|---|---|---|
| `mood_input` | ⚠️ chave morta (0 call-sites) | **Remover** de `PAID_CAPABILITIES` (o gate real é `smart_shortlist`) |
| `l0_quality_eval` | ⚫ morto (`L0_QUALITY_ENABLED=false` global) | **Remover** ou comentar como dormente; não é decisão de plano hoje |
| `planAllows(_cap)` | stub binário (`void _cap`) | Manter — mas documentar que hoje é tudo-ou-nada; só serve `paidOnlyMessage` |
| Ref quebrada "espelha plan-arquitetura-notas.md §4" | ⚠️ §4 não tem tabela free/pago | Trocar o comentário para apontar **este** doc |
| Descrição de `chat_recommend` | ⚠️ diz fallback "one-shot" que também é pago | Corrigir p/ "Free usa o /ranking determinístico" |
| `prever Interesse ♥` / `auto-avaliar` / `sugerir grupos` (spec §1) | sem capability própria | Ver decisões §7 |

---

## 6. Eixo PRODUTO — quotas/limites (futuro, depende da Fase 2)

**Não existe nenhuma primitiva de quota hoje** (0 hits de quota/credits/allowance nas migrations; sem export de dados). Limites existentes são **universais, não por plano**:

| Limite existente | Onde | Hoje |
|---|---|---|
| `MAX_RUNS_PER_DAY = 20` | `recommendations.ts:44` | rate-limit **global**, plano-agnóstico |
| `MAX_COMPARE_WORKS = 10` | `lib/compare-config.ts` | teto universal do drawer de comparação |
| `MAX_CANDIDATES_HARD_LIMIT` | `lib/ai-recommendation/limits.ts` | cap técnico por run |

Candidatas a decisão free/pago **quando a Fase 2 existir** (biblioteca per-user): nº de obras/favoritos, nº de listas/grupos, views do ranking (Bússola/Faixas como premium?), escala do `MAX_COMPARE`, retenção do histórico de recomendações, nº de presets salvos, limite de linhas em import. **Nenhuma é acionável antes da partição per-user** — hoje o catálogo é único e compartilhado.

---

## 7. Decisões em aberto (precisam da sua escolha)

1. **`sugerir grupos` — plano ou admin?** A spec §1 pôs em Free→Pago, mas `proposeFavoriteGroups` (LLM) e `recommendGroup` hoje não têm gate. Como listas viram per-user (Fase 2), o natural é **feature paga** (free adiciona a grupo manual — que já commitamos —, pago ganha sugestão IA). Recomendo: `smart_shortlist` ou nova cap `group_suggest`.
2. **`auto-avaliar obra nova`** — é **curadoria (admin)**, não plano: só o dono cria obra no catálogo compartilhado. Recomendo tratar como admin (o toggle `ai_eval_on_create` já é global). Fecha sozinho quando §4 for gated.
3. **`MAX_RUNS_PER_DAY` vira per-plano?** (ex.: free 5/dia, pago 20/dia) ou fica global? Decisão de produto — só relevante no deploy.
4. **Manter `mood_input`/`l0_quality_eval` no código** como stubs preparatórios, ou remover? Recomendo remover (reduz doc≠código).

---

## 8. Sequência de implementação (pra ficar deploy-ready)

| # | Passo | Eixo | Pri. |
|---|-------|------|------|
| 1 | **Fechar os buracos do §4** — `ensureAdmin` em todas as ações de IA/mutação de catálogo (4a + 4b) | Admin | **P0** |
| 2 | Reconciliar `capabilities.ts` (§5: matar chaves mortas, corrigir descrições/refs) | Plano | P1 |
| 3 | Decidir §7.1 (sugerir grupos) e implementar seu gate | Plano | P1 |
| 4 | Rate-limit por IP/usuário nas ações que gastam IA (denial-of-wallet residual pós-gate) | Infra | **P0** |
| 5 | (Deploy) — só depois de 1+4 | — | — |
| 6 | Quotas de produto (§6) | Produto | P2 — **depende da Fase 2** |

> Passos 1 e 4 são o P0. O 1 é o grosso do trabalho (≈40 ações, mas mecânico — cada uma ganha o mesmo guard `ensureAdmin` das 24 já feitas). O 4 complementa (mesmo o dono logado pode ter a sessão abusada). Só então o app é seguro pra expor.
