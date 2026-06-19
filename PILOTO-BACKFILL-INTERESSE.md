# Piloto do backfill orquestrado — Potencial de Interesse (12 obras)

```
STATUS: EXECUTADO — Etapa 2B.1 concluída em 2026-06-19 (12/12 sucesso, custo real $0.62 ≤ $0.80)
        Pendência ÚNICA: recalc global não roda headless → recalc_pending=true, resumível no app.
```

> Etapa 2B.0 — preparação **read-only** do piloto pago. **Nenhuma** execução, `--execute`,
> LLM, geração de perfil/previsão, recalc, job ou escrita no banco. Deriva de
> [PLANO-BACKFILL-ORQUESTRADO.md](PLANO-BACKFILL-ORQUESTRADO.md) §29/§30. Dados medidos
> por `SELECT` + dry-run read-only em **2026-06-18**. Proveniência: 🟦 código (`file:line`)
> · 🟩 banco (read-only) · 🟨 inferência · 🟧 decisão proposta.

## 1. Objetivo

Validar **na prática e em escopo mínimo** a transição `previsão legada → previsão moderna
com input_signature`, exercitando a cascata real **perfil stale → regenerar perfil 1× →
prever 12 obras selecionadas → recalcular scores globais**, com custo agregado conhecido,
assinatura de plano verificável e impacto global explícito — para a usuária **aprovar ou
rejeitar** a futura execução paga.

## 2. Riscos

| Risco | Sev | Mitigação |
|---|---|---|
| Regenerar o perfil global **invalida ~181 previsões hoje fresh** fora do piloto (§9) | 🟠 | Esperado e documentado; o restante aguarda o lote completo. Aviso explícito. |
| **Rollback parcial** — o upsert sobrescreve a previsão v2 (conteúdo legado perdido); perfil não é restaurável por função segura (§6) | 🟠 | Blast radius = 12 obras; estado anterior das 12 está no snapshot (§5); perfil v6 preservado como linha (re-`is_current` + recalc = recalculável). |
| Custo real acima do esperado | 🟢 | Gate por **upper bound** ($0.769) + `maxCostUsd`; soft-cap interrompe. |
| Mudança externa (perfil/biblioteca/obra) entre dry-run e execução | 🟢 | Re-plano + comparação de assinatura ⇒ `plan_changed`, zero chamada paga (§7). |
| Job `running` órfão | 🟢 | 🟩 `work_processing_jobs` vazia (0); o dry-run avisaria se houvesse. |

## 3. As 12 obras selecionadas (🟩)

