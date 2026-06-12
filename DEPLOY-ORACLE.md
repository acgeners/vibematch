# Deploy — Oracle Cloud Always Free

Plano de setup pra subir o **VibeMatch (animedb)** + **FlareSolverr** no tier
*Always Free* da Oracle Cloud, a custo **R$ 0/mês de infra** (só paga o uso da
API do Claude, que é à parte).

## Por que Oracle Always Free

- **VM ARM Ampere A1 grátis pra sempre:** até **4 vCPU + 24 GB RAM** (não é trial).
  24 GB é ~6× o que esse app precisa → build + app + FlareSolverr sem aperto.
- **Processo persistente** → a avaliação IA de ~78s roda sem o timeout de função
  que a Vercel impõe. Sem `maxDuration`, sem plano pago.
- **FlareSolverr volta a ser sidecar** (rede interna do Docker) →
  `FLARESOLVERR_URL=http://flaresolverr:8191/v1`, igual ao `.env.local` de dev.
  **Zero mudança de código** (sem header de auth, sem subir timeout remoto).

## Fatos que guiam a escolha

- **Supabase está em AWS us-east-2 (Ohio).** O servidor deve ficar perto disso pra
  cortar o round-trip de DB de ~300ms (dev BR) pra ~10-15ms.
  → **Home region da Oracle: `us-chicago-1` (Chicago) ou `us-ashburn-1` (Virginia)**
  — ambas ~10-20ms de Ohio. A home region é escolhida **no cadastro e não muda
  depois**, então acerte aqui.
- ARM: as imagens de FlareSolverr e Node são multi-arch; a ML do app é TS puro
  (sem deps nativas). Roda em ARM sem ajuste.

---

## Fase 0 — Pré-requisitos

- [ ] Conta Oracle Cloud (precisa de cartão pra verificação de identidade — o
      Always Free **não cobra**, mas eles validam).
- [ ] Chave SSH (`ssh-keygen -t ed25519` se ainda não tiver).
- [ ] (Opcional, recomendado p/ HTTPS) um domínio apontando pro IP da VM. Sem
      domínio dá pra usar só o IP (sem HTTPS) ou um DDNS grátis (DuckDNS).
- [ ] Secrets em mãos (vão pro `.env` na VM, **nunca** commitados):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicos)
  - `SUPABASE_SERVICE_ROLE_KEY` (secreto)
  - `ANTHROPIC_API_KEY` (secreto)
  - `OPENAI_API_KEY` (opcional — só embeddings)
  - `FLARESOLVERR_URL=http://flaresolverr:8191/v1` (setado no compose)

---

## Fase 1 — Criar a instância ARM

1. Console Oracle → **Compute → Instances → Create instance**.
2. **Image:** Canonical **Ubuntu 24.04** (ou 22.04) — versão **aarch64/ARM**.
3. **Shape:** *Ampere* → **VM.Standard.A1.Flex** → **4 OCPUs / 24 GB RAM**
   (usa toda a cota free de uma vez).
4. **Boot volume:** 50–100 GB (o Always Free dá até 200 GB de block storage total).
5. **SSH:** cole sua chave pública.
6. **Networking:** cria uma VCN nova com subnet pública e **Assign a public IPv4**.

> ⚠️ **Capacidade ARM:** é comum dar `Out of host capacity` na hora de criar a A1
> free. Soluções: tentar de novo (varia ao longo do dia), trocar de Availability
> Domain, ou usar um script de auto-retry. Não desista no primeiro erro.

---

## Fase 2 — Firewall (o gotcha clássico da Oracle)

A Oracle tem **duas camadas** de firewall — abra as portas nas **duas**:

**a) Cloud (Security List da subnet):** VCN → Subnet → Security List → adicionar
Ingress Rules: `0.0.0.0/0` TCP **80** e **443** (a 22 já vem aberta).

**b) Instância (iptables):** as imagens Ubuntu da Oracle vêm com iptables
**bloqueando tudo menos SSH**. Na VM:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Se pular o passo (b), o site fica inacessível mesmo com a Security List correta —
é a causa nº 1 de "abri a porta e não funciona" na Oracle.

---

## Fase 3 — Preparar o servidor

SSH na VM (`ssh ubuntu@SEU_IP`) e:

```bash
sudo apt-get update && sudo apt-get upgrade -y

# Docker + plugin compose (script oficial, funciona em ARM)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker   # ou reconecte o SSH

# (opcional) 4 GB de swap — barato e evita surpresa em picos
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Fase 4 — Código + configs

### 4.1 Trazer o repo (privado) pra VM

Use um **deploy key** read-only (mais limpo que PAT):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub   # → adicionar em GitHub repo → Settings → Deploy keys (read-only)
GIT_SSH_COMMAND='ssh -i ~/.ssh/deploy_key' git clone git@github.com:acgeners/vibematch.git
cd vibematch
```

### 4.2 `next.config.ts` → adicionar `output: "standalone"`

