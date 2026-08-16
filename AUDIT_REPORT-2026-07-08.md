# AUDIT_REPORT — Auditoria técnica, estatística e de produto do SatorIA/VibeMatch

> **Data:** 2026-07-08 · **Autor:** auditoria assistida (Claude) · **Escopo:** catálogo + avaliação por IA + pipeline de scores + ranking + recomendação personalizada + segurança + banco + custos.
> **Método:** leitura de código em primeira mão (núcleo determinístico de `lib/calculations` + orquestração `computeRecalc`) · 4 sub-auditorias paralelas (segurança, schema DB, ranking/recomendação, inventário de IA) com citações `arquivo:linha` · **validação empírica read-only no banco de produção** (878 obras, 207 rotuladas, `calculated_scores` completo, `ai_api_calls`) · execução de `vitest`, `tsc --noEmit`, `eslint`. **Nenhum dado foi alterado**; scripts de análise foram temporários e removidos.
> **Preservação:** não sobrescrevi o `AUDIT_REPORT.md` de 2026-06-17 (valioso, referenciado por memória e outros docs). Este é um arquivo **novo e datado**. Se quiser, renomeio para `AUDIT_REPORT.md` arquivando o anterior como `AUDIT_REPORT-2026-06-17.md`.
> **Limite de potência estatística:** com **n=207 rótulos** (`works.user_score`) para ~875 obras, ICs são largos. Trato "fato medido" vs "risco" vs "hipótese" explicitamente. As correlações abaixo são medidas; as recomendações de modelo dependem de **medição prospectiva** que o sistema ainda não acumulou.

---

## Status de execução (atualizado 2026-07-09) · PR [#85](https://github.com/acgeners/vibematch/pull/85) (branch `work`)

> **O que a auditoria destravou até agora — tudo aditivo, sem tocar fórmula/score/ordenação.** Ver detalhe por item no §19.

