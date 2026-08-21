#!/usr/bin/env bash
#
# O ciclo completo do smoke LOGADO: build de produção → sobe → verifica → derruba.
# Use `npm run smoke:logado` (da raiz do repo).
#
# ── por que uma CÓPIA, e não `git worktree` ──────────────────────────────────
#
# 🔴 `next build` e `next dev` disputam o `.next`. Buildar no checkout mataria o
# cache do dev server que costuma estar no ar aqui, então o build sai daqui.
#
# 🔴 Mas a cópia é do WORKING TREE, e não um `git worktree` do HEAD — que foi a
# primeira versão e estava errada. Um `git worktree` só enxerga o que já foi
# COMMITADO: a primeira execução morreu com `Cannot find module
# .../smoke-logado.mjs` porque o próprio script ainda não estava no índice.
#
# O defeito é maior que o sintoma. Este smoke é PRÉ-deploy: ele existe para
# responder "o que estou prestes a publicar quebra logado?", e essa pergunta é
# sobre o disco, não sobre o último commit. Amarrado ao HEAD, ele só rodaria
# depois de commitar — ou seja, depois do momento em que serve.
#
# ⚠️ É o oposto do `deploy.sh`, e de propósito: lá o alvo é `origin/main` porque
# o que se verifica é o que foi PUBLICADO. Aqui o alvo é o que está na sua mão.
#
# ── por que o env é reescrito no worktree ────────────────────────────────────
#
# 🔴 `NEXT_PUBLIC_*` é embutido no bundle em BUILD TIME. Não basta apontar o
# servidor para o banco local na hora de subir: um build feito com o `.env.local`
# apontando para a nuvem produziria um cliente falando com PRODUÇÃO enquanto o
# servidor fala com o local — e o smoke definiria senha num banco e verificaria
# outro. Por isso o alvo é trocado ANTES do build, e só na cópia.
#
# ⚠️ O `.env.local` do checkout NÃO é tocado. Ele alterna entre nuvem e local
# (`db:local`/`db:cloud`) e é do operador.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
PORTA="${SMOKE_PORTA:-3100}"

fail() { echo "❌ $*" >&2; exit 1; }

# ── guarda 1: o stack local precisa estar no ar ──────────────────────────────
#
# 🔴 Falha ALTO, não soft. Este smoke roda antes de publicar: "não verifiquei"
# não pode passar por "verifiquei". É o oposto do `smoke-browser.mjs`, que é
# fail-soft porque roda DEPOIS do deploy, sob `set -e`.
curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:54321/rest/v1/" \
  || fail "o stack Supabase local não responde na 54321.
   Este smoke usa contas com senha DESCARTÁVEL, que só existem lá.
   Suba com: supabase start   (a partir deste diretório — ele decide o projeto pelo cwd)"

[ -f .env.analysis ] \
  || fail "falta .env.analysis (o alvo do stack local). Gere com: npm run db:analysis-env"

[ -f .env.local ] || fail "falta .env.local."

# ── worktree descartável, com o env apontando pro LOCAL ──────────────────────
WT="$(mktemp -d)/satoria-logado"
SRV=""
cleanup() {
  # `wait` depois do `kill` engole o "Terminated: 15" que o job control imprime.
  if [ -n "$SRV" ]; then kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true; fi
  # 🔴 A PORTA é a prova, não o PID: `start-standalone.mjs` spawna o `server.js`, e até
  # 21/08 ele não encaminhava o sinal — matar o PID que conhecemos deixava o NETO vivo
  # segurando a 3100, e o `rm -rf` abaixo apagava o worktree debaixo dele. A raiz foi
  # corrigida lá; isto aqui é a rede, e ela custa uma linha. As duas camadas existem porque
  # são fatos diferentes: "o processo terminou" × "a porta está livre".
  lsof -ti:"$PORTA" 2>/dev/null | xargs kill 2>/dev/null || true
  rm -rf "$(dirname "$WT")" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$WT"
SUJO="$(git status --porcelain | wc -l | tr -d ' ')"
echo "▶ cópia do working tree em $WT ($(git rev-parse --short HEAD), $SUJO arquivo(s) não commitado(s))"

# O que fica de fora é o pesado e o regenerável. `.env*` ENTRA — o build precisa
# do alvo, e a cópia é descartável.
rsync -a \
  --exclude='.git/' --exclude='node_modules/' --exclude='.next/' --exclude='.turbo/' \
  --exclude='.backups/' --exclude='.cache/' --exclude='Imagens/' --exclude='.e1/' \
  ./ "$WT/"

# `-c` é clone de APFS: ~7s e quase nenhum disco, contra minutos de `npm ci`.
cp -Rc node_modules "$WT/node_modules"

node -e '
const fs = require("fs"), p = process.argv[1]
const alvo = Object.fromEntries(fs.readFileSync(p + "/.env.analysis", "utf8").split("\n")
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]))
let t = fs.readFileSync(p + "/.env.local", "utf8")
for (const [k, v] of Object.entries(alvo)) t = t.replace(new RegExp("^" + k + "=.*$", "m"), k + "=" + v)
fs.writeFileSync(p + "/.env.local", t)
' "$WT"

echo "▶ build de produção (alvo: banco local)…"
( cd "$WT" && npx next build > /tmp/smoke-logado-build.log 2>&1 ) \
  || { tail -25 /tmp/smoke-logado-build.log; fail "o build falhou (log em /tmp/smoke-logado-build.log)"; }

lsof -ti:"$PORTA" | xargs kill 2>/dev/null || true
( cd "$WT" && PORT="$PORTA" exec node scripts/start-standalone.mjs > /tmp/smoke-logado-server.log 2>&1 ) &
SRV=$!

for _ in $(seq 1 40); do
  curl -sf -o /dev/null --max-time 2 "http://localhost:$PORTA/login" && break
  sleep 0.5
done
curl -sf -o /dev/null --max-time 3 "http://localhost:$PORTA/login" \
  || { tail -20 /tmp/smoke-logado-server.log; fail "o servidor não subiu na $PORTA"; }
echo "▶ servidor em http://localhost:$PORTA"
echo

# 🔴 O SCRIPT sai do worktree (é o código sob teste), o BROWSER sai do checkout
# (worktree novo não tem `node_modules` do sidecar) — mesma separação do deploy.
node --env-file="$WT/.env.local" "$WT/scripts/smoke-logado.mjs" \
  --base="http://localhost:$PORTA" --modules="$REPO_ROOT"
