# PLANO-MULTIUSER — Fundação multi-user + separação free/pago

> Status: **EM ANDAMENTO** (branch `feat/multiuser-foundation`, iniciado 2026-07-09).
> Contexto: app hoje single-user; alvo = subir no Fly.io multi-user com separação clara free/pago.

## 0. Decisões de produto (travadas)

- **Catálogo COMPARTILHADO**: obras + avaliação intrínseca (os 9 critérios) são um ativo **global curado pelo dono**. Cada usuário personaliza por cima. O maior custo por obra (Avaliação IA) **não escala com usuários free** — é amortizado.
- **Avaliação IA no free = manual/import** (preencher os 9 critérios à mão); pago = auto-avaliação de obra nova.
- **Gating de 3 níveis**: `anon → free → pago → ADMIN/operador` (o tier admin é novo; nasce da decisão do catálogo compartilhado).

### Decisões de arquitetura (confirmadas)

| # | Decisão | Escolha |
|---|---|---|
| **D1** | Provedor de auth | **Supabase Auth** (já usamos Supabase; `auth.uid()` integra com RLS; email/senha + magic link) |
| **D2** | Isolamento | **RLS com client autenticado** para dados per-user; `service role` só pro catálogo global e jobs de curadoria. (Alternativa filtros app-level rejeitada: 1 filtro esquecido = vazamento.) |
| **D3** | Escopo do scoring/calibração | **Per-user com fallback ao modelo global do dono** enquanto o usuário tem <20 rótulos. `taste_profile`/`formula_config` viram per-user; `score_weights` inferidos per-user sobre base global. |

## 1. Classificação free/pago das ações de IA (a spec)

- 🔵 **Free→Pago** (free tem alternativa determinística): perfil de gosto LLM (free=heurística) · recomendar/re-rank Veredito IA (free=ranking determinístico) · prever Interesse ♥ (free=Nota Prevista) · auto-avaliar obra nova (free=manual/import) · sugerir grupos.
- 🟣 **Só Pago**: Deep Dive · Chat de recomendação.
- 🟢 **Admin/operador** (curadoria do catálogo, NÃO eixo de plano): avaliação IA do catálogo · consolidar sinopse · resumo/digest de reviews · inferir/classificar/enriquecer tags · embeddings · calibração · viés · cascade `generate_all` · toggles on-create.
- ⚫ **Interno** (desligar em prod): shadow A/B interesse · `tag_verify` (só script) · `tag_clustering` (órfã).

Já gated hoje (`lib/plans/capabilities.ts`, `ensureCapability`): `llm_taste_profile`, `smart_shortlist` (rec/rerank/interesse), `deep_dive`, `chat_recommend`. **Faltam gates**: auto-avaliar obra nova, sugerir grupos, papel admin p/ curadoria.

## 2. O problema central

~19 colunas **pessoais** moram na linha compartilhada de `works` (favorito, nota do usuário, status/progresso de leitura, notas pós-leitura, interesse, observações). Todas as notas **derivadas do gosto** (`expected_score`, `personal_fit`, `chance_score`, `alignment_*`) vivem em `calculated_scores` com `unique(work_id)` — 1 linha por obra, sem `user_id`. `taste_profile` e `formula_config` são **singletons globais cujo conteúdo é a calibração de UM usuário**. Extrair o pessoal do global é o pré-requisito duro — maior que a auth.

### Tabela de partição (o que move)

**GLOBAL (fica em `works`/tabelas de obra, sem `user_id`):** title, original_title, alternative_titles, canonical_synopsis*, year/year_end, publication_status_id, total_chapters, ai_eval_status, is_archived, review_summary*, review_digest*, reviews_hash, ai_eval_reviews_stale, tags_inferred_at, cascade_status, data_refreshed_at, last_chapter_released_at/next_chapter_predicted_at/chapters_checked_at. Tabelas: `category_scores` (9 critérios), `platform_ratings`, `ai_evaluations`, `ai_evaluation_scores`, `work_covers`, `work_synopses`, `work_external_ids`, `work_reviews`.

