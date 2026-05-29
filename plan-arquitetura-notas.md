# Arquitetura de Notas & Recomendação — Plano Consolidado

> **Core:** `~/.claude/plans/pode-me-explicar-em-harmonic-bubble.md` (planejado em 27/05).
> **Esta versão (28/05)** mantém a arquitetura-alvo daquele plano e a reconcilia com o
> estado atual do código (após as sessões de 27–28/05 + a Fase 1.5 de bias calibration).
> Supersede o harmonic-bubble como referência de execução.

---

## 1. Os 2 objetivos do produto

| Objetivo | Pergunta | Característica |
|---|---|---|
| **A. Predição** | "Se eu lesse, que nota daria?" | Offline (sem LLM no cálculo), estável, base inteira |
| **B. Recomendação** | "Qual devo ler agora?" | Top-K, considera mood (Pago) ou filtros (Free) |

Tudo abaixo serve a esses dois. Qualquer nota/cálculo que não sirva a A ou B é **legado** e deve sumir após cutover.

## 2. Arquitetura-alvo — 4 camadas

```
L0  AI Evaluation        — Claude gera 9 preference_scores por obra (1×, cache)   [EXISTE]
L0+ AI Quality Eval      — Claude estima 8 quality_scores p/ NÃO-LIDAS (Pago)     [FALTA]
 ▼
L1  expected_score       — Ridge offline, target=user_score. Substitui IA/Pr/Final [EXISTE, ver §5]
 ▼
L2  fit_score            — Alinhamento determinístico c/ TasteProfile (=personal_fit) [EXISTE]
 ▼
L3  match_score          — Consultor LLM sob demanda, top-K (=alignment_score/IA Rk) [EXISTE p/ Deep Dive]
```

**Ordenação:**
- **Free:** `expected_score × (0.6 + 0.4·fit_score)`
- **Pago:** `expected×0.5 + fit×0.2 + (match/10)×0.3` (quando L3 rodou no top-K)

## 3. Os 2 eixos ortogonais (o modelo conceitual)

| Eixo | Dims | Significado | Papel | Quem avalia |
|---|---|---|---|---|
| **PREFERÊNCIA** | 9 atributos (escolhidos pelo user) | "Quão presente é cada aspecto que ME interessa" (romance, drama, humor…) | Define a **faixa** esperada → drive do L2 (fit) | L0 IA + **user pós-leitura** ✅ |
| **QUALIDADE** | 8 critérios (universais) | "Quão bem-feita ela é" (story, pacing, art…) | **Afina** dentro da faixa → drive do L1 | user pós-leitura ✅ + **L0+ IA (Pago)** ❌ |

> **Modelo de faixa (validado hoje):** os 9 atributos predizem a *faixa* de quanto o user vai
> gostar (ex.: romance+fantasia+protagonista marcante → 7–10). Os 8 critérios de qualidade afinam
> dentro da faixa (7 vs 10), mas **só existem depois de ler**. Logo, para **não-lidas**, a predição
> honesta É a faixa; o afinamento por qualidade só é possível no **Pago** (via L0+, que estima a
> qualidade provável sem o user ter lido).

## 4. Free vs Pago

| Componente | Free | Pago |
|---|---|---|
| L0 — 9 preference_scores | ✅ | ✅ |
| **L0+ — 8 quality_scores (não-lidas)** | — | **❌ FALTA (+$0.012/obra)** |
| TasteProfile (gênero) | heurístico | LLM |
| TasteProfile.post_criterion_preferences (qualidade) | heurístico (≥5 obras c/ post-scores) | LLM |
| L1 usa qualidade? | **Não** (só proxies pré-leitura) | **Sim** (8 quality_scores) |
| L3 match_score / mood / Deep Dive | — | ✅ |
| MAE esperado (não-lidas) | ~0.7–0.9 | ~0.3–0.5 |

A diferença central do Pago: **previsão mais precisa** porque o L0+ estima a qualidade provável
de obras não-lidas, estreitando a faixa. Hoje **nada disso de pago existe** — o sistema é
efetivamente o Free (sem L0+).

---

## 5. STATUS ATUAL (28/05) — feito / divergiu / falta

