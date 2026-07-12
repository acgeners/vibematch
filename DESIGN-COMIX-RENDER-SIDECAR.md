# Design Doc v2 — `comix-render` sidecar + `resolveComixUrl`

**Status:** aprovado (arquitetura) + ajustes v2 incorporados
**Objetivo:** eliminar a URL manual do Comix. Entrada = `{ title, anilistId?, malId?, mangaUpdatesId? }` → saída = `{ hid, url }` da obra, que alimenta o pipeline SSR já existente (inalterado).

**Fatos que fundam o design (todos comprovados ao vivo):**
- Busca do Comix = API gateada por token `_=` que **assina a query inteira** (reescrever qualquer
  param → `403`, comprovado). Só um browser executando o app produz um token válido.
- FlareSolverr é incapaz (sem `waitForSelector`/`delay`/`networkidle`; devolve DOM em `loading`).
- **Melhor superfície = navegação direta** `GET /browse?q=<título>&sort=relevance:desc`. O app dispara
  `GET /api/v1/manga?order[relevance]=desc&page=1&limit=28&keyword=…&content_rating[]=…` (**28
  candidatos, rankeados por relevância, keyword honrado, token válido**). **Sem digitar nada.**
  - ⚠️ `sort=relevance:desc` é obrigatório: sem ele o `/browse` cai no default `chapter_updated_at`
    e **ignora o keyword** (devolve as mais recentes).
- Cada item traz `hid`, `url` (`/title/{hid}-{slug}`), `title`, `altTitles`, `links{al,mal,mu,md,mb}`.
- `/title/{hid}` resolve mesmo com slug errado → **o `hid` é a chave**; a `url` é conveniência.

**Mudanças da v1 → v2** (ajustes aprovados): `BrowserContext` por request (isolamento auto);
`MAX_CONCURRENCY` via env; cache guarda `{ hid, url }`; `limit` default **12** (app entrega 28
nativos, retornamos o topo `limit`); resposta com bloco `meta`; `/metrics` mantido; `test:live`
mantido; **navegação direta substitui a digitação** (mais simples/robusto que a v1).

---

## 1. API do sidecar

Serviço HTTP stateless ao lado do FlareSolverr (Docker no Fly). Endpoints:

| Método | Rota | Uso |
|---|---|---|
| `POST` | `/resolve` | resolve candidatos a partir do título |
| `GET` | `/health` | liveness p/ Fly healthcheck (não abre browser) |
| `GET` | `/metrics` | contadores/histogramas (texto Prometheus) |

### Request — `POST /resolve`

```jsonc
{
  "title": "I Adopted the Protagonist, and the Genre Changed", // OBRIGATÓRIO
  "anilistId": 200573,        // opcional — RESERVADO (ignorado na v1)
  "malId": 191605,            // opcional — RESERVADO (ignorado na v1)
  "mangaUpdatesId": "iwqx86g",// opcional — RESERVADO (ignorado na v1)
  "limit": 12                 // opcional (default 12, máx 28 — app entrega até 28)
}
```
> Os IDs entram no contrato **agora** mesmo sem uso, pra permitir mover a desambiguação
> pra dentro do sidecar no futuro sem quebrar compatibilidade entre serviços.

### Response — sucesso (`200`)

Sidecar **burro**: devolve `items` crus (ordem de relevância do Comix). Quem casa/escolhe é o app.

```jsonc
{
  "ok": true,
  "items": [
    {
      "hid": "3ezr0",
      "url": "/title/3ezr0-i-adopted-the-protagonist-and-the-genre-changed",
      "title": "I Adopted the Protagonist, and the Genre Changed",
      "altTitles": ["악역의 육아는 로맨스 판타지"],
      "links": {                                    // passthrough cru (URLs completas)
        "al": "https://anilist.co/manga/200573/",
        "mal": "https://myanimelist.net/manga/191605/",
        "mu": "https://www.mangaupdates.com/series/iwqx86g/",
        "md": null
      }
    }
    // … até `limit` itens
  ],
  "meta": {
    "query": "i adopted the protagonist and the genre changed", // normalizado, o q enviado
    "elapsedMs": 1882,
    "totalCandidates": 28,   // quantos o Comix devolveu ANTES do slice p/ `limit`
    "source": "comix:browse-relevance" // estratégia usada (p/ debug se mudar no futuro)
  }
}
```
> `totalCandidates` vs `items.length` é o sinal de debug-chave: se `totalCandidates=28` mas a obra
> certa não veio, é miss de **ranking** (obra > posição 28), não falha de fetch.

