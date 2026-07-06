# PLANO — Bússola de Leitura (3 forças de decisão)

> Estado: **Fase 1 em andamento** (2026-07-06). Mockup aprovado, validação empírica concluída.
> Mockup: https://claude.ai/code/artifact/7fbe4aab-bd4c-483c-a2c3-26d9a7f0ead1
> Script de validação: `scripts/axis-gate.ts` (Testes 1–5) + `scripts/chance-validate.ts` (modelo da Chance).

## 1. Problema

A **Nota Prevista** (`expected_score`) colapsa "qualidade da obra" e "encaixe no gosto" num número só. Num catálogo **pré-filtrado e comprimido** (206 obras rotuladas, `user_score` média 7.82, **dp 0.95**), quase tudo cai em 7–8 → a nota não discrimina e **não ajuda no ranking**. As notas pós-leitura (craft) não alimentam nada útil e medem só metade (craft, não fit).

## 2. Decisão

Separar a decisão em **3 forças**, expostas num plano 2D navegável ("Bússola"):

| Força | Nome (UI) | Mede | Fonte |
|---|---|---|---|
| **Fit** | **Chance de gostar** | probabilidade de VOCÊ gostar | teu perfil + prefs declaradas + Interesse-na-obra |
| **Mérito** | **Avaliação** | quão bem avaliada (crítica) | `platform_avg` + (fase 4: sentimento de reviews) |
| **Popularidade** | **Alcance** | quão popular / consolidada | `total_votes` (nº de votos/reviews) |

Decisões de produto do user: **manter craft por ora** (re-avaliação por gosto segmentado no radar); **melhorar UX + ranking**; **plano pago primeiro**; colocação = **view nova + chips nos cards** (A/B na prática).

## 3. Inputs por força

**Chance de gostar** (o teu lado):
- **Interesse na obra** (LLM Sonnet) — usa sinopse + **reviews + tags + digest + prefs livres compiladas**. Já roda; é onde as **prefs livres** (texto) entram.
- **Tags declaradas** (`user_tag_preferences`, mig 100) — 107 love / 40 avoid, cobre 206/206. Já são prior do perfil E entram como feature limpa.
- **personal_fit** (overlap de tags) + **9 category_scores** (conteúdo IA).

**Avaliação**: `platform_avg` (0–10 → 0–100). Fase 4: + sentimento das reviews.
**Alcance**: `total_votes` normalizado (log → percentil 0–100).

### ⚠️ Trava arquitetural (respeitar)
As **prefs livres** (`user_preference_rules`, mig 102) por design **NÃO alimentam o modelo offline** — "efeitos cruzados/condicionais colapsam o Ridge". Elas chegam à Chance **só via o LLM Interesse-na-obra**. Nunca plugar texto livre direto na logística.

## 4. Validação empírica (concluída, $0)

Sobre 206 obras rotuladas (`scripts/axis-gate.ts`):

| Teste | Resultado | Veredito |
|---|---|---|
| 1 · Chance prevê gosto | personal_fit r=0.60, Interesse r=0.59, **AUC 0.73** | ✅ forte |
| 2 · Consenso externo | platform_avg r=0.36 (limpo) | 🟡 fraco, ortogonal |
| 3 · Split melhora MAE? | ~0.56 (empate com atual) | ❌ ganho = **textura de decisão**, não acurácia |
| 4 · 3ª força (popularidade) | corr(Avaliação, Alcance)=**0.25**; joia escondida = **21%** | ✅ separável, merece eixo |
| 5 · Chance sem leakage | FULL 0.732 → **CLEAN 0.707** (sem perfil) | ✅ **real, não artefato** |

**Conclusões:** (a) a Chance é sinal real e robusto a leakage (carregado por tags declaradas + critérios IA, ambos leakage-free); (b) as 3 forças são separáveis; (c) o ganho é de **decisão**, não de MAE — sucesso NÃO se mede por acurácia.

## 5. Plano de construção

