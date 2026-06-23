STATUS: GOLDEN DATA READINESS: APROVADO PARA SNAPSHOT-BASE → MATERIALIZADO (Fase B2.1C). Snapshot-base (base-1) e pacote cego congelados/validados; PRONTO PARA ROTULAGEM HUMANA. Manifesto: PLANO3-GOLDEN-SNAPSHOT-BASE-MANIFEST.md. Nenhuma chamada paga executada.

# Plano 3 — Golden Data Readiness Gate (Fase B2.1A)

> Sessão **read-only** — 2026-06-19. Comprova se os dados das **80 obras únicas** do golden
> estão atualizados/adequados para cada candidato e para a rotulagem, **antes** de materializar
> o snapshot e iniciar a rotulagem humana. Banco só por `SELECT`. **Zero** refresh/summary/digest/
> avaliação/alignment/recalc/previsão/label/job/LLM/migration.
> Proveniência: 🟦 código (`file:line`) · 🟩 banco (read-only, 2026-06-19) · 🟨 inferência · 🟧 decisão.
>
> Freshness medida com as **funções reais de produção** (importadas no probe read-only):
> `hashSynopsisInputs` (canonical), `hashReviewInputs`+`parseReviewSummaryMeta`+`isMaterialReviewChange`
> (summary/digest). Nenhum dado alterado.

---

## Veredito do gate (resumo)

| Alvo | Pronto agora? | Motivo |
|---|:--:|---|
| **Rotulagem humana** | ✅ **SIM** (após congelar snapshot) | mostra só a **sinopse canônica** → **80/80 fresh** |
| **b1** (baseline) | ✅ **SIM** | canonical 80/80 fresh + perfil v7 fresh; tags 79/80 (S078=0 tags degrada, não bloqueia) |
| **D1** (tags) | ✅ **SIM** | tags 79/80 + perfil; S078 (0 tags) degrada ao piso |
| **D2** (tags+sinopse) | ✅ **SIM** | canonical + tags + perfil, todos fresh |
| **e1** (enriquecido) | ⛔ **NÃO** | precisa de **51 digests** (após decidir refresh de reviews); 29 `no_reviews` legítimo |

**Único trabalho de dados que falta é para o `e1`: gerar 51 digests.** Os demais candidatos e a rotulagem estão prontos. AI eval / calc scores / alignment / ratings **não são usados por nenhum candidato** ⇒ **não bloqueiam** (medidos abaixo para registro, sem virar pré-requisito).

---

## 1. Contratos exatos dos candidatos (🟦)

