# SatorIA — Plano Atual (Diferenciação de Notas + Deploy pendente)

> **Este é o plano vivo.** O [PLANO.md](PLANO.md) anterior foi **arquivado** — serve só
> como histórico das sessões (Ondas 0–3: Comix, saldo/badges, faxina de notas). As Ondas 0–3
> estão essencialmente concluídas. O que sobrou de lá é a **Onda 4 (Deploy)**, carregada pro
> fim deste doc.
>
> **Estado atual:** tudo é feito **em dev** (o dev :3001 aponta pro Supabase de prod). O
> **deploy fica pra mais pra frente** (Onda 4).

---

## 0. Status de implementação (atualizado 2026-06-15)

**✅ Feito nesta sessão:**
- **Item A — tags declaradas (amo/evito)** — completo. Migration **100** (`user_tag_preferences`, polimórfica tag/subgrupo/grupo) **aplicada**. UI em `/preferencias`: árvore Grupo→Subgrupo→Tag (grupo só navega, não é declarável), 2 colunas, **Salvar batch** (não por-clique), ênfase 2×. Lógica: `mergeDeclaredTagPreferences` (shrinkage `λ=n/(n+k)`, `K_LOVE=5`/`K_AVOID=8`/`BASE=0.5`) em [taste-profile-heuristic.ts](lib/ai-recommendation/taste-profile-heuristic.ts), re-mesclado no recalc ([calculations.ts](server/actions/calculations.ts): features Ridge + `personal_fit` + folds CV, sem leak) → vale após **Recalcular**. Ranking: filtro "evito" **opt-in 3-estados** (`hide_avoided=strong|all`, strong = weight ≥ 2). Página da obra: tags coloridas verde/vermelho por stance + masonry + "expandir todos".
- **Métrica de ranking (§5) — instrumento ligado.** `prediction_ledger` (migration **101**, **aplicada**) captura a previsão **de-registro** (expected + decision, pré-rótulo) na **primeira nota** de cada obra (hook em `updateWork`/`updateWorkStatus`). Sem backfill → ligado cedo. **Painel da métrica ainda pendente** (esperar acumular notas).
- **Item B — efeitos cruzados via LLM** — **COMPLETO, migration 102 APLICADA, verificado live.** Campo **"Regras e preferências livres (IA)"** (condicional + geral). Coluna `user_settings.preference_rules jsonb` (query tolerante). Action `savePreferenceRules` (batch, **sem recalc**). Bloco no **profileBlock cacheado** + instruções nos system prompts. Threadado nos **7** call sites (rankFavorites ×6 + runDeepDive). UI **gateada no Pago**. **Verificado:** run `recommendation_rank v3` com `nPreferenceRules=4`; Deep Dive da Aria citou as regras (crueldade/tom) como `tags_cons`. **Endurecido p/ `v4` / `deep-dive-v4`:** (1) **inversão de sentimento** (review que confirma traço evitado conta CONTRA, mesmo se o autor ama); (2) **força por evidência** (regra "evito" confirmada por consenso → Deep Dive capa `read_when` em "guardar" + baixa score; ranking baixa alignment + risks; evidência fraca = só risco). **B6 (chat briefing) NÃO feito** (opcional).

- **Item C — Passe 1 (sinal de reviews ao consultor)** — **FEITO + VERIFICADO LIVE na Aria.** review_summary no tailBlock do ranking + Deep Dive; seleção das cruas por qualidade/diversidade de fonte (não mais por nota); gate de materialidade sem migration (count empacotado no hash). **IA Rk da Aria caiu 91→72 citando o consenso; offline idêntico.** Detalhe em §4. tsc/lint/testes limpos.

- **Item C — Passe 2 (digest estruturado)** — **COMPLETO + VERIFICADO LIVE (migration 103 APLICADA).** `consolidateReviewsDigestDetailed` (Sonnet 4.6, tool `submit_review_digest`, amostragem estratificada por fonte) → `review_digest jsonb` (migration **103 aplicada**; leitura tolerante via `fetchReviewDigestsBatch`). Geração **batch opt-in** (`consolidatePendingReviewDigests` + painel em /settings, ~$0.02–0.04/obra), NÃO automática. Consultor **prefere o digest** sobre o resumo-texto (ranking tailBlock + Deep Dive bundle). Bumps `PROMPT_VERSION v5→v6` + Deep Dive `v5→v6`. **Verificado na Aria:** digest no prompt (não o texto Passe 1); re-rank cita "o consenso… crueldade a uma antagonista criança — evidência convergente e forte"; Deep Dive surfou risco novo (`Suicide/s`) dos content_warnings; offline idêntico (8.53 / 0.558). tsc/lint/117 testes limpos. **→ Item C inteiro CONCLUÍDO.**

- **Item C — digest no eval-time** — **COMPLETO + VERIFICADO LIVE (2026-06-16).** Decisão custo×latência fechada: **separado / fire-and-forget / gated** (não same-call). `persistReviewDigest` em [persist-reviews.ts](lib/external/persist-reviews.ts) disparado **SEM `await`** no fim de `saveWorkReviews` (logo após o resumo Haiku) — latência **zero** na avaliação. Gate reusa `isMaterialReviewChange` + `review_digest_n`/`_version`: cold gera, version bump regenera, crescimento material renova, senão no-op. Os **3 call sites** (avaliação ai.ts, acquire-reviews, criação works.ts) afunilam em `saveWorkReviews` → eval-time cobre obra nova **e** re-colheita; **batch fica só pro backfill legado** (~493 obras cold hoje). Tolerante à ausência da migration 103 (catch silencioso). **Verificado live** (rota temp): cold→gera (digest rico persistido em background ~depois~ de resposta de ~1,7s, prova do fire-and-forget sobreviver ao request), gate pula em obra já digerida (`digest_at` inalterado, sem Sonnet novo), offline (expected/calc) intacto. tsc/lint/117 testes verdes. Commit `7be13e0`. **→ Item C 100% fechado.**

