# COMIX-ARCHITECTURE.md

Descoberta automática da obra no **comix.to** a partir de título + IDs que já temos —
sem o usuário colar URL nenhuma. Leitura de ~5 min pra entender o todo.

> Doc de decisão/histórico completo: [DESIGN-COMIX-RENDER-SIDECAR.md](DESIGN-COMIX-RENDER-SIDECAR.md).

---

## 1. Objetivo

O comix.to é uma fonte de metadados/reviews. Para extrair os dados de uma obra precisamos do
**`hid`** dela (ex.: `3ezr0`) — a página SSR `/title/{hid}` já traz tudo. O problema: a **busca**
do comix é gateada por um token anti-bot que **assina a query inteira** (qualquer reescrita → 403),
e o `searchComix` (API) está morto. Só um **browser real executando o app do comix** produz um token
válido.

**Solução:** um **sidecar** com Playwright descobre os candidatos; o **app** decide qual é a obra
(matching por cross-ID) e persiste o `hid`. Depois disso, tudo reusa o `hid` — o sidecar nunca mais
é chamado pra aquela obra.

---

## 2. Visão geral

```
┌─────────────────────────── APP (Next.js) ───────────────────────────┐        ┌──── SIDECAR ────┐
│                                                                      │  HTTP  │  comix-render   │
│  ai.ts  →  ensureComixHid  →  resolveComixUrl  →  ComixRenderClient ─┼───────▶│  Playwright     │
│  (workId)   (regra/persist)    (cache+matching)   (contrato+Zod)     │        │  /resolve       │
│                                                                      │        │  /health /ready │
│  work_external_ids  ◀── persistComixHid                              │        │  /metrics       │
└──────────────────────────────────────────────────────────────────────┘        └────────┬────────┘
                                                                                           │ browser
                                                                                           ▼
                                                                                     comix.to (real)
```

O sidecar é **burro e reutilizável**: recebe um título, devolve candidatos crus. **Nenhuma** regra de
negócio (AniList/MAL/matching/cache/persistência) vive nele.

---

## 3. Responsabilidades

| App (dono da regra) | Sidecar (dono do browser) |
|---|---|
| Decide **quando** resolver (gate por cross-ID) | Renderiza a busca do comix num BrowserContext efêmero |
| **Matching**: escolhe o candidato (AniList→MAL→MU→título) | Intercepta o XHR de busca e devolve `items` crus |
| **Cache** (LRU + `work_external_ids`) | Concorrência (semáforo), timeouts, retry de render |
| **Persistência** do `hid` | Nada de identidade/negócio — agnóstico |
| **Fail-soft**: trata sidecar como fonte opcional | Sempre responde no contrato (mesmo em erro) |
| Valida a resposta com **Zod** | — |

**Arquivos-chave:**
- `services/comix-render/` — o sidecar (subprojeto isolado; toolchain própria).
- `lib/external/comix-render-client.ts` — client HTTP + validação Zod (único que conhece a API).
- `lib/validations/comix-render.schema.ts` — schema Zod = fonte da forma do payload.
- `lib/external/comix-resolve.ts` — `resolveComixUrl` (cache + matching).
- `server/actions/comix-hid.ts` — `ensureComixHid` + `persistComixHid` (regra + persistência).
- `server/actions/ai.ts` — ponto de integração (`resolveEvaluationContext`).
- `lib/external/comix.ts` — extração SSR já existente (`fetchComixById`/`fetchComixReviews`), **inalterada**.

---

## 4. Fluxo completo

```
Obra (workId + título + work_external_ids)
   │
   ▼
resolveEvaluationContext (ai.ts) ──► ensureComixHid
   │
   ├─ comix já aceito?  ── sim ─► reusa (skip: already_persisted) ─────────────┐
   ├─ comix rejeitado?  ── sim ─► null  (skip: rejected)                        │
   ├─ tem cross-ID?     ── não ─► null  (skip: no_cross_id)                     │
   ├─ sidecar ligado?   ── não ─► null  (skip: sidecar_disabled)               │
   │ sim (tudo ok)                                                             │
   ▼                                                                           │
resolveComixUrl (app)                                                          │
   ├─ cache (al→mal→mu→título)  ── hit ─► {hid,url}                            │
   │ miss                                                                      │
   ▼                                                                           │
ComixRenderClient → POST /resolve → sidecar → comix.to (/browse relevance)     │
   │                                                                           │
   ▼                                                                           │
items crus → matching por cross-ID (app; título ≥0.72 só se allowTitleFallback)│
   │                                                                           │
   ├─ null (no_match / sidecar_error) ─► fail-soft: comix ausente ────────────┤
   │ {hid,url}                                                                 │
   ▼                                                                           ▼
persistComixHid → work_external_ids   +   acceptedExternalIds.comix = hid   (pipeline segue com/sem comix)
   │
   ▼
buildCandidateFromExternalIds → candidate.comixHid
   │
   ▼
fetchComixById (hydrate) + fetchComixReviews      [PIPELINE EXISTENTE, INALTERADO]
```