### Response — sem resultado (`200`, **não** é erro)

```jsonc
{ "ok": true, "items": [], "meta": { "query": "obra inexistente", "elapsedMs": 1450, "totalCandidates": 0, "source": "comix:browse-relevance" } }
```

### Response — erro

```jsonc
{ "ok": false, "error": "render_timeout", "detail": "waitForResponse excedeu 8000ms", "meta": { "elapsedMs": 8200, "source": "comix:browse-relevance" } }
```

| HTTP | `error` | Quando |
|---|---|---|
| 400 | `bad_request` | `title` ausente/vazio |
| 502 | `upstream_blocked` | Cloudflare desafiou / API 403 dentro do browser |
| 502 | `no_xhr` | navegou mas o XHR de busca não apareceu (UI/rota do Comix mudou) |
| 503 | `busy` | fila cheia / espera de concorrência estourou |
| 504 | `render_timeout` | navegação ou XHR não completou no teto |
| 500 | `internal` | crash de browser / erro não classificado |

---

## 2. Contrato

**Request — obrigatório:** `title` (string não-vazia). **Opcionais/reservados:** `anilistId`, `malId`, `mangaUpdatesId`, `limit`.

**Response top-level — sempre presentes:** `ok` (bool); em sucesso `items` (array, pode ser `[]`) + `meta`; em erro `error` (enum) + `meta.elapsedMs`.

**Por item — garantidos (nunca null):** `hid`, `url`, `title`.
**Por item — podem faltar/ser null:** `altTitles` (`[]` se ausente), `links` (`{}` se ausente), e **cada** id dentro de `links` pode ser `null`.

**Invariante-chave:** todo item tem `hid` (a única coisa que o SSR exige). `url` é conveniência —
o app persiste **os dois** (ver §6) pra ficar imune a mudança de formato de URL.

**Idempotência:** `/resolve` é read-only, sem efeitos colaterais → seguro pra retry.

### Estabilidade do contrato (fronteira entre os dois projetos)

**O contrato é o único acoplamento permitido entre app e sidecar.** Ele é considerado **estável**:
o que o app conhece e depende é **exclusivamente** o payload HTTP desta seção (request `{ title,
anilistId?, malId?, mangaUpdatesId?, limit? }` → response `{ ok, items[], meta }` / `{ ok:false,
error, meta }`).

**NÃO fazem parte do contrato** — são detalhes internos do sidecar e **podem mudar a qualquer
momento sem alterar o app**, desde que o payload permaneça compatível:

- o mecanismo de render (`goto` vs `type`, `browse` vs autocomplete, seletor, debounce);
- o intercept do XHR (qual endpoint interno do Comix é escutado, `order[relevance]`, `limit=28`);
- a estratégia de token, sessão, cache HTTP, warmup;
- Playwright/Chromium, versão, flags, ou até troca do motor de browser;
- `meta.source` (rótulo informativo — pode passar de `comix:browse-relevance` a outro valor).

**Regra prática:** se uma mudança altera **campos, tipos ou semântica** do payload → é breaking e
exige versionar o contrato. Se altera **só como o sidecar produz o mesmo payload** → é livre, não
toca o app. O app trata o sidecar como caixa-preta que "recebe título, devolve `items`".

---

## 3. Browser lifecycle — decisão: **BrowserContext por request**

Avaliei `Page` reutilizada (v1) vs `BrowserContext` por request. **Decisão: contexto por request.**

```
processo
 └── 1 Browser (Chromium headless, singleton, quente)   ← lançado no boot, parte cara
      └── por request: browser.newContext() → newPage()  ← efêmero, isolado, auto-limpo
```

