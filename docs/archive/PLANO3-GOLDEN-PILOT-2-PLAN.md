> **✅ ATUALIZAÇÃO 2026-06-23 — EXPERIMENTO CONCLUÍDO (a linha STATUS abaixo é de 2026-06-21 e está superada).** Rotulagem humana concluída (90 labels finais, `finalLabelsSignature=a8abddca…`) e candidatos executados: **holdout MAE e1=0.441 < b1=0.500 ≪ d2=0.794 < d1=0.912** (LLM ≫ determinístico; e1−b1 inconclusivo, IC⊃0, n=90). Custo real dos candidatos $1.45. **Contrato RATIFICADO = b1** (Sonnet, sem digest); Lote 02 backfill concluído (757/757, $5.86, perfil v8). Detalhes e reconciliação em [PLANO-MESTRE §24i/§24j](PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md). Os marcadores "PENDENTE DE RATIFICAÇÃO" / "execução paga NÃO autorizada" abaixo **não valem mais**.

STATUS: PILOT-2 — **MATERIALIZADO (local)** + **base-2 MATERIALIZADO (local)** · **PENDENTE DE RATIFICAÇÃO HUMANA**. **Fase B2.2M (2026-06-21):** migration 112 revalidada read-only (existe/RLS/0 policies/0 rows); editor LOCAL de reviews externas (gate fechado por padrão) + corpus canônico ligado a preflight/planner/executor (guard) — `work_manual_reviews` proibida; **0 review · 0 digest · 0 custo · 0 escrita no DB**; base-2r1 não criada; Q2–Q5 não ratificadas (§37–§45). Fase **B2.2F** (seleção, 2026-06-20) + **B2.2F-audit** (2026-06-21). Seleção tecnicamente concluída: 39 obras novas determinísticas (seed `pilot-2-selection-v1`) + 10 repeats (`pilot-2-repeats-v1`); 90 únicas / 100 slots · dev 56 / hold 34 · strata 22/23/23/22. Gate de reviews passou (30 fresh ≤30d / 9 no_reviews / 0 blockers) ⇒ base-2 materializado (51 carryovers de base-1 + 39 novas capturadas). **Q2–Q5 ainda NÃO ratificadas explicitamente pela usuária; execução paga NÃO autorizada.** Auditoria final (read-only, $0): seleção REPRODUZ, manifesto/base-2/carryovers/preflight OK, **0 discrepâncias**; dry-run de custo **corrigido** (planner real `estimateStep`): 30 digests **likely $1,41 / upper $2,11** (o anterior $0,59/$3,47 era bug, **superseded**). Zero chamada paga, zero escrita no DB (só `SELECT`), labels não lidos. enriched-2/contextual-2 não criados.

# Plano 3 — Golden prospectivo pilot-2 (planejamento)

> Continuação da transição auditoria→Plano 3. Não reabre decisões congeladas; introduz a
> camada **prospectiva limpa** exigida após a descoberta de leakage retrospectivo na rotulagem do
> `contextual-1`. Proveniência: 🟦 código · 🟩 DB (read-only 2026-06-20) · 🟨 inferência · 🟧 decisão da usuária.

---

## 0. Por que existe um pilot-2

Durante a rotulagem do pacote `contextual-1`, a usuária percebeu que **algumas obras já haviam
sido lidas**. Para uma obra lida, é impossível separar:

```
potencial de interesse ANTES da leitura   (o que o experimento quer medir)
opinião formada DEPOIS de ler             (leakage retrospectivo)
```

O alvo do Plano 3 é **prospectivo**: estimar quanto uma obra *ainda não lida* pode interessar.
⇒ a métrica principal precisa de um golden **prospectivo limpo**.

---

## 1. Decisões metodológicas já congeladas (🟧→✅)

| Decisão | Regra |
|---|---|
| **Classificação AUTOMÁTICA (nova)** | o status de leitura das 80 é derivado **exclusivamente** de `works.personal_status_id`; **substitui** o preenchimento manual |
| **Fonte de verdade** | tabela `personal_status` do Supabase (`SELECT` read-only) |
| **3 categorias** | `unread` · `partially_read` · `fully_read` — **familiaridade removida** (não coletada nem analisada); sem `uncertain` |
| **`Unknown = unread`** | regra explícita; + Untracked/Neutral/Want to Read/To Read/sem status/`null` → `unread` |
| **`fully_read`** | Completed/Finished |
| **`partially_read`** | "a leitura foi iniciada, independente de conclusão": Reading/Started/Stalled/On-hold/Hiatus/Dropped/Paused/Abandoned |
| **Status manda** | `chapters_read`/`total_chapters`/`last_read_at` só para **auditoria**; **não** alteram a classificação (inconsistências só registradas) |
| **Só para o benchmark** | o status de leitura é critério **pontual** de elegibilidade do pilot-2 — **não** entra em prompt/candidato/input signature/ranking, **não** é exigido de obras novas no uso real e **não** vira dependência do produto |
| **Benchmark congelado** | o pilot-2 é **congelado**; **não** acompanha automaticamente o crescimento do catálogo |
| **Elegíveis ao prospectivo** | `unread` (entram no pilot-2) |
| **Exclusão prospectiva** | `partially_read` + `fully_read` saem da métrica principal; **preservados** em pilot-1 como retrospectivo |
| **Unidade estatística** | `work_id` único (repetições **não** são observações independentes) |
| **Preservar lidas** | as obras lidas **permanecem em pilot-1** como material retrospectivo (não descartadas) |
| **Q1 — Reaproveitamento de labels (DECIDIDA)** | reaproveitar o label de uma obra classificada **`unread`** **somente** quando o input contextual exibido for **comprovadamente idêntico** (mesma assinatura de display — §4A); se o input mudar, **aquela** obra é **re-rotulada** |
| **Q6 — Trilha retrospectiva (DECIDIDA)** | obras lidas (`partially_read`/`fully_read`) ficam em **trilha retrospectiva separada**; **nunca** entram na métrica prospectiva principal |

---

## 2. Estado preservado do pilot-1 (esta sessão)

| Artefato | Local | Estado |
|---|---|---|
| Labels contextuais (90/90) | `.local-experiments/plan3/digest-exp-1/enriched-1/golden-contextual-labels-working.csv` | **embargo** — íntegros, verificados 90/90 |
| Cópia preservada com hash de integridade | `…/enriched-1/labels-embargo-2026-06-21T00-24-32Z/` (read-only `chmod 444` + SHA-256 + `EMBARGO.md`) | **checkpoint de restauração** (o `chmod 444` reduz sobrescrita acidental; **não** é garantia criptográfica — a integridade real é o SHA-256) |
| Snapshot base-1 / enriched-1 | `…/base-1/` · `…/enriched-1/` | **congelados** (assinaturas reverificadas, inalteradas) |
| Classificação de leitura | `.local-experiments/plan3/digest-exp-1/pilot-1-audit/` (`…-auto.{csv,json,manifest.json}` + README; form manual SUPERSEDED) | **automática, concluída** (51/17/12) |

Assinaturas congeladas (reverificadas 2026-06-20, inalteradas): `snapshotBaseSignature=634571c2…`,
`enrichedSnapshotSignature=8b61084d…`, `contextualPackageSignature=9e4d1b9f…`,
`sanitizedDigestCorpusSignature=7958c236…`, `reviewCorpusSignature=8776419e…`.

---

## 3. Classificação automática (🟩 DB, read-only — RESULTADO)

`npm run reading-status:auto` deriva o status das 80 obras de `works.personal_status_id` (join com
`personal_status`). Status reais presentes e mapeamento aplicado:

| `personal_status` (id) | total | dev | hold | → categoria |
|---|--:|--:|--:|---|
| Want to Read (8) | 51 | 33 | 18 | `unread` |
| Completed (1) | 12 | 5 | 7 | `fully_read` |
| On-hold (7) | 9 | 7 | 2 | `partially_read` |
| Dropped (9) | 3 | 1 | 2 | `partially_read` |
| Reading (2) | 2 | 1 | 1 | `partially_read` |
| Started (3) | 2 | 2 | 0 | `partially_read` (regra semântica) |
| Stalled (4) | 1 | 1 | 0 | `partially_read` (regra semântica) |

**Resultado:** `unread=51` · `partially_read=17` · `fully_read=12` (cobertura por split no
manifesto). **1 inconsistência** diagnóstica (`Want to Read` + `chapters_read>0`) — segue `unread`,
só registrada. Status não presentes entre as 80: Hiatus(6), Untracked(10).

---

## 4. Estrutura-alvo do pilot-2 (🟧 — proposta, não materializada)

| Parâmetro | pilot-1 | **pilot-2 (alvo)** |
|---|---|---|
| obras únicas | 80 | **90 (todas não lidas)** |
| slots repetidos | 10 | **10** |
| slots totais | 90 | **100** |
| splits | dev 50 / holdout 30 | preservar proporção 5:3 → ~**56 dev / 34 holdout** (🟧 a confirmar) |
| estratos | ♥ … ♥♥♥♥ | preservar distribuição do pilot-1 (🟧 a confirmar) |
| versões | pilot-1 / base-1 / enriched-1 / contextual-1 | **pilot-2 / base-2 / enriched-2 / contextual-2** |

**Fórmula oficial de composição:**

```
new_works_needed = 90 − confirmed_unread
confirmed_unread = #unread (obras únicas)  =  51   ⇒   new_works_needed = 39
```

Valor já fechado pela classificação automática (§3). A seleção das obras novas é **proibida nesta
sessão** e fica para etapa posterior, com os mesmos critérios de readiness do pilot-1 (canonical
fresh, tags, IDs externos aceitos; digest p/ o e1).

### 4A. Assinatura de equivalência de display (operacionaliza Q1)