- **§6 Consolidação de UX — Blocos 1–4** — **FEITOS + verificados live (2026-06-16).** Os 4
  blocos grandes fechados; resta só um micro-polish de rótulo nos desempates (não bloqueia, ver §6.3).
  Bloco 1 (`75a77c9`): tira as notas decompostas mortas (Perfil/Δ Qualidade) do ranking
  + renomeia "Análise do gosto" → "Re-ranquear favoritos". Bloco 2 (`07a5ac4`): mesma
  limpeza em /titles + heatmap + re-enquadra o waterfall "Por que esta nota?" (tira o
  2-stage aposentado). Bloco 3 (`bda7bc4`): `alignment_score` "IA Rk" → **"Veredito IA"**
  em ~23 arquivos (resolve a colisão com "Alinhamento"=personal_fit). **Bloco 4** (`77e4d67`
  +`ea5ceec`): funde as 3 portas (`RunCreatorForm`+`RecommendWithAiButton`×2) num único
  `RecommendDialog` (modos→**escopo de candidatos**, gate único `smart_shortlist`); Surpreenda-me
  → **"Escolhe por mim"** (Shuffle, fora do cluster LLM); Chat já era porta única. Detalhe no §6.3/§6.5.

**⬜ Pendente:** Painel do ledger (esperar acumular notas). **⏸️ Diferido:**
§7 Deploy · B6 (chat briefing ciente das regras) · dispersão de notas como sinal de tier (§4 Q2, go/no-go barato antes).

> Detalhe de cada um nas seções abaixo (Item A marcado ✅).

---

## 1. Motivação — por que mudar o foco das notas

**O contexto do produto (justificativa do usuário):** a base de obras já é **semi-filtrada** —
o objetivo do site **não** é ser um repertório completo, e sim de obras que o usuário **já
filtrou previamente** e quer saber *o quanto vale a pena ler*. Logo, **espera-se baixa dispersão
de notas**: tudo já é "decente", o que **reduz a diferenciação entre obras** e dificulta gerar
insights significativos a partir de um número absoluto.

**Isso foi confirmado com dado real do banco (query read-only, 2026-06-15):**

| Métrica | Nota Prevista (`expected_score`) | Nota.Calc (`calc_score`) | Nota.M / plataforma (`platform_avg`) |
|---|---|---|---|
| n | 724 | 724 | 716 |
| desvio-padrão | **0,57** | 0,76 | **0,27** |
| faixa p5–p95 | 6,55 – 8,41 | 6,19 – 8,49 | 7,26 – 8,18 |
| intervalo interquartil | 7,24 – 7,98 (**0,74**) | 7,07 – 7,97 | **7,58 – 7,82 (0,24)** |

Dois fatos decisivos:
1. **Restrição de amplitude (range restriction) confirmada:** 90% das obras entre 6,55 e 8,41;
   metade em 0,74 ponto. E o erro honesto do modelo (~0,58) é **quase do tamanho do desvio-padrão
   das previsões (0,57)** → em termos absolutos o modelo mal separa as obras. **Número absoluto
   aqui é quase ruído.**
2. **Nota.M é praticamente uma constante:** desvio 0,27, com **71% das obras (511 de 716) no
   mesmo bin de 7,5**. O sinal da multidão **não diferencia quase nada** neste catálogo filtrado.

**Conclusão:** parar de perseguir precisão absoluta (MAE) e liderar com **ranking relativo +
tiers honestos**, diferenciando **dentro do tier** pelo contexto do usuário.

---

## 2. Princípios de arquitetura (travados)

- **Liderar com tiers, número absoluto vira secundário.** A diferença de nota *dentro* de um tier
  é menor que o erro do modelo → não fingir que separa.
- **Relativo > absoluto na apresentação** (posição no catálogo, não "8,1/10").
- **Lógica ADITIVA → offline** (Ridge, mood-refine). **Lógica CONDICIONAL (efeitos cruzados) → LLM.**
  Modelo aditivo não expressa "evito X *exceto se* Y alto"; LLM faz isso nativamente.
- **Nota.M descartada como diferenciador** (é constante — dado acima).
- **Reviews = sinal qualitativo de exibição/desempate, NUNCA feature do modelo offline**
  (esparso → imputação → colapso, a armadilha que matou o L0+).

---

## 3. O que JÁ existe (construir em cima, não reinventar)

| Peça | Onde | Status |
|---|---|---|
| Tiers por **banda de erro** do modelo (mais esperto que quintil fixo) | `computeTiers()` em [ranking-table.tsx](components/ranking/ranking-table.tsx) | ✅ |
| Divisor de tier + "Comparar/Refinar" | [tie-break-band.tsx](components/ranking/tie-break-band.tsx) | ✅ |
| Desempate dentro do tier por lentes (atributos ±1/±2, sinopse, alinhamento, popularidade, capítulos), limitado ao MAE | [mood-refine.ts](lib/calculations/mood-refine.ts) + [mood-refine-dialog.tsx](components/ranking/mood-refine-dialog.tsx) | ✅ (efêmero, aditivo) |
| Re-rank LLM sob demanda (IA Rk / Deep Dive) | `alignment_score` + [lib/ai-recommendation/](lib/ai-recommendation/) | ✅ |
| `personal_fit` + percentil | persistido em `calculated_scores` | ✅ |

