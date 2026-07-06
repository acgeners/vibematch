# Deploy — Fly.io (app + FlareSolverr, tudo numa plataforma)

Plano pra subir o **VibeMatch (animedb)** inteiro no **Fly.io**: o Next.js e o
FlareSolverr como dois apps Fly na mesma org, FlareSolverr **interno** (rede
privada 6PN), sem loteria de capacidade e sem timeout de serverless.

## Por que Fly-only (e não Vercel+Fly, nem Oracle)

- **Sem loteria de capacidade** (o que matou a Oracle Always Free). Sobe em minutos.
- **Sem timeout de função** → a avaliação IA de **~78s roda como request normal**
  num servidor de verdade. Sem Vercel Pro, sem reestruturar pra background.
- **FlareSolverr volta a ser sidecar interno** (rede privada do Fly) →
  `FLARESOLVERR_URL=http://…:8191/v1`, **zero mudança de código**, sem header de
  auth remoto. Mesmo benefício que a gente buscava na Oracle.
- **Reaproveita 100%** do `Dockerfile` (multi-stage, `output: standalone`) que já
  foi criado e **build-verificado**.
- **TLS automático** no `*.fly.dev` → **dispensa Caddy e DuckDNS** (o Fly termina
  HTTPS e roteia). Menos peças que no plano Oracle.

## Particularidades que guiam o setup

- **Supabase MIGROU pra AWS sa-east-1 (São Paulo) em 2026-07-02** (projeto novo
  `obwlwukwovetgjqdpizd`; o antigo em Ohio `djbreiyzwoevbmoscqiq` = backup). Por isso
  o app vai na região **`gru` (São Paulo)**, ao lado do DB → round-trip ~10-15ms.
  (Antes o DB ficava em Ohio e o plano era `iad`; **obsoleto**.) A regra segue a
  mesma — co-localizar app **+** DB ganha (o app é pesado em queries) — só mudou o
  continente, e agora ainda fica perto do usuário BR de brinde.
- **FlareSolverr é app separado e interno.** O app principal chama via rede
  privada; FlareSolverr **não expõe porta pública** (seguro por padrão).
- **Comix + Cloudflare:** o fetch do Comix depende de **sessão de FlareSolverr**.
  Setar no app: `COMIX_FS_SESSION=comix` (amortiza o solve do CF) e
  `COMIX_CF_ABORT_MS=25000`. Sem isso, detalhe/reviews do Comix degradam.
- **`NEXT_PUBLIC_*` são inlinados no build** → entram como **build args**. As
  secretas entram via `fly secrets` (runtime).
- **Build remoto x86** (builders do Fly) → sem o dilema ARM da Oracle. O
  `node:22-bookworm-slim` é multi-arch; roda liso.

---

## Arquitetura

```
Internet
  ↓ HTTPS (TLS automático)
Fly proxy  →  vibematch.fly.dev
  ↓ :3000
app (Next.js standalone, região gru)
  ↓ rede privada Fly (flycast/.internal)
flaresolverr (:8191, INTERNO, região gru)

app  →  Supabase (AWS sa-east-1 São Paulo, ~10-15ms de gru)
app  →  Anthropic / OpenAI
```

---

## Fase 0 — Pré-requisitos

- [ ] Conta Fly.io + cartão (Fly é **pay-as-you-go**; estimativa ~$5-10/mês pra 2
      máquinas pequenas — ver Apêndice de custo).
- [ ] `flyctl` instalado: `brew install flyctl` → `fly auth login`.
- [ ] Secrets em mãos: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
      `OPENAI_API_KEY` (opcional), e os públicos `NEXT_PUBLIC_SUPABASE_URL` /
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## Fase 1 — FlareSolverr (app interno)

Sobe o FlareSolverr como app próprio, **sem serviço público**. Crie
`fly.flaresolverr.toml`:

```toml
app = "vibematch-flaresolverr"
primary_region = "gru"

[build]
  image = "ghcr.io/flaresolverr/flaresolverr:latest"

[env]
  LOG_LEVEL = "info"
  HEADLESS = "true"
  DISABLE_MEDIA = "true"   # menos RAM no Chromium
  TZ = "America/Sao_Paulo"

# Sem [http_service] público. Exposto só internamente via flycast (Fase 1.1).
[[services]]
  internal_port = 8191
  protocol = "tcp"
  auto_stop_machines = false   # scraping precisa dele de pé
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "1gb"               # Chromium headless precisa de folga
```

```bash
fly launch --no-deploy --copy-config --config fly.flaresolverr.toml --name vibematch-flaresolverr
```

### 1.1 IP privado (flycast) pro app alcançar o FlareSolverr

O 6PN do Fly é IPv6; o FlareSolverr escuta em IPv4 (0.0.0.0:8191). Pra evitar a
pegadinha de binding, use **flycast** (IP privado roteado pelo fly-proxy, aceita
backend IPv4):

```bash
fly ips allocate-v6 --private --config fly.flaresolverr.toml
fly deploy --config fly.flaresolverr.toml
```

O app vai falar com ele em **`http://vibematch-flaresolverr.flycast:8191/v1`**.

> Alternativa: se preferir `*.internal` (6PN direto), o FlareSolverr precisaria
> escutar em IPv6 (`::`) — flycast é mais simples e ainda permite auto-start.

