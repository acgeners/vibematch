# PLANO — Reviews & Digest (sinal único de consenso)

**Criado:** 2026-06-24
**Premissa central:** reviews individuais geram viés (opiniões divergem; pegar 1–3 específicas distorce). O sinal correto pra alimentar IA é **consenso + divergência** (o `review_digest`), não opinião pontual.

**Ordem de execução:** Fase 1 (golden) ✅ **GO (2026-06-25)** → Fase 2 (amostragem/corpus) ◀ atual → Fase 3 (avaliação IA). Da menor pra maior risco/custo; cada fase destrava a próxima.

**Status atual (já feito fora deste plano):**
- ✅ Ranker (Recomendar / Desempatar / Veredito IA / Chat) já usa **só o digest** (top-3 raw removidos do prompt + fetch morto removido). Princípios #5/#50/#51 reescritos pra consenso/divergência. `review_quotes` deixou de ser preenchido.

---

## Fato × hipótese (baseline antes de mexer)

| # | Afirmação | Tipo | Evidência |
|---|---|---|---|
| F1 | Digest trunca cada review a **1200 chars** + caps **40 total / 8 por fonte** | ✅ fato | `review-summarizer.ts` `DIGEST_*` |
| F2 | Digest amostra **round-robin por fonte, maior-primeiro** | ✅ fato | `sampleStratifiedBySource` |
| F3 | Avaliação IA de atributos usa **reviews crus** (R1/R2 auditável), **não** o digest | ✅ fato | `service.ts` `enforceAuditableReviewUsage` |
| F4 | Previsão de Interesse não usa reviews nem digest | ✅ fato | `synopsis-quality-predictor.ts` |
| H1 | Digest é mais representativo que reviews pontuais p/ julgar | ✅ confirmado (Fase 1) | golden-3 n=180: ΔMAE(e1−b1) −0,211 IC95 [−0,311; −0,117] |
| H2 | Experimento b1×e1 anterior foi enviesado (≈43% da golden sem review) | ✅ confirmado | golden-3 corrige (universo só com-digest + exclui lidas) → vira conclusivo |

---

## FASE 1 — Nova golden: testar digest no preditor de Interesse (do jeito certo)

> Vai primeiro: barato e responde "digest ajuda?". Destrava ou descarta as fases seguintes.

**Por que refazer:** o b1×e1 anterior misturou ~43% de obras **sem review** → e1 (com digest) era idêntico a b1 nessas → ruído diluiu o efeito. IC incluiu 0 (inconclusivo), n=90 sem poder.

### 1.1 Desenho
| Item | Decisão |
|---|---|
| **Universo** | SÓ obras **com digest existente** (exclui sem-review — senão o braço não existe) |
| **Reaproveitamento** | reusar as obras já **digeridas + rotuladas** do pilot-2 (as ~51 com digest) como ponto de partida |
| **Estratificação** | oversample **sinopse-pobre** e **sinopse↔reviews divergem** (sinopse curta; ou alto \|erro\| de `expected_score`) — onde o digest deveria fazer diferença |
| **n alvo** | ampliar além das ~51 (rotular novas obras-com-digest até ter poder; mirar ≥120 no recorte qualificado) |
| **Braços** | b1 (perfil+sinopse+tags) × e1 (b1 + digest) |
| **Método** | OOF (perfil exclui as obras de teste), MAE + IC95; reportar lift e baseline |
| **Critério go/no-go** | ligar digest no preditor **só** se e1 vencer b1 com IC que **não inclui 0** no recorte qualificado |

### 1.2 Custo estimado
- Predição: ~$0.007/obra × 2 braços. Recorte ~120 obras ≈ **~$1,7** LLM.
- Digests faltantes (obras novas com review mas sem digest): ~$0.02/obra.
- Rotulagem humana: das obras novas selecionadas (maior custo é tempo, não $).

### 1.3 Entregáveis
- [x] Selecionar universo qualificado (com-digest) + estrato (richness; sinopse-pobre dropado por inviável).
- [x] Reusar labels do pilot-2 (51 limpas); rotular o delta (129) até atingir n=180.
- [x] Rodar b1×e1 OOF; reportar MAE/IC/lift.
- [x] Decisão go/no-go documentada (abaixo).

### 1.4 RESULTADO (2026-06-25) — 🟢 GO

**Desenho executado:** digest-v1 de produção · n=180 · exclui `user_score`+lidas (remove hindsight E zera leakage OOF) · Protocolo C (rótulo contextual: humano vê sinopse+tags+digest sanitizado) · corpus canônico (scraped + `work_external_reviews_manual`). Reuso 51 + 129 rotuladas à mão. Tags entram em b1 E e1 ⇒ ΔMAE isola o digest. Artefatos em `.local-experiments/plan3/digest-exp-1/golden-3/` (`finalLabelsSignature 4660cb52`). Custo real: digests $3,59 + predições $2,91.

| Métrica (overall, n=180) | b1 (sinopse+tags) | e1 (+digest) |
|---|---|---|
| MAE ordinal | 0,667 | **0,456** |
| ΔMAE (e1−b1) · IC95 | — | **−0,211 · [−0,311; −0,117]** (exclui 0, material) |
| exact / QWK / ρ / pairwise | 0,41 / 0,40 / 0,41 / 0,77 | 0,59 / 0,52 / 0,57 / 0,88 |