| Fase | Escopo | Custo | Estado |
|---|---|---|---|
| **1 · Modelo** | `chance_score` = logística L2 + calibração Platt → 0–100. | $0 tokens | ✅ **COMPLETA** (mig 132 aplicada, recalc rodado, 868/868 no banco) |
| **2 · Chips** | 3 forças nos cards de ranking + página da obra (reusa platform_avg/total_votes + chance_score) | $0 | ✅ **COMPLETA** (verificado por screenshot nas 2 superfícies) |
| **3 · Bússola** | view nova: plano 2D + faces giratórias (Chance×Avaliação, Chance×Alcance, Avaliação×Alcance) + apetite de risco. Mockup = spec. | $0 | ✅ **COMPLETA** (3º view mode do /ranking, verificado por screenshot) |
| **4 · Refino** | sentimento de reviews / Interesse contínuo / "%" calibrado | $0 | ❌ **NO-GO medido** (ver abaixo) — feature completa em 1–3 |

\* Sem custo recorrente novo: o Interesse-na-obra (único LLM) **já roda**. Custo = dev, não tokens.

### Modelo da Chance (Fase 1, detalhe)
- **Alvo**: `1{user_score ≥ 8}` ("gostou"; base rate ~49%, balanceado).
- **Features (13)**: 9 category_scores + DeclaredLoved/DeclaredAvoided (frac de tags declaradas) + personal_fit + Interesse(1–4).
- **Modelo**: logística L2 (`lib/ml/logistic.ts`, novo), λ por K-fold (min log-loss).
- **Calibração**: Platt (1D logística sobre logits OOF) → probabilidade calibrada = **Chance %**.
- **Stub**: < 20 rótulos → retorna base rate.
- **Persistência**: coluna `calculated_scores.chance_score` (migration aditiva), computada no recalc junto do `expected_score`. Migration aplicada à mão (padrão do setup).

### Estado da Fase 1 (2026-07-06)
- **Arquivos**: `lib/ml/logistic.ts` (novo), `lib/calculations/chance.ts` (novo), `server/actions/calculations.ts` (integrado no `computeRecalc`), `types/domain.ts` (+2 campos), `supabase/migrations/132_chance_score.sql`.
- **Validação** (`scripts/chance-validate.ts`, n=206): AUC 0.741, Brier 0.198 (baseline 0.250), calibração honesta em 20–80%.
- **Integração verificada** (`scripts/chance-recalc-dryrun.ts`, sem escrever no banco): computeRecalc roda 880ms, chance_score preenchido 868/868, 0 stub, min 0.5 / máx 85.4 / média 41.4, sniff-test ok (inclui não-lidas).
- ✅ **Mig 132 aplicada + recalc rodado** (868/868 preenchidos no banco, 0 stub, valores batem com o dry-run). `scripts/chance-recalc-run.ts` = re-rodar o recalc + verificar ao vivo.
- Dívida NÃO relacionada: `tsc` do repo tem 3 erros pré-existentes (mangago sem `sync-constants`).

### Estado da Fase 2 (2026-07-06) ✅
- **Helper**: `lib/calculations/forces.ts` — `computeWorkForces` deriva Chance (chance_score) / Avaliação (platform_avg×10) / Alcance (log-norm de votos, ref 50k).
- **Componente**: `components/ranking/force-meters.tsx` — `ForceMeters` (size md horizontal / sm empilhado). Cores: Chance=violet, Avaliação=amber, Alcance=slate.
- **Página da obra**: card "Bússola de leitura" no topo da aba Notas (`app/titles/[id]/page.tsx`). Usa `calculated_scores(*)` (já tinha chance_score).
- **Card do ranking**: substituído o strip 2×2 pelo trio (opção aprovada); Veredito/Alinhamento seguem como colunas da tabela. Órfãos removidos (MetricCell/bandText/EMPTY_METRIC/alignPct/ícones/LABELS).
- **Query**: `chance_score` plugado em `ranking.ts` (select+tipo+map) e `works.ts` (WORK_LIST_SELECT).
- **Verificado por screenshot** (puppeteer-core, `scripts/screenshot-bussola.mjs` + `screenshot-ranking.mjs`): valores corretos, sem truncar. tsc/lint 0 nos arquivos novos.