> Os tiers por banda de erro **devem ser mantidos** (respeitam a incerteza real). Ajuste opcional:
> um **Tier 1 menor/exclusivo** ("apostas certeiras", topo ~10% — só 19 obras ≥ 8,5 hoje).

---

## 4. As 3 lacunas reais — proposta detalhada

### Item A — Preferências de tag declaradas (persistentes) · ✅ **FEITO (2026-06-15)** · ver §0

- **Objetivo:** campo pro usuário declarar tags **macro** que ama/evita, contornando o viés do
  sinal *aprendido* (loved/avoided por correlação point-biserial — ruidoso com tags esparsas +
  poucas obras). Diferente do mood-refine, que é **efêmero** e por **atributo (9 critérios)** —
  isto é **persistente** e por **tag/grupo**.
- **Mudanças:**
  - **UI:** seção em `/conta/preferencias` — multiselect de grupos/subgrupos de tags com 3 estados
    (amo / neutro / evito). Reusa o catálogo de `tag_group`/subgrupos existente.
  - **DB:** tabela `user_tag_preferences(user_id, tag_or_group_id, stance, weight)` (recomendado
    sobre jsonb — **multi-user está vindo**, auth ainda não ligado). Migration à mão (fluxo padrão:
    SQL editor; CLI desync, sem `db push`).
  - **Lógica:** (1) **prior com encolhimento** em [taste-profile-heuristic.ts](lib/ai-recommendation/taste-profile-heuristic.ts)
    (declarado preenche onde o aprendido tem pouco dado; migra pro aprendido conforme rotula mais);
    (2) **filtro/boost** no [ranking.ts](server/queries/ranking.ts) ("evito" = filtro duro opcional
    ou penalidade; "amo" = lente de sort).
- **Dados e quando:** lido no **recalc** (alimenta perfil/features) e na **query de ranking** (filtro/boost).
- **Custo:** **M** — UI nova + 1 migration + integração. Sem LLM.
- **Ressalva:** declarado ≠ revelado → "amo" é prior sobreponível pelo dado; "evito" é mais confiável (filtro).

### Item B — Efeitos cruzados via LLM · ✅ **FEITO (2026-06-15, código; migration 102 a aplicar)** · ver §0

> **Escopo ampliado na execução:** o campo não ficou só "condicional" — virou **"Regras e
> preferências livres (IA)"**, aceitando também preferências GERAIS e a orientação "em obra com
> poucas tags/scores rasos, apoie-se nas reviews" (o consultor já recebe top-3 reviews por obra).
> Continua **só no consultor LLM (pago)**; nunca alimenta o modelo offline.

- **Objetivo:** capturar lógica condicional ("evito tragédia *salvo* quando casal forte"; "odeio
  'horny female lead' *exceto* quando comédia é alta") que **nenhum modelo aditivo** (Ridge ou
  mood-refine) consegue.
- **Mudanças:**
  - **UI:** campo de **regras condicionais em texto livre** (poucas) em `/conta/preferencias`.
  - **Lógica:** injetar as regras + o **perfil completo dos 9 atributos** no prompt do consultor
    ([deep-dive-prompts.ts](lib/ai-recommendation/deep-dive-prompts.ts) / prompt do rerank). O LLM
    raciocina condicionalmente e justifica.
  - **DB:** junto das preferências do Item A.
- **Dados e quando:** **só no re-rank sob demanda** (IA Rk / Deep Dive) — nunca no recalc offline. Gate pago já existe.
- **Custo:** **S–M** — engenharia de prompt + mais contexto. Sem migration nova. Token marginal (já gated/pago).
- **Ressalva:** poucas regras, LLM arbitra — não virar motor de regras determinístico.

### Item C — Sinal qualitativo de reviews (de carona na avaliação)

- **Objetivo:** extrair destaque + polarização das reviews que **já estão no contexto** da
  avaliação IA, a custo marginal (eram "caras" como passada separada; como carona são baratas).
- **Mudanças:**
  - **Lógica/prompt:** em [service.ts](lib/ai-evaluation/service.ts), adicionar ao schema/prompt:
    `review_highlight` (frase), `review_consensus` (consensual/divisiva), opcional `execution_quality`.
    ⚠️ Re-validar `enforceAuditableReviewUsage` (retry se reviews não citadas).
  - **DB:** colunas novas em `ai_evaluations`. Migration à mão.
  - **UI:** exibir na página da obra + badge de desempate no tier ("✨ consensual" / "⚡ divisiva").
- **Dados e quando:** preenchido **durante a avaliação IA que já roda** (reviews já no prompt).
- **Custo:** **M** — tokens marginais; mas **backfill das ~600 obras = re-pagar a avaliação**
  (custo único, fazer **incremental** conforme re-avalia).
- **Ressalva CRÍTICA:** **NÃO** virar feature numérica do Ridge (esparsidade → colapso, igual L0+).

#### Item C — plano REFINADO (2026-06-16) — descobertas + decisões desta sessão

> **Disparador:** no Item B, a Aria ("The Villainess Turns the Hourglass") foi #1 com align 91 apesar de violar a regra "não gosto de protagonista cruel com inocentes". **Diagnóstico com dado:** o ranking manda só **3 reviews/obra** selecionadas por `relevance = match × nota`; mas **93% das 7248 reviews NÃO têm nota** (só MyAnimeList 100% + AniList 97% têm) → a seleção **super-amostra MAL/AniList** e a review-chave da crueldade (nota nula) **nunca chegou ao modelo**. O Deep Dive (10 reviews + thinking) **mordeu** (citou a crueldade), confirmando que a falha é do **ranking raso**, não do Item B.