`computeLabelDisplaySignature` ([label-reuse.ts](lib/synopsis-interest/label-reuse.ts)) é uma função
**pura** que hasheia **somente o que o avaliador vê** no card: sinopse canônica · tags após
`selectContextualTags` (independente de ordem) · tipo de contexto de reviews · digest sanitizado ·
versão da rúbrica/target construct · versões das políticas de seleção de tags e de sanitização.
**Não** inclui label humano, status de leitura, split, stratum, saída de candidato, previsão nem
`work_id`. Quando existir um `enriched-2`:

```
assinatura(enriched-1) == assinatura(enriched-2)  → reaproveitar o label da obra NÃO lida (Q1)
assinatura(enriched-1) != assinatura(enriched-2)  → re-rotular AQUELA obra
```

Nesta fase apenas a função + testes existem; **nenhuma** comparação com `enriched-2` (inexistente).

---

## 5. Ferramental (Fase B2.2D)

| Componente | Onde | Estado |
|---|---|---|
| **Classificação automática** | `npm run reading-status:auto` ([reading-status-auto.ts](lib/synopsis-interest/reading-status-auto.ts)) → `…/pilot-1-audit/pilot-1-reading-status-auto.{csv,json,manifest.json}` | **VIGENTE**. Deriva do status; guarda contra sobrescrita (`--force`); para se houver status não mapeado; gera CSV/JSON/manifesto sem labels |
| Assinatura de display | [label-reuse.ts](lib/synopsis-interest/label-reuse.ts) | VIGENTE (operacionaliza Q1 — §4A) |
| Formulário manual offline | `npm run reading-status:form` → `…/pilot-1-reading-status-form.html` | **SUPERSEDED — não é gate** (preservado, não apagado/alterado) |
| Validador manual | `npm run reading-status:validate` | **SUPERSEDED — ferramenta histórica** |

A classificação automática produz, por obra: `work_id · title · personal_status_id ·
personal_status_name · derived_reading_status · chapters_read · total_chapters · last_read_at ·
diagnostic_flags`. **Nunca** inclui: label contextual, valor do label, candidate output, previsão,
score, alignment, ranking. Lógica pura coberta por testes (mapeamento, `Unknown→unread`,
status manda sobre capítulos, não-mapeado→erro, conjunto exato 80, sem duplicado, fórmula,
independência de ordem, guarda de sobrescrita).

---

## 6. Sequência (gating) até pilot-2

```
[FEITO  ] 1. preservar labels (embargo) + classificação automática de leitura (51/17/12) + plano
[DECISÃO] 2. decisões que SOBRAM: Q2/Q3/Q4/Q5 (§7) — Q1 e Q6 já estão congeladas (§1)
[DIFERIDO] 3. selecionar 39 obras novas não lidas → base-2 → enriched-2 (digests, PAGO) → contextual-2 → rotular lacunas
[PARALELO] 4. análise retrospectiva secundária sobre as obras lidas do pilot-1 (trilha separada)
```

A classificação manual **deixou de ser gate** (é automática). Nenhum passo ≥3 inicia sem §7 (Q2–Q5)
decidido. Pilot-2 **não** é criado nesta sessão.

---

## 7. Decisões que AINDA exigem autorização (🟧 — propostas, NÃO aprovadas)

> Q1 (reaproveitamento de labels) e Q6 (trilha retrospectiva) **já foram decididas** — ver §1.

| # | Decisão (proposta) | Recomendação | Base |
|---|---|---|---|
| **Q2** | Orçamento/critério das obras novas (`new_works_needed`) | preservar estratos+split do pilot-1; exigir o mesmo gate de readiness; **selecionar só após esta decisão** | comparabilidade com pilot-1; evita viés de seleção |
| **Q3** | Proporção dev/holdout do pilot-2 | manter 5:3 (≈56/34) | continuidade metodológica |
| **Q4** | Os 10 repetidos do pilot-2 | escolher **novos** 10 entre as 90 (não herdar os repeats do pilot-1) | confiabilidade intra-avaliadora medida no conjunto novo |
| **Q5** | Refresh de reviews/digest p/ obras novas | seguir a política do pilot-1 (≤30d = fresh; digest é etapa **paga** separada) | consistência; custo gated |

---

## 8. O que esta sessão **NÃO** fez (limites respeitados)

```
não leu/analisou labels         não calculou distribuição/concordância/MAE/QWK dos labels
não executou candidatos          não rodou métricas
não gerou digests                não alterou reviews/snapshots/labels/HTML/embargo
não criou pilot-2/base-2/enriched-2/contextual-2   não selecionou obras novas
não chamou LLM                   não gerou custo        não escreveu no DB
```

Banco: **somente SELECT** (`personal_status` + `works`, read-only). A classificação automática
**não** lê os labels contextuais (eixo separado).

---

# Fase B2.2E — Planejamento da composição (2026-06-20)

> Read-only + planejamento. **Nenhuma obra selecionada, nenhum pilot-2 criado, zero custo.**
> Recomendações **não** são decisões. Funções puras em
> [pilot2-composition.ts](lib/synopsis-interest/pilot2-composition.ts) (+ testes).

## 9. Composição dos 51 carryovers (🟩 snapshots congelados — Parte C)

Cruzando só `work_id × derived_reading_status × split × stratum` (auto ∩ enriched-1):

| obras novas / célula | ♥ | ♥♥ | ♥♥♥ | ♥♥♥♥ | total |
|---|--:|--:|--:|--:|--:|
| **development** | 7 | 13 | 10 | 3 | **33** |
| **holdout** | 3 | 6 | 4 | 5 | **18** |
| **total** | 10 | 19 | 14 | 8 | **51** |

Contexto: `digest_available=32` · `no_reviews_available=19` · `tags_present=50` ·
`missing_recoverable_frozen_empty=1` (S078). Os 10 slots repetidos do pilot-1 **não** contam.

## 10. Pool elegível — agregados (🟩 DB read-only — Parte E)

Pool = obras **ativas**, **fora** das 80 do pilot-1, status `unread` (Want to Read + Untracked —
únicos equivalentes no banco; sem Unknown/Neutral/null).

| Métrica | Valor |
|---|---|
| Pool ativo | **502** (Want to Read 436 · Untracked 66); 1 arquivada |
| Por stratum | ♥♥ 193 · ♥♥♥ 175 · ♥♥♥♥ 39 · **♥ 14** · sem-stratum 81 |
| canonical presente | 502/502 · tags presentes 495 (7 sem) |
| reviews úteis | 340 · `no_reviews` 162 · fetch ≤30d 334 / >30d 6 |
| digest p/ e1 | digest-v1 ok 15 · stale 1 · **precisa gerar 324** · no_reviews 162 |

⚠️ **Gargalo: stratum ♥** — só **14** no pool inteiro. Qualquer opção que exija muitas ♥ novas
quase esgota o pool. ♥♥♥♥ (39 no pool) é folgado.

## 11. Opções de composição para 90 únicas (🟧 — Parte D, NÃO aprovadas)

Todas com `confirmed_unread=51` → **39 novas**. Regra de stratum determinística documentada
(base ⌊90/4⌋=22; os 2 extras vão aos strata de **menor déficit-base**, desempate por ordem ordinal).

**Opção 1 — balanceada (primeira a avaliar), dev 56 / hold 34**
- Stratum target: ♥22 · ♥♥23 · ♥♥♥23 · ♥♥♥♥22. Split novo: dev 23 / hold 16.
- Déficit (novas) por célula:

  | | ♥ | ♥♥ | ♥♥♥ | ♥♥♥♥ | total |
  |---|--:|--:|--:|--:|--:|
  | dev | 7 | 1 | 4 | 11 | 23 |
  | hold | 5 | 3 | 5 | 3 | 16 |
  | **total** | **12** | **4** | **9** | **14** | **39** |
- ✅ benchmark balanceado, comparável ao pilot-1 (5:3). ⚠️ **♥ é o gargalo** (precisa 12 de 14 no pool); ♥♥♥♥ precisa 14 de 39 (ok).

**Opção 2 — proporcional (minimiza alteração vs. carryovers), dev 56 / hold 34**
- Stratum target: ♥18 · ♥♥33 · ♥♥♥25 · ♥♥♥♥14. Déficit por stratum: ♥8 · ♥♥14 · ♥♥♥11 · ♥♥♥♥6.
- ✅ mais leve nos extremos escassos (♥ 8 de 14; ♥♥♥♥ 6 de 39); pouca distorção. ⚠️ perpetua ♥♥ super-representado; cobertura fraca dos extremos.

**Opção 3 — stratum só como auditoria (mais simples), dev 56 / hold 34**
- Só quota de split (dev 23 / hold 16 novas). Strata **observados**, não quota rígida.
- ✅ a mais viável dada a escassez de ♥; seleção por readiness + ordem determinística. ⚠️ strata podem desviar; sem controle de cobertura por qualidade de sinopse.

🟨 Dada a escassez de ♥ (14), a Opção 1 é a mais arriscada de preencher; **2 ou 3** são mais
viáveis. Recomendação **não** decisão — escolha de produto (Q2/Q3).

## 12. Política dos 10 repetidos (🟧 — Parte F, recomendação para Q4)

| Opção | Mede | Risco |
|---|---|---|
| **A — repetir entre as 39 novas (recomendada)** | consistência intra-avaliadora **na mesma sessão**; original e repetição rotulados juntos; sem misturar label reaproveitado | — |
| B — repetir entre as 90 | — | repetição de obra com label reaproveitado do pilot-1 seria coletada em outro momento ⇒ mede **estabilidade temporal**, não consistência intra-sessão |

🟨 Recomendo **Opção A**, distribuição ~**6 dev / 4 hold**, balanceada entre strata. A seleção
futura dos 10 deve: **seed determinístico congelado**; ocorrer **antes** da rotulagem; **não** usar
labels nem outputs de candidatos. (Não decidido.)

