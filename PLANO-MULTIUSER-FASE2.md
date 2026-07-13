# PLANO — Fase 2: partição per-usuário + os 3 papéis

> **Data:** 2026-07-13 · **Papéis:** Curador (adm) · Assinante (premium) · Leitor (free)
> **Base:** `PLANO-MULTIUSER.md` §3 Fase 2 (marcada "Grande (risco)", adiada) — este doc a substitui.
> **Marcação:** ✅ verificado no código/banco hoje · 📊 medido · ⚠️ risco.
>
> Este plano é para **revisão**, não para execução imediata. A ordem importa mais que o conteúdo:
> os bloqueadores da §3 precisam existir **antes** de qualquer usuário real entrar.

---

## 0. O achado que muda tudo

✅ **Hoje um Leitor não consegue marcar um capítulo como lido.** Nem favoritar. Nem dar nota.

`toggleFavorite`, `updateWorkStatus`, `setFavoriteMany` e `setReadingStatusForWorks` são **todos
`ensureAdmin()`** (`server/actions/works.ts`). E têm que ser: essas colunas moram dentro da linha
**compartilhada** de `works` — um Leitor marcando um capítulo estaria escrevendo no catálogo de todo
mundo.

Isso inverte a leitura do problema. A partição não é uma **otimização de arquitetura** para depois;
ela é **a funcionalidade**. Sem ela, o app é somente-leitura para qualquer um que não seja você, e os
papéis Assinante e Leitor não têm o que fazer além de olhar. Com ela, os três papéis passam a existir
de fato.

---

## 1. Premissa corrigida: as obras não têm dono

✅ Verificado no banco: **nenhuma tabela do catálogo tem coluna de dono.** Não existe "obra do
admin". O que existe é uma obra com **lugar para um único leitor**: das 49 colunas de `works`, **19
são pessoais**.

| | Colunas |
|---|---|
| **Leitura/acompanhamento** | `is_favorite`, `personal_status_id`, `chapters_read`, `last_read_at` |
| **Suas notas** | `user_score`, `observation_adjustment`, `observations` |
| **Interesse (♥)** | `synopsis_quality`, `synopsis_quality_source`, `synopsis_quality_prediction_id`, `synopsis_interest_skipped` |
| **Pós-leitura** | os 8 `post_*_score` |

**O objetivo não é dar dono às obras — é o contrário:** manter o catálogo **sem dono** (é isso que o
papel Curador significa) e **arrancar o estado pessoal de dentro dele**.

📊 A proporção favorece o projeto: ~62 mil linhas do banco são **fatos sobre a obra** (`work_reviews`
14k, `work_tags` 32k, `category_scores` 7.9k, `platform_ratings` 5.6k, `work_covers` 2.3k,
`ai_evaluations` 2.1k) e **não precisam de dono**. O que precisa ser partido são ~880 linhas de estado
pessoal + ~880 de scores. **O banco é a parte pequena. O rewire é a parte grande.**

---

## 2. Os 3 papéis — e o verbo que falta

✅ Os papéis no código são **Curador / Assinante / Leitor** (`lib/plans/roles.ts`, escada com ranks
2/1/0), não adm/premium/free. Os 5 verbos de hoje:

| Permissão | Leitor | Assinante | Curador |
|---|---|---|---|
| `refresh_work` — re-hidratar obra das fontes | ✗ | ✓ | ✓ |
| `consume_ai` — recomendar, chat, deep dive, perfil | ✗ | ✓ | ✓ |
| `curate_work` — criar/editar/apagar obra, capa, sinopse | ✗ | ✗ | ✓ |
| `curate_ai` — IA que **escreve** no catálogo | ✗ | ✗ | ✓ |
| `global_config` — pesos, fórmula, saldo | ✗ | ✗ | ✓ |

⚠️ **Falta o verbo mais básico: `own_state`** — *escrever o próprio estado sobre uma obra*
(favoritar, status, capítulo lido, nota, pós-leitura, interesse). Ele não existe porque hoje esse
estado **é** o catálogo. É o verbo que a Fase 2 cria, e ele começa no **Leitor**:

| Novo verbo | Leitor | Assinante | Curador |
|---|---|---|---|
| `own_state` — seu estado sobre uma obra (`user_work_state`) | **✓** | ✓ | ✓ |
| `own_scores` — ter modelo/notas previstas próprias | **✓*** | ✓ | ✓ |

