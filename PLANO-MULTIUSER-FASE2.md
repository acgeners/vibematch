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
| `uploadAvatar` (`account.ts`) | sobe a imagem na **sua pasta** no storage |
| `savePilotTaste` (`pilot-taste.ts:13`) | `pilot_taste_scores` **não tem `user_id`** — é global |

✅ **FEITO** (PR #127). Todas exigem **sessão** (`ensureSignedIn()`) e usam o `user_id` **da sessão**.
Gate de papel não resolveria: o papel do anônimo é `leitor`, e leitor tem `own_state` — o que lhe
falta não é permissão, é **identidade**. `savePilotTaste` é a exceção (tabela global → `ensureAdmin`).

📊 **Confirmado na prática, não só na leitura do código.** Um POST anônimo em `savePreferenceRules`
(sem cookie, sem browser, sem botão — o id da action sai do bundle do cliente) **apagou as 7 regras de
preferência do dono e as substituiu pela regra do atacante**, na `main`. Com o fix: HTTP 200 com
`"Entre na sua conta para fazer isso."` e as 7 regras intactas.

⚠️ **Duas correções à auditoria original deste plano** (ambas verificadas):
- **`recalculateAll` NÃO é um endpoint.** `server/actions/calculations.ts` **não é** `"use server"` (o
  arquivo o diz na 1ª linha: exporta funções puras síncronas, o que Server Actions proíbem). Não há
  buraco aqui. E gatear com `ensureAdmin()` seria um **erro**: o recalc roda em background (fila,
  `after()`, cascatas) **sem sessão** — o gate daria `false` e quebraria o app do dono.
- **Os 7 toggles de custo (`settings.ts`) já estavam seguros.** Escrevem via
  `getCurrentUserSettingsId()` — a linha **própria** —, então anônimo recebe erro e um Leitor só muda
  os toggles dele (que só têm efeito na criação de obra, que ele não pode fazer). O código já
  raciocina sobre isso em `settings.ts:21-24`.

**O que NÃO mudou, de propósito:** `getCurrentUserId()` **mantém** o fallback singleton na **leitura**.
O recalc precisa do `biasMap` do dono em background; sem o fallback ele recalcularia as notas dele
**sem a calibração dele**, em silêncio. O que mudou é que nenhuma **escrita** passa mais por ele.

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

✅ **FEITO** (PR #127) — e o desenho mudou durante a implementação, para melhor:

**A cota é em DÓLARES, não em "runs".** Contar runs obrigaria cada feature nova a lembrar de se
registrar — foi exatamente assim que os 5 re-ranks, o deep dive e o chat ficaram de fora. Dólar é a
unidade do risco e cobre tudo de uma vez, porque **toda** chamada de LLM passa por `ai_api_calls`.

- `server/queries/ai-quota.ts`: teto de gasto em 24h por papel — **Leitor US$0 · Assinante US$2 ·
  Curador ∞** (o curador é o dono do saldo e roda backfills em lote; um teto quebraria trabalho
  legítimo).
- `ensureAiConsumption()` = permissão **+** cota, num gate único, nos 12 call sites. Não há como
  passar num e esquecer o outro.
- `ai_api_calls.user_id` é resolvido no **ponto único** por onde toda chamada passa
  (`anthropic-client`), não em ~30 call sites.
- Gerar perfil de gosto acima da cota **degrada pro heurístico** (zero LLM) em vez de dar erro.
- A soma do gasto é **paginada** — o `select` corta em 1000 linhas sem avisar, e truncar aqui daria
  um gasto **subestimado**: a trava falharia em silêncio justamente quando mais importa.

📊 **Verificado no app rodando:** Leitor → botão de IA desabilitado. Assinante dentro da cota → passa.
Assinante com US$99 de gasto injetado → o servidor **nega** ("Cota diária de IA do plano Assinante
atingida (US$ 2.00 em 24h)") e **zero** chamadas de LLM são cobradas — o gate barra **antes** do modelo.

✅ **Migration 141 APLICADA** (2026-07-13). Conferido no banco: a coluna existe e as 20 runs do
histórico foram backfilladas para o dono (20/20). A contagem de runs passou a ser de fato por usuário.

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
| ✅ **141** | `+user_id` em `recommendation_runs` + backfill → dono | **APLICADA** (2026-07-13; 20/20 runs backfilladas). Ficou focada só nesta tabela — `work_lists`, `pilot_taste_scores` e `synopsis_quality_predictions` **seguem sem `user_id`** e entram numa migration da partição (elas não bloqueavam o P0 da cota) |
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

## 6. ✅ RLS: onde ela protege de verdade — FEITO (PR #129, mig 142)

✅ **FEITO em 2026-07-13** (migration 142 + PR #129): as 9 tabelas com dono têm política; as ESCRITAS per-user passam pelo cliente de sessão, e é o Postgres que garante o isolamento. As LEITURAS de background seguem na service role de propósito (o recalc roda sem sessão). Contexto de antes:

⚠️ ~~**Hoje a RLS não protege nada — e isso é intencional.**~~ Todo acesso usa a **service role key**,
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

### 8.2 ✅ A faixa 30–49 rótulos era a MAIS cara — e é onde todo usuário novo vai morar

Três lugares caem em **LOOCV** (`folds = n`) quando `n < 50`: `expected.ts:279`, `expected.ts:418`,
`calculations.ts:355`. Como a CV honesta exige `n ≥ 30`, o usuário com **30–49 rótulos** cai em
**LOOCV aninhado**: para cada um dos `n` folds ele re-infere pesos, reconstrói o perfil e re-treina o
Ridge (que roda `fitRidgeCV` com 9 alphas). Ordem de **~n² × 9** solves.

O "atalho" do `PLANO-MULTIUSER.md` ("usuário novo cai em stub → é barato") **está certo só até 29
rótulos**. Depois disso, estoura — exatamente na fase de adoção.

✅ **FEITO** (PR #127): passou a `Math.min(5, n)` nos três lugares. **Não muda nenhuma nota hoje** — o
dono tem **208 rótulos** (conferido no banco), então `n ≥ 50` e o ramo LOOCV já estava morto para os
dados atuais. A correção protege o usuário futuro, **antes** de multiplicar por N.

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
| ✅ **1. P0 — segurança** (§3.1) | escrita per-user exige sessão; 7 actions fechadas | — | **FEITO** (PR #127) |
| ✅ **2. P0 — custo** (§3.2) | cota de IA **em US$** por papel; `ai_api_calls.user_id`; mig 141 | — | **FEITO** (PR #127, mig 141 aplicada) |
| ✅ **3. Fix do LOOCV** (§8.2) | k-fold fixo (`Math.min(5, n)`) | — | **FEITO** (PR #127) |
| ✅ **4. Unificar permissões** (§2) | `capabilities.ts` apagado; verbo `own_state` criado | — | **FEITO** (PR #127) |
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

---

## 12. A pergunta de produto já foi respondida — pelo banco

> **Atualização 2026-07-13.** Etapas 1–4 ✅ (PR #127) · RLS ✅ (PR #129, mig 142).

📊 **Já existe um segundo usuário real:** `ana.generoso22@gmail.com`, papel **Leitor** (encontrado no
`user_settings` durante o trabalho de RLS). E ela **não consegue fazer nada**: não marca capítulo
lido, não favorita, não dá nota — porque todos esses writers são `ensureAdmin()`, e têm que ser (§0).

Ou seja: existem três papéis, uma cota de IA por papel e RLS no banco — e a única usuária além do
dono é **uma espectadora**. Todo o trabalho das etapas 1–4 e da RLS **só vira produto** quando o
estado pessoal sair de dentro da obra.

---

## 13. FATIA 1 — o estado de leitura per-usuário

A menor fatia que transforma a Leitora de espectadora em usuária. **Não** é a Fase 2 inteira: não
mexe em notas, nem em scoring, nem nos 8 `post_*`.

### 13.0 ⚠️ ANTES DE COMEÇAR: backup — e o que ele NÃO cobre

O projeto está no **plano Free**: **backup nenhum** (`pitr_enabled: false`, zero backups — conferido na
Management API). O Pro (US$25/mês) daria backup diário com schema; o PITR é add-on de **US$100/mês**
(não vem no Pro). **Decisão tomada: seguir no Free.** Logo, a rede é esta:

```bash
node scripts/backup-db.mjs     # → .backups/<timestamp>/  (~24 MB, ~120k linhas)
```

⚠️ **Ele salva DADOS, não a casa onde eles moram.** O que fica de fora:

| Fora do backup | Por que importa |
|---|---|
| **Schema** (tabelas, índices, triggers, as políticas de RLS da mig 142, a função `guard_role_self_escalation`) | E a pasta `supabase/migrations/` **não reconstrói o banco** (5 números colididos) |
| **`auth.users`** | O script lê só o schema `public` — os logins não estão no dump |
| Objetos do Storage (avatares) | Só os metadados, que ficam no banco |

**Consequência direta no plano:** enquanto não houver dump de schema, **nada de `DROP COLUMN`** — ver
§13.4. Um `pg_dump --schema-only` resolve de graça, mas exige a senha do banco (Supabase → Project
Settings → Database → Connection string).

### 13.1 Escopo — só o estado de LEITURA

| Coluna de `works` | Vai para `user_work_state` |
|---|---|
| `is_favorite` | ✓ |
| `personal_status_id` | ✓ |
| `chapters_read` | ✓ |
| `last_read_at` | ✓ |

**Fora desta fatia** (ficam em `works` por enquanto): `user_score`, `observation_adjustment`,
`observations`, os 8 `post_*_score`, `synopsis_quality*`. Elas alimentam o **scoring**, e mexer nelas
arrasta o Ridge, o `calculated_scores` e o `formula_config` junto — é a Fatia 2.

### 13.2 Passos

1. **Migration 143 — re-backfill de `user_work_state`.** As 878 linhas de hoje são de agosto (mig
   138) e **estão velhas**: nada escreve nelas desde então. Refazer a partir de `works`, **no momento
   do corte**. ⚠️ Paginar (o `select` corta em 1000 linhas sem avisar; são 882 obras).
2. **Dual-write — mas `works` é do DONO, e só dele.** `toggleFavorite`, `setFavoriteMany`,
   `updateWorkStatus`, `setReadingStatusForWorks` passam a escrever em `user_work_state` **sempre**, e
   em `works` **somente quando o usuário É o dono** (`userId === ` id do singleton de `user_settings`).

   > 🔴 **A armadilha que mata a Fatia 1 se passar batido.** As colunas de `works` guardam o estado
   > **do dono** — é a linha compartilhada. Um dual-write incondicional, somado ao passo 3, faz a
   > Leitora favoritar uma obra e **sobrescrever o `is_favorite` do dono**; marcar o capítulo 12 e o
   > `chapters_read` **dele** virar 12. Sem erro, sem log. O dual-write existe para manter o espelho
   > do dono vivo durante a transição — **não** para espalhar o estado de estranhos na linha dele.

3. **Trocar o gate** desses 4 writers: `ensureAdmin()` → `ensurePermission("own_state")` + o
   `user_id` da **sessão**. É o passo que destrava a Leitora. O verbo já existe (PR #127).
   ⚠️ O writer passa a precisar do `userId` — e ele vem de `ensureSignedIn()`, **nunca** de
   `getCurrentUserId()` (que cai no singleton sem sessão → escreveria como o dono).
   ⚠️ **Só faz sentido depois do passo 2 estar escopado ao dono.** Invertida, a ordem corrompe.
4. **Rewire das leituras de acompanhamento:** `/leitura`, `/favorites`, o card e a página da obra
   passam a ler de `user_work_state`. O **fallback para `works` também é só do dono** — para os
   demais, sem fallback (estado vazio). Senão a Leitora **vê os favoritos e os capítulos do dono como
   se fossem dela**: o mesmo bug do passo 2, do lado da leitura.
5. **Verificação com DOIS usuários:** cada um marca o próprio capítulo; nenhum vê o do outro; o
   catálogo (título, capa, tags, notas da IA) é o mesmo para os dois.

**A Fatia 1 acaba aqui.** Repare no que isso significa: **cada passo é reversível**. Se algo der
errado, você reverte o código e os dados seguem em `works`, intactos — porque o dual-write nunca parou
de escrever lá.

### 13.3 O que NÃO fazer nesta fatia

- **Não mexer no scoring.** `calculated_scores` continua global. A Leitora **não terá Nota Prevista
  própria** — e está certo: ela não tem rótulos. (É a Fatia 2.)
- **Não mover as leituras de background.** O recalc lê `works` pela service role, sem sessão. Ver §6.
- **Não dropar coluna nenhuma.** Ver §13.4.

### 13.4 ⚠️ O `DROP COLUMN` sai da Fatia 1 — e vira tarefa com pré-requisito

O plano original terminava dropando as 4 colunas de `works`. **Isso foi tirado daqui**, porque é a
**única operação irreversível** da fatia — e o projeto está no Free, **sem backup de schema** (§13.0).

O custo de adiar é **zero**: são 4 colunas em 882 linhas que o código deixou de ler. Não se paga um
risco sem volta por isso.

**Pré-requisitos para dropar, um dia:**
1. Dump de schema (`pg_dump --schema-only`, precisa da senha do banco) **ou** plano Pro (backup diário
   com schema).
2. Nenhum grep encontrando `works.is_favorite`, `works.personal_status_id`, `works.chapters_read`,
   `works.last_read_at` em `server/`, `lib/`, `app/`, `components/`, `scripts/`.
3. Dual-write rodando há tempo suficiente para você confiar em `user_work_state` como fonte.

---

## 14. Prompt para a próxima sessão

> Vamos fazer a **Fatia 1 da Fase 2** (`PLANO-MULTIUSER-FASE2.md` §13): tirar o estado de **leitura**
> (`is_favorite`, `personal_status_id`, `chapters_read`, `last_read_at`) de dentro de `works` e passá-lo
> para `user_work_state`, para que um Leitor consiga marcar capítulo e favoritar — hoje ele **não
> consegue**, porque esses 4 writers são todos `ensureAdmin()` (e têm que ser, já que a coluna mora na
> linha compartilhada). Já existe uma segunda usuária real, e ela é uma espectadora.
>
> **Antes de tocar em qualquer coisa:** rode `node scripts/backup-db.mjs` e confira o manifest. O
> projeto está no **Free — não há backup nenhum** (`pitr_enabled: false`), e esse script salva **só os
> dados**: não salva schema, nem `auth.users`. Por isso **NÃO existe `DROP COLUMN` nesta fatia** (§13.4).
>
> Ordem:
> 1. **Migration 143** re-backfillando `user_work_state` a partir de `works` — as 878 linhas de hoje
>    estão velhas (nada escreve nelas desde a mig 138). **PAGINE**: o `select` do Supabase corta em 1000
>    linhas sem avisar, e são 882 obras.
> 2. **Dual-write** nos 4 writers (`toggleFavorite`, `setFavoriteMany`, `updateWorkStatus`,
>    `setReadingStatusForWorks`): escrevem em `user_work_state` **sempre**, e em `works` **SOMENTE se o
>    usuário for o dono** (`userId ===` id do singleton de `user_settings`).
>    🔴 **Isto não é detalhe — é o que impede corrupção.** As colunas de `works` guardam o estado **do
>    dono** (é a linha compartilhada). Dual-write incondicional + passo 3 = a Leitora favorita uma obra e
>    **sobrescreve o `is_favorite` do dono**; marca o capítulo 12 e o `chapters_read` **dele** vira 12.
>    Sem erro, sem log.
> 3. **Trocar o gate** desses writers: `ensureAdmin()` → `ensurePermission("own_state")`, com o `user_id`
>    vindo de `ensureSignedIn()` — **nunca** de `getCurrentUserId()`, que sem sessão cai no singleton do
>    dono e escreveria como ele. É este passo que destrava a Leitora. **Só depois do passo 2 estar
>    escopado ao dono** — a ordem invertida corrompe.
> 4. **Rewire das leituras** de `/leitura` e `/favorites` para `user_work_state`. O **fallback para
>    `works` também é só do dono**; para os demais, sem fallback (estado vazio). Senão a Leitora vê os
>    favoritos e os capítulos do dono **como se fossem dela** — o mesmo bug do passo 2, na leitura.
> 5. **Parar aqui.** O `DROP` das 4 colunas fica para depois, com pré-requisito de dump de schema
>    (§13.4) — é a única operação sem volta, e não vale o risco por 4 colunas em 882 linhas.
>
> **Escopo fechado:** não mexer em `user_score`, nos 8 `post_*` nem no scoring — arrasta o Ridge, o
> `calculated_scores` e o `formula_config` junto. É a Fatia 2.
>
> **Verifique com dois usuários de verdade** (um curador, um leitor): cada um marca o próprio capítulo,
> nenhum enxerga o do outro, e o catálogo (título, capa, tags, notas da IA) é o mesmo para os dois. Não
> confie na UI para isso — o botão desabilitado esconde buraco de endpoint; chame as server actions
> direto (o id sai do bundle do cliente).
>
> **Lembre dos dois clientes:** escrita per-user vai no `createUserClient()` (RLS vale); catálogo e
> background na service role. Trocar errado **não dá erro** — dá dado errado, em silêncio.
