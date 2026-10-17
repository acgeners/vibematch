#!/usr/bin/env node
/**
 * `npm start` local para `output: "standalone"`.
 *
 * `next start` NÃO funciona com standalone — o próprio Next avisa e sobe um servidor que não serve
 * a build. O servidor certo é `.next/standalone/server.js`, mas ele sozinho também não basta: o
 * `next build` deixa `public/` e `.next/static/` FORA do pacote, de propósito (num deploy real esses
 * arquivos vão pra um CDN). Sem copiar, o servidor sobe, responde 200 no HTML e serve a página
 * inteira SEM CSS e SEM JS — falha que parece problema de estilo, não de deploy.
 *
 * Este script reproduz localmente exatamente o que o Dockerfile faz nas linhas 21-23.
 *
 * Uso: npm run build && npm start        (PORT=3000 por padrão)
 */
import { existsSync, rmSync, cpSync } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"
// O ambiente do servidor (sem credencial administrativa, e com a ordem que importa) — ver o módulo.
import { ambienteDoServidor, carregarEnvLocal, decidirInicioLocal } from "./lib/standalone-env.mjs"
import { probeGit } from "../lib/ai/git-probe.mjs"

const raiz = process.cwd()
const standalone = path.join(raiz, ".next", "standalone")
const porta = process.env.PORT ?? "3000"
const env = ambienteDoServidor({ envLocal: carregarEnvLocal(raiz), processEnv: process.env, porta })

// 🔴 Contra a nuvem, só checkout canônico sobe (a curadoria local grava na nuvem) — ver `decidirInicioLocal`.
const inicio = decidirInicioLocal({ url: env.NEXT_PUBLIC_SUPABASE_URL, onFly: Boolean(env.FLY_APP_NAME), sondar: () => probeGit(raiz) })
if (!inicio.permitido) {
  console.error(`✗ ${inicio.motivo}`)
  process.exit(1)
}

if (!existsSync(standalone)) {
  console.error("✗ .next/standalone não existe — rode `npm run build` antes.")
  process.exit(1)
}

// Idempotente: apaga antes de copiar. `cp -R origem destino/` com o destino JÁ existente aninha
// (`destino/origem/origem`) em vez de sobrescrever — é a pegadinha clássica de rodar duas vezes.
for (const [origem, destino] of [
  [path.join(raiz, "public"), path.join(standalone, "public")],
  [path.join(raiz, ".next", "static"), path.join(standalone, ".next", "static")],
]) {
  if (!existsSync(origem)) continue
  rmSync(destino, { recursive: true, force: true })
  cpSync(origem, destino, { recursive: true })
}

console.log(`▲ standalone em http://localhost:${porta}`)
const servidor = spawn(process.execPath, [path.join(standalone, "server.js")], {
  stdio: "inherit",
  env,
}).on("exit", (code) => process.exit(code ?? 0))

/**
 * 🔴 O sinal tem que ATRAVESSAR até o servidor — este processo é só um lançador.
 *
 * Sem isto, um SIGTERM mata o lançador e o `server.js` fica **órfão segurando a porta**, com o
 * chamador convencido de que derrubou tudo. Foi o que o `smoke-logado.sh` produzia: ele mata o
 * PID que conhece (este), o neto sobrevive, e o `rm -rf` seguinte apaga o worktree **debaixo de
 * um servidor que continua no ar** — processo vivo servindo arquivos que já não existem.
 *
 * O `exitCode` do filho volta pelo `on("exit")` acima; aqui só encaminhamos o pedido.
 */
for (const sinal of ["SIGTERM", "SIGINT"]) {
  process.on(sinal, () => {
    servidor.kill(sinal)
    // Rede curta: se o filho ignorar o pedido, não ficamos presos esperando para sempre.
    setTimeout(() => servidor.kill("SIGKILL"), 3000).unref()
  })
}