## 13. Política de reviews/digests (🟧 — Parte G, proposta para Q5)

Referência pilot-1: fetch ≤30d = fresh; sem review útil = `no_reviews_available`; digest fresco
reutilizável só se compatível com a versão; digest ausente com reviews úteis = candidato a geração
**paga** separada. Para >30d / sem data confiável: **não** refrescar automaticamente; contar/listar;
alternativas = (1) refresh antes do snapshot · (2) substituir candidata · (3) congelar com limitação explícita.

**Estimativa para as 39 futuras** (proporcional ao pool, sujeito à seleção):
| | estimativa |
|---|---|
| provável `no_reviews_available` | ~13 (≈32% do pool sem review útil) |
| provável exigir **geração de digest** | ~26 (têm review útil, mas só ~3% do pool têm digest-v1) |
| possível necessidade de refresh (>30d) | ~0–1 (só 6/502 do pool >30d) |

🟨 **Custo pago definitivo NÃO calculado** (depende dos IDs selecionados). Nada executado.

## 14. Protocolo futuro de seleção (🟧 — Parte H, NÃO executado)

```
1. carregar pool elegível unread          5. ordenar por regra determinística (sem labels)
2. excluir pilot-1 + bloqueadas/arquivadas 6. selecionar exatamente 39
3. classificar readiness                   7. congelar lista + assinatura
4. atribuir quotas split×stratum aprovadas 8. só então preparar base-2
```
**Campos permitidos na seleção:** `work_id` (só ordenação/desempate) · status `unread` · `stratum`
pré-existente · readiness de sinopse/tags · estado de reviews/digest.
**Proibidos:** labels contextuais · `human_label` · outputs de candidatos · predições · MAE/QWK ·
resultado por split · ranking do experimento.

Implementadas **só** funções puras (quota/déficit/validação + testes). **Sem** executor de seleção.

## 15. Decisões Q2–Q5 (🟧 — usadas na seleção, **PENDENTES de ratificação humana**)

> A seleção da B2.2F **aplicou** estes parâmetros, mas a usuária **ainda não os ratificou
> explicitamente** como definitivos. Não tratar como aprovação final; execução paga **não** autorizada.

| # | Parâmetro aplicado (pendente de ratificação) |
|---|---|
| **Q2** | composição por stratum 22/23/23/22; selecionar 12/4/9/14 novas; sem relaxar quota |
| **Q3** | split 56/34; matriz das 39 novas dev{7,1,4,11}/hold{5,3,5,3} |
| **Q4** | 10 repeats só entre as 39 novas, 6 dev / 4 hold, seed separado |
| **Q5** | seleção independente de reviews/digest; depois: ≤30d/no_reviews aptos, >30d para; digest = plano pago futuro |

---

# Fase B2.2F — Seleção + materialização (2026-06-20, RESULTADO)

> Seleção determinística read-only; **pilot-2 e base-2 materializados localmente**. Zero custo,
> zero escrita no DB, labels não lidos. Lógica pura em
> [pilot2-selection.ts](lib/synopsis-interest/pilot2-selection.ts) (+ testes).

## 16. Seleção das 39 (🟩 — Parte D)

- Seed `pilot-2-selection-v1`; ordem por `sha256(seed:work_id)` dentro de cada stratum; split pela matriz Q3.
- Pool elegível **421** (502 ativas − 81 sem-stratum − 0 canonical inválida). Quotas atendidas; reservas: ♥2 · ♥♥189 · ♥♥♥166 · ♥♥♥♥25.
- `selectionListHash = 078a6405d526fba9…` (39 IDs únicos, nenhum no pilot-1, todos unread/ativos).

## 17. Repeats (🟩 — Parte E)

- Seed `pilot-2-repeats-v1`; 10 distintas entre as 39, **6 dev / 4 hold**, mesmo split do original.
- Distribuição: dev {♥2 ♥♥0 ♥♥♥1 ♥♥♥♥3} · hold {♥1 ♥♥1 ♥♥♥1 ♥♥♥♥1}. `repeatsListHash = e8fd516ab5d4c5b2…`.

## 18. pilot-2 materializado (🟩 — Parte F)

`…/pilot-2/pilot-2-manifest.json` — 90 únicas / 100 slots · dev 56 / hold 34 · strata 22/23/23/22 ·
51 carryover + 39 new + 10 repeats. Slots `S001..S090` + `R001..R010` (repeat→original). **Sem labels.**

## 19. base-2 (🟩 — Parte G) — gate de reviews **passou**

- 39 novas: **30** com reviews úteis ≤30d (fresh) + **9** `no_reviews_available`; **0 blockers** (>30d/sem data).
- ⇒ **base-2 materializado** (`…/pilot-2/base-2-snapshot.json`): 51 carryovers **derivados verbatim de base-1** (sinopse/tags/assinaturas/perfil v7 congelados) + 39 novas capturadas por `SELECT`. `base2Signature=9d181e868640…`.

## 20. Equivalência de display dos carryovers (🟩 — Parte H)

`computeLabelDisplaySignature` para os **51/51** carryovers (de base-1+enriched-1 congelados);
nenhuma assinatura inclui label/reading-status/dado live. Corpus `711c03713378…`. A comparação
definitiva `enriched-1 × enriched-2` só ocorre quando `enriched-2` existir.

## 21. Plano de digests (🟩 — Parte I, dry-run, NÃO executado)

`…/pilot-2/digest-plan-dry-run.json`: das 39 → **30** `digest_missing_with_reviews` + **9** `no_reviews`.
`planSignature=7037bc1e303a…` · **likelyUsd $0,59** · **upperBoundUsd $3,47** · teto humano recomendado **$4**.
Nenhuma chamada paga.

## 22. Pacote futuro de rotulagem (Parte J — NÃO criado)

`contextual-2` **não** criado. O pacote incremental futuro terá **39 novas + 10 repeats = 49 slots**
para nova rotulagem; os 51 labels carryover só serão reaproveitados após comprovar equivalência de
display no `enriched-2`. O pacote lógico completo do pilot-2 segue 90 únicas / 100 slots.

---

# Fase B2.2F-audit — Auditoria final (2026-06-21, read-only, $0)

> `npm run pilot2:audit` ([pilot2-audit.ts](lib/synopsis-interest/pilot2-audit.ts)). Artefatos em
> `…/pilot-2/audit/`. **0 discrepâncias.** Nada sobrescrito; só artefatos de auditoria criados.

## 23. Resultado

| Parte | Verificação | Resultado |
|---|---|---|
| 2 | pool re-consultado (503→1 arq→81 sem-stratum→**421 elegíveis**); seleção **reproduz** | `selectionPoolSignature=49a74a2f…` · pool snapshot per-candidata gerado |
| 3 | manifesto: 90u/100slots/56/34/22-23-23-22; selection/repeats hash recalc | **batem** |
| 4 | mapa dos 51 carryovers (por work_id; display sig **recomputada** = manifesto) | `carryMapSignature=f2548fad…` |
| 5 | base-2: `base2Signature` recalc = arquivo; 51 carryover **verbatim** de base-1; perfil v7 | OK · vínculo `base2BindingSignature=1533df61…` (liga manifesto+seleção+base-1) |
| 6 | preflight: **30 fresh ≤30d / 9 no_reviews / 0 blockers** | confirmado |
| 7 | custo **corrigido** (planner real `estimateStep`, SONNET $3/$15, `in=1500+350×scale`, `out=2000`, ×1.5) | **30 digests · likely $1,4078 · upper $2,1116** (razão 1,500). Método **valida** o lote pilot-1 (reproduz $2,2719/$3,4078 exato) |
| 8 | escopo do plano = só 30 novas com reviews (exclui 9 no_reviews, 51 carryover, 29 lidas) | OK · `planSignature=295fe2d6…` |
| 9 | assinatura do código de implementação | `implementationCorpusSignature=9e625d13…` |

**Custo — bug corrigido:** o dry-run anterior (`$0,59 likely / $3,47 upper`, razão 5,9) usava
constantes fixas (upper = scale-40 máximo; likely abaixo do mínimo) — **não** o `estimateStep` real.
O corrigido usa `upper = likely × 1,5` (razão exata 1,5). O anterior fica **superseded**
(`digest-plan-dry-run-v2.json` supersede `digest-plan-dry-run.json`).

**Revalidação antes de qualquer execução paga:** comparar `pilot2 manifest sha` · `base2Signature` ·
`reviewCorpusSignature` por obra · `planSignature` · `implementationCorpusSignature`. Qualquer
divergência ⇒ `plan_changed` antes da 1ª chamada.

**Governança:** pilot-2/base-2 **materializados localmente**, seleção tecnicamente concluída,
**pendentes de ratificação metodológica humana**; **nenhuma execução paga autorizada**.

---

# Fase B2.2G — Cobertura de reviews antes dos digests (2026-06-21, read-only, $0)

> Probe read-only sobre as **39 novas**. Regra de útil reutilizada: **`isUsefulReviewText`**
> ([lib/reviews/useful-review.ts](lib/reviews/useful-review.ts), ≥40 chars após trim) — a mesma do
> pilot-1/digest. Artefatos em `…/pilot-2/review-coverage-audit/`. Nada alterado/executado.

## 24. Resultado da cobertura

| Grupo | useful_review_count | Obras |
|---|---|--:|
| **A** | 0 | **9** |
| **B** | 1 | **4** |
| **C** | ≥2 | **26** (min 2 · mediana 7 · máx 66) |

Cruza com o plano de digests: **9 = no_reviews** (Grupo A) · **30 = B+C** (têm review útil → digest).
Todas as 13 obras com <2 úteis **têm fontes externas aceitas** (potencialmente refrescáveis — fora do escopo).

