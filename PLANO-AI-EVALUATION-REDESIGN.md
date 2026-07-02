# PLANO — Redesign da página `/ai-evaluation`

> Rastreamento da reforma da página de Avaliação IA (6 abas). Iniciado 2026-07-01.
> Fonte de verdade do progresso desta frente. Ver também memória
> `project_ai_evaluation_redesign`.

## Contexto & objetivos

A página `/ai-evaluation` tem 6 abas criadas em momentos diferentes → despadronizadas,
não intuitivas, com excesso de peso visual. Objetivos do usuário:

1. **Padronizar** as abas o máximo possível (todas = filtro + cards de obra) — sem
   forçar 100%, cada aba tem info específica pra apoiar a decisão.
2. **Performance** — reduzir latência/carga da página.
3. **UI mais clean** — a info é útil mas hoje "atrapalha mais que ajuda"; reduzir peso
   visual, deixar intuitiva e amigável.

## Inventário das 6 abas (estado original)

| Aba (label) | Componente | Filtro | Card | Render |
|---|---|---|---|---|
| IA atributos | `AiEvaluationPanel` (1058 L) | `AiEvaluationFilters` (compart.) | `Card` grid 2-col + `CoverThumb` | client |
| Veredito IA | `StaleRerankPanel` (267 L) | `AiEvaluationFilters` | `Card` grid 2-col + `CoverThumb` | client |
| Interesse na Obra | `SynopsisPredictPanel` (429 L) + AccuracyBar + ShadowPanel + Backfill | `AiEvaluationFilters` | `Card` grid 2-col + `CoverThumb` | client |
| Sem reviews | `SemReviewsTab` (160 L) | `SemReviewsFilters` (bespoke) | `<ul>/<li>` inline + `<img>` cru | server |
| Sem tags | `SemTagsTab` (148 L) | `SemTagsFilters` (bespoke) | `<ul>/<li>` inline + `<img>` cru | server |
| Untracked | `UntrackedStatusPanel` (163 L) | `AiEvaluationFilters` (reduzido) | `Card` grid 2/3/4-col + `CoverThumb` | client |

**Divergências:** 3 padrões de filtro, 3 padrões de card, 3 densidades de grid.
`CoverThumb` já é compartilhado (aceita `url`|`urls`).

---

## FATIA 1 — Performance (sem tocar UI) ✅ FEITA (não commitada)

Verificada: `tsc` + `lint` + **1089 testes** verdes. Ganho por construção (serial→paralelo),
**não medido ao vivo**.

**Gargalo #1:** fan-out de contadores das abas (`getAiEvalTabCounts`, `unstable_cache`
60s, invalidado em qualquer mutação de fila) rodava as 6 queries a cada cache-miss; as 2
piores (`getWorksWithoutTags`/`getWorksWithoutReviews`) paginavam `work_tags`(~28k)/
`work_reviews`/`work_external_reviews_manual` **em série** (~26 round-trips ≈ ~8s a
~300ms/trip Ohio).

**Feito:**
- [x] `fetchAllRowsParallel` em `lib/supabase/paginate.ts` — conta (HEAD `count=exact`) →
      dispara páginas em paralelo (concorrência 6), fallback pro sequencial se `count=null`.
- [x] `getWorksWithoutTags` / `getWorksWithoutReviews`: scans paralelos + arg `{countOnly}`
      (badge pula capas/external/golden/interesse/classify — o total só depende de
      status+faixa, provado); chunks external/golden paralelizados.
- [x] `getAlignmentQueueWorks`: arg `countOnly` pula join de capas (select enxuto via
      `const selectCols: string` — ternário de literais quebra o parser de tipos do
      supabase-js).
- [x] Fan-out usa `countOnly:true` nos 3 loaders.
- [x] Dedupe: `getSynopsisVersionComparison` era buscado 2× na aba Interesse (página +
      `ShadowComparePanel`) → agora passado por prop `comparison`.

**Follow-up (não feito) — o "10× de verdade":** VIEW SQL agregando count-por-obra em
`work_tags`/`work_reviews` (`GROUP BY`) → colapsa o scan em 1 call, ~constante com a escala.
Ganho na PÁGINA hoje é modesto (~0,5s; fan-out é `Promise.all`, Amdahl). Vale como fix
durável **pré-multi-user** (carga/egress) — não como urgência de latência. Precisa
migration aplicada à mão. Prefir VIEW a RPC (PostgREST lê direto). ADIADO.

---

## FATIA 2 — UI clean + padronização (UI-only) 🔨 EM ANDAMENTO