### ✅ Já implementado
| Item do plano | Estado | Onde |
|---|---|---|
| L1 `expected_score` (single Ridge + decomposição) | Vivo | migrations 066–068, [expected.ts](lib/calculations/expected.ts) |
| Pesos aprendidos (score_weights_auto) | Vivo | migration 069, [calculations.ts](server/actions/calculations.ts) |
| L2 `fit_score` (=personal_fit + percentil) | Vivo | migration 071, [personal-fit.ts](lib/ai-recommendation/personal-fit.ts) |
| L3 **Deep Dive** (Modo B) | Vivo | migration 072, `lib/ai-recommendation/deep-dive*` |
| L3 Smart Shortlist (Modo A) | Vivo | alignment_score, [llm-reranker.ts](lib/ai-recommendation/llm-reranker.ts) |
| **Bias calibration** (= "Fase 1.6" do plano) | Vivo, **versão superior** | migrations 074–077; ver §6 |
| **Form pós-leitura dos 9 atributos** (= UX "Fase 1.6") | Vivo (parcial) | [post-attribute-assessment-form.tsx](components/titles/post-attribute-assessment-form.tsx) |
| UI calibração (offset + 4 guards) | Vivo | [/settings/calibration](app/settings/calibration/page.tsx) |
| ranking-config já marca legado | Vivo | [ranking-table-config.ts](components/ranking/ranking-table-config.ts) |

