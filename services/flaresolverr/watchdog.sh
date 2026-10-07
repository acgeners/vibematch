#!/bin/sh
# Watchdog do FlareSolverr na Fly (app `vibematch-flaresolverr`).
#
# Por que existe: em 05/10/2026 o Chromium morreu por falta de memória, o Python continuou vivo
# com as 4 threads do waitress presas, e nem `GET /` respondia mais. Como o processo não SAIU, o
# `dumb-init` também não saiu, a Fly seguiu vendo a máquina como `running` e a restart policy
# `on-failure` (que só olha o código de saída) nunca disparou. Health check da Fly não reinicia
# máquina. Ficou inútil até um restart manual.
#
# O que faz: sonda `/health` a cada INTERVALO; depois de LIMITE falhas SEGUIDAS mata o Python com
# SIGKILL. O `dumb-init` sai com 137 e o `on-failure` da Fly reinicia a máquina. Um sucesso zera o
# contador.
#
# Por que `/health` e não `/`: nenhum dos dois toca o Chrome (os dois só provam que o waitress tem
# thread livre), mas `/` grava uma linha de log por chamada e `/health` não.
#
# ⚠️ Ponto cego conhecido: se TODO Chrome falhar rápido enquanto o waitress responde, `/health`
# segue saudável e nada é reiniciado.
#
# 🔴 O alvo é `$$` lido ANTES do `exec`: o `exec` troca o shell pelo Python mantendo o PID, então o
# Python continua filho direto do `dumb-init` e o shutdown normal (SIGINT da Fly → Python sai 0)
# fica idêntico ao da imagem original. Nunca use `pgrep -f flaresolverr.py` aqui: ele casa o PID 1,
# cuja linha de comando também contém `flaresolverr.py`, e `kill` no PID 1 de dentro do container
# não faz nada — o watchdog pareceria funcionar e nunca mataria ninguém.
#
# Uso (CMD do Dockerfile): sh watchdog.sh <comando original do FlareSolverr…>
set -u

INTERVAL="${WATCHDOG_INTERVAL:-60}"
TIMEOUT="${WATCHDOG_TIMEOUT:-10}"
LIMIT="${WATCHDOG_FAILS:-3}"
VERBOSE="${WATCHDOG_VERBOSE:-0}"
URL="http://127.0.0.1:${PORT:-8191}/health"
TARGET=$$

log() { echo "[watchdog] $*"; }

if [ "$#" -eq 0 ]; then
  log "sem comando para executar — uso: watchdog.sh <comando do FlareSolverr…>" >&2
  exit 64
fi

(
  fails=0
  # A 1ª sonda só depois do 1º intervalo: o startup abre um Chrome e leva ~20 s na Fly com ele frio.
  # Falha DURANTE o boot conta, de propósito: um startup que não termina em LIMITE × INTERVALO é
  # travamento, e só armar o watchdog depois do 1º sucesso deixaria esse caso vivo e inútil para sempre.
  while sleep "$INTERVAL"; do
    curl -s -f -o /dev/null -m "$TIMEOUT" "$URL"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      if [ "$fails" -gt 0 ]; then
        log "/health respondeu depois de $fails falha(s) — contador zerado"
      elif [ "$VERBOSE" = "1" ]; then
        log "/health ok"
      fi
      fails=0
    else
      fails=$((fails + 1))
      log "/health falhou (curl exit $rc) — $fails/$LIMIT"
      if [ "$fails" -ge "$LIMIT" ]; then
        log "$LIMIT falhas seguidas — SIGKILL no FlareSolverr (pid $TARGET) para a Fly reiniciar a máquina (on-failure)"
        kill -KILL "$TARGET"
        exit 0
      fi
    fi
  done
) &

log "ativo: alvo pid=$TARGET intervalo=${INTERVAL}s timeout=${TIMEOUT}s limite=$LIMIT url=$URL"
exec "$@"
