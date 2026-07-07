# comix-render (sidecar)

Serviço isolado que resolve a **URL de uma obra no comix.to a partir do título**, usando um
browser real (Playwright/Chromium) — o único jeito de passar pelo token anti-bot do Comix, que
assina a query inteira. Ver `DESIGN-COMIX-RENDER-SIDECAR.md` na raiz do repo.

O app principal **não** conhece nada disto: fala só com o contrato HTTP via
`lib/external/comix-render-client.ts`.

## Como funciona (interno — NÃO faz parte do contrato)

`POST /resolve { title }` → BrowserContext efêmero → `goto /browse?q=<title>&sort=relevance:desc`
→ intercepta o XHR `/api/v1/manga?…keyword…relevance…` (o app do Comix injeta o token válido) →
devolve os candidatos crus (`hid`, `url`, `title`, `altTitles`, `links`).

## Contrato (estável)

- `POST /resolve` — body `{ title, anilistId?, malId?, mangaUpdatesId?, limit? }` →
  `{ ok:true, items[], meta }` ou `{ ok:false, error, meta }`.
- `GET /health` — **liveness**: processo vivo (200 sempre).
- `GET /ready` — **readiness**: 200 só quando o browser está apto; 503 senão.
- `GET /metrics` — Prometheus (inclui `browser_context_created_total` /
  `browser_context_closed_total` pra detectar leak de contexto).

Todo response traz `X-Request-Id` (aceita `X-Correlation-Id`/`X-Request-Id` de entrada pra
rastreio ponta a ponta). Toda linha de log é JSON com `reqId`.

## Rodar local

```bash
npm install
npm run dev          # tsx watch, sobe em :8790
npm test             # unit (pool/metrics/contract) — sem browser
npm run smoke        # ao vivo contra comix.to real (exige hid 3ezr0)
npm run typecheck
```

## Env (todos com default)

| Var | Default | O quê |
|---|---|---|
| `PORT` | 8790 | porta HTTP |
| `MAX_CONCURRENCY` | 3 | contextos simultâneos |
| `MAX_QUEUE` / `MAX_QUEUE_WAIT_MS` | 20 / 8000 | fila antes de `503 busy` |
| `TOTAL_TIMEOUT_MS` | 20000 | teto por request → 504 |
| `NAV_TIMEOUT_MS` / `XHR_TIMEOUT_MS` | 12000 / 8000 | `page.goto` / espera do XHR |
| `MAX_JOBS_PER_BROWSER` | 500 | reciclagem proativa do browser (quando ocioso) |
| `RESULT_LIMIT_DEFAULT` / `RESULT_LIMIT_MAX` | 12 / 28 | slice de `items` |
| `COMIX_ORIGIN` | https://comix.to | origem |
| `COMIX_USER_AGENT` | (Chrome 124) | UA do browser |

## Deploy (Fly)

```bash
fly deploy   # usa Dockerfile + fly.toml (app interno "comix-render")
```

Imagem base: `mcr.microsoft.com/playwright:v1.61.1-jammy` (Chromium já embutido; a tag DEVE casar
com a versão do pacote `playwright`). App interno — sem porta pública; o app principal aponta:

```
COMIX_RENDER_URL=http://comix-render.flycast:8790
```

O Fly usa `/ready` como healthcheck → só roteia quando o browser subiu.