**⚠️ Achado crítico:** o corpus do digest é **`work_reviews`** apenas. Reviews adicionadas pela página
da obra vão para **`work_manual_reviews`**, que **NÃO** é lida pelo gerador de digest (`readReviews`).
⇒ adição manual só alimentaria o digest se entrar em `work_reviews` (ou via mudança de pipeline).

## 25. Impacto de futuras inclusões + versionamento (🟧 — proposta, NÃO executada)

Qualquer review adicionada/alterada ⇒ o plano `planSignature=295fe2d6…` fica **stale**; `base-2` e os
`reviewCorpusSignature` por obra precisam ser **reavaliados**; **novo snapshot/plano obrigatório**.
**Nada marcado superseded agora** (nenhuma review mudou nesta etapa).

| Estratégia | Semântica | Trade-off |
|---|---|---|
| **base-2r1 (recomendada)** | preserva base-2 como *pre-review*; cria revisão `base-2r1` só com o corpus de reviews atualizado das N obras | composição (pilot-2/seleção) **não muda** ⇒ é revisão do corpus, não nova base; naming leve; rastreável a base-2 |
| base-3 | preserva base-2 como *superseded*; cria `base-3` | sugere nova base/composição (overkill aqui; reservar “base-3” para um golden diferente) |

🟨 Recomendo **base-2r1** (a seleção não muda — só o corpus de reviews de algumas novas). Decisão de
produto da usuária. Sem mutação silenciosa do base-2 atual em nenhum caso.

---

# Fase B2.2H — Integração de reviews manuais no corpus de digest (2026-06-21, read-only, $0)

> Auditoria das tabelas + preparação de uma solução segura. **Banco só SELECT.** Nada inserido,
> nenhuma migration, plano de digest preservado/não-executado. Q2–Q5 seguem **não ratificadas**.

## 26. Achado: `work_manual_reviews` é OPINIÃO PESSOAL (não review externa) ⇒ Opção A BLOQUEADA

| Tabela | Proveniência | Conteúdo | Lida pelo digest? |
|---|---|---|---|
| `work_reviews` | **`source` NOT NULL**, source_title, match_score, fetched_at | reviews externas scrapadas | **sim** (`readReviews`) |
| `work_manual_reviews` | **nenhuma** (sem source/external_id/url) | **comentários/impressões + nota 0-10 da usuária** | não |

🟥 A UI ([review-drafts-field.tsx](components/titles/review-drafts-field.tsx)) diz *"Adicione comentários/
impressões **suas**"*; grava `text` + `user_rating` (nota pessoal) + `note`. O `ai.ts` as trata como
"curadas pelo usuário". ⇒ é exatamente o **leakage** que a Parte E proíbe (opinião/nota pessoal,
"quanto a obra parece interessante"). **70 linhas / 20 obras** (1 com `user_rating`); **nenhuma** nas 39 novas.

**Conclusão:** unir as duas tabelas (Opção A) ou copiar manual→work_reviews (Opção B) **vaza opinião
pessoal e perde proveniência**. **BLOQUEADO.**

## 27. Arquitetura recomendada — Opção C (proveniência explícita)

Canal separado para reviews **externas adicionadas manualmente**, COM proveniência e SEM nota pessoal:
```
nova coluna/tabela (ex.: work_reviews.origin='manual_external' + source_url, OU work_external_manual_reviews)
campos: origin · source · external_id · source_url · review_id · text   (NUNCA user_rating/opinião)
```
Migration **proposta, NÃO criada**. `work_manual_reviews` permanece intacta como store de opinião pessoal.

**Boundary canônico PREPARADO** (puro, leakage-proof por TIPO):
[canonical-review-corpus.ts](lib/synopsis-interest/canonical-review-corpus.ts) — `buildCanonicalReviewCorpus`
une `work_reviews` (external_scraped) + futuras `manual_external` com a regra central `isUsefulReviewText`,
dedup por texto normalizado (preserva toda proveniência), ordem determinística, teto 40, `corpusSignature`
reprodutível. **14 testes.** O tipo de entrada **não tem** campo de nota/opinião ⇒ leakage impossível.
**Não** ligado à produção nem lê `work_manual_reviews` (espera a migration Opção C). Planner+executor
deverão consumir este loader único (guard documentado, não implementado).

## 28. Estado das 13 obras (duas tabelas) + protocolo de cadastro

As 39 novas têm **0** reviews manuais ⇒ a lista B2.2G estava completa. Canônicas: **9 com 0 · 4 com 1**
(gap→2: 2 e 1). Todas têm fontes externas aceitas.

**Protocolo neutro proposto (NÃO executado):** meta = **2 reviews úteis não-duplicadas/obra**, preferir
fontes diferentes. Ordem determinística entre fontes aceitas (`REVIEW_SOURCE_PRIORITY`:
mangaupdates→anilist→myanimelist→kitsu→animeplanet→comick→mangadex→comix); pegar reviews elegíveis
(≥40 chars) **na ordem de listagem da fonte**, sem escolher por sentimento/nota, sem resumir/reescrever,
preservando texto+fonte, sem opinião própria/label/candidato. **Depende da Opção C** (ou inserção direta
em `work_reviews`, que hoje não tem UI) — sem ela, o cadastro manual atual (work_manual_reviews) **não**
alimenta o digest.

## 29. Impacto nos artefatos + versionamento

Após adicionar reviews, **refazer**: `reviewCorpusSignature` das obras alteradas · preflight ·
**base snapshot revisado** · digest plan · `planSignature` · estimativa de custo. **NÃO** refazer:
seleção das 39 · `pilot-2-manifest` · splits · strata · 10 repeats · 51 carryovers. Versionamento
recomendado: **base-2r1** (mesma seleção/composição/slots; só o corpus muda). `base-3` = overkill.
Plano `295fe2d6…` ficará **stale** quando qualquer review mudar (ainda não mudou ⇒ não marcado superseded).

---

# Fase B2.2I — Migration draft p/ reviews externas manuais (2026-06-21, sem aplicar, $0)

> Opção C **escolhida** como arquitetura. Migration **draft criado, NÃO aplicado**;
> `work_manual_reviews` permanece pessoal e proibida; a nova tabela **ainda não existe no
> banco remoto**; nenhuma review adicionada; digest não autorizado. Q2–Q5 **não ratificadas**.

## 30. Tabela `work_external_reviews_manual` (migration 112 — DRAFT)

[supabase/migrations/112_work_external_reviews_manual.sql](supabase/migrations/112_work_external_reviews_manual.sql)
— reviews **externas** inseridas à mão, com proveniência. Convenções reaproveitadas (auditadas):
UUID `gen_random_uuid()` · FK `works(id) ON DELETE CASCADE` · função `update_updated_at()` (trigger
`BEFORE UPDATE`) · CHECK de `source ~ '^[a-z0-9][a-z0-9-]{0,79}$'` · **RLS habilitada SEM policies**
(acesso só via service role — padrão da migration 013).

**Campos:** id · work_id · source · source_url · external_review_id · reviewer_name · text · language ·
published_at · normalized_text_hash · created_by · created_at · updated_at. **Proibidos** (ausentes):
user_rating, note, personal_status, interest_label, reading_status, score, prediction.

**Constraints:** texto não-vazio (utilidade ≥40 fica no `isUsefulReviewText` do servidor, **não** no banco
— Alternativa B); **proveniência mínima** (`source_url` OU `external_review_id`); language opcional formatado.

**Dedup de PERSISTÊNCIA** (dentro da fonte): UNIQUE parcial `(work_id, source, external_review_id)` WHERE
NOT NULL + UNIQUE `(work_id, source, normalized_text_hash)`. **Sem** unique cross-source `(work_id, hash)` —
o **mesmo texto de fontes diferentes** é preservado; a **dedup CANÔNICA** (entre fontes/tabelas) funde a
proveniência no corpus. Índices: work_id, created_at.

`normalized_text_hash` = SHA-256 do texto normalizado **no servidor** (`trim → NFC → lowercase → colapso de
espaços/quebras`), **mesma** regra da dedup canônica ([normalizeReviewText](lib/synopsis-interest/canonical-review-corpus.ts)).

## 31. Boundary Zod + guard de leakage

[external-review.schema.ts](lib/validations/external-review.schema.ts): `externalReviewInputSchema`
(`strictObject` ⇒ rejeita nota/opinião pessoal) + `prepareExternalReviewRow` (servidor calcula hash/
created_by/timestamps; **nunca** do client). Fontes ∈ `EXTERNAL_REVIEW_SOURCES` (`satisfies ExternalSourceId[]`).
**Guard:** o corpus canônico **não importa** o store pessoal (teste estático); só `work_reviews` +
`work_external_reviews_manual` o alimentam; **proibido** `readAllManualReviews`. Loaders futuros separados:
`readScrapedExternalReviews()` / `readManuallyEnteredExternalReviews()` → `buildCanonicalReviewCorpus()`.

## 32. Integração futura (DESENHO — não conectada)

- **`/catalog/[id]`:** seção separada *"Reviews externas adicionadas manualmente"* (fora do card de impressões
  pessoais); campos = fonte · URL/ID externo · autor opcional · texto · idioma opcional · data opcional; **sem nota pessoal**.
- **Server Action:** Zod acima → validação admin (service role) → `prepareExternalReviewRow` (hash server-side) →
  tratamento de conflito (unique) → `revalidatePath`.
- **Digest:** `work_reviews` + `work_external_reviews_manual` → `buildCanonicalReviewCorpus`; **planner e executor
  consomem o mesmo loader** (guard). Não conectado nesta fase.

## 33. Estado / limites desta fase

