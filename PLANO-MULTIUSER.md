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

## 4. Princípios de execução

- **Não-quebrante durante a migração**: cada passo preserva o app single-user rodando. `getCurrentUserId` prefere sessão e **cai no singleton legado** quando não há sessão.
- **Migrations à mão no SQL editor** (CLI dessincronizado — ver memória `project_migration_apply_mechanism`). Numerar seguindo a última (>136).
- Verificar `tsc`/lint + app rodando a cada incremento.

## 5. Log de progresso

- 2026-07-09: branch `feat/multiuser-foundation` criada; plano registrado.
- 2026-07-09: **Fase 1a ✅** (costura de identidade, não-quebrante):
  - `middleware.ts` + `lib/supabase/middleware.ts` — refresh de sessão Supabase em toda request (padrão @supabase/ssr; sem proteção de rota ainda).
  - `server/queries/current-user.ts` — novo `getSessionUserId()` (memoizado por request via React `cache`, lê `auth.getUser()`, null quando anon/sem-request); `getCurrentUserId()` prefere a sessão e **cai no singleton legado** quando não há sessão. Removido o cache global de módulo (landmine multi-user); mantido só o cache do singleton legado.
  - Verificado: `tsc --noEmit` limpo; dev na :3009 → `/`, `/ranking`, `/titles` = 200, zero erro/warn no log.
- 2026-07-09: **Fase 1b (superfície de auth) ✅** — ADITIVA, nada desabilitado:
  - `supabase/migrations/137_multiuser_auth.sql` *(PENDENTE aplicar à mão)* — `user_settings.auth_user_id` (nullable; singleton legado = NULL) + índice único parcial + trigger `handle_new_user` que provisiona 1 linha `user_settings` (plano **free**) por novo signup. NÃO toca a linha singleton.
  - `server/actions/auth.ts` — `signInAction`/`signUpAction`/`signOutAction` (Supabase Auth, email/senha; assinatura useActionState).
  - `app/login`, `app/signup` + `components/auth/{login,signup}-form.tsx` — rotas NOVAS, sem link na nav, sem proteção de rota.
  - Verificado: `tsc` 0; dev :3009 → `/login /signup / /settings /conta` = 200; sem erro de compilação. (Ruído: 1× "JWT issued at future" no cold boot = clock skew do sandbox no `createAdminClient`, não-recorrente, não é regressão.)
  - **Decisão de escopo (honra "aditivo, não substituir"):** NÃO reescrevi os getters/setters de `user_settings` pra resolução per-user. Continuam no singleton. Consequência conhecida: se o DONO logar, `getCurrentUserId` (Fase 1a) devolve o uid de auth e os dados per-user dele (chaveados no UUID singleton antigo) somem da vista → por isso login **não** está ligado na nav; o dono segue deslogado sem mudança. Novos usuários que se cadastram já nascem com espaço próprio (vazio).
- 2026-07-09: **Redesign das telas de auth ✅** (`7cae2bb`) — /login+/signup dois painéis; `AppShell` (client gate) deixa /login,/signup,/auth full-bleed; hero com cascata de capas REAIS (`server/queries/auth-hero.ts`) + badge nota/status estilo view Cards; card "perfil de gosto" espelhando o perfil real (faixa+peso por critério, tags amadas/evitadas) como prévia; stats reais (obras/critérios/reviews/fontes); input NOME; **Google OAuth** (`signInWithOAuth` + `app/auth/callback`); marca VibeMatch→**SatorIA**. Mig 137 agora grava display_name/avatar do metadata.
- 2026-07-10: **Rewire per-user de `user_settings` ✅ (adiantado da Fase 2)** — corrige "logou e apareceu o mesmo user (dono)". `current-user.ts`: novo `getCurrentUserSettingsRow` (cached, select* WHERE current_user_id=getCurrentUserId; logado-sem-linha→null NÃO vaza; anon→fallback singleton) + `getCurrentUserSettingsId`; getters (plano/perfil/toggles) leem dele. `account.ts` (getSingletonId) + `settings.ts` (7 toggle-setters) escrevem na linha do usuário atual. Aditivo (deslogado=singleton intacto, verificado: /conta ainda mostra Ana/dono). Mudança: getCurrentPlan fail-**closed** p/ 'free' (antes 'paid'). FALTA per-user ainda: `preference_rules` (ai-usage=saldo é owner-global, fica).
- **PENDENTE do usuário:** mig 137 APLICADA + Supabase Auth (email/senha + Google) HABILITADO ✅. Testar signup em aba anônima.
- **AVISOS:** (a) DONO deve seguir DESLOGADO até o claim (Fase 2) — logar como si mesmo mostra vazio (dados no UUID singleton antigo). (b) Dados NO NÍVEL DA OBRA (favoritos/notas/Nota Prevista/status leitura em `works`/`calculated_scores`) ainda são COMPARTILHADOS → usuário novo vê os do dono até a partição da Fase 2.
- **Próximo: Fase 2** — re-chaveamento do dono (claim) + partição `works`→`user_work_state` + `calculated_scores`/`taste_profile`/`formula_config` per-user + `preference_rules` per-user.