- **JÁ EXISTE (reusar, não rebuildar):** `works.review_summary` (migration **081**: resumo de consenso via **Haiku**, `hashReviewInputs` p/ cache, badge "resumo faltando"; **69% de cobertura** — 494/721). Amostra as **40 mais longas** (não por nota). **MAS não chega ao consultor** (confirmado: ausente em recommendations.ts/lib/ai-recommendation). Summarizer em [review-summarizer.ts](lib/ai-recommendation/review-summarizer.ts) (`consolidateReviews`).
- **Trava:** digest é **sinal qualitativo pro consultor LLM** (Recomendar/IA Rk/Deep Dive/Chat) — **nunca** feature do offline (`expected_score`/`personal_fit`). O casamento digest × preferências fica **a jusante no consultor** (Item B v4), **não** no digest (digest é **preference-agnostic** — injetar prefs do user quebraria cache/multi-user/neutralidade).
- **Fase 1 (Passe 1 — barata, sem migration, sem LLM novo, vale com 69% já):**
  1. Fiação: `review_summary` → candidato ([mapRowToCandidate](server/queries/recommendations.ts)) + bloco "consenso das reviews" no **tailBlock** do ranking e do Deep Dive.
  2. Seleção das 3 reviews cruas: trocar `match × nota` (+ vaga crítica por nota) por **match + diversidade de fonte** (rodízio) em [pickBalancedReviews](server/queries/recommendations.ts) — mata o viés das 93% sem nota.
  3. Bump de versão dos prompts.
  4. **Regra anti-repetição (pedido do user):** trocar o gate por hash em [persist-reviews.ts](lib/external/persist-reviews.ts) por **materialidade**: re-roda só se `reviewsAgora − n_no_último ≥ max(2, ⌈n × 0,20⌉)` (ou cold, ou versão mudou). Biblioteca pequena re-roda com poucas adições; grande ignora +1. Edições puras → botão manual.
- **Fase 2 (Passe 2 — após verificar a Fase 1):** migration **103** com **`review_digest jsonb`** + `review_digest_at` + `review_digest_n` + `review_digest_version` (**NÃO** sobrescrever `review_summary` — UI/badge usam o texto). Summarizer estruturado em **Sonnet 4.6** (~1500 out), **amostragem estratificada por fonte** (não "40 mais longas" — isso re-introduz o viés MAL/AniList, que escrevem ensaios). Saída preference-agnostic: `consensus` · `divergence` · `salient_traits` (moralidade/tom/ritmo) · `content_warnings` · `execution`. Consultor consome o digest. **Sonnet justificado** = custo **único por obra, amortizado**; catálogo ≈ **$49 one-time** (re-roda só com mudança material). Opus = overkill.
- **Recomendação travada:** fazer **Passe 1 (Fase 1 + gate de materialidade) PRIMEIRO**, verificar na Aria (IA Rk cai? ganha risco? offline NÃO mudou?), só então Passe 2. (Rework: 1 bump de versão extra — compensado pelo gate de verificação/gasto.)

#### Item C — Passe 1 · ✅ **FEITO + VERIFICADO LIVE na Aria (2026-06-16)**

> **Verificação live (Aria, run real de IA Rk + Deep Dive):** (a) o bloco "consenso das reviews" entrou no prompt com o texto do consenso ("Aria genuinamente má e calculista, sem arco redentor"); (b) **IA Rk caiu 91 → 72** — a justificativa cita *"o consenso das reviews"* + a tag Cruel Female Lead conflitando com a regra declarada; Deep Dive deu `match_score=66`, `read_when="guardar"`, flag "cruelty a inocentes confirmada [R10]". (c) **offline idêntico** (`expected_score 8.52→8.52`, `personal_fit 0.558→0.558`). Seleção das 3 cruas veio de 3 fontes distintas (comick/mangadex/mangaupdates), todas sem nota — confirmando que o viés MAL/AniList morreu (live: 114 reviews, só MAL 8/8 + AniList 2/2 + 1 comick têm nota). **→ liberado pro Passe 2.**


- **(1) Fiação:** `reviewSummary` em `CandidateWorkInput`/`DeepDiveWorkBundle`; `review_summary` adicionado ao `CANDIDATE_WORK_SELECT` ([recommendations.ts](server/queries/recommendations.ts)) e ao select do Deep Dive ([deep-dive.ts](server/queries/deep-dive.ts)); bloco "consenso das reviews (resumo IA)" no tailBlock do ranking ([prompts.ts](lib/ai-recommendation/prompts.ts)) e no work bundle do Deep Dive ([deep-dive-prompts.ts](lib/ai-recommendation/deep-dive-prompts.ts)), acima das cruas. 31% sem resumo → degrada pras cruas.
- **(2) Seleção das 3 cruas** reescrita em `pickBalancedReviews`: **piso de qualidade** (`MIN_REVIEW_CHARS=120`, `MIN_REVIEW_MATCH=0.5`, ajustáveis) → **round-robin de fonte** → **top-up** por relevância (nunca retorna menos que antes). Mata o viés MAL/AniList e o piso evita review fraca/obscura (pedido do user). Removida a "vaga crítica por nota" (dependia do `rating` ausente em 93%). Escopo: só o ranking; Deep Dive (cap 10) só ganhou o resumo.
- **(3) Bumps:** `PROMPT_VERSION v4→v5`, `DEEP_DIVE_PROMPT_VERSION deep-dive-v4→v5`.
- **(4) Gate de materialidade** ([persist-reviews.ts](lib/external/persist-reviews.ts)): re-resume só se cold OU (conjunto mudou E `nowN − prevN ≥ max(2, ⌈nowN×0,20⌉)`). **Sem migration (Opção A):** count empacotado em `review_summary_inputs_hash` como `"<hash>:<n>"` (helpers `packReviewSummaryMeta`/`parseReviewSummaryMeta`/`isMaterialReviewChange` em [review-summarizer.ts](lib/ai-recommendation/review-summarizer.ts)); linha legada (só hash) = material → 1 recompute. 3 escritores atualizados (persist ×1 + backfill [settings.ts](server/actions/settings.ts)). Edição pura (mesmo count) → botão manual.
- **Verificação:** tsc limpo, 117 testes verdes, lint sem erro nos arquivos tocados. **PENDENTE:** rodar IA Rk + Deep Dive na Aria (resumo aparece? crueldade vira risco no ranking raso? offline idêntico?) antes do Passe 2.
- **Custo:** sem novas chamadas LLM (consome o `review_summary` já gerado); ~200 tok/candidato de input extra (~US$0,012/run de 20 a Sonnet); gate de materialidade = economia líquida de Haiku.