13 obras preservadas (9 com 0 / 4 com 1 review útil) — **nenhuma review adicionada**, snapshots intactos.
Migration **não aplicada** (sem validador SQL local seguro: CLI dessincronizada / sem Postgres local;
validada por teste estático + revisão). Após aplicar+UI+inclusões: refazer `reviewCorpusSignature`/preflight/
**base-2r1**/digest plan/`planSignature`/custo; **não** refazer seleção/manifest/splits/strata/repeats/carryovers.
**Nada escrito no banco, zero custo, Q2–Q5 pendentes, digest não autorizado.**

## 34. Revisão pré-aplicação (Fase B2.2J, 2026-06-21) — correções aplicadas

Migration 112 SHA-256 **`591a6cfe36ead274…`** (era `d2de5bdf…`). Correções:
- **`created_by` NULLABLE** (sem default `'admin'`) — o projeto **não tem auth confiável** (sem `auth.uid()`);
  preenchido só com sessão admin validada no servidor; **não inventar autoria**. Fluxo futuro: validar sessão →
  user id → checar admin → `created_by` → insert server-side.
- **Proveniência** via `NULLIF(BTRIM(source_url),'') IS NOT NULL OR NULLIF(BTRIM(external_review_id),'') IS NOT NULL`
  (string vazia/whitespace = ausente; no Zod, `blankToNull` antes da validação).
- **`normalized_text_hash`** CHECK estrutural `~ '^[0-9a-f]{64}$'` (64 hex); `text` via `NULLIF(BTRIM(...),'')`.
- **Validação fonte × hostname** (Zod): config central `EXTERNAL_REVIEW_SOURCE_HOSTNAMES`; match **exato ou
  subdomínio** (`host===a || host.endsWith("."+a)`), **nunca `includes`** ⇒ rejeita `mangadex.org.evil.com`.
- **Hash/normalização única** (`normalizeReviewText`: trim→NFC→lowercase→colapso de espaços/quebras) compartilhada
  por persistência ⊕ dedup canônica ⊕ `reviewCorpusSignature`; calculada **só no servidor**, após validar o texto.
- **`strictObject`** rejeita campos calculados/pessoais (id, workId, hash, createdBy, timestamps, origin, userRating,
  note, score, etc.). **44 testes** (schema+migration+corpus). `update_updated_at()` confirmada em mig 001; nome 112 sem conflito.

**Governança:** migration **draft revisado localmente, NÃO aplicado/aprovado**; tabela **não existe no remoto**;
**0 reviews, 0 digest, 0 escrita**; **Q2–Q5 pendentes de ratificação**.

## 35. Pacote de aplicação manual (Fase B2.2K, 2026-06-21) — NÃO aplicado

Migration 112 inalterada (SHA `591a6cfe…`, 6315 bytes; tabela confirmada **ausente** no remoto via PostgREST).
Pacote em `docs/sql/` para aplicação manual no SQL Editor:

| Arquivo | SHA-256 | Função |
|---|---|---|
| `…_precheck.sql` | `12a4af05…` | 7 SELECTs read-only (tabela ausente, works.id UUID, fn update_updated_at, sem conflito, schema) |
| `…_apply.sql` | `905bf150…` | DDL **estrito** (BEGIN/COMMIT, **sem** IF NOT EXISTS, **sem** DROP) — **semanticamente idêntico** à migration (verificado por teste) |
| `…_postcheck.sql` | `224ed81d…` | SELECTs read-only: colunas/tipos/nullability, FK CASCADE, CHECKs+defs, índices+defs, trigger+def, RLS, policies=0, rows=0 |
| `…_package-manifest.json` | — | hashes + nomes esperados de constraints/índices/trigger + `migrationApplicationPackageSignature=60b60c20…` |

**Nota de revisão:** a migration usa `IF NOT EXISTS`/`DROP TRIGGER IF EXISTS` (idempotência, convenção do repo) —
preservada para manter o SHA; o **apply** é a versão estrita (falha em drift). `created_by` segue NULLABLE (sem
auth confiável → não preencher; futuro = sessão admin validada). **Gate de UI:** a interface de cadastro **não** pode
ir a produção sem auth admin real (service role numa Server Action **não** é autorização). **Nada aplicado/escrito.**

## 36. Canonicalização + auditoria do histórico (Fase B2.2L, 2026-06-21)

**Pacote B2.2K SUPERSEDED** (migration `591a6cfe…`, packageSig `60b60c20…`). **Novo** (canônico estrito):
migration **`9c47a2cd…`** (6673 B, 104 ln) · apply `ebd8ec7b…` · precheck `077436fc…` · postcheck `243c16d7…` ·
**migrationApplicationPackageSignature `5cc6b32a…`**.

Mudanças vs `591a6cfe`: **removidos `IF NOT EXISTS` e `DROP TRIGGER`** (DDL estrito ⇒ falha em drift) ·
**tudo qualificado com `public.`** (tabela/FK/índices/trigger/função/ALTER/COMMENT — sem depender de `search_path`) ·
**+3 CHECKs `*_nonblank`** (source_url/external_review_id/reviewer_name: NULL ou não-vazio ⇒ string vazia **rejeitada**)
+ language endurecido · header **sem "DRAFT"** (artefato histórico válido). O **apply** agora é o **corpo literal** da
migration entre `BEGIN/COMMIT` (igualdade estrutural verificada por teste, sem lista de transformações).

**Histórico remoto (CLI `migration list --linked`, read-only):** **só 6/114** migrations locais registradas no remoto
(001-004, 015, 016); **108 não** (incl. 090-112). Schema remoto está aplicado, mas o histórico foi mantido **à mão** —
**drift pré-existente, anterior à 112**. ⇒ **Recomendação: Estratégia B (SQL Editor)** — `db push` **re-aplicaria as 108**
(perigoso). Registro de histórico é operação **separada** do DDL; comando futuro (NÃO executar): `supabase migration
repair --status applied 112` (só após aplicar o DDL; idealmente numa reconciliação ampla do drift). **0 escrita, 0 aplicação.**

---

# Fase B2.2M — Editor local de reviews externas + corpus canônico integrado (2026-06-21)

> Migration 112 **aplicada à mão** (B2.2L) e **revalidada read-only** nesta fase. Interface
> exclusivamente LOCAL para cadastrar reviews externas; corpus canônico ligado ao pipeline.
> **Nenhuma review cadastrada · nenhum digest · zero custo · zero escrita no DB.** Q2–Q5 seguem
> **NÃO ratificadas**; execução paga **não** autorizada. `work_manual_reviews` permanece **proibida** no corpus.

## 37. Revalidação read-only da migration 112 (PostgREST, service role)

| Check | Resultado |
|---|---|
| `public.work_external_reviews_manual` existe | ✅ true |
| `row_count` | ✅ **0** |
| 13 colunas selecionáveis (nomes corretos) | ✅ true |
| anon enxerga 0 linhas (corrobora RLS-on + 0 policies) | ✅ |

RLS/policies=0 **autoritativo** = postcheck A–G no SQL Editor (B2.2L, já aprovado); PostgREST/service
role **não** lê `pg_catalog` para reconferir. **Sem divergência ⇒ prosseguir.** Nenhuma migration/
`db push`/`migration repair` executada.

## 38. Gate LOCAL obrigatório (sem auth admin)

`assertLocalExternalReviewEditorAllowed()` / `isLocalExternalReviewEditorAllowed()`
([local-external-review-gate.ts](lib/synopsis-interest/local-external-review-gate.ts)) — decisão **pura**
`evaluateLocalExternalReviewEditorGate` (testada). **Fechado por padrão**; libera SÓ quando
**todas**: `NODE_ENV != production` · `ENABLE_LOCAL_EXTERNAL_REVIEW_EDITOR === "true"` · **sem** `VERCEL_ENV`
· host ∈ {`localhost`,`127.0.0.1`,`::1`} (porta/colchetes IPv6 normalizados). Produção e **Vercel Preview**
bloqueados; host não-local bloqueado; variável ausente = bloqueado. O componente **não renderiza** quando
bloqueado **e** cada Server Action **reexecuta** o mesmo gate (esconder o componente **não** é a defesa).
`.env.example` ganhou `ENABLE_LOCAL_EXTERNAL_REVIEW_EDITOR=false` (o `.env` real **não** foi tocado).

## 39. Interface separada (`/catalog/[id]`, overview)

Card **distinto** "Reviews externas adicionadas manualmente"
([external-manual-reviews-card.tsx](components/titles/external-manual-reviews-card.tsx)) — **fora** do card de
impressões pessoais ([review-drafts-field.tsx](components/titles/review-drafts-field.tsx) →
`work_manual_reviews`). RHF + zodResolver (reusa `externalReviewInputSchema`) + shadcn + Server Actions +
lucide. Campos: `source · sourceUrl · externalReviewId · reviewerName · text · language · publishedAt`.
**Não** aceita nota/opinião/label/score/hash/createdBy/timestamps (`strictObject`). Aviso explícito (protocolo
neutro §10). Links externos com `target="_blank" rel="noopener noreferrer"`. Só montado com o gate aberto.

> **Client-safe:** `external-review.schema.ts` perdeu o import de `node:crypto`; `prepareExternalReviewRow`
> migrou para [external-review-row.ts](lib/validations/external-review-row.ts) (server). O hash/`created_by`
> são server-side; a service-role key **nunca** chega ao client (guard estático).

## 40. Server Actions

[external-manual-reviews.ts](server/actions/external-manual-reviews.ts) — `create/update/delete`. Cada uma:
gate → valida `workId`/`reviewId` (UUID, Zod) → valida form (`prepareExternalReviewRow`, hash server-side,
`created_by=null`) → confirma obra → **update/delete buscam o registro e confirmam posse** (`ownershipError`;
não altera registro de outra obra) → trata conflito dos **dois** índices únicos (`uniq_extid`/`uniq_hash`,
23505) → resultado **discriminado** ([external-review-action-result.ts](lib/validations/external-review-action-result.ts))
→ `revalidatePath`. Service role só no módulo server.

