# PLANO — Preferências compiladas + Calibração + Confiança no preditor de Interesse

> **Documento de referência E tracker de status.** Toda implementação deste bundle
> usa este arquivo como fonte da verdade e registra progresso aqui.
>
> **Última atualização:** 2026-07-01 · **Branch:** `feat/review-embeddings-ranking-transparency`
> **Memória relacionada:** `project_interest_predictor_prefs_injection` · **PLANO-MESTRE §24n**
> **Antecedentes:** Peças 2+3 (integração + backfill) já na `main` (PR #30). Este doc cobre a
> **Peça 1 (compilador)** + o que a discussão de design expandiu ao redor dela.

## Legenda de status

| Marca | Significado |
|---|---|
| ⬜ | TODO — não começado |
| 🟡 | em progresso |
| ✅ | feito |
| 🧊 | **validado offline** (golden pilot-2) — pode confiar |
| 🔬 | **hipótese** — precisa medir antes de confiar |
| 🟦 | decisão de **produto/valores** — não precisa validação empírica |
| ⏸️ | adiado |

---

## 0. Como usar este doc

- **§3 (Decisões travadas)** = ratificadas, **não re-litigar**.
- Cada bloco de trabalho tem uma tabela de status; atualize a marca ao avançar.
- **Rigor:** todo item marcado 🔬 é hipótese — não escrever no prompt/código como se fosse
  fato sem passar pelo gate do golden (§10). Itens 🧊 vêm da validação offline de 2026-06-30.

---

## 1. Contexto e objetivo

O preditor de **Interesse na Sinopse** (LLM que estima a faixa de ♥ 1–4 de uma obra) hoje usa
perfil + sinopse + digest, mas **não** usa as preferências livres do usuário de forma robusta.
Motivador concreto: *The Villainess Turns the Hourglass* foi previsto ♥♥♥♥ ignorando a regra
"não gosto de protagonista cruel" (corrigido para ♥♥♥ com o bloco v3.3 hardcoded na Peça 2).

**Objetivo deste bundle:**
1. **Peça 1** — substituir o bloco de preferências **hardcoded** (`COMPILED_PREFERENCES_V33`)
   por um artefato **gerado por LLM** a partir das regras livres cruas do usuário.
2. Reorganizar a **calibração** do preditor (LLM 2) num núcleo fixo e validado.
3. Fazer o preditor usar as **tags declaradas** (Item A), acima do perfil inferido.
4. Ampliar a **confiança** da previsão e conectá-la a 3 consumidores (badge/triar/priorizar).

**Critério de sucesso (não byte-exato):** reproduzir o v3.3 **semanticamente** e manter as
métricas do golden pilot-2 (MAE ~0,433, **0 obra amada rebaixada**), sem inflar ♥♥♥♥.

---

## 2. Arquitetura — 3 estágios de LLM

```
 obras avaliadas ──LLM(0: perfil)────────► PERFIL DE GOSTO (loved/avoided tags inferidos, temas, critérios)
 regras livres  ──LLM(1: COMPILADOR)─────► COMPILADO {aversões A1..An, promoções P1..Pn}   ← Peça 1
                                                  │  (anexado ao perfil, cacheado)
                        ┌── PERFIL ◄────────────── │
                        ├── COMPILADO (LLM 1)
   LLM(2: PREDITOR) ◄───┼── TAGS DECLARADAS (Item A)   ← novo input
                        ├── tags da obra
                        ├── sinopse canônica
                        └── digest (resumo das reviews)
                                 │
                                 ▼
                    faixa ♥ (1–4) + justificativa + CONFIANÇA (0–1)
```

| | **LLM 1 — Compilador** | **LLM 2 — Preditor** |
|---|---|---|
| Recebe | 7 regras livres (texto cru) | perfil + compilado + Item A + tags obra + sinopse + digest |
| Produz | `{ compiledBlock }` (aversões/promoções) | faixa ♥ + justificativa + confiança |
| Roda | só ao **editar** as regras (raro) | por obra (backfill / sob demanda) |
| Modelo | Sonnet (a decidir; barato) | `claude-sonnet-4-6` (atual) |

> A **calibração** (err-high, inversão, leitura de sinais) **NÃO** é gerada pelo LLM 1 — é
> **constante fixa** no LLM 2 (§6). O compilador só produz o bloco de aversões/promoções.

---

## 3. Decisões travadas (NÃO re-litigar)

| # | Decisão | Origem |
|---|---|---|
| D1 | Compilador (LLM 1) produz **só** o bloco de aversões/promoções. Calibração = constante fixa no LLM 2. | conversa 2026-07-01 |
| D2 | **Regra 1** ("em obras escassas confie no consenso") **sai** das preferências livres → é **system-level** no LLM 2. Usuário admite que colocou no lugar errado. | 2026-07-01 |
| D3 | **Não** reproduzir o v3.3 byte-exato; o bar é **semântico + métrico** (MAE ~0,433 / 0 dano). | 2026-06-30 |
| D4 | **Item A** (tags declaradas amo/evito) **entra no LLM 2**, com peso **acima** do perfil inferido. | 2026-07-01 🟦 |
| D5 | Ordem de prioridade robusta = **explícito (Item A + Item B) > inferido (perfil)**. Item A e Item B são **pares** (B refina A); **não** A>B estrito. | 2026-07-01 |
| D6 | **Boost na presença, nunca penalidade na ausência** — regra livre é esparsa (máx 8); traço só no perfil não pode ser rebaixado. | 2026-07-01 |
| D7 | **Convergência** (traço em declarado + perfil + obra) = convicção máxima — mais peso, **não** 3×. | 2026-07-01 |
| D8 | **Anti-flooding:** em evidência escassa, err-high sobe **no máx até ♥♥♥** (♥♥♥♥ exige sinal positivo forte). | 2026-07-01 |
| D9 | Confiança é sinal de **primeira classe** → usos 1 (badge) + 2 (triar) + 3 (priorizar backfill). | 2026-07-01 |
| D10 | Mudança do bloco compilado / Item A entra na **assinatura/versão** → invalida → re-backfill (como o bump v3↔v4). | 2026-06-30 |
| D11 | Compilação recompila **só no edit**, cacheada, persistida em `user_settings.compiled_preferences`, com **preview + aprovação** na UI antes de virar ativa. | 2026-06-30 |

---

## 4. LLM 1 — Compilador de preferências (Peça 1)

**Input:** as 7 regras livres cruas (via `getPreferenceRules`, hoje idênticas ao artefato
`activeRules`). **Output:** `{ compiledBlock, ruleMapping[] }` (o `ruleMapping` é trilha de
auditoria só pro preview — não persiste no artefato ativo).

### 4.1 Princípios do meta-prompt (o ATIVO)

| Princípio | O que faz |
|---|---|
| **P-DROP-META** | regra de *como ler* (ex.: Regra 1) não vira aversão/promoção — é sinalizada e descartada (vai pro LLM 2) |
| **P-SPLIT** | regra mista (gosto + aversão) vira 2 entradas |
| **P-MERGE** | regras do mesmo traço viram 1 entrada |
| **P-TRAIT-vs-PLOT** | traço de personagem (cruel) penaliza; recurso de enredo (vingança) não. Na dúvida, não dispara |
| **P-EXISTÊNCIA≠APROVAÇÃO** | traço no consenso conta mesmo que a multidão o ame (peso = confiança de que existe) |
| **P-TETO** | promoção sobe no máx +1 faixa, nunca além de ♥♥♥ (configurável) |
| **P-ERR-HIGH (framing)** | contexto da assimetria gems-perdidas > MAE (a instrução operacional vive no LLM 2) |

### 4.2 Harness offline

- **Local:** `.local-experiments/plan3/prefs-compiler/` (gitignored, 0 commit, 0 write no banco).
  - `meta-prompt.v1.md` — o meta-prompt (config `PROMOTION_CAP`/`ERR_HIGH` interpolada).
  - `run.mjs` — lê as regras cruas do artefato, roda via SDK cru, imprime bloco + ruleMapping + custo.
- **Rodar:** `node .local-experiments/plan3/prefs-compiler/run.mjs`
- **Custo:** ~$0,03–0,06 por run (Sonnet).

### 4.3 Resultado v1 (2026-07-01)

✅ **Rodou; meta-prompt v1 acertou de primeira** — os 8 princípios foram aplicados corretos
(drop-meta na Regra 1, split nas 2/3/6, merge da 4, trait-vs-plot na 5, promoção na 7).

**Pontos de refino em aberto:**

| # | Observação | Ação | Status |
|---|---|---|---|
| R1 | **Inventa nomes de tags** ("grimdark", "smut") que podem não existir no catálogo → risco de match | instruir "descreva o traço, não invente tag"; idealmente **referenciar as tags declaradas reais** | ⬜ |
| R2 | **Verboso** (4773 vs 2667 chars do v3.3) | pedir densidade (cortar `##`/`---`/listas de exemplo) | ⬜ |
| R3 | **A2⇄P2 acoplados** ("P2 só se A2 não dispara") | decidir: manter acoplamento ou alavancas independentes | ⬜ |
| R4 | Addendum **§5 extrapolado** (o LLM inventou "assimetria de evidência") | irrelevante depois de D1 (calibração é fixa, LLM 1 não gera addendum) | ✅ resolvido por D1 |

---

## 5. LLM 2 — Inputs (incl. Item A)

| Input | Fonte | Status |
|---|---|---|
| Perfil de gosto | `TasteProfilePayload` (loved/avoided tags inferidos) | ✅ já existe |
| Compilado (aversões/promoções) | LLM 1 (hoje `COMPILED_PREFERENCES_V33` hardcoded) | ✅ Peça 2 |
| **Tags declaradas (Item A)** | `getDeclaredTagPreferences` (`user_tag_preferences`) | ⬜ **novo** |
| Tags da obra | `PredictWorkInput.tags` | ✅ |
| Sinopse canônica | `PredictWorkInput.synopsis` | ✅ |
| Digest | `PredictWorkInput.reviewDigest` (contrato e1) | ✅ |

### 5.1 Item A — plumbing

Formato (`user_tag_preferences`, migration 100): `stance` love/avoid + `weight` 1–2 + alvo em
**3 níveis** (tag XOR subgrupo XOR grupo; mais específico vence). **Bônus:** são tags **reais
do catálogo** → match exato, **0 hallucination**.

| Item | Descrição | Status |
|---|---|---|
| A.1 | Novo bloco no prompt (cacheado): `TAGS DECLARADAS (prioridade): ama[...] / evita[...]` | ⬜ |
| A.2 | **Resolver hierarquia** — expandir grupo/subgrupo pro conjunto de tags efetivo (server-side) | ⬜ |
| A.3 | Passar Item A no `PredictWorkInput`/args do preditor + wiring nos leitores | ⬜ |
| A.4 | **Invalidação:** Item A entra na assinatura → editar Item A passa a invalidar Interesse (hoje só recalcula o Ridge) | ⬜ 🔬 acoplamento novo |

---

## 6. LLM 2 — Calibração fixa (system-level)

Constante única no LLM 2 (não gerada pelo compilador). Cada item marcado por convicção.

| # | Item | Convicção | Status |
|---|---|---|---|
| C1 | **err-high** + exceção de aversão ("aversão disparada não é dúvida") | 🧊 validado v3.3 | ✅ existe (mover p/ constante) |
| C2 | **Inversão de sentimento** (traço que a multidão ama mas você evita conta contra) | 🧊 | ✅ existe |
| C3 | **Regra 1** movida pra cá — evidência escassa ⇒ peso maior no digest (consenso/divergência/tendência) | 🔬 | ⬜ |
| C4 | **Ponderação de sinais:** tags=existência (não dobrar, já no perfil); sinopse=premissa/tom; digest=recepção + **dispara aversão contra sinopse cor-de-rosa** | 🔬 (C4-digest-aversão = alta convicção, do motivador Hourglass) | ⬜ |
| C5 | **Conflito** sinopse×digest: tom/execução → digest; premissa → sinopse | 🔬 | ⬜ |
| C6 | **Escassez → err-high capado em ♥♥♥** (D8, anti-flooding) | 🔬 | ⬜ |
| C7 | **Explícito > inferido** — Item A e compilado pesam acima do perfil; convergência = convicção máxima; **boost na presença, não penalidade na ausência** (D5/D6/D7) | 🟦 produto + 🔬 acurácia | ⬜ |
| C8 | **Não dobrar tags** — tags já no perfil; compilado só agrega nuance/condicional | 🔬 | ⬜ |

> ⚠️ Muitos itens 🔬: um LLM competente **já faz** parte disso implícito. Escrever só onde
> corrige falha específica (C4-digest-aversão é a de maior valor). Medir no golden se o resto
> agrega ou só engorda o prompt.

---

## 7. Confiança da previsão

**Estado atual:** ✅ campo `confidence` 0–1 **já existe** — retornado pela tool, persistido
(coluna `confidence`, migration 085), mapeado na query. Definição **estreita** hoje
(`synopsis-quality-predictor.ts:53`): só olha tamanho/clareza da sinopse + força do match.

### 7.1 Ampliar a definição — 2 eixos

| Eixo | Baixa a confiança quando… | Natureza |
|---|---|---|
| **Suficiência de evidência** | poucas tags, digest ausente/fraco, sinopse curta/genérica | **determinística** (mensurável) |
| **Concordância de sinais** | perfil × compilado × declaradas × obra **divergem** | **LLM** (semântico) |

### 7.2 Desenho **híbrido** (recomendado)

`confiança = f(disponibilidade_determinística, concordância_reportada_LLM)`. A disponibilidade
(`#tags`/`#reviews`/len da sinopse — via `getWorkTagReviewCounts`) é **objetiva e calibrável**;
a divergência semântica vem do LLM. Auto-report puro de LLM é **mal-calibrado** → tratar como
**ordinal** (baixa/média/alta), não probabilidade fina.

### 7.3 Consumidores (D9)

| Uso | O que toca | Depende de calibração? | Status |
|---|---|---|---|
| **1. Badge** no card do Interesse | card `/ai-evaluation?tab=sinopse`; mapear 0–1 → baixa/média/alta | ❌ tolera grosseiro | ⬜ |
| **2. Triar** (♥♥♥ de baixa confiança → revisar / buscar reviews) | filtro "Confiança" (reusa infra de filtros existente) | ✅ **sim** | ⬜ |
| **3. Priorizar backfill** | `planInterestBackfillForIds` ordena por confiança/escassez asc; trigger = **crescimento de dado** (contagens atuais vs. da previsão) | ✅ **sim** | ⬜ |

> **Gate:** usos 2 e 3 só valem se a confiança **correlacionar com o erro**. Verificar no golden
> (§10.3) **antes** de ligá-los. Uso 3 tem trigger 100% determinístico (dado cresceu) que
> dispensa o LLM. Uso 1 pode ir mesmo com confiança grosseira.

---

## 8. Versionamento e invalidação

| Item | Descrição | Status |
|---|---|---|
| V1 | `promptVersion = "v4-<hash8>"` sobre (`compiledBlock` + calibração + Item A) — reusa `input_signature` (já inclui prompt_version) e `pickActiveRaw` | ⬜ |
| V2 | Editar regras (→ recompilar) OU editar Item A → hash novo → invalida → re-backfill | ⬜ 🔬 (custo: ~$5/~690 obras por edição — **mostrar no preview**) |
| V3 | Coexistência v3↔v4 graciosa durante backfill (fallback já implementado na Peça 2) | ✅ |

---

## 9. Plano de plumbing (file-by-file)

> Só começar depois do **Fase 0** passar (§12). Todos aditivos/tolerantes.

| # | Arquivo | Ação | Status |
|---|---|---|---|
| F1 | `supabase/migrations/122_user_settings_compiled_preferences.sql` | **novo** — coluna `compiled_preferences jsonb` `{status,sourceRulesHash,promptVersion,compiledBlock,model,compiledAt,approvedAt}` | ⬜ |
| F2 | `lib/ai-evaluation/preference-compiler.ts` | **novo** — `META_PROMPT` + `compilePreferences(rawRules)` (via `createLoggedMessage`) + `compiledVersion(hash8)` | ⬜ |
| F3 | `server/queries/compiled-preferences.ts` | **novo** — `loadActiveCompiledPreferences()` (DB-first, fallback = `COMPILED_PREFERENCES_V33`) | ⬜ |
| F4 | `lib/ai-evaluation/compiled-preferences.ts` | **edit** — mantém v33 como seed; `getActiveCompiledPreferences` vira async; flag continua gate | ⬜ |
| F5 | `server/actions/preference-rules.ts` | **edit** — `compileAndPreviewPreferences()` (status pending) + `approveCompiledPreferences()` (pending→approved, marca stale) | ⬜ |
| F6 | `components/settings/preference-rules-form.tsx` | **edit** — botão "Compilar" → preview do diff + custo re-backfill → "Aprovar e ativar" | ⬜ |
| F7 | resolver call sites (~7) | **edit** — async onde constrói prompt/assinatura; `synopsis-quality.ts:228/292` viram `version?: string` | ⬜ |
| F8 | **Calibração fixa** (constante no LLM 2 / `SYNOPSIS_QUALITY_SYSTEM_PROMPT`) | **edit** — §6 (C1..C8) | ⬜ |
| F9 | **Item A input** — `getDeclaredTagPreferences` + resolução de hierarquia + wiring no preditor | **novo/edit** — §5.1 | ⬜ |
| F10 | **Confiança** — definição ampliada no prompt + score determinístico + buckets ordinais | **edit** — §7 | ⬜ |
| F11 | **Consumidores da confiança** — badge (card) + filtro (aba) + ordenação (backfill planner) | **edit** — §7.3 | ⬜ |
| F12 | `tests/unit/synopsis-interest/preference-compiler.test.ts` | **novo** — determinístico: hash estável, versão `v4-<hash>`, fallback DB→hardcoded, shape | ⬜ |

---

## 10. Validação

### 10.1 Golden pilot-2 (o bar)
90 labels (`finalLabelsSig a8abddca`), baseline e1 reusado. Bar: **MAE ~0,433**, **0 obra amada
rebaixada**, sem inflar ♥♥♥♥ (o erro que matou o v3.4). Harness offline em `.local-experiments/plan3/`.

### 10.2 Estratificação por disponibilidade de dados (🔬 gate de C3/C6/confiança)
Juntar `#tags`/`#reviews`/idade às 90 obras e ver se o erro/viés **correlaciona com escassez**
(obras esparsas são sub-previstas?). **Offline, $0** (re-análise dos outputs e1 existentes).
Se o viés existir → guidance de escassez justificada; senão → não escrever.

### 10.3 Calibração da confiança (🔬 gate dos usos 2/3)
A `confidence` do e1 correlaciona com `|pred − gold|` nas 90 obras? **Offline, $0**. Só ligar
triar/priorizar se sim.

### 10.4 Testes duráveis (CI)
Só o determinístico (F12): hash/versão/fallback/shape. Qualidade do meta-prompt e da calibração
= gate offline, **não** CI (custa LLM).

### 10.5 App rodando
Editar 1 regra → Compilar → preview → Aprovar → reprever 1 obra → conferir `v4-<hash>` novo +
faixa/justificativa/confiança coerentes.

---

## 11. Custos

| Item | Custo | Frequência |
|---|---|---|
| Compilar (1 call, ruleMapping some do artefato ativo) | ~$0,03–0,06 | por edit-aprovação |
| Golden run (e1Compiled, 90 obras) | ~$1–2 | por iteração de validação |
| Estratificação / calibração de confiança (§10.2/10.3) | **$0** | offline, re-análise |
| **Re-backfill** downstream (bloco/Item A muda) | **~$5 / ~690 obras** | por aprovação — **gated no preview** |

---

## 12. Sequenciamento (por custo/risco)

| Fase | O quê | Gate de saída |
|---|---|---|
| **Fase 0** (offline, barato) | refinar meta-prompt (R1/R2/R3); estratificação §10.2; calibração de confiança §10.3; validar meta-prompt no golden §10.1 | meta-prompt reproduz v3.3 semântico + MAE ok; sinais de C3/C6/confiança confirmados ou descartados |
| **Fase 1** (compilador) | F1–F7 + F12 — plumbing do compilador + preview/aprovação | editar regra → preview → aprovar → re-backfill funciona |
| **Fase 2** (calibração + Item A) | F8 + F9 — calibração fixa (só os itens que passaram no gate) + input do Item A | golden não regride; Item A pesando acima do perfil |
| **Fase 3** (confiança) | F10 + F11 — confiança ampliada + 3 consumidores (só se §10.3 passar) | badge/triar/priorizar no app |

> Só a **Fase 1** é a "Peça 1" original. Fases 2–3 são a expansão desta discussão — **PRs
> separados**, cada um com seu gate.

---

## 13. Riscos e hipóteses abertas (🔬)

- Refinar o compilador pode **degradar** as métricas — sempre re-rodar o golden.
- Guidance de escassez + err-high pode **inflar** obras esparsas (precisão de ♥♥♥♥) — daí o teto D8.
- **Explícito > inferido** pode inflar obra que casa superficialmente com 1 tag declarada — medir.
- Confiança de LLM **mal-calibrada** — daí o híbrido determinístico e o gate §10.3.
- **n=90** no golden — CI overall ainda toca 0; sinal robusto = correção de viés, não MAE pontual.

---

## 14. Log de decisões em aberto

| Q | Pergunta | Dono |
|---|---|---|
| Q1 | Modelo do compilador — Sonnet (barato) ou Opus (qualidade, roda raro)? | ⬜ |
| Q2 | R3 — A2/P2 acoplados ou alavancas independentes? | ⬜ |
| Q3 | Buckets de confiança (baixa/média/alta) — thresholds calibrados no golden | ⬜ |
| Q4 | Item A: resolver hierarquia server-side ou passar rótulo de nível pro LLM? | ⬜ |
| Q5 | Resolver async (§F7) — refactor completo (recomendado) vs minimizar ripple | ⬜ |