**Por que contexto por request vence** (isolamento + simplicidade, com custo de perf aceitável):
- **Isolamento automático** de cookies, `localStorage`, `sessionStorage`, service workers e cache —
  `context.close()` no `finally` libera tudo. É o que você pediu.
- **Mais simples** que o pool de pages da v1: sem `MAX_USES_PER_PAGE`, sem contadores de uso, sem
  lógica de reset — cada job nasce e morre limpo. Menos superfície de leak.
- **Custo de perf pequeno:** contexto novo tem cache HTTP frio → re-baixa o bundle (~196KB). Medido
  **1.4–1.9s** ponta-a-ponta (com mídia abortada); o gargalo é o round-trip do XHR, não o bundle.
  A parte cara (lançar o browser) fica amortizada no singleton.

Fluxo por job (sem digitação — navegação direta):
```
1. adquire slot do semáforo (§5)
2. ctx = browser.newContext({ userAgent })
3. page = ctx.newPage(); page.route → aborta image/media/font
4. page.goto(`/browse?q=${enc(title)}&sort=relevance:desc`, { waitUntil: "domcontentloaded" })
5. resp = page.waitForResponse(/\/api\/v1\/manga\?.*keyword.*relevance/)   ← escopado, sem leak
6. items = resp.json().result.items
7. finally: ctx.close(); libera slot
```

**Evitar memory leak / cleanup:**
- `page.waitForResponse` (escopado) — **nunca** `page.on("response")` persistente (acumularia
  handler por job; foi o bug latente dos primeiros POCs).
- `ctx.close()` em `finally` sempre (libera storage/SW/cache).
- Singleton browser: `browser.on("disconnected")` → relança; restart proativo após
  `MAX_JOBS_PER_BROWSER` (default 500) ou se RSS passar do teto (watchdog).
- `SIGTERM`/`SIGINT`: para de aceitar, drena a fila curta, `browser.close()`, exit (Fly manda
  SIGTERM no deploy/scale-down).

---

## 4. Timeout e retry

| Fase | Teto (default, via env) |
|---|---|
| **Total por request (sidecar)** | 20s → `504 render_timeout` |
| `page.goto(/browse?q=…)` | 12s (`NAV_TIMEOUT_MS`) |
| Espera do XHR (`waitForResponse` keyword+relevance) | 8s (`XHR_TIMEOUT_MS`) |
| **Total app→sidecar (HTTP)** | 25s (> teto do sidecar) |

> Sem "timeout de digitação" na v2 — a navegação direta eliminou o passo de `type`.

- **Retry (sidecar):** 1 tentativa extra em falha transiente (`render_timeout`, crash,
  `upstream_blocked`) com **contexto novo**. **Sem** retry em `bad_request` nem em `items:[]`.
- **Retry (app→sidecar):** 1 retry, backoff fixo 500ms, em `5xx`/timeout de conexão. `4xx` e `[]`
  não repetem.

---

## 5. Rate limiting / concorrência

- **`MAX_CONCURRENCY` (env, default 3)** — nº de contextos/requests simultâneos. Cada Chromium
  context é caro (~50-150MB); ajustar à VM do Fly **sem tocar código**.
- **Fila FIFO** antes do semáforo: `MAX_QUEUE` (default 20) e `MAX_QUEUE_WAIT_MS` (default 8000).
  Estourou qualquer um → `503 busy` (app degrada: trata como "Comix indisponível", igual hoje).
- Implementação: semáforo simples (contador + fila de promises), sem lib externa.
- `meta` não expõe `poolWaitMs` na v2 (sem pool); a espera de fila vai pras métricas (§8).

---

## 6. Cache

Dois níveis, **ambos no app** (sidecar stateless). **Valor guardado = `{ hid, url }`** (não só a
URL) — assim reconstruímos `/title/{hid}` se o formato de slug mudar, e a `url` fica como atalho.

**(a) Permanente — o melhor cache é não resolver.** Ao confirmar a obra, persistir o **`hid`** do
Comix em `work_external_ids` (fluxo já existente; `ExternalSourceId="comix"`). Obras com id aceito
**pulam** `resolveComixUrl`. A `url` é derivável do `hid` a qualquer momento.