---

## 5. Contrato da API (`POST /resolve`)

**Estável.** Mudança de payload exige coordenação app↔sidecar.

**Request:**
```jsonc
{ "title": "I Adopted the Protagonist, and the Genre Changed",
  "anilistId": 200573, "malId": 191605, "mangaUpdatesId": "iwqx86g", // opcionais/reservados
  "limit": 12 }
```

**Response (sucesso):**
```jsonc
{ "ok": true,
  "items": [ { "hid": "3ezr0", "url": "/title/3ezr0-...", "title": "...",
               "altTitles": ["..."], "links": { "al": "https://anilist.co/manga/200573/", "mal": "...", "mu": "...", "md": null } } ],
  "meta": { "query": "...", "elapsedMs": 1882, "totalCandidates": 28, "source": "comix:browse-relevance" } }
```

**Response (erro):** `{ "ok": false, "error": "<code>", "meta": { "elapsedMs": 8200, "source": "..." } }`

| `error` | HTTP | Significado |
|---|---|---|
| `bad_request` | 400 | `title` ausente |
| `upstream_blocked` / `no_xhr` | 502 | Cloudflare / XHR de busca não apareceu (comix mudou algo) |
| `busy` | 503 | fila cheia (backpressure) |
| `render_timeout` | 504 | navegação/XHR estourou o teto |
| `internal` | 500 | crash não classificado |

Garantidos por item: `hid`, `url`, `title`. Podem faltar: `altTitles`, `links` (e cada id em `links` pode ser null).

**Outros endpoints:** `GET /health` (liveness — processo vivo), `GET /ready` (readiness — browser
apto; Fly usa este), `GET /metrics` (Prometheus).

---

## 6. Cache (dois níveis, ambos no app)

1. **Permanente — não resolver de novo:** o `hid` aceito em `work_external_ids` (`source=comix`).
   Enquanto existir, `ensureComixHid` pula o sidecar (skip `already_persisted`).
2. **Transiente — LRU em memória** (`comix-resolve.ts`): chave por precedência de cross-ID
   (`al:` → `mal:` → `mu:` → `t:<título normalizado>`); valor `{ hid, url } | null`; TTL **24h**
   (hit) / **6h** (miss — obra nova pode entrar no catálogo depois); cap 1000. O sidecar é stateless.

**Invalidação:** o `hid` persistido só sai por **ação do usuário** (rejeitar/limpar a fonte comix em
"Revalidar fontes"), que também bloqueia re-resolução. Não há invalidação automática (hid é identidade estável).

---

## 7. Matching (app)

Ordem determinística, primeira que casar vence:

1. **AniList ID** → 2. **MAL ID** → 3. **MangaUpdates ID** (match exato do id nos `links` do candidato)
4. **Similaridade de título** — **gateada** por `allowTitleFallback` (hoje **desligado**), aceita só ≥ **0.72**
   (mesma função `titleSimilarityDetailed` do `searchAllSources`).

Hoje só resolvemos quando há ≥1 cross-ID aceito (anilist/mal/mu) → zero ambiguidade, sem custo de
render à toa. O modo título-só já existe na interface (`allowTitleFallback: true`), apenas desligado —
ligar no futuro **não quebra a API**.

---

## 8. Persistência do hid

`persistComixHid(supabase, workId, hid)` — **upsert de 1 linha** em `work_external_ids`
(`onConflict work_id,source`), **não-destrutivo** (não toca outras fontes), **fail-soft** (loga,
devolve `false`, nunca lança). Fonte única, reusada pelo fluxo de avaliação e (futuramente) pelo de
capítulos.

---

## 9. Fail-soft

**Nenhuma falha do comix impede o resto do pipeline.** `ensureComixHid` nunca lança; qualquer
desfecho ruim → `null` → o comix fica ausente exatamente como antes, e as outras fontes seguem:

- sidecar down / `COMIX_RENDER_URL` ausente / timeout → `resolveComixUrl` = null;
- nenhum candidato / nenhum match → null;
- falha ao persistir → loga e segue.

---

## 10. Observabilidade