#### Item C — geração do digest no eval-time · ✅ **RESOLVIDA + VERIFICADA LIVE (2026-06-16)** · ver §0

> **Fechamento:** implementado como **separado / fire-and-forget / gated** (opção recomendada abaixo). `persistReviewDigest` disparado sem `await` no fim de `saveWorkReviews`, gate via `isMaterialReviewChange`+`review_digest_n`/`_version`. Verificado live (cold→gera em background, gate pula em obra digerida, latência/offline intactos). Commit `7be13e0`. Detalhe da decisão preservado abaixo como histórico.

> **Contexto:** Passe 2 entregou o digest, mas a geração é **batch opt-in** (botão em /settings). Obra **nova** NÃO ganha digest na avaliação — só o resumo Haiku do Passe 1 (auto); o consultor cai no fallback até o batch rodar. Discussão (2026-06-16) concluiu que **isso devia ser automático no eval-time**.

- **Dois erros meus já corrigidos na discussão (não repetir):**
  - ❌ "escopar o auto a favoritos/ranking" — obra recém-criada **não é** favorita nem está no ranking; tem que cobrir **toda obra recém-avaliada**.
  - ❌ "staleness mata o eval-time" — staleness **só vale pra on-going**. Pra status "Completo" (maioria do catálogo curado) as reviews são estáveis → gerar **uma vez** no eval é a cadência **certa**.
- **Desenho decidido:** gerar o digest **no eval-time**, no mesmo lugar do resumo Haiku ([persist-reviews.ts](lib/external/persist-reviews.ts) `saveWorkReviews` → após `persistReviewSummary`), sob o **mesmo gate de materialidade** (auto-limitado: Completo digere 1×, on-going renova com crescimento material). O **batch** continua só pro backfill do catálogo existente (~$24 one-time).
- **ÚNICA decisão em aberto (custo × latência) — escolher antes de codar:**

  | Opção | Custo | Latência |
  |---|---|---|
  | **Same-call** (digest sai no output da própria avaliação Sonnet v19) | só ~$0,012 output extra (reviews já no contexto) | **+20–30s na avaliação** (já ~60s, tela Avaliar) + acopla schema/cache/retry v19 |
  | **Separado fire-and-forget** em `saveWorkReviews` (RECOMENDADO) | ~$0,037/obra (re-manda reviews) | **zero** na avaliação — background, desacoplado |

- **Minha recomendação: separado/background/gated, SEM `await`.** O digest **não é preciso síncrono** (é pro consultor que roda depois); a economia do same-call (~$0,025/obra) é centavos no fluxo de obras novas (conta-gotas) e não vale taxar a latência da avaliação (ponto de dor conhecido — [[project_ai_eval_latency]]). **Cuidado de implementação:** fire-and-forget precisa sobreviver ao fim do request — ok no host long-running (Fly), arriscado em serverless; o `saveWorkReviews` já é best-effort/silencioso.
- **Próximos passos (sessão nova):** (1) confirmar a opção acima; (2) `persistReviewDigest` em persist-reviews sob o gate (reusa `isMaterialReviewChange` + `review_digest_n`/`_version`), disparado sem `await` no fim de `saveWorkReviews`; (3) testar numa obra nova (digest nasce junto) e numa Completo já digerida (gate bloqueia re-run); (4) manter o batch pro catálogo antigo.

#### Item C — Q1/Q2 da sessão (respostas registradas)

- **Q1 (digest em obra nova):** hoje **não** é gerado no eval — só o resumo Haiku é auto; digest é batch. → vira a pendência aberta acima.
- **Q2 (dispersão/polarização das notas como sinal OFFLINE):** **candidato deferido** (registrado na memória `project_tiers_differentiation`). Veredito: **NÃO** como feature do `expected_score`/Ridge (prediz incerteza, não nível; cobertura parcial; MAE não mede o ganho). Se um dia, é **sinal de incerteza do TIER via 1 fonte canônica (AniList `scoreDistribution`, histograma da comunidade)** — nunca Ridge. **Go/no-go barato antes de modelar:** persistir o `scoreDistribution` da AniList do catálogo e medir se a **dispersão sequer varia entre obras** (catálogo curado pode achatar isso — range restriction). O digest (texto/struct do LLM) **NÃO** vira feature offline (qualitativo/condicional → fica no consultor).

