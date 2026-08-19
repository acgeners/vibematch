#!/usr/bin/env bash
#
# Deploy da satoria na Fly. Use `npm run deploy` (da raiz do repo).
#
# Existe porque três coisas sobre este deploy só viviam na cabeça de quem já
# tinha feito um — e a primeira delas já custou um "não dá pra deployar" errado:
#
# 1. 🔧 O flyctl NÃO lê o próprio token. `flyctl auth whoami` responde
#    "no access token available" mesmo com um `access_token` válido no
#    ~/.fly/config.yml (conferido 2026-08-05: arquivo bem formado, permissão
#    600, dono certo, sem entrada no Keychain, e falha também fora de sandbox —
#    causa raiz desconhecida). Passar o token explicitamente funciona.
#
# 2. 🔴 Deploy sai do worktree DETACHED em origin/main, nunca do checkout
#    canônico. No canônico, qualquer WIP não commitado entra no contexto do
#    build. Aqui isso é automático: o script cria o worktree, deploya e remove.
#
# 3. 🔴 O .dockerignore PRECISA cobrir .env*. O .env.local alterna entre nuvem e
#    local (npm run db:local / db:cloud), então na metade dos dias ele aponta pro
#    127.0.0.1:54321. Vazar isso pra imagem sobe uma produção que responde 200 e
#    não fala com banco nenhum — a mesma falha que ficou 3 dias no ar sem ninguém
#    perceber (ver .github/workflows/healthcheck.yml).
#
# DEPLOY_CHECK_ONLY=1 roda só as verificações, sem publicar.
set -euo pipefail

APP=satoria
FLY_CONFIG="$HOME/.fly/config.yml"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "❌ $*" >&2; exit 1; }

# ── guarda 1: .env não pode vazar pra imagem ──────────────────────────────────
grep -qE '^\.env' .dockerignore \
  || fail ".dockerignore não cobre .env* — o .env.local vazaria pra imagem.
   Hoje ele aponta pra: $(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL' .env.local 2>/dev/null || echo '?')"

# ── guarda 2: token ───────────────────────────────────────────────────────────
[ -f "$FLY_CONFIG" ] || fail "sem $FLY_CONFIG — rode 'flyctl auth login' uma vez nesta máquina."
FLY_API_TOKEN="$(grep '^access_token' "$FLY_CONFIG" | sed 's/.*: *//')"
[ -n "$FLY_API_TOKEN" ] || fail "$FLY_CONFIG existe mas não tem access_token."
export FLY_API_TOKEN

# ── guarda 3: publica origin/main, e só ───────────────────────────────────────
git fetch --quiet origin main
TARGET="$(git rev-parse --short origin/main)"
echo "▶ alvo: origin/main @ $TARGET"

LOCAL_HEAD="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
if [ "$LOCAL_HEAD" != "$TARGET" ]; then
  # ⚠️ Duas coisas diferentes, e a segunda é a que morde: o CÓDIGO publicado é sempre
  # origin/main (não o seu checkout), mas as GUARDAS e as verificações que rodam são as
  # DESTE arquivo — a versão que está no seu checkout. Melhoria no próprio deploy só passa
  # a valer depois de atualizá-lo. O smoke escapa disso porque sai do worktree publicado.
  echo "  ⚠️  seu HEAD local está em $LOCAL_HEAD, e origin/main está em $TARGET."
  echo "      O CÓDIGO publicado é o de origin/main — isso não muda."
  echo "      Mas as guardas deste script são as do seu checkout: se o deploy.sh mudou no"
  echo "      main, atualize antes ('git checkout main && git pull') ou elas ficam de fora."
fi

if [ "${DEPLOY_CHECK_ONLY:-}" = "1" ]; then
  echo "✅ verificações passaram (DEPLOY_CHECK_ONLY=1, nada publicado)."
  exit 0
fi

# ── deploy do worktree descartável ────────────────────────────────────────────
WT="$(mktemp -d)/satoria-$TARGET"
cleanup() { git worktree remove --force "$WT" 2>/dev/null || true; git worktree prune; }
trap cleanup EXIT

git worktree add --quiet --detach "$WT" origin/main
echo "▶ worktree limpo em $WT"
( cd "$WT" && flyctl deploy --app "$APP" )

echo
echo "✅ publicado. Conferindo o que subiu…"
echo

# ── smoke: 200 NÃO basta ──────────────────────────────────────────────────────
#
# 🔴 Aqui antes havia um `echo` mandando conferir o /api/health à mão. Em 19/08/2026 um
# deploy de 90 PRs subiu com a /ranking QUEBRADA — 200 na resposta, erro de Server
# Components e zero obras na tela — e o health respondeu `{"ok":true}` do mesmo jeito,
# porque ele exercita o banco mas não abre a /ranking. A instrução impressa foi seguida,
# passou, e o defeito ficou no ar até alguém abrir a página num browser.
#
# ⚠️ O smoke roda DEPOIS de publicar, de propósito: o que ele verifica é o que está no ar,
# e não há como saber isso antes. Ele não desfaz o deploy — reprovar aqui significa "está
# no ar e quebrado", que é exatamente quando alguém precisa saber, e o `set -e` propaga o
# código de saída para quem chamou.
# 🔴 O smoke sai do "$WT" (o worktree de origin/main que este script acabou de publicar),
# NUNCA de "$REPO_ROOT". Medido em 19/08/2026, uma hora depois de o smoke entrar no main: o
# deploy rodou, publicou o código novo e **não rodou o smoke** — porque quem executa é o
# `deploy.sh` do CHECKOUT LOCAL, que estava numa branch já mergeada e ainda tinha a versão
# anterior. Saiu a mensagem antiga, o deploy reportou sucesso, e a verificação que existe
# para pegar rota quebrada simplesmente não aconteceu.
#
# É "dois critérios pro mesmo fato" aplicado ao próprio deploy: o que é PUBLICADO
# (origin/main) e o que EXECUTA (o checkout de quem digitou o comando) são coisas
# diferentes, e só a primeira estava sob controle. Verificar o que subiu com o script de
# outra versão é verificar outra coisa.
node "$WT/scripts/smoke-producao.mjs" --base="https://$APP.fly.dev"