## 41. Loaders + corpus canônico (única fonte de verdade)

[digest-corpus.ts](lib/synopsis-interest/digest-corpus.ts) (server-only):
`readScrapedExternalReviews` → SÓ `work_reviews` (origin `external_scraped`) ·
`readManuallyEnteredExternalReviews` → SÓ `work_external_reviews_manual` (origin `manual_external`) ·
`readCanonicalReviewCorpus` combina via `buildCanonicalReviewCorpus` (utilidade ≥40 · dedup por texto
normalizado preservando **toda** a proveniência · ordem determinística · teto 40 no `sample` · assinatura
reprodutível · `no_reviews_available` · `scale=min(úteis,40)`). **Política de amostragem não foi alterada
silenciosamente** — o teto 40 e o filtro de utilidade são os mesmos do pipeline atual.

**O que entra na assinatura:** as reviews **úteis deduplicadas** (texto normalizado + conjunto de fontes).
**Quando o 40 é aplicado:** **depois** da utilidade/dedup/ordenação, só no recorte `sample` (a assinatura
cobre todas as úteis, não só as 40).

## 42. Integração do pipeline + guard arquitetural

`buildCanonicalDigestPlanItem` (preflight/planner) e `readCanonicalDigestInput` (gateway do executor)
derivam do **mesmo** `readCanonicalReviewCorpus` ⇒ planner e executor enxergam **exatamente o mesmo corpus**;
`userRating` do executor é **sempre null** (leakage-proof). O planner/executor do golden
([golden-digest.ts](lib/synopsis-interest/golden-digest.ts)) seguem **puros** (sem consulta própria).
Guard estático ([digest-corpus-guard.test.ts](tests/unit/synopsis-interest/digest-corpus-guard.test.ts)):
falha se o corpus/loaders referenciarem o store pessoal, se algum módulo de digest consultar
`work_manual_reviews`, ou se planner/executor importarem loader diferente.

> **Escopo seguro:** o auto-digest de PRODUÇÃO ([persist-reviews.ts](lib/external/persist-reviews.ts) →
> `ensureReviewDigest` com gateway padrão) **segue inalterado** — re-rotear o `work_reviews`→canônico ali
> mudaria a amostragem/dedup e invalidaria digests existentes (proibido §7). O gateway canônico é para o
> executor do golden **futuro** (base-2r1), **não** ligado agora. O plano antigo `planSignature=295fe2d6…`
> e o script base-1 ([golden-digest-batch.ts](scripts/golden-digest-batch.ts)) ficam **preservados e não
> executados**. **base-2r1/novo plano/enriched-2/contextual-2 NÃO criados.**

## 43. Painel das 13 obras (read-only, $0)

`npm run pilot2:coverage` ([pilot2-review-coverage.ts](scripts/pilot2-review-coverage.ts) +
[lib](lib/synopsis-interest/pilot2-review-coverage.ts)) — reusa o CSV **congelado** da B2.2G (sem DB).
Por obra: título · rota local · úteis atuais · quantas faltam p/ 2 · fontes externas. **9 com 0 · 4 com 1**
(meta futura = **2** úteis não-duplicadas, fontes distintas) ⇒ **22** reviews faltando. **Nenhuma review adicionada.**

## 44. Protocolo neutro (documentado no card + §10)

Prioridade central de fontes · ≥40 chars · **não** escolher por sentimento/concordância com as preferências ·
**não** resumir/reescrever · preservar texto+fonte · evitar duplicatas · preferir fontes distintas · **não**
usar labels/outputs de candidatos.

## 45. Estado / limites desta fase

`work_manual_reviews` **intacta e proibida** no corpus. Interface **só** em ambiente local — **NÃO** segura
para produção (sem auth admin; service role numa Server Action **≠** autorização). Suíte **920** passa;
tsc/eslint/build limpos. **Nenhuma review inserida · nenhum digest · zero custo · zero escrita no DB** (só
SELECT de revalidação). **base-2r1 não criada · digest não autorizado · Q2–Q5 pendentes de ratificação humana.**

**Arquivos novos:** `lib/synopsis-interest/{local-external-review-gate,digest-corpus,pilot2-review-coverage}.ts` ·
`lib/validations/{external-review-row,external-review-action-result}.ts` ·
`server/queries/external-manual-reviews.ts` · `server/actions/external-manual-reviews.ts` ·
`components/titles/external-manual-reviews-card.tsx` · `scripts/pilot2-review-coverage.ts` · 5 testes novos.
**Alterados:** `lib/validations/external-review.schema.ts` (client-safe) ·
`tests/.../external-review-schema.test.ts` (import) · `app/catalog/[id]/page.tsx` (monta o card) ·
`.env.example` · `package.json` (`pilot2:coverage`).

---

# Fase B2.2M-AUDIT — Auditoria final antes do cadastro (2026-06-21, read-only, $0)

> 4 lacunas fechadas antes de habilitar o editor: proveniência do working tree · **segurança real do
> gate** · cobertura **live** · semântica de **freshness**. **Nenhuma review inserida/editada/excluída ·
> 0 digest · 0 LLM · 0 custo · 0 escrita no DB** (só SELECT) · sem commit/push/merge · Q2–Q5 intactas.

## 46. Estado do repositório

Branch `feat/data-orchestration` · HEAD `d1ead31` (inalterado — **sem commit**). Working tree:
**16 tracked modificados** (pré-B2.2M, não relacionados — ex.: `recommend-dialog`, `work-form`,
`ranking.ts`, `globals.css` — **não tocados**) + os **untracked** das fases Plano 3. **Nada revertido/
formatado/limpo.** A B2.2M-AUDIT só **acrescenta**: gate endurecido + 2 scripts + testes + doc (lista no §50).

## 47. Auditoria do gate — `Host` é spoofável; defesa real = loopback

> ⚠️ **CORRIGIDO em B2.2N (§51):** o item 2 abaixo (bloqueio por `X-Forwarded-Host`/`Forwarded`) foi
> **REVERTIDO** — o servidor do Next **sintetiza `x-forwarded-*` em TODO request** (medido: `x-forwarded-host`
> = valor do Host, `x-forwarded-for` = IP do socket), então o bloqueio por presença bloqueava **100%** dos
> requests (quebrava o editor) e não distinguia proxy de conexão direta. A precedência real passou a ser
> `production > vercel > flag > host`. Vale só o item 1 (loopback) como defesa autoritativa. Ler §51.


**De onde vem o hostname:** [local-external-review-gate.ts](lib/synopsis-interest/local-external-review-gate.ts)
`readGateInputs()` → `(await headers()).get("host")` — ou seja, o **header HTTP `Host`**, que é
**controlável pelo cliente**. `page.tsx` e as Server Actions chamam o **mesmo** gate (`is…Allowed`/
`assert…Allowed`); o host **não** vem de outra fonte.

**Conclusão (spoof):** 🟥 **SIM, spoofável.** Um cliente **remoto** pode enviar `Host: localhost` e passar
no teste de host-local. O header `Host` **não prova** que a conexão é loopback. Next/Server Actions **não**
expõem o endereço remoto de forma confiável dentro da action. ⇒ o teste de host é condição **necessária,
não suficiente**.

**Mitigações aplicadas (patch):**
1. **Defesa AUTORITATIVA = ligação loopback.** Novo comando `npm run dev:local-editor` =
   `ENABLE_LOCAL_EXTERNAL_REVIEW_EDITOR=true next dev --hostname 127.0.0.1 --port 3001` — liga o servidor
   **só** a `127.0.0.1` (conexões remotas não chegam) e habilita a flag **inline** (NÃO toca o `.env.local`).
2. **Defesa em profundidade** no gate: presença de header de proxy (`X-Forwarded-Host` / `Forwarded`) ⇒
   bloqueio (`reason="proxied"`). Conexão loopback direta não carrega esses headers; request via reverse-proxy
   (vetor remoto) tipicamente carrega. **NÃO** é garantia — é redução de risco; o gate **nunca** usa o
   forwarded para LIBERAR (só para BLOQUEAR). Gate segue **fail-closed**.
3. **Sem auth admin criada** (fora de escopo); **service-role key segue só server-side** (guard estático).

Precedência: `production > vercel > flag > proxied > host`. **+5 casos de teste** (proxied, Host-local+forwarded,
Host-remoto, normalização porta/IPv6) — 10 no total no arquivo do gate.

> ⚠️ Limitação honesta registrada: sem o `dev:local-editor` (loopback), um servidor exposto em `0.0.0.0`
> com a flag ligada estaria vulnerável a `Host: localhost`. **Habilitar o editor SÓ via `dev:local-editor`.**

## 48. Cobertura LIVE (read-only, $0)

Novo `npm run pilot2:coverage:live` ([script](scripts/pilot2-review-coverage-live.ts)) — distinto do
`pilot2:coverage` (CSV congelado, **preservado**). Lê as 13 obras do CSV congelado (sem mexer no manifesto)
e consulta o banco **só por SELECT** via `readScrapedExternalReviews` + `readManuallyEnteredExternalReviews`
+ `readCanonicalReviewCorpus` — **nunca** `work_manual_reviews`. Por obra: úteis scraped/manual_external,
antes/depois do dedupe, fontes distintas+presentes, faltam p/2, `reviewCorpusSignature`. Agregados +
`count(*)` de `work_external_reviews_manual`.

**Resultado LIVE (DB, hoje):** **0 úteis = 9 · 1 útil = 4 · ≥2 = 0 · faltantes = 22 · linhas manuais = 0.**
**Bate o baseline congelado (9/4/22, 0 manuais).** As 9 com 0 úteis compartilham a assinatura de corpus
vazio `00d4b9a8…`. Divergência ⇒ o comando **sai !=0 e explica** (parar antes de cadastrar).

