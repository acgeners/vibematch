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
  echo "  ⚠️  seu HEAD local está em $LOCAL_HEAD — o deploy publica origin/main assim mesmo."
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
echo "✅ publicado. Confira o que subiu — 200 NÃO basta:"
echo "   curl -s --max-time 90 https://$APP.fly.dev/api/health"
echo "   (o corpo tem que trazer \"ok\":true — a rota exercita o banco)"