\* Ver §8: para o Leitor o modelo próprio é **barato mas não grátis**. Duas opções de produto na §8.3.

⚠️ **Dois sistemas de permissão coexistem hoje:** `roles.ts` (verbos, novo) e
`lib/plans/capabilities.ts` (free/paid, legado). Só `refresh_work` migrou; a IA de consumo ainda
passa por `ensureCapability(...)` → `getCurrentPlan()`. `consume_ai` está **declarada e nunca usada**.
Unificar os dois é pré-requisito de sanidade (§9, Etapa 4) — senão a Fase 2 herda duas fontes de
verdade sobre quem pode o quê.

---

## 3. ⚠️ Bloqueadores P0 — antes de QUALQUER usuário real

Estes não dependem da partição e **não podem esperar por ela**. Hoje eles são inofensivos porque só
existe um usuário. No dia em que existir um segundo, viram vazamento e prejuízo.

### 3.1 O visitante anônimo escreve **como se fosse você**

✅ `getCurrentUserId()` (`server/queries/current-user.ts:55-59`), sem sessão, cai no **singleton** —
a linha mais antiga de `user_settings`, que é a sua. Combinado com actions **sem gate nenhum**, um
anônimo grava nas **suas** linhas:

| Action | O que um anônimo faz hoje |
|---|---|
| `savePreferenceRules` (`preference-rules.ts:44`) | sobrescreve **suas** regras de recomendação (tem um `getSingletonId()` local — pior ainda) |
| `submitPostReadingAttributes` (`post-reading-attributes.ts:24`) | corrompe **sua** calibração (`attribute_bias`) e dispara recalc |
| `saveTagPreferences` (`tag-preferences.ts:42`) | apaga e reescreve **suas** tags amadas/evitadas |
| `saveFilterPreset` / `rename` / `delete` (`filter-presets.ts`) | mexe nos **seus** presets |
| `capturePredictionForFirstRating` (`prediction-ledger.ts:29`) | escreve no **seu** ledger |
| `savePilotTaste` (`pilot-taste.ts:13`) | `pilot_taste_scores` **não tem `user_id`** — é global |
| 7 toggles de custo (`settings.ts:183-308`) | ligam gasto de LLM na criação de obra, **sem `ensureAdmin`** |
| `recalculateAll` (`calculations.ts:467`) | regrava `calculated_scores` do catálogo inteiro, **sem gate** |

**Correção (P0):** `getCurrentUserId()` **para de cair no singleton**. Sem sessão → sem `user_id` →
as actions per-user recusam com "entre para continuar". Toda action da tabela acima ganha
`ensurePermission("own_state")` ou `ensureAdmin()`, conforme o caso. Lembre que `"use server"` = **endpoint
HTTP público**: esconder o botão não protege nada.

### 3.2 O rate-limit é global — e furado

✅ `MAX_RUNS_PER_DAY = 20`, e `getRunsToday()` (`server/queries/recommendations.ts:1058`) conta
**sem `.eq("user_id", …)`** — a tabela `recommendation_runs` **nem tem** a coluna. Consequências:

1. **É um teto de 20 runs/dia para o app inteiro.** Um usuário esgota a cota de todos.
2. **Cinco re-ranks checam o teto mas nunca gravam run** (`rerankSingleWork`, `rerankStaleBatch`,
   `rerankWorksBatch`, `rerankCluster`, `rankSpecificWorksForChat`) → enquanto ninguém rodar 20
   recomendações completas, **re-rank é ilimitado**, e cada um é ≥1 chamada de LLM.
3. **`deepDiveWorkAction` e `sendChatMessageAction` não checam nada** — e deep dive usa *extended
   thinking*, o mais caro do app.
4. ✅ **`ai_api_calls.user_id` é sempre `NULL`** — a coluna existe, nenhum call site preenche. **Hoje é
   impossível saber quanto cada usuário gastou** — e, portanto, impossível cobrar ou cotar.

**Correção (P0):** `+user_id` em `recommendation_runs`; contar por usuário; **todo** consumo de LLM
(re-rank, deep dive, chat) grava run; preencher `ai_api_calls.user_id` em todos os call sites; cota
diária **por papel** (ex.: Leitor 0 · Assinante N · Curador ∞).