Gera um servidor mínimo, ideal pra imagem Docker enxuta:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  // ...resto do config existente
}
```

### 4.3 `Dockerfile` (multi-stage, ARM-ok)

> Nota Next.js: variáveis `NEXT_PUBLIC_*` são **inlinadas no build** → entram como
> build args. As secretas (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`) são
> **runtime** → entram via `env_file` no compose.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

### 4.4 `.dockerignore`

```
node_modules
.next
.git
.env*
npm-debug.log
.DS_Store
Dockerfile
docker-compose.yml
```

### 4.5 `docker-compose.yml`

```yaml
services:
  app:
    build:
      context: .
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
    env_file: .env
    environment:
      - FLARESOLVERR_URL=http://flaresolverr:8191/v1
    expose:
      - "3000"
    depends_on:
      - flaresolverr
    restart: unless-stopped

  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    environment:
      - LOG_LEVEL=info
      - TZ=America/Sao_Paulo
      - HEADLESS=true
      - DISABLE_MEDIA=true   # não baixa imagens/CSS → menos RAM no Chromium
    shm_size: "1gb"          # evita crash do Chromium por /dev/shm pequeno
    expose:
      - "8191"
    restart: unless-stopped

  caddy:
    image: caddy:2
    env_file: .env           # lê o DOMAIN pro Caddyfile
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
    restart: unless-stopped

volumes:
  caddy_data:
  caddy_config:
```

### 4.6 `.env` na VM (não commitar)

```
DOMAIN=seu-sub.duckdns.org
NEXT_PUBLIC_SUPABASE_URL=https://djbreiyzwoevbmoscqiq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

(O compose lê o `.env` da pasta tanto pra substituir os build args `NEXT_PUBLIC_*`
quanto pra injetar as secretas em runtime via `env_file`.)

---

## Fase 5 — HTTPS (reverse proxy)

O `Caddyfile` (já no repo) lê o host de `{$DOMAIN}` (vindo do `.env`), então o
Caddy resolve o Let's Encrypt sozinho assim que o DNS apontar pro IP da VM.

**DuckDNS (recomendado, grátis):** sem domínio próprio, é o caminho pra ter HTTPS
de verdade. Em [duckdns.org](https://www.duckdns.org) (login social), crie um
subdomínio e aponte o IP público da VM nele. Depois, no `.env`:
`DOMAIN=seu-sub.duckdns.org`. Não precisa de token/módulo no Caddy — o desafio
HTTP-01 funciona só com o A record + portas 80/443 abertas.

> HTTPS importa aqui: o app caminha pra multi-user com auth, e cookie de sessão
> seguro exige HTTPS. Trocar por um domínio próprio depois é só mudar `DOMAIN` no
> `.env` e o DNS — nada no código.

**Sem nenhum domínio (só pra teste rápido):** remova o serviço `caddy`, exponha
`app` na porta 80 (`ports: ["80:3000"]`) e acesse via `http://SEU_IP` (sem HTTPS).

---

## Fase 6 — Subir e verificar

```bash
docker compose up -d --build      # 1º build demora; 24 GB RAM aguenta tranquilo
docker compose logs -f app        # acompanhar boot
```

Checklist:

- [ ] App abre em `https://seu-dominio` (ou `http://IP`).
- [ ] **Avaliação IA roda até o fim** (~78s) sem cair — prova que não há timeout.
- [ ] **FlareSolverr ativo:** rodar uma busca que toque ComicK/Comix e ver dados
      vindo (logs do app não devem mostrar `flaresolverr_unavailable`).
- [ ] **Latência de DB caiu:** páginas de ranking/listagem bem mais rápidas que no dev.

---

## Fase 7 — Operação

```bash
# Redeploy após mudança no código
cd ~/vibematch && GIT_SSH_COMMAND='ssh -i ~/.ssh/deploy_key' git pull
docker compose up -d --build

docker compose ps          # status
docker compose logs -f     # logs
docker compose restart app # reiniciar só o app
```

`restart: unless-stopped` faz tudo voltar sozinho após reboot da VM.

---

## Apêndice — armadilhas & notas

- **iptables da Oracle** (Fase 2b) — a pegadinha nº 1. Não esquecer.
- **Capacidade ARM** — `Out of host capacity` é comum; reerguer/retry.
- **`NEXT_PUBLIC_*` no build** — se a URL/anon do Supabase vier vazia no client,
  é porque não foi passada como build arg (Fase 4.3/4.5).
- **Build na VM** — com 24 GB não há risco de OOM (diferente de uma box de 2 GB).
- **FlareSolverr ocioso é "grátis"** aqui — não há medidor de uso como no Railway.
- **`recalculateAll()`** (~660 obras + ML) pode demorar muito; rode com calma /
  fora de horário de pico. Não é o fluxo do dia a dia.
- **Custo real** = só a **API do Claude** (uso). Alavancas pra reduzir: Haiku no
  A/B do review form, prompt caching, Batch API (−50%) p/ avaliações não-urgentes.
- **Segurança** — `.env` só na VM (chmod 600), nunca no git; FlareSolverr fica em
  rede interna do Docker (não exposto à internet).
```