**PER-USER (extrair de `works` → nova `user_work_state(user_id, work_id, …)`):** personal_status_id, chapters_read, last_read_at, is_favorite, user_score, observation_adjustment, synopsis_quality, synopsis_quality_source, synopsis_quality_prediction_id, synopsis_interest_skipped, post_story_score, post_fl_score, post_ml_score, post_character_development_score, post_pacing_score, post_art_visual_score, post_impact_immersion_score, post_originality_score, observations.

**PER-USER (adicionar `user_id`):** `calculated_scores` (→ PK `(user_id, work_id)`; conteúdo é derivado do gosto), `taste_profile`, `formula_config` (calibração per-user), `work_lists`, `recommendation_runs`, `deep_dive_results`, `recommendation_chats`, `pilot_taste_scores`, `preference_rules` (hoje jsonb no singleton). `score_weights` inferidos = per-user.

**JÁ per-user (prontos):** `user_tag_preferences`, `ranking_filter_presets`, `prediction_snapshots`, `prediction_ledger`, `user_attribute_assessment`, `attribute_bias`.

## 3. Fases

| Fase | O quê | Tamanho | Dep |
|---|---|---|---|
| **1. Auth + identidade** | Supabase Auth; `middleware.ts` (refresh de sessão); `getCurrentUserId()` da sessão (remove cache singleton global); login/signup/logout; signup cria linha `user_settings` per-user (free) | Médio | — |
| **2. Partição de dados** ⚠️ | `user_work_state` extrai ~19 colunas de `works`; `calculated_scores` +user_id (PK `(user_id,work_id)`); `taste_profile`/`formula_config` per-user; +user_id nas tabelas da §2; backfill tudo → owner; reescrever queries | **Grande (risco)** | 1 |
| **3. Papéis + gates** | `+is_admin`/role em `user_settings`; `ensureAdmin`; 2 gates faltando; curadoria + on-create → admin-only | Peq-Méd | 1 |
| **4. Scoring per-user** | `computeRecalc`/`recalculateAll` por-usuário → `(user_id,work_id)`; recalc **lazy/on-demand**; novo user = stub (barato) | Médio | 2 |
| **5. Isolamento + contabilidade** | RLS por-usuário (client autenticado) nos dados per-user; popular `ai_api_calls.user_id`; rate limits por-usuário | Méd-Grande | 1,2 |
| **6. Deploy Fly.io** | `DEPLOY-FLY.md` (app+FlareSolverr `iad`) + env de auth | Pequeno | 1–5 |

**Atalho que reduz risco da Fase 4:** usuário novo cai em *stub* (sem rótulos → média de treino), então o scoring per-user "só funciona" barato até ele acumular ≥20 ratings.

### Estado das fases — 2026-07-13

- **Fase 1 — ✅ FECHADA.** Supabase Auth, `middleware.ts` (refresh de sessão), login/signup, trigger
  `handle_new_user` (mig 137) criando a linha de `user_settings`, e o **logout** — que era a peça que
  faltava: até o PR #123 o único "Sair" morava dentro de `/account`; agora é um item do menu do chip da
  sidebar, alcançável de qualquer página. Ressalva honesta: `getCurrentUserId()` **ainda tem** o
  fallback de singleton, usado só quando não há sessão — não foi removido, foi contornado (anônimo
  não herda mais a linha do dono).
- **Fase 3 — em grande parte feita** fora deste plano: `user_settings.role` (mig 140) e a escada
  Curador/Assinante/Leitor substituíram o `is_admin`×`user_plan`; gates de admin fechados no PR #115.
- **Fase 2 (partição per-user) segue ADIADA** — é a de risco, e nada desta leva a destravou.
- **Fase 5:** o **rate-limit continua GLOBAL** (não por usuário). É o P0 da área de acesso.

