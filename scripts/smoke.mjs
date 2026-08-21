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
import { readdirSync, readFileSync, realpathSync } from "node:fs"
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

/**
 * 🔴 O ALVO sai do PRÓPRIO arquivo (`SMOKE-ALVO:` no cabeçalho), nunca de uma lista aqui.
 *
 * Existem dois tipos e eles não são intercambiáveis: `producao` verifica **o que está no ar**
 * (depois de publicar, anônimo, contra o Fly) e `pre-deploy` verifica **o que vai subir**
 * (antes de publicar, logado, contra um build local com banco descartável). Rodar um com o
 * `--base` do outro não é "mais cobertura" — é apontar a ferramenta para o alvo errado, e o
 * `smoke-logado.mjs` recusa isso de propósito, porque ele ESCREVE senha no banco do alvo.
 *
 * ⚠️ Sem esta distinção, o smoke de pré-deploy seria arrastado para `npm run smoke` e para o
 * `deploy.sh` — os dois apontando para produção — e reprovaria todo deploy pela guarda dele.
 */
export function alvoDoSmoke(dir, arquivo) {
  const m = readFileSync(join(dir, arquivo), "utf8").match(/SMOKE-ALVO:\s*([a-z-]+)/)
  return m?.[1] ?? null
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
/**
 * ⚠️ Via `realpath`, e não `resolve`. Medido em 21/08/2026 no `smoke-logado.mjs`: invocado por
 * um caminho de `mktemp -d` (`/var/folders/…`, symlink para `/private/var/…`), a comparação
 * sem realpath dá falso e o script sai com código **0 sem fazer nada** — verificação que
 * reporta sucesso sem ter verificado. Aqui não mordia porque este wrapper é sempre invocado do
 * checkout; a diferença é sorte de caminho, não desenho.
 */
const mesmoArquivo = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}
const chamadoDireto = Boolean(process.argv[1]) && mesmoArquivo(process.argv[1], fileURLToPath(import.meta.url))

if (chamadoDireto) {
  const args = process.argv.slice(2)
  const todos = listarSmokes(AQUI)

  // ⚠️ Sem alvo declarado, o smoke entra como `producao` — o comportamento de antes desta
  // distinção existir. O que impede isso de virar um esquecimento silencioso é o teste de
  // arquitetura, que exige a declaração em todo smoke do disco.
  const smokes = todos.filter((f) => (alvoDoSmoke(AQUI, f) ?? "producao") === "producao")
  const preDeploy = todos.filter((f) => alvoDoSmoke(AQUI, f) === "pre-deploy")

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

  // 🔴 Declarar o que NÃO foi verificado, sempre. Um wrapper que roda 2 de 3 e imprime só "✅"
  // é como "verificado" passa a significar outra coisa sem ninguém decidir nada — a mesma
  // família do backup automático que avisava num log que ninguém lia e reportava sucesso.
  if (preDeploy.length) {
    console.log("")
    console.log(`  ℹ️  a metade LOGADA do app não entra aqui: ${preDeploy.join(", ")} roda ANTES`)
    console.log("     de publicar, contra um build local (banco descartável). Comando:")
    console.log("     npm run smoke:logado")
  }
}