## 49. Freshness das reviews manuais (Q5 — NÃO ratificada; recomendação)

A tabela tem `published_at` + `created_at`, **não** tem `fetched_at`/`captured_at`. **Recomendação
explícita (proposta, não aprovada):**

| Campo | Semântica recomendada |
|---|---|
| `created_at` (server, `DEFAULT now()`) | **momento de CAPTURA** da review externa para o corpus experimental (equivalente ao `fetched_at` do scraping) |
| `published_at` (opcional, do formulário) | **data ORIGINAL de publicação** — só **proveniência**, nunca freshness |

**Não exige mudança de código nem coluna nova:** os campos atuais já bastam — `created_at` serve de proxy de
captura e `published_at` de proveniência. Se no futuro for preciso distinguir "capturado" de "linha criada/
editada", aí sim caberia uma coluna `captured_at` dedicada (decisão adiada). **Nenhuma migration/coluna/dado
alterado.** Q5 (política de refresh ≤30d do pilot-1) **continua pendente de ratificação** — não aplicar a
reviews manuais sem decisão humana.

## 50. Verificação do corpus + limites

Confirmado (inspeção + testes): `readScrapedExternalReviews`=só `work_reviews` · `readManuallyEnteredExternalReviews`
=só `work_external_reviews_manual` · `readCanonicalReviewCorpus`=só os dois · **nenhum** loader toca
`work_manual_reviews` · planner/executor = mesmo corpus · `userRating` sempre `null` · o tipo `CanonicalReviewInput`
**não tem** campo de label/status/score/prediction (leakage-proof por construção) · assinatura cobre **todas** as
úteis deduplicadas · teto 40 só na **amostra** · **auto-digest de produção INALTERADO** (guard: `persist-reviews.ts`
não importa `digest-corpus`; gateway de produção lê só `work_reviews`).

**Novos (B2.2M-AUDIT):** `scripts/pilot2-review-coverage-live.ts` · `dev:local-editor` + `pilot2:coverage:live`
(package.json) · gate endurecido (`proxied` + bloqueio por header de proxy) · +5 testes de gate, +1 de teto-40,
+2 de guard de produção. **Sem migration · sem digest · sem custo · sem escrita · sem commit · Q2–Q5 pendentes.**

---

# Fase B2.2N — Cadastro humano + correção do gate (2026-06-21)

> Q2–Q5 **ratificadas** pela usuária; INSERT em `work_external_reviews_manual` via editor local **autorizado**
> (UPDATE/DELETE/digest/LLM/base-2r1/outras escritas/commit/push/merge **não**). O cadastro é **humano** (UI);
> o agente **não** seleciona/insere conteúdo. Esta sessão: precheck + subir o editor em loopback + **corrigir
> um bug do gate**. **0 review cadastrada · 0 digest · 0 LLM · 0 custo · 0 escrita no DB · sem commit.**

## 51. Correção do gate (bug introduzido na B2.2M-AUDIT)

**Sintoma:** ao subir `dev:local-editor`, o card não aparecia via `curl`. **Investigação read-only (debug
temporário, removido):**
- **FATO 1 — Next sintetiza `x-forwarded-*` em todo request** (loopback direto medido): `x-forwarded-host`
  = `localhost:3001`, `x-forwarded-for` = `127.0.0.1`, `forwarded` = null. ⇒ o bloqueio B2.2M-AUDIT por
  **presença** de `x-forwarded-host` disparava em **100%** dos requests e não distinguia proxy de conexão
  direta. **Revertido**: o gate **não** consulta mais headers de proxy. Precedência agora
  `production > vercel > flag > host`.
- **FATO 2 — `curl`+grep do card é INVÁLIDO** como verificação: a página `/catalog/[id]` renderiza o conteúdo
  das abas **no client** (só os *gatilhos* das abas vêm no HTML SSR; `Sinopses`, `Nota Prevista`, `tabpanel`
  ausentes). ⇒ as afirmações anteriores baseadas em `CARD_PRESENT=false` (B2.2M-AUDIT e início da B2.2N) eram
  **artefato de medição**, não prova de editor quebrado.
- **Verificação correta (server-side, via debug temporário):** `{nodeEnv:"development", flag:"true",
  host:"localhost:3001"} → allowed:true`. ⇒ **o gate está ABERTO no loopback**; o editor funciona. A
  confirmação **visual** do card é da usuária, no navegador (curl não enxerga aba client).
- **`x-forwarded-for` = IP do socket** seria um sinal de localidade melhor que o Host, **mas NÃO é usado**:
  spoofabilidade sob o Next não verificada; a defesa **autoritativa** segue sendo a ligação **loopback**.

Gate final: `nodeEnv != production` · `flag === "true"` · sem `VERCEL_ENV` · host local. Host = sinal fraco
(necessário, não suficiente). **10 testes de gate** (ajustados; `proxied` removido). tsc/eslint/suite (**927**) limpos.

## 52. Subida segura do editor (loopback) — VERIFICADO

A porta 3001 estava ocupada por um `npm run dev` **exposto** (`*:3001`, sem flag → editor OFF, fail-closed).
Com autorização explícita da usuária, encerrei esse processo e subi `npm run dev:local-editor`. **Verificado:**
servidor ligado **só** a `127.0.0.1:3001` (`lsof`: 0 listeners wildcard) · `ENABLE_LOCAL_EXTERNAL_REVIEW_EDITOR=true`
**só no processo** · `.env.local` **não** alterado · `VERCEL_ENV` ausente · gate **allowed=true** no loopback.
**Loopback limita o acesso de rede; NÃO torna o editor uma interface segura para produção** (sem auth admin).

## 53. Estado do cadastro (pendente da usuária)

Precheck: baseline **9/4/22** · live **9/4/22** · **0 linhas manuais** · sem divergência. Lista das 13 obras +
protocolo neutro entregues (ordem determinística: 0-review→1-review→work_id). **Cadastro ainda NÃO feito** (é
ação humana no navegador). Validação por lote = `pilot2:coverage:live` (SELECT). Critério de conclusão:
**0/0/13≥2 · 0 faltantes**. `base-2`/`planSignature 295fe2d6…` ainda **não** stale (corpus inalterado).

**Alterados (B2.2N):** `lib/synopsis-interest/local-external-review-gate.ts` (revertido `proxied`) ·
`tests/.../local-external-review-gate.test.ts` (ajustado). **Nada de DB/digest/custo/commit. Q2–Q5 ratificadas.**

## 54. Unificação de UI + text-only + migration 113 (B2.2N, sem aplicar)

**Decisão:** unificar a EXPERIÊNCIA VISUAL dos dois forms preservando **integralmente** a separação
de pipelines. Card único **"Reviews"** na **página de edição** com 2 seções FIXAS:
[reviews-editor.tsx](components/titles/reviews-editor.tsx) →
(1) [external-manual-reviews-section.tsx](components/titles/external-manual-reviews-section.tsx)
(`work_external_reviews_manual` → digest; gate local; `source`+`text` em destaque, metadados recolhidos)
+ (2) [manual-reviews-section.tsx](components/titles/manual-reviews-section.tsx) (`work_manual_reviews`
→ avaliação IA; nota/observação pessoal). O card externo **saiu** da página da obra (sem form
administrativo lá). Cards antigos removidos (`external-manual-reviews-card`, `manual-reviews-card`).
**Separados:** tabelas · schemas · actions · loaders · tipos · consumidores · botões de salvar.
**Compartilhado:** só `Card/Separator/Textarea/Input/Button/Badge`. **Sem** action/schema/tabela única
nem seletor de tipo por linha. Guard estático novo
([reviews-isolation-guard.test.ts](tests/unit/synopsis-interest/reviews-isolation-guard.test.ts)).

**Text-only (só o texto é sinal):** `source` virou metadado administrativo —
- **assinatura:** `buildCanonicalReviewCorpus.corpusSignature` agora é **só texto normalizado** (removido
  `origin:source`). Alterar fonte/URL/autor/idioma/data sem mudar o texto **não** muda a assinatura nem
  causa staleness do plano. (Empty corpus = mesma `00d4b9a8…`; só corpora não-vazios mudam.)
- **seleção das 40:** a amostra do corpus já é ordenada por **texto** (independe de fonte) — confirmado por teste.
- **prompt:** `readCanonicalDigestInput` passa fonte UNIFORME (`EXPERIMENT_DIGEST_SOURCE="review"`) ⇒ a
  fonte real não entra no prompt do digest do experimento. Produção (`review-summarizer`/`persist-reviews`)
  **inalterada**.

**Proveniência deixou de ser obrigatória:** schema [external-review.schema.ts](lib/validations/external-review.schema.ts)
sem o `superRefine` de URL-ou-ID (`source`+`text` bastam; metadados opcionais; host×URL ainda validado quando há URL).
**Migration 113** [113_drop_external_review_provenance.sql](supabase/migrations/113_drop_external_review_provenance.sql)
= `DROP CONSTRAINT …_provenance` — **PREPARADA, NÃO APLICADA**. ⚠️ cadastro só-`source+text` exige aplicar a 113
antes (senão o CHECK do banco rejeita); aplicar à mão no SQL Editor. Dedupe `(work_id,source,hash)` e demais CHECKs intactos.

**Verificação:** tsc/eslint limpos · suíte **934** · editor loopback recompila ambas as páginas (200) · coverage:live
**9/4/22 · 0 linhas manuais** (sem regressão). **0 INSERT/UPDATE/DELETE · 0 migration aplicada · 0 digest/LLM/custo · sem commit.**