**App** (`server/actions/comix-hid.ts`) — logs JSON `{ scope:"comix-resolve", event, workId, ... }`:
- `event:"skipped"` + `reason:` `already_persisted` | `rejected` | `no_cross_id` | `sidecar_disabled`
- `event:"attempt"` + `reason:"missing_hid_with_cross_id"` + `crossIds`
- `event:"result"` + `result:` `resolved`/`persisted` | `no_match` | `timeout` | `sidecar_unavailable` | `persist_failed`

**Sidecar** — logs JSON com `reqId` (aceita `X-Correlation-Id`/`X-Request-Id` de entrada, ecoa em
`X-Request-Id`), e `/metrics` Prometheus:
- `resolve_total`, `resolve_errors_total{code}`, `resolve_duration_ms` (+ nav/xhr), `queue_wait_ms`
- `inflight`, `queue_length`, `browser_ready`
- **`browser_context_created_total` vs `browser_context_closed_total`** — se a diferença crescer, há
  vazamento de contexto.

---

## 11. Deploy do sidecar

Subprojeto em `services/comix-render/` (Docker; base `mcr.microsoft.com/playwright:v1.61.1-jammy`, com
Chromium embutido — a tag DEVE casar com a versão do pacote `playwright`).

```bash
cd services/comix-render
fly deploy          # usa Dockerfile + fly.toml (app INTERNO "comix-render", healthcheck em /ready)
```

Config por env (todas com default — ver `services/comix-render/README.md`): `MAX_CONCURRENCY` (3),
`TOTAL_TIMEOUT_MS` (20s), `NAV_TIMEOUT_MS` (12s), `XHR_TIMEOUT_MS` (8s), `MAX_QUEUE` (20), etc.

Local:
```bash
cd services/comix-render && npm install && npm run dev   # sobe em :8790
npm test          # unit (pool/metrics/contract)
npm run smoke     # ao vivo contra comix.to real (exige hid 3ezr0) — checa se o comix mudou algo
```

---

## 12. Configurar `COMIX_RENDER_URL`

No **app**, aponte pro sidecar (rede interna do Fly):
```
COMIX_RENDER_URL=http://comix-render.flycast:8790
```
- **Ausente** → `ensureComixHid` loga `skipped: sidecar_disabled` e tudo segue como antes (fail-soft).
  Ou seja: o comix vira opt-in — sem essa env, nada muda no comportamento atual.
- Timeout da chamada app→sidecar: `COMIX_RENDER_TIMEOUT_MS` (default 25s, > teto do sidecar).

---

## 13. Troubleshooting

| Sintoma | Onde olhar | Causa provável / ação |
|---|---|---|
| Comix nunca resolve | log `skipped: sidecar_disabled` | `COMIX_RENDER_URL` não setada, ou `/ready` do sidecar em 503 (browser não subiu) |
| `skipped: no_cross_id` | log do app | Esperado: obra sem anilist/mal/mu aceito. Sem cross-ID não resolvemos (gate) |
| `result: sidecar_unavailable` | `/ready`, logs do sidecar | Sidecar caiu/reiniciando, rede, ou `busy` (503). Cheque `inflight`/`queue_length` em `/metrics` |
| `result: timeout` | `/metrics` (`resolve_duration_ms`) | Sidecar sob carga ou comix lento. Suba `MAX_CONCURRENCY`/VM ou os `*_TIMEOUT_MS` |
| `result: no_match` | `meta.totalCandidates` no log do sidecar | Cross-ID não bateu em nenhum candidato: obra não indexada no comix, ou id divergente. (Futuro: `allowTitleFallback`) |
| `error: no_xhr` (sidecar) | `npm run smoke` no sidecar | Comix mudou rota/param (`sort=relevance:desc`) ou shape do payload → ajustar o miolo do sidecar (contrato NÃO muda) |
| `error: busy` (503) | `/metrics` `queue_length` | Concorrência saturada → aumentar `MAX_CONCURRENCY` / tamanho da VM |
| Vazamento de memória | `browser_context_created_total` − `closed_total` | Se diverge, contexto não fechou — investigar (deveria ser sempre ≈ 0) |
| Resolveu a obra ERRADA | rejeitar em "Revalidar fontes" | Isso limpa/rejeita o `hid` e bloqueia nova resolução. (Cross-ID exato torna isso raro) |

**Regra de ouro:** qualquer problema do comix é **invisível** pro resto — se algo estranho aparecer,
o pipeline de avaliação continua funcionando com as demais fontes. Dá pra desligar tudo tirando
`COMIX_RENDER_URL`.