> Este é o item que separa "multi-user" de **denial-of-wallet**: sem ele, um estranho gasta o **seu**
> saldo da Anthropic.

### 3.3 Vazamento já plantado no recalc

⚠️ `recalculateAll` chama `getBiasMap(userId)` com o usuário **corrente** e grava o resultado nas
linhas **globais** de `calculated_scores` (`calculations.ts:472`). Hoje é inofensivo (só há você).
Com dois usuários, **o recalc de um contamina as notas do outro** — e não dá erro.

---

## 4. Desenho de dados: o que é seu, o que é do catálogo

### 4.1 A descoberta contraintuitiva

⚠️ **`calc_score`, `ia_eval` e `ia_eval_normalized` NÃO são objetivos.** Parecem — são "a nota da IA"
e "a nota calculada". Mas quando `formula_config.score_weights_auto = true` (**default** desde a
migration 069), os pesos usados são **inferidos por Ridge contra o SEU `user_score`**
(`calculations.ts:847-869`). Ou seja: já hoje essas três colunas são função do seu gosto. Elas vão
para o lado **per-usuário** — tratá-las como catálogo compartilhado seria servir o seu gosto a
estranhos com cara de fato objetivo.

### 4.2 Tabela por tabela

| Tabela | Hoje | Vira |
|---|---|---|
| `works` (882) | 19 colunas pessoais embutidas | **catálogo puro** — colunas pessoais dropadas (por último) |
| `user_work_state` (878) | ✅ existe (mig 138), **DORMENTE** — zero leitores | **a fonte de verdade** do estado pessoal |
| `calculated_scores` (882) | `UNIQUE (work_id)`, global | **quebra em duas** (ver 4.3) |
| `formula_config` (1) | singleton, mistura 3 coisas | **quebra em duas** (ver 4.4) |
| `taste_profile` (20) | **sem `user_id`**; índice único global em `is_current` ⚠️ | `+user_id`; único vira `(user_id, is_current)` |
| `score_weights` | global (`slug UNIQUE`) | default global **+** override per-user |
| `work_lists` / `work_list_items` (3) | sem dono | `+user_id` |
| `recommendation_runs` (20) | sem dono | `+user_id` (também exigido pelo §3.2) |
| `pilot_taste_scores` | sem dono | `+user_id` |
| `synopsis_quality_predictions` | previsão do **seu** interesse | `+user_id` |
| `category_scores` (7.9k), `platform_ratings` (5.6k), `work_tags` (32k), `work_covers` (2.3k), `work_reviews` (14k), `ai_evaluations` (2.1k) | compartilhadas | **ficam exatamente como estão** |
| `attribute_bias`, `user_tag_preferences`, `user_attribute_assessment`, `ranking_filter_presets`, `prediction_ledger`, `prediction_snapshots`, `user_settings` | ✅ já têm `user_id` | nada a fazer |

### 4.3 `calculated_scores` → duas tabelas

Separar por **natureza**, não por conveniência:

**`work_catalog_scores`** (global, 1 linha/obra) — o que é fato da obra:
`total_votes`, `platform_avg`, `chapters_normalized`.

**`user_work_scores`** (PK `(user_id, work_id)`) — o que é função do seu gosto:
`expected_score`, `expected_baseline`, `expected_quality_adj`, `expected_is_stub`, `calc_score`,
`ia_eval`, `ia_eval_normalized`, `personal_fit`, `personal_fit_percentile`, `chance_score`,
`chance_is_stub`, `tag_overlap_net`, `alignment_*`.

> 📊 De quebra, mata um desperdício atual: `mae_calc`/`rmse_calc` são **métricas globais repetidas nas
> 882 linhas**. Com N usuários viraria 882×N cópias do mesmo número. Elas vão para o config
> per-usuário (4.4), onde já deviam estar.

### 4.4 `formula_config` → duas tabelas

O singleton mistura três coisas com donos diferentes:

**`user_model_config`** (per-usuário) — **calibrado contra os seus rótulos**: `mae_*`, `rmse_*`,
`cv_mae_expected_stage1`, `expected_ridge_coefficients` (+ `calcBlendWeight`, `cvSig`),
`score_weights_inferred`, `score_weights_auto`, `recalc_pending`, `recalc_last_edit_at`.