Design **travado 2026-07-01** (validado com o usuário: densidade "card enxuto 3 linhas";
Untracked = manter aba + unificar UX).

### Princípio: shell comum + slots por aba (3 tiers)

```
┌────────────────────────────────────────────────────────────┐
│ ☐ ┌───┐ Título da obra                            [ métrica ]│ ← Tier 1
│   │IMG│ <headline da aba>                    ● <estado>      │ ← Tier 1
│   │2:3│ 📖pub · 👤personal · ♥interesse · 12🏷 · 3💬          │ ← Tier 2 (texto cinza)
│   └───┘ ⋯ detalhes                            [ ação ▾ ]     │ ← Tier 3 + ação
└────────────────────────────────────────────────────────────┘
```

**Sempre visível (comum a todas):** ☐ seleção · capa · título · **nota prevista** ·
status (ÍCONE pub+personal, tooltip) · ♥ interesse · 🏷 tags · 💬 reviews · **1 chip de
estado** da aba.

**Headline (linha 2) + "⋯ detalhes" por aba:**

| Aba | Headline visível | Chip de estado | "⋯ detalhes" (expand/hover) | Ação(ões) |
|---|---|---|---|---|
| IA Atributos | — | pendente/revisar/baixa-conf/desatualizado | data aval · modelo · versão · confiança | Avaliar · Pular |
| Veredito IA | `Veredito: 7.4` | desatualizado/não avaliado | data última avaliação | Recalcular |
| Interesse | `IA sugere ♥♥♥·82%` | desatual/não-prev/diverge/bate | justificativa·Δ·versão·data · **inputs da previsão** | picker ♥ · Prever/Aplicar/Pular |
| Sem reviews | `⚠ 0 reviews úteis` | *(alerta é o headline)* | — | **Editar obra** |
| Sem tags | `⚠ 0 tags` | *(idem)* | — | **Editar obra** |
| Untracked | — | *(seleção é o foco)* | **inputs da previsão** (MESMO popover da Interesse) | picker de status |

**Simplificações:** Sem reviews/Sem tags perdem badges de fontes, "coletado em" e links
extras → sobra só "Editar obra".

### Seleção universal + ação em lote (novo requisito)

- Checkbox em **toda** aba (não é mais "modo seleção" só do Atributos).
- Barra **sticky** compartilhada ao marcar ≥1: `☑ N selecionadas [ações da aba] Limpar`.
- As ações em lote são **específicas da aba**. **"Mudar status" é opt-in — SÓ a aba
  Untracked** usa (`showStatusAction`, default false). (Revisto 2026-07-01: não é
  universal como se pensou antes.)
- Ação por-card permanece pra clique rápido de 1 obra.
- Seleção é por-aba; **limpa ao trocar de aba/filtro**.
- **Interesse:** só "Prever selecionadas" em lote (a operação cara). Aplicar/Pular
  seguem por card (evita o "Aplicar previsão" em lote duplicar o "Aplicar" do card).

### Decisões tomadas

- **Untracked:** manter aba separada (NÃO fundir na Interesse) — a query da Interesse
  exige `canonical_synopsis`; fundir sumiria com Untracked sem sinopse. Unificar só a UX.
- **Densidade:** card enxuto de 3 linhas (grid 2-col mantido).
- **Status no card:** ícone + tooltip (não abreviado) — decisão default, revisável.
- Dados comuns pesados não precisam estar visíveis por padrão, mas disponíveis
  (hover/clique/expand).

### Build order & checklist

- [x] **Infra** (`components/ai-evaluation/queue/`): `WorkQueueCard` (slots: headline,
      state, details, actions, selectable + núcleo comum), `WorkQueueGrid` (2-col +
      `dense` — agora funcional: `lg:grid-cols-3`), `QueueToolbar`+`QueueSortSelect`
      (toolbar unificada, ver abaixo), `BulkStatusAction` ("Mudar status" — só Untracked),
      `useWorkSelection`. Status = `PublicationStatusBadge`/`PersonalStatusBadge` com
      `iconOnly`. `WorkQueueSelectionBar` **removido** (substituído por `QueueToolbar`).
