# PLANO — Testes do digest: Stage 1 (atributos) + Interesse b1/e1

**Criado:** 2026-06-26
**Contexto:** a ablação ($0) mostrou que o **SinopseScore (Interesse) legado é redundante** no Ridge (ΔMAE +0,0007). Mas isso testou só o legado. Faltam duas perguntas, agora com **n simplificado** (barato) antes de qualquer commitment grande:

1. **Atributos:** o digest melhora/estabiliza as notas dos 9 critérios (vs reviews cruas, que enviesam quando leitores divergem)? — e isso melhora a Nota Prevista via Ridge?
2. **Interesse:** um Interesse **com digest** (e1) deixa de ser redundante e ajuda a Nota Prevista vs **sem digest** (b1)?

**Premissa medida (2026-06-26):** obras lidas (n=201) são **tag-ricas** (mediana 40 tags) → o alinhamento estruturado já está bem coberto; o que o Interesse/digest poderia adicionar é alinhamento **narrativo** que as tags não nomeiam. Das lidas: **89 já têm digest** (72 frescos), 196 são digeríveis, 107 sem digest.

---

## DECISÃO (2026-06-26) — testes PAUSADOS (mantidos como exploração futura)

Após a ablação ($0) + análise de custo, **não vamos executar** os dois testes por ora — caro pra retorno incerto/provavelmente marginal. Conclusões:

- **Ablação (feita, $0):** o SinopseScore legado é **redundante** no Ridge (ΔMAE +0,0007). O alinhamento já está capturado por `LovedTagOverlap`+`CriterionFitScore`+as 9 notas.
- **Obras lidas são tag-ricas** (mediana 40 tags) → reforça a redundância (alinhamento estruturado bem coberto; "poucas tags" é ~2% do catálogo).
- **Nota Prevista mal diferencia** o ranking (std 0,55) + blend 50/50 dilui qualquer feature → mover a Nota Prevista via digest tem **teto baixo**.
- **Onde o digest JÁ vale (validado):** Interesse ♥ / Veredito IA / ordenação (Fase 1). Caminho de pé, **reforçado** pela Fase 2.

**Feito nesta rodada:** 2A commitado (branch `feat/digest-canonical-corpus` — digest de produção agora inclui `work_external_reviews_manual`); instrumentação ELOB **revertida** da `recalculateAll`.

**Gatilho pra revisitar os testes abaixo:** mais dados rotulados, ou o ledger `prediction_snapshots` (hoje 0 linhas) acumular sinal de **gosto real** que justifique re-testar. Até lá, ficam documentados como exploração futura — NÃO executar sem novo apetite/orçamento.

---

## Guard-rails (valem pros dois testes)
- **Custo:** nenhum LLM pago sem $ estimado aprovado; hard cap por etapa; abort se estourar.
- **Sem escrita em produção:** digests/predições do teste vão pra **artefato local** (`.local-experiments/plan3/`); a instrumentação da recalc é **env-gated + early-exit** (0 write) e **revertida** ao fim.
- **Leakage:** OOF de verdade onde aplicável; comparações relativas (e1−b1) cancelam vazamento comum de perfil.
- **Verificação:** afirmações conferidas nos artefatos/no app, não só por leitura de código.

---

## TESTE 1 — Stage 1: digest vs cru nos atributos sensíveis (GATE, NÃO passa no Ridge)

> Responde direto a preocupação: *"3–30 reviews cruas enviesam protagonista/casal/humor quando leitores divergem."* É a **porta barata** antes do teste caro (atributos via Ridge, ~$20).

### 1.1 Universo / n simplificado
- **n = 12 obras lidas** com reviews suficientes (≥6 úteis) e **divergência** num dos 3 atributos sensíveis (protagonista / dinâmica do casal / humor):
  - **8 divergentes** — o digest marca `divergence` não-vazia OU `salient_traits` com polaridades opostas no eixo personagens/romance/humor.
  - **4 controle** — não-divergentes (consenso claro), pra contraste.
- Preferir obras que **já têm digest** (evita custo de geração) e que tenham **category_scores atuais** (âncora).

### 1.2 Procedimento (por obra)
- **Cru ×3:** rodar a eval de atributos com **3 amostras DIFERENTES** de reviews cruas (subconjuntos aleatórios seeded, ~8–10 reviews cada) → 9 notas cada.
- **Digest ×1:** rodar a eval com o **digest** no lugar das reviews → 9 notas.
- **Atual:** as `category_scores` já no banco ($0, referência).
- Mecanismo: precisa de um caminho **eval-com-digest** (protótipo mínimo da Fase 3 — param `reviewDigest` em `requestAiEvaluation` que injeta a seção de consenso no prompt). Pequena mudança de código, reversível, reaproveitável na Fase 3.