Não há **proteção de rota**: o middleware só refresca a sessão, e visitante anônimo lê o catálogo
(compartilhado por design). Autorização é por **papel**, dentro das actions — não na borda.

## 4. Princípios de execução

- **Não-quebrante durante a migração**: cada passo preserva o app single-user rodando. `getCurrentUserId` prefere sessão e **cai no singleton legado** quando não há sessão.
- **Migrations à mão no SQL editor** (CLI dessincronizado — ver memória `project_migration_apply_mechanism`). Numerar seguindo a última (>136).
- Verificar `tsc`/lint + app rodando a cada incremento.

## 5. Log de progresso

- 2026-07-09: branch `feat/multiuser-foundation` criada; plano registrado.
- 2026-07-09: **Fase 1a ✅** (costura de identidade, não-quebrante):
  - `middleware.ts` + `lib/supabase/middleware.ts` — refresh de sessão Supabase em toda request (padrão @supabase/ssr; sem proteção de rota ainda).
  - `server/queries/current-user.ts` — novo `getSessionUserId()` (memoizado por request via React `cache`, lê `auth.getUser()`, null quando anon/sem-request); `getCurrentUserId()` prefere a sessão e **cai no singleton legado** quando não há sessão. Removido o cache global de módulo (landmine multi-user); mantido só o cache do singleton legado.
  - Verificado: `tsc --noEmit` limpo; dev na :3009 → `/`, `/ranking`, `/catalog` = 200, zero erro/warn no log.
- 2026-07-09: **Fase 1b (superfície de auth) ✅** — ADITIVA, nada desabilitado:
  - `supabase/migrations/137_multiuser_auth.sql` *(PENDENTE aplicar à mão)* — `user_settings.auth_user_id` (nullable; singleton legado = NULL) + índice único parcial + trigger `handle_new_user` que provisiona 1 linha `user_settings` (plano **free**) por novo signup. NÃO toca a linha singleton.
  - `server/actions/auth.ts` — `signInAction`/`signUpAction`/`signOutAction` (Supabase Auth, email/senha; assinatura useActionState).
  - `app/login`, `app/signup` + `components/auth/{login,signup}-form.tsx` — rotas NOVAS, sem link na nav, sem proteção de rota.
  - Verificado: `tsc` 0; dev :3009 → `/login /signup / /curation/settings /account` = 200; sem erro de compilação. (Ruído: 1× "JWT issued at future" no cold boot = clock skew do sandbox no `createAdminClient`, não-recorrente, não é regressão.)
  - **Decisão de escopo (honra "aditivo, não substituir"):** NÃO reescrevi os getters/setters de `user_settings` pra resolução per-user. Continuam no singleton. Consequência conhecida: se o DONO logar, `getCurrentUserId` (Fase 1a) devolve o uid de auth e os dados per-user dele (chaveados no UUID singleton antigo) somem da vista → por isso login **não** está ligado na nav; o dono segue deslogado sem mudança. Novos usuários que se cadastram já nascem com espaço próprio (vazio).
