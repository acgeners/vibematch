# Plano — Melhorias de Layout nas tabelas `/titles` e `/ranking`

> Trabalho de UI em paralelo com a Fase 1.5 (branch separada). Lista viva — ir adicionando, priorizando, e commitar em sub-grupos.

---

## Contexto

Branch dedicada pra trabalhar polish e melhorias de layout nas tabelas das páginas `/titles`, `/favorites`, `/ranking`, `/recommendations` (que compartilham o `WorkTable` em 3 delas, e usam `RankingTable` em uma).

Objetivo: melhorar **descobribilidade**, **densidade**, **consistência** e **responsividade** sem mudar lógica de cálculo. Itens conceituais profundos (filtros, ordenação) ficam fora — esses já foram cobertos pelo plano `recursive-starfish` (8/8 ✅).

### Coordenação com a Fase 1.5 (importante)

**Arquivos com risco alto de conflito** (Fase 1.5 mexe pesado — evitar nesta branch enquanto Fase 1.5 não mergear):
- [components/titles/work-status-form.tsx](components/titles/work-status-form.tsx) — Fase 1.5.2 adiciona sub-aba inteira
- [components/titles/calculation-breakdown.tsx](components/titles/calculation-breakdown.tsx) — Fase 1.5.0 já mudou labels; Fase 1.5.3 adiciona tooltip de bias
- [components/titles/work-form.tsx](components/titles/work-form.tsx)
- [app/settings/calibration/page.tsx](app/settings/calibration/page.tsx) — Fase 1.5.4 e 1.5.7 adicionam cards
- [components/settings/calibration-panel.tsx](components/settings/calibration-panel.tsx)
- [components/ai-evaluation/ai-evaluation-review-form.tsx](components/ai-evaluation/ai-evaluation-review-form.tsx)
- Settings forms (post-reading-weights, score-weights, ranking-preferences)

**Arquivos com risco médio** (mexer com cautela; rebase frequente):
- [components/titles/work-table-config.ts](components/titles/work-table-config.ts) — Fase 1.5.0 já mexeu nos labels
- [components/ranking/ranking-table-config.ts](components/ranking/ranking-table-config.ts) — idem
- [components/ranking/ranking-table.tsx](components/ranking/ranking-table.tsx) — Fase 1.5.7 vai adicionar badge sutil
- [app/titles/[id]/page.tsx](app/titles/[id]/page.tsx) — Fase 1.5.7 vai adicionar ícone perto do botão "Avaliar IA"

**Arquivos seguros** (Fase 1.5 não toca):
- [components/titles/work-table.tsx](components/titles/work-table.tsx)
- [components/titles/work-heatmap-view.tsx](components/titles/work-heatmap-view.tsx)
- [components/titles/work-compare-drawer.tsx](components/titles/work-compare-drawer.tsx)
- [components/ranking/ranking-cells.tsx](components/ranking/ranking-cells.tsx)
- [components/ranking/ranking-filters.tsx](components/ranking/ranking-filters.tsx)
- [components/ranking/mood-bar.tsx](components/ranking/mood-bar.tsx)
- [components/ranking/surprise-me-button.tsx](components/ranking/surprise-me-button.tsx)
- [components/ui/column-picker.tsx](components/ui/column-picker.tsx)
- [components/ui/score-badge.tsx](components/ui/score-badge.tsx)
- Páginas: [app/titles/page.tsx](app/titles/page.tsx), [app/favorites/page.tsx](app/favorites/page.tsx), [app/ranking/page.tsx](app/ranking/page.tsx), [app/recommendations/page.tsx](app/recommendations/page.tsx)
- Componentes NOVOS que você criar

---

## Inputs meus (categorizados)

### A. Inconsistências entre as 4 instâncias

