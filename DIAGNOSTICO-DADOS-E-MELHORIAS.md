# 📊 Diagnóstico de dados + melhorias — SatorIA

> **Atualizado 2026-06-29** · sondagem **read-only fresca ao banco** (815 obras) · somente fontes mais novas. Nada foi alterado no projeto além deste documento.
>
> ✅ **Fontes usadas (as mais novas):** `PLANO-E1-PRODUCAO.md` (28/06) · `MAPA-DADOS-E-ROADMAP.md` (27/06) · `HANDOFF-OTIMIZACAO-E-DIGEST.md` (27/06) · `PLANO-MESTRE … §24m` (27/06) · memória consolidada `project_status_2026_06_28` · **código verificado** (`file:line`).
> ❌ **Descontinuadas (números velhos):** `AUDITORIA-CICLO-VIDA-DADOS.md` (18/06) · `AUDIT_REPORT.md` (17/06) · `OLD-PLANO-ATUAL.md` / `OLD-PLANO.md`. *(`STATUS-2026-06-28.md` é citado como canônico pela memória, mas não existe nesta branch.)*

---

## 📈 Estado atual (sondagem de hoje, 815 obras)

| | Antes (auditoria 18/06) | **Agora (29/06)** |
|---|---|---|
| 📚 Obras não-arquivadas | 734 | **815** |
| ⭐ Com nota sua (treino do Ridge) | 192 | **201 (25%)** |
| 📝 Digest de reviews | **2%** 😱 | **63%** 🚀 |
| 📄 Resumo de reviews | 68% | **78%** |
| ✍️ synopsis_quality (manual) | 89% | **100%** |
| 💔 Previsões de Interesse "velhas" | 80% | **97%** ⚠️ |
| 🧬 Perfil de gosto | v6 (05/jun) | **v18 (28/jun)** |

> **O digest deixou de ser o gargalo** (já backfillado via rollout do e1). O gargalo agora é o **loop de staleness do Interesse**: o perfil regenerou e nada re-prevê sozinho → 97% velho.

---

## 🎯 Backlog consolidado de oportunidades

> Todas as oportunidades que identificamos, num lugar só. **Status:** ✅ pronta p/ implementar (desenho fechado, baixo risco) · 🧪 precisa validação/medição antes · 📋 operacional (rodar, não codar) · 💭 ideia (mais distante). *(confiança: ✅/📋 ≈ [FATO] verificado · 🧪/💭 ≈ [HIP] a validar)*
> Detalhe de cada uma nas seções/anexos referenciados.

| ID | Oportunidade | Tipo | 💲 | Esforço | Impacto | Status | Ref |
|---|---|---|---|---|---|---|---|
| **DRIFT-GATE** | Gate do perfil por `driftPct` (corta o $0,47 **e** a cascata de 97%-stale na raiz) | custo+corretude | $0 (+mig opc) | trivial | **🔥 muito alto** | ✅ | Anexo 8.1 |
| **G1** | Sequenciar Interesse **após** as tags no create (=O5) | corretude | $0 | baixo | médio | ✅ | Anexo 6/8.3 |
| **G2** | Add/edit review marca o **Veredito** stale | corretude | $0 | baixo | médio | ✅ | Anexo 6/8.3 |
| **G3** | Flag `ai_eval_inputs_stale` p/ mudança de tag/sinopse | corretude | $0 +1 col | baixo | médio | ✅ | Anexo 6/8.3 |
| **O6** | `infer-tags --execute` marcar `recalc_pending` | corretude | $0 | trivial | baixo | ✅ | §5 |
| **O7** | `updateWorkStatus` marcar `alignment_stale` | corretude | $0 | trivial | baixo | ✅ | §5 |
| **R2** | Remover `computePersonalFit` (código morto) | limpeza | $0 | trivial | baixo | ✅ | §5 |
| **CAPA-FB** | Capa alternativa qdo host bloqueado (recupera os 22%) | dados | $0 | baixo | médio | ✅ | Anexo 1 |
| **C2** | Gerar resumo só como **fallback** do digest | custo | $0 | baixo | baixo | ✅ | §5 |
| **C3** | Gate da Avaliação IA por hash (não re-avaliar inputs inalterados) | custo | $0 | baixo | baixo | ✅ | §5 |
| **DOC-FIX** | Corrigir seção stale do Alinhamento no MAPA (+R1) | doc | $0 | trivial | baixo | ✅ | §2 |
| **INT-MAG** | `interestStaleMagnitude`: re-previsão **seletiva** do Interesse | custo+corretude | médio | médio | **alto** | 🧪 calibrar τ | Anexo 7/8.2 |
| **L1** | Create sem recalc global p/ obra sem nota | latência | $0 | médio | médio-alto | 🧪 medir | §5 |
| **D2** | Veredito IA pra desempatar o **topo** | diferenciação | uso | médio | alto | ✅ validado | §5 |
| **D1** | Treinar p/ **ranking** (NDCG) em vez de MAE | diferenciação | $0 | alto | **alto** | 🧪 OOF+lift | §5 |
| **D3** | Re-pesar critérios por **variância discriminante** | diferenciação | $0 | baixo | médio | 🧪 OOF | §5 |
| **U2** | Features de **distribuição de reviews** no Ridge | dados | $0 | médio | médio | 🧪 OOF | §5 |
| **EXP-REGRAS** | Regras livres no **Interesse** (experimento) | diferenciação | ~$2 | médio | ? | 🧪 GO/NO-GO | Anexo 4 |
| **U1** | Cauda do digest + re-prever Interesse v1/v2→v3 | dados | ~$3–5 | — | médio | 📋 | §5 |
| **U4** | Ligar provenance `synopsis_quality_source` | dados | $0 | baixo | baixo | ✅/📋 | §5 |
| **D5** | Active learning (rotular o de maior incerteza) | dados | — | — | alto (longo) | 💭 contínuo | §5 |
| **D4** | Predição conformal/quantílica (tiers honestos) | diferenciação | — | alto | médio | 💭 | §5 |
| **U3** | Quality features pro subconjunto **lido** | dados | $0 | médio | baixo | 💭 | §5 |