- 2026-07-09: **Redesign das telas de auth ✅** (`7cae2bb`) — /login+/signup dois painéis; `AppShell` (client gate) deixa /login,/signup,/auth full-bleed; hero com cascata de capas REAIS (`server/queries/auth-hero.ts`) + badge nota/status estilo view Cards; card "perfil de gosto" espelhando o perfil real (faixa+peso por critério, tags amadas/evitadas) como prévia; stats reais (obras/critérios/reviews/fontes); input NOME; **Google OAuth** (`signInWithOAuth` + `app/auth/callback`); marca VibeMatch→**SatorIA**. Mig 137 agora grava display_name/avatar do metadata.
- 2026-07-10: **Rewire per-user de `user_settings` ✅ (adiantado da Fase 2)** — corrige "logou e apareceu o mesmo user (dono)". `current-user.ts`: novo `getCurrentUserSettingsRow` (cached, select* WHERE current_user_id=getCurrentUserId; logado-sem-linha→null NÃO vaza; anon→fallback singleton) + `getCurrentUserSettingsId`; getters (plano/perfil/toggles) leem dele. `account.ts` (getSingletonId) + `settings.ts` (7 toggle-setters) escrevem na linha do usuário atual. Aditivo (deslogado=singleton intacto, verificado: /account ainda mostra Ana/dono). Mudança: getCurrentPlan fail-**closed** p/ 'free' (antes 'paid'). FALTA per-user ainda: `preference_rules` (ai-usage=saldo é owner-global, fica).
- **PENDENTE do usuário:** mig 137 APLICADA + Supabase Auth (email/senha + Google) HABILITADO ✅. Testar signup em aba anônima.
- **AVISOS:** (a) DONO deve seguir DESLOGADO até o claim (Fase 2) — logar como si mesmo mostra vazio (dados no UUID singleton antigo). (b) Dados NO NÍVEL DA OBRA (favoritos/notas/Nota Prevista/status leitura em `works`/`calculated_scores`) ainda são COMPARTILHADOS → usuário novo vê os do dono até a partição da Fase 2.
- 2026-07-10: **`user_work_state` (migration 138) ✅ APLICADA pelo user** — nova tabela per-usuário-por-obra com as 19 colunas pessoais + backfill do dono. **DORMENTE**: nada lê dela ainda (a partição completa foi ADIADA — ver decisão abaixo). Aditiva, não toca `works`.
- 2026-07-10: **DECISÃO — stopgap anti-corrupção em vez da partição completa.** O mapa de call-sites mostrou que a partição per-user é ~30 arquivos + 3 RPCs (`find_similar_works`, `find_knn_with_user_score`, `get_sidebar_badge_counts`) + PostgREST nested filter/sort — multi-incremento, alto custo, teste exige 2 sessões. Risco REAL não é o usuário novo VER dados do dono (read-only, vitrine), é as MUTAÇÕES corromperem dados compartilhados (2º user favoritando/avaliando sobrescreve o dono). Stopgap = gate as mutações pro admin (=dono) + esconder UI de operador. Partição completa vira projeto planejado depois.
- 2026-07-10: **Stopgap parte A ✅ (`c6fc010`)** — `current-user.ts`: `isCurrentUserAdmin()` (admin = dono singleton; `getSessionUserId()===null` ∨ `===getSingletonUserId()`; memoizado) + `ensureAdmin()`. `works.ts`: guard `ensureAdmin` em 5 mutações (`toggleFavorite`, `setFavoriteMany`, `updateWorkStatus`, `createWork`, `updateWork`). Verificado: tsc 0; deslogado (admin) rotas 200 + /account mostra o dono. NOTA: admin é code-based (dono deslogado); Fase 3 troca por flag `is_admin` em user_settings (sobrevive ao claim).
- 2026-07-10: **Stopgap parte B ✅ (`7001f62`)** — guard `ensureAdmin` nas demais mutações do catálogo compartilhado (atento ao return shape de cada uma):
  - `works.ts`: `createWorkPending`/`createWorksBatch` (`{_root:[..]}`), `updateWorkExternalData` (`{error:string}`).
  - `synopsis-quality.ts`: `applySynopsisPredictionAction`/`setSynopsisQualityAction`/`skipSynopsisInterestAction` (`{error}`); `applySynopsisPredictionForWorks` (no-op silencioso — sem canal de erro).
  - `lists.ts`: `addWorksToList` (marca `is_favorite`).
  - `post-reading-weight-suggestions.ts`/`weight-suggestions.ts`: `applyPostReadingWeights`/`applyWeightSuggestions` (**throw** — callers têm try/catch→toast).
  - `external-list-import.ts`: `commitExternalListImport` (analyze read-only fica); `imports.ts`: `startImport`.
  - `reading.ts`: `checkReadingUpdates` (escreve total_chapters/publication_status → `[]` p/ não-admin).
  - `recalc-queue.ts`: `triggerRecalcNow` (escreve calculated_scores → **throw**). `recalculateAll` (calculations.ts, server-only) NÃO gateada (scripts/headless/callers já gateados).