| # | work_id | título | estado atual | stale | reviews | tags | sinopse (chars) | sq manual | razão da seleção |
|--:|---|---|---|--:|--:|--:|--:|:--:|---|
| 1 | `3ea43178-1842-4587-b87d-e7c4990725d0` | The Tyrant's Sister | fresh_legacy | não | 42 | 59 | 919 | ♥♥♥ | fresh + reviews + histórico v1+v2 + ranking (align) |
| 2 | `b0cdff89-5860-422b-8a53-fc5ebbdef362` | Looking for the Duchess's Husband | fresh_legacy | não | 0 | **0** | 726 | ♥♥♥ | fresh + **sem reviews** + **sem tags** (fallback) |
| 3 | `40eaecb2-ebcd-4828-9031-9fd78b4d37b3` | The Villainess Who Made an Enemy… | fresh_legacy | não | 3 | 0 | 737 | **—** | fresh + **sem sq manual** + interest ♥♥♥♥ |
| 4 | `66d34ab5-6019-44bb-8bd5-24b48f9e4056` | The Little Princess and Her Monster Prince | stale_legacy | sim | 9 | 44 | 840 | ♥♥♥♥ | stale + histórico v1+v2 + **não-rankeada** (align=false) |
| 5 | `9904c9ec-dc8a-4f63-9a7a-3ac002fcce61` | I'm the Soldier's Ex-Girlfriend | stale_legacy | sim | **40** | 55 | 959 | ♥♥♥ | stale + muitas reviews + histórico + ranking |
| 6 | `6cf21eda-5443-411c-852c-cc71186e0c88` | The Evil Girl Is the Emperor | stale_legacy | sim | 0 | 15 | 867 | ♥ | stale + sem reviews + histórico v1+v2 + sq baixo |
| 7 | `7ba080e0-bcee-4029-871e-8752c508fd34` | Secret Decoding Operation | fresh_legacy | não | 3 | 32 | **389** (curta) | — | **sinopse curta** + fresh + sem sq |
| 8 | `4e4b63d8-3db8-4e2f-8b6b-ae9c7dc91e44` | Campus Secret Girlfriend ♡ | stale_legacy | sim | 3 | 14 | **385** (curta) | ♥ | **sinopse curta** + stale (hash≠sig atual) + interest ♥ |
| 9 | `b273ca57-3256-4a67-964d-9e5fb88fb821` | My Husband Who Hates Me Has Lost… | stale_legacy | sim | 0 | **127** | 704 | ♥♥ | **tags extremas (127)** + sem reviews + stale |
| 10 | `bd5829ac-9e86-4ba5-bcd8-3405188cb0b3` | First Love (Meongji) | stale_legacy | sim | 0 | **0** | 732 | ♥♥ | **0 tags** + sem reviews + interest ♥ + não-rankeada |
| 11 | `5e6c6bbc-b061-4cae-8eb5-49562ad84d75` | Ao Haru Ride | fresh_legacy | não | **73** | 37 | 868 | ♥♥ | **muitas reviews** + fresh + demografia School/Youth + interest ♥ |
| 12 | `29d38599-10d6-4a52-aeee-5739bd7dabff` | Light and Shadow | stale_legacy | sim | 31 | 19 | 880 | ♥♥♥ | stale + interest ♥♥♥♥ + histórico v1+v2 + ranking |

(Sinopse → só comprimento; sem texto/perfil/prompt/secret no documento.)

## 4. Critérios de seleção (🟧)

Escolha por **caminhos técnicos distintos** (não por ordenação acidental). Cobertura:

- **estado da previsão:** fresh_legacy (5: #1,2,3,7,11) + stale_legacy (7: #4,5,6,8,9,10,12) — valida os dois ramos do dual-read → moderno.
- **reviews:** com (#1,3,4,5,7,8,11,12) e sem (#2,6,9,10) — embora reviews **não** entrem no prompt de Interesse, exercita obras de naturezas diferentes.
- **tags:** 0 (#2,10), poucas (#8=14,#6=15), médias (#12=19…#1=59), **extremas (#9=127)**.
- **sinopse:** curtas 385/389 (#7,8) até ~959 (#5) — espalha o range real (🟩 catálogo 330–1212).
- **gênero/demografia:** Fantasy/Romance/Sci-Fi/Superpowers + **School/Youth** (#11).
- **interest atual:** ♥ (#8,10,11) · ♥♥ (#6,7) · ♥♥♥ (#1,2,5,9) · ♥♥♥♥ (#3,4,12) — todos os 4 níveis.
- **synopsis_quality manual:** presente (9) e **ausente** (#3,7).
- **histórico de >1 linha de previsão (v1+v2):** #1,4,5,6,12 (🟩 17 linhas p/ 12 obras).
- **participação em fluxos anteriores (ranking):** `alignment_score` presente em #1,2,3,5,6,9,12; ausente em #4,7,8,10,11.

> Nota (🟩): **#8** tem `stale=false` na linha v2 **mas** `taste_profile_hash`=`7099c18d…`
> (o *input_hash* da v6, não a *assinatura funcional* `ef9f4122…`) ⇒ o planner o classifica
> **stale_legacy** — caso técnico útil (hash divergente apesar de `stale=false`).

## 5. Snapshot read-only anterior (🟩, 2026-06-18)

### Taste profile
- **Total de versões:** 6 (v1…v6, todas `is_stub=false`). Versões anteriores **preservadas** como linhas.
- **Current:** id `072895ca-84c7-473e-9440-e2ed8d117c14`, **version 6**, `is_current=true`, `is_stub=false`, `input_hash=7099c18dc830…be7`, `created_at=2026-06-05`.
- **Assinatura funcional atual** (`computeProfileSignature`): `ef9f4122618b4af9dfc6e63b7f4b4f46808d6916dc0dac5c18879d19736313cb`.

### Previsões das 12 (todas as versões de prompt; 17 linhas)
| work_id | prompt | quality | stale | input_signature | tp_version / hash | predicted_at |
|---|:--:|:--:|:--:|:--:|---|:--:|
| 29d38599… | v1 | ♥♥♥♥ | true | null | 4 / 840e2b94 | 2026-06-02 |
| 29d38599… | v2 | ♥♥♥♥ | true | null | 4 / 840e2b94 | 2026-06-03 |
| 3ea43178… | v1 | ♥♥♥ | true | null | 4 / 840e2b94 | 2026-06-02 |
| 3ea43178… | v2 | ♥♥♥ | false | null | 6 / ef9f4122 | 2026-06-09 |
| 40eaecb2… | v2 | ♥♥♥♥ | false | null | 6 / ef9f4122 | 2026-06-12 |
| 4e4b63d8… | v2 | ♥ | false | null | 6 / 7099c18d | 2026-06-06 |
| 5e6c6bbc… | v2 | ♥ | false | null | 6 / ef9f4122 | 2026-06-08 |
| 66d34ab5… | v1 | ♥♥♥♥ | true | null | 4 / 840e2b94 | 2026-06-02 |
| 66d34ab5… | v2 | ♥♥♥♥ | true | null | 4 / 840e2b94 | 2026-06-03 |
| 6cf21eda… | v1 | ♥♥ | true | null | 4 / 840e2b94 | 2026-06-02 |
| 6cf21eda… | v2 | ♥♥ | true | null | 4 / 840e2b94 | 2026-06-03 |
| 7ba080e0… | v2 | ♥♥ | false | null | 6 / ef9f4122 | 2026-06-18 |
| 9904c9ec… | v1 | ♥♥♥♥ | true | null | 4 / 840e2b94 | 2026-06-02 |
| 9904c9ec… | v2 | ♥♥♥ | true | null | 4 / 840e2b94 | 2026-06-03 |
| b0cdff89… | v2 | ♥♥♥ | false | null | 6 / ef9f4122 | 2026-06-11 |
| b273ca57… | v2 | ♥♥♥ | true | null | 5 / 21712800 | 2026-06-03 |
| bd5829ac… | v2 | ♥ | true | null | 5 / 21712800 | 2026-06-03 |

**input_signature = null em TODAS** (confirma a transição a validar). 5 obras têm v1+v2 (histórico).

### Agregados globais
`total de linhas`=**1026** · `obras com previsão`=**717** · `stale=true`=**826** · `stale=false`=**200** · `input_signature null`=**1026** · `preenchida`=**0**.

### Recálculo
`recalc_pending`=**false** · `recalc_last_edit_at`=**null** · último job `recalculate_scores`=**nenhum**.

### Jobs
`work_processing_jobs` total=**0** (nenhum queued/running/failed). 

## 6. Dry-run com os 12 IDs explícitos (🟩, read-only)

Comando executado (sem `--execute`):
```
npm run backfill:interest -- --work-id=<12 ids>
```
Resultado:
```
escopo: 12 ID(s) explícito(s)
perfil: stale  (ação: regenerate; versão funcional: 6)
obras: total=12 elegíveis=12 | fresh=5 stale=7 ausente=0 bloqueadas=0
previsões planejadas: 12  (recalc final: sim)
custo: likely=$0.513  upperBound=$0.769   (maxCostUsd MÍNIMO: $0.769)
versões: model=claude-sonnet-4-6 prompt=v2 schema=v1 pricing=static@2026-05-23
planSignature: 199586267183f591363a9e821c2f4b766054aabfe0eabe67ad363bc1548d9abc
```
**Ações do plano (confirmadas):** `1 × ensure_taste_profile` + `12 × predict_interest_potential` + `≤1 × recalculate_scores`. **Bloqueios:** nenhum (0 absent, 0 blocked, 0 missing). **Aviso:** *"A regeneração do perfil tornará stale as previsões restantes do catálogo. Este plano atualizará somente as obras selecionadas. As demais permanecerão para um lote posterior."*

> Nenhuma obra precisou de substituição — as 12 são elegíveis (canonical 100%). Manifesto final = exatamente 12.

## 7. Assinatura do plano
```
199586267183f591363a9e821c2f4b766054aabfe0eabe67ad363bc1548d9abc
```
Determinística (🟦 [interest-backfill.ts](lib/orchestration/backfill/interest-backfill.ts) `computeInterestPlanSignature`): embute escopo (12 ids ordenados), perfil v6 + `PENDING_PROFILE_REGEN`, `libraryInputHash`, model/prompt/schema/pricing, itens (assinatura de escopo por obra) e custos. **Qualquer** mudança em perfil/biblioteca/obra do escopo altera a assinatura ⇒ exige novo dry-run.

## 8. Custo para aprovação

| Operação | Qtd | Likely | Upper (autorização) | Histórico médio/call (🟩) |
|---|--:|--:|--:|--:|
| ensure_taste_profile | 1 | $0.387 | **$0.581** | $0.388 (n=8) |
| predict_interest_potential | 12 | $0.126 | **$0.189** | $0.0097/call (n=1089) |
| recalculate_scores | 1 | $0.000 | **$0.000** | free (TS puro) |
| **Total** | | **$0.513** | **$0.769** | ~$0.50 (diagnóstico) |

- **Upper contratual** (= `likely × 1.5`, 🟦 [cost.ts](lib/orchestration/cost.ts) `COST_SAFETY_MULTIPLIER`) é a base de autorização: **$0.769**.
- **`maxCostUsd` mínimo aceito pela CLI:** deve ser **≥ $0.769** (a CLI bloqueia se upper > teto).
- **Sugestão de teto arredondado:** **$0.80** (≥ upper, com folga mínima).
- 🟨 O custo **histórico** (~$0.50) **NÃO** substitui o upper — é só diagnóstico; autorizar pelo upper.

## 9. Impacto global projetado (🟩 + 🟨)

A execução: **gera 1 novo perfil (v7) → marca previsões anteriores stale → prevê só as 12 → recalcula scores globais.**

| Métrica | Antes (🟩) | Depois (🟨, projeção) |
|---|--:|--:|
| Obras com previsão **fresh moderna** (input_signature, vs v7) | 0 | **12** |
| Obras **fresh legada** (vs v6) | 186 | 0 (perfil mudou) |
| Obras stale/ausentes (aguardando lote) | 548 | **722** (734 − 12) |
| Previsões hoje fresh que serão **invalidadas** | — | **181** (186 fresh_legacy − 5 do piloto re-previstas) |
| Linhas globais marcadas stale por `markSynopsisPredictionsStale` | — | as 200 `stale=false` → stale |

> ⚠️ **Este piloto atualiza o perfil global, mas reprocessa somente 12 obras. O restante
> do catálogo continuará aguardando o backfill completo.** Isto é **esperado**, não erro.

## 10. Reversibilidade e rollback (auditoria 🟦, sem executar)

### Taste profile — **PARCIAL**
- Versões anteriores **preservadas** (🟩 6 linhas; insert cria nova linha). ✅
- `is_current`: 🟦 [taste-profile.ts:147](lib/ai-recommendation/taste-profile.ts#L147) `markAllProfilesAsStale` (UPDATE all `is_current=false`) **e depois** insert da nova com `is_current=true` — **dois statements, NÃO transacional**.
- Função segura de restauração? **NÃO** — não existe. Reverter = `UPDATE` manual (v7 `is_current=false`, v6 `is_current=true`).
- Restaurar marca previsões/scores stale? **NÃO automaticamente** — `markSynopsisPredictionsStale`+`markRecalcPending` só disparam **dentro** de `insertNewTasteProfile` (em inserts), não num flip manual de `is_current`. ⚠️
- Risco de dois current? **Sim, janela teórica** (não-transacional; sem constraint de "um único current"). Mitigado por single-flight/dedup, mas não garantido pelo schema.
- Rollback transacional? **NÃO**.

### Previsões — **NÃO DISPONÍVEL (exato)** / recalculável (aproximado)
- 🟦 `upsertSynopsisPrediction` (`onConflict: work_id,prompt_version`) **sobrescreve a linha v2 no lugar** — o conteúdo legado da v2 é **perdido** (unique `(work_id, prompt_version)`, migration [086](supabase/migrations/086_synopsis_predictions_multi_version.sql)).
- Output legado preservado? **NÃO** (v2 sobrescrita). A linha v1 sobrevive, mas o predictor atual lê só v2.
- Apagar a previsão moderna volta ao dual-read legado? **NÃO** — `loadCurrentPrediction(v2)` retornaria **null/absent** (a legada *era* a v2 sobrescrita), não a legada.
- Restaurar sem reconstrução manual? **NÃO**. Re-prever contra a v6 restaurada = nova chamada LLM (não-determinística) ⇒ aproximação, não cópia.
- Mitigação: o estado anterior das 12 (quality/stale/hash) está no **snapshot §5**.

### Calculated scores — **RECALCULÁVEL**
- Snapshot dos valores anteriores? **NÃO** há backup automático de `calculated_scores` (a tabela `prediction_snapshots` da migration 105 registra previsões no momento da recomendação, **não** é backup dos scores).
- Recálculo reversível? `recalculateAll` sobrescreve in-place, mas é **determinístico** dado (perfil + scores + ratings).
- Restaurar perfil anterior + re-recalcular recompõe? **SIM** (personal_fit é derivado do perfil; expected_score é determinístico do Ridge sobre os labels). 
- O que **não** se restaura exatamente: nada de novo se nenhum outro input mudou; se labels/notas mudarem no intervalo, diverge.

**Veredito de reversibilidade:** taste_profile **parcial** · previsões **não disponível** (exato) / recalculável (LLM) · scores **recalculável**. **Não há rollback transacional limpo** — 🟧 risco a aceitar conscientemente; mitigado pelo blast radius de 12 e pelo snapshot.

## 11. Checklist de integridade do executor (revisão estática 🟦)

| # | Garantia | Evidência | OK |
|--:|---|---|:--:|
| 1 | `--execute` obrigatório | CLI: dry-run é o default; ramo execute só com `args.execute` | ✅ |
| 2 | `planSignature` obrigatória | [cli-args.ts](lib/orchestration/backfill/cli-args.ts) refine (execute exige plan-signature) | ✅ |
| 3 | `maxCostUsd` obrigatório | idem refine | ✅ |
| 4 | plano recalculado antes da 1ª chamada paga | `runInterestBackfill` passo 1 (re-plano) antes de ensureProfile/predict | ✅ |
| 5 | mudança na biblioteca bloqueia | re-plano `libraryInputHash` ⇒ assinatura diverge ⇒ `plan_changed` | ✅ |
| 6 | mudança no perfil bloqueia | re-plano `profileSignature/version` ⇒ `plan_changed` | ✅ |
| 7 | mudança nas obras bloqueia | assinatura embute dados da obra ⇒ `plan_changed` (testes T3/T9) | ✅ |
| 8 | obra fora do escopo não entra | executor itera só `plan.itemsToPredict` (escopado) | ✅ |
| 9 | upper precisa caber no teto | passo 2: `upperBound > maxCostUsd` ⇒ `blocked_cost_confirmation` | ✅ |
| 10 | regeneração interna aceita | re-plano ocorre **antes** do regen ⇒ não dispara `plan_changed` (teste T1/T2) | ✅ |
| 11 | mudança externa posterior interrompe | `loadCurrentProfileSignature` entre itens ⇒ `stoppedByPlanChange` (teste T4) | ✅ |
| 12 | falha do perfil impede previsões | ramo profile retorna `profile_failed` antes das previsões | ✅ |
| 13 | falha de 1 previsão não apaga anteriores | por-item; job failed não deleta (teste 25) | ✅ |
| 14 | recalc só após perfil persistido | passo 5, após previsões, só se `profileUpdated` | ✅ |
| 15 | SIGINT/SIGTERM não inicia novos | `shouldStop()` no topo do worker (teste 30) | ✅ |
| 16 | build/render/import não executam | `isProductionBuildPhase` guard + módulo sem efeito por import (testes 33–35) | ✅ |

**Nenhum bug bloqueante encontrado.** Nenhuma alteração de código nesta etapa.

## 12. Comando futuro (NÃO executado — proposta para aprovação)

```bash
npm run backfill:interest -- \
  --execute \
  --work-id=3ea43178-1842-4587-b87d-e7c4990725d0,b0cdff89-5860-422b-8a53-fc5ebbdef362,40eaecb2-ebcd-4828-9031-9fd78b4d37b3,66d34ab5-6019-44bb-8bd5-24b48f9e4056,9904c9ec-dc8a-4f63-9a7a-3ac002fcce61,6cf21eda-5443-411c-852c-cc71186e0c88,7ba080e0-bcee-4029-871e-8752c508fd34,4e4b63d8-3db8-4e2f-8b6b-ae9c7dc91e44,b273ca57-3256-4a67-964d-9e5fb88fb821,bd5829ac-9e86-4ba5-bcd8-3405188cb0b3,5e6c6bbc-b061-4cae-8eb5-49562ad84d75,29d38599-10d6-4a52-aeee-5739bd7dabff \
  --plan-signature=199586267183f591363a9e821c2f4b766054aabfe0eabe67ad363bc1548d9abc \
  --max-cost-usd=0.80 \
  --concurrency=2
```
- **NÃO** inclui `--retry-failed` (primeira execução).
- Concorrência conservadora **2**.
- ⚠️ **Qualquer mudança no catálogo/perfil/biblioteca exige novo dry-run e nova `planSignature`** — a assinatura acima só vale enquanto o estado de 2026-06-18 não mudar.

## 13. Checklist pós-execução (futuro — não automatizar agora)

**Taste profile:** nova versão (v7) current e não-stub · v6 preservada · `input_hash` = hash da biblioteca usada · **exatamente 1** current.
**Previsões das 12:** 12 fresh · `input_signature` preenchida · prompt/model/schema corretos · `taste_profile_hash` = assinatura funcional da v7 · sem duplicação · **nenhuma obra fora das 12** atualizada.
**Catálogo restante:** ~722 stale/ausentes · nenhum processamento silencioso · lote posterior necessário.
**Scores:** `recalc_pending=false` · **exatamente 1** recálculo efetivo · `personal_fit` atualizado · fórmulas intactas.
**Jobs:** sem queued/running abandonado · succeeded/failed por ação · `attempts` · custos estimado/real · erros sanitizados.
**UI (checagem manual):** página de 1 obra do piloto · página de 1 obra fora do piloto · tela de Potencial de Interesse · ranking/personal_fit (regressão visual).

## 14. Go / No-Go

### ✅ GO se (todos):
exatamente 12 obras no escopo (✅) · nenhuma bloqueada (✅ 0 blocked/absent/missing) · plano assinado (✅) · upper definido (✅ $0.769) · executor passa na revisão (✅ §11) · rollback compreendido (✅ §10 — parcial) · nenhuma alteração externa desde o dry-run · impacto global aceito (§9).

### ⛔ NO-GO se (qualquer):
perfil/biblioteca mudarem · alguma das 12 mudar · plano com >12 obras · upper mudar · job running inesperado · risco de rollback não aceito · bug no executor · dry-run gerar escrita · qualquer teste falhar.

### Recomendação técnica (🟧)
**GO técnico** — todas as garantias verificadas, blast radius mínimo (12 obras), estado anterior snapshotado, perfil v6 preservado. **Porém duas decisões são da usuária** (§15): (a) aceitar que **181 previsões hoje fresh** fora do piloto fiquem stale aguardando o lote completo; (b) aceitar o **rollback parcial** (re-`is_current`+recalc é recalculável; o conteúdo exato das 12 previsões legadas é sobrescrito — o snapshot §5 é o registro de referência). Sem aceitar (a) e (b), recomendo **NO-GO** até definir o lote completo subsequente.

## 15. Decisões que dependem da usuária

1. **Aprovar o custo:** upper **$0.769**, teto sugerido **$0.80**. (🟧 sugiro aprovar — custo trivial para validar a transição.)
2. **Aceitar a invalidação global:** regenerar o perfil torna stale ~181 previsões hoje fresh fora do piloto (§9). (🟧 aceitável **se** houver compromisso de rodar o lote completo depois — senão o ranking exibirá mais ♥ desatualizados temporariamente.)
3. **Aceitar o rollback parcial** (§10). (🟧 aceitável no piloto de 12; reavaliar antes do catálogo completo.)
4. **Concorrência 2 e sem `--retry-failed`** na 1ª execução. (🟧 recomendado.)

---

### Banco (confirmado, somente SELECT)
```
chamadas pagas: 0   ·   LLM: 0   ·   taste profiles criados: 0
previsões criadas/alteradas: 0   ·   jobs criados: 0
recalc_pending: inalterado (false)   ·   migrations: nenhuma
work_processing_jobs 0 / taste_profile 6 / synopsis_quality_predictions 1026  (idênticos antes/depois)
```

---

# RESULTADO DA EXECUÇÃO — Etapa 2B.1

> Execução pago **autorizada e concluída** em **2026-06-19 ~02:44 UTC**. Comando único
> com `--execute`, 12 IDs, assinatura aprovada, `--max-cost-usd=0.80 --concurrency=2`,
> sem `--retry-failed`. Snapshot de segurança feito antes (read-only, gitignored).

## Pré-execução (confirmado)
- Branch `feat/data-orchestration`; working tree limpo; **0** jobs queued/running; 12 IDs explícitos; 0 arquivada/bloqueada; código inalterado desde `d483128`.
- **Snapshot de segurança:** `.local-backups/interest-pilot-before-2026-06-19T02-42-07-573Z.json` · 2.357.334 bytes · **sha256 `c1a5bf2379ea64e80c998d10d86bb55dde81a5a2012188464ca11d56abf2d45e`** · linhas: taste_profile 6, synopsis_quality_predictions 1026, calculated_scores 737, formula_config 1, work_processing_jobs 0. (NÃO versionado.)
- **Dry-run final:** assinatura `199586267183f591363a9e821c2f4b766054aabfe0eabe67ad363bc1548d9abc` (**idêntica à aprovada**), upper $0.769 ≤ $0.80, 12 elegíveis / 0 blocked / 0 missing.

## Execução
| | resultado |
|---|---|
| status | **COMPLETED** |
| planned / started / succeeded | 12 / 12 / **12** |
| freshSkipped / failed / blocked / changedDuringRun | 0 / 0 / 0 / 0 |
| stoppedByCost / PlanChange / Cancel | false / false / false |
| profileUpdated | **true** (v6 → **v7**) |
| recalcExecuted | **false** (ver pendência) |
| duração | **118.4 s** |

## Custos (🟩 jobs)
| Operação | Qtd | Likely | Upper | **Real** |
|---|--:|--:|--:|--:|
| ensure_taste_profile | 1 | $0.387 | $0.581 | **$0.5003** |
| predict_interest_potential | 12 | $0.126 | $0.189 | **$0.1193** |
| recalculate_scores | 1 (failed) | 0 | 0 | **$0.0000** |
| **Total** | | $0.513 | $0.769 | **$0.6196** |

Real **$0.6196 ≤ teto $0.80** ✅ (entre likely $0.513 e upper $0.769).

## Estado posterior (🟩, read-only)
**Taste profile:** 7 versões; **v7 current**, `is_stub=false`, **exatamente 1 current**; v6 preservada (`is_current=false`). Novo `input_hash=210021707a97…`; nova assinatura funcional `23eb13f0067132c5…`.

**As 12 obras (v2):** todas `stale=false` · **`input_signature` preenchida** · `taste_profile_hash` = nova assinatura v7 (12/12) · `taste_profile_version=7` · model `claude-sonnet-4-6` · `predicted_at=2026-06-19`. **Transição legada→moderna validada.**

**Fora do escopo:** **apenas 12** linhas no catálogo têm `input_signature` (v2_with_sig_GLOBAL=12, all_with_sig_GLOBAL=12) ⇒ **nenhuma obra fora das 12 recebeu previsão**. `total=1026` (upsert in-place, sem linhas novas, sem duplicação).

**Cobertura antes → depois (1026 linhas):** fresh `200 → 12` · stale `826 → 1014` · input_signature preenchida `0 → 12`. **Obras restantes para o backfill:** ~722 (stale, aguardando lote).

**Scores / recalc:** ⚠️ `recalc_pending=**true**` (recalc_last_edit_at=2026-06-19T02:44:16). **personal_fit NÃO recalculado** — o job `recalculate_scores` falhou com `Invariant: incrementalCache missing in unstable_cache` (🟦 `recalculateAll` usa `unstable_cache`/`revalidatePath`, que exigem um **request scope do Next**; não rodam via CLI/tsx). **NÃO é falha de cálculo nem chamada paga** — é limitação do recalc headless. Job preservado `failed` (attempts=1), **resumível** com o mesmo `dedup_key`: o próximo page-load do app (auto-recalc) ou "Recalcular agora" o conclui (grátis) e zera `recalc_pending`. Fórmulas **inalteradas**.

**Jobs (14):** `ensure_taste_profile/succeeded` 1 · `predict_interest_potential/succeeded` 12 · `recalculate_scores/failed` 1. Nenhum queued/running abandonado. Custo estimado total $0.7695 / real $0.6195.

## Escopo (confirmação explícita)
- **Nenhuma obra fora das 12** foi prevista (✅ só 12 com `input_signature`).
- **Nenhum retry** executado (sem `--retry-failed`; nenhum re-run).
- **Lote restante (~722) NÃO iniciado.**

## Diferença planejado × executado
Idêntico ao plano **exceto o recalc**: planejado "≤1 recalculate_scores"; executado **0 recálculo efetivo** + **1 job failed resumível** (limitação headless, não prevista no dry-run). As 12 previsões + perfil saíram exatamente como planejado; custo real abaixo do upper.

## Critérios de sucesso — avaliação
| Critério | Status |
|---|:--:|
| novo perfil válido criado (v7, não-stub, 1 current) | ✅ |
| exatamente 12 obras processadas | ✅ |
| nenhuma obra externa recebeu previsão | ✅ |
| 12 previsões com `input_signature` | ✅ |
| sem duplicação | ✅ |
| custo real ≤ $0.80 | ✅ ($0.62) |
| recálculo global ≤ 1 vez | ✅ (1 job; 0 efetivo) |
| `recalc_pending` terminou false | ⚠️ **NÃO** (true; recalc headless falhou — resumível no app) |
| sem job queued/running abandonado | ✅ |
| erros persistidos e retomáveis | ✅ (recalc job failed, resumível) |

**Veredito:** piloto **bem-sucedido na parte paga e na validação da transição/escopo**; **uma pendência operacional** (recalc não roda headless) — recuperável de graça no runtime do app, sem novo custo.

## Recomendação GO/NO-GO para o backfill restante (~722)
🟧 **GO condicional** — a transição legada→moderna, o isolamento de escopo e o custo foram validados empiricamente. **Antes** do lote restante, exigir:
1. **Concluir o recalc pendente no app** (page-load/"Recalcular agora") e confirmar `recalc_pending=false` + `personal_fit` atualizado vs v7. (Grátis.)
2. **Tratar o recalc headless** para o lote: ou rodar o lote e concluir o recalc no app depois, ou ajustar a etapa de recalc do executor para um caminho headless-safe (Etapa 2B.2) — **decisão de produto**.
3. **Novo dry-run + nova assinatura** imediatamente antes (o perfil agora é v7; provavelmente **fresh** ⇒ o lote restante **não** regenera perfil, só prevê ~722 — custo estimado ~$7 likely / ~$11 upper, **a reconfirmar no dry-run**).
4. Manter lotes controlados + teto explícito (não autorizar catálogo inteiro de uma vez sem reavaliar).

**NO-GO** se: recalc pendente não for concluído; o dry-run do lote mudar de forma inesperada (ex.: perfil voltar a stale); custo upper exceder o teto aprovado; ou surgir job abandonado.