- [x] **Piloto: aba Interesse** (`SynopsisPredictPanel`) — batch por SELEÇÃO ("Prever
      selecionadas"); Aplicar/Pular por card; sem "Mudar status". Verificado HTTP 200.
- [x] **Propagar: IA Atributos** (`AiEvaluationPanel`) — QueueToolbar (sort primário +
      secundário), removido "Mudar status".
- [x] **Propagar: Veredito IA** (`StaleRerankPanel`) — QueueToolbar, removido "Mudar status".
- [x] **Propagar: Sem reviews + Sem tags** — **FIX: faltava `"use client"`** (usavam
      `useMemo`/`useWorkSelection` sem diretivo → quebravam em runtime). QueueToolbar,
      banner AlertTriangle → 1 linha slim, `details` pesado removido (só "Editar obra").
      `showStatusAction=false` (era `true` — leak corrigido).
- [x] **Refino Sem reviews/Sem tags (2ª passada, feedback do usuário 2026-07-02):**
      (a) **sort movido pro strip da toolbar** (`QueueSortSelect` client-side: título/
      nota/nº) e REMOVIDO da linha "Ordenar" dos filtros bespoke (não duplicar); a lista
      é a completa (sem cap server), então client-sort é equivalente. (b) **info repetida
      removida:** headline "N review(s)/tag(s)" saiu (o Nº já vem no 💬/🏷 do meta); chip
      de estado agora só p/ "sem sinopse"/"golden". (c) **botões alinhados ao padrão
      das abas polidas:** ação IA (Buscar reviews / Inferir tags) virou PRIMÁRIA filled
      (gradiente) + ícone Sparkles, no TOPO; "Editar obra" = secundária outline + SquarePen
      abaixo. `TaskButton` ganhou props `icon` + spinner-quando-ocupado + `gap-1.5`. Rótulo
      "Buscar reviews + digest" → "Buscar reviews"; `WorkQueueCard.wideActions` (trilho
      w-36). Verificado no app (200, gradiente+Sparkles no primário, sort no strip,
      headline 172→1).
- [x] **Propagar: Untracked** (`UntrackedStatusPanel`) — QueueToolbar (showStatusAction),
      grid `dense`, popover inputs-da-previsão inline (`showDetailsDirectly`).
- [x] **Perf: N+1 do taste-profile** (`SynopsisInputsPopover`) — era ~1 fetch/card;
      agora promise cacheada no módulo + fetch só ao ABRIR o popover (cards fechados = 0).
- [x] **Toolbar unificada** (`QueueToolbar`) aplicada nas 6 abas — mata os 2 padrões
      (inline nas 3 polidas × `WorkQueueSelectionBar` nas 3 simples).
- [x] `tsc` + `lint` + **1089 testes** verdes; 6 abas HTTP 200 sem marcadores de erro
      (sem-reviews/sem-tags confirmadas renderizando conteúdo). **NÃO commitado.**
- [ ] **Revisão iterativa com o usuário** (densidade do card de Interesse, veto do
      "Mudar status" removido de Atributos/Veredito).
- [x] Corrigir `loading.tsx` (skeleton não bate com o layout real). **FEITO 2026-07-02**
      (branch `feat/ai-eval-polish-perf`): espelha header + tab-strip 5-pills + filtro +
      toolbar + grid 2-col de card-skeletons.
- [x] **Sticky toolbar** — `sticky top-0 z-20` + frosted-glass na raiz do `QueueToolbar`
      (1 linha → 5 abas). Verificado no browser (fixa após scroll, sem gap).
- [x] Perf follow-up: **popover lazy FEITO** (server-action `getSynopsisInputsAction` on-open;
      tirou `getSynopsisInputsBatch` do crítico → untracked −40%, sinopse neutra pois o batch
      não era o long-pole). VIEW/RPC tag+review count = já feito na Fatia 3 (mig 122).
      **`dynamic()` = redundante** (RSC já code-splita por boundary; só o painel ativo embarca —
      confirmado). **Aba sinopse:** bottleneck medido = load de 2076 previsões (~300ms) dentro
      de `getSynopsisQueueWorks`.
- [x] **EGRESS (A) FEITO** — `justification` = **72% do payload** dessa query (medido:
      ~1650KB→~464KB, economia ~1185KB/load). Bulk de previsões dropou `justification`;
      `hydrateJustifications` busca o texto só das obras exibidas com previsão (0 na aba padrão);
      opt `countOnly` no contador pula a hidratação. Verificado: 531/531 justificativas na view
      `?sq=predicted`; tabs 200; tsc+1089 testes. Egress −72% (aba padrão + contador), −53%
      (pior view). Conta na cota do Supabase mesmo server-to-server.
- [ ] **Latência (B) DEFERIDO** — view/RPC DISTINCT-ON por obra (~1-2 linhas em vez de ~2,8);
      precisa migration à mão + medição em prod (dev noise-dominated).

---

## FUSÃO — "Sem reviews" + "Sem tags" → "Tags & Reviews" ✅ FEITA (2026-07-02)

6 abas → **5**. As duas abas de enriquecimento viraram uma só (`?tab=tags-reviews`),
por pedido do usuário. Verificado no app (173 cards = união; 172 sem reviews, 2 sem
tags, 1 com ambos; badge = activeCount bate; tsc+lint+1089 testes).

- **União por id** dos dois universos (obra com faixa de reviews OU faixa de tags),
  marcando `reviewGap`/`tagGap` por obra (usados na linha de contagem + lotes por eixo).
  Contagens 🏷/💬 já vêm hidratadas.
- **Layout do card (ajuste 2026-07-02):** trilho direito tem as **duas ações de IA
  sempre** (Buscar reviews + Inferir tags); "Editar obra" desceu pra coluna ESQUERDA
  (slot `details`, abaixo das infos) como **botão outline compacto** (`size="xs"`
  `w-fit` + SquarePen) — claramente clicável mas secundário; não mais no trilho.
- Novos: `components/ai-evaluation/tags-reviews-tab.tsx` + `tags-reviews-filters.tsx`
  (filtro merged: shared + banda reviews + banda tags). **Deletados:** `sem-reviews-tab`,
  `sem-tags-tab`, `sem-reviews-filters`, `sem-tags-filters`.
- **page.tsx:** branch `tags-reviews` (roda os 2 loaders em paralelo, une, hidrata);
  fan-out do badge une os `ids` (novo campo no `countOnly` dos 2 loaders → conta
  distintos, sem somar duplicados); tab bar 1 link; `?tab=sem-reviews`/`sem-tags`
  (URLs antigas) **redirecionam** pra aba unificada; sort `sortr`/`sortt` removido
  (agora client-side na toolbar: título/nota/nº reviews/nº tags); lotes por eixo
  (Buscar reviews em fila + Inferir tags em fila, cada um só nas obras do gap).

## FATIA 3 — Filtro/sort/batch unificados (planejada)

- Filtro único por config declarativa por aba (não empilhar mais flags no
  `AiEvaluationFilters` de 815 L; hoje Sem reviews/Sem tags usam `SemReviewsFilters`/
  `SemTagsFilters` bespoke).
- `QueueSortControl` e `QueueBatchBar` compartilhados (hoje cada painel reimplementa sort
  5/3/4 campos e batch com UX diferente).
- Mais invasiva (mexe nos 6 componentes) → por último.

---

## Fatia 3 — Filtros padronizados + Perf (2026-07-02, COMMITADA neste PR)

**Filtros unificados:**
- Casca de filtro única nas 5 abas (`AiEvaluationFilters`); `tags-reviews-filters.tsx`
  (legado, criado na fusão) deletado, dobrado na casca compartilhada.
- **Sem busca por título** em nenhuma aba (removida a que existia na Tags & Reviews).
- Disclosure **"Mais filtros"** recolhe as dimensões avançadas (previsão/versão/Δ, faixas
  numéricas) na aba Interesse.
- **Removidos** os filtros **Fonte externa** e **Golden** (a pedido).
- Tentado e **revertido** no mesmo dia: espalhar "Interesse previsto IA" como filtro
  padrão em todas as abas — o usuário decidiu que não valia (esvazia listas onde não há
  previsão). Fica só na aba Interesse, em "Mais filtros" como "Previsão da IA".

**Perf da página** (medida quente, dev):
- **RPC agregada `work_card_counts`** (migration 122, APLICADA) — contagem de tags/reviews
  por obra em SQL (GROUP BY) em vez de varrer work_tags (~30k)/work_reviews (~10k) e contar
  em JS. Fiada com **fallback TS** (padrão `get_sidebar_badge_counts`) em `getWorkTagReviewCounts`,
  `getWorksWithout{Tags,Reviews}`.
- Tags & Reviews reaproveita as contagens já computadas nos scans (dispensa re-scan);
  `getWorkTagReviewCounts` e scan de previsões paralelizados.
- Resultado: /ai-evaluation ~3.9s→~0.56s (parte da queda também é a migração do DB
  Ohio→São Paulo, ver `project_supabase_region`).

## Notas de rastreamento

- Fatias 1+2+3 **commitadas neste PR** (antes eram working tree acumulado de várias sessões).
- Repo = só `main`; migrations aplicadas à mão (CLI desync).
- Ver `feedback_verify_running_app`, `project_perf_profile`, `project_supabase_region`,
  `project_multiuser_account_area`.