- 2026-07-10: **Stopgap adendo B ✅ (`dfe7b0a`)** — lacunas fora da lista §6 mas que mutam works: `archiveWork`/`unarchiveWork`/`deleteWork`/`setReadingStatusForWorks` (`{error}`) + `finalizePendingBatch` (throw). **Todas as 13 mutações de works.ts agora gateadas.**
- 2026-07-10: **Stopgap parte C ✅ (`dab7136`)** — camada de UI (usuário logado não vê os controles de mutação; bloqueio real é server-side). Infra: `server/actions/admin.ts` `getCurrentUserIsAdmin()` + `components/layout/admin-context.tsx` `AdminProvider`/`useIsAdmin()` (1 fetch via `useChromeData`, default `true` = otimista pro dono deslogado, re-sincroniza no chrome-refresh) + wrap no `app/layout.tsx`. Gates: sidebar (seção GERENCIAR + chip Saldo + recalc), mobile-nav (Importar), favorite-cell (coração), work-detail-actions (5 controles), work-table (add empty-state + desfavoritar lote + menu "Gerenciar obra"), ai-evaluation-button (curadoria), app/catalog/page.tsx ("Novo título", gate server-side). Verificado: tsc 0; smoke deslogado (admin) 200 + TODOS os controles visíveis (não inverteu p/ o dono). ⚠️ NÃO runtime-tested com sessão logada não-admin (precisa auth real; gating é client-side). **DEFERIDO** (arquivos do pilot, não tocados p/ não misturar): form de status INLINE na página de detalhe (`post-reading-flow.tsx`, `work-status-form.tsx`) — já bloqueado server-side; rota `/catalog/[id]/edit` por URL direta também é server-blocked.

- 2026-07-10: **Fase 3 (papéis) — flag `is_admin` ✅ código (`f33fbe8`); mig 139 PENDENTE aplicar.** Troca o admin code-based (dono=deslogado) por `user_settings.is_admin`, que sobrevive ao claim (Fase 2). `isCurrentUserAdmin()`: sem sessão→admin (legado); logado c/ coluna presente→flag; coluna ausente/sem-linha→fallback legado (=== singleton). **Fallback-safe** (idêntico antes/depois da mig). `139_user_settings_is_admin.sql`: `add is_admin bool default false` + marca linhas legadas (auth_user_id IS NULL = dono) como admin. Verificado tsc 0 + smoke deslogado (fallback). **PENDENTE user:** aplicar mig 139; validar pós-mig + com sessão logada.

- 2026-07-10: **CLAIM da conta do dono ✅ + `deslogado` deixa de ser admin (`27e2ea0`).** O usuário reivindicou a linha singleton pro `uid` de auth de um email (re-chave `current_user_id`+`user_id` das 8 tabelas per-user via SQL à mão; verificado: user_settings `is_admin=true`, `user_plan=paid`, current=auth uid). **Consequência:** a orientação "DONO usa DESLOGADO" (espalhada neste doc/memória) ficou OBSOLETA — o dono agora usa o app LOGADO. `isCurrentUserAdmin()`: sem sessão → **false** (era true); `AdminProvider` default → **false** (fail-closed). Verificado deslogado: "Novo título"/"Gerenciar obra" ausentes, rotas 200.
- 2026-07-10: **Buracos do path anônimo FECHADOS (`6f60f83`).** `getCurrentUserSettingsRow()` caía na linha singleton do dono p/ requests sem sessão, vazando (a) plano PAID (anon dispararia features pagas no saldo do dono) e (b) perfil/email do dono no account chip. Fix: anon (sem sessão) → **NULL** (plano free, sem perfil); herdam o fix `getCurrentPlan`/`getCurrentUserProfile`/toggles. **Vitrine do catálogo intacta** (vem de `getCurrentUserId`→singleton, separado — anon segue vendo obras/notas/Nota Prevista do dono como showcase). Verificado: /account anon → badge "Free", sem email do dono, rotas 200. Path logado-como-dono inalterado (resolve linha por `current_user_id = sessão`).

