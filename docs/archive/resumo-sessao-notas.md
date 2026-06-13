# Resumo — Re-arquitetura de Notas & Recomendação

> Sessão de **2026-05-29** (branch `feat/fase-1.5-impl`). Consolida o que estava planejado
> (sessões de 27–28/05 no worktree `/animedb`), o que foi implementado agora, e o que ficou
> pendente. Plano de execução detalhado: [plan-arquitetura-notas.md](plan-arquitetura-notas.md).

---

## 1. O que estava planejado (origem)

Os planos vieram das sessões anteriores (worktree `/Users/geners/Code/VibeMatch/animedb` +
`~/.claude/plans/`):

- **`~/.claude/plans/pode-me-explicar-em-harmonic-bubble.md`** — o **plano-mestre**: re-arquitetura
  em **4 camadas** com papéis explícitos, substituindo o trio legado Nota.IA/Pr/Final/IA Rk.:
  - **L0** — AI Evaluation (9 atributos por obra, já existia).
  - **L1 `expected_score`** — predição offline (Ridge), a única nota de previsão.
  - **L2 `fit_score`** — alinhamento determinístico com o TasteProfile (= personal_fit).
  - **L3 `match_score`** — consultor LLM sob demanda (Smart Shortlist + Deep Dive + mood).
  - **Free vs Pago**: Free = previsão estatística + TasteProfile heurístico; Pago = TasteProfile LLM
    + **L0+** (IA estima qualidade das não-lidas) + consultor + mood.
  - **Modelo de faixa**: os 9 atributos predizem a *faixa* de quanto o user vai gostar; os 8
    critérios de qualidade afinam dentro dela (mas só existem pós-leitura).
  - **Form pós-leitura de 17 campos** (9 atributos + 8 qualidade) e **bias calibration**.
- **`plan-fase-1.5.md`** (raiz do repo) — bias calibration: questionário pós-leitura + offset
  por atributo com shrinkage.
- **`plan-deep-dive.md`** — o Consultor IA Deep Dive (L3 modo B), implementado nas sessões anteriores.
- **`plan-layout-tabelas.md`** — melhorias de layout nas tabelas (paralelo).

---

## 2. O que foi implementado nesta sessão

### Fase 1.5 — Bias calibration (✅ completa)
- Migrations **074–077**: `user_settings`, `user_attribute_assessment`, `attribute_bias`,
  `calculated_scores.alignment_stale`.
- Offset por atributo com shrinkage Bayesiano (k=10), aplicação **source-aware** on-read
  ([calibrated-scores.ts](lib/ai-recommendation/calibrated-scores.ts)); propagado ao Ridge,
  criterion_fit, personal_fit e prompts LLM (calc_score fica cru).
- UI: questionário pós-leitura dos 9 atributos, painel de offset, **4 guards** de degradação,
  botão de regenerar artefatos.
- **Backfill** de 432 avaliações históricas (edições + concordâncias, sem viés de seleção).

### Bloco 1 — `expected_score` como referência (✅)
- **Fase A**: headline "Precisão da Previsão" = **MAE CV honesto do expected_score** (não mais o
  LOOCV circular da stacker); ratio L1/FINAL rebaixado a legado/não-gate.
- **Fase B**: o Smart Shortlist passou a receber **Nota Esperada + fit** (não a Nota.Pr circular);
  pool de candidatos por `expected_score`.

### Bloco 2 — Free vs Pago (✅ diferenciação enforced)
- Migration **078**: `user_settings.user_plan` (free|paid; dev = paid).
- **Fonte única de capabilities** ([lib/plans/capabilities.ts](lib/plans/capabilities.ts)) +
  `ensureCapability` (gate de servidor) + gate de UI.
- Gated como Pago: Smart Shortlist, Deep Dive, mood.
- **TasteProfile heurístico** (Free, zero LLM): loved/avoided_tags via point-biserial,
  criterion_preferences via quartis. Pago continua LLM.

### L0+ — qualidade IA pras não-lidas (⛔ construído, medido, DESLIGADO)
- Migration **079** (`ai_quality_predictions`) + estimador + backfill (553 obras estimadas).
- Ridge condicional ao plano + **MAE CV honesto** (held-out previsto com qualidade estimada,
  quebrando a circularidade).
- **Resultado negativo:** MAE CV honesto **0.63** vs baseline **0.52** → a qualidade via
  sinopse/tags **adiciona ruído**. Desligado via flag `L0_QUALITY_ENABLED=false`; infra mantida
  parada pra um eventual **v2 baseado em reviews**.

> **Precisão atual da previsão (honesta): ~0.52** (MAE CV da Nota Esperada, sem circularidade).

---

## 3. O que ficou pendente

### Fase C — Coerência de UX (não-bloqueante, médio valor)
- **Página da obra** ainda lidera com N.IA/Prevista/N.Final → trocar por **Esperada/Fit/Match**
  (legado recolhível), como o ranking já faz. *(maior valor restante)*
- Fundir os dois forms pós-leitura (8 qualidade + 9 atributos) num único fluxo "Terminei de ler".
- Deep Dive receber `expected_score` no prompt.
- Ranking Free com sort padrão `expected × (0.6 + 0.4·fit)`.

### Fase E — Cutover de legado (baixo valor, por último)
- Aposentar calc/pred/final do cálculo (ou rebaixar a features internas do expected).
- Formalizar nomes no DB (`fit_score`/`match_score`).

### Loose ends
- Botões "Recomendar com IA" (/ranking, /favorites) + cell de rerank único: gateados no servidor,
  mas não escondidos na UI pro Free.

### Futuro / opcional
- **L0+ v2 baseado em reviews** (única versão que poderia ajudar a previsão).
- Fase F: GBM no L1, embeddings de reviews como feature.
- Fase 1.5.6: `ai_edited` como fonte secundária de bias (não necessário — cobertura ok).

---

## 4. Aprendizado-chave da sessão

A infraestrutura de **métrica honesta** (Bloco 1 Fase A + a CV não-circular) foi o que permitiu
**descobrir que o L0+ via sinopse/tags não funciona** — sem ela, teríamos shipado um `0.11` falso
(circular) e degradado a previsão sem perceber. "Qualidade de execução" não é prevísivel
pré-leitura a partir da mesma informação que o modelo já tem.
