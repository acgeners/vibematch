# check=skip=FromPlatformFlagConstDisallowed
# ↑ diretiva do BuildKit (só vale na 1ª linha): o `--platform` constante no FROM é de propósito —
#   o digest fixado é de um manifest SÓ linux/amd64, e é isso que a Fly roda. Sem ele, um build no
#   Mac (arm64) tentaria usar essa base como arm64.
#
# FlareSolverr da Fly (app `vibematch-flaresolverr`) + watchdog — o porquê está em watchdog.sh.
#
# A base é a v3.5.0 FIXADA no digest do manifest linux/amd64, exatamente a imagem que a Fly rodava
# antes deste arquivo existir. O toml usava `:latest`, que já aponta para a v3.5.2: qualquer
# redeploy trocaria a versão sem ninguém decidir. Trocar de versão é decisão própria, porque
# `isFlareSolverrPageTimeout` (lib/external/flaresolverr.ts) casa a mensagem de timeout desta versão.
#   índice v3.5.0 (multi-plataforma): sha256:139dfee1c6f89249c8d665d1333a42e8ec74ec0a86bc6bb1c8461e10d3a66a47
#   manifest linux/amd64 (fixado):    sha256:258523d25e4e07028c3a206f0e03ae807b26a50a201dd320f09a18464ecf86fa
FROM --platform=linux/amd64 ghcr.io/flaresolverr/flaresolverr:v3.5.0@sha256:258523d25e4e07028c3a206f0e03ae807b26a50a201dd320f09a18464ecf86fa

COPY services/flaresolverr/watchdog.sh /usr/local/bin/flaresolverr-watchdog.sh

# ENTRYPOINT herdado da base: ["/usr/bin/dumb-init", "--"]. O CMD original da imagem vai inteiro
# como argumento, e o watchdog faz `exec` dele — o Python continua filho direto do dumb-init.
CMD ["/bin/sh", "/usr/local/bin/flaresolverr-watchdog.sh", "/usr/local/bin/python", "-u", "/app/flaresolverr.py"]