**`catalog_config`** (global, Curador) — constantes do catálogo: `pseudo_votes_nota_m`,
`pseudo_votes_blend`, `gpt_clamp_hit_rate`, `top_n`, cores/limiares de UI.

⚠️ **`gpt_mean` é uma armadilha:** parece constante do catálogo, mas é a média com **pesos
calibrados no seu gosto** → é per-usuário. Deixá-lo no config global faz o gosto de um vazar no
centro de normalização de todos.

⚠️ **O cache `cvSig` mora no singleton.** Se não virar per-user, cada usuário sobrescreve a
assinatura do outro e o cache **thrasha** — todo recalc paga os ~550ms da nested-CV.

---

## 5. Migrations (aditivas, na ordem)

Nenhuma dropa nada. O drop das colunas legadas de `works` é a **última** migration, depois de tudo
verde. Aplicar à mão no SQL editor (o CLI está dessincronizado — ver memória do projeto).

| # | O quê | Nota |
|---|---|---|
| **141** | `+user_id` em `recommendation_runs`, `work_lists`, `pilot_taste_scores`, `synopsis_quality_predictions` + backfill → dono | destrava o P0 do rate-limit |
| **142** | `+user_id` em `taste_profile`; **dropar** `taste_profile_current_unique`; recriar como `UNIQUE (user_id, is_current) WHERE is_current` | ⚠️ hoje existe **um** perfil "current" no banco inteiro |
| **143** | `user_model_config` (per-user) + `catalog_config` (global); backfill do `formula_config` atual → dono | `formula_config` fica de pé até o rewire terminar |
| **144** | `work_catalog_scores` + `user_work_scores`; backfill de `calculated_scores` → dono | `calculated_scores` fica de pé (aditivo) |
| **145** | `score_weights_user` (override per-user) | default global continua |
| **146** | **Re-backfill de `user_work_state`** a partir de `works` | ⚠️ o backfill de 138 está **velho**: nada escreve nela desde então |
| **147** | RLS nas tabelas per-user (ver §6) | |
| **148** | **DROP** das 19 colunas pessoais de `works`; drop de `calculated_scores` e `formula_config` | **só quando tudo estiver verde** |

⚠️ **A 146 é a mais perigosa e a mais fácil de errar.** Ela precisa rodar **no momento do corte**,
não antes — e o `select` do Supabase **corta em 1000 linhas sem avisar** (são 882 obras hoje;
qualquer crescimento e um backfill "bem-sucedido" processaria um recorte). Paginar ou confirmar com
`count: "exact"`.

---

## 6. RLS: onde ela protege de verdade

⚠️ **Hoje a RLS não protege nada — e isso é intencional.** Todo acesso usa a **service role key**,
que **ignora RLS** por definição (`createAdminClient()`). As policies existem "sem policy permissiva"
só para bloquear o cliente anônimo, que o app não usa.

No dia em que os dados forem partidos, o isolamento entre pessoas passa a depender de você **lembrar**
de escrever `.eq("user_id", …)` em cada query. Esquecer **não dá erro** — devolve os dados de outra
pessoa. É a mesma assinatura de falha do `select` de 1000 linhas: **erra e produz resultado**.

**Proposta — dois clientes, dois papéis:**

| Cliente | Usa | Alcança |
|---|---|---|
| `createAdminClient()` (service role) | catálogo (`works`, `category_scores`, tags, capas, reviews) e escrita de curadoria | ignora RLS — é o Curador |
| `createClient()` (sessão do usuário) | **tudo que é per-user** (`user_work_state`, `user_work_scores`, `user_model_config`, `taste_profile`, listas…) | RLS `using (user_id = auth.uid())` |

Assim o **Postgres** filtra por você, em vez de você lembrar de filtrar. O custo é real: as queries
per-user precisam do cliente autenticado, e algumas hoje são chamadas de contextos sem sessão (jobs,
recalc). Para esses, a service role continua — mas com `user_id` **explícito no argumento**, nunca
implícito no "usuário corrente".

---

## 7. O rewire: 125 arquivos

✅ Medido: **125 arquivos** leem/escrevem as colunas pessoais.