Fontes: [synopsis-quality-predictor.ts](lib/ai-evaluation/synopsis-quality-predictor.ts) (b1/e1), [experiment.ts](lib/synopsis-interest/experiment.ts) (e1 contexto), [baselines.ts](lib/synopsis-interest/baselines.ts) (D1/D2), [synopsis-interest-run.ts](scripts/synopsis-interest-run.ts) + [getCandidatesByIds](server/queries/recommendations.ts#L984) (o que D1/D2 leem).

| Entrada | b1 | e1 | D1 | D2 |
|---|:--:|:--:|:--:|:--:|
| title | required | required | not_used | not_used |
| canonical synopsis | required (fallback raw) | required (fallback raw) | not_used | required (fallback raw) |
| raw synopsis fallback | fallback | fallback | not_used | fallback |
| tags | optional | optional | **required\*\*** | required\*\* |
| taste profile | required | required | required | required |
| reviews brutas | not_used | not_used | not_used | not_used |
| review summary | not_used | **fallback** (do digest) | not_used | not_used |
| review digest | not_used | **required\*** (fallback summary→no_reviews) | not_used | not_used |
| category scores | not_used | not_used | not_used | not_used |
| AI evaluation scores | not_used | not_used | not_used | not_used |
| platform ratings | not_used | not_used | not_used | not_used |
| calc score | not_used | not_used | not_used | not_used |
| expected score | not_used | not_used | not_used | not_used |
| personal fit | not_used | not_used | not_used | not_used |
| alignment score | not_used | not_used | not_used | not_used |
| Veredito IA / decision score | not_used | not_used | not_used | not_used |

\* `e1`: o contexto de review é **required como conceito**, mas com fallback explícito `digest fresco → summary fresco → no_reviews` ([resolveReviewContext](lib/synopsis-interest/experiment.ts)). `no_reviews` é entrada válida (não bloqueia).

\*\* **tags em D1/D2 = `required` como CAMPO ESTRUTURAL, não "≥1 tag obrigatória".** `tags=[]` é entrada válida e determinística (🟦 `weightedTagOverlap` retorna `0` com `workTags=[]`; D1 → score 0 → ♥; D2 ainda extrai sinal da sinopse). Sem divisão por zero, sem fallback necessário, sem resultado neutro inválido. Correção de ambiguidade da Fase B2.1A (ver Fechamento do Gate, S078).

> D1 usa **só tags + perfil** (`baselineD1`: `weightedTagOverlap`). D2 acrescenta a **sinopse** (`baselineD2`). Nenhum candidato lê reviews brutas, notas IA, scores calculados, alignment ou ratings.

### alignment_score × Veredito IA × decision_score (🟦 confirmado)
- **alignment_score** = dado **persistido** em `calculated_scores.alignment_score` (mig 056) + `alignment_stale` (mig 077). É o resultado do LLM re-ranker pago.
- **"Veredito IA"** = **rótulo de UI** do mesmo `alignment_score` (memória do projeto; não é dado distinto).
- **decision_score** = **derivado em tempo de ranking** (`Prevista·(1−w)+(alignment/10)·w`), **não persistido** (sem coluna; aparece só em `prediction_snapshots`/`prediction_ledger` como medição). 
- ⇒ alignment_score e Veredito IA são **o mesmo artefato**; decision_score é derivado dele. **Nenhum** entra em b1/e1/D1/D2. Classificação: **ranking_only** (AUDIT F6: sem ganho demonstrado — **não** transformar em pré-requisito).

---

## 2. Dados usados na rotulagem humana (🟦)

[export](scripts/synopsis-interest-export.ts) mostra ao avaliador **apenas**: `slot_key` opaco + **sinopse canônica**. Esconde título, work_id, tags, previsão, candidatos, scores, ranking, reviews, capa, externos, estrato.

| Campo mostrado | Precisa estar fresh+congelado? |
|---|:--:|
| sinopse canônica | **SIM** — é o único input do julgamento |
| sinopse bruta | não (só usada se canonical ausente — não é o caso) |
| título | não (não mostrado) |
| outros | não (não mostrados) |

**Regra aplicada:** nenhum dado **não mostrado** ao avaliador bloqueia a rotulagem. ⇒ o **único** pré-requisito de rotulagem é **canonical synopsis fresh + congelada**. 🟩 **80/80 canonical fresh** ⇒ rotulagem desbloqueável assim que o snapshot for congelado.

---

## 3. Readiness das sinopses (🟩, freshness real via `hashSynopsisInputs`)

Para cada obra: `work_synopses` → expand (`splitSynopsesFromText`) → `hashSynopsisInputs` → comparar com `canonical_synopsis_inputs_hash`.

| Estado | Obras |
|---|--:|
| `canonical_fresh` | **80** |
| `canonical_stale` | 0 |
| `canonical_missing_with_raw` | 0 |
| `no_usable_synopsis` | 0 |

**Plano de consolidação necessário: nenhum.** Todas as 80 têm canonical fresca (hash bate com as sinopses de origem atuais) e raw presente como fallback. Fallback que seria usado: **nenhum** (canonical sempre disponível).

---

## 4. Readiness de tags e perfil (🟩)

**Tags (por obra):** 79/80 com tags · **1 com 0 tags** (`S078`). Das 79 com tags, **79/79 têm grupo** (`tag_group_id != null`) ⇒ enriquecimento completo onde há tags. Nenhuma tag "stale" detectável (o enriquecimento é durável; group preenchido).
- b1/e1 usam tags como **opcional** (contexto); D1/D2 usam tags (D1 só tags). `S078` (0 tags): **degrada** (D1 sem sinal → piso; b1/D2 seguem com sinopse). **Não bloqueia.**
- Candidatos usam **nomes** de tags (`formatTagsByGroup`/`weightedTagOverlap`). Tags enriquecidas (grupo) melhoram o agrupamento no prompt mas **não** são requisito duro.

**Perfil (🟩):** `taste_profile` **v7 current**, `is_stub=false`, `input_hash=210021707a97…`, assinatura funcional `23eb13f0…`, criado 2026-06-19. **Fresh** contra a biblioteca atual: `recalc_pending=false`, as 112 previsões modernas usam exatamente essa assinatura, e o dry-run do backfill reportou `profileAction=none`. **Sem regeneração necessária.**

---

## 5. Readiness das reviews (🟩)

| Métrica | Valor |
|---|---|
| obras com review útil (texto ≥40) | **51** |
| obras sem review útil | **29** (`no_reviews` legítimo) |
| IDs externos aceitos | **80/80** têm ≥1 fonte aceita |
| reviews por obra (úteis) | 1 a 91 |
| fontes por obra | 1 a 4 |
| `fetched_at` mais antigo (catálogo do golden) | 2026-05-24 (~26 dias) |
| `fetched_at` mais recente | 2026-06-15 (~4 dias) |
| idade do fetch mais recente por obra | **todas ≤ ~26 dias** (20 obras 20–29d · 26 obras 10–19d · 5 obras ≤9d) |

| Classificação | Obras |
|---|--:|
| `reviews_fresh` (recente, fonte estável) | 51 (todas ≤26d) |
| `reviews_potentially_stale` | 0 detectado por idade; ver política |
| `reviews_missing_but_fetchable` | 0 obrigatório (29 são ausência legítima; têm IDs aceitos mas 0 review útil) |
| `no_reviews_legitimate` | 29 |
| `blocked_external_source` | 0 |

**Sinal de movimento do corpus:** **9 obras** têm `review_summary` **stale** (hash do summary ≠ hash das reviews atuais, com crescimento material) ⇒ as reviews dessas 9 cresceram **depois** do summary. Isso confirma que "review existe" **≠** "review congelada/atualizada".

### Política de freshness proposta (🟧 — decisão da usuária)
Baseada em `fetched_at` + natureza da obra (publicação):
```
reviews ≤ 30 dias                         → tratar como fresh para o experimento
obra completed/cancelled                   → reviews estáveis; fresh por mais tempo
obra ongoing/hiatus + crescimento material → potencialmente stale (refresh opcional)
sem fetched_at confiável                   → tratar como stale → refrescar antes de congelar
```
**Recomendação 🟧:** como todas as 51 estão ≤26 dias e o experimento mede o predictor sobre as reviews **existentes** (não a completude do corpus), **congelar as reviews como estão** (sem refresh). Refrescar só adicionaria custo/risco e invalidaria summaries/digest sem mudar a pergunta do experimento. **Não buscar reviews nesta etapa** (e provavelmente nem na próxima).

---

## 6. Readiness de summary e digest (🟩, freshness real)

Ordem obrigatória futura: **reviews congeladas → summary → digest** (mesmo sendo independentes no código, nenhum gera antes de decidir o refresh das reviews).

**Summary** (das 51 com reviews):
| Estado | Obras |
|---|--:|
| `summary_fresh` | **42** |
| `summary_stale` | **9** (S002, S079, S008, S056, S019, S057, S045, S025, S021) |
| `summary_missing` | 0 |

**Digest** (das 51 com reviews):
| Estado | Obras |
|---|--:|
| `digest_fresh` | **0** |
| `digest_stale` | 0 |
| `digest_missing` | **51** |

⇒ Para o `e1`: gerar **51 digests** (após congelar reviews). Os **9 summaries stale** só importam se o `e1` cair no **fallback summary** — como o digest será gerado para todas as 51, o fallback summary **não** será usado (a menos que um digest falhe). **Regenerar os 9 summaries é OPCIONAL** (recomendado **pular**; o digest os supera). As 29 `no_reviews` não geram nada (legítimo).

---

## 7. Notas de atributos e avaliação IA (🟩)

| Métrica | Valor |
|---|---|
| `ai_eval_status = done` | **79/80** |
| `ai_eval_status = skipped` | 1 |
| obras com 9 category_scores | **80/80** |
| category_scores parciais/ausentes | 0 |

**Uso pelos candidatos:** b1/e1/D1/D2 **não usam** category_scores nem avaliação IA (§1). ⇒ a ausência/skip **não é bloqueante** para nenhum candidato. **Avaliações a executar por necessidade do experimento: 0.** (Não recomendar completar avaliações por cobertura administrativa — AUDIT-rigor: sem justificativa experimental, não vira pré-requisito.)

---

## 8. Calculated scores (🟩)

| Métrica | Valor |
|---|---|
| `calculated_scores` presentes | **80/80** |
| `personal_fit` não-null | **80/80** |
| `recalc_pending` (global) | **false** |
| `calculated_at` (último, global) | 2026-06-19T03:07:51 (recalc 2B.2) |
| inputs modificados após `calculated_at` | nenhum sinal (recalc_pending=false) |

**Uso pelos candidatos:** calc_score / expected_score / personal_fit **não são usados** por b1/e1/D1/D2 (§1). ⇒ **não bloqueiam** este experimento. Registro explícito: **nenhuma ordem `avaliação IA → ratings → recalculateAll` é exigida** para o golden. (Se algum candidato futuro passar a usar scores, a ordem seria: atualizar entradas → avaliação IA → ratings → `recalculateAll` → congelar — **não é o caso agora**.)

---

## 9. Alignment / Veredito IA (🟩)

| Métrica | Valor |
|---|---|
| `alignment_score` presente | **47/80** |
| `alignment_stale` | **0** |
| `alignment` ausente | 33/80 |

- alignment_score = Veredito IA (mesmo dado); decision_score derivado (§1). Consumidor: ranking opcional (re-rank pago). Staleness: `alignment_stale` (edição marca stale) — 0 stale hoje. Custo: metered (LLM pago) — **não incorrido** aqui.
- **Função no experimento:** `ranking_only` / `not_used` pelos candidatos. AUDIT F6: alignment **sem ganho demonstrado** ⇒ **não** é input_required e **não** vira candidato separado **sem justificativa experimental**. (Se a usuária quiser testá-lo, seria um candidato experimental **separado**, fora do escopo digest×baseline.)

---

## 10. Platform ratings e dados externos (🟩)

- D1/D2 são determinísticos sobre **tags/sinopse + perfil** — **não usam** `platform_ratings` (§1). `platform_ratings` alimenta `calc_score` (não usado por nenhum candidato).
- ⇒ **ratings não precisam de refresh antes do snapshot.** Medição registrada: 80/80 têm IDs externos aceitos; `data_refreshed_at` não é entrada de candidato. **Nenhuma atualização exigida.**

---

## 11. Matriz de readiness por obra (🟩)

As 80 obras são **homogêneas** na maioria das categorias; a matriz é apresentada como **estado comum + exceções** (evita 80 linhas idênticas).

**Estado comum (vale para todas, salvo exceções abaixo):**
| Categoria | Estado |
|---|---|
| canonical | **fresh** (80/80) |
| tags | **fresh/enriquecida** (79/80) |
| AI attributes | **fresh** (cat9 80/80; status done 79/80) |
| calculated scores | **fresh** (80/80; recalc_pending=false) |
| perfil | **fresh** (v7, todas) |

**Exceções (as únicas obras que divergem):**
| Categoria | Estado | Obras |
|---|---|---|
| tags | `missing_optional` (0 tags) | **S078** (1) |
| reviews/summary/digest | `not_applicable` (no_reviews) | **29** obras |
| summary | `stale` (reviews cresceram) | **9** (S002, S008, S019, S021, S025, S045, S056, S057, S079) |
| digest | `missing_required` (p/ e1) | **51** obras com reviews |
| alignment | `not_applicable` (ranking_only) | absent 33 / fresh 47 |
| ai_eval_status | `manual` (skipped, mas cat9 ok) | 1 obra |

**`overall` por candidato:**
| Candidato | ready | bloqueadas | observação |
|---|--:|--:|---|
| **labeling** | **80** | 0 | canonical fresh; congelar snapshot |
| **b1** | **80** | 0 | S078 roda sem tags (degrada) |
| **D1** | **80** | 0 | S078 = piso (0 tags, sem sinal) |
| **D2** | **80** | 0 | todas com canonical+tags |
| **e1** | **0 → 80** | 51 (até gerar digest) | 51 digest + 29 no_reviews; 9 summaries stale (fallback opcional) |

Estados usados: `fresh · stale · missing_required · missing_optional · not_applicable · manual · blocked`.

---

## 12. Plano de atualização em ordem correta (🟧 — NÃO executado)

| Estágio | Obras | Ação | Tier | likelyUsd | upperUsd | Falha isolada? | Bloqueia rotulagem? | Bloqueia candidato |
|---|--:|---|---|--:|--:|:--:|:--:|---|
| A. consolidar sinopses | **0** | — (80 fresh) | — | $0 | $0 | — | não | — |
| B. atualizar tags | **0** | — (S078 não tem tags por natureza) | — | $0 | $0 | — | não | — |
| C. atualizar reviews | **0\*** | decisão: **congelar como está** | free | $0 | $0 | sim | não | e1 (se refrescar) |
| D. congelar corpus de reviews | 51 | snapshot das reviews atuais (sem fetch) | free | $0 | $0 | não | não | e1 |
| E. regenerar summaries stale | **0–9** | **opcional** (digest supera) | micro | ~$0.03 | ~$0.05 | sim | não | e1 (só se fallback) |
| F. **gerar digests** | **51** | `ensureReviewDigest` (IDs do golden) | metered | **~$1.0** | **~$5.9** | sim | não | **e1** |
| G. avaliações IA | **0** | não exigido | — | $0 | $0 | — | não | nenhum |
| H. atualizar ratings | **0** | não exigido | — | $0 | $0 | — | não | nenhum |
| I. recalculateAll | **0** | não exigido | free | $0 | $0 | — | não | nenhum |
| J. congelar snapshot-base + enriched | 80 | materializar assinaturas (`computeSnapshotSignature`) | free | $0 | $0 | não | **sim** (base) | todos |
| K. gerar pacote cego | 90 slots | export (read-only, só sinopse) | free | $0 | $0 | sim | sim | — |
| L. liberar rotulagem | — | abrir folha cega | — | $0 | $0 | — | — | — |

\* C = 0 **se** a decisão for congelar as reviews como estão (recomendado).

**Caminho mínimo para desbloquear tudo:** J (snapshot-base) + K + L liberam **rotulagem + b1 + D1 + D2** com **custo $0**. Só o `e1` exige D+F (digest, ~$1.0/$5.9). E (summaries) é opcional.

---

## 13. Decisões que exigem autorização da usuária (🟧)

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| D1 | **Política de freshness de reviews** | reviews ≤30d = fresh; congelar como está | todas as 51 ≤26d; experimento mede o predictor, não a completude |
| D2 | **Refrescar reviews das 51?** | **Não** | custo/risco sem mudar a pergunta; invalidaria summary/digest |
| D3 | **D1/D2 continuam no experimento?** | **Sim** | piso determinístico grátis; responde "alternativa simples basta?" (AUDIT F10) |
| D4 | **alignment como candidato separado?** | **Não** (agora) | AUDIT F6 sem ganho; só se a usuária quiser um experimento próprio |
| D5 | **Gerar avaliações IA faltantes?** | **Não** | nenhum candidato usa; 80/80 já têm cat9 |
| D6 | **Regenerar os 9 summaries stale?** | **Não** (opcional) | o digest os supera no e1 |
| D7 | **Limite financeiro do digest do golden** | teto ~$6 (≥ upper $5.9) | gate agregado; micro-threshold não autoriza lote |

Nenhuma destas foi decidida silenciosamente — todas aguardam autorização.

---

## 14–18. (cobertos acima)

- **14 Plano de atualização:** §12. **15 Custos:** §12 + abaixo. **16 Bloqueadores:** §11/§12. **17 Decisões:** §13. **18 Critério de liberação da rotulagem:** §abaixo.

### Custos consolidados (futuros, NÃO gastos)
| Operação | Escopo | Likely | Upper |
|---|---|--:|--:|
| reviews (refresh) | 0 (congelar) | $0 | $0 |
| summary (regen stale) | 0–9 (opcional) | ~$0.03 | ~$0.05 |
| **digest** | **51** | **~$1.0** | **~$5.9** |
| avaliação IA | 0 | $0 | $0 |
| alignment | 0 | $0 | $0 |
| outras (consolidar/tags/recalc) | 0 | $0 | $0 |
| **Total mínimo (e1)** | | **~$1.0** | **~$5.9** |

### Critério de liberação da rotulagem
A rotulagem libera quando: (a) **canonical fresh** das 80 ✅ (já vale); (b) **snapshot-base congelado** (assinaturas materializadas, estágio J); (c) **pacote cego gerado** (estágio K). A rotulagem **não** depende de reviews/summary/digest/scores/alignment (não mostrados). ⇒ **pode liberar com custo $0**, em paralelo à geração de digest do `e1`.

---

### Banco (esta etapa — somente SELECT)
```
canonical fresh 80/80 · tags 79/80 (enriquecidas) · perfil v7 fresh · reviews úteis 51 · no_reviews 29
summary 42 fresh / 9 stale · digest 0 / 51 missing · cat9 80/80 · calc 80/80 (recalc_pending=false)
alignment 47 fresh / 33 absent · golden labels 0/90 (inalterado)
zero reviews atualizadas · zero summaries · zero digests · zero avaliações IA · zero alignments
zero recálculos · zero predictions · zero labels · zero jobs · zero chamadas pagas · zero migrations
Acesso: somente SELECT (1 script temporário, removido).
```

---

# Fechamento do Readiness Gate — Fase B2.1B (2026-06-19)

## A. Decisões aprovadas (registradas formalmente 🟧→✅)

| Tema | Decisão | Justificativa |
|---|---|---|
| **Reviews — freshness** | janela experimental **≤ 30 dias** | as 51 estão ≤26d (idade máx reportada 26d) |
| **Reviews — refresh** | **NÃO** atualizar/buscar; **congelar o corpus atual** | dentro da janela; experimento mede o predictor, não a completude |
| **Summaries stale (9)** | **NÃO** regenerar antes do experimento | as 51 receberão digest; summary é só fallback; não pagar summary+digest p/ a mesma obra. Se um digest falhar ⇒ estado **explícito** de falha/indisponibilidade (`stale_digest`/`missing`), **nunca** regenerar summary silenciosamente em execução |
| **Digests (51)** | etapa **paga separada**, **não autorizada aqui**; teto após dry-run exato (upper ~US$ 5,90) | único trabalho de dados do `e1` |
| **D1 / D2** | **mantidos** como candidatos determinísticos de custo zero | piso/baseline; respondem "alternativa simples basta?" (AUDIT F10) |
| **Alignment / Veredito IA** | **fora** desta rodada (não candidato) | nenhum candidato congelado usa; AUDIT F6 sem ganho; não vira requisito administrativo |
| **Avaliação IA** | **nenhuma** adicional | 80/80 já têm 9 category_scores; não usados por b1/e1/D1/D2 |
| **Calculated scores / ratings** | **não** recalcular/atualizar | não são entrada dos candidatos congelados |

## B. Resolução de S078

🟩 **Obra:** `S078` · workId `1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f` · *"Tada no Keiyaku Kon no Hazu na no ni…"* · split **holdout** · stratum **♥♥♥♥** · **1 slot** (não-repetida; nenhum outro slot aponta para ela).

**Estado real de tags (🟩):** `work_tags = 0` · `work_genres = 4` · IDs externos aceitos = **4** (comix, comick, animeplanet, mangaupdates) · canonical fresh · 15 reviews úteis · `ai_eval_status=done`.

**Causa:** a obra tem **gêneros (4) e 4 fontes externas aceitas** (MangaUpdates/AnimePlanet costumam carregar tags), mas os **work_tags granulares não foram persistidos** (`syncWorkTags` não trouxe tags nesta obra). Não é dado intrínsecamente ausente.

**Classificação (exatamente um estado):** **`missing_tags_recoverable`** — as tags são, em princípio, recuperáveis via re-sync das fontes externas.

**Recuperação (informada; NÃO executada):**
- Fonte: as 4 externas aceitas (tags viriam de MangaUpdates/AnimePlanet via o ingest).
- Mecanismo: `syncWorkTags` dentro de `refresh_external_data` ("Atualizar dados"/"Revalidar fontes") — **gratuito** (sem LLM), **manual/opt-in**.
- Comando futuro: refresh externo da obra (manual) — **não** rodado.
- Impacto na assinatura: recuperar tags mudaria `tagsSig` ⇒ mudaria as assinaturas de snapshot/b1/e1 ⇒ exigiria **nova versão de snapshot**.

**Decisão (consistente com o congelamento aprovado):** **NÃO recuperar nesta rodada** — recuperar tags = **refresh externo**, exatamente o que a decisão "congelar o corpus, sem buscar" exclui; e o golden está **FROZEN** (não modificar obras). S078 é **congelada como `no_tags`** (estado explícito), entrada válida e determinística. Recuperação fica como **opção futura deferida** (se a usuária quiser, antes de materializar o snapshot, via refresh gratuito → exigiria nova versão de snapshot).

**Por que NÃO bloqueia:** `tags=[]` é entrada determinística (§D1/D2). A obra **permanece** nas 80 únicas, no slot S078/holdout/♥♥♥♥, **recebe resultado em todos os candidatos** (não é excluída de D1/D2), e **não altera** o split. **Não foi removida nem substituída.**

**Impacto por candidato:** b1/e1 → tags **opcional** (segue com título+sinopse+perfil). D1 → score 0 ⇒ ♥ (provável **sub-previsão** de uma obra ♥♥♥♥: limitação legítima do baseline de tags, não bug; 1/80). D2 → ainda extrai sinal da **sinopse**. Nenhum quebra.

## C. Correção de contrato D1/D2 (ambiguidade da B2.1A)

`tags required` para D1/D2 significa **campo estrutural obrigatório que aceita `[]`**, não "≥1 tag obrigatória". 🟦 `weightedTagOverlap(workTags, profileTags)` com `workTags=[]` retorna `0` (perfil não-vazio) ⇒ D1 determinístico (♥), D2 usa a sinopse. **Sem divisão por zero, sem fallback necessário.** Coberto por testes ([baselines.test.ts](tests/unit/synopsis-interest/baselines.test.ts): "tags=[] … determinístico, sem divisão por zero").

## D. Correção mínima de assinatura (no_tags × erro de carregamento)

🟦 Adicionados (puros) em [experiment.ts](lib/synopsis-interest/experiment.ts): `resolveTagContext` + `computeTagsSignature` + tipo `TagContextType`. Garantem três estados **distintos** (antes colidiam):
- `tags=[]` → **`no_tags`** com assinatura estável `sha256("no_tags")`;
- lista não-vazia → `sha256("tags:a|b|c")` (order-independent);
- `tags=null`/`undefined` (não carregado/erro) → **THROW** (nunca assina); "obra não encontrada" → loader lança antes.

Coberto por testes ([experiment.test.ts](tests/unit/synopsis-interest/experiment.test.ts): "tag context — caso S078"). **Nenhuma migration.** O loader do snapshot **deve** usar `computeTagsSignature` para o `tagsSig`.

## E. Pseudorreplicação / elegibilidade (confirmado)

S078 permanece nas 80 únicas · no slot original (holdout/♥♥♥♥) · não excluída de D1/D2 · recebe resultado/falha **igual** em todos os candidatos · não altera o split. O `planGoldenDigest` continua elegendo-a (tem reviews, sem digest → entra nos 51). O golden **não** foi modificado.

## F. Veredito do gate

**GOLDEN DATA READINESS: APROVADO PARA SNAPSHOT-BASE.** S078 resolvida **sem bloqueio**; decisões fechadas; rotulagem **ainda não liberada** (só após materializar o snapshot-base + validar o pacote cego). Custo de desbloqueio de rotulagem/b1/D1/D2 permanece **$0**; o `e1` segue dependente dos 51 digests (etapa paga separada, ~$1.0/$5.9, não autorizada aqui).

### Banco (Fase B2.1B — somente SELECT)
```
S078: work_tags 0 · work_genres 4 · ext aceitos 4 · canonical fresh · reviews úteis 15 (inalterados)
golden labels 0/90 · taste_profile 7 · digests 14 · predictions 1026 · jobs 114 (todos inalterados)
zero tags alteradas · zero reviews · zero summaries · zero digests · zero avaliações IA · zero alignments
zero recálculos · zero predictions · zero labels · zero jobs · zero chamadas pagas · zero migrations
Acesso: somente SELECT (2 scripts temporários, removidos).
```