**🥇 Por onde começar (melhor custo-benefício):** `DRIFT-GATE` (resolve o item mais caro **e** o 97%-stale trocando ~1 `if`) → depois os corretivos $0 (`G1/G2/G3/O6/O7/R2/CAPA-FB`) → depois `INT-MAG` → diferenciação com validação (`D2` pronto, `D1/D3/U2` com OOF) → dados/ops (`U1`, `U4`) → experimento `EXP-REGRAS` (sob autorização).

> 🧪 **Regra de validação** (vale p/ D1/D3/U2/EXP-REGRAS): só "conta" com **OOF sem leakage + baseline + lift**, nunca métrica in-sample.

---

## 1️⃣ 🔄 O que torna os dados "velhos" (stale)

**Regra de ouro:** 🆕 **criar** recalcula na hora · ✏️ **editar** adia (1h ocioso ou botão "Recalcular agora"). [works.ts:1081](server/actions/works.ts#L1081) vs `markRecalcPending`.

| Quando você… | …fica velho | 🚦 Como resolve |
|---|---|---|
| ✏️ Edita notas / critérios / tags / synopsis_quality | Nota Prevista, Nota.Calc, Alinhamento, GPT.N | 🟡 auto em 1h **ou** manual |
| 🤖 Re-roda avaliação IA | idem | 🟡 auto/manual |
| 💬 Muda o pool de reviews (após avaliar) | a **avaliação IA** ganha flag "Reviews novas" (`ai_eval_reviews_stale`, mig 120) | 🔴 só manual (re-avaliar, pago) |
| 🧬 **Muda o perfil de gosto** | **TODAS as previsões de Interesse** + Alinhamento do catálogo | ⛔ **GAP: marca velho, mas não re-prevê** (=97% velho) |
| 📖 Edita a sinopse | sinopse canônica → Interesse | 🟢 auto (`after()`) |
| 💬 Muda reviews | resumo, digest → Interesse (e1) | 🟢 auto no save |
| ✍️ Editar atributos da obra (`updateWork`) | **Veredito IA** (`alignment_stale`) | 🔴 só re-rank manual/pago · ⚠️ add-review e mudar-status **não** marcam (gaps G2/O7) |
| ⭐ **Salva uma nota sua** | **GLOBAL**: re-treina o modelo → Nota Prevista de **todas** as obras | 🟡 próximo recalc |

> 💡 Contra-intuitivo: **dar uma nota não é local** — muda o modelo e desloca a Nota Prevista do catálogo inteiro (nó 🟣 "global").

---

## 2️⃣ 🎛️ As variáveis dos outputs principais

| 🏷️ Nome na tela | 🤖 IA? | 📏 | O que é / como nasce |
|---|---|---|---|
| **Nota Prevista** (`expected_score`) | 🟢 ML local | 0–10 | **"Que nota VOCÊ daria"** — Ridge treinado nas suas 201 notas ⊕ Nota.Calc. **É o eixo do ranking.** MAE ~0,58–0,60. |
| Nota.Calc (`calc_score`) | 🟢 | 0–10 | Âncora interna: IA + média das plataformas (Bayesiano). Entra na Nota Prevista. |
| GPT.N / Nota.IA | 🟢 | 0–10 | Soma dos 9 atributos × seus pesos, amplificada `5+(x−5)×1.25`. |
| **Alinhamento** (`personal_fit`) | 🟢 | 0–1 | Tags **amadas − 1,5×evitadas** (por nome) → normalizado → percentil. *Mesmo sinal que `tag_overlap_net` (cru).* |
| **Veredito IA** (`alignment_score`) | 🟠 pago | 0–100 | LLM lê reviews/sinopse e julga. **Forte só no TOPO** (precision@5 = 1,0). Para diferenciar e explicar. |
| **Interesse na Obra** | 🟠 | ♥–♥♥♥♥ | Quão a sinopse te atrai. Hoje **e1/v3** = perfil + sinopse + tags + **digest**. |
| Tiers / Prioridade | 🟢 | — | Faixas da Nota Prevista (combate saturação); desempate por tags. |
| **MAE** | — | ~0,58 | Erro médio da Nota Prevista (confiança do modelo). |
| Preferências (`taste_profile`) | 🟠/🟢 | — | Tags amadas/evitadas + faixas de critério. Base de Alinhamento, Interesse e Veredito. |

> ⚠️ **Pegadinhas:** (1) filtros `min_final_score`/`min_calc_score`/`min_predicted_score` têm nomes **trocados** vs. o que mostram — não renomear. (2) `computePersonalFit` (fórmula de 3 componentes) foi **REMOVIDA em 15/08/2026**; era código morto desde o PR #16 — o Alinhamento hoje é `netNameOverlap` ([calculations.ts:1091](server/actions/calculations.ts#L1091)); a seção "detalhe" do MAPA ainda descreve a fórmula antiga (contradição conhecida).

**9 atributos (critérios):** `romance · couple_dynamics · fantasy_nobility · action_adventure · adult_content · protagonist · humor · drama · tragedy`.

---

## 3️⃣ 🛠️ Ordem mais eficiente

```
 CRIAR uma obra:
 ①  Criar (título + sinopse)
 ②  Dados externos (IDs)
 ③  Reviews ──▶ digest + resumo        ◀── em série
 ④  Tags (declaradas + IA da sinopse)  ◀── ANTES do Interesse!
 ⑤  Avaliar atributos IA → category_scores
 ⑥  Recalcular  (Nota Prevista + Alinhamento)  ◀── UMA vez só
 ⑦  Interesse na Obra (e1)
 ⑧  Veredito IA (pago)                 ◀── por último (qualquer edição o invalida)
 ⑨  Tiers aparecem no ranking
```

- **Por que:** tags e digest **alimentam** o Interesse → se vierem depois, a previsão nasce velha. O Veredito vai por último porque qualquer mudança o invalida.
- ✏️ **Ao ATUALIZAR:** os scores ficam velhos até "Recalcular" (ou 1h). **Agrupe** edições — 10 edições + 1 recalc ≫ 10 recalcs.

---

## 4️⃣ ❤️ Média dos atributos das obras que você mais amou (♥ ≥9, n=23)

| Atributo | Favoritos | Catálogo | Diferença |
|---|---|---|---|
| 🏰 **fantasy_nobility** | **8,52** | 7,29 | 🔥 **+1,23** |
| ⚔️ action_adventure | 5,39 | 4,58 | ⬆ +0,81 |
| 🦸 protagonist | 8,20 | 7,57 | ⬆ +0,63 |
| 😂 humor | 5,87 | 5,54 | ⬆ +0,33 |
| 🎭 tragedy | 3,61 | 3,33 | ➖ +0,28 |
| 💕 romance | 7,80 | 7,62 | ➖ +0,18 |
| 🎬 drama | 6,46 | 6,33 | ➖ +0,13 |
| 💑 couple_dynamics | 6,80 | 6,75 | ➖ +0,05 |
| 🔞 **adult_content** | **4,85** | 5,62 | ⬇ **−0,77** |

🎯 **Seu DNA de gosto:** *fantasia palaciana europeia 🏰 + protagonista forte 🦸 + pouco conteúdo adulto/trágico.* Tags mais frequentes: **Webtoon colorido · ambiente europeu · nobreza/realeza · elenco feminino · transmigração/isekai · "male lead falls first"**.

> ⚠️ Como seu catálogo **já é todo curado por você**, romance/drama aparecem altos em tudo → o que **realmente** te distingue é `fantasy_nobility`. (Baixa dispersão, std≈0,67.)

---

## 5️⃣ 💡 Melhorias sugeridas

🔴 ganho rápido/barato · 🟠 maior (exige validação OOF + baseline/lift) · ✅ já validado empíricamente

### ⚡ Latência
- 🔴 **L1** — não recalcular o catálogo inteiro ao criar obra **sem nota** (ela não muda o modelo). Recalc global só ao salvar uma nota; deferir percentis ao caminho de 1h.

### 💰 Custo de chamadas
- 🔴 **C1** — gate por **drift** do perfil (mig 118): só re-prever o Interesse quando o perfil mudar de verdade (hoje 1 regen marca 97% como velho).
- 🔴 **C2** — gerar **resumo de reviews só como fallback** do digest (hoje gera os dois sempre).
- 🔴 **C3** — não re-avaliar atributos com inputs inalterados (a flag `ai_eval_reviews_stale` já ajuda a focar).

### ♻️ Redundância
- ✅ **R2** — remover `computePersonalFit` (**código morto**, sem callers). **FEITO em 15/08/2026**,
  junto com `tagAlignment`/`profileConsistency`, que só ela usava. O custo de ter esperado 5
  semanas: o docstring do módulo e o tooltip do `/ranking` descreviam a fórmula DELA como se
  fosse a vigente. O teste não foi apagado — foi repontado pras três funções vivas, porque duas
  das seis asserções eram a única cobertura de `criterionAlignment`.
- 🔴 **R1** — documentar que Alinhamento e "desempate por tags" são **o mesmo sinal** (um normalizado), não alavancas independentes.

### 🎯 Diferenciação (a dor: tudo parecido no topo)
- 🟠 **D1** — treinar o modelo pra **ordenar** (pairwise/NDCG), não pra acertar o número (MAE). O uso é ranking.
- ✅ **D2** — **usar o Veredito IA pra desempatar o TOPO.** Re-medido (n=112): global fraco (pairAcc 0,576) mas **topo é o melhor sinal (precision@5=1,0 / @10=0,80)** → manter, usar onde funciona.
- 🟠 **D3** — pesar mais os atributos que **separam** (fantasy_nobility, action) e menos os saturados (romance/drama). ⚠️ validar fora-da-amostra (risco de circularidade).
- 🟠 **D4/D5** — predição conformal (tiers honestos + flag de baixa confiança) · **active learning** (rotular primeiro o de maior incerteza — *mais rótulos* é a alavanca dominante).

### 🗂️ Usar melhor os dados
- 🟠 **U2** — features de **distribuição de reviews** no Ridge (variância, % positivas, nº/fonte), **grátis**: separa "todos deram 7,5" de bimodal "metade 10/metade 5".
- 🔴 **U1** — terminar a **cauda do digest** (~60–130 obras) + **re-prever as ~319 obras ainda em v1/v2 → v3**.
- 🔴 **U4** — ligar a proveniência `synopsis_quality_source` (human vs predicted) → destrava medir a acurácia do Interesse.
- 💭 **U3** — aproveitar as 8 features **post-reading (quality)** no subconjunto **lido** (onde há sinal); hoje só entram no plano pago.

### 🔀 Corretude de ordem (`after()`)
- 🔴 **O1** — **auto-refresh do Interesse** após mudar perfil/recalc (o gap dos 97% velhos). ← **o mais impactante** (F11/G4, pendência real).
- 🔴 **O5** — no create, as **tags IA** são geradas **depois** do recalc síncrono ([works.ts:97-100](server/actions/works.ts#L97-L100)) → os primeiros scores ignoram as tags inferidas.
- 🔴 **O6** — `infer-tags.ts --execute` grava tags mas **não** marca `recalc_pending` → o recálculo não roda sozinho.
- 🔴 **O7** — `updateWorkStatus` marca `recalc_pending` mas **não** `alignment_stale` (≠ `updateWork`).

---

## 📌 Prioridade, sequência e validação
→ Consolidadas no **🎯 Backlog consolidado** (topo do documento): status, esforço, impacto, **ordem de ataque** e **regra de validação** das 23 oportunidades, num lugar só. As **descrições detalhadas** de cada item são os grupos acima (⚡ Latência · 💰 Custo · ♻️ Redundância · 🎯 Diferenciação · 🗂️ Dados · 🔀 Corretude).

> 🔁 **Reconciliação de nomes** (mesma coisa, framing diferente): no backlog, **C1** = `DRIFT-GATE` · **O1** (auto-refresh) = `INT-MAG` · **O5** está dobrado em `G1` · **R1** está dentro de `DOC-FIX`. Os demais IDs (`L1/C2/C3/D1–D5/U1–U4/O6/O7/R2`) são idênticos.

---

# 🖼️ Anexo 1 — A capa na avaliação de atributos

**Sim, o LLM recebe a capa como imagem (input de visão)** para dar as notas dos atributos — mas só a **primária**, com guardrails.

| Item | Achado (verificado) |
|---|---|
| Como entra | bloco `type:"image"` (base64) **antes** do texto, modelo `sonnet-4-6` ([service.ts:1440-1472](lib/ai-evaluation/service.ts#L1440-L1472)) |
| Quantas capas | **só a primária** — `pickPrimaryCover` (is_primary → menor `position`), 1 imagem, **sem loop** ([work-derived.ts:114](lib/work-derived.ts#L114)) |
| Caminhos vivos | Path A "Avaliar" ([ai.ts:247](server/actions/ai.ts#L247)) ✅ · Path B "Buscar dados" ([external.ts:338](server/actions/external.ts#L338)) ✅ · `evaluateCriteriaWithAI` (sem capa) = **código morto** (0 callers) |
| Guardrails no prompt | capa = sinal **auxiliar**; sozinha não justifica nota ≥7 nem <5; contradiz o texto → **prefere o texto**; aviso anti-viés (*capa de manhwa é romântica por convenção*) ([service.ts:314-326](lib/ai-evaluation/service.ts#L314-L326)) |
| Robustez | baixada no **nosso servidor** + base64 (Anthropic não baixa URL); fallback sem imagem se o fetch falhar **ou** o modelo recusar (400); `image_status` logado ([service.ts:1413-1438](lib/ai-evaluation/service.ts#L1413-L1438)) |

**📊 Medição no banco (sondagem 29/06)** — telemetria de imagem existe desde **18/06**; 240 avaliações medíveis:

| Resultado | Avaliações | % |
|---|---|---|
| ✅ capa enviada (`fetch_success`) | 184 | **77%** |
| 🚫 host bloqueado (sem imagem) | 52 | 22% |
| ➖ sem coverUrl / 📦 grande / 🌐 erro | 4 | 1% |
| 🙅 modelo recusou a imagem | 0 | 0% |

- Prompt atual **v20**: 61/76 (**80%**) enviaram a capa.
- **751 tentativas pré-18/06** sem `image_status` → desconhecido (fecha o item de memória *"fix das capas não mensurável"* → agora **77–80% pós-fix**).
- Os 22% bloqueados são quase todos **capa primária do Comix** (`static.comix.to`, Cloudflare).

**💡 Oportunidade:** quando o host da primária está bloqueado, a obra fica **sem nenhum** sinal visual. Cair para a próxima capa (`position`) ou a capa de outra fonte aceita recupera os ~22% **sem custo de LLM**.

---

# 🎛️ Anexo 2 — Onde as preferências do usuário são usadas

Dois canais **separados**, em camadas diferentes:

| | 🏷️ **Tags amadas/evitadas** (declaradas) | 📝 **Regras livres** (texto) |
|---|---|---|
| Mora em | `user_tag_preferences` (mig 100) | `user_settings.preference_rules` (mig 102) |
| Consome | **camada determinística (offline)** | **só o consultor LLM (pago)** |
| Afeta a NOTA? | ✅ sim | ❌ não |
| Vale quando | após **"Recalcular"** | **na hora** (lido ao vivo) |

### 🏷️ (A) Tags declaradas — determinístico
Misturadas ao perfil com **shrinkage** `λ = n/(n+k)` (`mergeDeclaredTagPreferences`, [taste-profile-heuristic.ts](lib/ai-recommendation/taste-profile-heuristic.ts)) e re-mescladas a cada recalc ([calculations.ts:914](server/actions/calculations.ts#L914)). Alimentam:
1. **Alinhamento** + `tag_overlap_net` (`netNameOverlap` = amadas − 1,5×evitadas)
2. **Nota Prevista** (features Ridge `lovedTagOverlap`/`avoidedTagOverlap`/criterion-fit)
3. **Filtro "evito"** no ranking (`hide_avoided`)
4. **Tags coloridas** 🟢/🔴 na página da obra

> Não são injetadas como "o usuário declarou X" nos prompts LLM — só entram via as listas loved/avoided do perfil.

### 📝 (B) Regras livres — só LLM (pago)
`getPreferenceRules` → `formatPreferenceRulesBlock` ([prompts.ts](lib/ai-recommendation/prompts.ts)): *"…têm precedência sobre o sinal aditivo do perfil quando a condição casar"*. Threadadas em **Veredito/Recomendações** ([recommendations.ts](server/actions/recommendations.ts), 6 call sites), **Deep Dive** ([deep-dive.ts:53](server/actions/deep-dive.ts#L53)) e **Chat**. **Não** vão pro offline (`savePreferenceRules` não marca recalc) **nem** pro Interesse.

**⚠️ Pegadinhas:** (1) regras livres **não mexem na nota** — pra mexer no ranking determinístico, o canal é a tag declarada. (2) tags valem após "Recalcular"; regras valem na hora.

---

# 🔍 Anexo 3 — Tags/regras no Interesse e no Veredito (redundância?)

| Ideia | Veredito | Motivo |
|---|---|---|
| 🏷️ Tags declaradas → **Interesse** | ⚠️ **já acontece / redundante** | o Interesse já casa tags da obra × loved/avoided do perfil ([synopsis-quality-predictor.ts:31-48](lib/ai-evaluation/synopsis-quality-predictor.ts#L31-L48)); o gap real é *propagação* das declaradas ao perfil LLM |
| 📝 Regras livres → **Interesse** | ✅ **faz sentido (testar)** | nuance condicional pré-leitura que hoje se perde; mas é **mudança de contrato** (bump+backfill+revalidar) |
| 🏷️ Tags → **Veredito** | ✅ já recebe ([prompts.ts:221](lib/ai-recommendation/prompts.ts#L221)); **não redundantes** (LLM precisa pra facetas/risco) | o redundante é o **double-count**: recebe tags **cruas** + o **`fit`** ([prompts.ts:229](lib/ai-recommendation/prompts.ts#L229)) que é derivado das **mesmas** tags → ajuda a explicar lift≈0 global / forte só no topo |

**Conclusão:** o melhor candidato é **regras livres no Interesse** (genuinamente aditivo). Tags "novas" em qualquer um = redundante. No Veredito, manter tags (facetas/risco), mas o `fit` derivado delas deveria ser **insumo downstream** (blend do `decision_score`), não evidência re-ponderada no prompt.

---

# 🧪 Anexo 4 — Experimento desenhado: regras livres no Interesse

> **Status:** desenho apenas (nada implementado). Espelha a metodologia golden do e1/digest.

**0. Hipótese:** `ΔMAE = MAE(e1r) − MAE(e1) < 0` **no subconjunto onde alguma regra dispara**, sem regredir as demais.

**1. Variantes** — **A = e1** (produção v3: perfil+sinopse+tags+digest) · **B = e1r** (A + bloco de regras, aplicadas como *lógica, não filtro*). Inputs congelados idênticos; única diferença = regras.

**2. Ground truth & split** — reusar os **90 rótulos humanos** congelados (♥–♥♥♥♥, rúbrica cega, leak-free) + split **56 dev / 34 holdout**. Decidir no dev; confirmar no holdout **1× só**.

**3. 🔒 Anti-leakage** — congelar snapshot das regras (hash+timestamp); regras devem ser **gerais**, não engenharia reversa do golden; aplicadas uniformemente; previsões em dir local (não em `synopsis_quality_predictions`). *Você é fonte dos rótulos E das regras → ganho é legítimo se as regras forem input de produção pra todas, não derivadas destas obras.*

**4. 🎯 Poder condicional (faz ou quebra)** — pré-passo GO/NO-GO ($0): classificar cada golden como **regra-relevante** vs **neutra**. **Se regra-relevante < ~20 → NO-GO** (sem poder; e1−b1 já foi inconclusivo a n=90). Métrica primária **no subconjunto regra-relevante** (não diluir nas 90); guarda: nas neutras `e1r ≈ e1`.

**5. Métricas** — primária **ΔMAE** (regra-relevante) com **IC bootstrap cluster por work_id**, vitória = **IC exclui 0** favorável em **dev E holdout**; secundária pairwise/Spearman; guarda |e1r−e1| nas neutras ≈ 0.

**6. 💰 Custo** — experimento **~$1,6–2** (90×2, e1 mediu $0,79/90), teto $4, dry-run antes. **Se vencer →** bump `PROMPT_VERSION` v3→v4 → backfill **~$8 provável / ~$12 upper** ([PLANO-E1-PRODUCAO](docs/archive/PLANO-E1-PRODUCAO.md)). 🔴 **Senão recorrente:** regras precisam entrar na `input_signature` (senão editar regra não invalida) → **toda edição de regra re-stale o catálogo → backfill de novo**; mitigar com invalidação só das regra-relevantes ou re-previsão lazy.

**7. Decisão pré-registrada** — GO p/ backfill **só se** ΔMAE (regra-relevante) com IC excluindo 0 no holdout + sem regressão nas neutras; senão regras seguem **só no Veredito** (status quo).

**8. ❌ Não fazer** — tunar no holdout; escrever regras olhando o golden; **medir MAE global** (dilui o efeito); shippar sem a análise do subconjunto.

---

# 💲 Anexo 5 — Grafo de ações: custo real, dependências e ordem

**Custo real por execução** (medido no `ai_api_calls`, chamadas com sucesso):

| Ação (função) | 💲 Custo/exec | Modelo | Torna stale |
|---|---|---|---|
| **Gerar perfil** (`generateTasteProfileAction`) | **$0,47** /run ⚠️ o mais caro | Sonnet (lê a biblioteca) | Interesse (todas), personal_fit, Veredito |
| **Avaliação IA** (`requestAiEvaluation`) | **$0,052** /obra | Sonnet (+capa) | calc/expected |
| **Veredito IA** (`runRecommendationAction`) | **$0,050** /run | Sonnet | nada |
| **Calibração Relatório/bias** (`runBiasReportAction`) | **$0,037** /run | Sonnet | todos expected_score |
| **Calibração Auditoria** (`runCalibrationAuditAction`) | **$0,108** /lote ~10 → catálogo **~$8–9** | Sonnet | category_scores → recalc |
| **Add review manual** (`createExternalManualReview`) | **~$0,021** (resumo $0,003 + digest $0,018) | Sonnet/Haiku | digest → Interesse |
| **Avaliação digest** (`review_digest`) | $0,018 /obra | Sonnet | — |
| **Interesse** (`predictSynopsisQuality…`) | **$0,009** /obra | Sonnet | nada |
| **Inferir tags** (`inferTagsForWork`) | $0,009 (+$0,008 verify) | Haiku/Sonnet | Interesse, Ridge/Alinhamento |
| **Resumir reviews** (`consolidatePendingReviewSummaries`) | $0,003 /obra | Haiku | — |
| **Consolidar sinopse** (`consolidatePendingSynopses`) | $0,002 /obra | Haiku | — |
| **Recalcular notas** (`recalculateAll`) | **$0** | — | nada (resolve) |
| **Atualizar embeddings** (`refreshEmbeddings`) | **~$0** | text-embedding-3-small | nada |

**Ordem ótima** (alimentar antes de consumir · resolver caro 1× no fim · Veredito por último):
`Criar/Editar → Reviews → digest+resumo → Tags → Avaliação IA → (Auditoria) → user_score → Bias → Gerar perfil → Recalcular → embeddings → Interesse → Veredito → Tiers`

**Regras de ouro:** (1) recalcular 1× no fim; (2) perfil+bias antes do recalc final; (3) tags+digest antes do Interesse; (4) Interesse depois do perfil; (5) Veredito por último.

**Esclarecimentos:**
- **`recalculateAll, awaited`** — `recalculateAll` recalcula as notas determinísticas de TODO o catálogo numa passada; "awaited" = no `createWork` roda com `await` ([works.ts:1081](server/actions/works.ts#L1081)) → bloqueia a resposta até a obra ter nota. No `updateWork` **não** é awaited (só `recalc_pending`).
- **Embeddings** — `text-embedding-3-small` (~$0). Consumidos em **1 lugar só**: painel "Obras similares" da página da obra ([titles/[id]/page.tsx:206](app/catalog/[id]/page.tsx#L206)). **Fora** de toda nota e da Avaliação IA. Ação de menor valor/mais dispensável.

---

# 🔴 Anexo 6 — Gaps de cascata confirmados + correção (desenho)

Verificado no código: ações **baratas/determinísticas** cascateiam bem; as **caras (Sonnet)** ficam em "flag manual" — e os flags **não cobrem todos os gatilhos**. Os 3 gaps reais:

| # | Gap | Causa raiz | Correção ($0) |
|---|---|---|---|
| **G1** | **Interesse previsto antes das tags inferidas** | `autoPredict` roda dentro da consolidação; inferência de tags é `after()` **separado** ([works.ts:1053](server/actions/works.ts#L1053)) → corrida; e não re-prevê depois | **Sequenciar:** no create, chamar `autoPredict` **ao fim** da cadeia `reviews→digest→tags`, não dentro da consolidação. Interesse roda 1× com tags prontas. |
| **G2** | **Add/edit review não marca o Veredito stale** | `createExternalManualReview` regenera digest mas não chama `markWorkAlignmentStale` | Adicionar `markWorkAlignmentStale(workId)` no `after()` de create/update/delete de review, **gated por `isMaterialReviewChange`** |
| **G3** | **Tag/sinopse não marca a Avaliação IA stale** | só existe flag p/ mudança de **review** (`ai_eval_reviews_stale`, mig 120); tag/sinopse não flagam a eval | Generalizar p/ `ai_eval_inputs_stale` (reviews+tags+sinopse), **com gate de materialidade**, exibido no filtro "Desatualizado" da fila Avaliar (**não** auto-roda — eval custa $0,052) |

> Os 3 são **$0** (flags + reordenação) e **não** disparam LLM caro automaticamente — só corrigem a ordem e **expõem a staleness honestamente** pra você decidir re-rodar.

---

# 📐 Anexo 7 — Métrica de magnitude de staleness (otimizar recompute)

**Problema:** o staleness hoje é **booleano** (`input_hash`/`input_signature` mudou → stale), e **over-fire** — toda micro-edição invalida itens caros. Queremos: *"recompute só quando o `|Δoutput|` esperado passar de um limiar"*.

**O projeto já tem metade disso:** `driftPct` do perfil (mig 118, [profile-drift.ts](lib/ai-recommendation/profile-drift.ts)) é uma **magnitude contínua** (0..1) via **surrogate heurístico grátis**. **Mas não está ligado como gate** — só exibido como aviso; a regen do perfil ($0,47) ainda dispara no booleano `input_hash`.

**Template (3 ingredientes por output caro):**
1. **Surrogate barato do Δinput** (determinístico, $0).
2. **Magnitude contínua** (distância 0..1).
3. **Limiar τ** calibrado contra Δoutput realizado (data-driven).

| Output caro | Surrogate barato (Δinput) | Estado hoje | Alavanca |
|---|---|---|---|
| **Perfil** ($0,47) | `driftPct` = 1 − jaccard(loved/avoided heurístico salvo × atual) | ✅ existe, ❌ não gateia | **Ligar como gate**: regen só se `driftPct > τ_p` (~0,10–0,15) em vez do booleano `input_hash` |
| **Interesse** ($0,009×catálogo) | Δ(`netNameOverlap`) das tags **ponderado por relevância** + cosine do embedding da sinopse (já existe, ~$0) + Δdigest (gate de materialidade) + `driftPct` do perfil **filtrado pelas tags da obra** | ❌ só booleano | **Construir** `interestStaleMagnitude` por obra → re-prever só obras > τ_i |
| **Veredito** ($0,05) | mesmo de Interesse + Δ category_scores | ❌ só flag | gate por magnitude |

**Ideias-chave:**
- 🎯 **Perfil mudou → re-prever só as obras afetadas, não as 800.** Converte "$8 sempre" em "~$0,5–1,5" (só as obras cujo `netNameOverlap` realmente moveu).
- 💡 **Usar o grátis pra gatear o caro:** `personal_fit`/`tag_overlap_net` são recomputados de graça no recalc e **compartilham inputs** com o Interesse. Se o `personal_fit` (free) quase não moveu, o ♥ (LLM) provavelmente não cruzou faixa → **pule**.
- 📊 **Interesse é ordinal (4 faixas) + o preditor devolve `confidence`.** Gate = `Δinput × (1 − confidence) > τ`: previsão de alta confiança com input pouco movido → pular.

**Calibração (rigor):** coletar pares `(magnitude surrogate, |Δoutput| realizado)` re-computando uma **amostra** mesmo abaixo do limiar e logando se a faixa ♥ virou / se loved-avoided do perfil mudou. Escolher τ na fronteira de Pareto **flip-recall × recompute-rate** (ex.: pegar 95% dos flips re-computando 30%). Harness já existe (`prediction_snapshots` + `synopsis-interest-staleness-analysis.ts`).

**Caveat:** surrogate pode **perder** mudança que o proxy barato não enxerga (reescrita de sinopse que muda tom sem mexer no embedding; heurístico não lê sinopse). Política: **conservador (recompute) p/ itens de alto valor; lazy/sob-demanda p/ baixo valor**; auditar a taxa de erro do gate periodicamente. O próprio `driftPct` se descreve como detector **conservador de "imaterial"**, não veredito fino — uso correto = **pular com confiança**, recomputar quando em dúvida.

---

# 🛠️ Anexo 8 — Detalhamento de implementação (desenho, $0 até aqui)

## 📍 Medição ao vivo (29/06) — a prova do problema
`scripts/diag-profile-drift.ts` no perfil **v18**:
- `input_hash` (booleano) → **STALE** (18/200 obras editadas desde o gen; **0 novas notas**).
- **Drift method-free = 6,3%** (loved Jaccard 0,875 · avoided 1,000; saíram `politics`/`political marriage`, entraram `awkward`/`strong male lead`).
- **Veredito:** a regen de ontem (**$0,47**) + a invalidação de **97% do Interesse** foram **desnecessárias**. Com `τ_p = 0,12`, teriam sido puladas.

## 1️⃣ Gate do `driftPct` no perfil — **o de melhor custo-benefício**
**Onde:** decisão de regen em [ensure-profile.ts:91-98](lib/ai-recommendation/ensure-profile.ts#L91-L98). Hoje: `regen se canRegen && (is_stub || isStale)`, com `isStale = input_hash !== inputHash` (**booleano**).
**Mudança:**
```
hashChanged = input_hash !== inputHash         // pré-filtro barato: igual ⇒ fresh, nem calcula drift
if (!hashChanged) → mantém
drift = compareFingerprints(saved_fp, heuristic_now)   // $0, fingerprint já é persistido (taste-profile.ts:194)
shouldRegen = is_stub || !drift.available || drift.driftPct > τ_p || newLabelsSinceGen >= N_force
```
- **τ_p ≈ 0,12** (v18 a 6,3% → pula; shift real >12% → regen). Calibrar com histórico.
- **Floor anti-blindspot:** o heurístico não lê sinopse → forçar regen a cada `N_force` novas notas (ex.: 25) mesmo com drift baixo, pra pegar deriva temática que o fingerprint não vê.
- **Edge:** stub→sempre regen; sem fingerprint (pré-mig)→regen 1× pra backfillar; botão "Regenerar"→bypassa o gate.
**🎯 Bônus decisivo:** quando o gate **pula** a regen, ele **também evita a cascata do Interesse** (perfil não mudou → 0 invalidação). **Um só fix resolve o custo de $0,47 E a causa dos 97%-stale.** Maior alavanca da lista.
**Esforço:** trivial (métrica existe; é trocar 1 `if`). Migration opcional (gravar `last_drift_pct`/`last_checked_hash` pra não recomputar o heurístico a cada chamada).

## 2️⃣ `interestStaleMagnitude` — re-previsão seletiva
**Onde:** planner `interest-backfill.ts` (classifySig/planItemSig) + gate do `autoPredictSynopsisQuality`.
**Magnitude por obra (surrogates $0):**
```
mag = max(
  w_tag · |netOverlap_novo − netOverlap_previsto| / SCALE,     // recalc dá netOverlap de graça
  w_syn · (1 − cosine(emb_antigo, emb_novo)),                  // embeddings já existem; só se sinopse mudou
  w_dig · digestMateriality(prev_n, now_n, version),
  w_prof · driftPctRestritoÀsTagsDaObra,                       // perfil mudou? só conta se as tags que mudaram tocam ESTA obra
)
effectiveMag = mag · (1 − lastConfidence)                       // alta confiança precisa de mais movimento
→ re-prever só obras com effectiveMag > τ_i
```
- **`driftPctRestritoÀsTagsDaObra`** é o que converte **"perfil mudou → $8 sempre"** em **"~$0,5–1,5"** (só as obras cujas tags relevantes moveram).
- **Dados:** `lastConfidence` (na prediction row) · `emb` (work_embeddings) · `netOverlap` (recalc). Falta só **persistir `netOverlap_at_predict`** (migration pequena).
**Esforço:** médio. **Resolve o O1/97%-stale com custo proporcional ao que de fato mudou.**

## 3️⃣ Correção dos 3 gaps de cascata
| Gap | Onde | Mudança | Custo |
|---|---|---|---|
| **G1** Interesse antes das tags | [works.ts:1039-1074](server/actions/works.ts#L1039-L1074) | `persistNewWork` aceita `skipAutoPredict` no create; `createWork` faz **1 `after()` sequencial**: consolidar canonical → reviews+digest → inferir tags → `autoPredict`. Interesse roda 1× com tudo pronto | $0 (reordenação) |
| **G2** review não marca Veredito | [external-manual-reviews.ts:69-73](server/actions/external-manual-reviews.ts#L69-L73) | após `ensureReviewDigest`, se regenerou (material), chamar `markWorkAlignmentStale(workId)` | $0 (flag) |
| **G3** tag/sinopse não marca eval | `updateWork` + migration | flag `ai_eval_inputs_stale` (generaliza a `ai_eval_reviews_stale`/mig 120) setada em mudança material de tag/sinopse; exibida no filtro "Desatualizado" da fila (**não** auto-roda — eval $0,052) | $0 runtime + 1 coluna |

## 🧪 Calibração dos limiares (rigor, não chute)
Para `τ_p` e `τ_i`: re-computar uma **amostra** mesmo abaixo do limiar, logar se **a faixa ♥ virou** / se **loved-avoided do perfil mudou**, e escolher τ na fronteira de Pareto **flip-recall × recompute-rate** (ex.: pegar 95% dos flips re-computando 30%). Harness já existe: `prediction_snapshots` + `synopsis-interest-staleness-analysis.ts` + `diag-profile-drift.ts`.

## 🥇 Ordem de implementação recomendada
1. **Gate do `driftPct`** (trivial, corta o item mais caro **e** a cascata do Interesse na raiz).
2. **G1/G2/G3** (baratos, corrigem ordem/flags).
3. **`interestStaleMagnitude`** (médio, re-previsão seletiva).
4. Calibrar τ com dados antes de apertar os limiares.