| # | Item | Onde | Risco |
|---|------|------|-------|
| A1 | ⚠️ **Divergiram, não idênticos**: `CompareSelectionBar` (work-table, com `favoriteCount`/`onUnfavorite`) ≠ `CompareFloatingBar` (ranking, 3 props). Extração exige reconciliar favoritos — adiar. | [ranking-table.tsx:563](components/ranking/ranking-table.tsx#L563), [work-table.tsx:337](components/titles/work-table.tsx#L337) | médio (ranking-table) |
| A2 | `useMultiSelect` não é hook compartilhado — lógica copiada | ambas tabelas | médio |
| A3 | `WorkTable` serve 4 namespaces (titles, favorites, recommendations, etc.) com comportamento sutil diferente entre eles | [work-table.tsx](components/titles/work-table.tsx) | seguro |
| A4 | Sticky header behavior pode ser hook compartilhado | várias tabelas | seguro |

**Sugestão (revisada)**: extrair `useMultiSelect()` e uma barra compartilhada é possível, mas ⚠️ as duas barras **divergiram** (`CompareSelectionBar` tem favoritos/batch que a `CompareFloatingBar` não tem). Não é dedup trivial — exige reconciliar a feature de favoritos. **Adiar** até a Fase 1.5 fechar.

### B. Descobribilidade

| # | Item | Onde | Risco |
|---|------|------|-------|
| B1 | ✅ **Já feito** — header tooltips via `configLabel` em [work-table.tsx:1056](components/titles/work-table.tsx#L1056) e [ranking-table.tsx:416](components/ranking/ranking-table.tsx#L416) | configs de coluna | — |
| B2 | ✅ Badges **já têm tooltip** ([ranking-table.tsx:196-216](components/ranking/ranking-table.tsx#L196)); falta só rótulo de grupo "diferenciais" (baixo valor) | [ranking-table.tsx:195-201](components/ranking/ranking-table.tsx#L195) | baixo |
| B3 | Smart Cascade Sort sem indicador visual do que está priorizando | [ranking-filters.tsx](components/ranking/ranking-filters.tsx) | seguro |
| B4 | Mood bar não indica claramente quando há mood ativo (cor sutil ou badge?) | [mood-bar.tsx](components/ranking/mood-bar.tsx) | seguro |

### C. Densidade e legibilidade

| # | Item | Onde | Risco |
|---|------|------|-------|
| C1 | Sem toggle "compact view" (linhas com menos padding) — power users querem ver mais obras de uma vez | tabelas em geral | seguro |
| C2 | Linhas têm padding vertical generoso por default | configs / cells | seguro |
| C3 | Cabeçalho de coluna sem ellipsis consistente — pode quebrar em telas estreitas | configs / cells | seguro |
| C4 | ✅ **Feito (lote 1)** — tier "mid" solid trocado de `text-white` → `text-yellow-950` ([score-badge.tsx:62](components/ui/score-badge.tsx#L62)). Restam green/emerald/orange/red solid com branco (decisão de design — avaliar depois) | [score-badge.tsx](components/ui/score-badge.tsx) | seguro |

### D. Mobile e responsividade

| # | Item | Onde | Risco |
|---|------|------|-------|
| D1 | ✅ View "cards" **já existe** (`ViewMode "list" \| "cards"` nas duas tabelas). Resta só auto-selecionar "cards" em mobile (pendente) | tabelas em geral | seguro |
| D2 | Mood bar + surprise-me + filtros expandidos ocupam muito vertical antes da tabela aparecer | [ranking-filters.tsx](components/ranking/ranking-filters.tsx), [mood-bar.tsx](components/ranking/mood-bar.tsx) | seguro |
| D3 | Touch targets de checkbox de seleção podem estar pequenos em mobile | cells | seguro |
| D4 | Filtros colapsam mas usabilidade no toque pode estar quebrada | [ranking-filters.tsx](components/ranking/ranking-filters.tsx) | seguro |

### E. Estados vazios e loading

| # | Item | Onde | Risco |
|---|------|------|-------|
| E1 | ✅ **Feito (lote 1)** — CTA "Limpar filtros" (`router.push("/ranking")`) quando há filtros ativos | [ranking-table.tsx:343](components/ranking/ranking-table.tsx#L343) | médio |
| E2 | Loading states inconsistentes (skeleton vs spinner) entre views | várias páginas | seguro |
| E3 | Empty state quando ranking estiver carregando dados externos pode confundir | tabelas | seguro |

### F. Cores, percentis, badges visuais

| # | Item | Onde | Risco |
|---|------|------|-------|
| F1 | ✅ **Feito (lote 1)** — `Pos.%` agora colorido por faixa (emerald/amber/orange) reusando paleta do AlignmentCell | [ranking-table.tsx:236](components/ranking/ranking-table.tsx#L236) | seguro |
| F2 | Differentiator badges sem código de cor por direção (positive vs negative do critério) | [ranking-table.tsx:195](components/ranking/ranking-table.tsx#L195) | médio |
| F3 | ✅ Ver C4 — tier "mid" corrigido no lote 1; demais tiers solid pendentes de decisão | [score-badge.tsx](components/ui/score-badge.tsx) | seguro |
| F4 | Threshold cutoffs (top/alto/médio/baixo) — visual da legenda em `/preferences` está claro? | [score-color-percentiles-form.tsx](components/settings/score-color-percentiles-form.tsx) | seguro |

### G. Refactors (sem mudança visual visível, mas higiene)

| # | Item | Onde | Risco |
|---|------|------|-------|
| G1 | Extrair `<CompareFloatingBar>` pra `components/ui/` | duplicado | médio |
| G2 | Hook `useMultiSelect()` compartilhado | duplicado | médio |
| G3 | Hook `useStickyHeader()` se a lógica se repete | várias tabelas | seguro |
| G4 | ✅ **Já resolvido** — padrão de header tooltip já inline nas duas tabelas (ver B1) | configs | — |

---

## Status do backlog (atualizado após lote 1)

### ✅ Feitos no lote 1
- **E1** — CTA "Limpar filtros" no empty state de `/ranking`
- **F1** — `Pos.%` colorido por faixa
- **C4/F3** — contraste do tier "mid" do `ScoreBadge` (`text-white` → `text-yellow-950`)

### ✅ Já estavam feitos (descobertos na triagem — não precisam de trabalho)
- **B1** / **G4** — header tooltips via `configLabel` nas duas tabelas
- **B2** — differentiator badges já têm tooltip (falta só rótulo de grupo)
- **D1** — view "cards" já existe nas duas tabelas

### 🟡 Pendentes — fora do lote 1 por escopo (lotes futuros)
- **C1/C2** (compacto/densidade): feature nova, mexe no padding de list **e** cards — merece lote próprio.
- **D1 (resto)** (auto-selecionar "cards" em mobile): cards já existe; falta decidir breakpoint e se respeita escolha manual.
- **B2 (resto)** (rótulo de grupo "diferenciais"): baixo valor.

### 🔴 Pendentes — adiados por risco/baixo valor
- **A1 / A2 / G1 / G2 / G3** (refactors: barra compartilhada, `useMultiSelect`, `useStickyHeader`): barras divergiram (favoritos), risco médio sem ganho visual. Adiar até Fase 1.5 fechar.

### ⚪ Pendentes — NÃO verificados ainda (precisam de leitura antes de planejar)
- **B3** (indicador do Smart Cascade Sort), **B4** (mood ativo na mood bar), **D2/D3/D4** (vertical/touch mobile), **F2** (cor por direção nos badges), **F4** (legenda de cutoffs em `/preferences`), **E2/E3** (loading/empty states), **C3** (ellipsis no header).
  - *Por quê:* ficam em `ranking-filters.tsx` / `mood-bar.tsx` / outros que ainda não inspecionei. Podem já estar resolvidos (como B1/B2/D1) — triar antes de assumir pendência.

### 🔬 Pendência de validação (não é código) do lote 1
- Validar contraste em **dark mode** (axe/Lighthouse) do `ScoreBadge` e do percentil colorido.
- Demais tiers solid do `ScoreBadge` (green/emerald/orange/red + branco) também não batem AA estrito — decisão de design, não alterado.

---

## Itens do user

> Adicione aqui os itens da sua lista de mudanças de layout.

### Página `/titles`

- [ ] (a preencher)

### Página `/ranking`

- [ ] (a preencher)

### Compartilhados

- [ ] (a preencher)

---

## Triagem sugerida

Quando definir o que entra, classificar como:

| Prioridade | Critério |
|---|---|
| 🔴 P0 | Bug visual ou inconsistência grave que confunde uso |
| 🟡 P1 | Polish que melhora UX significativamente |
| 🟢 P2 | Nice-to-have, refactor sem impacto direto |

E agrupar em commits temáticos pequenos (evita PRs grandes e mantém revisão fácil).

---

## Sugestão de sequência

1. **Comece pelos arquivos seguros** (lista verde acima). Sem risco de conflito.
2. **Defira itens nos arquivos amarelos** (work-table-config, ranking-table-config, ranking-table) pra depois — preferencialmente após Fase 1.5.0 estar mergeada (já está).
3. **Evite tocar nos arquivos vermelhos** até a Fase 1.5 inteira fechar OU até a fase específica que mexe neles fechar.
4. **Faça rebase frequente** com `main` se a branch de implementação for avançando — minimiza chance de conflito acumular.

---

## Verificação por commit

Pra cada PR/commit visual:
- Screenshot before/after se for mudança visível
- Validar em modo escuro
- Validar em mobile (Chrome DevTools mobile view)
- `npm run build && npm run test`

---

## Métricas opcionais

Pra cada commit visual, considerar:
- "Quantas obras vejo na primeira tela" (densidade)
- "Quantos clicks pra X" (descobribilidade)
- Contraste medido em modo escuro (axe DevTools ou Lighthouse)
