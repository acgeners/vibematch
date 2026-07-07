# PLANO — Arquitetura das notas de gosto (unificação + gosto segmentado)

> **Estado:** desenho (2026-07-06). Consolida a discussão de uma sessão longa sobre
> por que existem 6 "notas" de gosto, o que cada uma faz, e como montar a **melhor
> receita** com o que temos — em vez de otimizar nota por nota.
> Relacionado: `PLANO-BUSSOLA-3-FORCAS.md`, `PLANO-INTERESSE-PREFS-CONFIANCA.md`,
> memórias `project_fit_merit_axis_gate`, `project_bussola_3forcas`,
> `project_interest_predictor_prefs_injection`.

---

## 0. O problema

Hoje o usuário vê **6 notas** que, no fundo, tentam responder a mesma coisa ("quanto vou
gostar disso?"), diferindo só em *quanto dado usam* e *como usam*. Isso confunde em vez
de ajudar, e — pior — **não sabemos qual delas acerta mais**, porque nenhuma tem uma
verdade-base limpa de *gosto* pra ser medida.

As 6 notas:
`Nota Prevista` · `Interesse na obra (previsto)` · `Alinhamento` · `Veredito IA` ·
`Prioridade` · `Chance de gostar`.

---

## 1. A redução: 6 notas → 2 eixos

As perguntas que realmente importam são poucas. O usuário as formulou como 3:

1. Essa obra está alinhada com as preferências do user?
2. Quanto está alinhada?
3. Quanto ele provavelmente vai gostar?

**Mas 1 e 2 são o mesmo eixo** (uma é a outra com um corte). Sobram **2 eixos**, e eles
estão numa relação **meio → fim**:

| Eixo | Pergunta | Papel |
|---|---|---|
| **Alinhamento** (fit) | Quão alinhado com meu gosto declarado/aprendido? | **evidência** — o *porquê*, explicável |
| **Predição de gosto** | Quanto vou gostar de fato? | **resposta** — calibrada contra o que gostei |

Alinhamento **não é um número irmão** da Predição — é **um ingrediente dela**. Fit é
upstream; gosto previsto é downstream.

---

## 2. Inventário das 6 notas (método · input · output · uso)

| Nota | Método | Inputs | Output | Uso hoje |
|---|---|---|---|---|
| **Alinhamento** (`personal_fit` → `_percentile`) | determinístico ($0) | tags da obra × stances love/avoid + perfil | 0–100 percentil | coluna "Alinhamento"; feature da Chance; **não** é feature do Ridge (os constituintes LovedTagOverlap/AvoidedTagOverlap/CriterionFit é que são) |
| **Interesse na obra** (`synopsis_quality`) | **LLM** Sonnet, temp 0 | sinopse (dominante) + perfil + digest + **prefs livres compiladas (congeladas)** | banda ♥…♥♥♥♥ | triagem pré-leitura; filtro de filas; feature da Chance (`interesseOrdinal`); feature do Ridge (via coluna manual) |
| **Nota Prevista** (`expected_score`) | Ridge treinado | ~22 features (9 IA, tag overlaps, GPT.N, plataforma, votos, sinopse, ano/origem…) ⊕ blend calc | 0–10 | headline preditivo atual |
| **Chance de gostar** (`chance_score`) | **logística L2 + Platt** (treinada) | 9 IA + tags declaradas + **`personal_fit`** + **`interesseOrdinal`** | 0–100% (`P(nota≥8)`) calibrado | Força 1 da Bússola |
| **Veredito IA** (`alignment_score`) | **LLM** Sonnet (pago, sob demanda) | perfil + sinopse + 9 IA + tags + **reviews + digest + prefs livres AO VIVO** + mood | 0–100 + justificativa + riscos + citações | coluna "Veredito IA"; único termo que ajusta a Prioridade |
| **Prioridade** (`decision_score`) | blend pós-hoc | `expected × (1−w) + (veredito/10) × w`, `w≤0.35×conf` | ordem | sort do ranking pago |

---

## 3. O grafo de dependência (quem come quem) — achados

```
        tags×stances ──► ALINHAMENTO ──┐
                                        ├──► CHANCE DE GOSTAR (modelo treinado)
   sinopse+perfil+digest ─► INTERESSE ──┘         │
        (prefs livres CONGELADAS)                  │
                                                   │ mesma pergunta, +reviews+prefs AO VIVO
   perfil+sinopse+9IA+reviews+prefs ─► VEREDITO IA ┘ ──► ajusta PRIORIDADE
        (via LLM pago)
```

Fatos confirmados no código (não hipótese):

1. **Chance é um ENSEMBLE que já engole Alinhamento e Interesse** como features
   (`server/actions/calculations.ts:1208-1214`, branch `feat/bussola-3forcas`). Eles são
   **ingredientes** dela, não concorrentes. E são os 2 maiores pesos do modelo (personal_fit
   +0.34, Interesse +0.22 — medido, ver §7).
2. **Chance NÃO é um LLM** — é uma regressão logística **treinada nos teus ratings** e
   **calibrada (Platt)**. Seu valor vem de ser $0, rodar em **todas** as obras, e ter
   probabilidade honesta (70% ≈ 70% real). Um LLM não reproduz isso (não computa a
   estatística cruzada das 206 obras; cospe número não-calibrado).
3. **Interesse e Veredito IA são o MESMO juiz LLM em 2 preços/resoluções** — ambos
   Sonnet, "perfil + texto → nota de alinhamento". Interesse = grátis/grosso (♥, só
   sinopse). Veredito = pago/fino (0–100, + reviews + prefs).
4. **Nota Prevista e Chance são duas faces da mesma predição** — ambas treinam sobre
   `user_score` com features sobrepostas; uma é ponto-estimativa (0–10), a outra é
   probabilidade (`P≥8`). Redundantes pro usuário.
5. **Incoerência de frescor:** Interesse usa prefs livres **congeladas** (bloco hardcoded
   `COMPILED_PREFERENCES_V33`, compilado offline em 2026-06-30 — o compilador ao vivo, Peça 1,
   nunca foi construído); Veredito usa a tabela **ao vivo**. Editar prefs hoje **não**
   atualiza o Interesse. → dois juízes usando versões diferentes das mesmas prefs.

---

## 4. A distinção que sustenta tudo: magnitude ≠ alinhamento

Os 9 critérios que a IA extrai de obra não-lida (`romance`, `couple_dynamics`,
`protagonist`, `fantasy_nobility`, `action_adventure`, `humor`, `drama`, `tragedy`,
`adult_content`) medem **magnitude/intensidade** ("quão marcante"), **não** preferência
("combina comigo"). A própria definição de `protagonist` em `criteria.ts` diz:
*"NÃO avalia se é simpático/agradável — Mary Sues, vilões, FLs frias podem todos ser muito
marcantes."*

Consequência: uma FL marcante-intensa e um herói puro-intenso têm a **mesma magnitude** pra
IA, mas gostos opostos pro usuário. Um coeficiente linear único não captura isso → vira o
peso aguado (+0.118) que a magnitude `protagonist` tem hoje. **A preferência mora no *tipo*
(tags/arquétipo), não na magnitude** — por isso as tags dominam os pesos.

Refinamento (a validar): nem toda magnitude é igual.
- **Dial** (monotônico): humor, adult, ação, nível de romance — "quero mais/menos" → magnitude serve de proxy.
- **Kind** (não-monotônico): protagonista, dinâmica do casal — o *tipo* decide → magnitude é proxy ruim; tag-fit manda.

---

## 5. A consolidação (o destino)

**Para o usuário, 2 coisas — não 6:**

1. **"Quanto vou gostar"** → um headline calibrado (**Chance de gostar**). Nota Prevista e
   Prioridade são a mesma resposta em outra roupa → saem da tela (viram sort/compat).
2. **"Por quê / quão alinhado"** → **Alinhamento + a justificativa** do juiz LLM fundido
   (Interesse+Veredito). Não é número concorrente — é o **explicador** do headline.
   Regra que preserva sinal: destacar o alinhamento **quando ele DIVERGE** da Chance (o caso
   informativo: "bate com teu padrão, mas a IA leu um risco no texto").

**O que NÃO colapsa** (outra pergunta, contexto ortogonal): **Avaliação** (mérito/crítica)
e **Alcance** (popularidade). Fim da linha:

```
Chance de gostar   (fit/resposta + explicação de alinhamento)   ← as 6 notas de gosto colapsam aqui
Avaliação          (mérito — outra pergunta)
Alcance            (popularidade — outra pergunta)
```

Isto **é a Bússola**. O plano da Bússola já lista como pendência *"aposentar
Prioridade/Alinhamento/Interesse, redundantes com as 3 forças"*. A consolidação não é
arbitrária — ela converge pro que já tínhamos desenhado.

---

## 6. A arquitetura-receita (pensar o sistema, não a nota)

Em vez de 6 notas soltas, **1 pipeline** com papéis claros:

```
  RAW: prefs livres + perfil + sinopse + reviews + digest + tags + 9 IA
        │
        ├──►  1 JUIZ LLM (2 modos, 1 ingestão) ──► { Interesse (foco pré-leitura),
        │        barato quando só há sinopse;          Veredito + justificativa (foco decisão) }
        │        rico quando há reviews/digest                    │
        │                                                          │  (como features)
        └──►  tag-fit por aspecto + magnitudes + histórico ───────┤
                                                                   ▼
                                              CHANCE (modelo treinado = CALIBRADOR)
                                                 └─► % calibrado sobre teu histórico
                                                        │
                                          Bússola: Chance × Avaliação × Alcance
```

- **Juiz LLM** = o *leitor* (funde Interesse+Veredito; 1 chamada, inputs consistentes —
  conserta o frescor das prefs; degrada com gasto: barato sem reviews, rico com).
- **Chance** = o *calibrador* que ancora as leituras LLM + features estruturadas no teu
  histórico → probabilidade honesta. **Não entra na fusão LLM** (é modelo treinado).
- **Bússola** = a superfície de decisão (fit × mérito × alcance).

O **gosto segmentado** (próximo bloco) é a **camada de rótulo** que treina/valida esse
pipeline — a régua que hoje não existe.

---

## 7. Evidência empírica já levantada

- **Gate Fit×Mérito** (`scripts/axis-gate.ts`, n=206): "chance de gostar" é sinal real
  (AUC 0.73; robusto a leakage, CLEAN 0.71); consenso externo limpo mas fraco (0.36) e
  **ortogonal** ao gosto (0.38) → justifica eixos separados. Split **não** melhora MAE
  (~0.56, catálogo comprimido) — ganho é **textura de decisão**, não acurácia.
- **Pesos reais da Chance** (treinado ao vivo, n=206, cvAUC 0.741): top =
  `personal_fit` +0.34, `tags evitadas` −0.34, `fantasy_nobility` +0.25, `Interesse` +0.22,
  `drama` +0.18, `humor` +0.14; magnitude `protagonist` +0.12 (fraca), `couple_dynamics` ~0.
  → **as tags (o "tipo") dominam; magnitude é fraca**; teus *evitas* preveem mais que teus
  *amos* (assimetria).
- **Ressalva de leakage:** `personal_fit` e `Interesse` derivam do `taste_profile`
  (destilado das próprias obras) → os pesos altos são **teto otimista**.

---

## 8. Gosto segmentado — a camada de rótulo (a régua)

### 8.1 Princípio
Um eixo de gosto só ajuda a **prever** se existe um **sinal-espelho extraível** da obra
não-lida. Cada critério é julgado em 2 eixos: **saliência de gosto** × **extraibilidade**.

### 8.2 Os critérios propostos (6 eixos, 2 tiers)

| Eixo (gostei de…) | Gosto | Proxy extraível (não-lido) | Ponte |
|---|---|---|---|
| 👥 **Protagonistas & Casal** | altíssimo | IA `protagonist`+`couple_dynamics`+`romance` · tags `female_lead`/`male_lead`/`relationship_dynamics` | **FORTE** |
| 🌍 **Ambientação & Premissa** (absorve "história"=tema) | alto | IA `fantasy_nobility`+`action_adventure` · tags `setting`/`fantasy`/`themes` | **FORTE** |
| 🎭 **Tom & Emoção** | alto | IA `humor`+`drama`+`tragedy`+`adult_content` · tags `tone_mood`/`conflict` | **FORTE** |
| 🎨 **Arte** | alto | capa (embedding) + sentimento de reviews sobre arte | **MÉDIA** (sem score hoje) |
| ⏱️ **Ritmo** | médio-alto | reviews sobre ritmo + nº capítulos + tags "slow burn" | **MÉDIA** |
| 🎬 **Final** | alto | reviews sobre desfecho | **MÉDIA-FRACA** (só reviews; ongoing não tem) |

- **Tier A** (Protagonistas, Ambientação, Tom) = ponte **pronta hoje** (scores IA + tags),
  **~0 features novas**. Testável já no piloto.
- **Tier B** (Arte, Ritmo, Final) = rótulo agora, ponte a construir (**review-aspect-sentiment**).
- **Alvo (não é segmento):** 🔁 **Gostei geral / Releria**.
- **Saíram:** originalidade (craft → Avaliação), imersão (= o próprio gostei geral).

### 8.2.1 Registro no banco (feito 2026-07-06)
Os 6 eixos + "Gostei geral" estão registrados na tabela `criteria` como **novo
`eval_type='Gosto'`** (slugs `taste_*`, keys `like_*_score`), com nome, emoji,
`description` (bullets + pergunta-guia + exemplo) e `ranges` (os 5 hints por estrela ★–★★★★★).
Escala compartilhada `{2, 4, 6.5, 8, 10}`. **Isolados dos craft** (`eval_type='User'`) →
`sync-constants` (que só lê `IA`/`User`) **ignora** `Gosto`, sem quebrar o arquivo gerado.
Sem pesos (aprendidos depois). `taste_ending` aceita N/A; `taste_overall` é o alvo direto.
**Follow-up (Fase 3):** estender `sync-constants` pra gerar um `lib/constants/taste-criteria.ts`
a partir de `eval_type='Gosto'` quando a coleta for construída.

### 8.3 O framing (crítico)
A pergunta ao dar a nota é de **alinhamento** ("clicou comigo?"), **não** de intensidade
("é forte/marcante?"). E o proxy que prevê é o **tag-fit por aspecto** (stances × tags do
grupo daquele eixo), **nunca** a magnitude IA crua. A magnitude vira descrição (Avaliação)
ou feature neutra; o **gap magnitude×gosto** = diagnóstico do desvio pessoal.

### 8.4 O digest como evidência de alinhamento
O `review_digest` (JSONB, `mig 103`, Sonnet, **preference-agnostic**) tem `salient_traits[]`
com `axis` (personagens/tom/ritmo/arte/romance) + `polarity` — **evidência qualitativa por
eixo**, exatamente o "tipo, não magnitude". Mas ele é metade da conta:
`alinhamento = digest (o tipo) × teu gosto (o piloto)`. Cruzar tem 2 rotas: **A** tag-fit
determinístico ($0, leakage-controlado); **B** digest→LLM por eixo (tokens, leakage; é o que
o Interesse já faz no geral — estender pra por-aspecto).

---

## 9. Por que não "6 modelos por aspecto" (rigor de ML)

Overfit não vem de "poucas linhas" (todas as ~200 obras teriam todos os rótulos). Vem de
**parâmetros ÷ dado**: 6 conjuntos de pesos ÷ 200 obras = cada peso mal-estimado; rótulos
por-aspecto são mais barulhentos; alguns aspectos (arte via capa) são famintos por features;
6 modelos = 6× a superfície pra achar padrão falso. Regra de bolso: ~10–20 exemplos/feature.
→ **Um modelo pooled** com os proxies de aspecto como features; os rótulos de segmento
**validam a ponte** e **de-contaminam o alvo**. Modelos por-aspecto = só com ~500–1000+
rótulos ou multi-task.

---

## 10. Método empírico — "qual receita acerta mais"

O objetivo não é escolher uma nota; é achar a **receita mais precisa**. Só mensurável com o
gosto (a régua). Protocolo:

1. **Alvo limpo:** `P(gostei ≥ τ)` (τ p/ base rate ~50%), em vez de `P(user_score≥8)` (craft).
2. **Comparar receitas** OOF (sem leakage): magnitude-só vs tag-fit-por-aspecto vs
   LLM-por-aspecto vs ensemble. Métrica: AUC/Brier + calibração.
3. **Arma anti-leakage:** incluir a arma CLEAN (só tags declaradas + 9 IA, sem sinais
   derivados do perfil) — como o `axis-gate` fez (FULL 0.73 → CLEAN 0.71).
4. **Ponte por aspecto:** correlação `gosto-aspecto × proxy-aspecto` (ex.: gosto-protagonistas
   × IA protagonist+couple) — confirma/refuta cada Tier A.
5. **Utilidade assimétrica:** gem perdida ≫ MAE → medir gems-perdidas, não só MAE.

---

## 11. Sequenciamento (a decisão)

**Colher o gosto num PILOTO primeiro (não as 200), porque testar agora mede a pergunta
errada.** Sem gosto, todo teste valida contra `user_score` (craft) ou perfil (leakage) — os
alvos contaminados que o redesenho existe pra escapar. Mas separa-se por dependência do rótulo:

| Trabalho | Precisa do gosto? | Quando |
|---|---|---|
| Este doc + consolidar exibição 6→3 | não | agora ($0, reversível) |
| Construir proxies (tag-fit por aspecto; juiz LLM fundido) | não (constrói); validar sim | agora |
| **"Qual receita prevê melhor?"** | **SIM** | pós-piloto |
| Escalar re-avaliação 200 + modelo prod + UI | sim + go do piloto | depois |

O piloto (~40–60 obras estratificadas) dá o alvo certo a ~¼ do esforço e transforma a
re-avaliação completa numa aposta **justificada**, não cega.

---

## 12. Plano em fases

| Fase | Escopo | Custo | Gate |
|---|---|---|---|
| **0 · Doc + consolidação de exibição** | este doc; parar de mostrar 6 números → Chance (+explicação) / Avaliação / Alcance | $0 | reversível |
| **1 · Fechar critérios + escala** | 6 eixos + escala de **alinhamento** + framing; método de coleta mínimo | $0 | — |
| **2 · Construir proxies (label-agnóstico)** | tag-fit por aspecto; desenho do juiz LLM fundido (2 modos) | $0 | prototipar |
| **3 · Piloto de gosto** | você nota ~40–60 obras já lidas nos novos eixos | $0 tokens, ~20–40 min | **o dado nasce** |
| **4 · Teste da receita** | §10 sobre o piloto — decide alvo, proxies, headline, fit=1-ou-2-eixos | $0 | **go/no-go empírico** |
| **5 · Escalar** | re-avaliar restante das 200; treinar modelo prod; UI (mockup aprovado antes) | user effort | pós-go |
| **6 · Fundir juízes LLM** | Interesse+Veredito num juiz de 2 modos (conserta frescor das prefs) | dev | pós-régua |

---

## 13. Decisões em aberto

- **Headline final:** Chance (%) sobrevive como o número único, ou uma versão retargetada no gosto? (decide na Fase 4)
- **Fit = 1 ou 2 eixos?** Alinhamento e Gostar são um só (fit→gosto) ou merecem 2 números? (empírico)
- **Escala do gosto:** ♥ 1–5 por eixo (reusa linguagem do Interesse) — confirmar.
- **Tier B:** construir review-aspect-sentiment agora ou só coletar rótulo e adiar a ponte?
- **Staleness do Interesse:** re-hardcodar o bloco de prefs agora, ou esperar o compilador (Peça 1)?
- **Compilador de prefs (Peça 1):** a fusão dos juízes (Fase 6) pode absorver isso (prefs ao vivo pros dois).

---

## 14. Princípios que guiam (resumo)

1. Pensar **receita**, não nota — o sistema tem papéis (leitor LLM / calibrador treinado / superfície), não 6 opinões.
2. **Magnitude ≠ alinhamento** — preferência mora no tipo (tags), não na intensidade (IA).
3. O gosto segmentado é **rótulo limpo**, não feature (só existe pós-leitura) — sua função é ser a **régua**.
4. **Um modelo pooled** com proxies de aspecto; rótulos validam a ponte e de-contaminam o alvo.
5. **Consolidar exibição já** (baixo risco); **decidir modelo com a régua** (empírico).
6. Não perder o sinal da **divergência** entre notas — é textura de decisão, não ruído.
