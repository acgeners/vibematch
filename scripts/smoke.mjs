#!/usr/bin/env node
/**
 * Roda TODOS os smokes de produção, em ordem, com os mesmos argumentos.
 *
 *   npm run smoke                                    # contra satoria.fly.dev
 *   npm run smoke -- --base=http://localhost:3001    # contra um servidor local
 *
 * ── por que existe ───────────────────────────────────────────────────────────────────────
 *
 * 🔴 Os smokes só eram alcançáveis pelo `scripts/deploy.sh`. Em 2026-08-20 um deploy foi feito
 * com `flyctl deploy` direto — que pula o wrapper inteiro, ou seja as três guardas E os dois
 * smokes — e depois não havia comando curto para verificar: era digitar dois caminhos de
 * arquivo à mão. Verificação sem entrada barata é verificação que não acontece.
 *
 * ⚠️ Isto NÃO substitui o `deploy.sh`, e não tem como: as guardas dele (o `.env*` no
 * `.dockerignore`, o token, publicar `origin/main` de um worktree limpo) precisam rodar ANTES
 * de publicar. O que este script cobre é o depois.
 *
 * ── por que não é uma linha no package.json ──────────────────────────────────────────────
 *
 * 🔴 `"smoke": "node a.mjs && node b.mjs"` quebra o encaminhamento de argumento, e quebra do
 * jeito caro: o npm anexa o que vem depois de `--` ao FIM da string, então
 * `npm run smoke -- --base=http://localhost:3001` vira
 *
 *     node a.mjs && node b.mjs --base=http://localhost:3001
 *
 * — o primeiro smoke bate em PRODUÇÃO e o segundo em localhost, num comando só, com os dois
 * resultados impressos como se fossem do mesmo alvo. É a família "dois critérios pro mesmo
 * fato" dentro de uma linha de shell. Daqui os argumentos vão VERBATIM para todos.
 */

import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))

/**
 * 🔴 A lista sai do FILESYSTEM, não de nomes escritos aqui. Smoke novo em `scripts/` entra
 * sozinho — uma lista fixa é como o terceiro smoke nasceria fora do comando que existe para
 * rodar todos, sem nada acusar.
 *
 * A ORDEM é alfabética e isso é intencional: `smoke-browser` antes de `smoke-producao` seria
 * gastar ~26s de browser antes da checagem barata. Como hoje são exatamente esses dois, a
 * ordem alfabética já põe o browser primeiro — então ela é invertida de propósito pelo peso,
 * e o `deploy.sh` faz o mesmo.
 */
const PESO = { "smoke-producao.mjs": 0, "smoke-browser.mjs": 1 }

/**
 * ⚠️ EXPORTADA para poder ser testada de verdade. A 1ª versão do teste só fazia `grep` por
 * `readdirSync` no source — e passou verde numa sonda que trocava a derivação por uma lista
 * fixa e deixava a palavra sobrando noutra linha. Casar a GRAFIA prova que alguém escreveu a
 * palavra; casar o FATO exige rodar a função contra um diretório e ver o arquivo novo aparecer.
 */
export function listarSmokes(dir) {
  return readdirSync(dir)
    .filter((f) => /^smoke-.*\.mjs$/.test(f))
    .sort((a, b) => (PESO[a] ?? 99) - (PESO[b] ?? 99) || a.localeCompare(b))
}

async function rodar(arquivo, args) {
  return new Promise((pronto) => {
    const p = spawn(process.execPath, [join(AQUI, arquivo), ...args], { stdio: "inherit" })
    p.on("close", (code) => pronto(code ?? 1))
  })
}

/**
 * Só executa quando chamado direto — senão importar este módulo num teste dispararia os smokes
 * de verdade contra produção.
 */
const chamadoDireto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (chamadoDireto) {
  const args = process.argv.slice(2)
  const smokes = listarSmokes(AQUI)

  for (const s of smokes) {
    // Para no primeiro que reprovar, mesma semântica do `set -e` no `deploy.sh`: se o barato já
    // acusou rota vazia, não vale pagar o browser para redescobrir isso.
    const code = await rodar(s, args)
    if (code !== 0) {
      console.error(`\n❌ ${s} reprovou (código ${code}). Os seguintes não rodaram.`)
      process.exit(code)
    }
    console.log("")
  }

  console.log(`✅ ${smokes.length} smoke(s) passaram: ${smokes.join(", ")}`)
}