### Estado da Fase 3 (2026-07-06) ✅
- **Componente**: `components/ranking/bussola-plane.tsx` — `BussolaPlane` (plano 2D, faces giratórias, apetite de risco, tooltip, click→obra).
- **Integração**: 3º view mode "bussola" no `/ranking` (junto de lista/cards) em `ranking-table.tsx` — reusa os `RankingEntry` (filtros/sort já aplicados). Ícone `Compass`, persistido em localStorage.
- **Helper**: `classifyArchetype` (absoluto) + `classifyArchetypeByPercentile` (median-split) em `forces.ts`.
- **⚠️ Decisão de design importante**: posição = **PERCENTIL no acervo**, não valor absoluto. Sem isso, Avaliação (platform_avg toda em 70–95, catálogo comprimido) empilhava tudo numa faixa no topo e metade do plano ficava vazia. Percentil espalha (mediana no centro), quadrantes alinham com a cor do arquétipo (Chance×Avaliação). Tooltip mostra valores absolutos.
- **Verificado por screenshot** (`scripts/screenshot-bussola-view.mjs`): 4 quadrantes povoados, cores alinhadas, faces + risco funcionando. tsc/lint 0.

### Estado da Fase 4 (2026-07-06) ❌ NO-GO medido
Medição $0 (`scripts/chance-refine-measure.ts`, n=206) matou os 3 itens:
- **"%" calibrado**: já feito na Fase 1 (Platt). Nada a fazer.
- **Interesse contínuo (banda × confidence)**: AUC 0.741 → 0.741 (Δ 0.000). `confidence=0` em todas as rotuladas (Interesse manual ⇒ conf=1 ⇒ contínuo=ordinal); confidence só existe em não-lidas (fora do treino) ⇒ inmensurável/marginal.
- **Sentimento/rating de reviews** (`work_reviews.user_rating`): corr com user_score = **−0.05** (platform_avg dá 0.36), cobertura 42% ⇒ adicionaria ruído. NO-GO.

**Veredito: feature COMPLETA nas Fases 1–3.** Chance perto do teto (~0.74 AUC) com features/dado atuais. Alavancas reais (não-código): (1) mais obras rotuladas (retreina a cada recalc); (2) reconciliação de sinais sobrepostos (gate = user viver com a Bússola).

## Pendências (registro 2026-07-06)

Nada bloqueante — a feature está no ar. O que ficou:

- **Reconciliação de sinais** (produto, disruptivo): aposentar as sobreposições no ranking — "Prioridade" (`decisionScore`), Alinhamento (`personal_fit`), Interesse (colunas) — agora redundantes com as 3 forças. **GATE = user viver com a Bússola** e ver o que de fato usa; é irreversível, só com evidência de uso.
- **Acúmulo de dado**: a Chance melhora sozinha conforme mais obras ganham `user_score` (retreina a cada recalc). Sem ação de código.
- **Fase 4**: medida NO-GO — não reabrir sem novo dado/sinal.
- **Calibração "no olho"**: `POP_REF` (Alcance=50k votos) e limiares do arquétipo (chance≥50 / aval≥65 absoluto; median-split no plano) são chutes razoáveis — reavaliar se o acervo crescer muito.
- **Dívida NÃO-Bússola** (pré-existente): mangago sem `npm run sync-constants` completo → 3 erros de `tsc` (`external-search.tsx`, `lib/external/index.ts`). Não é desta feature; roda sync-constants pra limpar.

## Arquivos da feature

Novos: `lib/ml/logistic.ts`, `lib/calculations/chance.ts`, `lib/calculations/forces.ts`, `components/ranking/force-meters.tsx`, `components/ranking/bussola-plane.tsx`, `supabase/migrations/132_chance_score.sql`, este doc, + scripts de validação/verificação (`scripts/axis-gate.ts`, `chance-validate.ts`, `chance-recalc-dryrun.ts`, `chance-recalc-run.ts`, `chance-refine-measure.ts`, `screenshot-*.mjs`).
Editados: `server/actions/calculations.ts` (recalc), `server/queries/ranking.ts` + `works.ts` (dados), `app/titles/[id]/page.tsx` (card), `components/ranking/ranking-table.tsx` (chips + view mode), `types/domain.ts` (2 campos).

## 6. Naming (aprovado)
**Chance de gostar** · **Avaliação** · **Alcance**. Quadrantes: Aposta segura / Teu nicho / Alto potencial / Pular (e por face: joia escondida, hype fora do perfil, consagrada, cult).

## 7. Aberto / futuro
- Re-avaliação das ~200 obras por **gosto segmentado** (eixo de fit limpo, sem leakage) — desbloqueio futuro.
- "%" como probabilidade literal só após calibração validada (Fase 1) — até lá, "índice".