**Robustez:** e1 vence sem reuso (n=129: −0,202 [−0,326;−0,085]), no bucket fino 2–4 (−0,255 [−0,412;−0,078]) e rico 10+ (−0,217). Holdout (72) tangencia 0 ([−0,319; 0]); overall (primário) conclusivo.

**Veredito: GO — ligar o digest no preditor de Interesse.** ΔMAE<0, IC exclui 0, efeito material (≥0,05).

**Ressalvas honestas:**
1. **Protocolo C infla a magnitude** (humano e e1 veem o digest) → sinal/robustez sólidos, magnitude otimista. NÃO prova ganho sobre gosto real (`user_score`, excluído).
2. **b1 (sinopse+tags) ≈ chute trivial** (MAE 0,667 vs baseline-moda 0,639) → o digest é o que torna o preditor útil; baseline fraco.
3. b1 super-estima (bias +0,26); o digest **calibra** (e1 bias −0,14).

**Pré-requisitos antes de embarcar (→ Fase 2):** o digest de produção hoje é **inferior** ao testado — usa só `work_reviews` (exclui manual externa) e está **sub-buscado** (~5 fontes aceitas não-buscadas/obra). Ligar o digest sem consertar o corpus embarcaria um digest pior que o validado.

---

## FASE 2 — Refinar a amostragem do digest (round-robin proporcional)

> Ganho fácil e transversal: melhora o digest pra todo mundo (ranker hoje, eval depois).

**Pedido:** round-robin só faz sentido com **muitas fontes/reviews**. Com poucas fontes ou muita review numa fonte só, é melhor deixar **desproporcional** (ex.: 2 de uma fonte + 8 de outra) do que forçar paridade e descartar conteúdo bom.

**Estado atual (`sampleStratifiedBySource`):** round-robin estrito até 8/fonte e 40 total — já preenche desproporcional quando uma fonte tem mais (o round-robin continua puxando das fontes que ainda têm). Mas o cap **8/fonte** ainda corta uma fonte rica quando há poucas fontes.

**Mudança proposta:**
- Quando `nº de fontes com review` for baixo (ex.: ≤ 2), **relaxar o cap por fonte** (ou removê-lo) e respeitar só o cap total (40). Assim 1 fonte com 30 reviews boas preenche o orçamento em vez de parar em 8.
- Manter round-robin quando há muitas fontes (preserva diversidade de ângulo).

### 2.1 Entregáveis
- [ ] Parametrizar `DIGEST_PER_SOURCE_CAP` por nº de fontes (cap dinâmico) — espelha o `selectReviewsForEvaluation` adaptativo da eval.
- [ ] Teste unitário: 1 fonte/30 reviews → usa até 40; 5 fontes → round-robin equilibrado.

**Decisão pendente p/ o humano:** **truncar a 1200 chars/review** continua? Reviews longas e ricas perdem cauda. Opções: (a) manter 1200; (b) subir p/ 2000; (c) orçamento por **tokens totais** em vez de chars/review. *Recomendo (c)* — controla custo direto e não corta arbitrariamente.

---

## FASE 3 — Digest como sinal único na Avaliação IA de atributos

> Por último: maior risco/custo (re-eval + auditoria reescrita). Só vale se confiarmos no digest — o que a Fase 2 melhora e a Fase 1 valida.

### 3.1 Problema de sequenciamento (RISCO PRINCIPAL)
O digest é gerado **depois** que as reviews são salvas (fire-and-forget no save). Mas é a **própria avaliação** que dispara o save. ⇒ no momento da eval, o digest **ainda não existe**.

**Opções:**
| Opção | Como | Custo/Latência |
|---|---|---|
| **3a (recomendado)** | gerar o digest **inline** das reviews recém-buscadas, ANTES da eval de atributos; passar no prompt | +1 chamada Sonnet (~$0.02) e +~?s antes da eval |
| 3b | reusar digest existente se fresco; senão cair em reviews crus | digest desatualizado/ausente → inconsistente |
| 3c | pipeline 2-passos: digest → eval numa orquestração durável | mais infra |

**Parecer:** 3a. O digest vira pré-requisito explícito da eval (consistente com "consenso > pontual"). Custo marginal aceitável vs. a eval em si.

### 3.2 Auditabilidade reescrita
- Hoje: modelo cita `R1/R2` e `enforceAuditableReviewUsage` re-tenta se não citou.
- Novo: modelo cita **traços/consenso do digest** (ex.: "consenso: pacing lento"). A regra passa a exigir referência aos campos do digest, não a IDs de review.
- **Risco:** perder rastreabilidade fina (qual review exata). Mitigação: `salient_traits` já tem polaridade → rastreável a nível de traço.

### 3.3 Entregáveis
- [ ] `requestAiEvaluation` aceita `reviewDigest` (além de / no lugar de `sourcedReviews`).
- [ ] Gerar digest inline no fluxo de eval (Path A e Path B).
- [ ] Reescrever a seção de reviews do prompt de atributos → consenso/divergência/traços.
- [ ] Adaptar `enforceAuditableReviewUsage` → auditoria por traço do digest.
- [ ] Bump de `prompt version` da eval (invalida caches — avaliar custo de re-eval do catálogo).

---

## Riscos transversais
- Fase 3: re-eval de atributos do catálogo após bump de prompt (custo + re-cálculo do pipeline de notas).
- Fase 3: perda de rastreabilidade fina (mitigado por `salient_traits`).
- Fase 1: se a golden qualificada ainda for pequena, o teste segue sem poder — orçar rotulagem suficiente antes de rodar.