**✅ Shipado (PR #85):**
- **P1.1 (instrumentação) — parcial:** `/ranking` grava `prediction_snapshots` prospectivos (via `after()`, `ranking_snapshot_id` UUIDv5 determinístico → dedup dia+filtros; só obras sem nota → leak-free). Migrations **135** (`rank_position`) e **136** (`filters_key`) **aplicadas em produção**. Scripts read-only `npm run baselines:ranking` (in-sample) e `npm run prospective:ranking` (prospectivo por contexto `ranking_snapshot`: cobertura + MAE/pairwise/NDCG/regret + bootstrap IC + segmentação por `filters_key`). *Falta: harness offline pairwise para crescer rótulos.*
- **P1.4 (filtros visíveis) — feito na view Faixas:** chips de filtros default (selo PADRÃO, removíveis via URL).
- **P1.5 (bandas) — parcial:** exibição em faixas de prioridade na nova view **Faixas** (4ª visualização, **não** substitui Lista/Cards/Bússola); nota secundária (`~x,x estim.`). *Falta: validar a largura da banda empiricamente (depende de dados resolvidos).*

**⏳ Pendente:**
- **Medição prospectiva ACUMULANDO** — hoje **0 obras resolvidas** (esperado: obras "Quero ler"/"Sem status" só resolvem quando lidas+avaliadas). Rodar `npm run prospective:ranking` periodicamente. **A decisão sobre Ridge/chance/Bússola (P3) e a deduplicação de sinais dependem de ≥30 resolvidas + IC.**
- **P0.1** (auth/rate-limit) e **P0.2** (migrations reproduzíveis) — **não iniciados**.
- **P1.2** (deduplicar `personal_fit`/`chance`), **P1.3** (unificar mood), **P2.\*** — pendentes.
- **Backlog:** tooltip `~0,6` da Faixas → `cv_mae` real; Opção B (helpers puros + aba "Ranking" em `/curation/model-metrics`) quando houver dados.

---

## 0. Conclusão objetiva (classificação)

> ### 🟨 **O sistema apresenta uma boa base, mas o ranking ainda não é confiável.**

Mais precisamente, três frases medidas:

1. **Há sinal real, no grosso.** A Nota Prevista bate um baseline constante com folga (MAE in-sample 0,547 vs 0,731 da média — −25%). Serve para separar "vale seu tempo" de "não vale".
2. **A ordenação fina é ruído.** O desvio-padrão da própria Nota Prevista (**σ = 0,55**) é praticamente igual ao erro do modelo (**MAE ≈ 0,55–0,60**). Relação sinal/ruído ≈ 1 no nível do ranking: **99% dos pares adjacentes estão a menos de 0,1 um do outro** e uma única banda de 0,5 agrupa **309 obras**. A precisão exibida (decimais, posições) é, em grande parte, falsa.
3. **A sofisticação é redundante.** A Nota Prevista (Ridge de 22 features + blend) correlaciona **r = 0,96** com o `calc_score` determinístico simples; `personal_fit` é **idêntico** (r = 1,0) ao `tag_overlap_net`; as "3 Forças" da Bússola são colineares (Chance × personal_fit r = 0,81; Chance × Prevista r = 0,77). Vários números elaborados colapsam sobre um punhado de sinais subjacentes.

O produto **não está errado** — está *sobre-construído para os dados que possui*. O gargalo real é **207 rótulos**, não a fórmula. Enquanto isso, o sistema comunica uma confiança e uma personalização que ainda não pode sustentar.

---

## 1. Resumo executivo

| Pergunta | Veredito | Evidência (medida 2026-07-08) |
|---|---|---|
| Tem sinal preditivo? | **Sim** 🟥 | MAE Prevista 0,547 vs baseline 0,731 (in-sample; CV honesta ~0,58–0,60) |
| Discrimina no grosso? | **Sim** 🟥 | σ(Prevista)=0,55 separa top de fundo; 129 obras dentro de 1,0 do #1 |
| Discrimina no fino? | **Não** 🟥 | 99% dos pares adjacentes <0,1; banda 0,5 → tier de 309 obras |
| Ridge/blend supera o simples? | **Ganho não demonstrado** 🟥 | Prevista × calc **r=0,96**; ordem quase idêntica |
| "3 Forças" são independentes? | **Não** 🟥 | Chance×pfit 0,81; Chance×Prevista 0,77; pfit×tag_net **1,0** |
| `personal_fit` é o que a doc diz? | **Não** 🟥 | `computePersonalFit` (3 componentes) **sem chamadores**; persistido = `minmax(netName)` |
| Preferências mudam a ordem? | **Fracamente** 🟧 | entram só como feature dentro da Prevista + desempate intra-tier por `tag_overlap_net` |
| Mood reordena de forma coerente? | **Dois mecanismos incompatíveis** 🟥 | preset = filtro duro + resort; drawer = ±0,9 imperceptível, só no cluster |
| Custo de IA (últimos 5 dias) | ~$3,33 🟥 | `review_digest` 50%, `tag_inference` 17%, `synopsis_quality` 14% |
| Build/typecheck/lint | **Verdes (prod)** 🟥 | tsc exit 0; lint prod limpo (102 erros só em `.local-experiments`) |
| Testes | **3 falhas (harness)** 🟧 | 1370 pass / 3 fail / 24 skip — falha = provider ausente no teste, não bug de produto |
| Exposição se publicado | **Crítica** 🟥 | 0 auth, 487 sites service-role, 39 server actions sem gate, 0 rate limit |

**Maior alavanca:** parar de fingir precisão fina, **deduplicar os sinais**, e **acumular rótulos + medir prospectivamente** contra baselines simples (a infra `prediction_snapshots` já existe). Nenhuma mudança de fórmula se justifica sem essa medição.

---

## 1A. Matriz consolidada de achados

| ID | Achado | Sev. | Conf. | Evidência | Prio |
|---|---|---|---|---|---|
| **C1** | Ranking pouco discriminativo / falsa precisão | Alta | 🟥 Alta | σ(Prevista)=0,55≈MAE; 99% pares <0,1; tier de 309 | P1 |
| **C2** | Sofisticação sem ganho: Prevista×calc r=0,96 | Alta | 🟥 Alta | correlação medida no banco | P1 |
| **C3** | `personal_fit` = `tag_overlap_net` (r=1,0); `computePersonalFit` morto | Média | 🟥 Alta | `personal-fit.ts:186` sem callers; `calculations.ts:1154` | P1 |
| **C4** | "3 Forças" da Bússola colineares | Média | 🟥 Alta | Chance×pfit 0,81; Chance×Prevista 0,77 | P2 |
| **C5** | Sinal de sinopse (♥) contado em 3 lugares | Média | 🟧 Média | `score.ts:59` + `expected.ts:186` + `chance.ts:59` | P2 |
| **C6** | Mood = 2 mecanismos incompatíveis | Média | 🟥 Alta | preset (`page.tsx:100-175`) vs drawer (`mood-refine.ts:57`) | P1 |
| **C7** | Scores inconsistentes entre telas | Média | 🟥 Alta | /ranking=Prevista, /recs=alignment, Cards=Chance | P2 |
| **C8** | Filtros silenciosos escondem obras | Média | 🟥 Alta | `pub_status=["Completed"]` default (`page.tsx:186`) | P1 |
| **S1** | Sem auth + service-role em 39 actions sem gate | Crítica* | 🟥 Alta | `deleteWork`, `triggerAiEvaluation`, `generateAllWorkData` | P0* |
| **S2** | Sem rate limiting → denial-of-wallet / destruição | Alta* | 🟥 Alta | 0 throttle em action/route | P0* |
| **S3** | Texto externo (reviews) → prompt sem sanitização | Média | 🟥 Alta | `service.ts:519-531,824-850` | P2 |
| **D1** | Migrations não são auto-suficientes | Alta | 🟥 Alta | `criteria`/`publication_status`/… criadas fora de migration | P1 |
| **D2** | `category_scores.source` CHECK do DB atrás do enum TS | Baixa | 🟥 Alta | `ai_calibrated` aceito no TS, rejeitado no DB | P2 |
| **I1** | `review_digest` = 50% do custo, sem cache de resultado, valor marginal no ranking | Média | 🟥 Alta | `ai_api_calls` 5d; memória: digest melhora ♥ não a Prevista | P2 |
| **I2** | `synopsis_quality_predict` em Sonnet p/ tarefa de 4 rótulos | Média | 🟥 Alta | `synopsis-quality-predictor.ts:244`; sem cache | P2 |
| **I3** | Cascata `generate-all` re-gasta 6/7 passos sem cache | Média | 🟥 Alta | só `ai_evaluation` tem cache de resultado | P2 |
| **Q1** | 3 testes quebrados (harness, provider ausente) | Baixa | 🟥 Alta | `work-reviews-card.test.tsx` | P2 |
| **Q2** | `.local-experiments` polui lint (102 erros) | Baixa | 🟥 Alta | `no-explicit-any` em `_probe` | P3 |

\* Severidade **condicional à exposição de rede**. Hoje mitigado por deploy privado; sobe a P0 real no dia em que o app for exposto.

---

## 2. Veredito sobre o objetivo principal do produto

**Objetivo:** ajudar o usuário a escolher, dentro de um universo já semi-filtrado, as obras com maior probabilidade de agradá-lo.

**Veredito:** *parcialmente atingido, e por baixo do que a UI sugere.*

- ✅ **Prioriza no grosso.** "Estas ~130 valem seu tempo" é uma resposta que o sistema dá bem (Prevista bate baseline).
- ❌ **Não decide no fino.** "Leia ESTA a seguir" dentro de um cluster parecido é a pergunta central do produto — e é justamente onde a ordenação é ruído (σ≈MAE). O universo semi-filtrado (default `Completed` + `Want to Read`) *comprime ainda mais* a dispersão, agravando o problema que o produto existe para resolver.
- ❌ **Personalização real não demonstrada sobre baseline simples.** As preferências entram como *uma feature* dentro da Prevista (peso aprendido, invisível) e como desempate intra-tier por `tag_overlap_net`. Não há evidência medida de que isso supere um baseline "filtro por tags amadas + qualidade externa". O `personal_fit` que a UI mostra como eixo de alinhamento é, de fato, `tag_overlap_net` renomeado.
- ⚠️ **Mood divide-se em dois.** Um mecanismo forte porém cru (filtro+resort) e um honesto porém imperceptível (±0,9 no drawer). O usuário não recebe um efeito de mood coerente e explicável.

O sistema tem **craft real** e uma base sólida de dados/observabilidade. O que falta é **evidência de que o aparato preditivo entrega mais do que um ranking simples** — e hoje a medição diz que, no que dá para medir, **não entrega** (r=0,96 com o simples).

---

## 3. Mapa da arquitetura

```
Next.js 16 (App Router, Turbopack) · React 19 · TS strict · Tailwind v4 · Supabase (service role) · Zod · Vitest
app/            rotas (server components); ranking, recommendations, ai-evaluation, titles, settings, preferencias…
components/     UI ("use client" onde precisa): ranking/, recommendations/, ai-evaluation/…
server/
  actions/      "use server" — calculations.ts (recalc), works.ts, recommendations.ts, ai.ts, external.ts…
  queries/      leitura server-only — ranking.ts, recommendations.ts, works.ts…
lib/
  calculations/ núcleo determinístico: gpt, score, platform, chapters, expected, chance, forces, decision, mood-refine
  ml/           ridge, logistic, preprocessing, weight-inference (TS puro)
  ranking/      build-tiers, tier-config
  ai/           models.ts (registro), anthropic-client.ts (wrapper logado), pricing
  ai-evaluation/ service.ts (avaliação 9 critérios)
  ai-recommendation/ taste-profile, personal-fit, deep-dive, chat, review-summarizer
  ai-cache/ ai-retry/ ai-observability/ orchestration/ generate-all/
supabase/migrations/  000→134 (138 arquivos)
types/domain.ts       tipos canônicos (parte gerada)
```

**Fontes de verdade × derivados:**
- **Verdade:** `works` (+ `work_synopses`/`work_covers`), `category_scores` (9 notas IA), `platform_ratings`, `score_weights`, `user_tag_preferences`, `user_settings.preference_rules`, `taste_profile`.
- **Derivado (recalculado app-side):** tudo em `calculated_scores` (`calc_score`, `expected_score`, `chance_score`, `personal_fit`, `personal_fit_percentile`, `tag_overlap_net`, `platform_avg`…). **Nenhum trigger calcula score** — é tudo `computeRecalc` em `server/actions/calculations.ts`.
- **Recalc = lazy/pull:** edições marcam `formula_config.recalc_pending=true` (`touch_recalc_pending()`, mig 096); um debounce de ~1h ou "Recalcular agora" roda o retrain completo. **Scores ficam rotineiramente stale entre editar e recalcular — por design.**

---

## 4. Mapa dos principais fluxos

| Fluxo | Fonte de verdade | Determinístico? | Recalcula quando |
|---|---|---|---|
| Criar/atualizar obra | `works` + joins | sim | marca `recalc_pending` |
| Import/scraping externo | `platform_ratings`, `work_synopses` | sim (fetch) | manual/cascade |
| Tags | `work_tags` + `tags` | IA (Haiku) + manual | on-create bg + manual |
| Avaliação manual (9 critérios) | `category_scores` (source=manual) | sim | dispara recalc |
| **Avaliação IA** | `ai_evaluations`→`category_scores` (ai_accepted) | **IA (Sonnet-5)** | user revisa antes de commitar |
| Interesse na Sinopse (♥) | `works.synopsis_quality` / `synopsis_quality_predictions` | **IA (Sonnet-5)** | user/cascade/bg |
| **calc_score / expected_score / chance_score** | `calculated_scores` | **sim (Ridge/logística)** | `recalculateAll` coalescido |
| personal_fit / tag_overlap_net | `calculated_scores` | sim | idem |
| Ranking (/ranking) | leitura de `calculated_scores` | **sim, sem LLM** | ordena em memória por Prevista |
| Recomendação (/recommendations) | `alignment_score` | **IA (Sonnet-5), pago** | re-rankeia top-N por Prevista |
| Mood (preset) | filtro+sort na query | sim | por request (`?mood=`) |
| Mood (drawer) | `mood-refine.ts` | sim | client-side, no cluster |
| Status de leitura | `works.personal_status_id` | sim | pode disparar recalc |

**Gatilho de recalc (bom design):** nenhum caminho de produção chama `recalculateAll` direto; tudo passa por `recalc-queue.ts` (coalescido, `recalc_pending`, background). **Não roda em page-load.** Confirmado: nenhuma chamada de IA em render de RSC.

---

## 5. Mapa das regras de negócio (e onde elas divergem)

1. **Nota Prevista (headline) = blend Ridge⊕calc.** `computeRecalc` (`calculations.ts:990-1050`): treina Ridge nas 207 rotuladas, prevê p/ todas, faz busca 1-D OOF do peso `calcBlendWeight`, aplica `observation_adjustment` (±0,30) *uma vez* no fim. Gate: sem os 9 `category_scores`, `expected_score=null` (some das telas). ✔ regra clara.
2. **Nota de Decisão** (`decision.ts`): âncora = Prevista; ajuste só quando existe `alignment_score` (LLM, majoritariamente NULL), capado em 0,35. **Escondida no /ranking** (`work-table-config.ts:152`), visível em /favorites → *mesmo conceito, coluna diferente por tela.*
3. **personal_fit:** a doc (`personal-fit.ts:1-15`) descreve 3 componentes (0,4 tag / 0,3 critério / 0,3 consistência). **A produção ignora isso**: `calculations.ts:1146-1155` grava `personal_fit = minmax(netNameOverlap)`. `computePersonalFit` não tem chamadores. → **regra documentada ≠ regra executada.**
4. **Desempate intra-tier:** servidor *declara* `personal_fit`/`alignment` como tiebreaker (`page.tsx:161`), mas o cliente reordena por `tag_overlap_net` (`build-tiers.ts:85-90`, `ranking-table.tsx:140-153`). → **regra do backend sobrescrita no frontend.**
5. **Mood:** preset aplica `criterionMin/Max` como **filtro duro** + resort por 1 critério (`page.tsx:100-175`); drawer aplica ±0,9 centrado na média (`mood-refine.ts:167-189`). → **dois significados de "mood".**
6. **Filtros silenciosos:** `publicationStatus=["Completed"]` e `personalStatus=["Want to Read","Untracked"]` por default (`page.tsx:178-192`) escondem Ongoing e outros sem aviso; `minExpected` derruba obras com Prevista null.

---

## 6. Auditoria dos cálculos e métricas

### 6.1 Tabela mestra

| Métrica / fórmula | Localização | Objetivo | Problema | Impacto | Alternativa |
|---|---|---|---|---|---|
| **GPT** (soma ponderada 9 critérios) | `gpt.ts:37-80` | agregar notas IA | denominador = só pesos positivos; `POSITIVE_BONUS_FACTOR=0,5×excess` + clamp escondem overflow | não-linearidade difícil de explicar; `clampHit` monitorado | manter, mas expor menos como "nota" |
| **GPT.N** (amplificação ×1,25) | `gpt.ts:104` | esticar em torno da média | slope fixo 1,25; centro = média do catálogo (bom) | só afeta calc; ok | ok |
| **Nota.M** (Bayesian pooling plataformas) | `platform.ts:14-38` | média externa encolhida p/ prior | **σ real = 0,298** — todas as plataformas dão 7,3–8,0 → sinal quase constante | popularidade não discrimina qualidade | manter (é honesto), mas não esperar poder discriminante |
| **calc_score** (blend IA×plataforma por √votos + ♥ mult + obs) | `score.ts:36-67` | âncora determinística | ♥ (`SYNOPSIS_MULTIPLIER`) é intervenção **fixa** embutida no parceiro do blend | double-count leve do ♥ | tirar ♥ do calc (já é feature do Ridge) |
| **expected_score** (Ridge 22 feat ⊕ calc, OOF weight) | `expected.ts` + `calculations.ts:990-1050` | Nota Prevista | **r=0,96 com calc**; 22 features / ~180 treino/fold → sobre-parametrizado | sofisticação sem ganho medido | medir prospectivo; simplificar se não houver lift |
| **chance_score** (logística L2 + Platt) | `chance.ts` | P(gostar) 0–100 | **r=0,81 com personal_fit, 0,77 com Prevista**; treina em 207, prevê 875 | eixo "independente" que não é | manter como *prob*, não como eixo ortogonal |
| **personal_fit** (persistido) | `calculations.ts:1154` | alinhamento 0–1 | = `minmax(netName)` → **r=1,0 com tag_overlap_net**; min-max sensível a outlier (teto=1 por 1 obra) | 2 colunas, 1 sinal; doc enganosa | dropar coluna OU usar percentil robusto; deletar `computePersonalFit` |
| **personal_fit_percentile** | `calculations.ts:1174-1181` | "Top X%" | honesto (percentil midpoint) | ok | manter — é a forma correta de mostrar fit |
| **decision_score** (Prevista ⊕ alignment) | `decision.ts:44-60` | prioridade | alignment quase sempre NULL → = Prevista | coluna redundante na prática | fundir com Prevista |
| **forces / Bússola 2D** | `forces.ts` | Chance×Avaliação×Alcance | eixos colineares (§6.3); Avaliação = Nota.M quase constante | plano sugere ortogonalidade inexistente | reduzir a 1–2 eixos medidos |
| **tiers** (banda 0,5) | `build-tiers.ts` + `tier-config.ts:12` | agrupar por prioridade | banda **provisória "a validar"**; 0,5 gera tier de 309 obras | falsa precisão persiste (decimais na UI) | validar banda por curva de acurácia pairwise |
| **mood-refine** (±0,9) | `mood-refine.ts:57,167-189` | desempate por mood | limitado ao MAE → honesto porém quase imperceptível; só no cluster do drawer | mood "somem" pro usuário | unificar com o preset num mecanismo visível |

### 6.2 Evidência empírica (banco, 2026-07-08, n=878 obras / 207 rotuladas)

```
DISTRIBUIÇÃO (calculated_scores)
expected_score : n=809  min 4,64  p10 6,97  mediana 7,69  p90 8,31  max 9,17  média 7,66  σ 0,551
calc_score     : n=878  min 0,65  p10 6,19  mediana 7,65  p90 8,40  max 9,37  média 7,26  σ 1,625
chance_score   : n=875  min 0,79  p10 17,8  mediana 43,9  p90 64,5  max 83,4  média 42,3  σ 17,18
personal_fit   : n=878  min 0     p10 0,13  mediana 0,29  p90 0,52  max 1,00  média 0,31  σ 0,149
platform_avg   : n=870  min 6,30  p10 7,35  mediana 7,74  p90 8,02  max 8,78  média 7,71  σ 0,298

CORRELAÇÕES (redundância)
expected × calc      r = 0,96   ← Prevista ≈ calc_score
expected × chance    r = 0,77
expected × pfit      r = 0,59
chance   × pfit      r = 0,81   ← Chance ≈ overlap de tags
pfit     × tag_net   r = 1,00   ← MESMO sinal
platform × expected  r = 0,45   (Nota.M quase constante contribui pouco)

DISCRIMINAÇÃO (expected_score, banda 0,5)
#tiers = 9   ·  tamanhos top-5 = [13, 117, 309, 247, 83]   ·  maior tier = 309 obras
pares adjacentes com Δ ≤ 0,1: 799/805 = 99%
obras dentro de 0,5 do #1: 13   ·  dentro de 1,0 do #1: 129

ACURÁCIA (rotuladas, in-sample — otimista)
MAE Prevista 0,547  ·  MAE calc 0,578  ·  MAE baseline(média) 0,731
user_score: n=206  média 7,83  σ 0,949
```

### 6.3 Cenários numéricos (demonstram os riscos)

- **Obra excelente com poucos votos:** `Nota.M` puxa forte pro prior (8,0) com √votos baixo → calc_score converge ao público; sem os 9 critérios IA, `expected_score=null` e a obra some do ranking. *Obra ótima pouco votada é penalizada por falta de dado, não por qualidade.*
- **Obra mediana muito popular:** √votos alto dá peso à `Nota.M` (que é ~7,7 pra quase todas) → calc ≈ 7,7; a popularidade **não** distingue. Alcance (log-votos) só aparece na Bússola, não no ranking.
- **Duas obras quase idênticas (Δ Prevista = 0,08):** caem no mesmo tier; desempate por `tag_overlap_net`; como 99% dos pares estão nessa faixa, a posição relativa é essencialmente arbitrária dentro do erro.
- **Mood muda a recomendação:** no preset, "leve" *filtra* `drama≤5` e reordena por `humor` — efeito grande e descontínuo (e esconde obras); no drawer, o mesmo "leve" mexe ±0,9 e só reordena o cluster aberto — efeito quase nulo. *O mesmo mood produz efeitos radicalmente diferentes conforme onde é acionado.*
- **Preferência positiva e negativa na mesma tag:** `netNameOverlap` faz `amado − 1,5×evitado` por nome (ignora grupo); se a mesma tag estiver em loved e avoided do perfil, o net soma os dois → resultado ambíguo, sem regra de precedência.

---

## 7. Auditoria estatística

| Risco | Presente? | Evidência |
|---|---|---|
| Sinal/ruído ≈ 1 no fino | **Sim** 🟥 | σ(Prevista)=0,55 ≈ MAE 0,55–0,60 |
| Redundância / multicolinearidade | **Sim** 🟥 | pfit×tag_net=1,0; expected×calc=0,96; chance×pfit=0,81 |
| Popularidade ≠ qualidade, mas confundíveis | Parcial 🟧 | Nota.M σ=0,298 (quase constante); alcance só na Bússola |
| Poucas observações p/ o modelo | **Sim** 🟥 | 207 rótulos p/ Ridge de 22 features (folds ~180 treino) |
| Min-max sensível a outlier | **Sim** 🟥 | `personal_fit` teto=1 fixado pela obra de maior netName |
| Shrinkage / regressão à média | **Presente (bom)** 🟩 | Bayesian pooling em `platform.ts`; Ridge L2; Platt no chance |
| Viés de seleção pelo universo pré-filtrado | **Sim** 🟧 | default `Completed`+`Want to Read` comprime dispersão |
| Falsa precisão (decimais) | **Sim** 🟥 | UI mostra `.toFixed(1)` mesmo com banda 0,5 |
| Circularidade / leakage | Mitigado 🟩 | OOF honesto no blend (`expected.ts:407`); nested-CV; Platt OOF |
| Vitrine in-sample otimista | Parcial 🟧 | headline usa CV honesta; mas MAE in-sample ainda calculada |
| Categórico → número inadequado | Baixo 🟩 | Status/Origin via one-hot (correto) |
| Escalas incomparáveis num só score | **Sim** 🟧 | calc mistura IA(0–10)×plataforma(0–10)×♥(mult)×obs(pontos) |

**Conclusão estatística:** o pipeline é *metodologicamente cuidadoso* onde importa (OOF, nested-CV, shrinkage) — mas está **resolvendo um problema que os dados não sustentam**: prever uma nota fina de 0–10 com 207 rótulos, num universo de baixa dispersão, e depois exibir a saída como se fosse precisa. O resultado inevitável é σ≈MAE e ordem ≈ ruído. A engenharia não conserta a falta de rótulos.

---

## 8. Auditoria das avaliações por IA

**Pontos fortes (medidos):**
- **Saída estruturada forçada:** `tool_choice:{type:"tool", name:"submit_evaluation"}` + Zod (`service.ts:1471,1518`); exatamente 9 critérios (`minItems/maxItems`, schema :387-388); scores 0–10, confidence 0–1.
- **Âncoras claras:** rubrica por critério injetada (`buildCriteriaPromptSection`, `service.ts:333`); 5=neutro, 0–4 reservado a ausência genuína; justificativa deve citar a banda.
- **Provenance completa:** `model_name` + `prompt_version` por chamada (`ai_api_calls`) e por score armazenado (`ai_evaluations`, `synopsis_quality_predictions`, `taste_profile`…). **Dá para rastrear qual prompt+modelo produziu cada nota.** ✅
- **Pós-processamento determinístico:** floors de `adult_content` (R19 / content-rating externo), `couple_dynamics` neutro sem romance — corrige erros sistemáticos.
- **Alucinação limitada por design:** reviews externos são title-matched e o prompt manda verificar contra a sinopse e ignorar se conflitar (`service.ts:193-198`); saída é numérica + texto, sob tool-use.

**Fraquezas:**
- **Critérios subjetivos com evidência fina:** o modelo pontua os 9 critérios mesmo com pouca base; a mitigação é hedge (5 + confidence baixa), não abstenção. Reprodutibilidade não é garantida entre versões de modelo.
- **Prompt injection** (S3): texto de reviews entra **cru** (`truncateReviewByWords`, `service.ts:519-531`) — só truncado, sem sanitização/delimitação estrutural. Impacto limitado (saída numérica p/ 1 usuário), mas a superfície é real.
- **Redundância de conceito IA↔fórmula:** o ♥ (Interesse) e as tags inferidas por IA re-entram nos scores determinísticos (§C5), então a "opinião da IA" é contada mais de uma vez em canais diferentes.

---

## 9. Auditoria de custos de IA

**Medido em `ai_api_calls` (janela 2026-07-03 → 07-08, 355 chamadas, $3,33):**

| Operação | n | Custo | % | Modelo | Cache resultado? | Latência méd. |
|---|---|---|---|---|---|---|
| **review_digest** | 100 | $1,67 | **50%** | Sonnet | ❌ | 14,9 s |
| tag_inference | 112 | $0,55 | 17% | Haiku | ❌ (prompt-cache sim) | 5,4 s |
| synopsis_quality_predict | 39 | $0,47 | 14% | **Sonnet-5** | ❌ | 6,2 s |
| ai_evaluation | 6 | $0,30 | 9% | Sonnet-5 | ✅ (L1+L2 content-hash) | 25,7 s |
| review_summarizer | 47 | $0,11 | 3% | Haiku | ❌ | 3,6 s |
| recommendation_rank | 3 | $0,11 | 3% | Sonnet-5 | ❌ | 13,9 s |
| outras (consolidator, subgroups…) | 48 | $0,12 | 4% | Haiku/Sonnet | ❌ | — |

**Por modelo:** Sonnet-4-6 $1,92 (113) · Haiku $0,75 (198) · Sonnet-5 $0,66 (44).

**Riscos de custo (do inventário + medição):**
1. **`review_digest` = 50% do gasto atual, Sonnet, sem cache de resultado, 14,9 s** — e por memória (`project_digest_interesse_ridge`) o digest melhora só o ♥ (Interesse), **não** a Nota Prevista. *Metade do custo de IA financia um sinal de baixa alavancagem no ranking.* Candidato a Haiku + cache por hash + gerar só quando reviews mudam.
2. **`synopsis_quality_predict` em Sonnet-5 para classificar em 4 rótulos (♥..♥♥♥♥)** — tarefa simples/limitada no modelo caro, sem cache, re-rodada por obra. → Haiku + cache por conteúdo. (O catálogo até rotula erradamente `defaultModel: sonnet-4-6` em `types.ts:162` enquanto o código usa Sonnet-5.)
3. **Cascata `generate-all` (~$0,13/obra):** ~7-8 chamadas sequenciais; **só `ai_evaluation` tem cache de resultado** → qualquer re-run re-gasta 6/7 passos. As 16 operações Anthropic não-eval não têm cache de resultado (só prompt-cache de input, janela 5 min).

**Positivos:** retry **bounded** (SDK maxRetries; `lib/ai-retry` é só documentação, 0 importers); single-flight in-process no eval e taste-profile; prompt-caching (`cache_control: ephemeral`) corta input ~3×; nenhuma chamada de IA em render de página. **Nota:** sob Sonnet-5, o wrapper **descarta `temperature`** e força `thinking:disabled` (`models.ts:30`, `anthropic-client.ts:161-173`) — o fallback determinístico 0,2→0 está **inerte**; o determinismo hoje depende do `thinking:disabled`.

*A extrapolação de $3,33/5d (~$20/mês) reflete uso pós-backfill; picos de backfill/cascata elevam muito. O gasto é baixo em absoluto — o risco maior é estrutural: re-gasto por falta de cache de resultado, não volume.*

---

## 10. Contradições e conflitos encontrados

1. **`personal_fit`: doc vs código** — 3 componentes documentados, `minmax(netName)` executado; `computePersonalFit` morto (C3).
2. **Tiebreaker: backend vs frontend** — servidor declara `personal_fit`/`alignment`, cliente usa `tag_overlap_net` (C7 / regra 4).
3. **Score headline por tela** — /ranking=`expected_score`, /recommendations=`alignment_score`, Cards=`chance_score`, /favorites mostra `decision_score` (C7).
4. **Mood: dois sistemas** — filtro-duro+resort vs ±0,9 no cluster (C6).
5. **Nota de Decisão vs Nota Prevista** — conceito quase idêntico (alignment quase sempre NULL), colunas separadas, visibilidade por tela.
6. **♥/tags IA contados em múltiplos scores** — calc + Ridge + chance (C5).
7. **Enum `category_scores.source`** — `ai_calibrated` no TS (`domain.ts:52`), rejeitado pelo CHECK do DB (D2).
8. **`min_final_score`/`min_predicted_score`** — colunas legadas *reaproveitadas* como filtros de ranking vivos (nome ≠ função; mig 099).

---

## 11. Auditoria de banco de dados

- **`calculated_scores` é o sink de todos os scores** (1 linha/obra): `calc_score`(mig 001), `expected_score`(066), `chance_score`(132), `personal_fit`(050), `personal_fit_percentile`(071), `alignment_score`(056), `tag_overlap_net`(116). Legados dropados em 099 (predicted/final/knn).
- **D1 (Alta): migrations não são auto-suficientes.** `criteria`, `publication_status`, `personal_status`, `tag_group`, `genres` são alvos de FK mas **nunca têm `CREATE TABLE`** — foram criadas direto no console. Um replay limpo falha em 019/021. **Maior risco de reprodutibilidade/DR/onboarding.**
- **5 pares de migrations com número duplicado** (011, 044, 074, 119, 132) — objetos disjuntos, sem conflito de dados, mas risco de ordenação/tracking (CLI já dessincronizado — memória `project_migration_apply_mechanism`).
- **D2 (Baixa): `category_scores.source` CHECK atrás do enum TS** — insert com `ai_calibrated` falharia no DB.
- **Índices:** hot paths cobertos (`calc_score`, `expected_score`, status, tags). **Faltam** em `chance_score`, `personal_fit_percentile`, `tag_overlap_net`, `alignment_score` e `works.user_score` — mas o sort é em memória e o catálogo é pequeno (~880), então é dívida diferível, não bug.
- **Triggers/funcs:** `updated_at`, integridade (`total ≥ read`), status de eval, `touch_recalc_pending`, `refresh_calculated_scores_confidence`, RPCs de badges/similaridade. 1 view (`latest_ai_evaluation_per_work`, `security_invoker=on`). Nenhuma materialized view.
- **Multi-user: não pronto.** Só ~9 tabelas têm `user_id`; **todo o core (works, category_scores, calculated_scores, taste_profile, formula_config, score_weights) é global.** Multi-user = migration grande, não flag.
- **RLS:** habilitado em todas as tabelas, **zero policies permissivas** — mas irrelevante para as ações do app (service role bypassa).

---

## 12. Auditoria de segurança

> Severidade **condicional à exposição de rede**. Hoje o app é single-user privado; `.env.example` alerta "não ligar em deploy sem auth". Se exposto como está, sobe a P0 real.

- **S1 (Crítica*): sem camada de auth.** Nenhum `middleware.ts`; "usuário" é singleton (`current-user.ts:11-31`, lê `user_settings.current_user_id`). Plan-gating (free/paid) **não é** identidade. **487** sites `createAdminClient` (service role, bypassa RLS); **39** server actions `"use server"` sem gate, incluindo:
  - `deleteWork(id)` — DELETE sem guarda (`works.ts:1687`);
  - `triggerAiEvaluation(workId)` — chamada Claude paga **sem gate nenhum** (`ai.ts:149`);
  - `generateAllWorkData(workId)` — cascata paga ~$0,13/obra (`generate-all.ts:114`);
  - batch: `createWorksBatch`, `setFavoriteMany`, `rerankStaleBatchAction`.
- **S2 (Alta*): zero rate limiting** em qualquer action/route → *denial-of-wallet* (drenar orçamento Claude/OpenAI num loop) + destruição de dados triviais.
- **S3 (Média): prompt injection** — reviews de terceiros entram crus no prompt (`service.ts:519-531,824-850`); só truncados. Qualquer um posta review nas fontes; impacto limitado (saída numérica p/ 1 usuário) mas superfície genuína.
- **4 route handlers** (`app/api/*`) sem auth: `image-proxy` (host allowlisted, baixo), `animeplanet`/`comick/*` (proxies abertos → abuso de FlareSolverr, médio).
- **Positivo:** service-role key **nunca** vaza pro client (nenhum `NEXT_PUBLIC_`, nenhum import client); só `URL`+`ANON_KEY` no bundle. **Hardening:** `lib/supabase/admin.ts` não tem `import "server-only"` — proteção só por convenção.

---

## 13. Auditoria de performance

- **Recalc:** `recalculateAll` re-lê todas as obras (`limit 2000`) e **re-treina Ridge + logística + weight-inference a cada edição material** (coalescido ~1h). O(n) ok em 878, mas é retrain completo por gatilho. Nested-CV memoizada por `cvSig` (bom, −550ms quando rotuladas não mudam).
- **Ranking:** query única com joins (`ranking.ts:414`), `.order("title").limit(2000)`; **sort e tiers em memória** — ok em ~880, vira gargalo se crescer 10×.
- **DB remoto ~30ms** (São Paulo, memória) — paralelização com `Promise.all` presente.
- **Sem jobs/filas externas** para tarefas longas (cascata IA roda em `after()` pós-save) — aceitável hoje, frágil sob concorrência.

---

## 14. Auditoria de qualidade de código

- **tsc `--noEmit`: exit 0** (limpo). **Estrutura clara** (calculations puros/testáveis, separação server/queries/actions, wrapper de IA logado, observabilidade real).
- **Lint:** produção **limpa** (4 ocorrências reais); **102 errors em `.local-experiments/plan3/_probe`** (`no-explicit-any`) — código experimental que deveria estar fora do lint/git (Q2).
- **Código morto/enganoso:** `computePersonalFit` (C3); `lib/calculations/prediction.ts` (dead, citado no CLAUDE.md); `lib/ai-retry` (0 importers); campos legados em `formula_config`/`calculated_scores` mantidos "pra shape".
- **Complexidade:** `calculations.ts` tem 1300+ linhas com 6 modelos entrelaçados; `works.ts` 73KB; `recommendations.ts` 37KB. Alta carga cognitiva — parte da causa de doc≠código.
- **`any` em boundaries:** `RawWork.category_scores/platform_ratings/work_tags: any[]` (`calculations.ts:112-116`) — perde checagem justo na fronteira de dados do DB.

---

## 15. Auditoria de testes

- **1370 pass · 3 fail · 24 skip** (`vitest`). As 3 falhas são em `work-reviews-card.test.tsx` — o componente agora exige `<CostConfirmProvider>` que o teste não envolve. **Bug de harness, não de produto** (Q1), mas quebra a alegação de "suíte verde".
- **Cobertura:** só funções determinísticas de scoring (bom para elas). **Faltam:**
  - **teste de regressão/golden do ranking** (ordem e distribuição de scores) — nada trava se um recalc mudar drasticamente a ordem;
  - **teste que meça se `expected` supera `calc`** (a redundância r=0,96 passaria despercebida);
  - golden dataset de prompts de IA;
  - testes de RLS / E2E.
- `prediction_snapshots` (mig 105) é a infra certa para validação prospectiva — mas **precisa acumular dado**.

---

## 16. Pontuação geral por área

| Área | Nota | Justificativa (evidência) |
|---|---|---|
| Qualidade técnica | **7,5** | tsc/lint prod limpos, boa estrutura, observabilidade; mas complexidade alta + código morto + doc≠código |
| Coerência das regras | **5,0** | 5+ scores concorrentes, 2 sistemas de mood, tiebreaker sobrescrito, `personal_fit` fantasma |
| Confiabilidade dos dados | **6,0** | provenance forte; mas staleness por design, tabelas fora de migration, 207 rótulos |
| Qualidade das avaliações IA | **7,0** | saída estruturada + âncoras + provenance + pós-processamento; alucinação limitada |
| Eficiência de custos IA | **6,0** | prompt-cache + single-flight + retry bounded; mas sem cache de resultado nos Sonnet recorrentes; digest 50% p/ valor marginal |
| Coerência estatística | **4,0** | σ≈MAE, r=0,96, "3 forças" colineares, min-max, 22 features/207 rótulos, dispersão auto-comprimida |
| Personalização real | **4,5** | sinal grosso existe e prefs entram na Prevista; mas `personal_fit` morto/duplicado, path free fino, redundância |
| Influência do mood | **4,0** | preset forte mas cru (esconde obras); drawer imperceptível por design; inconsistentes |
| Explicabilidade | **5,0** | waterfall + tiers são tentativas honestas; mas 5+ números concorrentes, decimais apesar da banda, sem confiança por-obra |
| Prob. de atingir o objetivo | **5,5** | útil p/ priorização ampla; ainda não p/ escolha fina confiável |
| **Média** | **~5,5** | boa base, ranking ainda não confiável |

---

## 17. Principais riscos

1. **Produto:** o usuário confia numa ordem que é ruído dentro do erro do modelo (σ≈MAE); a personalização não demonstra ganho sobre um filtro simples.
2. **Estatístico:** 207 rótulos são o gargalo real; toda mudança de fórmula sem medição prospectiva é adivinhação.
3. **Financeiro:** re-gasto por falta de cache de resultado (cascata + digest); e (se exposto) denial-of-wallet via actions pagas sem auth/rate-limit.
4. **Segurança:** exposição pública com service-role e sem auth = destruição de dados + gasto ilimitado.
5. **Operacional:** migrations não replicáveis (tabelas fora de migration) → risco em DR/onboarding.

---

## 18. Quick wins (baixo esforço, retorno claro)

| # | Ação | Esforço | Retorno |
|---|---|---|---|
| 1 | Tornar filtros default visíveis com chips removíveis (`Completed`, `Want to Read`, minExpected) | P | Corta "obras somem" (memória) |
| 2 | `synopsis_quality_predict` → Haiku + cache por hash | P | −14% custo, simples |
| 3 | Cache de resultado (hash conteúdo+prompt) em `review_digest`/`review_summarizer` | P/M | Corta re-gasto do maior item (50%) |
| 4 | Deletar `computePersonalFit` + doc; deixar claro que `personal_fit`=`tag_overlap_net` percentil | P | Remove doc≠código; 1 sinal, 1 nome |
| 5 | Esconder decimais dentro da banda (mostrar tier, não `7,7`) | P | Alinha UI ao que é honesto |
| 6 | `.local-experiments` no `.eslintignore`/`.gitignore` | P | Lint limpo de verdade |
| 7 | Corrigir 3 testes (envolver `CostConfirmProvider`) | P | Suíte verde honesta |
| 8 | `import "server-only"` em `lib/supabase/admin.ts` | P | Guarda de build contra vazamento |

---

## 19. Plano de ação P0–P3

### P0 — Corrigir imediatamente
- **P0.1** *(antes de qualquer deploy público)* Gate de auth em `middleware.ts` + capability-check nas 39 server actions + rate limit nas pagas (`triggerAiEvaluation`, `generateAllWorkData`, rerank, delete/batch). **Sem isso, não expor.** (S1/S2)
- **P0.2** Reproduzibilidade do banco: versionar `CREATE TABLE` de `criteria`/`publication_status`/`personal_status`/`tag_group`/`genres` numa migration idempotente. (D1)

### P1 — Alta prioridade (qualidade das recomendações)
- 🔄 **P1.1** **Instrumentar antes de mexer:** ligar log de snapshot de ranking + desfecho (`prediction_snapshots`) e um harness offline pairwise ("qual dessas duas você prefere?") para **crescer rótulos** e **medir lift vs baselines** (calc, popularidade, tags+qualidade). (§17.2) → **PARCIAL (PR #85, 2026-07-09):** snapshots de ranking + resolução + scripts `baselines:ranking`/`prospective:ranking` **shipados** (migs 135/136 aplicadas); **harness pairwise offline pendente**. Acumulando (0 resolvidos hoje).
- **P1.2** Deduplicar sinais: dropar/renomear `personal_fit` (=`tag_overlap_net` percentil), remover `computePersonalFit`, decidir se `chance_score` fica como *probabilidade* (não eixo). (C3/C4)
- **P1.3** Unificar mood num só mecanismo, **visível e reversível** (chips), com efeito explicável. (C6)
- ✅ **P1.4** Tornar filtros default visíveis. (C8) → **FEITO (PR #85):** chips de filtros default (selo PADRÃO, removíveis via URL) na view **Faixas**. *(Falta replicar na Lista.)*
- 🔄 **P1.5** Validar a banda de tier empiricamente (curva acurácia pairwise × Δ) em vez de 0,5 decretado; colapsar a exibição em 3–4 bandas. (C1) → **PARCIAL (PR #85):** exibição em bandas feita (view **Faixas**); **validação empírica da largura depende dos snapshots resolvidos** (0 hoje).

### P2 — Melhoria importante (arquitetura/custo/testes)
- **P2.1** Cache de resultado nos Sonnet recorrentes + `synopsis_quality`→Haiku. (I1/I2/I3)
- **P2.2** Consolidar scores por tela (um headline coerente) e fundir `decision_score` na Prevista. (C7)
- **P2.3** Testes de regressão de ranking + teste de "expected supera calc". (§15)
- **P2.4** Tirar ♥ do `calc_score` (já é feature do Ridge). (C5)
- **P2.5** Alinhar CHECK `category_scores.source` ao enum TS. (D2)
- **P2.6** Sanitizar/delimitar texto externo antes do prompt. (S3)

### P3 — Evolução futura (só depois da base medida)
- Decidir manter/matar Ridge/chance/Bússola **com base no lift medido** sobre calc+tag. Se não houver lift, simplificar radicalmente.
- Multi-user real (adicionar `user_id` ao core) — grande, só quando houver demanda.
- ML mais sofisticado (embeddings/kNN) — só se n_rótulos ≫ features e o baseline for insuficiente (hoje não é justificável).

---

## 20. Proposta de arquitetura / fórmula alternativa

**Princípio:** não um score único — **componentes separados e medidos**, exibidos como poucas bandas honestas + "porquê". Priorize simplicidade explicável.

### 20.1 Componentes (em vez de 1 número dressed-up)
| Componente | Como | Escala | Dados ausentes | Votos |
|---|---|---|---|---|
| **Q — Qualidade** | manter `calc_score` (Bayesian pooling plataforma + GPT.N) — é a âncora honesta, tem σ=1,6 (discrimina) | 0–10 | sem 9 critérios → não mostra Q fina | √votos + prior (já tem) |
| **F — Fit pessoal** | UM sinal: net tag overlap (amado − 1,5×evitado) por **percentil** (robusto, não min-max) | 0–100% | perfil vazio → oculta F | — |
| **C — Confiança/Dados** | flag de cobertura (tem 9 critérios? votos? reviews?) — decide *se* mostra score fino | badge | — | usa nº votos como confiança |
| **P — Popularidade** | log-votos (alcance) — já existe em `forces.ts` | 0–100 | 0 votos → null | log (correto) |

### 20.2 Apresentação
- **3–4 bandas de prioridade a partir de Q** (largura validada por curva pairwise, não decretada), **decimais escondidos dentro da banda**.
- Dentro da banda, ordenar por **F** — e **medir** que F ordena melhor que aleatório intra-banda (hoje não há essa prova).
- Mostrar **"porquê"**: tags amadas casadas, tags evitadas presentes (risco), cobertura de dados.
- **Mood = 1 re-rank explícito e limitado**, visível (não filtro escondido), unificando preset+drawer.

### 20.3 Como calibrar e validar
- **Calibrar pesos:** só quando `prediction_snapshots` acumular desfechos; usar OOF/nested-CV (já existem).
- **Validar melhoria (objetivo):** A/B prospectivo — logar ranking + `user_score` eventual; computar **acurácia pairwise, NDCG@k e regret vs baselines** (calc, popularidade, tags+qualidade) com IC. O sistema **melhorou** sse o lift sobre o melhor baseline for positivo e o IC não incluir 0.
- **Crescer rótulos:** loop leve de "prefiro A ou B" / joinha — é o insumo que destrava tudo.

### 20.4 Migração sem quebrar
1. **Fase 0 — instrumentar** (sem mudança de UX): ligar snapshots + harness pairwise.
2. **Fase 1 — deduplicar + revelar** (baixo risco): dropar coluna fantasma, chips de filtro, esconder decimais.
3. **Fase 2 — recompor headline** atrás de flag: Q-bandas + F re-rank + mood unificado; A/B vs atual via snapshots.
4. **Fase 3 — podar**: manter só o que mediu lift; matar Ridge/chance/Bússola se colineares sem ganho.

*Técnicas já presentes e a manter:* Bayesian average, shrinkage/L2, Platt, OOF/nested-CV. *A adicionar:* percentil robusto no fit, medição prospectiva, wilson/beta só se surgir sinal binário com votos. *A não adicionar agora:* embeddings/kNN/agentes — sem lift demonstrado sobre o simples.

---

## 21. Perguntas em aberto e informações ausentes

1. **Rótulos:** 207 é o teto de tudo. Há apetite para um fluxo de feedback (pairwise/joinha) que cresça isso?
2. **Desfecho real:** o sistema não sabe se uma recomendação *deu certo* (não há sinal "gostei do que li a partir da rec"). Sem isso, "melhorou" é inmensurável.
3. **Universo de uso:** o usuário quer ranquear entre `Completed` ou incluir Ongoing? O default atual auto-sabota a dispersão.
4. **Bússola/Chance:** o valor delas é *decisão/textura* (2D risco×aposta) ou *predição*? Se textura, ok mantê-las visuais mas parar de tratá-las como eixos ortogonais.
5. **`ai_api_calls` só tem 5 dias** — a tabela é rolling/limpa? Impacta análise de custo histórico.
6. **Deploy:** vai ser exposto publicamente (Fly)? Isso define se S1/S2 são P0 reais agora.

---

## Respostas explícitas (item 11 do brief)

1. **Maior problema hoje:** a ordenação fina do ranking é estatisticamente indistinguível de ruído (σ da Nota Prevista ≈ o próprio erro do modelo), e a maquinaria sofisticada (Ridge, chance, Bússola, decision) é redundante com um score determinístico simples (r=0,96) e com o overlap de tags. O produto promete diferenciar dentro de um conjunto semi-filtrado — e é exatamente aí que ele não diferencia.
2. **Maior impacto positivo:** instrumentar medição prospectiva + crescer rótulos (loop pairwise) e, com isso, provar/refutar lift sobre baselines simples. É a única mudança que destrava todas as outras — nenhuma fórmula nova se justifica sem ela.
3. **Sofisticado com pouco valor:** a Bússola 2D "3 forças", o `chance_score` logístico e o `decision_score` — todos colapsam sobre calc/tag-overlap; e a fórmula de 3 componentes do `personal_fit`, que nem roda. O plano 2D sugere ortogonalidade que os dados não têm.
4. **Maior risco de custo:** `review_digest` (50% do gasto atual, valor marginal no ranking) e a cascata `generate-all` re-gastando passos sem cache; `synopsis_quality` em Sonnet. E, se exposto, actions pagas sem auth/rate-limit = denial-of-wallet.
5. **Os cálculos são confiáveis?** Para *bandas grossas de prioridade*, sim. Para a *ordem/decimais exibidos*, não — é ruído dentro do erro. A metodologia (OOF, shrinkage) é sólida; o problema é exigir precisão que 207 rótulos + baixa dispersão não sustentam.
6. **Abordagem de scoring mais adequada:** componentes separados (Qualidade / Fit / Confiança / Popularidade) exibidos como 3–4 bandas validadas + "porquê", com fit como re-rank ortogonal *medido*; manter Bayesian/shrinkage; adiar ML até rótulos crescerem.
7. **Está ajudando a escolher a melhor obra?** Parcialmente: bom em "estas valem seu tempo", fraco em "leia ESTA a seguir", e sem prova de que personaliza acima de um filtro simples.
8. **Como provar objetivamente que melhorou:** A/B prospectivo em `prediction_snapshots` — logar ranking + nota eventual do usuário e comparar acurácia pairwise / NDCG@k / regret contra baselines (calc, popularidade, tags+qualidade) com IC; complementar com harness offline pairwise para acumular rótulos e medir lift honestamente.

---

*Anexos de evidência: correlações e distribuições medidas via SELECT read-only em `calculated_scores`/`works` (2026-07-08); custo via `ai_api_calls`; núcleo de cálculo lido em `lib/calculations/*` + `server/actions/calculations.ts`; ranking em `server/queries/ranking.ts` + `lib/ranking/*`; segurança/schema/IA por sub-auditorias com citações `arquivo:linha`. tsc exit 0 · lint prod limpo · vitest 1370/3/24.*
