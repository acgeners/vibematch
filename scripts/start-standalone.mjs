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
import { existsSync, rmSync, cpSync, readFileSync } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"

/**
 * O `server.js` gerado NÃO lê `.env.local` — em produção quem injeta as variáveis é a plataforma
 * (no Fly, o Dockerfile + os secrets). Sem isto, o servidor sobe, responde 200 e toda página morre
 * com "supabaseKey is required" numa tela genérica de erro. Só afeta o `npm start` local.
 */
function carregarEnvLocal(raiz) {
  const arquivo = path.join(raiz, ".env.local")
  if (!existsSync(arquivo)) return {}
  const env = {}
  for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && !linha.trimStart().startsWith("#")) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return env
}

const raiz = process.cwd()
const standalone = path.join(raiz, ".next", "standalone")

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

const porta = process.env.PORT ?? "3000"
console.log(`▲ standalone em http://localhost:${porta}`)
const servidor = spawn(process.execPath, [path.join(standalone, "server.js")], {
  stdio: "inherit",
  env: { ...carregarEnvLocal(raiz), ...process.env, PORT: porta },
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