### 1.3 Métricas
- **Instabilidade do cru (o viés):** por atributo sensível, `spread = max−min` das 3 amostras cruas. Alto spread = a nota depende de qual review entrou.
- **Estabilidade do digest:** o digest é único/estável; reportar onde ele cai vs o range do cru (no meio? num extremo?).
- **Materialidade (gate p/ Stage 2):** `|digest − média(cru)|` por atributo. Mediana nos 3 sensíveis.
- **Âncora (opcional):** `|digest − atual|` vs `|média(cru) − atual|` — qual fica mais perto da nota já registrada.

### 1.4 Go/No-Go
- **GO p/ Stage 2 (atributos via Ridge, ~$20)** se: o digest **muda material** as notas (mediana `|digest − média(cru)|` ≥ ~0,5 num critério sensível) **E** reduz a instabilidade (spread do cru claramente > 0 e digest mais estável/balanceado).
- **NO-GO** se: o digest mal muda as notas (mediana |Δ| < ~0,3) → nada material pra propagar ao Ridge → **economiza os $20**.

### 1.5 Custo
- 12 obras × (3 cru + 1 digest) = **48 evals** × ~$0,10 ≈ **$5** · + geração de digest p/ as que faltam (~$0,3). **Hard cap $7.**

---

## TESTE 2 — Interesse b1/e1 (simplificado, PASSA no Ridge)

> Responde: *"um Interesse com digest melhora a Nota Prevista (vs sem digest), contra user_score real?"* Foco no relativo **e1 vs b1** (isola o digest).

### 2.1 Universo / n simplificado
- Treino do Ridge: **todas as 201 lidas** (precisa pra treinar).
- Subgrupo discriminante: as **89 lidas que já têm digest** (sem custo de geração) — é onde e1 difere de b1.

### 2.2 Procedimento
1. **b1** (perfil + título + sinopse + tags) p/ as **201** → SinopseScore-b1.
2. **e1** (b1 + digest sanitizado) p/ as **89 com digest** → SinopseScore-e1.
3. **Perfil:** usar o perfil de produção atual (1 só). Justificativa: o vazamento de perfil afeta b1 e e1 **igual** → cancela no relativo **e1−b1** (a comparação principal). O OOF do **Ridge** (perfil/pesos/calibração por fold) segue de verdade via o harness `computeHonestExpectedCvMae`.
4. **Harness (ELOB, já instrumentado):** rodar 3 variantes de SinopseScore, OOF honesto:
   - `legado` (stored) · `b1` (todas=b1) · `e1` (89=e1, resto=b1).
5. **Comparar MAE no user_score:** overall (201) **e** no subgrupo das 89 (onde b1≠e1). ΔMAE(e1−b1) + IC95 bootstrap.

### 2.3 Go/No-Go
- **GO (digest ajuda o Ridge)** se ΔMAE(e1−b1) < 0 com **IC95 que exclui 0** no subgrupo das 89 (e idealmente material, ≥ ~0,02 no MAE blendado).
- **NO-GO** se IC inclui 0 → confirma a redundância (mesmo com digest) → Interesse fica só pra display/Veredito, não pro Ridge.
- Caveat: n=89 tem **poder limitado** + o blend 50/50 dilui → efeito pequeno pode sair inconclusivo. É um **read direcional**, não veredito final.

### 2.4 Custo
- 201 b1 + 89 e1 = **290 predições ♥** × ~$0,007 ≈ **$2** · Ridge $0. **Hard cap $4.**

---

## Sequência + árvore de decisão

```
Stage 1 ($5) ─┬─ digest muda material os atributos? ── SIM → Stage 2 (atributos via Ridge, ~$20)
              └─ NÃO → para (digest não muda nota → não propaga)

Interesse b1/e1 ($2) ─┬─ e1 < b1 (IC exclui 0)? ── SIM → digest entra no Ridge via Interesse
                      └─ NÃO → Interesse fica só display/Veredito
```

- **Custo total dos dois (simplificado): ~$7. Hard cap ~$11.**
- Independente dos resultados: o digest já é validado (Fase 1) pra **ordenação/Veredito** — esse caminho segue de pé.

## Artefatos
- `.local-experiments/plan3/stage1/` (atributos) e `.local-experiments/plan3/elob/` (interesse).
- Instrumentação temporária: `computeHonestExpectedCvMae` (param `sinopseByWork`/`outPreds`) + bloco `ELOB` env-gated em `recalculateAll` — **REVERTER ao fim**.

## Status
- [x] Ablação do SinopseScore legado ($0) → **redundante** (ΔMAE +0,0007)
- [x] 2A commitado (`feat/digest-canonical-corpus`) + instrumentação ELOB revertida
- [x] Decisão: **pausar** os dois testes (caro × retorno incerto) — ver bloco DECISÃO acima
- [ ] ⏸️ FUTURO — Stage 1 (atributos): preflight $0 → aprovar custo → rodar  *(só com novo apetite)*
- [ ] ⏸️ FUTURO — Interesse b1/e1: gerar b1/e1 → harness → comparar  *(só com novo apetite)*
- [ ] FUTURO barato — verificar se `prediction_snapshots` grava ao recomendar (validação de gosto real ao longo do tempo, $0 upfront)