## 6. HANDOFF — stopgap concluído; próximo = Fase 3 / partição

**Stopgap B+C ✅ CONCLUÍDO** (commits `7001f62` → `dab7136`). Só o admin (=dono, deslogado) muta o catálogo compartilhado; usuário logado é read-only (server-blocked + UI escondida). Histórico do que foi feito abaixo, mantido como referência:

**B — guards de servidor faltando** (mesmo padrão: `const gate = await ensureAdmin(); if (!gate.ok) return <erro no shape da action>`; importar de `@/server/queries/current-user`):
- `server/actions/works.ts`: `createWorkPending`, `createWorksBatch`, `updateWorkExternalData` (faltaram na parte A).
- `server/actions/synopsis-quality.ts`: as ações que ESCREVEM synopsis_quality* (apply predição, apply-all, override manual, skip toggle). (as `predict*` já têm gate de plano.)
- `server/actions/lists.ts`: add-to-group (marca `is_favorite=true`) + qualquer setter que escreva favorito.
- `server/actions/post-reading-weight-suggestions.ts`: `applyPostReadingWeights` (escreve `works.user_score` em lote); idem `weight-suggestions.ts` `applyWeightSuggestions` (score_weights global).
- `server/actions/external-list-import.ts` + `server/actions/imports.ts`: import escreve works.
- `server/actions/reading.ts`: atualiza total_chapters/publication_status (metadado global).
- `server/actions/calculations.ts` / `recalc-queue.ts`: recalc user-facing (escreve calculated_scores global).
- (recomendações/alignment e AI de curadoria já são plano-gated `smart_shortlist`/paid — verificar, mas provavelmente ok.)
Verificar cada return shape (varia: `{error:string}` vs `{error:{_root:[msg]}}` vs `{error:fieldErrors}`).

**C — esconder UI de não-admin** (passar `isCurrentUserAdmin()` do server → componente, render condicional):
- Chip de **saldo** (`components/layout/balance-chip.tsx`) — esconder p/ não-admin.
- Seção "GERENCIAR" da sidebar (Preferências, Configurações, Avaliação IA, Uso da API IA, Importar) — esconder/gate.
- Controles de edição: toggle de favorito (`work-table.tsx`, titles), form de status (`work-status-form.tsx`), link "editar" (`/catalog/[id]`), "adicionar obra" (`/catalog/new`), botões de curadoria/IA.

**PRÓXIMO (stopgap concluído):**
1. ✅ **Path não-admin validado** (2026-07-10, usuário: "Testes ok") — mutações retornam o erro do `ensureAdmin`/toast; UI sem GERENCIAR/Saldo/controles de edição.
2. ✅ **Fase 3** — flag `is_admin` em `user_settings` (`f33fbe8`, mig 139 APLICADA). `isCurrentUserAdmin()` lê a flag (fallback legado). Sobrevive ao claim.
3. **Partição completa per-user (Fase 2) — ADIADA por decisão de produto** (2026-07-10). Esboço + racional na §7 abaixo.

**Princípios (mantidos):** aditivo, verificar `tsc` + smoke a cada passo; DONO usa DESLOGADO; NÃO misturar com o trabalho de pilot que vive sem-commit na árvore (`components/pilot/*`, `PLANO-ARQUITETURA-NOTAS.md`, etc.) — stage explícito.

## 7. Fase 2 (partição per-user) — esboço + decisão de ADIAR (2026-07-10)