| Área | Arqs | Natureza |
|---|---|---|
| `server/queries` | 18 | leitura — `works.ts`, `ranking.ts`, `recommendations.ts`, `dashboard.ts`, `calibration.ts`, `reading.ts`, `favorites.ts`, `lists.ts`… |
| `server/actions` | 13 | **escrita** — `works.ts`, `synopsis-quality.ts`, `calculations.ts`, `reading.ts`… |
| `components/titles` | 10 | forms + células |
| `lib/ai-recommendation` | 7 | leitura (`user_score` no perfil/prompts) |
| `lib/synopsis-interest` | 5 | leitura |
| `lib/orchestration` | 4 | leitura em massa |
| `lib/import` | 4 | **escrita em massa** |
| `lib/calculations` + `lib/ml` | 7 | funções puras (recebem os valores) — **baratas de migrar** |
| `components/*` (ranking, settings) + `app/*` | ~30 | render |
| `scripts/` | ~25 | diagnóstico (leitura) + **4 cópias divergentes** do `seed-from-xlsx` |

### ⚠️ As mutações em massa — os pontos onde um erro estraga a biblioteca inteira

| Onde | O que faz |
|---|---|
| `applyPostReadingWeights` (`post-reading-weight-suggestions.ts:79`) | **reescreve `user_score` de até 2000 obras** — o mais perigoso do repo |
| `applySynopsisPredictionForWorks` (`synopsis-quality.ts:170`) | sobrescreve `synopsis_quality` de N obras |
| `setFavoriteMany` / `setReadingStatusForWorks` / `addWorksToList` | bulk por `.in("id", ids)` |
| `processRows` (`lib/import/processor.ts`) e `commitExternalListImport` | **criam obras com estado pessoal embutido no INSERT** — precisam separar payload de catálogo × payload pessoal |
| `scripts/seed-from-xlsx.js` (+ ` 4/5/6.js`) | 4 cópias divergentes do mesmo seeder |

**Ordem do rewire (por área, atrás de um flag de leitura):**

1. **Camada de acesso** — criar `server/queries/user-work-state.ts` (o único lugar que sabe de onde o
   estado vem). Fase de transição: **lê de `user_work_state`, com fallback para `works`**.
2. **Escritores primeiro, não leitores.** Todo writer passa a escrever **nos dois lugares**
   (`works` + `user_work_state`) — dual-write. Isso **para a hemorragia**: hoje o espelho já nasce
   velho a cada edição.
3. **Leitores por área:** `queries` → `actions` → `components` → `scripts`.
4. **Imports e seeds** — separar os dois payloads.
5. **Drop das colunas** (mig 148) só quando nenhum grep encontrar `works.user_score` & cia.

---

## 8. Scoring per-usuário — a bomba de custo

### 8.1 O problema estrutural

⚠️ **`recalculateWork(workId)` não existe mais** — foi removido; só sobrou `recalculateAll()`, que
recalcula **até 2000 obras** e é disparado 1h (debounce) depois de qualquer edição. Não existe
caminho incremental. Multiplicado por N usuários: **recalc full do catálogo × N**.

📊 Custos medidos hoje (por execução): nested-CV honesta ~550ms · UPDATE do `formula_config` ~450ms ·
upsert de ~2000 linhas · **custo de LLM: zero** (é tudo CPU/DB).

### 8.2 ⚠️ A faixa 30–49 rótulos é a MAIS cara — e é onde todo usuário novo vai morar

Três lugares caem em **LOOCV** (`folds = n`) quando `n < 50`: `expected.ts:279`, `expected.ts:418`,
`calculations.ts:355`. Como a CV honesta exige `n ≥ 30`, o usuário com **30–49 rótulos** cai em
**LOOCV aninhado**: para cada um dos `n` folds ele re-infere pesos, reconstrói o perfil e re-treina o
Ridge (que roda `fitRidgeCV` com 9 alphas). Ordem de **~n² × 9** solves.

O "atalho" do `PLANO-MULTIUSER.md` ("usuário novo cai em stub → é barato") **está certo só até 29
rótulos**. Depois disso, estoura — exatamente na fase de adoção. **Corrigir o regime LOOCV para k-fold
fixo é pré-requisito de multiplicar por N.**

### 8.3 O desenho que derruba o custo

Separar `computeRecalc` em duas camadas:

- **(a) Camada objetiva do catálogo — 1× para todos:** percentis de votos (`pseudoVotes*`),
  `realGlobalMean` (prior bayesiano), `platform_avg`, `chapters_normalized`. Hoje isso é recalculado
  **dentro** de cada `computeRecalc` — em multiuser seria N vezes o mesmo número.
- **(b) Camada de gosto — por usuário, lazy:** pesos, Ridge, perfil, Chance, fit.

Isso muda a escala de `O(users × works)` para `O(works) + O(users × works_previstas)`.

**Ainda assim, prever 2000 obras por usuário é caro.** Três opções de produto para o **Leitor**:

| Opção | O que o Leitor vê | Custo |
|---|---|---|
| **A. Lazy + escopo** (recomendada) | modelo próprio, mas previsto só para as obras que ele **vê** (top-N do ranking + as que tocou) | baixo, e cresce com o uso real |
| **B. Stub honesto** | sem Nota Prevista até ter 20 rótulos; vê só a nota do catálogo | ~zero |
| **C. Modelo completo** | igual ao Curador | 2000 linhas × N + Ridge × N |

A opção **A** é a que respeita o que os números dizem: o Leitor não olha 2000 obras — ele olha ~50.

---

## 9. Ordem de execução

| Etapa | O quê | Bloqueia? | Tamanho |
|---|---|---|---|
| **1. P0 — segurança** (§3.1) | matar o fallback singleton para anônimo; gatear as 8+ actions ungated | **sim — antes de qualquer usuário real** | P |
| **2. P0 — custo** (§3.2) | `+user_id` em `recommendation_runs`; cota por papel; todo consumo de LLM grava run; `ai_api_calls.user_id` | **sim — denial-of-wallet** | P–M |
| **3. Fix do LOOCV** (§8.2) | k-fold fixo na faixa 30–49 | antes de multiplicar por N | P |
| **4. Unificar permissões** (§2) | matar `capabilities.ts`; tudo vira verbo em `roles.ts`; criar `own_state` | antes do rewire | P–M |
| **5. Migrations 141–147** (§5) | aditivas, nada quebra | — | M |
| **6. Dual-write** (§7, passo 2) | writers escrevem em `works` **e** `user_work_state` | — | M |
| **7. Rewire dos leitores** | por área, atrás de flag | — | **G** |
| **8. Scoring em 2 camadas** (§8.3) | catálogo 1× + gosto lazy per-user | — | **G** |
| **9. Migration 148** | drop das colunas legadas | último | P |

**Etapas 1–4 são independentes da partição e valem por si.** Se a Fase 2 for adiada de novo, elas
**não devem ser** — são as que impedem prejuízo e vazamento.

---

## 10. ⚠️ O que NÃO fazer

1. **Não dar `user_id` a `works`.** É a intuição errada: cria catálogos duplicados, mata a curadoria
   compartilhada e multiplica 62 mil linhas de fatos objetivos por usuário.
2. **Não confiar no backfill de `user_work_state` que já existe.** Ele é de 138 e **nada escreve nela
   desde então** — está velho. Refazer no corte (mig 146).
3. **Não fazer o drop das colunas de `works` junto com o rewire.** Aditivo primeiro, drop por último;
   senão não há rollback.
4. **Não confiar em `select` sem paginação em nenhum backfill.** Corta em 1000 linhas **sem avisar** —
   e o erro **produz resultado**.
5. **Não deixar a RLS para "depois".** Depois = a primeira query sem `.eq("user_id")` servindo os
   dados de outra pessoa, em silêncio.

---

## 11. Estimativa honesta

| Bloco | Tamanho |
|---|---|
| Etapas 1–4 (P0 + fixes) | **P–M** — dias, não semanas. **Alto valor isolado.** |
| Migrations 141–147 | **M** — o SQL é direto; o cuidado é no backfill |
| Dual-write + rewire (125 arquivos) | **G** — é aqui que mora o risco e o tempo |
| Scoring em 2 camadas | **G** — mexe no coração do produto (as notas) |

**A recomendação:** fatiar. Fazer **1–4 agora** (valem sozinhas, protegem o que existe), e só então
decidir se a partição inteira se justifica — que é uma pergunta de **produto** ("vai mesmo entrar
gente?"), não de engenharia.