---

## 5. Sequenciamento, custo e o que NÃO fazer

**Ordem por ROI/risco:** A (tags declaradas) → B (cross-effects LLM, reusa UI/DB do A) → C (reviews, mais caro/incremental).

**Custo total:** ~1 onda de trabalho. Sem custo recorrente de infra; token novo só no B/C (gated/marginal).

**NÃO fazer:**
- ❌ Reconstruir tiers ou desempate (já existem: `computeTiers` + mood-refine).
- ❌ Muitos termos de interação no Ridge — overfit com 660 obras.
- ❌ GBM agora — data-starved, e MAE não é a métrica certa.
- ❌ Reviews/cross-effects como feature do modelo offline — colapso por esparsidade.
- ❌ Usar Nota.M como diferenciador — é constante (std 0,27).

**Métrica:** trocar/complementar MAE por um indicador de **ranking** (Spearman / acerto par-a-par) no painel de calibração — MAE engana num catálogo comprimido. **▶ Em andamento:** `prediction_ledger` (migration 101) já captura o par (previsto, real) **prospectivo** por obra; falta a `computePredictionLedgerMetrics()` + bloco no painel (concordância par-a-par + MAE prospectivo como guarda-corpo). MAE prospectivo NÃO é placar de melhora — só alarme de regressão.

**Per-user-ready:** projetar a tabela do Item A com `user_id` desde já (multi-user vindo — [[project_multiuser_account_area]] na memória).

---

## 6. Consolidação de UX — engines, notas e fluxo

> Auditoria do sprawl atual (~10 botões + 7 notas) contra o escopo. Os pontos abaixo foram
> **verificados no código** (2026-06-15); o redesenho fino de UI (onde cada botão vive) deve ser
> validado tela a tela antes de mexer.

### 6.1 — Não são "5 motores": são **2**

Correção importante (verificada): a `runRecommendationAction` **não** é "ranking filtrado" —
ela chama o `rankFavorites`, que é o **re-ranker LLM** (gera `alignment_score`, justificativa,
`mood_fit`…). Ou seja, faz parte da engine LLM, não da determinística. Desmontando o sprawl:

- **Chat** não é engine — é uma **pele conversacional** sobre as outras (reusa `runRecommendationAction`).
- **Recomendar (run)** = consultor LLM sobre um conjunto de candidatos (modos `next_read` / `full_analysis` / `ranking`); já aceita `userContext` (mood).
- **Deep Dive** e **Desempatar com IA** = mesma engine LLM (`rankFavorites`/`deepDive`), escopos diferentes (1 obra vs cluster).
- **Surpreenda-me** = gesto aleatório ("escolhe por mim") sobre o ranking, não engine.

**As 2 engines reais:**

| Engine | É | Custo | Portas atuais |
|---|---|---|---|
| **Determinística** (offline) | matemática aditiva sobre expected_score / personal_fit / mood-refine | grátis | Ranking · Refinar (Comparar/Refinar) · Surpreenda-me |
| **Consultor LLM** (sob demanda) | `rankFavorites` + `deepDive` | pago | Recomendar com IA · Recomendar do Ranking · Próxima Leitura · Análise do gosto · Desempatar com IA · IA Rk · Deep Dive · Chat |

→ A coluna LLM é **uma engine só com ~8 portas**.

### 6.2 — A matriz que organiza tudo: fixo/mood × aditivo/condicional

| | **Aditivo (offline, grátis)** | **Condicional (LLM, pago)** |
|---|---|---|
| **Perfil FIXO** (persistido) | Ranking + Nota Prevista + Alinhamento (expected_score, personal_fit, tags declaradas — Item A) | Consultor com regras fixas no prompt (Item B) |
| **MOOD** (efêmero) | Refinar (mood-refine, limitado ao MAE) | Consultor com condicional ad-hoc ("hoje evito X exceto se Y") |

**Regra de diferenciação fixo × mood** (é propriedade do **input**, não engine separada):
- **FIXO** = persistido no DB (perfil aprendido + declarações de /preferencias) → alimenta o ranking offline **por padrão** + entra como contexto permanente no prompt do consultor. Sobrevive entre sessões.
- **MOOD** = efêmero, **transform por cima** do ranking fixo (no Refinar aditivo, ou condicional solto no chat). Reseta a cada sessão.

### 6.3 — Curadoria: tirar / mudar / implementar

> **STATUS (2026-06-16) — Blocos 1–3 FEITOS + verificados live** (commits `75a77c9`,
> `07a5ac4`, `bda7bc4`). **Descoberta-chave do inventário vivo:** o §6 foi auditado
> lendo código (2026-06-15) assumindo notas mortas **na cara do usuário**; na prática
> ~80% da faxina de notas **já estava feita** nos defaults (Prioridade/Perfil/Δ
> Qualidade já vinham `hidden`). Sobrou: remover de vez + naming + a fusão das portas
> (Bloco 4, único bloco grande restante).

**🗑️ TIRAR**
- ✅ **Bloco 1+2** — Nota **Prevista - Qualidade** (`expected_quality_adj`) e **Prevista
  - Perfil** (`expected_baseline`) **removidas de todas as superfícies** (ranking, tabela
  de /titles, heatmap, waterfall da obra). Correção factual: Δ Qualidade era **sempre 0
  pra TODOS** (não só Free) — `L0_QUALITY_ENABLED=false` aposentou o estágio 2; Perfil ≈
  expected menos o nudge de observação. Coeficiente cru do Ridge segue em
  `formula_config.expected_ridge_coefficients` p/ debug real.
