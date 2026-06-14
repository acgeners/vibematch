# SatorIA — Plano de Trabalho Consolidado

> Consolida os dois diagnósticos (geral + aprofundado) e os três tópicos prioritários
> (Comix, Saldo/badges, Deploy). Substitui os `plan-*.md` antigos como fonte de verdade.
> **Princípio orientador:** varrer resíduo (risco ~0) antes de tocar lógica viva; subir
> em produção cedo para validar latência/IA/Comix no ambiente real.

**Legenda** — Severidade: 🔴 alta · 🟡 média · 🟢 baixa/elogio. Esforço: trivial / baixo / médio / alto. Risco: ~0 / baixo / médio / alto.

---

## Sumário executivo

A fundação está **acima da média** (motor de avaliação IA com cache L1+L2, prompt caching,
regras monotônicas, auditoria com retry; pipeline ML honesto; orquestração externa com
`Promise.allSettled` + timeouts + circuit-breaker). A dívida é **datável e concentrada**:
resíduo de iterações (arquivos fantasma, dois rankers, kNN desligado), nomenclatura de notas
pela metade, e os módulos antigos grandes. **Não é qualidade irregular — é faxina pendente.**

**Ordem recomendada (ondas):**

| Onda | Tema | Por quê nesta posição |
|---|---|---|
| 0 | Resíduo & higiene | Risco ~0, destrava clareza |
| 1 | Saldo/badges em tempo real | Autocontido, baixo risco, cria o barramento que o Comix usa |
| 2 | Comix: cache não-destrutivo + robustez + alerta | Evita vazios recorrentes (não só feedback) + observabilidade; inclui resolver-hid prod-safe |
| 3 | Render & UX de catálogo | Maior esforço, contínuo: nomenclatura, virtualização, imagens, god components |
| 4 | **Deploy** (Fly ou Híbrido) | **Por último** — plataforma decidida no início, executada no fim |

---

## Status de implementação

> Plataforma de deploy recomendada: **A — Fly-only, região `iad`** (DB Supabase fica em Ohio; ver II.C).
> Migrar o DB para SP só se virar multi-user BR e o TTFB incomodar.

- [~] **Onda 0** — Resíduo & higiene
  - [x] **H1** — `work-form 2/3/.bak2` removidos + `.gitignore` (`*.bak*`, `* [0-9]`)
  - [x] **H2** — `llm-reranker.ts` (ranker órfão) removido + comentário órfão em `deep-dive-schema.ts`
  - [ ] **H3** — remover kNN morto (módulo + query + RPC `find_knn_with_user_score` + colunas `knn_score`/`knn_neighbors`) — **migration; fazer em chat dedicado**
  - [x] **H4** — docs obsoletos → `docs/archive/` (DEPLOY-ORACLE + 5 `plan-*.md` + resumo-sessao)
  - [x] **H5** — nomes `satoria-flaresolverr` alinhados (fly.toml + fly.flaresolverr.toml)
- [~] **Onda 1** — Saldo/badges tempo real (II.B) · **core concluído (1+2+4); fase 3 deferida**
  - [x] **Fase 1** — barramento tipado: `refreshChrome(patch?: ChromePatch)` + `CustomEvent<ChromePatch|null>`; acumulador no debounce (re-fetch supera patches da janela); `useRefresh`/`useChromeRefresh`/`useChromeData` propagam o patch. Aditivo/backward-compat (sem patch = re-fetch). *(typecheck + lint OK)*
  - [x] **Fase 2** — chips aplicam delta local via `onPatch`: saldo soma `balanceDeltaUsd`; sidebar soma `badgeDelta` (clamp 0) + override `recalcPending`. Patch direcionado sem `onPatch` é ignorado (chip não re-busca o que não lhe diz respeito — AccountChip).
  - [x] **Fase 4** — TTL 60s no saldo (era 0); re-fetch forçado (evento sem patch) ignora o TTL, então mutações mantêm saldo/badge frescos; o TTL só limita re-fetch por navegação pura.
  - [ ] **Fase 3** — *(deferida)* push de delta na avaliação IA. ROI fraco: a fase 4 já força re-fetch após mutações; o delta de saldo exigiria threadear custo `service.ts`→`triggerAiEvaluation` (hoje não retorna usage) → client, por ganho de ~300ms ao fim de uma op de ~60s; deltas de badge são exatos só em pular single/selecionadas. A infra já suporta — qualquer mutação rápida futura faz `refresh({...})` e ganha o update otimista.