### ⚠️ Divergiu do plano
1. **L1 removeu os 8 quality post-scores** (revisão 28/05 em [expected.ts](lib/calculations/expected.ts#L4)). O plano (§L1) dizia "single Ridge com 22 features incl. 8 qualidade" → ratio 0.98×. O código removeu → ratio **5.28×**. **Mas isso é coerente** com a tabela Free/Pago do próprio plano (Free L1 não usa qualidade), e foi a decisão **correta**: os post-scores são imputados→0 nas não-lidas → o modelo colapsava no intercepto 8.0. O plano tinha uma **contradição interna** (§L1 vs tabela Free/Pago); o código resolveu a favor da correção em não-lidas.
2. **Bias storage:** o plano sugeria `formula_config.criterion_bias` (mean simples). Implementei mais rico — ver §6.
3. **quality_adj da decomposição é sempre 0** (consequência da remoção dos post-scores). Coluna `expected_quality_adj` existe mas não varia.

### ❌ Falta (o gap real)
| Gap | Impacto | Objetivo |
|---|---|---|
| **L0+ (IA estima 8 quality_scores p/ não-lidas)** | Sem isso o Pago não existe; predição não tem como afinar a faixa | A (Pago) |
| **Recomendação consome o legado** | pool por `final_score`; LLM recebe `Nota.Pr` (circular), **não** o expected_score | **B** |
| **Métrica enganosa** | headline "0.12" é LOOCV da stacker circular, não o MAE OOF honesto do expected | indicador |
| **Página da obra desalinhada** | exibe N.IA/Prevista/N.Final como principais; nem mostra a Esperada | UX |
| **Form pós-leitura partido em 2** | 8 critérios (work-status-form) + 9 atributos (card novo) separados | UX |
| **Cutover de legado** | calc/pred/final/knn ainda computados como notas paralelas | limpeza |

---

## 6. Bias calibration — o que existe (supera o plano)

O plano previa `criterion_bias = mean(user − ai)` em `formula_config`. A Fase 1.5 implementou versão mais robusta:
- **`user_attribute_assessment`** (migration 075): snapshot por (obra, atributo) do valor do user + valor/modelo/prompt da IA. 432 linhas já backfilladas (48 obras revisadas, incluindo concordâncias como delta 0).
- **`attribute_bias`** (migration 076): offset por atributo com **shrinkage Bayesiano** (`bias_applied = mean × n/(n+10)`), n_samples, stddev.
- **Aplicação source-aware** ([calibrated-scores.ts](lib/ai-recommendation/calibrated-scores.ts)): corrige só `ai_accepted`/`ai_calibrated`; pula `manual`/`ai_edited`/`imported`.
- **Propagado** ao Ridge (features), criterion_fit, personal_fit e prompts LLM (Smart Shortlist + Deep Dive). calc_score (Nota.IA) fica cru de propósito.

> Insight medido: como o bias é um offset **constante por feature**, o Ridge linear o **absorve** →
> quase não muda `expected_score`/MAE. O ganho real do bias aparece em **fit_score** e nos **prompts
> LLM** (não-lineares), não na predição linear.

---

## 7. Roadmap atualizado

Fases marcadas conforme estado real. Ordem por valor/dependência.

### ✅ Fase 0 (concluída) — fundação
L1 expected_score, decomposição, pesos auto, fit_score+percentil, Deep Dive, bias calibration, form 9-atributos, UI calibração.

### 🔜 Fase A — Honestidade da métrica *(baixo risco, só medição)*
- Computar **MAE out-of-fold do expected_score** (via `ridgeOutOfFoldPredictions`) e torná-lo o headline "Precisão" em [/settings/calibration](app/settings/calibration/page.tsx).
- Rebaixar calc/pred/final-MAE e o RATIO L1/FINAL pra um bloco "Legado (diagnóstico)".
- **Critério:** painel mostra a precisão real pra não-lidas (provavelmente pior que 0.12 — e tudo bem).

### 🔜 Fase B — Recomendação consumir o expected *(corrige a contradição do Obj.B)*
- Prompt do Smart Shortlist + Deep Dive: enviar **`expected_score`** (e `fit_score`) em vez de `Nota.Pr` ([prompts.ts](lib/ai-recommendation/prompts.ts), [deep-dive-prompts.ts](lib/ai-recommendation/deep-dive-prompts.ts)).
- Selecionar o pool de candidatos por `expected_score` ([recommendations.ts](server/queries/recommendations.ts) / [ranking.ts](server/queries/ranking.ts)).
- Ranking Free: ordenar por `expected × (0.6 + 0.4·fit)`.
- **Critério:** logs mostram o expected (não a Nota.Pr) guiando o LLM.

### 🔜 Fase C — Unificar UX *(coerência entre telas)*
- Página da obra exibir **Esperada / Fit / Match** como principais; N.IA/Pr/Final em "Legado" recolhível (igual ranking já faz).
- Fundir os dois forms pós-leitura num único fluxo "Terminei de ler" (8 qualidade + 9 atributos, um submit).

### 🔜 Fase D — Plano Pago: L0+ *(a peça que falta pra "predição rica")*
- Estender o prompt do AI Eval ([service.ts](lib/ai-evaluation/service.ts)) pra também estimar 8 quality_scores (`source='ai_predicted'`, +$0.012/obra) — sem call extra.
- L1 Pago consome quality_scores → afina a faixa pra não-lidas (MAE ~0.3–0.5).
- TasteProfile LLM popula `post_criterion_preferences`.
- Flag `user_plan: free|paid` em `user_settings` (já tenho a tabela singleton da Fase 1.5).
- **Critério:** ratio expected Pago ≤ 1.0× Free (qualidade deve ajudar).

### 🔜 Fase E — Cutover de legado *(só depois de A–D validados)*
- Aposentar calc/pred/final do cálculo (ou rebaixar a features internas do ensemble do expected).
- Renomear DB: `predicted_score→` (manter), formalizar `fit_score`/`match_score`.
- expected_score como **faixa** `[min,max]` + ponto (Free = faixa larga; Pago = estreitada pelo L0+).

### Fase F (futuro) — GBM no L1, embeddings de reviews como feature.

---

## 8. Resolvendo as redundâncias (5 preditores → 1)

| Nota legada | Destino |
|---|---|
| `predicted_score` (Nota.Pr, circular via meanPostScore) | aposentar como nota; sinal honesto pode virar input de ensemble |
| `final_score` (stacker) | ensemble do expected (expected+knn), não Ridge separado |
| `knn_score` | **ensemble honesto** com o expected (ambos servem não-lidas) |
| `calc_score` (Nota.IA) | fallback cold-start (<20 labels) + display opcional |
| `ia_eval_normalized` | feature interna |

**Não fazer:** religar post-scores no expected Free (colapsa não-lidas) ou criar features circulares pra "melhorar" o MAE.

---

## 9. Verificação (por fase)
1. **Custo real:** logar usage por call (já existe `ai_api_calls`).
2. **Precisão honesta:** MAE OOF do expected vs user_score no painel (Fase A).
3. **Obj.B:** confirmar que o LLM recebe expected_score (Fase B).
4. **Pago:** ratio expected Pago ≤ Free (Fase D).
5. **Drift:** guards da Fase 1.5 (modelo/prompt, cobertura, amostra, MAE).
6. **Tests:** `tests/unit/calculations/` pra cada mudança de cálculo.

---

## Apêndice — referências
- Plano-mestre original: `~/.claude/plans/pode-me-explicar-em-harmonic-bubble.md` (custos detalhados, prompts do consultor, viz de feature importance — não duplicados aqui).
- Bias calibration: `plan-fase-1.5.md` + `~/.claude/plans/quero-implementar-um-plano-vivid-pebble.md`.
- Deep Dive: `plan-deep-dive.md`.