**Decisão:** ADIADA. O stopgap (A+B+C) já impede corrupção (não-admin é read-only). O único efeito que a Fase 2 corrige é cosmético/vitrine: hoje um usuário logado vê os favoritos/notas/Nota Prevista do DONO (compartilhados) em vez do próprio estado (vazio). **Gatilho pra retomar:** quando o produto exigir que cada usuário tenha BIBLIOTECA PRÓPRIA (favoritos/notas/recomendações dele). Enquanto o lançamento for "catálogo curado read-only", o stopgap basta.

**Dimensionamento (mapa de call-sites, 2026-07-10):** ~130 arquivos citam os nomes das colunas; **~60-70 fazem op real de DB.** Refactor de semanas, multi-incremento, teste exige 2 sessões (dono + user free).

| Superfície | Arquivos c/ op DB | Escritores | Migração |
|---|---|---|---|
| `works.<19 pessoais>` → `user_work_state` | ~62 | 8 (works.ts, synopsis-quality.ts, external-list-import.ts, post-reading-weight-suggestions.ts, lists.ts, import/processor.ts, +seeds) | mig 138 ✅ pronta+backfill |
| `calculated_scores` +user_id (PK user,work) | ~30 | 6 (calculations, recommendations, alignment, calibration, import/processor) | nova |
| `taste_profile` per-user | ~24 (`loadCurrentTasteProfile` ×20 sites) | 1 | nova |
| `formula_config` per-user | ~18 | 2 (settings, calculations) | nova |
| `score_weights` per-user | ~9 | 2 (settings, weight-suggestions) | nova |

**RPCs (menos risco que o mapa antigo):** só `find_similar_works` precisa de `user_id` (2 callers: similar-works.ts, deep-dive.ts). `find_knn_with_user_score` MORTA (dropada na mig 099). `get_sidebar_badge_counts` ÓRFÃ (0 callers) + só lê colunas globais → NÃO mexer.

**Pontos de MAIOR risco:** (1) 8 upserts de `calculated_scores` com `onConflict:"work_id"` → `"user_id,work_id"`; (2) `find_similar_works` faz `LEFT JOIN calculated_scores ON work_id` — com PK (user,work) explode em N linhas/obra; (3) PostgREST nested `!inner` + filtro em coluna embutida (`recommendations.ts:371-375` e `:1332-1335`: `.eq("calculated_scores.alignment_stale")` etc.) — não aceita predicado de user_id sem reescrever o relacionamento; (4) `loadCurrentTasteProfile` em ~20 sites com `.eq("is_current",true).limit(1)`; (5) leituras `formula_config .order(updated_at).limit(1)` / `score_weights (is_active)` globais.

**Estratégia não-quebrante (quando for) — acessores + dual-write, virar leitura por feature:**
- **Inc 0** (baixo, ~½ dia): helpers `getUserWorkState/upsertUserWorkState`; os 8 escritores gravam TAMBÉM em `user_work_state` (works.* segue fonte). Zero mudança visível.
- **Inc 1** (ALTO, vários dias): virar LEITURA do estado pessoal feature-por-feature (detalhe→lista/ranking→filas ai-eval→dashboard→recs). Filtros PostgREST → embedded `user_work_state!inner` c/ user_id, ou filtrar/ordenar em memória (já é padrão de vários readers).
- **Inc 2** (médio): parar de escrever em `works.*` (só user_work_state), após todas leituras virarem.
- **Inc 3** (alto, entrelaçado c/ Fase 4): `calculated_scores` +user_id + `find_similar_works` +param user_id.
- **Inc 4** (médio-alto): `taste_profile`/`formula_config`/`score_weights` per-user; propagar userId nos 20 sites; fallback ao modelo do dono quando user <20 rótulos (D3).
- **Inc 5** (baixo): drop das colunas legadas de `works` — só quando tudo verde.

Durante toda a transição, como só o DONO tem linhas, ele vê tudo igual; usuário novo passa a ver o próprio estado (vazio) nas features já viradas. Fase 4 (scoring per-user lazy: user novo = stub barato) vem depois/junto do Inc 3.