- [~] **Onda 2** — Comix (II.A) · **Fase 0 substancialmente completa** (0.1/0.2/0.3b/0.4/0.5 ✅; 0.3a otimização adiada). **Fase 5 (resolver-hid na criação) — metade dev FEITA**: `createWork` dispara `resolveComixHidForWork(workId)` ([comix-resolver.ts](server/actions/comix-resolver.ts)) via `after()` → spawn de `resolve-comix-hids --work <id>` (flag novo no script). Falta o pé **prod-safe** (GitHub Action com Chrome) — entra no deploy (Onda 4). **II.A fase 1 (ComixGate) FEITA**: `lib/external/comix-gate.ts` — estado único observado (`getComixStatus()` deriva `ok/degraded/down/unknown` de `recordComixOk`/`recordComixFailure` fiados no choke point `logComixFailure` do comix.ts + circuito do FlareSolverr). Passivo (sem rede); dono do tipo `ComixFailure`. **II.A fase 2 (telemetria) FEITA**: migration `098_external_source_health.sql` (1 linha/fonte, RLS sem policies — **aplicar via `supabase db push`**); `lib/external/source-health-store.ts` (`upsertSourceHealth`, best-effort/engole-erro/tolera migration não-aplicada); o gate persiste fire-and-forget só em mudança de estado ou heartbeat 5min, via dynamic import (mantém server-only fora do bundle client). **II.A fase 3 (notificação ativa) FEITA**: (1) indicador no chrome — `getSidebarBadgeCounts` agrega `comixHealth` (in-memory `getComixStatus().state`, sem mexer no RPC/migration), sidebar mostra alerta discreto (down=fora/rose, degraded=instável/amber) linkando /settings; (2) toast por lote — `getComixHealthStatus()` action + `notifyIfComixImpaired` no painel após `runBatch`. **II.A fase 4 (cache do internalId) ADIADA — baixo ROI**: a sessão do FlareSolverr já amortiza o solve quente (<1s) e a F0.2/F0.3 cortaram a frequência de fetch; o gate já é preciso (fase 1 instrumentou os fetches de baixo nível, então o `{status}` é redundante); cachear o internalId exigiria migration + mudar o shape do candidato + persist-back + backfill de 683 obras por ganho marginal. **Onda 2 dada por concluída no essencial.**
  - [x] **F0.1** — `saveWorkReviews` não-destrutivo: merge por fonte, conjunto vazio = no-op, `replace` opcional; resumo recomputado sobre o conjunto completo. *(typecheck + lint OK)*
  - [x] **F0.2** — Aquisição na borda (extração desacoplada da avaliação). Novo helper `acquireAndPersistWorkReviews` ([lib/external/acquire-reviews.ts](lib/external/acquire-reviews.ts), só caminho por IDs aceitos, sem title-search na borda). **Atualizar dados:** `updateWorkExternalData(id, updates, { acquireReviews:true })` via `after()` (opt-in; **enrich em massa NÃO dispara**). **Criar:** `createWork` extrai na borda via `after()` quando criada SEM avaliar (com avaliação, reusa o pool que o Path B já buscou — sem double-fetch). *(typecheck + lint OK)*
  - [~] **F0.3** — Consumo com fallback. **(b) robustez FEITA**: a avaliação usa o pool persistido (`loadWorkReviewsAsSourced` em [persist-reviews.ts](lib/external/persist-reviews.ts)) quando a busca fresca volta vazia ([ai.ts](server/actions/ai.ts), guarda `usedPersistedFallback` → não re-grava nem avalia sem reviews). Só atua no caminho de FALHA → caso de sucesso intocado, `input_hash` do cache preservado. *(typecheck + lint OK)* **(a) otimização ADIADA** (skip-scrape quando DB fresco): ganho marginal (o cache L1 do contexto, ~5min, já mata o double-scrape "atualizar dados→avaliar" porque a F0.2 popula a MESMA chave); risco real ao **`input_hash`** (L2 inclui `sourcedReviews` com `matchScore` a **3 casas** e ordem do array — mas `work_reviews` grava a **2 casas** e reordena; reconstruir do DB muda o hash → cache miss). Fazer (a) exige casar casas/ordem/seleção.
  - [x] **F0.4** — *(intent revisado pelo user: separar EXTRAÇÃO da avaliação + EXIBIR após criar/atualizar, não durante o dialog)*. Extração desacoplada coberta por F0.2 (criar+atualizar). Exibição pós-criação/atualização = F0.5 (página da obra). Preview DENTRO do dialog descartado: o pool só existe no instante do `onSelect()`/close ([external-search.tsx:432](components/titles/external-search.tsx#L432)), exigiria nova fase num god component (U2) — baixo valor ante a F0.5.
  - [x] **F0.5** — Exibir na página da obra sem esperar a avaliação. **Grátis com F0.2**: [app/titles/[id]/page.tsx](app/titles/[id]/page.tsx#L189) já busca `getWorkReviews` + renderiza `WorkReviewsCard` independente da avaliação → reviews da borda aparecem no próximo load.
- [~] **Onda 3** — Render & UX (em andamento) · U1 nomenclatura · E3 virtualização · E4 imagens · E1 sources prop · E2 chunked→RPC · U2 god components
- [ ] **Onda 4** — Deploy

---

## Registro da sessão 2026-06-13 (e estado para o próximo chat)

**Branch:** `feat/realtime-chrome-refresh`. **Entregue e COMMITADO** (typecheck + lint limpos em todos):
- `26f1250` **Onda 1 core** (saldo/badges tempo real: barramento tipado + delta otimista + TTL 60s).
- `89887cf` **Comix Fase 0/5** (reviews na borda + fallback persistido + resolver-hid na criação).
- `591bb11` **ComixGate** (Fase 1) · `ce5fe87` **Telemetria** (Fase 2) · `d44d7e0` **Notificação** (Fase 3) · commits de docs.

**Itens ADIADOS (com justificativa registrada acima):**
- **Onda 1 / Fase 3** (push de delta na avaliação IA) — ROI fraco; infra já suporta opt-in futuro.
- **Comix F0.3a** (skip-scrape quando DB fresco) — risco ao `input_hash`; L1 já cobre o caso comum.
- **Comix F0.4 preview no dialog** — pool só existe no instante do close; F0.5 já exibe na página.
- **Comix Fase 3 contagem exata "N obras"** — toast por-lote já cumpre o "não-silencioso".
- **Comix Fase 4** (cache internalId) — baixo ROI (sessão amortiza solve; gate já preciso).

**PENDÊNCIAS DE AÇÃO (humano):**
- ⚠️ **Aplicar a migration `098_external_source_health.sql`** (`supabase db push`/dashboard). Até lá o upsert de telemetria é no-op silencioso (não quebra nada).
- **Resolver-hid prod-safe** (GitHub Action com Chrome) — fica para a Onda 4 (deploy); hoje só o caminho dev.
- **WIP pré-existente NÃO-commitado** (~35 arquivos de sessões anteriores: `app/*`, `ranking-filters`, **gerados** `criteria.ts`/`types/domain.ts`, deploy `fly.toml`/`DEPLOY-FLY.md`, `comix-health-panel.tsx`) — deixado intocado; tratar à parte (inclui arquivos gerados — não commitar sem revisar).
- **H3** (remover kNN morto) — migration; fazer em **chat dedicado**.

**Onda 3 — recomendação de ordem (próximo chat):**
1. **E1** (sources como prop) — quick win, risco ~0; aquece.
2. **U1** (nomenclatura de notas) — MAIOR atrito de UX, mas **começa por uma DECISÃO do usuário**: qual termo único voltado ao usuário adotar (provável: "Nota Prevista"/`expected_score`, aposentando "Nota.IA/Pr/Calc/Final" em ~10 componentes). Ver [[architecture_score_layers]].
3. Depois E3 (virtualização) · E4 (imagens) · E2 (chunked→RPC) · U2 (god components, incremental/alto esforço).

---

## Parte I — Inventário consolidado dos diagnósticos

### I.A — Higiene & coerência (resíduo, risco ~0)

| # | Item | Onde | Ação recomendada | Sev | Esforço |
|---|---|---|---|---|---|
| H1 | 3 arquivos fantasma do work-form (216 KB, 2 sem extensão — armadilha Turbopack do CLAUDE.md) | `components/titles/work-form 2`, `work-form 3`, `work-form.bak2` | `git rm` + adicionar `*.bak*` e `* [0-9]` ao `.gitignore` | 🔴 | trivial |
| H2 | Ranker morto: `rankCandidates` sem nenhum caller (duplica `rankFavorites`) | [llm-reranker.ts](lib/ai-recommendation/llm-reranker.ts) | apagar o arquivo | 🔴 | trivial |
| H3 | kNN-preditor desligado: zero callers, `knn_score/knn_neighbors` gravados `null` | [knn-predictor.ts](lib/ml/knn-predictor.ts), [knn-neighbors.ts](server/queries/knn-neighbors.ts), RPC `find_knn_with_user_score`, colunas em `calculated_scores` | remover módulo + query + RPC + colunas (migration) | 🟡 | baixo |
| H4 | Docs obsoletos/conflitantes | `DEPLOY-ORACLE.md` (abandonado), `plan-*.md`, `resumo-sessao-notas.md` | arquivar em `docs/archive/` ou apagar; este `PLANO.md` os substitui | 🟡 | trivial |
| H5 | Nomes de deploy divergem | [fly.toml](fly.toml) `satoria` vs `vibematch-flaresolverr` | padronizar `satoria-flaresolverr` | 🟢 | trivial |

> **Nota — não confundir com resíduo:** os **embeddings OpenAI** (`text-embedding-3-small`)
> **são usados** (RPC `find_similar_works` → deep-dive, similar-works, e o bloco `similarWorks`
> do prompt de avaliação). Só o **kNN-preditor** (H3) é morto. Não remover embeddings junto.

### I.B — Eficiência & render

| # | Item | Onde | Ação recomendada | Sev | Esforço |
|---|---|---|---|---|---|
| E1 | `fetch("/api/sources")` no client a cada abertura de form | [work-form.tsx:737](components/titles/work-form.tsx#L737) | resolver no server e passar como prop (`/titles/new` já é server) | 🟡 | baixo |
| E2 | `chunkedInQuery` contorna limite de URL do PostgREST (500+ UUIDs no client) | [ai-evaluation/page.tsx:100](app/ai-evaluation/page.tsx#L100) | mover para RPC server-side (padrão da migration 089) | 🟡 | médio |
| E3 | Ranking sem virtualização (`.limit(2000)`, ~660 linhas renderizadas de uma vez) | [ranking.ts:419](server/queries/ranking.ts#L419), [ranking-table.tsx](components/ranking/ranking-table.tsx) | TanStack Virtual ou paginar (como a work-table já faz) | 🟡 | médio |
| E4 | Imagens não otimizadas (sem `next/image`; proxy passthrough sem resize; sem `width/height` → CLS) | [cover-image.tsx](components/ui/cover-image.tsx), [image-proxy/route.ts](app/api/image-proxy/route.ts) | resize no proxy (`?w=`) + dimensões fixas no `CoverImage` | 🟡 | médio |
| E5 | 6 actions de rerank repetem gate→perfil→candidatos→`rankFavorites`→upsert→4×`revalidatePath` (21 no arquivo) | [recommendations.ts](server/actions/recommendations.ts) | extrair `rerankAndPersist(ids, opts)` — fonte única dos paths/upsert | 🟡 | médio |
| E6 | Chat custa até 3 chamadas Sonnet/turn (refresh perfil + decisão de tool + rank/eval) | [recommendation-chat.ts:240](server/actions/recommendation-chat.ts#L240) | aceitável (gate pago + rate-limit + cache); só monitorar | 🟢 | — |

### I.C — UX & layout

| # | Item | Onde | Ação recomendada | Sev | Esforço |
|---|---|---|---|---|---|
| U1 | Nomenclatura de notas dividida: "Nota Prevista"/`expected_score` (novo) × "Nota.IA/Pr/Calc/Final" (legado) em ~10 componentes | work-table, calculation-breakdown, ranking-table-config, work-heatmap, calibration-panel, ai-evaluation-review-form… | finalizar a migração fase-C: **um** termo voltado ao usuário | 🔴 (maior atrito de UX) | médio |
| U2 | God components (manutenção + bundle client) | UI: [work-form.tsx](components/titles/work-form.tsx) 2473, [ranking-filters.tsx](components/ranking/ranking-filters.tsx) 2222, [work-compare-drawer.tsx](components/titles/work-compare-drawer.tsx) 1753, [tag-consolidation-client.tsx](components/settings/tag-consolidation-client.tsx) 1618, [work-table.tsx](components/titles/work-table.tsx) 1412, [external-search.tsx](components/titles/external-search.tsx) 1353. Server/lib: [external/index.ts](lib/external/index.ts) 1942, [works.ts](server/actions/works.ts) 1762 | modularizar incrementalmente (filtros→hooks/reducer; index→connectors-merge vs context-building) | 🟡 | alto |

> **Forte (não mexer):** páginas todas server-components; 11 `loading.tsx`; `optimizePackageImports`;
> sidebar com badges via barramento+TTL+coalescing; deep-dive decomposto em ~9 componentes pequenos.

---

## Parte II — Os três grandes (detalhado)

### II.A — Comix: robustez + notificação ativa

**Diagnóstico:** toda chamada passa por FlareSolverr (CF desafia tudo desde 2026-06-12).
Falhas morrem em `console.error` (logado 1×/processo) + retorno vazio → **100% silencioso**.
Três circuit-breakers descoordenados. Cadeia de reviews frágil (scraping de hidratação SSR).
Resolver de hid usa Puppeteer/Chrome local → **quebra em prod**.

**Recomendação:** separar duas frentes — (1) **reduzir o vazio de fato** e (2) **dar
visibilidade** quando ele ocorrer. A causa raiz do "dados vazios" tem dois componentes: a
falha transitória do Cloudflare/FlareSolverr no momento do fetch (nenhum feedback resolve), e
— descoberto na análise — a **ausência de fallback somada a um snapshot destrutivo**.

> ⚠️ **Bug latente de robustez:** [saveWorkReviews](lib/external/persist-reviews.ts#L13) faz
> *delete-tudo + re-insert*. Se uma re-avaliação volta com o Comix falho, ela **apaga as
> reviews boas** salvas de uma busca anterior (e se todas as fontes falham, zera tudo + o
> `review_summary`). E a avaliação **não lê `work_reviews` como fallback** — usa só o fetch
> fresco. Uma falha transitória do CF, hoje, **empobrece o dado já persistido.**

**Fase 0 — Separar AQUISIÇÃO de CONSUMO de reviews (a que REALMENTE evita vazio):**
Hoje quem busca reviews é a *avaliação* ([ai.ts:203](server/actions/ai.ts#L203) e o pool do Path B
persistido no createWork); "atualizar dados" **não** re-busca. Inverter: adquirir na **borda**
(criar / "usar dados" / "atualizar dados") e a avaliação só **consome**.
- **Persistência não-destrutiva:** [saveWorkReviews](lib/external/persist-reviews.ts#L13) faz
  **merge por fonte** — nunca remove reviews de uma fonte ausente nesta rodada nem troca snapshot
  rico por vazio/menor (corrige o *delete-tudo* atual).
- **Aquisição na borda:** criar/atualizar dados busca + persiste (a criação já carrega o pool do
  Path B; falta cobrir "atualizar dados").
- **Consumo com fallback:** a avaliação lê `work_reviews`; só busca se vazio/stale. Conteúdo
  idêntico → o `input_hash` do cache de avaliação continua coerente.
- **Exibir cedo:** [getWorkReviews](server/queries/work-reviews.ts#L44) já lê `work_reviews`
  **independentemente da avaliação** → popular na borda faz as reviews aparecerem na página da obra
  assim que criada. E na tela de "Buscar/Atualizar dados" o pool já está no client
  ([external-search.tsx:432](components/titles/external-search.tsx#L432)) — exibi-lo ali é só UI.
- **Efeito:** o scraping (caro/frágil) roda **uma vez** na borda; a avaliação fica mais rápida
  (corta a cauda de fetch) e robusta; após o 1º sucesso a obra não volta vazia. Independe do
  Cloudflare. *Risco: médio (toca persistência + fluxo). Nuance: definir frescor (TTL/botão) e
  o caso de import em massa (deferir/batch para não scrapar N obras de uma vez).*

1. **`ComixGate` — estado único** *(feedback)* — consolida os 3 breakers ([flaresolverr.ts:20](lib/external/flaresolverr.ts#L20), [comix.ts:58](lib/external/comix.ts#L58), rede) em `lib/external/comix-gate.ts` com `getComixStatus()`. *Risco: baixo.*
2. **Telemetria persistente** *(feedback)* — migration `external_source_health(source, status, last_ok_at, last_fail_at, fail_reason, consecutive_fails)`; upsert *fire-and-forget*. *Risco: baixo.*
3. **Notificação ativa** *(feedback — o "não-silencioso")*: indicador no chrome (estende `get_sidebar_badge_counts`) + toast por lote ("N obras avaliadas sem reviews da Comix"). *Risco: médio.*
4. **Cache do `internalId`** *(reduz vazio: −1 solve = −1 ponto de falha)* em `work_external_ids`; retorno `{status, reviews}` distinguindo "vazio" de "falhou". *Risco: médio.*
5. **Resolver de hid prod-safe** *(reduz vazio por cobertura: obra sem hid nem tenta)* — o **hid é o cache do matching** "nome→obra do Comix": o Chrome interativo (Puppeteer) busca por nome + casa o título **uma vez** e persiste; as reviews seguintes vão **direto** pelo hid (token-free via FlareSolverr), sem re-casar título a cada chamada (mais leve e sem risco de pegar a obra errada). Rodar por nome+clique a cada avaliação seria caro e ambíguo. Mover [resolve-comix-hids.mjs](scripts/resolve-comix-hids.mjs) para **GitHub Action agendado** (runners têm Chrome) e/ou rodar a resolução **na criação da obra** (borda). *Risco: baixo-médio.* **← também pré-req do Deploy.**

**Classificação honesta:** Fases **0, 4 e 5 reduzem o vazio**; Fases **1–3 só dão visibilidade**.
Contra a falha do *primeiro* fetch, nada é 100% (depende do CF) — mas a Fase 0 transforma
"vazio recorrente" em "no máximo vazio na primeira vez".

**Ordem interna:** 0 → 1 → 2 → 3 → 4 → 5.

> **Ferramenta de scraping — manter o FlareSolverr.** Ele já resolve o CF challenge (com sessão:
> solve frio ~11s, depois <1s). O gargalo é **arquitetura** (Fase 0) e **cobertura de hid**
> (Fase 5), não o scraper. Trocar por Playwright/Puppeteer-no-servidor é mais pesado/código com
> ganho incerto sobre o CF; só compensa se o CF endurecer a ponto do FlareSolverr falhar de forma
> consistente (e ainda assim Playwright+stealth > serviço pago, por custo). Onde um browser
> interativo *de fato* ajuda — a **busca** (gera o token `_=`) — já está coberto pela Fase 5
> (Puppeteer nos runners do GitHub Action, grátis). A plataforma (Fly) não altera essa escolha.

### II.B — Saldo/badges: tempo real sem re-buscar

**Diagnóstico:** [refreshChrome()](lib/chrome-refresh.ts#L27) dispara evento **sem payload** →
toda mutação = 2 round-trips ao DB Ohio (~900ms). Saldo sem TTL (re-busca a cada navegação).

**Recomendação:** evento com payload + atualização otimista; DB só para reconciliação. Fases:

1. **Barramento tipado** (aditivo, backward-compatible): `refreshChrome(patch?: ChromePatch)`,
   `CustomEvent<ChromePatch>` onde `ChromePatch = { balanceDeltaUsd?, badgeDelta?, recalcPending? }`. Sem patch = re-fetch (comportamento atual). *Risco: baixo.*
2. **Chips aplicam delta local** ([use-refresh.ts](lib/use-refresh.ts), [balance-chip.tsx](components/layout/balance-chip.tsx), [sidebar.tsx](components/layout/sidebar.tsx)) sem fetch. *Risco: médio.*
3. **Mutações empurram delta.** Avaliação: `refresh({ badgeDelta:{aiEval:-1}, balanceDeltaUsd:-custo })` — custo do `usage` retornado + [pricing.ts](lib/ai/pricing.ts). Mutações que não sabem o novo count seguem com patch vazio (re-fetch). *Risco: médio.*
4. **Reconciliação:** TTL 60s no saldo (hoje 0). Delta cobre o intervalo; navegação corrige a deriva. *Risco: baixo.*

**Ordem interna:** 1 → 2 → 4 (já corta re-fetch) → 3 (deltas, incremental).
**Trade-off:** custo estimado ≠ faturado → leve drift, corrigido pela reconciliação.

### II.C — Deploy

**Restrição-chave:** o FlareSolverr não pode dormir (a sessão `cf_clearance` morre) → `min=1`
24/7 é o piso de custo. O app pode dormir (auto-stop).

| | A) Fly-only | B) Oracle AMD | C) Híbrido (app Fly + FS Oracle) |
|---|---|---|---|
| **Custo/mês** | ~$6–8 | **$0** | ~$1–2 |
| IA >60s | risco idle-timeout do proxy (testar) | VM pura, sem timeout | risco do app no Fly |
| FlareSolverr | interno (flycast) ✓ | interno (VCN) ✓ | **público + auth** (código novo) ⚠️ |
| RAM/Chromium | folgado (1GB) | **apertado** (1GB c/ SO) | folgado (Oracle) |
| Manutenção | gerenciada ✓ | manual (TLS/SO/patches) | mista |
| Setup | ~1–2h (configs prontas) | ~1–2 dias | ~½–1 dia |
| Capacidade | sem loteria | **AMD sem loteria** (foi o ARM/A1 que derrubou) | sem loteria |

**Recomendação final (foco em qualidade + eficiência): A (Fly-only), região `iad`.**
- **Eficiência real = latência de DB:** app em `iad` fica ~10–20ms do Supabase (Ohio) vs ~300ms
  hoje — afeta **toda** navegação (o app é pesado em queries). O delta de custo (~$5–7/mês) é
  ruído ao lado do saldo Anthropic que o app já consome.
- **Qualidade:** FlareSolverr **interno** (flycast, sem hop extra no caminho do scraping, sem
  exposição pública), TLS automático, plataforma gerenciada, 1 provedor → menos pontos de falha.
- **Por que não C (Híbrido):** economiza ~$5/mês mas adiciona latência app↔FlareSolverr
  (cross-provider), superfície (FS público + auth) e um ponto de falha **no caminho crítico do
  scraping** — pior em qualidade e eficiência. Só vale se "$0" for inegociável; aí B (Oracle AMD).
- *Afinação posterior:* testar FlareSolverr em 512MB (~$3–4/mês) se quiser cortar, com risco de OOM.

**Região do DB (Supabase):** o que mata performance é **app e DB em regiões diferentes** (a dor
atual de ~300ms é dev-BR↔DB-Ohio). O usuário só fala com o *app* (HTTP); as queries são app↔DB.
Logo o par precisa ficar **junto**. Duas configurações boas: (A) **app `iad` + DB Ohio** (atual,
**zero migração**, queries ~10-20ms, TTFB BR→app ~120-150ms); (B) **app `gru` + DB `sa-east-1`**
(migrar o Supabase p/ SP, queries ~10-15ms **e** TTFB BR ~10-30ms). **(B) só compensa se o público
é firmemente BR e o TTFB inicial incomoda** — e exige migrar o projeto Supabase (criar projeto em
sa-east-1 + dump/restore + trocar URLs; risco/downtime). **Nunca** mover só o DB para SP deixando o
app em `iad` (volta ao cross-region). Para agora: **(A)** — sem migração; reavaliar (B) se virar
multi-user BR e o TTFB pesar. *(Anthropic/OpenAI são US: de `gru` somam ~100-150ms/chamada, irrelevante ante os ~60-78s da avaliação.)*

**Pré-reqs (Onda 0):** resolver-hid via GitHub Action (II.A.5); alinhar nomes (H5); limpar
`docker-compose.yml`+`Caddyfile` se for A.

**Passos (cenário A):** `fly launch` ×2 → `fly secrets set` → `fly deploy` → checklist Fase 4 do [DEPLOY-FLY.md](DEPLOY-FLY.md) (abrir app; **avaliação IA até o fim ~78s**; FlareSolverr sem `flaresolverr_unavailable`; Comix detalhe/reviews; latência de DB).

**IA >60s — risco real = idle-timeout do fly-proxy** (server actions não streamam → ~78s de
silêncio). Mitigação robusta se cortar: migrar a avaliação para **disparo + polling de status**
(mesmo padrão do `startComixResolver`) — resolve o timeout **e** sobrevive a refresh de página.

---

## Parte III — Roadmap priorizado (com dependências)

### Onda 0 — Resíduo & higiene · risco ~0, 1 leva
- H1 (work-form fantasma) · H2 (llm-reranker) · H3 (kNN morto) · H4 (docs) · H5 (nomes deploy)
- *(opcional)* E5 (`rerankAndPersist`) — barato e tira boilerplate antes de mexer no resto

### Onda 1 — Saldo/badges tempo real · autocontido, baixo risco
- II.B fases 1→2→4→3. Entrega o barramento tipado que a Onda 2 consome.

### Onda 2 — Comix: cache não-destrutivo + robustez + alerta · usa o barramento da Onda 1
- II.A fase **0** (persistência não-destrutiva + fallback — a que evita vazio) → 1→2→3→4→5
- Fase 5 (resolver-hid → GitHub Action) é também pré-req do Deploy

### Onda 3 — Render & UX de catálogo · maior esforço, contínuo
- U1 (nomenclatura de notas — maior atrito de UX) · E3 (virtualização) · E4 (imagens)
- E1 (sources como prop) · E2 (chunked → RPC)
- U2 (quebrar os god components — lista completa na Parte I.C)

### Onda 4 — Deploy · por último; plataforma decidida no início, executada agora
- Cenário **A (Fly)** ou **C (Híbrido)** — se **C**, incluir o auth do FlareSolverr (idealmente já na Onda 2)
- Pré-reqs já prontos: resolver-hid (Onda 2 fase 5), nomes (Onda 0)
- Subir; validar **IA >60s** e Comix em prod; se o proxy cortar a IA → migrar para polling

> **Decidir a plataforma agora** trava a expectativa; só é *necessário* cedo se for **C**
> (para contemplar o auth do FlareSolverr na Onda 2 e evitar 2ª passada). Se for **A**, a
> decisão pode esperar o fim — nada antes da Onda 4 depende dela.

---

## Parte IV — Riscos transversais & decisões pendentes

- **Decisão pendente:** plataforma de deploy (A Fly ~$6–8 vs C Híbrido ~$1–2). Só a Onda 4 depende disto; decidir cedo só importa se for **C** (auth do FlareSolverr entra na Onda 2).
- **Schema:** Ondas 3 (telemetria, `internalId`) e H3 (remoção kNN) exigem migrations — agrupar e rodar via `sync-constants`/migrations com cuidado (nunca hand-edit dos arquivos gerados).
- **Drift do saldo otimista** (Onda 2): mitigado pela reconciliação por TTL.
- **IA >60s** (Onda 1): se o proxy cortar, polling é a saída robusta — replanejar a UI da avaliação.
- **Não regredir o forte:** cache de avaliação, prompt caching, circuit-breakers, server-components — manter intactos ao mexer no entorno.
- **Fora de escopo desta análise (não auditado):** a *qualidade* das predições (MAE real) e das recomendações/chat — só avaliei arquitetura, fluxo e custo. Elogios (cache L1+L2, prompt caching, orquestração externa, `expected.ts`, deep-dive componentizado) não viraram tarefas — entram em "não regredir o forte". Sinais que classifiquei como não-problemas (ex.: 152/177 `use client` — folhas interativas; páginas são server) também ficaram de fora de propósito.