- ✅ **Resolvido (já era o estado vivo)** — **Nota Prevista vs Prioridade**: o código já
  lidera com **Prevista + tiers** e esconde Prioridade por padrão (v6). Decisão travada:
  **manter Prevista como escalar líder** (alinha com §2; ≠ do texto original que pedia
  "só Prioridade"). `decision` fica opt-in no column picker.
- ✅ **Bloco 4** (`77e4d67`) — as 3 portas one-shot (`RunCreatorForm` + `RecommendWithAiButton`
  ×2) fundidas num único **`RecommendDialog`** (`components/recommendations/recommend-dialog.tsx`).
  Os "modos" viraram **escopo de candidatos** (não-lidos→`next_read` · todos→`full_analysis` ·
  filtro do ranking→`ranking`); prop `context` controla quais escopos aparecem por tela (filtro
  só na /ranking, lê `useSearchParams`). Gate único `smart_shortlist` apresentado igual; gate de
  perfil (insuficiente/stub) separado do de plano na /recommendations. Cópia stale do Free
  corrigida. `runRecommendationAction` inalterado. Componentes antigos apagados.

**✏️ MUDAR**
- ✅ **Bloco 3** — Colisão **Alinhamento × IA Rk** resolvida: `alignment_score` →
  **"Veredito IA"** (abrev. "Veredito" em colunas/badges estreitos) em ~23 arquivos;
  "Alinhamento" fica exclusivo do `personal_fit`. Verbo "Rankear" e identificadores
  (`ia-rk`/`iaRk*`) NÃO tocados.
- ⬜ **(micro-polish residual, não bloqueia o §6)** — **Dois desempates**: **já estruturalmente
  aninhados** (tier → "Comparar / Refinar" grátis/mood → `WorkCompareDrawer` → "Desempatar com IA"
  pago). Funcionam; falta só polir o rótulo/clareza de profundidade — NÃO tocado no Bloco 4.
- ✅ **Bloco 4** — **Chat** já era porta conversacional única (store `active-chat` une
  `ChatRecommendButton` + `ActiveChatFab` na mesma conversa); rótulos **Conversar** vs
  **Recomendar** já distintos → confirmado, sem mudança de código.
- ✅ **Bloco 1** — **Análise do gosto** → renomeada **"Re-ranquear favoritos"** (full_analysis),
  tira a confusão com *perfil de gosto*.
- ✅ **Bloco 4** (`ea5ceec`) — **Surpreenda-me** → **"Escolhe por mim"** (ícone Shuffle, não
  Sparkles; tooltip "sem IA"), separado das portas LLM pagas por um divisor no header da /ranking.
  Mecânica intacta (sorteio determinístico de 3 do top-20, estável no dia).

**🔨 IMPLEMENTAR**
- Itens A/B/C (seção 4) entram **pelos fluxos existentes** — tags declaradas e sinal de reviews viram lentes/badges **dentro do Refinar**; efeitos cruzados entram no **consultor**. Não criar botão novo.
- **Hierarquia de informação:** **TIER** (primário) → **um escalar** (Prioridade) → **diferenciadores sob demanda** (Refinar [grátis/IA] · Veredito IA · Deep Dive).

### 6.4 — Fluxo do usuário novo (onboarding) + cold-start

Persona: Pago, cadastra **100 obras** (25 com nota, 75 sem).

**Fatos de cold-start (verificados):**
- Ridge da Nota Prevista treina com **≥ 20 rótulos** (MIN_TRAIN); **sem o blend com Nota.Calc abaixo de 30**. Com 25 → treina, mas **ruidoso e sem âncora** → tiers grosseiros.
- Perfil de gosto: `MIN_WORKS_FOR_ANY_PROFILE = 5`, `MIN_WORKS_FOR_FULL_PROFILE = 10`. **<5 → nenhum perfil; 5–9 → stub (recomendações se recusam); ≥10 → completo.** Com 25 → completo.
- **O perfil é AUTO-gerado** — não é passo manual: o **Recalcular** monta o heurístico (alimenta as features e o Alinhamento); a **1ª recomendação Pago** gera o LLM rico via `loadOrEnsureProfile`. "Análise do gosto" é só um reforço **opcional**.
- **Tags declaradas (Item A) NÃO EXISTEM hoje** — é proposta. No design, o lugar é o **onboarding** (passo opcional em /preferences), e é onde mais rendem: cobrem o buraco do cold-start enquanto os 25 rótulos não bastam.

| Fase | Ação | Engine / célula 2×2 | Custo |
|---|---|---|---|
| **1 · Popular** | avaliar 100 (9 notas/obra) + nota em 25 + **Recalcular** | setup (perfil heurístico auto) | **alto** — ~100 evals LLM (gasto dominante) |
| **1 · Onboarding** *(proposto)* | declarar tags amo/evito (Item A) | seed do FIXO | grátis |
| **2 · Comum** | abrir /ranking → tiers | Determinística · fixo×offline | grátis |
| **2 · Comum** | Refinar por mood do dia | Determinística · mood×offline | grátis |
| **3 · Profundo** | Desempatar / Deep Dive / Chat | Consultor LLM · fixo+mood×LLM | pago, ocasional |

**Loop comum:** abrir ranking → olhar Tier 1 → talvez Refinar → escolher (tudo grátis). O LLM é acabamento sob demanda. **O que melhora o sistema é ler e dar nota** (alimenta a engine determinística) — não gastar no LLM.

### 6.5 — Bloco 4: fusão das portas de recomendação (✅ FEITO)