## 55. Migration 113 final + versionamento da política text-only (B2.2N, sem aplicar)

**Confirmação read-only dos nomes:** migration 112 (aplicada verbatim, postcheck B2.2L) ⇒ constraints atuais
`work_external_reviews_manual_provenance` (`CHECK (NULLIF(BTRIM(source_url),'') IS NOT NULL OR NULLIF(BTRIM(external_review_id),'') IS NOT NULL)`)
e `work_external_reviews_manual_text_nonempty` (`CHECK (NULLIF(BTRIM(text),'') IS NOT NULL)`). PostgREST/service-role
**não** lê `pg_catalog` ⇒ a confirmação por SELECT vai no **precheck** (SQL Editor).

**Migration 113 reescrita** ([113…sql](supabase/migrations/113_drop_external_review_provenance.sql)) faz **só**:
(1) `DROP CONSTRAINT …_provenance`; (2) `DROP CONSTRAINT …_text_nonempty`; (3) `ADD CONSTRAINT …_text_min40
CHECK (char_length(btrim(text)) >= 40)`. Atômica (BEGIN/COMMIT). Comentários corrigidos (não afirmam mais que o
não-vazio é mantido). Preserva: `source/text/normalized_text_hash NOT NULL`, FK CASCADE, RLS, 0 policies, índices,
trigger, CHECKs de metadados opcionais. Pacote read-only: `docs/sql/113…_{precheck,postcheck}.sql`. **NÃO aplicada;
tabela vazia.** Constraints removidas: **`…_provenance`** + **`…_text_nonempty`**. Adicionada: **`…_text_min40`**.

**Versão da política do corpus (explícita):** `REVIEW_CORPUS_POLICY_VERSION` em
[canonical-review-corpus.ts](lib/synopsis-interest/canonical-review-corpus.ts).
- **antiga `v0`** (implícita, pré-B2.2N): assinatura = texto + `origin:source`; fonte no prompt/estratificação.
- **nova `text-only-v1`** (atual): só o texto é sinal.

Propagação (trocar a política invalida plano/cache mesmo com texto idêntico):
| Onde | Como |
|---|---|
| `reviewCorpusSignature` | `corpusSignature` inclui `policy` (`buildCanonicalReviewCorpus`, opt `policyVersion`) |
| `planSignature` | `corpusPolicyVersion` em `GoldenDigestVersions` ⇒ dentro de `versions` na `planSignature` |
| cache/dedup do executor | `digestDedupKey(workId, hash, tag?)` + `EnsureDigestDeps.dedupTag`; executor experimental passa a política. Produção (`persist-reviews`) **não** passa tag ⇒ chave inalterada |

Testes (versões diferentes **não** reutilizam): corpus (`policyVersion` muda a assinatura) · planner
(`corpusPolicyVersion` muda a `planSignature`) · dedup (tag muda a chave; sem tag = produção estável). Suíte **937**.

## 56. base-2 e planSignature 295fe2d6… — STALE/SUPERSEDED (declaração)

A mudança de política do corpus (`v0 → text-only-v1`) **supersede** explicitamente, **mesmo com a tabela vazia**:
- **`base-2`** (`base2Signature 9d181e86…`) — congelou o corpus sob a política `v0` (fonte no sinal). Sob `text-only-v1`
  a representação do corpus muda (fonte fora do sinal; prompt uniforme) ⇒ base-2 é **pre-policy**; o snapshot do
  corpus a ser usado de fato é o **base-2r1** (a criar, **não** nesta fase), já sob `text-only-v1`.
- **`planSignature 295fe2d6…`** — calculada sob `v0`, sem `corpusPolicyVersion`. Qualquer plano novo passa a incluir
  a política ⇒ **295fe2d6 não reproduz mais** e está **superseded** (não reexecutar). Preservada como artefato histórico.

**Não** recriei/recalculei base-2r1 nem plano novo (proibido nesta fase). Os artefatos antigos seguem **preservados,
não apagados, não executados**. **0 INSERT/UPDATE/DELETE · migration 113 NÃO aplicada · 0 digest/LLM/custo · sem commit.**

## 57. Migration 113 APLICADA À MÃO + validada (2026-06-21)

Aplicada no SQL Editor (pacote `docs/sql/113_work_external_reviews_manual_text_only_{precheck,apply,postcheck}.sql`).
**Postcheck aprovado:** 14/14 PASS · `_provenance` + `_text_nonempty` REMOVIDAS · `_text_min40` PRESENTE
(`char_length(btrim(text)) >= 40`) · `source_url`/`external_review_id` seguem NULLABLE · FK/RLS/policies(0)/
índices(5)/trigger preservados · probes fail-closed concluíram (39-falha / 40-passa) · `row_count_final = 0`.
⇒ o banco agora **exige texto útil (≥40)** e **aceita cadastro só com `source`+`text`** (schema Zod já relaxado).
Tabela ainda **VAZIA** (cadastro humano em curso pela usuária — The Killer Empress + How to Put Your Savior on the Throne).
**Estado:** migration 113 = **aplicada e validada**. Editor local de pé em `127.0.0.1:3001`.

## 58. Canal ÚNICO de review manual + tabela text-only (2026-06-21)

**Decisão da usuária:** os dois "canais de review manual" eram a mesma coisa — reviews EXTERNAS
adicionadas à mão quando a busca automática acha poucas. Unificado:

- **Código (sem `work_manual_reviews`):** a avaliação IA ([ai.ts](server/actions/ai.ts)) passou a ler
  `work_external_reviews_manual` (evidência R1/R2, fonte real, sem nota) no lugar do store pessoal; edição
  só tem "Reviews externas"; o diálogo "Avaliar" ganhou o editor externo inline; o card de exibição mostra
  reviews externas. Removidos `manual-reviews-section`, `review-drafts-field`, `server/queries/manual-reviews`,
  `saveManualReviews`. **`work_manual_reviews` (tabela) preservada no banco, sem leitura/escrita por código.**
  Guard de isolamento atualizado (corpus do digest nunca lê `work_manual_reviews`).
- **Migração de dados (escrita autorizada):** **70 linhas** de `work_manual_reviews` → `work_external_reviews_manual`
  como `source=comix`, **text-only** (nota/note descartadas). 0 texto<40, 0 duplicata, **0 overlap com o golden
  pilot-2** (sem leakage). Tabela **2 → 72** (as 2 = cadastro humano de The Killer Empress + How to Put Savior).
- **Tabela text-only — migration 114 APLICADA + validada:** `DROP COLUMN source_url, external_review_id,
  reviewer_name, language, published_at` (auto-dropou os 4 CHECKs `*_nonblank`/`language_format` + índice
  `uniq_extid`). Pacote `docs/sql/114_*_{precheck,apply,postcheck}` (consolidados num único SELECT — o SQL
  Editor mostra só a última instrução). **Postcheck 8/8 PASS:** 8 colunas restantes (id/work_id/source/text/
  normalized_text_hash/created_by/created_at/updated_at), 3 CHECKs + 4 índices + FK CASCADE + RLS + 0 policies +
  trigger preservados, row_count=72 intacto. Schema/row/action/query/loader/UI agora só `source` + `text`;
  validação de hostname/proveniência removida.

**Estado:** migrations 113 + 114 **aplicadas e validadas**; DB e código batem (source+text). 931 testes,
tsc/eslint limpos, pages 200. **0 digest/LLM/custo · sem commit.** Editor de pé em `127.0.0.1:3001`.

## 59. Fase B2.2O — coverage progress + base-2r1 text-only-v1 (2026-06-21, read-only $0)

**(1) `pilot2:coverage:live` ajustado:** separa **baseline histórico** (9/4/0/22/0, congelado, referência)
× **estado atual** (`0/0/13` — corrige o bug `0/0/0`) × **divergência real** (invariantes). Progresso ratificado
NÃO bloqueia; só falha em invariante real (obras-alvo≠13 · obra<2 pós-meta · dup canônica inesperada ·
agregado≠individual). Lógica pura `evaluateLiveCoverage` + `HISTORICAL_COVERAGE_BASELINE` (+6 testes).

**(2) `base-2r1` criado** (`scripts/pilot2-base2r1.ts`, `npm run pilot2:base2r1`; helpers puros em
`base2r1.ts` +testes): reusa a **seleção congelada** do base-2 (90 obras · 51c/39n · dev56/hold34 ·
strata 22/23/23/22 — NÃO resseleciona/reordena) e recomputa só o corpus sob **text-only-v1**
(`work_reviews` + `work_external_reviews_manual`). **`base2r1Signature = b2d4306e…`** depende só de
`corpusPolicyVersion` + `[workId, reviewCorpusSignature]` ordenado (NÃO de source/origin/URL/datas/ordem).
**Diff vs base-2:** set de work_ids igual · identidade 90/90 idêntica · **0 bloqueantes** (sinopses/tags/
split/strata/taste preservados). **Validações:** 39/39 novas ≥2 · 13/13 deficientes ≥2 · dups nas 13 = 0
(total 1 = obra NEW fora das 13, dedup legítimo text-only: 6 textos idênticos de animeplanet+mangaupdates,
12→6). **Stats:** úteis/obra min0/max66/mediana4/total731; 5 obras >40 (cap); amostra digest determinística
665 reviewIds (índice/hash, **sem rodar digest**). **base-2 / manifest / `planSignature 295fe2d6…` PRESERVADOS**
(base-2 marcado **superseded**, não sobrescrito). Artefatos em `pilot-2/base-2r1/{snapshot,manifest,diff}.json`.

**Governança:** `work_manual_reviews` NÃO consultada · 945 testes · tsc/eslint limpos · frozen coverage segue
9/4/22. **0 digest/LLM/preflight/plano novo/custo · sem INSERT/UPDATE/DELETE/migration/commit/push/merge.**