---

## Fase 2 — App Next.js

Reusa o `Dockerfile` existente (não muda nada nele). Crie `fly.toml`:

```toml
app = "vibematch"
primary_region = "gru"

[build]
  dockerfile = "Dockerfile"
  [build.args]
    NEXT_PUBLIC_SUPABASE_URL = "https://obwlwukwovetgjqdpizd.supabase.co"
    NEXT_PUBLIC_SUPABASE_ANON_KEY = "<anon-key>"   # público, ok no toml

[env]
  NODE_ENV = "production"
  TZ = "America/Sao_Paulo"
  FLARESOLVERR_URL = "http://vibematch-flaresolverr.flycast:8191/v1"
  COMIX_FS_SESSION = "comix"
  COMIX_CF_ABORT_MS = "25000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"    # economiza quando ocioso
  auto_start_machines = true
  min_machines_running = 0        # sobe sob demanda (cold start ~poucos s)

[[vm]]
  size = "shared-cpu-1x"
  memory = "1gb"
```

> O build (que consome RAM) roda no **builder remoto** do Fly, não na máquina do
> app — por isso 1 GB no app basta (ele só roda o `server.js` standalone).

### 2.1 Secrets (runtime, nunca no toml/git)

```bash
fly secrets set \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  ANTHROPIC_API_KEY="..." \
  OPENAI_API_KEY="..." \
  --config fly.toml
```

### 2.2 Deploy

```bash
fly deploy --config fly.toml
```

---

## Fase 3 — HTTPS / domínio

- **Padrão:** `https://vibematch.fly.dev` já vem com TLS automático. **Nada de
  Caddy/DuckDNS.**
- **Domínio próprio (opcional):** `fly certs add app.seudominio.com` + apontar o
  DNS (CNAME pro `vibematch.fly.dev` ou A/AAAA pros IPs do Fly). O Fly emite o
  cert sozinho.

---

## Fase 4 — Verificação (checklist)

- [ ] App abre em `https://vibematch.fly.dev`.
- [ ] **Avaliação IA roda até o fim (~78s) sem cair** — o teste-chave. Se o
      fly-proxy cortar por idle, ver Apêndice (mitigação).
- [ ] **FlareSolverr ativo:** rodar uma busca que toque Comix/ComicK e ver dados
      chegando; `fly logs` do app **não** deve mostrar `flaresolverr_unavailable`.
- [ ] **Comix:** detalhe/reviews de um título funcionam (prova que
      `COMIX_FS_SESSION`/`FLARESOLVERR_URL` estão certos).
- [ ] **Latência de DB caiu:** páginas de ranking/listagem bem mais rápidas.

---

## Fase 5 — Operação

```bash
fly deploy                 # redeploy após mudança (ou via GitHub Action, abaixo)
fly logs                   # logs ao vivo
fly status                 # estado das máquinas
fly ssh console            # shell na máquina do app
fly secrets list           # secrets (valores ocultos)
fly scale memory 2048      # subir RAM se precisar
```

**Deploy automático (opcional)** — `.github/workflows/fly.yml` rodando
`flyctl deploy --remote-only` no push pra `main` (precisa do `FLY_API_TOKEN` nos
secrets do GitHub: `fly tokens create deploy`). Dá um fluxo git-push→deploy
parecido com o da Vercel (sem os preview-deploys por PR, que o Fly não faz nativo).

---

## Apêndice — gotchas, custo & notas

- **IA de ~78s vs idle-timeout do fly-proxy.** Fly não tem `maxDuration` de
  serverless, mas o proxy pode ter idle-timeout se a resposta demora a começar a
  fluir. **Testar o fluxo IA ponta a ponta** na Fase 4. Se cortar: o app já tem a
  barra estimada (não streama) — a mitigação é mandar um heartbeat/flush cedo na
  resposta, ou ajustar o timeout do serviço. Provavelmente nem precisa.
- **FlareSolverr / Chromium:** demos 1 GB + `HEADLESS`/`DISABLE_MEDIA`. Se o
  Chromium crashar por `/dev/shm` pequeno, é o gotcha clássico — aumentar RAM da
  máquina ou checar flags do FlareSolverr.
- **Custo (estimativa):** 2× `shared-cpu-1x`. FlareSolverr fica **sempre ligado**
  (~$3-5/mês). O app com `auto_stop_machines` **dorme quando ocioso** e acorda no
  request (cold start de poucos segundos) → quase só paga quando em uso. Total
  realista ~**$5-10/mês**. Pra cortar mais: deixar o app também com `min=1` só se
  o cold start incomodar.
- **Região:** `gru` (São Paulo) — o Supabase migrou pra `sa-east-1` em 2026-07-02,
  então agora tem localidade BR completa: navegador→app **e** app→DB perto. (Era
  `iad`/Ohio; obsoleto.)
- **Arquivos do repo:** o `Dockerfile` é reusado como está. O **`docker-compose.yml`
  e o `Caddyfile` não são usados pelo Fly** (Fly usa `fly.toml` + TLS próprio) —
  ficam pra dev local / referência do plano Oracle.
- **Segurança:** secrets só via `fly secrets` (nunca no `fly.toml`/git);
  FlareSolverr sem serviço público (só flycast interno).
```