> **Status:** ✅ **FEITO + verificado live (2026-06-16)** — commits `77e4d67` (fusão) +
> `ea5ceec` (Escolhe por mim). Decisões de UX travadas com o user: **(1)** 1 componente
> compartilhado (`RecommendDialog`); **(2)** modal inline onde o user está (mais eficiente —
> escopo "filtro do ranking" lê `useSearchParams` local; /recommendations segue hub de
> histórico+chat); **(3)** modos re-enquadrados como **escopo de candidatos**; **(4)**
> Surpreenda-me mantém mecânica global, só relabel/reposiciona. Verificação live (Chrome
> headless): os 3 dialogs abrem e os escopos batem por tela (favorites=2, ranking=3 c/ default
> "filtro do ranking", standalone=2); "Escolhe por mim" abre e sorteia 3. tsc+117 testes limpos.
> Inventário abaixo mantido como registro do estado pré-fusão.

**O problema:** a MESMA engine (`rankFavorites` via `runRecommendationAction`) é acionada
por 3 UIs com 3 enquadramentos diferentes + Chat em 3 lugares.

**Inventário vivo das portas:**

| Porta | Onde (componente) | Modo(s) | Forma |
|---|---|---|---|
| Modo rápido | `/recommendations` → `RunCreatorForm` | next_read · full_analysis | 2 botões + textarea de mood, dentro de colapsável "Modo rápido" |
| Recomendar do ranking | `/ranking` header → `RecommendWithAiButton(source=ranking)` | `ranking` (usa filtros da tela) | dialog (n + contexto) |
| Recomendar com IA | `/favorites` → `RecommendWithAiButton(source=favorites)` | next_read · full_analysis | dialog c/ seletor de modo + n + contexto |
| Chat | `/recommendations` (primário) · `/ranking` header (`ChatRecommendButton`) · global (`ActiveChatFab`) | — | porta conversacional (reusa a engine) |
| Ver recomendações | `/favorites` → `ViewRecommendationsButton` | — | só navega pro histórico |

**Alvo (§6.3):** UMA entrada com modos dentro (Próxima leitura · Re-ranquear favoritos ·
Do ranking-filtrado), Chat como porta conversacional única, Surpreenda-me reposicionado.

**Já resolvido (não rebuildar):** os **2 desempates** já estão aninhados —
tier → "Comparar / Refinar" (grátis/mood, `tie-break-band` → `MoodRefineDialog`) →
`WorkCompareDrawer` → "Desempatar com IA" (pago). Só falta polir rótulo de profundidade.

**Constraints / armadilhas:**
- O modo `ranking` **depende do contexto de filtros** da /ranking → não dá pra mover a
  porta pra qualquer lugar; ou a entrada unificada lê os filtros quando aberta da /ranking,
  ou esse modo só aparece lá.
- `RunCreatorForm` e `RecommendWithAiButton` **duplicam** a mesma lógica com UIs diferentes
  (botões vs dropdown) → candidatos a 1 componente só.
- Chat já é gated por plano (`planAllows(plan, "chat_recommend")`).

**Decisões de UX a tomar (antes de código):**
1. **Componente único vs variantes por tela** — fundir `RunCreatorForm` + `RecommendWithAiButton`
   num só (usado em /recommendations, /ranking, /favorites), ou manter gatilhos por tela que
   abrem o MESMO modal com modos?
2. **Onde vive a entrada** — /recommendations como casa; /ranking e /favorites deep-link com
   contexto pré-setado, ou modal inline em cada uma?
3. **Modos** — manter os 3 (next_read · full_analysis · ranking) ou consolidar? (next_read e
   full_analysis diferem só no escopo de candidatos; ranking é o único que precisa de filtros.)
4. **Surpreenda-me** — reposicionar como sabor do desempate ("escolhe por mim") ou manter botão.

**Custo estimado:** médio — multi-tela, sem LLM/migration; risco = regressão de fluxo (testar
live cada porta). Naming/notas (Blocos 1–3) já fora do caminho.

---

## 7. Onda 4 — Deploy (carregada do PLANO.md antigo, DIFERIDA)

> **Fica pra mais pra frente.** Por enquanto tudo roda em dev. Detalhe completo (comparativo
> Fly/Oracle/Híbrido, região, riscos do idle-timeout da IA >60s) está no [PLANO.md](PLANO.md)
> seção II.C e [DEPLOY-FLY.md](DEPLOY-FLY.md).

- **Plataforma decidida:** **Fly-only, região `iad`** (DB Supabase fica em Ohio; migrar p/ SP só
  se virar multi-user BR e o TTFB incomodar).
- **Pré-req:** **resolver-hid prod-safe** (GitHub Action com Chrome) — hoje só roda em dev.
- **Incluir no deploy:** **drop das colunas `formula_config` legadas** (mae_predicted /
  rmse_predicted / stacker_* / stacker_coefficients). ⚠️ **NÃO dropar `gpt_mean`** (vivo — centro
  da amplificação da IA(n)/calc_score). Coordenar com a remoção dos null-writes em
  [calculations.ts](server/actions/calculations.ts) (senão o `upsert` quebra).
- **Risco a validar em prod:** IA >60s pode bater no idle-timeout do fly-proxy → mitigação é
  migrar a avaliação pra disparo + polling.

---

## Referências

- [PLANO.md](PLANO.md) — **arquivado**: histórico das Ondas 0–3 + diagnósticos originais + logs de sessão.
- Memória: veredito de direção em `project_tiers_differentiation` · arquitetura de notas em `architecture_score_layers` · saturação do modelo em `project_expected_model_feature_saturation`.