**(b) Transiente (LRU em memória) — fluxo pré-persistência** (busca/criação, lotes):
```
chave  = precedência: al:{anilistId} → mal:{malId} → mu:{muId} → t:{normalizeText(title)}
valor  = { hid, url } | null (miss confirmado)
TTL    = 24h em hit; 6h em null   (obra nova pode entrar no catálogo depois)
tamanho= LRU cap 1000 entradas
```
Chave por **cross-ID quando existe** (estável); só cai pro título normalizado
(`normalizeText`, reusado de `lib/external/index.ts`) como último recurso.

---

## 7. Matching (no app, `resolveComixUrl`) → retorna `{ hid, url } | null`

Ordem determinística, primeira que casar vence:
```
1. anilistId      === parseId(item.links.al)     // exato
2. malId          === parseId(item.links.mal)    // exato
3. mangaUpdatesId === parseId(item.links.mu)      // exato
4. fallback por similaridade de título
```
- `parseId` = `linksFromItem` já existente ([comix.ts:373](lib/external/comix.ts#L373)): extrai o id cru
  da URL completa (`https://anilist.co/manga/200573/` → `200573`).
- Cross-ID casou → retorna `{ hid, url }` na hora (**zero ambiguidade**). Caminho esperado.
- Empate teórico (2 itens, mesmo id) → o primeiro (lista vem rankeada por relevância).

**Fallback de similaridade** (só quando não há nenhum cross-ID, ou nenhum item casou por id):
- Algoritmo = **`titleSimilarityDetailed`** reusado de [index.ts:114](lib/external/index.ts#L114) — o
  mesmo do `searchAllSources` (Jaccard de palavras via `normalizeText` + boosts graduados de
  substring que já tratam falsos positivos tipo "Fake Lady" vs "The Fake Lady and Her Rabbit Duke").
- Avalia contra `title` **+ `altTitles`** de cada item; pega o melhor score.
- **Aceita só se `bestScore ≥ 0.72`** (`SIM_ACCEPT_THRESHOLD`, mesmo teto de "accepted" do
  pipeline). Abaixo → `null` (melhor não resolver do que resolver errado).

---

## 8. Observabilidade

**Sidecar — logs estruturados (JSON, 1 linha/request):**
`{ reqId, query, totalCandidates, elapsedMs, navMs, xhrWaitMs, queueWaitMs, outcome, error? }`
`outcome ∈ { ok, empty, timeout, busy, blocked, error }`.

**Sidecar — `/metrics` (mantido; contadores + histogramas):**
- `resolve_total`, `resolve_errors_total{code}`
- `resolve_duration_ms` (total) + splits `nav` / `xhr_wait`
- `inflight`, `queue_length`, `queue_wait_ms`
- `browser_restarts_total`
- `candidates_returned` (histograma — quantos itens por busca)

**App (`resolveComixUrl`) — logs/contadores:**
- `cache_hit` / `cache_miss` (por nível a/b)
- `match_method ∈ { anilist, mal, mangaupdates, title, none }`
- `resolved` vs `null`, latência ponta-a-ponta (incl. sidecar)

Tempo médio, cache hit/miss, timeouts e nº de candidatos saem direto desses campos + do `meta` da
resposta — sem infra nova além dos contadores.

---

## 9. Testes

**Unit — app (`resolveComixUrl`), vitest (padrão do repo):**
- precedência de matching (al > mal > mu > título) sobre arrays de `items` fixos
- `parseId`/`linksFromItem` sobre URLs cruas (incl. `null`)
- fallback: aceita ≥0.72, rejeita <0.72, casa via `altTitles`
- retorna `null` sem item confiável; retorna `{ hid, url }` no match
- cache: hit, miss, expiração (TTL) com fake timers; precedência de chave (al→…→título);
  valor `{ hid, url }`
- montagem da URL final a partir de `hid`

**Unit — sidecar:**
- passthrough de `links`, shaping de `items` + `meta` (query/elapsedMs/totalCandidates/source)
- slice de `items` por `limit` (default 12, entrada 28)
- mapeamento erro→HTTP (`bad_request`→400, timeout→504, busy→503)
- semáforo/fila: respeita `MAX_CONCURRENCY`, `503` ao estourar `MAX_QUEUE`

**Integração — sidecar (Playwright determinístico, sem rede real):**
- `page.route("**/api/v1/manga?*", …)` serve a fixture → exercita o fluxo real
  (goto→waitForResponse→intercept→shape) sem depender do Comix ao vivo
- caso vazio, caso timeout (rota que nunca responde), caso `no_xhr`

**Smoke ao vivo (opt-in, fora do CI) — `npm run test:live` / `pnpm test:live`:**
- bate no comix.to real e exige `hid:3ezr0` no topo pra a query conhecida → valida rápido se o
  Comix mudou algo (rota, param `sort=relevance:desc`, shape do payload)

**Fixtures (`tests/fixtures/comix-render/`):**
- `browse-relevance-i-adopted.json` — payload real interceptado (28 itens, com `links`)
- `browse-relevance-empty.json`
- `items-*.json` — arrays pros testes de matching (cross-id hit, só-título, ambíguo)

> Nota: o repo hoje só tem unit de `calculations`. A integração Playwright é nova e exige Chromium
> no runner — fica como suíte **separada/opt-in**, fora do `npm test` padrão.

---

## 10. Fluxo final

```
                        ┌─────────────────────────────────────────────┐
 obra sem comix id ───► │ resolveComixUrl({ title, anilistId?, ... })  │   (app / server)
                        └───────────────┬─────────────────────────────┘
                                        │
                      cache (b) LRU  ┌──┴───────────┐  hit → { hid, url } ────────────┐
                      cache (a) DB   │ chave: al→mal→mu→título │                       │
                                     └──┬───────────┘  miss                            │
                                        ▼                                              │
                        POST /resolve { title, ids… }                                 │
              ┌─────────────────────────┴──────────────── sidecar comix-render ───────┤
              │  fila/semáforo (MAX_CONCURRENCY) → browser.newContext()               │
              │        │                                                              │
              │        ▼   (NAVEGAÇÃO DIRETA — sem digitação)                          │
              │  page.goto(/browse?q={title}&sort=relevance:desc)                     │
              │  page.waitForResponse(/api/v1/manga?…keyword…relevance…)              │
              │        │  (o app do Comix injeta o token _= válido e chama a API)      │
              │        ▼                                                              │
              │  items[] { hid, url, title, altTitles, links } + meta   → ctx.close() │
              └─────────────────────────┬────────────────────────────────────────────┘
                                        │  200 { items, meta }
                                        ▼
             cross-ID match (al→mal→mu) │ senão similaridade ≥0.72 │ senão null
                                        │
                                        ▼
                    { hid, url }  ──►  grava em cache (a: work_external_ids) + (b: LRU)
                                        │
                                        ▼
        fetchComixDetail(url) ──► extractHydration() ──► mapper()   (INALTERADO, SSR token-free)
```

---

## Parâmetros (env, com defaults)

| Var | Default | O quê |
|---|---|---|
| `MAX_CONCURRENCY` | 3 | contextos/requests simultâneos |
| `MAX_QUEUE` / `MAX_QUEUE_WAIT_MS` | 20 / 8000 | fila antes de `503 busy` |
| `TOTAL_TIMEOUT_MS` | 20000 | teto por request |
| `NAV_TIMEOUT_MS` / `XHR_TIMEOUT_MS` | 12000 / 8000 | navegação / espera do XHR |
| `MAX_JOBS_PER_BROWSER` | 500 | restart proativo do browser |
| `RESULT_LIMIT_DEFAULT` / `RESULT_LIMIT_MAX` | 12 / 28 | slice de `items` |
| `CACHE_TTL_HIT_MS` / `CACHE_TTL_MISS_MS` | 24h / 6h | cache (b) no app |
| `SIM_ACCEPT_THRESHOLD` | 0.72 | fallback de título |
| `RENDER_TIMEOUT_MS` / `RENDER_NAV_TIMEOUT_MS` | 25000 / 20000 | teto de `POST /render` |
| `RENDER_SETTLE_MAX_MS` | 4000 | espera o DOM parar de crescer (conteúdo lazy de SPA) |
| `RENDER_CHALLENGE_WAIT_MS` | 12000 | espera o browser vencer o interstitial do CF |
| `RENDER_ALLOWED_HOSTS` | (fontes) | allowlist anti-SSRF do `/render` |

---

# `POST /render` — o substituto do FlareSolverr (2026-07-12)

**Por quê.** As fontes atrás de Cloudflare (anime-planet, mangago, comick, comix)
respondem **403 `cf-mitigated: challenge`** ao `fetch()` do Node: o bloqueio é por
**fingerprint TLS/browser**, não por conteúdo. O Chromium do Playwright — o mesmo que já
roda aqui pro `/resolve` — atravessa as quatro. Medido ao vivo (2026-07-12):

| fonte | `fetch()` do Node | `POST /render` |
|---|---|---|
| anime-planet | 403 | ✅ 200 (~0,9s) |
| mangago | 403 | ✅ 200 (~0,9s) |
| comick (api + web) | 403 | ✅ 200 (~0,2–3,4s) |
| comix | 403 no SSR¹ | ✅ 200 (~0,3s) |

¹ o Comix hoje passa por plain fetch (ver o falso positivo do detector de challenge);
o sidecar é o **fallback** dele.

**Request:** `{ url, headers?, timeoutMs? }` → `{ ok:true, html, finalUrl, status, meta }`
ou `{ ok:false, error, meta }`. O sidecar continua **agnóstico**: devolve HTML, e parsing/
matching/persistência seguem no app.

**Ordem no app** (`fetchHtmlWithCfFallback`, o choke point ÚNICO de todas as fontes):
`plain fetch → sidecar /render → FlareSolverr (legado)`. Sem `COMIX_RENDER_URL`, a camada
do sidecar é um no-op barato (circuito de 60s) e o comportamento é o de antes — por isso
dá pra mergear antes do deploy.

**Três decisões que custaram sangue:**
1. **`context.request` (APIRequestContext) NÃO serve** — leva 403. Ele não usa o
   fingerprint do Chrome. Só a **navegação real** (`page.goto`) passa o CF. JSON de API
   volta dentro de `<pre>` (o Chrome renderiza JSON assim) — mesmo formato que o
   FlareSolverr entregava, então os parsers do app não mudam.
2. **Esperar o DOM estabilizar** (`waitForDomSettle`), não `domcontentloaded` puro: os
   comentários do ComicK só existem no DOM ~2s depois. Devolver cedo entregava **13 de 33**
   reviews — perda silenciosa. `networkidle` daria o mesmo resultado custando 5,1s contra
   2,4s.
3. **Allowlist de hosts é obrigatória**: o sidecar vive na rede interna; sem ela, `/render`
   é um proxy aberto (SSRF). Ela precisa cobrir TODOS os domínios reais — o ComicK rotaciona
   `.dev`/`.io`/`.app`, e um host de fora da lista some como se a fonte estivesse bloqueada.

---

# Peça 3 — Integração no pipeline (design, aguardando aprovação)

Ancorado no código real (não hipótese). O sidecar permanece **agnóstico** — resolução e
persistência ficam 100% no app.

## Ponto de integração (1)

`resolveEvaluationContext` em [server/actions/ai.ts](server/actions/ai.ts) — o dispatcher do fluxo
de avaliação IA. Ele **já**: lê `work_external_ids`, monta `acceptedExternalIds` + `rejectedSources`,
tem o `workId` + `supabase`, e escolhe candidate-vs-work. É o único lugar onde tudo que precisamos
converge (workId p/ persistir + cross-IDs p/ desambiguar).

Um helper novo **`ensureComixHid`** (server) faz resolve+persist ali, reusando `persistComixHid`
(extraído de `reading.ts` pra um módulo compartilhado — mesmo padrão self-healing já usado no
checador de capítulos). O sidecar `searchComix` (API gateada, morto) deixa de ser a via.

## Condições de execução — evitar chamadas desnecessárias (2)

Resolve o comix hid **só quando TODAS**:
- comix **ausente** em `acceptedExternalIds` (senão reusa — ver (4));
- comix **não rejeitado** (`rejectedSources`);
- há **≥1 cross-ID aceito** (anilist/mal/mangaupdates) pra desambiguar por ID exato;
- `COMIX_RENDER_URL` configurada (senão o client devolve `disabled` → null; fail-soft).

→ Na prática dispara **1× por obra** (1ª avaliação sem comix) e **nunca** pra obra sem cross-ID
confirmado. O gate por cross-ID é deliberado: mantém "similaridade só como último recurso" e evita
render de browser que provavelmente devolveria null.

## Persistência (3)

`persistComixHid(supabase, workId, hid)` — `upsert` de **1 linha** em `work_external_ids`
(`onConflict work_id,source`), **não-destrutivo** (não toca outras fontes), **fail-soft** (loga, não
lança). É o helper que já existe em `reading.ts`, promovido a módulo compartilhado.

## Reuso sem re-consultar o sidecar (4)

hid persistido → a próxima `resolveEvaluationContext` carrega `comix` em `acceptedExternalIds` → a
condição "comix ausente" fica falsa → **pula o sidecar**. O hid é identidade estável → reuso
indefinido (o mesmo que o `fetchComixById(hid)` já faz na hidratação).

## Invalidação de cache (5)

- **Cache transiente** (LRU do `comix-resolve`): TTL 24h (hit) / 6h (miss). Miss curto pra obra nova
  entrar no catálogo depois.
- **hid persistido** (`work_external_ids`): invalidado **por ação do usuário** — rejeitar/limpar o
  comix em "Revalidar fontes" (`saveWorkSourceSelections`). Rejeição também **bloqueia** re-resolução
  (respeitada na condição). Sem invalidação automática: hid não muda (identidade).

## Fail-soft (6)

`ensureComixHid` **nunca lança**; qualquer falha → devolve null → comix fica ausente **exatamente
como hoje**, e reviews/hydrate das outras fontes seguem normais:
- sidecar down / `disabled` / timeout → `resolveComixUrl` = null;
- nenhum candidato / nenhum match (cross-ID ou título <0.72) → null;
- falha ao persistir → loga e segue (não bloqueia a avaliação).

## Fluxo final

```
Obra (workId + título + work_external_ids)
   │
   ▼
resolveEvaluationContext (ai.ts)
   │  comix ausente? não rejeitado? tem cross-ID?  ── não ──►  segue (reuso/skip) ─┐
   │ sim                                                                           │
   ▼                                                                               │
ensureComixHid ──► resolveComixUrl (app)                                           │
   │                                                                               │
   ▼                                                                               │
cache (al→mal→mu→título)  ── hit ──► {hid,url} ─────────────────┐                  │
   │ miss                                                       │                  │
   ▼                                                            │                  │
sidecar /resolve ──► Comix (/browse relevance + token)          │                  │
   │                                                            │                  │
   ▼                                                            │                  │
candidatos crus ──► cross-ID match (app; título ≥0.72 fallback) │                  │
   │                                                            │                  │
   ▼                                                            ▼                  │
hid/url  ── null ──► fail-soft (comix ausente) ─────────────────────────────────►─┤
   │ hit                                                                           │
   ▼                                                                               │
persistComixHid → work_external_ids   +   acceptedExternalIds.comix = hid          │
   │                                                                               │
   ▼                                                                               ▼
buildCandidateFromExternalIds → candidate.comixHid            (pipeline segue com/sem comix)
   │
   ▼
fetchComixById (hydrate) + fetchComixReviews      [PIPELINE EXISTENTE, INALTERADO]
```

## Escopo desta peça

- **Foco: caminho candidate** (obra com cross-ID aceito). O caminho **work** (obra sem NENHUM ID
  aceito → busca por título) fica **fora**: sem cross-ID confiável, não auto-resolvemos (consistente
  com hoje). Extensão futura possível: resolver com os IDs descobertos na busca e borbulhar p/
  persistência.
- **Reading/capítulos**: `getLatestChapter` também resolve comix via `searchComix` morto; como
  `reading.ts` já tem `persistComixHid` + o padrão self-healing, trocar lá por `resolveComixUrl` é um
  follow-up natural (mesma peça de resolução) — **não** incluído neste escopo.
